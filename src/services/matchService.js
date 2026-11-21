const {
  MATCH_SIZE,
  TEAM_SIZE,
  MATCH_STATUS,
  POSITIONS,
  SIDES,
  MIN_GAMES,
  MAX_GAMES,
} = require('../constants');
const { UserError } = require('../utils/errors');

/**
 * 롤 아이디(Riot ID) 형식: 게임이름#태그 (예: Hide on bush#KR1)
 * - 게임이름: 글자/숫자/공백 3~16자
 * - 태그: 글자/숫자 3~5자 (특수문자 불가)
 */
const GAME_NAME_PATTERN = /^[\p{L}\p{N} ]{3,16}#[\p{L}\p{N}]{3,5}$/u;
const GAME_NAME_HELP =
  '롤 아이디는 `게임이름#태그` 형식으로 입력해 주세요. 게임이름은 3~16자, 태그는 특수문자 없이 3~5자입니다. (예: Hide on bush#KR1)';

function normalizeGameName(gameName) {
  const raw = String(gameName ?? '').trim();
  const parts = raw.split('#');
  if (parts.length !== 2) throw new UserError(GAME_NAME_HELP);
  const value = `${parts[0].trim().replace(/\s+/g, ' ')}#${parts[1].trim()}`;
  if (!GAME_NAME_PATTERN.test(value)) throw new UserError(GAME_NAME_HELP);
  return value;
}

/**
 * 대전관리 서비스 - 대전 등록/시작/판 기록/종료와 사용자 관리(참가, 탈퇴, 포지션).
 * 서버(guild)당 진행 중인 대전은 1개만 존재한다. 대전 안에는 1~10판이 있다.
 */
