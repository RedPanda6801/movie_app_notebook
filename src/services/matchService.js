const {
  MATCH_SIZE,
  TEAM_SIZE,
  MATCH_STATUS,
  POSITIONS,
  SIDES,
  MIN_GAMES,
  MAX_GAMES,
} = require('../constants');
const { createHash } = require('node:crypto');
const { UserError } = require('../utils/errors');
const { normalizeChampion, championKey } = require('./statInput');
const { normalizeGameName, normalizePosition } = require('./validation');

/**
 * 팀 구성 서명: 기록 입력창을 띄운 뒤 팀이 바뀌었는지(셔플 등) 확인하는 데 쓴다.
 * 입력창 양식의 줄 순서가 팀 구성에 따라 정해지기 때문이다.
 */
function teamSignature(red, blue) {
  const ids = `${red.map((p) => p.id).join(',')}|${blue.map((p) => p.id).join(',')}`;
  return createHash('sha1').update(ids).digest('hex').slice(0, 8);
}

/**
 * 대전관리 서비스 - 대전 등록/시작/판 기록/종료와 사용자 관리(참가, 탈퇴, 포지션).
 * 서버(guild)당 진행 중인 대전은 1개만 존재한다. 대전 안에는 1~10판이 있다.
 */
function createMatchService(repos, accounts) {
  const { matches, teams, participants, records, recordPlayers, transaction } = repos;

  function getActiveMatch(guildId) {
    return matches.findActiveByGuild(guildId);
  }

  function requireActiveMatch(guildId) {
    const match = getActiveMatch(guildId);
    if (!match) {
      throw new UserError('진행 중인 대전이 없습니다. [대전 등록] 버튼으로 대전을 먼저 등록해 주세요.');
    }
    return match;
  }

  /**
   * 버튼에 담긴 대전 ID가 지금 진행 중인 대전인지 확인한다.
   * (이미 끝난 대전의 옛 메시지 버튼을 누른 경우를 막는다)
   */
  function requireActiveMatchById(guildId, matchId) {
    const match = requireActiveMatch(guildId);
    if (matchId != null && match.id !== Number(matchId)) {
      throw new UserError('이미 종료되었거나 취소된 대전입니다. 진행 중인 대전 메시지를 이용해 주세요.');
    }
    return match;
  }

  function requireRecruiting(match) {
    if (match.status !== MATCH_STATUS.RECRUITING) {
      throw new UserError('대전이 이미 시작되어 참가자나 포지션을 바꿀 수 없습니다.');
    }
  }

  function requireInProgress(match) {
    if (match.status !== MATCH_STATUS.IN_PROGRESS) {
      throw new UserError('진행 중인 대전에서만 할 수 있습니다. 먼저 [대전 시작]을 눌러 주세요.');
    }
  }

  function requireParticipant(match, memberId) {
    const participant = participants.findByMatchAndMember(match.id, memberId);
    if (!participant) {
      throw new UserError('이번 대전에 참가하지 않았습니다. 먼저 [대전 참가]를 눌러 주세요.');
    }
    return participant;
  }

  /** 대전을 관리할 수 있는지: 서버 관리자이거나 대전을 등록한 사람 */
  function canManage(match, member, isAdmin) {
    return Boolean(isAdmin) || (member != null && match.created_by === member.id);
  }

  function requireManager(match, member, isAdmin) {
    if (!canManage(match, member, isAdmin)) {
      throw new UserError('권한이 없습니다. 대전 시작/팀 셔플/기록/종료는 관리자 또는 대전 등록자만 할 수 있습니다.');
    }
  }

  function getTeams(matchId) {
    const bySide = {};
    for (const t of teams.findByMatch(matchId)) bySide[t.side] = t;
    return bySide;
  }

  /** 판별 기록 + 참가자 전적(팀 · K/D/A · CS · 승패) + 승리자 디스코드 ID 목록 */
  function getGames(matchId) {
    const players = recordPlayers.findByMatch(matchId);
    return records.findByMatch(matchId).map((r) => {
      const list = players.filter((p) => p.record_id === r.id);
      const winners = list.filter((p) => p.is_win);
      return {
        ...r,
        players: list,
        winnerSide: winners[0]?.side ?? null,
        winnerDiscordUserIds: winners.map((p) => p.discord_user_id),
      };
    });
  }

  /**
   * 피어리스: 이 대전에서 이미 사용된 챔피언 (판 순서대로)
   * @returns {{ champion: string, key: string, gameNo: number, discordUserId: string, side: string }[]}
   */
  function usedChampionList(games) {
    const list = [];
    for (const g of games) {
      for (const p of g.players) {
        if (!p.champion) continue;
        list.push({
          champion: p.champion,
          key: championKey(p.champion),
          gameNo: g.game_no,
          discordUserId: p.discord_user_id,
          side: p.side,
        });
      }
    }
    return list;
  }

  /** 피어리스 표시용: 서버 회원별로 판 순서대로 플레이한 챔피언 목록 */
  function championsByMember(games) {
    const map = {};
    for (const g of games) {
      for (const p of g.players) {
        if (!p.champion) continue;
        (map[p.guild_member_id] ||= []).push(p.champion);
      }
    }
    return map;
  }

  /** 팀 구성이 1팀 5명 · 2팀 5명으로 끝났는지 */
  function requireFullTeams(list) {
    const red = list.filter((p) => p.side === 'RED');
    const blue = list.filter((p) => p.side === 'BLUE');
    if (red.length !== TEAM_SIZE || blue.length !== TEAM_SIZE) {
      throw new UserError(
        `팀 구성이 끝나야 합니다. (1팀 ${red.length}/${TEAM_SIZE}, 2팀 ${blue.length}/${TEAM_SIZE}) ` +
          '[팀 등록/변경] 또는 관리 패널의 [팀 랜덤 셔플]로 팀을 나눠 주세요.',
      );
    }
    // 입력 양식과 같은 순서를 보장하기 위해 참가 순서(id)로 정렬한다.
    const byId = (a, b) => a.id - b.id;
    return { red: red.sort(byId), blue: blue.sort(byId) };
  }

  /** 대전의 현재 상태(참가자, 팀 구성, 판별 기록)를 한 번에 조회한다. */
  function getMatchView(matchId) {
    const match = matches.findById(matchId);
    if (!match) return null;
    const list = participants.findByMatchWithDetails(matchId);
    const creator = list.find((p) => p.guild_member_id === match.created_by) || null;
    const games = getGames(matchId);
    return {
      match,
      creatorDiscordUserId: creator?.discord_user_id ?? null,
      participants: list,
      red: list.filter((p) => p.side === 'RED'),
      blue: list.filter((p) => p.side === 'BLUE'),
      unassigned: list.filter((p) => !p.side),
      games,
      champions: championsByMember(games),
      usedChampions: usedChampionList(games),
    };
  }

  /** 서버에 진행 중인 대전이 없고 등록 가능한지 미리 확인한다. (버튼 → 판 수 선택 전) */
  function checkCanCreate({ guildId, discordUserId }) {
    const member = accounts.getActiveMember(guildId, discordUserId);
    requireAccountGameName(member);
    if (getActiveMatch(guildId)) {
      throw new UserError('이 서버에는 이미 진행 중인 대전이 있습니다. 서버마다 대전은 하나만 진행할 수 있습니다.');
    }
    return member;
  }

  /** 계정에 등록된 롤 아이디 (대전 참가에 필요) */
  function requireAccountGameName(member) {
    if (!member.game_name) {
      throw new UserError('계정에 롤 아이디가 없습니다. 계정관리 채널의 [아이디 변경]으로 롤 아이디를 먼저 등록해 주세요.');
    }
    return member.game_name;
  }

  /**
   * 참가자 추가. 롤 아이디는 계정에 등록된 아이디를 쓰고, 포지션을 고르지 않으면(undefined) 선호 포지션을 쓴다.
   */
  function addParticipant(match, member, position) {
    const gameName = requireAccountGameName(member);
    const pos = position === undefined ? member.preferred_position ?? null : normalizePosition(position);
    const participantId = participants.insert(match.id, member.id, gameName);
    if (pos) participants.updatePosition(participantId, pos);
    participants.resetShuffledByMatch(match.id);
  }

  /**
   * 대전 등록: 판 수(1~10)를 정하고, 등록자는 자동으로 참가한다.
   * @returns {object} match
   */
  const createMatch = transaction(({ guildId, discordUserId, channelId, gameCount, position }) => {
    const count = Number(gameCount);
    if (!Number.isInteger(count) || count < MIN_GAMES || count > MAX_GAMES) {
      throw new UserError(`판 수는 ${MIN_GAMES}~${MAX_GAMES}판 중에서 골라 주세요.`);
    }
    const member = checkCanCreate({ guildId, discordUserId });
    requireAccountGameName(member);
    const matchId = matches.insert(guildId, channelId, member.id, count);
    for (const side of SIDES) teams.insert(matchId, side);
    const match = matches.findById(matchId);
    addParticipant(match, member, position);
    return match;
  });

  /** 공개 대전 정보 메시지 위치 저장 */
  function setMatchMessage(matchId, channelId, messageId) {
    matches.updateMessage(matchId, channelId, messageId);
  }

  /** 참가 가능한지 미리 확인한다. (버튼 → 아이디 입력창 띄우기 전) */
  function checkCanJoin({ guildId, discordUserId, matchId = null }) {
    const member = accounts.getActiveMember(guildId, discordUserId);
    requireAccountGameName(member);
    const match = requireActiveMatchById(guildId, matchId);
    requireRecruiting(match);
    if (participants.findByMatchAndMember(match.id, member.id)) {
      throw new UserError('이미 이번 대전에 참가했습니다.');
    }
    if (participants.countByMatch(match.id) >= MATCH_SIZE) {
      throw new UserError(`대전 인원(${MATCH_SIZE}명)이 모두 찼습니다.`);
    }
    return { member, match };
  }

  /**
   * 대전 참가. 롤 아이디는 계정에 등록된 아이디를 쓴다.
   * position을 생략하면(undefined) 선호 포지션, null이면 미정.
   * @returns {{ match: object, count: number }}
   */
  const join = transaction(({ guildId, discordUserId, matchId = null, position }) => {
    const { member, match } = checkCanJoin({ guildId, discordUserId, matchId });
    addParticipant(match, member, position);
    return { match, count: participants.countByMatch(match.id) };
  });

  /** 대전 탈퇴 */
  const leave = transaction(({ guildId, discordUserId, matchId = null }) => {
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = requireActiveMatchById(guildId, matchId);
    requireRecruiting(match);
    const participant = requireParticipant(match, member.id);
    participants.delete(participant.id);
    participants.resetShuffledByMatch(match.id);
    return { match, count: participants.countByMatch(match.id) };
  });

  /** 포지션 등록/변경. position이 null이면 선택을 해제한다. */
  const setPosition = transaction(({ guildId, discordUserId, position, matchId = null }) => {
    if (position !== null && !POSITIONS.includes(position)) {
      throw new UserError('알 수 없는 포지션입니다.');
    }
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = requireActiveMatchById(guildId, matchId);
    requireRecruiting(match);
    const participant = requireParticipant(match, member.id);
    participants.updatePosition(participant.id, position);
    return { match };
  });

  /** 관리 권한 확인 (대전 관리 버튼). 서버 회원이 아니어도 관리자는 통과한다. */
  function checkManager({ guildId, discordUserId, matchId = null, isAdmin = false }) {
    const match = requireActiveMatchById(guildId, matchId);
    const member = isAdmin ? null : accounts.getActiveMember(guildId, discordUserId);
    requireManager(match, member, isAdmin);
    return match;
  }

  /** 대전 시작: 참가자가 10명이고 1팀 5명 · 2팀 5명으로 나뉘어 있어야 한다. (판별 기록에 팀이 필요) */
  const start = transaction(({ guildId, discordUserId, matchId = null, isAdmin = false }) => {
    const match = checkManager({ guildId, discordUserId, matchId, isAdmin });
    requireRecruiting(match);
    const list = participants.findByMatchWithDetails(match.id);
    if (list.length !== MATCH_SIZE) {
      throw new UserError(`참가자가 ${MATCH_SIZE}명이어야 시작할 수 있습니다. (현재 ${list.length}명)`);
    }
    requireFullTeams(list);
    matches.updateStatus(match.id, MATCH_STATUS.IN_PROGRESS);
    return getMatchView(match.id);
  });

  /** 다음에 기록할 판 번호를 확인한다. (대전 기록 버튼 → 입력창 띄우기 전) */
  function checkCanRecord({ guildId, discordUserId, matchId = null, isAdmin = false }) {
    const match = checkManager({ guildId, discordUserId, matchId, isAdmin });
    requireInProgress(match);
    // 다음에 기록할 판 = 아직 기록되지 않은 가장 작은 판 번호
    // (관리자가 /관리자 데이터적재로 뒤의 판을 먼저 넣었을 수 있다)
    const done = new Set(records.findByMatch(match.id).map((r) => r.game_no));
    let next = 1;
    while (done.has(next)) next += 1;
    if (next > match.game_count) {
      throw new UserError(`등록한 ${match.game_count}판을 모두 기록했습니다. [대전 종료]를 눌러 주세요.`);
    }
    const list = participants.findByMatchWithDetails(match.id);
    const { red, blue } = requireFullTeams(list);
    return {
      match,
      gameNo: next,
      participants: list,
      red,
      blue,
      signature: teamSignature(red, blue),
      usedChampions: usedChampionList(getGames(match.id)),
    };
  }

  function recordedByMemberId(guildId, discordUserId) {
    return accounts.findAnyMember(guildId, discordUserId)?.id ?? null;
  }

  /**
   * 판 기록: 결과 캡쳐 + 승리팀 + 참가자 10명의 K/D/A/CS. 승리팀 1명당 승점 1점.
   * @param {{
   *   gameNo: number,
   *   winnerSide: 'RED'|'BLUE',
   *   stats: { participantId: number, kills: number, deaths: number, assists: number, cs: number }[],
   *   screenshotPath: string|null,
   * }} params
   */
  const recordGame = transaction(
    ({
      guildId,
      discordUserId,
      matchId = null,
      isAdmin = false,
      gameNo,
      signature = null,
      winnerSide,
      stats,
      screenshotPath = null,
    }) => {
      if (!SIDES.includes(winnerSide)) throw new UserError('승리팀을 골라 주세요.');
      const { match, gameNo: expected, red, blue, signature: current, usedChampions } = checkCanRecord({
        guildId,
        discordUserId,
        matchId,
        isAdmin,
      });
      if (gameNo != null && Number(gameNo) !== expected) {
        throw new UserError(`${gameNo}판은 이미 기록되었습니다. 다시 [대전 기록]을 눌러 주세요.`);
      }
      if (signature != null && signature !== current) {
        throw new UserError('입력창을 연 뒤 팀 구성이 바뀌었습니다. (팀 셔플 등) 다시 [대전 기록]을 눌러 주세요.');
      }
      const players = [...red, ...blue];
      const byParticipant = new Map((stats || []).map((s) => [Number(s.participantId), s]));
      for (const p of players) {
        const st = byParticipant.get(p.id);
        const values = st && [st.kills, st.deaths, st.assists, st.cs];
        if (!values || values.some((v) => !Number.isInteger(v) || v < 0)) {
          throw new UserError('참가자 10명의 킬/데스/어시/CS를 모두 입력해 주세요.');
        }
      }
      if (byParticipant.size !== players.length) {
        throw new UserError('대전 참가자만 기록할 수 있습니다.');
      }
      // 챔피언: 필수. 피어리스 - 이 대전의 이전 판에서 누구든 사용한 챔피언은 다시 쓸 수 없고,
      //         한 판 안에서도 같은 챔피언을 두 명이 할 수 없다.
      const used = new Map(usedChampions.map((u) => [u.key, u]));
      const seen = new Map();
      for (const p of players) {
        const champion = normalizeChampion(byParticipant.get(p.id).champion);
        if (!champion) throw new UserError('참가자 10명의 챔피언을 모두 입력해 주세요.');
        const key = championKey(champion);
        if (used.has(key)) {
          const u = used.get(key);
          throw new UserError(
            `피어리스: ${champion}은(는) ${u.gameNo}판에서 이미 사용한 챔피언이라 이 대전에서는 다시 쓸 수 없습니다. ` +
              `(${p.display_name || p.discord_user_id}님의 챔피언을 확인해 주세요)`,
          );
        }
        if (seen.has(key)) {
          throw new UserError(`한 판에서 같은 챔피언(${champion})을 두 명이 할 수 없습니다. 챔피언을 확인해 주세요.`);
        }
        seen.set(key, p);
        byParticipant.get(p.id).champion = champion;
      }

      const recordId = records.insert({
        matchId: match.id,
        gameNo: expected,
        winnerTeamId: getTeams(match.id)[winnerSide].id,
        screenshotPath,
        recordedBy: recordedByMemberId(guildId, discordUserId),
      });
      for (const p of players) {
        const st = byParticipant.get(p.id);
        recordPlayers.insert({
          recordId,
          guildMemberId: p.guild_member_id,
          side: p.side,
          gameName: p.game_name,
          position: p.position,
          champion: st.champion,
          kills: st.kills,
          deaths: st.deaths,
          assists: st.assists,
          cs: st.cs,
          isWin: p.side === winnerSide,
        });
      }
      return { match, gameNo: expected, recordId };
    },
  );

  /** 대전 종료: 기록된 판까지 승점에 반영된다. */
  const finish = transaction(({ guildId, discordUserId, matchId = null, isAdmin = false }) => {
    const match = checkManager({ guildId, discordUserId, matchId, isAdmin });
    requireInProgress(match);
    matches.updateStatus(match.id, MATCH_STATUS.FINISHED);
    return getMatchView(match.id);
  });

  /** 대전 취소 (기록은 승점에 반영되지 않는다) */
  const cancel = transaction(({ guildId, discordUserId, matchId = null, isAdmin = false }) => {
    const match = checkManager({ guildId, discordUserId, matchId, isAdmin });
    matches.updateStatus(match.id, MATCH_STATUS.CANCELED);
    return getMatchView(match.id);
  });

  return {
    getActiveMatch,
    requireActiveMatch,
    requireActiveMatchById,
    requireRecruiting,
    requireParticipant,
    canManage,
    getTeams,
    getMatchView,
    checkCanCreate,
    createMatch,
    setMatchMessage,
    checkCanJoin,
    join,
    leave,
    setPosition,
    checkManager,
    start,
    checkCanRecord,
    recordGame,
    finish,
    cancel,
  };
}

module.exports = { createMatchService, normalizeGameName, normalizePosition, teamSignature };
