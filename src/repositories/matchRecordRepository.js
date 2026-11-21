/** match_record 테이블 쿼리 (대전 1:N 판별 기록) */
function createMatchRecordRepository(db) {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO match_record (match_id, game_no, winner_team_id, screenshot_path, recorded_by)
      VALUES (@matchId, @gameNo, @winnerTeamId, @screenshotPath, @recordedBy)`),
    countByMatch: db.prepare('SELECT COUNT(*) AS n FROM match_record WHERE match_id = ?'),
    findByMatch: db.prepare('SELECT * FROM match_record WHERE match_id = ? ORDER BY game_no'),
  };

  return {
    /** @returns {number} 새 match_record.id */
    insert: ({ matchId, gameNo, winnerTeamId = null, screenshotPath = null, recordedBy = null }) =>
      Number(
        stmts.insert.run({ matchId, gameNo, winnerTeamId, screenshotPath, recordedBy }).lastInsertRowid,
      ),
    countByMatch: (matchId) => stmts.countByMatch.get(matchId).n,
    /** 판 순서대로 */
    findByMatch: (matchId) => stmts.findByMatch.all(matchId),
  };
}

module.exports = { createMatchRecordRepository };
