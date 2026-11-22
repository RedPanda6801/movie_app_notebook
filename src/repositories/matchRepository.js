/** match 테이블 쿼리 */
function createMatchRepository(db) {
  const stmts = {
    findById: db.prepare('SELECT * FROM match WHERE id = ?'),
    findActiveByGuild: db.prepare(
      "SELECT * FROM match WHERE guild_id = ? AND status IN ('RECRUITING', 'IN_PROGRESS')",
    ),
    insert: db.prepare(
      'INSERT INTO match (guild_id, channel_id, created_by, game_count) VALUES (?, ?, ?, ?)',
    ),
    updateStatus: db.prepare('UPDATE match SET status = ? WHERE id = ?'),
    // 전적 조회용: 진행 중/종료된 대전 최신순 + 기록된 판 수
    findRecentWithRecordsByGuild: db.prepare(`
      SELECT m.*, (SELECT COUNT(*) FROM match_record r WHERE r.match_id = m.id) AS record_count
        FROM match m
       WHERE m.guild_id = ? AND m.status IN ('IN_PROGRESS', 'FINISHED')
       ORDER BY m.id DESC
       LIMIT ?`),
    updateMessage: db.prepare(
      'UPDATE match SET message_channel_id = ?, message_id = ? WHERE id = ?',
    ),
  };

  return {
    findById: (id) => stmts.findById.get(id) || null,
    /** 모집 중이거나 진행 중인 대전 (서버당 최대 1개) */
    findActiveByGuild: (guildId) => stmts.findActiveByGuild.get(guildId) || null,
    insert: (guildId, channelId, createdBy, gameCount) =>
      Number(stmts.insert.run(guildId, channelId, createdBy, gameCount).lastInsertRowid),
    updateStatus: (id, status) => stmts.updateStatus.run(status, id),
    findRecentWithRecordsByGuild: (guildId, limit) => stmts.findRecentWithRecordsByGuild.all(guildId, limit),
    /** 공개 대전 정보 메시지 위치 저장 */
    updateMessage: (id, channelId, messageId) => stmts.updateMessage.run(channelId, messageId, id),
  };
}

module.exports = { createMatchRepository };
