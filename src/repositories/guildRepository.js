/** guild 테이블 쿼리 */
function createGuildRepository(db) {
  const stmts = {
    findByDiscordId: db.prepare('SELECT * FROM guild WHERE discord_guild_id = ?'),
    insert: db.prepare('INSERT INTO guild (discord_guild_id, name) VALUES (?, ?)'),
    reactivate: db.prepare(
      "UPDATE guild SET name = COALESCE(?, name), status = 'ACTIVE', left_at = NULL WHERE id = ?",
    ),
    markLeftByDiscordId: db.prepare(
      "UPDATE guild SET status = 'LEFT', left_at = datetime('now') WHERE discord_guild_id = ?",
    ),
  };

  return {
    findByDiscordId: (discordGuildId) => stmts.findByDiscordId.get(discordGuildId) || null,
    insert: (discordGuildId, name) => stmts.insert.run(discordGuildId, name),
    reactivate: (id, name) => stmts.reactivate.run(name, id),
    markLeftByDiscordId: (discordGuildId) => stmts.markLeftByDiscordId.run(discordGuildId),
  };
}

module.exports = { createGuildRepository };
