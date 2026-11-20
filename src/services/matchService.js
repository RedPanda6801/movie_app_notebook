const { MATCH_SIZE, TEAM_SIZE, MATCH_STATUS, POSITIONS, SIDES } = require('../constants');
const { UserError } = require('../utils/errors');

/**
 * 대전관리 서비스 - 대전 생성/종료와 사용자 관리(대전 등록, 대전 탈퇴, 포지션 선택).
 * 서버(guild)당 진행 중인 대전은 1개만 존재한다.
 */
function createMatchService(repos, accounts) {
  const { matches, teams, participants, records, transaction } = repos;

  function getActiveMatch(guildId) {
    return matches.findActiveByGuild(guildId);
  }

  function requireActiveMatch(guildId) {
    const match = getActiveMatch(guildId);
    if (!match) {
      throw new UserError('진행 중인 대전이 없습니다. `/대전 생성` 또는 `/대전 참가`로 대전을 시작해 주세요.');
    }
    return match;
  }

  function requireRecruiting(match) {
    if (match.status !== MATCH_STATUS.RECRUITING) {
      throw new UserError('대전이 이미 시작되어 참가자나 팀을 바꿀 수 없습니다.');
    }
  }

  function requireParticipant(match, memberId) {
    const participant = participants.findByMatchAndMember(match.id, memberId);
    if (!participant) {
      throw new UserError('이번 대전에 참가하지 않았습니다. 먼저 `/대전 참가`를 해 주세요.');
    }
    return participant;
  }

  function getTeams(matchId) {
    const bySide = {};
    for (const t of teams.findByMatch(matchId)) bySide[t.side] = t;
    return bySide;
  }

  /** 대전의 현재 상태(참가자, 팀 구성, 기록)를 한 번에 조회한다. */
  function getMatchView(matchId) {
    const match = matches.findById(matchId);
    if (!match) return null;
    const list = participants.findByMatchWithDetails(matchId);
    return {
      match,
      participants: list,
      red: list.filter((p) => p.side === 'RED'),
      blue: list.filter((p) => p.side === 'BLUE'),
      unassigned: list.filter((p) => !p.side),
      record: records.findByMatchWithSide(matchId),
    };
  }

  function insertMatch(guildId, channelId, memberId) {
    const matchId = matches.insert(guildId, channelId, memberId);
    for (const side of SIDES) teams.insert(matchId, side);
    return matches.findById(matchId);
  }

  /** 대전 생성 (서버당 1개) */
  const createMatch = transaction(({ guildId, discordUserId, channelId }) => {
    const member = accounts.getActiveMember(guildId, discordUserId);
    if (getActiveMatch(guildId)) {
      throw new UserError('이 서버에는 이미 진행 중인 대전이 있습니다. 서버마다 대전은 하나만 진행할 수 있습니다.');
    }
    return insertMatch(guildId, channelId, member.id);
  });

  /**
   * 대전 등록. 진행 중인 대전이 없으면 자동으로 새 대전을 만든다.
   * @returns {{ match: object, created: boolean, count: number }}
   */
  const join = transaction(({ guildId, discordUserId, channelId }) => {
    const member = accounts.getActiveMember(guildId, discordUserId);
    let match = getActiveMatch(guildId);
    let created = false;
    if (!match) {
      match = insertMatch(guildId, channelId, member.id);
      created = true;
    }
    requireRecruiting(match);
    if (participants.findByMatchAndMember(match.id, member.id)) {
      throw new UserError('이미 이번 대전에 참가했습니다.');
    }
    const n = participants.countByMatch(match.id);
    if (n >= MATCH_SIZE) {
      throw new UserError(`대전 인원(${MATCH_SIZE}명)이 모두 찼습니다.`);
    }
    participants.insert(match.id, member.id);
    participants.resetShuffledByMatch(match.id);
    return { match, created, count: n + 1 };
  });

  /** 대전 탈퇴 */
  const leave = transaction(({ guildId, discordUserId }) => {
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = requireActiveMatch(guildId);
    requireRecruiting(match);
    const participant = requireParticipant(match, member.id);
    participants.delete(participant.id);
    participants.resetShuffledByMatch(match.id);
    return { match, count: participants.countByMatch(match.id) };
  });

  /** 포지션 선택. position이 null이면 선택을 해제한다. */
  const setPosition = transaction(({ guildId, discordUserId, position }) => {
    if (position !== null && !POSITIONS.includes(position)) {
      throw new UserError('알 수 없는 포지션입니다.');
    }
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = requireActiveMatch(guildId);
    requireRecruiting(match);
    const participant = requireParticipant(match, member.id);
    participants.updatePosition(participant.id, position);
    return { match };
  });

  /** 대전을 관리할 수 있는지: 대전을 만든 사람이거나 서버 관리 권한이 있는 사람 */
  function requireManager(match, member, isServerManager) {
    if (!isServerManager && match.created_by !== member.id) {
      throw new UserError('대전을 만든 사람 또는 서버 관리자만 할 수 있습니다.');
    }
  }

  /** 대전 시작: 10명 + 레드/블루 5:5 구성이 끝나야 한다. */
  const start = transaction(({ guildId, discordUserId, isServerManager = false }) => {
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = requireActiveMatch(guildId);
    requireRecruiting(match);
    requireManager(match, member, isServerManager);
    const view = getMatchView(match.id);
    if (view.participants.length !== MATCH_SIZE) {
      throw new UserError(`참가자가 ${MATCH_SIZE}명이어야 시작할 수 있습니다. (현재 ${view.participants.length}명)`);
    }
    if (view.red.length !== TEAM_SIZE || view.blue.length !== TEAM_SIZE) {
      throw new UserError('팀 구성이 끝나지 않았습니다. `/팀 셔플`로 팀을 나눠 주세요.');
    }
    matches.updateStatus(match.id, MATCH_STATUS.IN_PROGRESS);
    return getMatchView(match.id);
  });

  /** 대전 결과 기록 (승리팀 1인당 승점 1점) */
  const finish = transaction(({ guildId, discordUserId, winnerSide, isServerManager = false }) => {
    if (!SIDES.includes(winnerSide)) throw new UserError('알 수 없는 팀입니다.');
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = requireActiveMatch(guildId);
    if (match.status !== MATCH_STATUS.IN_PROGRESS) {
      throw new UserError('진행 중인 대전만 결과를 기록할 수 있습니다. 먼저 `/대전 시작`을 해 주세요.');
    }
    requireManager(match, member, isServerManager);
    records.insert(match.id, getTeams(match.id)[winnerSide].id);
    matches.updateStatus(match.id, MATCH_STATUS.FINISHED);
    return getMatchView(match.id);
  });

  /** 대전 취소 */
  const cancel = transaction(({ guildId, discordUserId, isServerManager = false }) => {
    const member = accounts.getActiveMember(guildId, discordUserId);
    const match = requireActiveMatch(guildId);
    requireManager(match, member, isServerManager);
    matches.updateStatus(match.id, MATCH_STATUS.CANCELED);
    return { match };
  });

  return {
    getActiveMatch,
    requireActiveMatch,
    requireRecruiting,
    requireParticipant,
    getTeams,
    getMatchView,
    createMatch,
    join,
    leave,
    setPosition,
    start,
    finish,
    cancel,
  };
}

module.exports = { createMatchService };
