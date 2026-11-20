const { MATCH_SIZE, TEAM_SIZE, SIDES } = require('../constants');
const { UserError } = require('../utils/errors');
const { shuffleTeams } = require('./shuffle');

/**
 * 대전관리 서비스 - 팀 관리 (팀 등록, 팀 탈퇴, 팀 자동셔플)
 */
function createTeamService(db, accounts, matches, random = Math.random) {
  const lockedCount = db.prepare(
    'SELECT COUNT(*) AS n FROM match_participant WHERE team_id = ? AND is_team_locked = 1',
  );
  const lockTeam = db.prepare(
    'UPDATE match_participant SET team_id = ?, is_team_locked = 1 WHERE id = ?',
  );
  const unlockTeam = db.prepare(
    'UPDATE match_participant SET team_id = NULL, is_team_locked = 0 WHERE id = ?',
  );
  const assignTeam = db.prepare('UPDATE match_participant SET team_id = ? WHERE id = ?');
  const resetShuffled = db.prepare(
    'UPDATE match_participant SET team_id = NULL WHERE match_id = ? AND is_team_locked = 0',
  );

  function context(guildId, discordUserId) {
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = matches.requireActiveMatch(guildId);
    matches.requireRecruiting(match);
    const participant = matches.requireParticipant(match, member.id);
    return { member, match, participant };
  }

  /** 팀 등록: 원하는 팀을 직접 고른다. 고른 사람은 셔플 대상에서 빠진다. */
  const joinTeam = db.transaction(({ guildId, discordUserId, side }) => {
    if (!SIDES.includes(side)) throw new UserError('알 수 없는 팀입니다.');
    const { match, participant } = context(guildId, discordUserId);
    const team = matches.getTeams(match.id)[side];
    if (participant.team_id === team.id && participant.is_team_locked) {
      throw new UserError('이미 이 팀에 등록되어 있습니다.');
    }
    const { n } = lockedCount.get(team.id);
    if (n >= TEAM_SIZE) {
      throw new UserError(`이 팀은 이미 ${TEAM_SIZE}명이 등록되어 있습니다.`);
    }
    lockTeam.run(team.id, participant.id);
    // 팀 직접 등록자가 바뀌면 기존 셔플 결과는 무효가 된다.
    resetShuffled.run(match.id);
    return { match };
  });

  /** 팀 탈퇴: 팀 배정을 해제하고 다시 셔플 대상이 된다. */
  const leaveTeam = db.transaction(({ guildId, discordUserId }) => {
    const { match, participant } = context(guildId, discordUserId);
    if (!participant.team_id) {
      throw new UserError('소속된 팀이 없습니다.');
    }
    unlockTeam.run(participant.id);
    resetShuffled.run(match.id);
    return { match };
  });

  /** 팀 자동셔플: 참가자가 10명일 때만 사용할 수 있다. */
  const shuffle = db.transaction(({ guildId, discordUserId }) => {
    accounts.getActiveMember(guildId, discordUserId);
    const match = matches.requireActiveMatch(guildId);
    matches.requireRecruiting(match);
    const { participants } = matches.getMatchView(match.id);
    if (participants.length !== MATCH_SIZE) {
      throw new UserError(
        `팀 자동셔플은 대전에 ${MATCH_SIZE}명이 등록되어 있어야 사용할 수 있습니다. (현재 ${participants.length}명)`,
      );
    }
    const teams = matches.getTeams(match.id);
    const assignment = shuffleTeams(
      participants.map((p) => ({
        id: p.id,
        position: p.position,
        lockedSide: p.is_team_locked ? p.side : null,
      })),
      random,
    );
    for (const p of participants) {
      if (!p.is_team_locked) assignTeam.run(teams[assignment.get(p.id)].id, p.id);
    }
    return matches.getMatchView(match.id);
  });

  return { joinTeam, leaveTeam, shuffle };
}

module.exports = { createTeamService };
