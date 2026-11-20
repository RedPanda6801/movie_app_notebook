const { UserError } = require('../utils/errors');

/**
 * 계정관리 서비스.
 * "계정 등록/탈퇴"는 현재 서버(guild)의 guild_member 가입/탈퇴를 뜻한다.
 * account(디스코드 사용자당 1개)는 처음 등록할 때 자동으로 만들어진다.
 */
function createAccountService(db) {
  const findAccount = db.prepare('SELECT * FROM account WHERE discord_user_id = ?');
  const insertAccount = db.prepare('INSERT INTO account (discord_user_id, username) VALUES (?, ?)');
  const updateUsername = db.prepare('UPDATE account SET username = ? WHERE id = ?');

  const findMember = db.prepare(`
    SELECT gm.*, a.discord_user_id
      FROM guild_member gm
      JOIN account a ON a.id = gm.account_id
     WHERE gm.guild_id = ? AND a.discord_user_id = ?`);
  const insertMember = db.prepare(
    'INSERT INTO guild_member (guild_id, account_id, display_name) VALUES (?, ?, ?)',
  );
  const reactivateMember = db.prepare(`
    UPDATE guild_member
       SET status = 'ACTIVE', withdrawn_at = NULL, registered_at = datetime('now'),
           display_name = COALESCE(?, display_name)
     WHERE id = ?`);
  const withdrawMember = db.prepare(
    "UPDATE guild_member SET status = 'WITHDRAWN', withdrawn_at = datetime('now') WHERE id = ?",
  );

  const findActiveParticipation = db.prepare(`
    SELECT mp.id, m.id AS match_id, m.status
      FROM match_participant mp
      JOIN match m ON m.id = mp.match_id
     WHERE mp.guild_member_id = ? AND m.status IN ('RECRUITING', 'IN_PROGRESS')`);
  const deleteParticipant = db.prepare('DELETE FROM match_participant WHERE id = ?');
  const resetShuffled = db.prepare(
    'UPDATE match_participant SET team_id = NULL WHERE match_id = ? AND is_team_locked = 0',
  );

  /**
   * 계정 등록
   * @returns {{ member: object, reactivated: boolean }}
   */
  const register = db.transaction(({ guildId, discordUserId, username = null, displayName = null }) => {
    let account = findAccount.get(discordUserId);
    if (!account) {
      const { lastInsertRowid } = insertAccount.run(discordUserId, username);
      account = { id: Number(lastInsertRowid) };
    } else if (username) {
      updateUsername.run(username, account.id);
    }

    const member = findMember.get(guildId, discordUserId);
    if (member && member.status === 'ACTIVE') {
      throw new UserError('이미 이 서버에 등록된 계정입니다.');
    }
    if (member) {
      reactivateMember.run(displayName, member.id);
      return { member: findMember.get(guildId, discordUserId), reactivated: true };
    }
    insertMember.run(guildId, account.id, displayName);
    return { member: findMember.get(guildId, discordUserId), reactivated: false };
  });

  /**
   * 계정 탈퇴. 모집 중인 대전에 참가 중이면 대전 참가도 함께 철회한다.
   * @returns {{ leftMatchId: number|null }}
   */
  const withdraw = db.transaction(({ guildId, discordUserId }) => {
    const member = getActiveMember(guildId, discordUserId);
    const participation = findActiveParticipation.get(member.id);
    let leftMatchId = null;
    if (participation) {
      if (participation.status === 'IN_PROGRESS') {
        throw new UserError('진행 중인 대전에 참가하고 있어 탈퇴할 수 없습니다. 대전이 끝난 뒤 다시 시도해 주세요.');
      }
      deleteParticipant.run(participation.id);
      resetShuffled.run(participation.match_id);
      leftMatchId = participation.match_id;
    }
    withdrawMember.run(member.id);
    return { leftMatchId };
  });

  /** 현재 서버에 ACTIVE 상태로 등록된 회원을 찾는다. 없으면 UserError. */
  function getActiveMember(guildId, discordUserId) {
    const member = findMember.get(guildId, discordUserId);
    if (!member || member.status !== 'ACTIVE') {
      throw new UserError('이 서버에 등록된 계정이 없습니다. 먼저 `/계정 등록`을 해 주세요.');
    }
    return member;
  }

  /** 상태와 관계없이 서버 회원 정보를 찾는다. (승점 조회용) */
  function findAnyMember(guildId, discordUserId) {
    return findMember.get(guildId, discordUserId) || null;
  }

  return { register, withdraw, getActiveMember, findAnyMember };
}

module.exports = { createAccountService };
