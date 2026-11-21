/**
 * match_record_player 테이블 쿼리 (판별 참가자 전적: 팀 · K/D/A · CS · 승패)
 * 전적/승점 집계는 종료(FINISHED)된 대전만 대상으로 한다.
 */
function createMatchRecordPlayerRepository(db) {
  // 집계 공통 컬럼: 판 수, 승리 수, K/D/A/CS 합계, K/D/A/CS가 입력된 판 수
  const AGG = `
    COUNT(p.record_id)                      AS games,
    COALESCE(SUM(p.is_win), 0)              AS wins,
    COALESCE(SUM(p.kills), 0)               AS kills,
    COALESCE(SUM(p.deaths), 0)              AS deaths,
    COALESCE(SUM(p.assists), 0)             AS assists,
    COALESCE(SUM(p.cs), 0)                  AS cs,
    COUNT(p.kills)                          AS stat_games`;

  const DETAIL_COLUMNS = `
    p.*, r.match_id, r.game_no, r.played_at, r.screenshot_path,
    a.discord_user_id, gm.display_name`;

  const stmts = {
    insert: db.prepare(`
      INSERT INTO match_record_player
        (record_id, guild_member_id, side, game_name, position, kills, deaths, assists, cs, is_win)
      VALUES (@recordId, @guildMemberId, @side, @gameName, @position, @kills, @deaths, @assists, @cs, @isWin)`),
    findByMatch: db.prepare(`
      SELECT ${DETAIL_COLUMNS}
        FROM match_record_player p
        JOIN match_record r ON r.id = p.record_id
        JOIN guild_member gm ON gm.id = p.guild_member_id
        JOIN account a ON a.id = gm.account_id
       WHERE r.match_id = ?
       ORDER BY r.game_no, p.side, p.guild_member_id`),
    getSummaryByMember: db.prepare(`
      SELECT ${AGG}
        FROM match_record_player p
        JOIN match_record r ON r.id = p.record_id
        JOIN match m ON m.id = r.match_id AND m.status = 'FINISHED'
       WHERE p.guild_member_id = ?`),
    findRecentByMember: db.prepare(`
      SELECT ${DETAIL_COLUMNS}
        FROM match_record_player p
        JOIN match_record r ON r.id = p.record_id
        JOIN match m ON m.id = r.match_id AND m.status = 'FINISHED'
        JOIN guild_member gm ON gm.id = p.guild_member_id
        JOIN account a ON a.id = gm.account_id
       WHERE p.guild_member_id = ?
       ORDER BY r.match_id DESC, r.game_no DESC
       LIMIT ?`),
    findAllByGuild: db.prepare(`
      SELECT ${DETAIL_COLUMNS}
        FROM match_record_player p
        JOIN match_record r ON r.id = p.record_id
        JOIN match m ON m.id = r.match_id AND m.status = 'FINISHED'
        JOIN guild_member gm ON gm.id = p.guild_member_id
        JOIN account a ON a.id = gm.account_id
       WHERE m.guild_id = ?
       ORDER BY r.match_id, r.game_no, p.side, p.guild_member_id`),
    // 기록이 1판 이상 있는 서버 회원별 합계 (탈퇴 회원 포함)
    getSummaryByGuild: db.prepare(`
      SELECT a.discord_user_id, gm.display_name, gm.status AS member_status, ${AGG}
        FROM match_record_player p
        JOIN match_record r ON r.id = p.record_id
        JOIN match m ON m.id = r.match_id AND m.status = 'FINISHED'
        JOIN guild_member gm ON gm.id = p.guild_member_id
        JOIN account a ON a.id = gm.account_id
       WHERE m.guild_id = ?
       GROUP BY gm.id
       ORDER BY wins DESC, games ASC, kills DESC`),
  };

  return {
    /** @param {{recordId, guildMemberId, side, gameName, position, kills, deaths, assists, cs, isWin}} row */
    insert: (row) => stmts.insert.run({ ...row, isWin: row.isWin ? 1 : 0 }),
    /** 대전의 모든 판 참가자 전적 (진행 중인 대전 포함) */
    findByMatch: (matchId) => stmts.findByMatch.all(matchId),
    getSummaryByMember: (guildMemberId) => stmts.getSummaryByMember.get(guildMemberId),
    findRecentByMember: (guildMemberId, limit) => stmts.findRecentByMember.all(guildMemberId, limit),
    findAllByGuild: (guildId) => stmts.findAllByGuild.all(guildId),
    getSummaryByGuild: (guildId) => stmts.getSummaryByGuild.all(guildId),
  };
}

module.exports = { createMatchRecordPlayerRepository };
