const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const { openDatabase } = require('../src/db');
const { createServices } = require('../src/services');
const { createRepositories } = require('../src/repositories');
const { LATEST_VERSION } = require('../src/db/migrations');

// v1 스키마(이전 버전 봇이 만든 DB)
const V1_SCHEMA = `
CREATE TABLE guild (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_guild_id TEXT NOT NULL UNIQUE, name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE', joined_at TEXT NOT NULL DEFAULT (datetime('now')), left_at TEXT);
CREATE TABLE account (id INTEGER PRIMARY KEY AUTOINCREMENT, discord_user_id TEXT NOT NULL UNIQUE, username TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE guild_member (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL REFERENCES guild (id),
  account_id INTEGER NOT NULL REFERENCES account (id), display_name TEXT, status TEXT NOT NULL DEFAULT 'ACTIVE',
  registered_at TEXT NOT NULL DEFAULT (datetime('now')), withdrawn_at TEXT, UNIQUE (guild_id, account_id));
CREATE TABLE match (id INTEGER PRIMARY KEY AUTOINCREMENT, guild_id INTEGER NOT NULL REFERENCES guild (id), channel_id TEXT,
  status TEXT NOT NULL DEFAULT 'RECRUITING', created_by INTEGER REFERENCES guild_member (id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE UNIQUE INDEX ux_match_active_per_guild ON match (guild_id) WHERE status IN ('RECRUITING', 'IN_PROGRESS');
CREATE TABLE team (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL REFERENCES match (id) ON DELETE CASCADE,
  side TEXT NOT NULL, UNIQUE (match_id, side));
CREATE TABLE match_participant (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL REFERENCES match (id) ON DELETE CASCADE,
  guild_member_id INTEGER NOT NULL REFERENCES guild_member (id), team_id INTEGER REFERENCES team (id), position TEXT,
  is_team_locked INTEGER NOT NULL DEFAULT 0, joined_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE (match_id, guild_member_id));
CREATE TABLE match_record (id INTEGER PRIMARY KEY AUTOINCREMENT, match_id INTEGER NOT NULL UNIQUE REFERENCES match (id),
  winner_team_id INTEGER NOT NULL REFERENCES team (id), played_at TEXT NOT NULL DEFAULT (datetime('now')));
`;

test('기존(v1) DB를 최신 스키마로 올리고 기존 승점을 유지한다', () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mig-')), 'bot.sqlite');
  const old = new Database(file);
  old.exec(V1_SCHEMA);
  old.exec(`
    INSERT INTO guild (id, discord_guild_id) VALUES (1, 'g');
    INSERT INTO account (id, discord_user_id) VALUES (1, 'winner'), (2, 'loser');
    INSERT INTO guild_member (id, guild_id, account_id) VALUES (1, 1, 1), (2, 1, 2);
    INSERT INTO match (id, guild_id, status, created_by) VALUES (1, 1, 'FINISHED', 1);
    INSERT INTO team (id, match_id, side) VALUES (1, 1, 'RED'), (2, 1, 'BLUE');
    INSERT INTO match_participant (match_id, guild_member_id, team_id) VALUES (1, 1, 1), (1, 2, 2);
    INSERT INTO match_record (match_id, winner_team_id) VALUES (1, 1);
  `);
  old.close();

  const db = openDatabase(file);
  assert.equal(db.pragma('user_version', { simple: true }), LATEST_VERSION);
  const services = createServices(db);
  assert.equal(services.points.getStats(1, 'winner').points, 1);
  assert.equal(services.points.getStats(1, 'loser').points, 0);
  assert.equal(db.prepare('SELECT game_no FROM match_record').get().game_no, 1);
  assert.equal(db.prepare('SELECT game_count FROM match WHERE id = 1').get().game_count, 1);
  // v3: 판별 참가자 전적으로 옮겨진다 (K/D/A/CS는 이전 기록이라 비어 있음)
  const players = db.prepare('SELECT * FROM match_record_player ORDER BY guild_member_id').all();
  assert.deepEqual(players.map((p) => [p.guild_member_id, p.side, p.is_win, p.kills]), [[1, 'RED', 1, null], [2, 'BLUE', 0, null]]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'match_record_winner'").get().n, 0);
  // v5: 계정의 롤 아이디(중복 불가) + 선호 포지션
  const columns = db.prepare('PRAGMA table_info(account)').all().map((c) => c.name);
  assert.ok(columns.includes('game_name') && columns.includes('preferred_position'));
  assert.ok(!columns.includes('last_game_name'));
  // v6: 팀은 판(game_no)별. 기존 팀은 id를 유지한 채 1판으로 옮겨지고, 같은 대전에 다른 판의 팀을 넣을 수 있다.
  assert.deepEqual(db.prepare('SELECT id, match_id, game_no, side FROM team ORDER BY id').all(), [
    { id: 1, match_id: 1, game_no: 1, side: 'RED' },
    { id: 2, match_id: 1, game_no: 1, side: 'BLUE' },
  ]);
  assert.equal(db.prepare('SELECT team_id FROM match_participant WHERE guild_member_id = 1').get().team_id, 1);
  db.prepare("INSERT INTO team (match_id, game_no, side) VALUES (1, 2, 'RED'), (1, 2, 'BLUE')").run();
  assert.throws(() => db.prepare("INSERT INTO team (match_id, game_no, side) VALUES (1, 2, 'RED')").run(), /UNIQUE/);
  assert.equal(db.pragma('foreign_key_check').length, 0, '팀 참조가 깨지지 않는다');
  // v7: 같은 참가자를 다른 판의 팀으로 한 행 더 넣을 수 있다. (같은 팀으로 두 번은 불가)
  const game2Red = db.prepare("SELECT id FROM team WHERE match_id = 1 AND game_no = 2 AND side = 'RED'").get().id;
  db.prepare('INSERT INTO match_participant (match_id, guild_member_id, team_id) VALUES (1, 1, ?)').run(game2Red);
  assert.throws(() => db.prepare('INSERT INTO match_participant (match_id, guild_member_id, team_id) VALUES (1, 1, 1)').run(), /UNIQUE/);
  // 봇은 기본 행(1판 팀)만 본다
  const { participants } = createRepositories(db);
  assert.equal(participants.countByMatch(1), 2, '2판 팀 행은 참가자 수에 안 들어간다');
  assert.equal(participants.findByMatchAndMember(1, 1).team_id, 1, '기본 행(1판 팀)을 찾는다');
  participants.resetShuffledByMatch(1);
  assert.equal(db.prepare('SELECT team_id FROM match_participant WHERE team_id = ?').get(game2Red)?.team_id, game2Red, '셔플 초기화는 다른 판 행을 건드리지 않는다');
  assert.equal(db.pragma('foreign_key_check').length, 0);
  db.close();

  // 다시 열어도 마이그레이션이 중복 적용되지 않는다
  openDatabase(file).close();
});

test('새 DB는 최신 버전으로 바로 만들어진다', () => {
  const db = openDatabase(':memory:');
  assert.equal(db.pragma('user_version', { simple: true }), LATEST_VERSION);
});
