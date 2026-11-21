/** guild_member 테이블 쿼리 */
function createGuildMemberRepository(db) {
  const stmts = {
    findByGuildAndDiscordUser: db.prepare(`
      SELECT gm.*, a.discord_user_id, a.last_game_name, a.last_position
        FROM guild_member gm
        JOIN account a ON a.id = gm.account_id
       WHERE gm.guild_id = ? AND a.discord_user_id = ?`),
    insert: db.prepare(
      'INSERT INTO guild_member (guild_id, account_id, display_name) VALUES (?, ?, ?)',
    ),
    reactivate: db.prepare(`
      UPDATE guild_member
         SET status = 'ACTIVE', withdrawn_at = NULL, registered_at = datetime('now'),
             display_name = COALESCE(?, display_name)
       WHERE id = ?`),
    withdraw: db.prepare(
      "UPDATE guild_member SET status = 'WITHDRAWN', withdrawn_at = datetime('now') WHERE id = ?",
    ),
    // 서버의 ACTIVE 회원별 전적 (종료된 대전의 판 기준) - 승점 랭킹용
    findRankingByGuild: db.prepare(`
      SELECT a.discord_user_id, gm.display_name,
             COUNT(r.id) AS games,
             COALESCE(SUM(CASE WHEN r.id IS NOT NULL THEN p.is_win END), 0) AS wins
        FROM guild_member gm
        JOIN account a ON a.id = gm.account_id
        LEFT JOIN match_record_player p ON p.guild_member_id = gm.id
        LEFT JOIN match_record r ON r.id = p.record_id
         AND r.match_id IN (SELECT id FROM match WHERE status = 'FINISHED')
       WHERE gm.guild_id = ? AND gm.status = 'ACTIVE'
       GROUP BY gm.id
       ORDER BY wins DESC, games ASC, gm.registered_at ASC
       LIMIT ?`),
  };

  return {
    findByGuildAndDiscordUser: (guildId, discordUserId) =>
      stmts.findByGuildAndDiscordUser.get(guildId, discordUserId) || null,
    insert: (guildId, accountId, displayName) =>
      Number(stmts.insert.run(guildId, accountId, displayName).lastInsertRowid),
    reactivate: (id, displayName) => stmts.reactivate.run(displayName, id),
    withdraw: (id) => stmts.withdraw.run(id),
    findRankingByGuild: (guildId, limit) => stmts.findRankingByGuild.all(guildId, limit),
  };
}

module.exports = { createGuildMemberRepository };
