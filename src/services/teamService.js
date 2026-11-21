const { MATCH_SIZE, TEAM_SIZE, SIDES } = require('../constants');
const { UserError } = require('../utils/errors');
const { shuffleTeams } = require('./shuffle');

/**
 * 대전관리 서비스 - 팀 관리 (팀 등록, 팀 탈퇴, 팀 자동셔플)
 */
function createTeamService(repos, accounts, matches, random = Math.random) {
  const { participants, transaction } = repos;

  function context(guildId, discordUserId, matchId = null) {
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = matches.requireActiveMatchById(guildId, matchId);
    matches.requireRecruiting(match);
    const participant = matches.requireParticipant(match, member.id);
    return { member, match, participant };
  }

  /** 팀 등록: 원하는 팀을 직접 고른다. 고른 사람은 셔플 대상에서 빠진다. */
  const joinTeam = transaction(({ guildId, discordUserId, side }) => {
    if (!SIDES.includes(side)) throw new UserError('알 수 없는 팀입니다.');
    const { match, participant } = context(guildId, discordUserId);
    const team = matches.getTeams(match.id)[side];
    if (participant.team_id === team.id && participant.is_team_locked) {
      throw new UserError('이미 이 팀에 등록되어 있습니다.');
    }
    if (participants.countLockedByTeam(team.id) >= TEAM_SIZE) {
      throw new UserError(`이 팀은 이미 ${TEAM_SIZE}명이 등록되어 있습니다.`);
    }
    participants.lockTeam(participant.id, team.id);
    // 팀 직접 등록자가 바뀌면 기존 셔플 결과는 무효가 된다.
    participants.resetShuffledByMatch(match.id);
    return { match };
  });

  /** 팀 탈퇴: 팀 배정을 해제하고 다시 셔플 대상이 된다. */
  const leaveTeam = transaction(({ guildId, discordUserId }) => {
    const { match, participant } = context(guildId, discordUserId);
    if (!participant.team_id) {
      throw new UserError('소속된 팀이 없습니다.');
    }
    participants.unlockTeam(participant.id);
    participants.resetShuffledByMatch(match.id);
    return { match };
  });

  /**
   * 팀 등록/변경 (버튼용): side = 'RED'(1팀) | 'BLUE'(2팀) | null(미정)
   * - 팀을 고르면 셔플 대상에서 빠지고 그 팀에 고정된다.
   * - 미정을 고르면 팀 배정이 풀리고 다시 셔플 대상이 된다.
   */
  const setTeam = transaction(({ guildId, discordUserId, matchId = null, side }) => {
    if (side !== null && !SIDES.includes(side)) throw new UserError('알 수 없는 팀입니다.');
    const { match, participant } = context(guildId, discordUserId, matchId);
    if (side === null) {
      if (participant.team_id) {
        participants.unlockTeam(participant.id);
        participants.resetShuffledByMatch(match.id);
      }
      return { match, side: null };
    }
    const team = matches.getTeams(match.id)[side];
    if (participant.team_id === team.id && participant.is_team_locked) {
      return { match, side }; // 이미 같은 팀
    }
    if (participants.countLockedByTeam(team.id) >= TEAM_SIZE) {
      throw new UserError(`이 팀은 이미 ${TEAM_SIZE}명이 등록되어 있습니다.`);
    }
    participants.lockTeam(participant.id, team.id);
    participants.resetShuffledByMatch(match.id);
    return { match, side };
  });

  /** 팀 자동셔플: 관리자 또는 대전 등록자만, 참가자가 10명일 때만 사용할 수 있다. */
  const shuffle = transaction(({ guildId, discordUserId, matchId = null, isAdmin = false }) => {
    const match = matches.checkManager({ guildId, discordUserId, matchId, isAdmin });
    matches.requireRecruiting(match);
    const list = matches.getMatchView(match.id).participants;
    if (list.length !== MATCH_SIZE) {
      throw new UserError(
        `팀 자동셔플은 대전에 ${MATCH_SIZE}명이 등록되어 있어야 사용할 수 있습니다. (현재 ${list.length}명)`,
      );
    }
    const teams = matches.getTeams(match.id);
    const assignment = shuffleTeams(
      list.map((p) => ({
        id: p.id,
        position: p.position,
        lockedSide: p.is_team_locked ? p.side : null,
      })),
      random,
    );
    for (const p of list) {
      if (!p.is_team_locked) participants.assignTeam(p.id, teams[assignment.get(p.id)].id);
    }
    return matches.getMatchView(match.id);
  });

  return { joinTeam, leaveTeam, setTeam, shuffle };
}

module.exports = { createTeamService };
