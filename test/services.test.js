const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { UserError } = require('../src/utils/errors');
const { normalizeGameName } = require('../src/services/matchService');

const isUserError = (pattern) => (err) => err instanceof UserError && pattern.test(err.message);

test('계정: 사용자당 1계정, 서버별 가입/탈퇴', () => {
  const { db, services, guild, register } = setup();
  const guild2 = services.guilds.ensureGuild('guild-2', '두번째 서버');
  register('u1');
  assert.throws(() => register('u1'), isUserError(/이미/));
  register('u1', guild2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account').get().n, 1);

  services.accounts.withdraw({ guildId: guild.id, discordUserId: 'u1' });
  assert.throws(() => services.accounts.getActiveMember(guild.id, 'u1'), isUserError(/계정 등록/));
  assert.equal(services.accounts.getActiveMember(guild2.id, 'u1').status, 'ACTIVE');
  assert.equal(register('u1').reactivated, true);
});

test('롤 아이디 형식 검사', () => {
  assert.equal(normalizeGameName('  Hide on bush # KR1 '), 'Hide on bush#KR1');
  assert.throws(() => normalizeGameName('태그없음'), isUserError(/게임이름#태그/));
  assert.throws(() => normalizeGameName('a#b#c'), isUserError(/게임이름#태그/));
});

test('대전 등록: 판 수 1~10, 등록자 자동 참가, 서버당 1개', () => {
  const { services, guild, register, create } = setup();
  assert.throws(() => create('nobody'), isUserError(/계정 등록/));
  register('u1');
  assert.throws(() => create('u1', 0), isUserError(/1~10판/));
  assert.throws(() => create('u1', 11), isUserError(/1~10판/));

  const match = create('u1', 5);
  assert.equal(match.game_count, 5);
  const view = services.matches.getMatchView(match.id);
  assert.equal(view.participants.length, 1);
  assert.equal(view.participants[0].game_name, 'u1#KR1');
  assert.equal(view.creatorDiscordUserId, 'u1');
  assert.throws(() => create('u1'), isUserError(/하나만/));

  services.matches.setMatchMessage(match.id, 'chan', 'msg');
  assert.equal(services.matches.getMatchView(match.id).match.message_id, 'msg');
  assert.equal(services.guilds.ensureGuild('guild-1').id, guild.id);
});

test('대전 참가: 롤 아이디 필수, 10명 제한, 옛 대전 버튼 차단, 마지막 아이디 기억', () => {
  const { services, guild, users, register, create, join } = setup();
  users.forEach((u) => register(u));
  const match = create(users[0]);
  assert.throws(
    () => services.matches.join({ guildId: guild.id, discordUserId: users[1], gameName: '형식틀림' }),
    isUserError(/게임이름#태그/),
  );
  assert.throws(
    () => services.matches.join({ guildId: guild.id, discordUserId: users[1], matchId: match.id + 1, gameName: 'abc#KR1' }),
    isUserError(/종료되었거나 취소/),
  );
  for (const u of users.slice(1, 10)) join(u);
  assert.throws(() => join(users[1]), isUserError(/이미/));
  assert.throws(() => join(users[10]), isUserError(/모두 찼/));
  assert.equal(services.accounts.getActiveMember(guild.id, users[1]).last_game_name, `${users[1]}#KR1`);

  assert.equal(services.matches.leave({ guildId: guild.id, discordUserId: users[1] }).count, 9);
});

test('포지션 등록/변경/해제 (대전마다 따로)', () => {
  const { services, guild, register, create } = setup();
  register('u1');
  const match = create('u1');
  services.matches.setPosition({ guildId: guild.id, discordUserId: 'u1', position: 'MID' });
  assert.equal(services.matches.getMatchView(match.id).participants[0].position, 'MID');
  services.matches.setPosition({ guildId: guild.id, discordUserId: 'u1', position: null });
  assert.equal(services.matches.getMatchView(match.id).participants[0].position, null);
});

test('권한: 대전 시작/기록/종료는 관리자 또는 등록자만', () => {
  const { services, guild, users, fill } = setup();
  fill();
  assert.throws(
    () => services.matches.checkManager({ guildId: guild.id, discordUserId: users[1] }),
    isUserError(/권한이 없습니다/),
  );
  services.matches.checkManager({ guildId: guild.id, discordUserId: users[0] });
  // 관리자는 계정 등록이 없어도 관리할 수 있다
  services.matches.checkManager({ guildId: guild.id, discordUserId: 'admin', isAdmin: true });
});

test('대전 시작: 10명이 모여야 가능 (팀 구성은 필요 없음)', () => {
  const { services, guild, users, register, create, join } = setup();
  users.slice(0, 10).forEach((u) => register(u));
  create(users[0]);
  users.slice(1, 9).forEach((u) => join(u));
  assert.throws(
    () => services.matches.start({ guildId: guild.id, discordUserId: users[0] }),
    isUserError(/10명이어야/),
  );
  join(users[9]);
  const view = services.matches.start({ guildId: guild.id, discordUserId: users[0] });
  assert.equal(view.match.status, 'IN_PROGRESS');
  assert.throws(() => services.matches.leave({ guildId: guild.id, discordUserId: users[1] }), isUserError(/이미 시작/));
  assert.throws(
    () => services.accounts.withdraw({ guildId: guild.id, discordUserId: users[1] }),
    isUserError(/진행 중인 대전/),
  );
});

test('판 기록: 승리자 5명, 판 수만큼만, 판 번호 순서', () => {
  const { services, guild, users, fill } = setup();
  fill(2);
  const base = { guildId: guild.id, discordUserId: users[0] };
  assert.throws(() => services.matches.checkCanRecord(base), isUserError(/대전 시작/));
  services.matches.start(base);

  assert.equal(services.matches.checkCanRecord(base).gameNo, 1);
  assert.throws(
    () => services.matches.recordGame({ ...base, gameNo: 1, winnerDiscordUserIds: users.slice(0, 4) }),
    isUserError(/정확히 5명/),
  );
  assert.throws(
    () => services.matches.recordGame({ ...base, gameNo: 1, winnerDiscordUserIds: [...users.slice(0, 4), 'outsider'] }),
    isUserError(/참가자만/),
  );
  services.matches.recordGame({ ...base, gameNo: 1, winnerDiscordUserIds: users.slice(0, 5), screenshotPath: 'a.png' });
  assert.throws(
    () => services.matches.recordGame({ ...base, gameNo: 1, winnerDiscordUserIds: users.slice(5, 10) }),
    isUserError(/이미 기록/),
  );
  services.matches.recordGame({ ...base, gameNo: 2, winnerDiscordUserIds: users.slice(0, 5) });
  assert.throws(() => services.matches.checkCanRecord(base), isUserError(/모두 기록/));

  const { games } = services.matches.getMatchView(services.matches.getActiveMatch(guild.id).id);
  assert.deepEqual(games.map((g) => g.game_no), [1, 2]);
  assert.equal(games[0].screenshot_path, 'a.png');
  assert.deepEqual([...games[0].winnerDiscordUserIds].sort(), users.slice(0, 5).sort());
});

test('승점: 판 1승당 1점, 종료된 대전만 반영, 서버별 계산', () => {
  const { services, guild, users, fill } = setup();
  const guild2 = services.guilds.ensureGuild('guild-2');
  fill(3);
  users.slice(0, 10).forEach((u) => services.accounts.register({ guildId: guild2.id, discordUserId: u }));
  const base = { guildId: guild.id, discordUserId: users[0] };
  services.matches.start(base);
  services.matches.recordGame({ ...base, gameNo: 1, winnerDiscordUserIds: users.slice(0, 5) });
  services.matches.recordGame({ ...base, gameNo: 2, winnerDiscordUserIds: users.slice(0, 5) });
  services.matches.recordGame({ ...base, gameNo: 3, winnerDiscordUserIds: users.slice(5, 10) });

  // 종료 전에는 반영되지 않는다
  assert.equal(services.points.getStats(guild.id, users[0]).points, 0);
  const view = services.matches.finish(base);
  assert.equal(view.match.status, 'FINISHED');
  assert.equal(services.matches.getActiveMatch(guild.id), null);

  const pick = ({ games, wins, losses, points }) => ({ games, wins, losses, points });
  assert.deepEqual(pick(services.points.getStats(guild.id, users[0])), { games: 3, wins: 2, losses: 1, points: 2 });
  assert.deepEqual(pick(services.points.getStats(guild.id, users[9])), { games: 3, wins: 1, losses: 2, points: 1 });
  assert.equal(services.points.getRanking(guild.id)[0].points, 2);
  assert.equal(services.points.getStats(guild2.id, users[0]).points, 0);
});

test('팀 기준 판 기록 (관리자 커맨드): 셔플 후 승리팀 5명', () => {
  const { services, guild, users, fill } = setup();
  fill(1);
  const base = { guildId: guild.id, discordUserId: users[0] };
  services.matches.start(base);
  assert.throws(() => services.matches.recordGameByTeam({ ...base, winnerSide: 'RED' }), isUserError(/팀 구성/));
  const match = services.matches.getActiveMatch(guild.id);
  services.matches.finish(base);
  assert.equal(services.matches.getMatchView(match.id).games.length, 0);
});

test('대전 취소 후 새 대전을 등록할 수 있다', () => {
  const { services, guild, register, create, join } = setup();
  register('u1');
  register('u2');
  create('u1');
  join('u2');
  assert.throws(() => services.matches.cancel({ guildId: guild.id, discordUserId: 'u2' }), isUserError(/권한/));
  services.matches.cancel({ guildId: guild.id, discordUserId: 'u1' });
  create('u2');
});

test('계정 탈퇴 시 모집 중인 대전에서도 빠진다', () => {
  const { services, guild, register, create, join } = setup();
  register('u1');
  register('u2');
  const match = create('u1');
  join('u2');
  assert.equal(services.accounts.withdraw({ guildId: guild.id, discordUserId: 'u2' }).leftMatchId, match.id);
  assert.equal(services.matches.getMatchView(match.id).participants.length, 1);
});

test('셔플: 10명일 때 5:5, 팀 등록자 유지, 포지션 우선', () => {
  const { services, guild, users, fill } = setup();
  fill();
  const positions = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
  users.slice(0, 10).forEach((u, i) =>
    services.matches.setPosition({ guildId: guild.id, discordUserId: u, position: positions[i % 5] }),
  );
  services.teams.joinTeam({ guildId: guild.id, discordUserId: users[0], side: 'BLUE' });
  for (let i = 0; i < 10; i += 1) {
    const view = services.teams.shuffle({ guildId: guild.id, discordUserId: users[0] });
    assert.equal(view.red.length, 5);
    assert.ok(view.blue.some((p) => p.discord_user_id === users[0]));
    for (const team of [view.red, view.blue]) assert.equal(new Set(team.map((p) => p.position)).size, 5);
  }
});

test('DB 제약: 서버당 활성 대전 1개, 판 번호 중복 불가', () => {
  const { db, guild } = setup();
  const { lastInsertRowid } = db.prepare('INSERT INTO match (guild_id) VALUES (?)').run(guild.id);
  assert.throws(() => db.prepare('INSERT INTO match (guild_id) VALUES (?)').run(guild.id), /UNIQUE/);
  db.prepare('INSERT INTO match_record (match_id, game_no) VALUES (?, 1)').run(lastInsertRowid);
  assert.throws(() => db.prepare('INSERT INTO match_record (match_id, game_no) VALUES (?, 1)').run(lastInsertRowid), /UNIQUE/);
});
