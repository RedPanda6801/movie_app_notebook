const { POINTS_PER_WIN } = require('../constants');
const { UserError } = require('../utils/errors');

/**
 * 대전관리 서비스 - 개인별 승점 조회.
 * 승점 = 승리 횟수 x 1점 (감점 없음). 서버(guild)별로 따로 계산한다.
 */
function createPointService(db, accounts) {
  const STATS_SQL = `
    SELECT COUNT(m.id) AS games,
           COUNT(r.id) AS wins
      FROM match_participant mp
      JOIN match m ON m.id = mp.match_id AND m.status = 'FINISHED'
      LEFT JOIN match_record r ON r.match_id = mp.match_id AND r.winner_team_id = mp.team_id
     WHERE mp.guild_member_id = ?`;
  const statsStmt = db.prepare(STATS_SQL);

  const rankingStmt = db.prepare(`
    SELECT a.discord_user_id, gm.display_name,
           COUNT(m.id) AS games,
           COUNT(r.id) AS wins
      FROM guild_member gm
      JOIN account a ON a.id = gm.account_id
      LEFT JOIN match_participant mp ON mp.guild_member_id = gm.id
      LEFT JOIN match m ON m.id = mp.match_id AND m.status = 'FINISHED'
      LEFT JOIN match_record r ON r.match_id = m.id AND r.winner_team_id = mp.team_id
     WHERE gm.guild_id = ? AND gm.status = 'ACTIVE'
     GROUP BY gm.id
     ORDER BY wins DESC, games ASC, gm.registered_at ASC
     LIMIT ?`);

  function toStats(row) {
    return {
      games: row.games,
      wins: row.wins,
      losses: row.games - row.wins,
      points: row.wins * POINTS_PER_WIN,
    };
  }

  /** 개인 승점 조회 (탈퇴한 회원도 기록은 남아 있으므로 조회 가능) */
  function getStats(guildId, discordUserId) {
    const member = accounts.findAnyMember(guildId, discordUserId);
    if (!member) throw new UserError('이 서버에 등록된 적이 없는 사용자입니다.');
    return { member, ...toStats(statsStmt.get(member.id)) };
  }

  /** 서버 승점 랭킹 */
  function getRanking(guildId, limit = 10) {
    return rankingStmt.all(guildId, limit).map((row) => ({
      discordUserId: row.discord_user_id,
      displayName: row.display_name,
      ...toStats(row),
    }));
  }

  return { getStats, getRanking };
}

module.exports = { createPointService };
