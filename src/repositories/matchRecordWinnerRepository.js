/** match_record_winner 테이블 쿼리 (판별 승리자) */
function createMatchRecordWinnerRepository(db) {
  const stmts = {
    insert: db.prepare('INSERT INTO match_record_winner (record_id, guild_member_id) VALUES (?, ?)'),
    findByMatch: db.prepare(`
      SELECT w.record_id, w.guild_member_id, a.discord_user_id
        FROM match_record_winner w
        JOIN match_record r ON r.id = w.record_id
        JOIN guild_member gm ON gm.id = w.guild_member_id
        JOIN account a ON a.id = gm.account_id
       WHERE r.match_id = ?`),
  };

  return {
    insert: (recordId, guildMemberId) => stmts.insert.run(recordId, guildMemberId),
    /** 대전의 모든 판 승리자 (record_id별로 묶어서 쓴다) */
    findByMatch: (matchId) => stmts.findByMatch.all(matchId),
  };
}

module.exports = { createMatchRecordWinnerRepository };
