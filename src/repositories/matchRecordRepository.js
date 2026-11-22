/** match_record 테이블 쿼리 (대전 1:N 판별 기록) */
function createMatchRecordRepository(db) {
  const stmts = {
    insert: db.prepare(`
      INSERT INTO match_record (match_id, game_no, winner_team_id, screenshot_path, recorded_by)
      VALUES (@matchId, @gameNo, @winnerTeamId, @screenshotPath, @recordedBy)`),
    countByMatch: db.prepare('SELECT COUNT(*) AS n FROM match_record WHERE match_id = ?'),
    findByMatch: db.prepare('SELECT * FROM match_record WHERE match_id = ? ORDER BY game_no'),
    findByMatchAndGameNo: db.prepare('SELECT * FROM match_record WHERE match_id = ? AND game_no = ?'),
    updateResult: db.prepare(`
      UPDATE match_record
         SET winner_team_id = @winnerTeamId,
             screenshot_path = COALESCE(@screenshotPath, screenshot_path),
             recorded_by = @recordedBy
       WHERE id = @id`),
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
    findByMatchAndGameNo: (matchId, gameNo) => stmts.findByMatchAndGameNo.get(matchId, gameNo) || null,
    /** 데이터 적재: 이미 있는 판의 승리팀/캡쳐/기록자 갱신 (캡쳐가 null이면 그대로 둔다) */
    updateResult: ({ id, winnerTeamId, screenshotPath = null, recordedBy = null }) =>
      stmts.updateResult.run({ id, winnerTeamId, screenshotPath, recordedBy }),
  };
}

module.exports = { createMatchRecordRepository };
