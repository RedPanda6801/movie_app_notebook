/**
 * 봇이 쓰는 참가자 행: 팀 미정이거나 1판(기본) 팀에 속한 행.
 * 다른 판의 팀(team.game_no > 1)에 넣은 행은 직접 넣은 데이터로 보고, 참가 · 셔플 · 기록에서 건드리지 않는다.
 */
const BASE_ROW = (alias) =>
  `(${alias}.team_id IS NULL OR ${alias}.team_id IN (SELECT id FROM team WHERE game_no = 1))`;

/** match_participant 테이블 쿼리 */
function createMatchParticipantRepository(db) {
  const stmts = {
    findByMatchWithDetails: db.prepare(`
      SELECT mp.*, t.side, a.discord_user_id, gm.display_name
        FROM match_participant mp
        JOIN guild_member gm ON gm.id = mp.guild_member_id
        JOIN account a ON a.id = gm.account_id
        LEFT JOIN team t ON t.id = mp.team_id
       WHERE mp.match_id = ? AND ${BASE_ROW('mp')}
       ORDER BY mp.joined_at, mp.id`),
    countByMatch: db.prepare(`SELECT COUNT(*) AS n FROM match_participant mp WHERE mp.match_id = ? AND ${BASE_ROW('mp')}`),
    countLockedByTeam: db.prepare(
      'SELECT COUNT(*) AS n FROM match_participant WHERE team_id = ? AND is_team_locked = 1',
    ),
    findByMatchAndMember: db.prepare(
      `SELECT * FROM match_participant mp WHERE mp.match_id = ? AND mp.guild_member_id = ? AND ${BASE_ROW('mp')}`,
    ),
    findActiveByMember: db.prepare(`
      SELECT mp.*, m.status AS match_status
        FROM match_participant mp
        JOIN match m ON m.id = mp.match_id
       WHERE mp.guild_member_id = ? AND m.status IN ('RECRUITING', 'IN_PROGRESS') AND ${BASE_ROW('mp')}`),
    insert: db.prepare(
      'INSERT INTO match_participant (match_id, guild_member_id, game_name) VALUES (?, ?, ?)',
    ),
    delete: db.prepare('DELETE FROM match_participant WHERE id = ?'),
    updatePosition: db.prepare('UPDATE match_participant SET position = ? WHERE id = ?'),
    updateGameName: db.prepare('UPDATE match_participant SET game_name = ? WHERE id = ?'),
    lockTeam: db.prepare('UPDATE match_participant SET team_id = ?, is_team_locked = 1 WHERE id = ?'),
    unlockTeam: db.prepare(
      'UPDATE match_participant SET team_id = NULL, is_team_locked = 0 WHERE id = ?',
    ),
    assignTeam: db.prepare('UPDATE match_participant SET team_id = ? WHERE id = ?'),
    resetShuffledByMatch: db.prepare(
      `UPDATE match_participant SET team_id = NULL
        WHERE match_id = ? AND is_team_locked = 0 AND ${BASE_ROW('match_participant')}`,
    ),
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
    insert: (matchId, guildMemberId, gameName = null) =>
      Number(stmts.insert.run(matchId, guildMemberId, gameName).lastInsertRowid),
    delete: (id) => stmts.delete.run(id),
    updatePosition: (id, position) => stmts.updatePosition.run(position, id),
    updateGameName: (id, gameName) => stmts.updateGameName.run(gameName, id),
    lockTeam: (id, teamId) => stmts.lockTeam.run(teamId, id),
    unlockTeam: (id) => stmts.unlockTeam.run(id),
    assignTeam: (id, teamId) => stmts.assignTeam.run(teamId, id),
    /** 셔플로 배정된 팀(직접 등록자 제외)을 초기화한다. */
    resetShuffledByMatch: (matchId) => stmts.resetShuffledByMatch.run(matchId),
  };
}

module.exports = { createMatchParticipantRepository };
