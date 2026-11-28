/** team 테이블 쿼리 */
function createTeamRepository(db) {
  const stmts = {
    insert: db.prepare('INSERT INTO team (match_id, game_no, side) VALUES (?, ?, ?)'),
    // 대전의 기본 팀 (game_no = 1). 참가자 팀 배정 · 승리팀 저장은 이 팀을 쓴다.
    findByMatch: db.prepare('SELECT * FROM team WHERE match_id = ? AND game_no = 1'),
    // 판별 팀까지 모두 (팀 id로 찾을 때)
    findAllByMatch: db.prepare('SELECT * FROM team WHERE match_id = ? ORDER BY game_no, side'),
  };

  return {
    insert: (matchId, side, gameNo = 1) => Number(stmts.insert.run(matchId, gameNo, side).lastInsertRowid),
    findByMatch: (matchId) => stmts.findByMatch.all(matchId),
    findAllByMatch: (matchId) => stmts.findAllByMatch.all(matchId),
  };
}

module.exports = { createTeamRepository };
