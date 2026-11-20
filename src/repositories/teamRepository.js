/** team 테이블 쿼리 */
function createTeamRepository(db) {
  const stmts = {
    insert: db.prepare('INSERT INTO team (match_id, side) VALUES (?, ?)'),
    findByMatch: db.prepare('SELECT * FROM team WHERE match_id = ?'),
  };

  return {
    insert: (matchId, side) => Number(stmts.insert.run(matchId, side).lastInsertRowid),
    findByMatch: (matchId) => stmts.findByMatch.all(matchId),
  };
}

module.exports = { createTeamRepository };
