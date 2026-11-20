function createGuildService(db) {
  const findStmt = db.prepare('SELECT * FROM guild WHERE discord_guild_id = ?');
  const insertStmt = db.prepare('INSERT INTO guild (discord_guild_id, name) VALUES (?, ?)');
  const reactivateStmt = db.prepare(
    "UPDATE guild SET name = COALESCE(?, name), status = 'ACTIVE', left_at = NULL WHERE id = ?",
  );
  const leftStmt = db.prepare(
    "UPDATE guild SET status = 'LEFT', left_at = datetime('now') WHERE discord_guild_id = ?",
  );

  /** 봇이 서버에 참가했거나 서버에서 커맨드가 들어왔을 때 guild 행을 보장한다. */
  function ensureGuild(discordGuildId, name = null) {
    const existing = findStmt.get(discordGuildId);
    if (!existing) {
      insertStmt.run(discordGuildId, name);
    } else if (existing.status !== 'ACTIVE' || (name && existing.name !== name)) {
      reactivateStmt.run(name, existing.id);
    }
    return findStmt.get(discordGuildId);
  }

  /** 봇이 서버에서 나갔을 때 */
  function markLeft(discordGuildId) {
    leftStmt.run(discordGuildId);
  }

  return { ensureGuild, markLeft };
}

module.exports = { createGuildService };
