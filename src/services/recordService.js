const { POINTS_PER_WIN } = require('../constants');
const { UserError } = require('../utils/errors');

/** 전적 조회 시 대전 선택 메뉴에 보여줄 최대 개수 (디스코드 선택 메뉴 한도 25) */
const MATCH_LIST_LIMIT = 25;
/** 개인별 전적에서 보여줄 최근 판 수 */
const RECENT_GAMES_LIMIT = 10;

/**
 * 합계 행을 전적 요약으로 바꾼다.
 * KDA = (킬 + 어시) / 데스 (데스 0이면 킬 + 어시), 평균은 K/D/A/CS가 입력된 판 기준.
 */
function summarize(row) {
  const games = row.games || 0;
  const wins = row.wins || 0;
  const statGames = row.stat_games || 0;
  const kda = statGames ? (row.kills + row.assists) / Math.max(1, row.deaths) : null;
  return {
    games,
    wins,
    losses: games - wins,
    winRate: games ? Math.round((wins / games) * 100) : 0,
    points: wins * POINTS_PER_WIN,
    kills: row.kills || 0,
    deaths: row.deaths || 0,
    assists: row.assists || 0,
    cs: row.cs || 0,
    statGames,
    kda,
    avgKills: statGames ? row.kills / statGames : null,
    avgDeaths: statGames ? row.deaths / statGames : null,
    avgAssists: statGames ? row.assists / statGames : null,
    avgCs: statGames ? row.cs / statGames : null,
  };
}

/** 판별 행 목록을 참가자별로 합산한다. */
function aggregateByMember(rows) {
  const map = new Map();
  for (const r of rows) {
    const cur = map.get(r.guild_member_id) || {
      discord_user_id: r.discord_user_id,
      display_name: r.display_name,
      game_name: r.game_name,
      side: r.side,
      games: 0,
      wins: 0,
      kills: 0,
      deaths: 0,
      assists: 0,
      cs: 0,
      stat_games: 0,
      champions: [],
    };
    cur.games += 1;
    if (r.champion) cur.champions.push(r.champion);
    cur.wins += r.is_win ? 1 : 0;
    if (r.kills != null) {
      cur.kills += r.kills;
      cur.deaths += r.deaths;
      cur.assists += r.assists;
      cur.cs += r.cs;
      cur.stat_games += 1;
    }
    map.set(r.guild_member_id, cur);
  }
  return [...map.values()].map((m) => ({ ...m, summary: summarize(m) }));
}

/**
 * 전적관리 서비스 - 대전관리의 [대전 기록]으로 쌓인 판별 기록을 조회한다.
 * 개인별/전체 전적은 종료된 대전만, 대전별 전적은 진행 중인 대전도 볼 수 있다.
 */
function createRecordService(repos, accounts) {
  const { matches, records, recordPlayers } = repos;

  /** 전적을 볼 수 있는 대전 목록 (진행 중 + 종료, 최신순) */
  function listMatches(guildId) {
    return matches.findRecentWithRecordsByGuild(guildId, MATCH_LIST_LIMIT);
  }

  /** 대전별 전적: 참가자별 합계 + 판별 상세 */
  function getMatchRecords(guildId, matchId) {
    const match = matches.findById(Number(matchId));
    if (!match || match.guild_id !== guildId) throw new UserError('대전을 찾을 수 없습니다.');
    const rows = recordPlayers.findByMatch(match.id);
    const games = records.findByMatch(match.id).map((r) => {
      const players = rows.filter((p) => p.record_id === r.id);
      return { ...r, players, winnerSide: players.find((p) => p.is_win)?.side ?? null };
    });
    return { match, games, members: aggregateByMember(rows) };
  }

  /** 개인별 전적: 요약 + 최근 판 */
  function getMemberRecords(guildId, discordUserId) {
    const member = accounts.findAnyMember(guildId, discordUserId);
    if (!member) throw new UserError('이 서버에 등록된 적이 없는 계정입니다.');
    return {
      member,
      summary: summarize(recordPlayers.getSummaryByMember(member.id)),
      recent: recordPlayers.findRecentByMember(member.id, RECENT_GAMES_LIMIT),
    };
  }

  /** 전체 전적: 계정별 요약 + 모든 계정의 판별 기록 */
  function getGuildRecords(guildId) {
    return {
      members: recordPlayers.getSummaryByGuild(guildId).map((row) => ({ ...row, summary: summarize(row) })),
      rows: recordPlayers.findAllByGuild(guildId),
    };
  }

  return { listMatches, getMatchRecords, getMemberRecords, getGuildRecords };
}

module.exports = { createRecordService, summarize, aggregateByMember };
