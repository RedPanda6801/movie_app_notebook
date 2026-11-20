const { UserError } = require('../utils/errors');

/**
 * 계정관리 서비스.
 * "계정 등록/탈퇴"는 현재 서버(guild)의 guild_member 가입/탈퇴를 뜻한다.
 * account(디스코드 사용자당 1개)는 처음 등록할 때 자동으로 만들어진다.
 */
function createAccountService(repos) {
  const { accounts, guildMembers, participants, transaction } = repos;

  /**
   * 계정 등록
   * @returns {{ member: object, reactivated: boolean }}
   */
  const register = transaction(({ guildId, discordUserId, username = null, displayName = null }) => {
    const account = accounts.findByDiscordUserId(discordUserId);
    let accountId;
    if (!account) {
      accountId = accounts.insert(discordUserId, username);
    } else {
      accountId = account.id;
      if (username) accounts.updateUsername(account.id, username);
    }

    const member = guildMembers.findByGuildAndDiscordUser(guildId, discordUserId);
    if (member && member.status === 'ACTIVE') {
      throw new UserError('이미 이 서버에 등록된 계정입니다.');
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

  /** 현재 서버에 ACTIVE 상태로 등록된 회원을 찾는다. 없으면 UserError. */
  function getActiveMember(guildId, discordUserId) {
    const member = guildMembers.findByGuildAndDiscordUser(guildId, discordUserId);
    if (!member || member.status !== 'ACTIVE') {
      throw new UserError('이 서버에 등록된 계정이 없습니다. 먼저 `/계정 등록`을 해 주세요.');
    }
    return member;
  }

  /** 상태와 관계없이 서버 회원 정보를 찾는다. (승점 조회용) */
  function findAnyMember(guildId, discordUserId) {
    return guildMembers.findByGuildAndDiscordUser(guildId, discordUserId);
  }

  return { register, withdraw, getActiveMember, findAnyMember };
}

module.exports = { createAccountService };
