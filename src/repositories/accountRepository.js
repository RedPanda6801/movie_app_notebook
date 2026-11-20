/** account 테이블 쿼리 */
function createAccountRepository(db) {
  const stmts = {
    findByDiscordUserId: db.prepare('SELECT * FROM account WHERE discord_user_id = ?'),
    insert: db.prepare('INSERT INTO account (discord_user_id, username) VALUES (?, ?)'),
    updateUsername: db.prepare('UPDATE account SET username = ? WHERE id = ?'),
  };

  return {
    findByDiscordUserId: (discordUserId) => stmts.findByDiscordUserId.get(discordUserId) || null,
    /** @returns {number} 새 account.id */
    insert: (discordUserId, username) =>
      Number(stmts.insert.run(discordUserId, username).lastInsertRowid),
    updateUsername: (id, username) => stmts.updateUsername.run(username, id),
  };
}

module.exports = { createAccountRepository };
