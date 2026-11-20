/** match_record 테이블 쿼리 */
function createMatchRecordRepository(db) {
  const stmts = {
    insert: db.prepare('INSERT INTO match_record (match_id, winner_team_id) VALUES (?, ?)'),
    findByMatchWithSide: db.prepare(`
      SELECT r.*, t.side AS winner_side
        FROM match_record r
        JOIN team t ON t.id = r.winner_team_id
       WHERE r.match_id = ?`),
  };

  return {
    insert: (matchId, winnerTeamId) =>
      Number(stmts.insert.run(matchId, winnerTeamId).lastInsertRowid),
    /** 대전 기록 + 승리팀 side */
    findByMatchWithSide: (matchId) => stmts.findByMatchWithSide.get(matchId) || null,
  };
}

module.exports = { createMatchRecordRepository };
