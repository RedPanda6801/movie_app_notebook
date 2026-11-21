const { POINTS_PER_WIN } = require('../constants');
const { UserError } = require('../utils/errors');

/**
 * 대전관리 서비스 - 개인별 승점 조회.
 * 승점 = 승리 횟수 x 1점 (감점 없음). 서버(guild)별로 따로 계산한다.
 */
function createPointService(repos, accountService) {
  const { recordPlayers, guildMembers } = repos;

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
    const member = accountService.findAnyMember(guildId, discordUserId);
    if (!member) throw new UserError('이 서버에 등록된 적이 없는 사용자입니다.');
    return { member, ...toStats(recordPlayers.getSummaryByMember(member.id)) };
  }

  /** 서버 승점 랭킹 */
  function getRanking(guildId, limit = 10) {
    return guildMembers.findRankingByGuild(guildId, limit).map((row) => ({
      discordUserId: row.discord_user_id,
      displayName: row.display_name,
      ...toStats(row),
    }));
  }

  return { getStats, getRanking };
}

module.exports = { createPointService };
