const { UserError } = require('../utils/errors');
const { normalizeGameName, normalizePosition } = require('./validation');

/**
 * 계정관리 서비스.
 * "계정 등록/탈퇴"는 현재 서버(guild)의 guild_member 가입/탈퇴를 뜻한다.
 * account(디스코드 사용자당 1개)는 처음 등록할 때 자동으로 만들어진다.
 * 롤 아이디는 계정 등록 때 함께 등록하며 **계정당 1개**, 다른 계정과 중복될 수 없다.
 */
function createAccountService(repos) {
  const { accounts, guildMembers, participants, transaction } = repos;

  /** 다른 계정이 이미 쓰는 롤 아이디인지 확인한다. */
  function requireGameNameAvailable(gameName, ownAccountId) {
    const owner = accounts.findByGameName(gameName);
    if (owner && owner.id !== ownAccountId) {
      throw new UserError(`\`${gameName}\`은(는) 이미 다른 계정이 등록한 롤 아이디입니다. 본인 아이디가 맞다면 관리자에게 문의해 주세요.`);
    }
  }

  /** 계정 등록 입력창을 띄우기 전 확인 + 기본값 (다른 서버에서 쓰던 롤 아이디) */
  function getRegisterDefaults(guildId, discordUserId) {
    const member = guildMembers.findByGuildAndDiscordUser(guildId, discordUserId);
    if (member && member.status === 'ACTIVE') {
      throw new UserError('이미 이 서버에 등록된 계정입니다. 롤 아이디를 바꾸려면 [아이디 변경]을 눌러 주세요.');
    }
    return { gameName: accounts.findByDiscordUserId(discordUserId)?.game_name ?? null };
  }

  /**
   * 계정 등록 (롤 아이디 필수)
   * @returns {{ member: object, reactivated: boolean }}
   */
  const register = transaction(({ guildId, discordUserId, username = null, displayName = null, gameName }) => {
    const name = normalizeGameName(gameName);
    const member = guildMembers.findByGuildAndDiscordUser(guildId, discordUserId);
    if (member && member.status === 'ACTIVE') {
      throw new UserError('이미 이 서버에 등록된 계정입니다. 롤 아이디를 바꾸려면 [아이디 변경]을 눌러 주세요.');
    }

    const account = accounts.findByDiscordUserId(discordUserId);
    requireGameNameAvailable(name, account?.id ?? null);
    let accountId;
    if (!account) {
      accountId = accounts.insert(discordUserId, username, name);
    } else {
      accountId = account.id;
      if (username) accounts.updateUsername(account.id, username);
      accounts.updateGameName(account.id, name);
    }

    if (member) {
      guildMembers.reactivate(member.id, displayName);
    } else {
      guildMembers.insert(guildId, accountId, displayName);
    }
    return {
      member: guildMembers.findByGuildAndDiscordUser(guildId, discordUserId),
      reactivated: Boolean(member),
    };
  });

  /**
   * 계정 탈퇴. 모집 중인 대전에 참가 중이면 대전 참가도 함께 철회한다.
   * @returns {{ leftMatchId: number|null }}
   */
  const withdraw = transaction(({ guildId, discordUserId }) => {
    const member = getActiveMember(guildId, discordUserId);
    const participation = participants.findActiveByMember(member.id);
    let leftMatchId = null;
    if (participation) {
      if (participation.match_status === 'IN_PROGRESS') {
        throw new UserError('진행 중인 대전에 참가하고 있어 탈퇴할 수 없습니다. 대전이 끝난 뒤 다시 시도해 주세요.');
      }
      participants.delete(participation.id);
      participants.resetShuffledByMatch(participation.match_id);
      leftMatchId = participation.match_id;
    }
    guildMembers.withdraw(member.id);
    return { leftMatchId };
  });

  /**
   * 롤 아이디 변경 (계정당 1개). 모집 중인 대전에 참가 중이면 그 대전의 아이디도 바꾼다.
   * @returns {{ gameName: string, matchId: number|null }}
   */
  const changeGameName = transaction(({ guildId, discordUserId, gameName }) => {
    const member = getActiveMember(guildId, discordUserId);
    const name = normalizeGameName(gameName);
    requireGameNameAvailable(name, member.account_id);
    accounts.updateGameName(member.account_id, name);
    const participation = participants.findActiveByMember(member.id);
    let matchId = null;
    if (participation && participation.match_status === 'RECRUITING') {
      participants.updateGameName(participation.id, name);
      matchId = participation.match_id;
    }
    return { gameName: name, matchId };
  });

  /** 선호 포지션 (대전 참가 시 포지션 기본값). null = 미정 */
  const setPreferredPosition = transaction(({ guildId, discordUserId, position }) => {
    const member = getActiveMember(guildId, discordUserId);
    const pos = normalizePosition(position);
    accounts.updatePreferredPosition(member.account_id, pos);
    return { position: pos };
  });

  /** 현재 서버에 ACTIVE 상태로 등록된 회원을 찾는다. 없으면 UserError. */
  function getActiveMember(guildId, discordUserId) {
    const member = guildMembers.findByGuildAndDiscordUser(guildId, discordUserId);
    if (!member || member.status !== 'ACTIVE') {
      throw new UserError('이 서버에 등록된 계정이 없습니다. 계정관리 채널에서 [계정 등록] 버튼을 먼저 눌러 주세요.');
    }
    return member;
  }

  /** 상태와 관계없이 서버 회원 정보를 찾는다. (승점 조회용) */
  function findAnyMember(guildId, discordUserId) {
    return guildMembers.findByGuildAndDiscordUser(guildId, discordUserId);
  }

  return { getRegisterDefaults, register, changeGameName, setPreferredPosition, withdraw, getActiveMember, findAnyMember };
}

module.exports = { createAccountService };
