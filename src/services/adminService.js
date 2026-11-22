const { createHash } = require('node:crypto');
const { MATCH_STATUS, SIDES, TEAM_SIZE } = require('../constants');
const { UserError } = require('../utils/errors');
const { normalizeChampion, championKey } = require('./statInput');
const { summarize } = require('./recordService');

/**
 * 관리자 서비스 (/관리자 커맨드)
 * - 계정정보: 서버의 모든 계정 + 전적 요약
 * - 데이터적재: DB에 있는 대전의 한 판을 찾아 팀 · 챔피언 · K/D/A · CS · 승패를 다시 쓴다.
 *   승점은 판별 승패에서 계산되므로 함께 갱신된다.
 */
function createAdminService(repos, accounts) {
  const { guildMembers, matches, teams, participants, records, recordPlayers, transaction } = repos;

  /* ───────────── 계정정보 ───────────── */

  function listAccounts(guildId) {
    return guildMembers.findAllWithStatsByGuild(guildId).map((row) => ({ ...row, summary: summarize(row) }));
  }

  /* ───────────── 데이터적재 ───────────── */

  /** 데이터 적재 대상 대전 (진행 중 또는 종료, 이 서버) */
  function requireLoadableMatch(guildId, matchId) {
    const match = matches.findById(Number(matchId));
    if (!match || match.guild_id !== guildId) {
      throw new UserError(`대전 #${matchId}을(를) 이 서버의 대전 목록에서 찾을 수 없습니다.`);
    }
    if (match.status !== MATCH_STATUS.IN_PROGRESS && match.status !== MATCH_STATUS.FINISHED) {
      throw new UserError('진행 중이거나 종료된 대전만 데이터를 적재할 수 있습니다. (모집 중 · 취소된 대전 제외)');
    }
    return match;
  }

  /** 판 번호 확인: 1 ~ 대전의 판 수 */
  function requireGameNo(match, gameNo) {
    const n = Number(gameNo);
    if (!Number.isInteger(n) || n < 1 || n > match.game_count) {
      throw new UserError(`대전 #${match.id}은(는) ${match.game_count}판까지 있습니다. 1~${match.game_count} 중에서 골라 주세요.`);
    }
    return n;
  }

  function rosterSignature(red, blue) {
    const ids = `${red.map((p) => p.guild_member_id).join(',')}|${blue.map((p) => p.guild_member_id).join(',')}`;
    return createHash('sha1').update(ids).digest('hex').slice(0, 8);
  }

  /**
   * 데이터 적재할 판의 팀 구성.
   * - 이미 기록된 판: 그 판에 저장된 팀 (기존 값으로 양식을 채운다)
   * - 아직 기록이 없는 판: 대전 참가자의 현재 팀 (1팀 5명 · 2팀 5명이어야 함)
   */
  function getGameRoster(guildId, matchId, gameNo) {
    const match = requireLoadableMatch(guildId, matchId);
    const no = requireGameNo(match, gameNo);
    const record = records.findByMatchAndGameNo(match.id, no);

    let red;
    let blue;
    if (record) {
      const rows = recordPlayers.findByRecord(record.id);
      red = rows.filter((p) => p.side === 'RED');
      blue = rows.filter((p) => p.side === 'BLUE');
    }
    if (!record || red.length !== TEAM_SIZE || blue.length !== TEAM_SIZE) {
      // 기록이 없거나, 이전 버전 기록이라 팀 정보가 없으면 현재 참가자 팀을 쓴다.
      const list = participants.findByMatchWithDetails(match.id);
      const old = record ? new Map(recordPlayers.findByRecord(record.id).map((p) => [p.guild_member_id, p])) : new Map();
      const withOld = (p) => {
        const o = old.get(p.guild_member_id) || {};
        return {
          ...p,
          champion: o.champion ?? null,
          kills: o.kills ?? null,
          deaths: o.deaths ?? null,
          assists: o.assists ?? null,
          cs: o.cs ?? null,
          is_win: o.is_win,
        };
      };
      red = list.filter((p) => p.side === 'RED').map(withOld);
      blue = list.filter((p) => p.side === 'BLUE').map(withOld);
      if (red.length !== TEAM_SIZE || blue.length !== TEAM_SIZE) {
        throw new UserError(
          `대전 #${match.id} ${no}판의 팀 구성을 알 수 없습니다. (1팀 ${red.length}명 · 2팀 ${blue.length}명) ` +
            '팀이 5:5로 나뉜 대전만 데이터를 적재할 수 있습니다.',
        );
      }
    }
    const byMember = (a, b) => a.guild_member_id - b.guild_member_id;
    red.sort(byMember);
    blue.sort(byMember);

    // 피어리스: 이 판을 뺀 같은 대전의 다른 판에서 쓴 챔피언
    const usedChampions = recordPlayers
      .findByMatch(match.id)
      .filter((p) => p.champion && p.game_no !== no)
      .map((p) => ({ champion: p.champion, key: championKey(p.champion), gameNo: p.game_no }));

    const winnerSide = record?.winner_team_id
      ? teams.findByMatch(match.id).find((t) => t.id === record.winner_team_id)?.side ?? null
      : (record && [...red, ...blue].find((p) => p.is_win)?.side) || null;

    return { match, gameNo: no, record, red, blue, winnerSide, usedChampions, signature: rosterSignature(red, blue) };
  }

  /**
   * 데이터 적재: 판의 승리팀 + 10명 챔피언 · K/D/A · CS를 저장한다. (이미 있으면 덮어쓴다)
   * @param {{ stats: { guildMemberId: number, champion: string, kills, deaths, assists, cs }[] }} params
   * @returns {{ match, gameNo, created: boolean, players: object[] }}
   */
  const loadGameRecord = transaction(
    ({ guildId, discordUserId, matchId, gameNo, signature = null, winnerSide, stats, screenshotPath = null }) => {
      if (!SIDES.includes(winnerSide)) throw new UserError('승리팀을 골라 주세요.');
      const roster = getGameRoster(guildId, matchId, gameNo);
      if (signature != null && signature !== roster.signature) {
        throw new UserError('입력창을 연 뒤 이 판의 팀 구성이 바뀌었습니다. 다시 `/관리자 데이터적재`를 실행해 주세요.');
      }
      const players = [...roster.red, ...roster.blue];
      const byMember = new Map((stats || []).map((s) => [Number(s.guildMemberId), s]));
      if (players.some((p) => !byMember.has(p.guild_member_id)) || byMember.size !== players.length) {
        throw new UserError('참가자 10명의 챔피언 · 킬/데스/어시/CS를 모두 입력해 주세요.');
      }

      const used = new Map(roster.usedChampions.map((u) => [u.key, u]));
      const seen = new Set();
      for (const p of players) {
        const st = byMember.get(p.guild_member_id);
        const values = [st.kills, st.deaths, st.assists, st.cs];
        if (values.some((v) => !Number.isInteger(v) || v < 0)) {
          throw new UserError('킬/데스/어시/CS는 0 이상의 숫자로 입력해 주세요.');
        }
        st.champion = normalizeChampion(st.champion);
        if (!st.champion) throw new UserError('참가자 10명의 챔피언을 모두 입력해 주세요.');
        const key = championKey(st.champion);
        if (used.has(key)) {
          throw new UserError(`피어리스: ${st.champion}은(는) 이 대전의 ${used.get(key).gameNo}판에서 이미 사용한 챔피언입니다.`);
        }
        if (seen.has(key)) throw new UserError(`한 판에서 같은 챔피언(${st.champion})을 두 명이 할 수 없습니다.`);
        seen.add(key);
      }

      const { match, gameNo: no } = roster;
      const winnerTeamId = teams.findByMatch(match.id).find((t) => t.side === winnerSide).id;
      const recordedBy = accounts.findAnyMember(guildId, discordUserId)?.id ?? null;
      let recordId = roster.record?.id;
      const created = !recordId;
      if (created) {
        recordId = records.insert({ matchId: match.id, gameNo: no, winnerTeamId, screenshotPath, recordedBy });
      } else {
        records.updateResult({ id: recordId, winnerTeamId, screenshotPath, recordedBy });
        recordPlayers.deleteByRecord(recordId);
      }
      const side = new Map([...roster.red.map((p) => [p.guild_member_id, 'RED']), ...roster.blue.map((p) => [p.guild_member_id, 'BLUE'])]);
      for (const p of players) {
        const st = byMember.get(p.guild_member_id);
        recordPlayers.insert({
          recordId,
          guildMemberId: p.guild_member_id,
          side: side.get(p.guild_member_id),
          gameName: p.game_name ?? null,
          position: p.position ?? null,
          champion: st.champion,
          kills: st.kills,
          deaths: st.deaths,
          assists: st.assists,
          cs: st.cs,
          isWin: side.get(p.guild_member_id) === winnerSide,
        });
      }
      return { match, gameNo: no, created, players: recordPlayers.findByRecord(recordId) };
    },
  );

  /** 데이터 적재 후 그 판의 결과 캡쳐 경로 저장 */
  function setGameScreenshot(matchId, gameNo, screenshotPath) {
    const record = records.findByMatchAndGameNo(Number(matchId), Number(gameNo));
    if (record) {
      records.updateResult({
        id: record.id,
        winnerTeamId: record.winner_team_id,
        screenshotPath,
        recordedBy: record.recorded_by,
      });
    }
  }

  return { listAccounts, getGameRoster, loadGameRecord, setGameScreenshot, requireLoadableMatch };
}

module.exports = { createAdminService };
