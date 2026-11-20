/** match_participant 테이블 쿼리 */
function createMatchParticipantRepository(db) {
  const stmts = {
    findByMatchWithDetails: db.prepare(`
      SELECT mp.*, t.side, a.discord_user_id, gm.display_name
        FROM match_participant mp
        JOIN guild_member gm ON gm.id = mp.guild_member_id
        JOIN account a ON a.id = gm.account_id
        LEFT JOIN team t ON t.id = mp.team_id
       WHERE mp.match_id = ?
       ORDER BY mp.joined_at, mp.id`),
    countByMatch: db.prepare('SELECT COUNT(*) AS n FROM match_participant WHERE match_id = ?'),
    countLockedByTeam: db.prepare(
      'SELECT COUNT(*) AS n FROM match_participant WHERE team_id = ? AND is_team_locked = 1',
    ),
    findByMatchAndMember: db.prepare(
      'SELECT * FROM match_participant WHERE match_id = ? AND guild_member_id = ?',
    ),
    findActiveByMember: db.prepare(`
      SELECT mp.*, m.status AS match_status
        FROM match_participant mp
        JOIN match m ON m.id = mp.match_id
       WHERE mp.guild_member_id = ? AND m.status IN ('RECRUITING', 'IN_PROGRESS')`),
    insert: db.prepare('INSERT INTO match_participant (match_id, guild_member_id) VALUES (?, ?)'),
    delete: db.prepare('DELETE FROM match_participant WHERE id = ?'),
    updatePosition: db.prepare('UPDATE match_participant SET position = ? WHERE id = ?'),
    lockTeam: db.prepare('UPDATE match_participant SET team_id = ?, is_team_locked = 1 WHERE id = ?'),
    unlockTeam: db.prepare(
      'UPDATE match_participant SET team_id = NULL, is_team_locked = 0 WHERE id = ?',
    ),
    assignTeam: db.prepare('UPDATE match_participant SET team_id = ? WHERE id = ?'),
    resetShuffledByMatch: db.prepare(
      'UPDATE match_participant SET team_id = NULL WHERE match_id = ? AND is_team_locked = 0',
    ),
    // 회원 1명의 전적 (종료된 대전 기준) - 승점 조회용
    getStatsByMember: db.prepare(`
      SELECT COUNT(m.id) AS games,
             COUNT(r.id) AS wins
        FROM match_participant mp
        JOIN match m ON m.id = mp.match_id AND m.status = 'FINISHED'
        LEFT JOIN match_record r ON r.match_id = mp.match_id AND r.winner_team_id = mp.team_id
       WHERE mp.guild_member_id = ?`),
  };

  return {
    /** 참가자 + 팀(side) + 디스코드 사용자 ID + 표시 이름 */
    findByMatchWithDetails: (matchId) => stmts.findByMatchWithDetails.all(matchId),
    countByMatch: (matchId) => stmts.countByMatch.get(matchId).n,
    countLockedByTeam: (teamId) => stmts.countLockedByTeam.get(teamId).n,
    findByMatchAndMember: (matchId, guildMemberId) =>
      stmts.findByMatchAndMember.get(matchId, guildMemberId) || null,
    /** 모집 중/진행 중인 대전에 참가한 기록 */
    findActiveByMember: (guildMemberId) => stmts.findActiveByMember.get(guildMemberId) || null,
    insert: (matchId, guildMemberId) =>
      Number(stmts.insert.run(matchId, guildMemberId).lastInsertRowid),
    delete: (id) => stmts.delete.run(id),
    updatePosition: (id, position) => stmts.updatePosition.run(position, id),
    lockTeam: (id, teamId) => stmts.lockTeam.run(teamId, id),
    unlockTeam: (id) => stmts.unlockTeam.run(id),
    assignTeam: (id, teamId) => stmts.assignTeam.run(teamId, id),
    /** 셔플로 배정된 팀(직접 등록자 제외)을 초기화한다. */
    resetShuffledByMatch: (matchId) => stmts.resetShuffledByMatch.run(matchId),
    getStatsByMember: (guildMemberId) => stmts.getStatsByMember.get(guildMemberId),
  };
}

module.exports = { createMatchParticipantRepository };
