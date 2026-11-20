/** match 테이블 쿼리 */
function createMatchRepository(db) {
  const stmts = {
    findById: db.prepare('SELECT * FROM match WHERE id = ?'),
    findActiveByGuild: db.prepare(
      "SELECT * FROM match WHERE guild_id = ? AND status IN ('RECRUITING', 'IN_PROGRESS')",
    ),
    insert: db.prepare('INSERT INTO match (guild_id, channel_id, created_by) VALUES (?, ?, ?)'),
    updateStatus: db.prepare('UPDATE match SET status = ? WHERE id = ?'),
  };

  return {
    findById: (id) => stmts.findById.get(id) || null,
    /** 모집 중이거나 진행 중인 대전 (서버당 최대 1개) */
    findActiveByGuild: (guildId) => stmts.findActiveByGuild.get(guildId) || null,
    insert: (guildId, channelId, createdBy) =>
      Number(stmts.insert.run(guildId, channelId, createdBy).lastInsertRowid),
    updateStatus: (id, status) => stmts.updateStatus.run(status, id),
  };
}

module.exports = { createMatchRepository };