function createMatchService(repos, accounts) {
  const { matches, teams, participants, records, recordWinners, accounts: accountRepo, transaction } = repos;

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

  /** 판별 기록 + 승리자 디스코드 ID 목록 */
  function getGames(matchId) {
    const winners = recordWinners.findByMatch(matchId);
    return records.findByMatch(matchId).map((r) => ({
      ...r,
      winnerDiscordUserIds: winners.filter((w) => w.record_id === r.id).map((w) => w.discord_user_id),
    }));
  }

  /** 대전의 현재 상태(참가자, 팀 구성, 판별 기록)를 한 번에 조회한다. */
  function getMatchView(matchId) {
    const match = matches.findById(matchId);
    if (!match) return null;
    const list = participants.findByMatchWithDetails(matchId);
    const creator = list.find((p) => p.guild_member_id === match.created_by) || null;
    return {
      match,
      creatorDiscordUserId: creator?.discord_user_id ?? null,
      participants: list,
      red: list.filter((p) => p.side === 'RED'),
      blue: list.filter((p) => p.side === 'BLUE'),
      unassigned: list.filter((p) => !p.side),
      games: getGames(matchId),
    };
  }

  /** 서버에 진행 중인 대전이 없고 등록 가능한지 미리 확인한다. (버튼 → 판 수 선택 전) */
  function checkCanCreate({ guildId, discordUserId }) {
    const member = accounts.getActiveMember(guildId, discordUserId);
    if (getActiveMatch(guildId)) {
      throw new UserError('이 서버에는 이미 진행 중인 대전이 있습니다. 서버마다 대전은 하나만 진행할 수 있습니다.');
    }
    return member;
  }

  function addParticipant(match, member, gameName) {
    participants.insert(match.id, member.id, gameName);
    if (gameName) accountRepo.updateLastGameName(member.account_id, gameName);
    participants.resetShuffledByMatch(match.id);
  }

  /**
   * 대전 등록: 판 수(1~10)를 정하고, 등록자는 자동으로 참가한다.
   * @returns {object} match
   */
  const createMatch = transaction(({ guildId, discordUserId, channelId, gameCount, gameName }) => {
    const count = Number(gameCount);
    if (!Number.isInteger(count) || count < MIN_GAMES || count > MAX_GAMES) {
      throw new UserError(`판 수는 ${MIN_GAMES}~${MAX_GAMES}판 중에서 골라 주세요.`);
    }
    const name = normalizeGameName(gameName);
    const member = checkCanCreate({ guildId, discordUserId });
    const matchId = matches.insert(guildId, channelId, member.id, count);
    for (const side of SIDES) teams.insert(matchId, side);
    const match = matches.findById(matchId);
    addParticipant(match, member, name);
    return match;
  });

  /** 공개 대전 정보 메시지 위치 저장 */
  function setMatchMessage(matchId, channelId, messageId) {
    matches.updateMessage(matchId, channelId, messageId);
  }

  /** 참가 가능한지 미리 확인한다. (버튼 → 아이디 입력창 띄우기 전) */
  function checkCanJoin({ guildId, discordUserId, matchId = null }) {
    const member = accounts.getActiveMember(guildId, discordUserId);
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
   * 대전 참가 (롤 아이디 입력). gameName을 생략하면 아이디 없이 참가한다. (관리자 커맨드용)
   * @returns {{ match: object, count: number }}
   */
  const join = transaction(({ guildId, discordUserId, matchId = null, gameName = null, requireGameName = true }) => {
    const name = gameName == null && !requireGameName ? null : normalizeGameName(gameName);
    const { member, match } = checkCanJoin({ guildId, discordUserId, matchId });
    addParticipant(match, member, name);
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

  /** 대전 시작: 참가자가 10명이어야 한다. */
  const start = transaction(({ guildId, discordUserId, matchId = null, isAdmin = false }) => {
    const match = checkManager({ guildId, discordUserId, matchId, isAdmin });
    requireRecruiting(match);
    const count = participants.countByMatch(match.id);
    if (count !== MATCH_SIZE) {
      throw new UserError(`참가자가 ${MATCH_SIZE}명이어야 시작할 수 있습니다. (현재 ${count}명)`);
    }
    matches.updateStatus(match.id, MATCH_STATUS.IN_PROGRESS);
    return getMatchView(match.id);
  });

  /** 다음에 기록할 판 번호를 확인한다. (대전 기록 버튼 → 입력창 띄우기 전) */
  function checkCanRecord({ guildId, discordUserId, matchId = null, isAdmin = false }) {
    const match = checkManager({ guildId, discordUserId, matchId, isAdmin });
    requireInProgress(match);
    const recorded = records.countByMatch(match.id);
    if (recorded >= match.game_count) {
      throw new UserError(`등록한 ${match.game_count}판을 모두 기록했습니다. [대전 종료]를 눌러 주세요.`);
    }
    return { match, gameNo: recorded + 1, participants: participants.findByMatchWithDetails(match.id) };
  }

  function recordedByMemberId(guildId, discordUserId) {
    return accounts.findAnyMember(guildId, discordUserId)?.id ?? null;
  }

  /**
   * 판 기록 (캡쳐 + 승리자 5명). 승리자 1명당 승점 1점.
   * @param {{ winnerDiscordUserIds: string[], screenshotPath: string|null, gameNo: number }} params
   */
  const recordGame = transaction(
    ({ guildId, discordUserId, matchId = null, isAdmin = false, gameNo, winnerDiscordUserIds, screenshotPath = null }) => {
      const { match, gameNo: expected, participants: list } = checkCanRecord({
        guildId,
        discordUserId,
        matchId,
        isAdmin,
      });
      if (gameNo != null && Number(gameNo) !== expected) {
        throw new UserError(`${gameNo}판은 이미 기록되었습니다. 다시 [대전 기록]을 눌러 주세요.`);
      }
      const ids = [...new Set(winnerDiscordUserIds)];
      if (ids.length !== TEAM_SIZE) {
        throw new UserError(`이긴 사람을 정확히 ${TEAM_SIZE}명 골라 주세요.`);
      }
      const winners = ids.map((id) => list.find((p) => p.discord_user_id === id));
      if (winners.some((p) => !p)) {
        throw new UserError('대전 참가자만 승리자로 고를 수 있습니다.');
      }
      const recordId = records.insert({
        matchId: match.id,
        gameNo: expected,
        screenshotPath,
        recordedBy: recordedByMemberId(guildId, discordUserId),
      });
      for (const p of winners) recordWinners.insert(recordId, p.guild_member_id);
      return { match, gameNo: expected, recordId };
    },
  );

  /** 판 기록 (팀 기준, 관리자 커맨드용): 해당 팀 5명이 승리자 */
  const recordGameByTeam = transaction(({ guildId, discordUserId, winnerSide, isAdmin = false }) => {
    if (!SIDES.includes(winnerSide)) throw new UserError('알 수 없는 팀입니다.');
    const { match, gameNo, participants: list } = checkCanRecord({ guildId, discordUserId, isAdmin });
    const winners = list.filter((p) => p.side === winnerSide);
    if (winners.length !== TEAM_SIZE) {
      throw new UserError('팀 구성이 끝나지 않아 팀 기준으로 기록할 수 없습니다. `/팀 셔플` 또는 [대전 기록] 버튼을 이용해 주세요.');
    }
    const recordId = records.insert({
      matchId: match.id,
      gameNo,
      winnerTeamId: getTeams(match.id)[winnerSide].id,
      recordedBy: recordedByMemberId(guildId, discordUserId),
    });
    for (const p of winners) recordWinners.insert(recordId, p.guild_member_id);
    return { match, gameNo };
  });

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
    recordGameByTeam,
    finish,
    cancel,
  };
}

module.exports = { createMatchService, normalizeGameName };
