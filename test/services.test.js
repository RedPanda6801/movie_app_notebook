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
  assert.throws(() => normalizeGameName('드므드므드#KR!'), isUserError(/특수문자/), '태그에 특수문자 불가');
  assert.throws(() => normalizeGameName('ab#KR1'), isUserError(/3~16자/), '게임이름 3자 이상');
  assert.equal(normalizeGameName('드므드므드#KR1'), '드므드므드#KR1');
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
  assert.equal(view.participants[0].game_name, 'lolu1#KR1');
  assert.equal(view.creatorDiscordUserId, 'u1');
  assert.throws(() => create('u1'), isUserError(/하나만/));

  services.matches.setMatchMessage(match.id, 'chan', 'msg');
  assert.equal(services.matches.getMatchView(match.id).match.message_id, 'msg');
  assert.equal(services.guilds.ensureGuild('guild-1').id, guild.id);
});

test('대전 참가: 롤 아이디 필수, 10명 제한, 옛 대전 버튼 차단, 마지막 아이디 기억', () => {
  const { services, guild, users, register, create, join, gameName } = setup();
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
  assert.equal(services.accounts.getActiveMember(guild.id, users[1]).last_game_name, gameName(users[1]));

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

/** 셔플로 5:5를 만들고 시작한다. */
function startWithTeams({ services, guild, users }) {
  const base = { guildId: guild.id, discordUserId: users[0] };
  services.teams.shuffle(base);
  services.matches.start(base);
  return base;
}

/** 참가자 전원 K/D/A/CS (참가 id 기반으로 서로 다른 값) */
function statsFor(list, f = (p) => ({ kills: p.id % 7, deaths: p.id % 3, assists: p.id % 5, cs: 100 + p.id })) {
  return list.map((p) => ({ participantId: p.id, ...f(p) }));
}

test('대전 시작: 10명 + 1팀 5명 · 2팀 5명이어야 가능', () => {
  const { services, guild, users, register, create, join } = setup();
  users.slice(0, 10).forEach((u) => register(u));
  create(users[0]);
  users.slice(1, 9).forEach((u) => join(u));
  const start = () => services.matches.start({ guildId: guild.id, discordUserId: users[0] });
  assert.throws(start, isUserError(/10명이어야/));
  join(users[9]);
  assert.throws(start, isUserError(/팀 구성이 끝나야/));
  services.teams.shuffle({ guildId: guild.id, discordUserId: users[0] });
  const view = start();
  assert.equal(view.match.status, 'IN_PROGRESS');
  assert.throws(() => services.matches.leave({ guildId: guild.id, discordUserId: users[1] }), isUserError(/이미 시작/));
  assert.throws(
    () => services.accounts.withdraw({ guildId: guild.id, discordUserId: users[1] }),
    isUserError(/진행 중인 대전/),
  );
});

test('판 기록: 승리팀 + 10명 K/D/A/CS 필수, 판 수만큼만, 팀/승패 저장', () => {
  const ctx = setup();
  const { services, guild, users, fill } = ctx;
  const match = fill(2);
  const base0 = { guildId: guild.id, discordUserId: users[0] };
  assert.throws(() => services.matches.checkCanRecord(base0), isUserError(/대전 시작/));
  const base = startWithTeams(ctx);

  const { gameNo, red, blue } = services.matches.checkCanRecord(base);
  assert.equal(gameNo, 1);
  assert.equal(red.length, 5);
  assert.equal(blue.length, 5);
  const all = [...red, ...blue];

  assert.throws(
    () => services.matches.recordGame({ ...base, gameNo: 1, winnerSide: 'PURPLE', stats: statsFor(all) }),
    isUserError(/승리팀/),
  );
  assert.throws(
    () => services.matches.recordGame({ ...base, gameNo: 1, winnerSide: 'RED', stats: statsFor(all.slice(1)) }),
    isUserError(/10명의 킬\/데스\/어시\/CS/),
  );
  assert.throws(
    () =>
      services.matches.recordGame({
        ...base,
        gameNo: 1,
        winnerSide: 'RED',
        stats: statsFor(all, () => ({ kills: -1, deaths: 0, assists: 0, cs: 0 })),
      }),
    isUserError(/모두 입력/),
  );
  services.matches.recordGame({ ...base, gameNo: 1, winnerSide: 'RED', stats: statsFor(all), screenshotPath: 'a.png' });
  assert.throws(
    () => services.matches.recordGame({ ...base, gameNo: 1, winnerSide: 'BLUE', stats: statsFor(all) }),
    isUserError(/이미 기록/),
  );
  services.matches.recordGame({ ...base, gameNo: 2, winnerSide: 'BLUE', stats: statsFor(all) });
  assert.throws(() => services.matches.checkCanRecord(base), isUserError(/모두 기록/));

  const { games } = services.matches.getMatchView(match.id);
  assert.deepEqual(games.map((g) => [g.game_no, g.winnerSide]), [[1, 'RED'], [2, 'BLUE']]);
  assert.equal(games[0].screenshot_path, 'a.png');
  assert.equal(games[0].players.length, 10);
  const p = games[0].players.find((x) => x.guild_member_id === red[0].guild_member_id);
  assert.deepEqual(
    { side: p.side, win: p.is_win, k: p.kills, d: p.deaths, a: p.assists, cs: p.cs, name: p.game_name },
    {
      side: 'RED',
      win: 1,
      k: red[0].id % 7,
      d: red[0].id % 3,
      a: red[0].id % 5,
      cs: 100 + red[0].id,
      name: red[0].game_name,
    },
  );
  assert.deepEqual([...games[0].winnerDiscordUserIds].sort(), red.map((x) => x.discord_user_id).sort());
});

test('승점/전적: 판 1승당 1점, 종료된 대전만 반영, 서버별 계산', () => {
  const ctx = setup();
  const { services, guild, users, fill } = ctx;
  const guild2 = services.guilds.ensureGuild('guild-2');
  const match = fill(3);
  users.slice(0, 10).forEach((u) => services.accounts.register({ guildId: guild2.id, discordUserId: u }));
  const base = startWithTeams(ctx);
  const { red, blue } = services.matches.checkCanRecord(base);
  const all = [...red, ...blue];
  const fixed = () => ({ kills: 2, deaths: 1, assists: 3, cs: 100 });
  services.matches.recordGame({ ...base, gameNo: 1, winnerSide: 'RED', stats: statsFor(all, fixed) });
  services.matches.recordGame({ ...base, gameNo: 2, winnerSide: 'RED', stats: statsFor(all, fixed) });
  services.matches.recordGame({ ...base, gameNo: 3, winnerSide: 'BLUE', stats: statsFor(all, fixed) });

  const redUser = red[0].discord_user_id;
  const blueUser = blue[0].discord_user_id;
  // 종료 전에는 반영되지 않는다
  assert.equal(services.points.getStats(guild.id, redUser).points, 0);
  assert.equal(services.records.getMemberRecords(guild.id, redUser).summary.games, 0);
  // 대전별 전적은 진행 중에도 볼 수 있다
  assert.equal(services.records.getMatchRecords(guild.id, match.id).games.length, 3);

  services.matches.finish(base);
  const pick = ({ games, wins, losses, points }) => ({ games, wins, losses, points });
  assert.deepEqual(pick(services.points.getStats(guild.id, redUser)), { games: 3, wins: 2, losses: 1, points: 2 });
  assert.deepEqual(pick(services.points.getStats(guild.id, blueUser)), { games: 3, wins: 1, losses: 2, points: 1 });
  assert.equal(services.points.getRanking(guild.id)[0].points, 2);
  assert.equal(services.points.getStats(guild2.id, redUser).points, 0);

  // 개인별 전적: K/D/A/CS 합계와 평균, KDA
  const me = services.records.getMemberRecords(guild.id, redUser);
  assert.deepEqual(
    { k: me.summary.kills, d: me.summary.deaths, a: me.summary.assists, cs: me.summary.cs, kda: me.summary.kda },
    { k: 6, d: 3, a: 9, cs: 300, kda: 5 },
  );
  assert.equal(me.summary.avgCs, 100);
  assert.equal(me.recent.length, 3);
  assert.equal(me.recent[0].game_no, 3, '최근 판이 먼저');
  assert.throws(() => services.records.getMemberRecords(guild.id, 'nobody'), isUserError(/등록된 적이 없는/));

  // 대전별 전적: 참가자별 합계
  const byMatch = services.records.getMatchRecords(guild.id, match.id);
  assert.equal(byMatch.members.length, 10);
  assert.equal(byMatch.members.find((m) => m.discord_user_id === redUser).summary.wins, 2);
  assert.throws(() => services.records.getMatchRecords(guild2.id, match.id), isUserError(/찾을 수 없습니다/), '다른 서버 대전');

  // 전체 전적: 계정별 요약 + 판별 30행
  const all3 = services.records.getGuildRecords(guild.id);
  assert.equal(all3.members.length, 10);
  assert.equal(all3.rows.length, 30);
  assert.equal(services.records.listMatches(guild.id)[0].record_count, 3);
  assert.equal(services.records.getGuildRecords(guild2.id).rows.length, 0);
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

test('팀 등록/변경 (버튼): 1팀 · 2팀 · 미정, 팀당 5명, 같은 팀 재선택은 그대로', () => {
  const { services, guild, users, fill } = setup();
  const match = fill();
  const setTeam = (u, side) => services.teams.setTeam({ guildId: guild.id, discordUserId: u, matchId: match.id, side });
  const sideOf = (u) => services.matches.getMatchView(match.id).participants.find((p) => p.discord_user_id === u);

  // 기본값은 미정
  assert.equal(sideOf(users[1]).side, null);
  setTeam(users[1], 'RED');
  assert.equal(sideOf(users[1]).side, 'RED');
  assert.equal(sideOf(users[1]).is_team_locked, 1);
  setTeam(users[1], 'RED'); // 같은 팀 다시 선택해도 오류 없음
  setTeam(users[1], 'BLUE'); // 변경
  assert.equal(sideOf(users[1]).side, 'BLUE');
  setTeam(users[1], null); // 미정으로 되돌리기
  assert.equal(sideOf(users[1]).side, null);
  assert.equal(sideOf(users[1]).is_team_locked, 0);
  setTeam(users[1], null); // 이미 미정이어도 오류 없음

  users.slice(0, 5).forEach((u) => setTeam(u, 'RED'));
  assert.throws(() => setTeam(users[5], 'RED'), isUserError(/이미 5명/));
  assert.throws(() => setTeam(users[5], 'PURPLE'), isUserError(/알 수 없는 팀/));
});

test('팀 랜덤 셔플: 관리자/대전 등록자만, 2명 이상이면 가능, 직접 고른 팀은 유지', () => {
  const { services, guild, users, register, create, join } = setup();
  users.slice(0, 10).forEach((u) => register(u));
  const match = create(users[0]);
  const shuffle = (u, extra = {}) =>
    services.teams.shuffle({ guildId: guild.id, discordUserId: u, matchId: match.id, ...extra });

  assert.throws(() => shuffle(users[0]), isUserError(/2명 이상/));
  users.slice(1, 7).forEach((u) => join(u)); // 7명
  const partial = shuffle(users[0]);
  assert.equal(partial.red.length + partial.blue.length, 7, '10명이 안 되어도 셔플된다');
  assert.equal(partial.unassigned.length, 0);
  assert.ok(Math.abs(partial.red.length - partial.blue.length) <= 1);
  // 셔플 후 새 참가자가 오면 셔플 결과는 초기화된다 (직접 고른 사람 제외)
  users.slice(7, 10).forEach((u) => join(u));
  assert.equal(services.matches.getMatchView(match.id).unassigned.length, 10);
  assert.throws(() => shuffle(users[1]), isUserError(/권한이 없습니다/));
  services.teams.setTeam({ guildId: guild.id, discordUserId: users[3], matchId: match.id, side: 'BLUE' });

  const view = shuffle(users[0]);
  assert.equal(view.red.length, 5);
  assert.equal(view.blue.length, 5);
  assert.equal(view.unassigned.length, 0);
  assert.ok(view.blue.some((p) => p.discord_user_id === users[3]));
  shuffle('admin', { isAdmin: true }); // 관리자도 가능
});
