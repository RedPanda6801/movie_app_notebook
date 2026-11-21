/** account 테이블 쿼리 */
function createAccountRepository(db) {
  const stmts = {
    findByDiscordUserId: db.prepare('SELECT * FROM account WHERE discord_user_id = ?'),
    findByGameName: db.prepare('SELECT * FROM account WHERE lower(game_name) = lower(?)'),
    insert: db.prepare('INSERT INTO account (discord_user_id, username, game_name) VALUES (?, ?, ?)'),
    updateUsername: db.prepare('UPDATE account SET username = ? WHERE id = ?'),
    updateGameName: db.prepare('UPDATE account SET game_name = ? WHERE id = ?'),
    updatePreferredPosition: db.prepare('UPDATE account SET preferred_position = ? WHERE id = ?'),
  };

  return {
    findByDiscordUserId: (discordUserId) => stmts.findByDiscordUserId.get(discordUserId) || null,
    /** 롤 아이디로 계정 찾기 (대소문자 무시) */
    findByGameName: (gameName) => stmts.findByGameName.get(gameName) || null,
    /** @returns {number} 새 account.id */
    insert: (discordUserId, username, gameName = null) =>
      Number(stmts.insert.run(discordUserId, username, gameName).lastInsertRowid),
    updateUsername: (id, username) => stmts.updateUsername.run(username, id),
    /** 계정의 롤 아이디 (계정당 1개) */
    updateGameName: (id, gameName) => stmts.updateGameName.run(gameName, id),
    /** 선호 포지션 (대전 참가 시 기본값, null = 미정) */
    updatePreferredPosition: (id, position) => stmts.updatePreferredPosition.run(position, id),
  };
}

module.exports = { createAccountRepository };
