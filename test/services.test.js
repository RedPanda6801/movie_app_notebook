const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { UserError } = require('../src/utils/errors');

const isUserError = (pattern) => (err) => err instanceof UserError && pattern.test(err.message);

test('계정: 사용자당 1계정, 서버별 가입/탈퇴', () => {
  const { services, guild, register } = setup();
  const guild2 = services.guilds.ensureGuild('guild-2', '두번째 서버');

  register('u1');
  assert.throws(() => register('u1'), isUserError(/이미/));
  register('u1', guild2); // 다른 서버에는 가입 가능


  services.accounts.withdraw({ guildId: guild.id, discordUserId: 'u1' });
  assert.throws(() => services.accounts.getActiveMember(guild.id, 'u1'), isUserError(/등록된 계정이 없/));
  // 다른 서버 가입에는 영향 없음
  assert.equal(services.accounts.getActiveMember(guild2.id, 'u1').status, 'ACTIVE');

  const { reactivated } = register('u1');
  assert.equal(reactivated, true);
});

test('account 행은 서버가 달라도 1개만 생긴다', () => {
  const { db, services, register } = setup();
  const guild2 = services.guilds.ensureGuild('guild-2');
  register('u1');
  register('u1', guild2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM account').get().n, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM guild_member').get().n, 2);
});

test('대전: 미등록자는 참가 불가, 첫 참가 시 대전 자동 생성, 10명 제한', () => {
  const { services, guild, users, register, join } = setup();
  assert.throws(() => join('nobody'), isUserError(/계정 등록/));

  users.forEach((u) => register(u));
  const first = join(users[0]);
  assert.equal(first.created, true);
  assert.throws(() => join(users[0]), isUserError(/이미/));
  for (const u of users.slice(1, 10)) join(u);
  assert.throws(() => join(users[10]), isUserError(/모두 찼/));

  assert.equal(services.matches.getMatchView(first.match.id).participants.length, 10);
  assert.equal(services.matches.leave({ guildId: guild.id, discordUserId: users[0] }).count, 9);
});

test('대전: 서버당 진행 중인 대전은 1개, 서버끼리는 독립', () => {
  const { services, guild, register } = setup();
  const guild2 = services.guilds.ensureGuild('guild-2');
  register('u1');
  register('u1', guild2);
  services.matches.createMatch({ guildId: guild.id, discordUserId: 'u1', channelId: 'c' });
  assert.throws(
    () => services.matches.createMatch({ guildId: guild.id, discordUserId: 'u1', channelId: 'c' }),
    isUserError(/하나만/),
  );
  // 다른 서버에서는 별도로 열 수 있다
  services.matches.createMatch({ guildId: guild2.id, discordUserId: 'u1', channelId: 'c' });
});

test('DB 제약: 서버당 활성 대전 1개 (부분 UNIQUE 인덱스)', () => {
  const { db, guild } = setup();
  db.prepare('INSERT INTO match (guild_id) VALUES (?)').run(guild.id);
  assert.throws(() => db.prepare('INSERT INTO match (guild_id) VALUES (?)').run(guild.id), /UNIQUE/);
});

test('포지션 선택/해제', () => {
  const { services, guild, register, join } = setup();
  register('u1');
  const { match } = join('u1');
  services.matches.setPosition({ guildId: guild.id, discordUserId: 'u1', position: 'MID' });
  assert.equal(services.matches.getMatchView(match.id).participants[0].position, 'MID');
  services.matches.setPosition({ guildId: guild.id, discordUserId: 'u1', position: null });
  assert.equal(services.matches.getMatchView(match.id).participants[0].position, null);
});

test('팀 등록/탈퇴: 팀당 5명 제한', () => {
  const { services, guild, users, register, join } = setup();
  users.slice(0, 10).forEach((u) => {
    register(u);
    join(u);
  });
  for (const u of users.slice(0, 5)) {
    services.teams.joinTeam({ guildId: guild.id, discordUserId: u, side: 'RED' });
  }
  assert.throws(
    () => services.teams.joinTeam({ guildId: guild.id, discordUserId: users[5], side: 'RED' }),
    isUserError(/이미 5명/),
  );
  services.teams.leaveTeam({ guildId: guild.id, discordUserId: users[0] });
  assert.throws(
    () => services.teams.leaveTeam({ guildId: guild.id, discordUserId: users[0] }),
    isUserError(/소속된 팀이 없/),
  );
  services.teams.joinTeam({ guildId: guild.id, discordUserId: users[5], side: 'RED' });
});

test('셔플: 10명 미만이면 불가, 팀 등록자는 유지, 포지션 우선', () => {
  const { services, guild, users, register, join } = setup();
  const positions = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
  users.slice(0, 10).forEach((u, i) => {
    register(u);
    join(u);
    services.matches.setPosition({ guildId: guild.id, discordUserId: u, position: positions[i % 5] });
  });
  services.matches.leave({ guildId: guild.id, discordUserId: users[9] });
  assert.throws(() => services.teams.shuffle({ guildId: guild.id, discordUserId: users[0] }), isUserError(/10명/));
  join(users[9]);
  services.matches.setPosition({ guildId: guild.id, discordUserId: users[9], position: 'SUPPORT' });

  services.teams.joinTeam({ guildId: guild.id, discordUserId: users[0], side: 'BLUE' }); // TOP
  services.teams.joinTeam({ guildId: guild.id, discordUserId: users[1], side: 'BLUE' }); // JUNGLE

  for (let i = 0; i < 20; i += 1) {
    const view = services.teams.shuffle({ guildId: guild.id, discordUserId: users[0] });
    assert.equal(view.red.length, 5);
    assert.equal(view.blue.length, 5);
    assert.equal(view.unassigned.length, 0);
    const blueIds = view.blue.map((p) => p.discord_user_id);
    assert.ok(blueIds.includes(users[0]) && blueIds.includes(users[1]));
    for (const team of [view.red, view.blue]) {
      assert.equal(new Set(team.map((p) => p.position)).size, 5, '팀마다 포지션 5개가 모두 달라야 한다');
    }
  }
});

test('전체 흐름: 셔플 → 시작 → 결과 → 승점 (1승 1점, 감점 없음)', () => {
  const { services, guild, users, register, join } = setup();
  users.slice(0, 10).forEach((u) => {
    register(u);
    join(u);
  });
  const owner = users[0];
  const other = users[1];

  assert.throws(
    () => services.matches.start({ guildId: guild.id, discordUserId: owner }),
    isUserError(/팀 구성/),
  );
  services.teams.shuffle({ guildId: guild.id, discordUserId: other });
  assert.throws(
    () => services.matches.start({ guildId: guild.id, discordUserId: other }),
    isUserError(/대전을 만든 사람/),
  );
  services.matches.start({ guildId: guild.id, discordUserId: other, isServerManager: true });

  // 진행 중에는 참가자/팀 변경 불가
  assert.throws(() => services.matches.leave({ guildId: guild.id, discordUserId: other }), isUserError(/이미 시작/));
  assert.throws(
    () => services.accounts.withdraw({ guildId: guild.id, discordUserId: other }),
    isUserError(/진행 중인 대전/),
  );

  const view = services.matches.finish({ guildId: guild.id, discordUserId: owner, winnerSide: 'RED' });
  assert.equal(view.match.status, 'FINISHED');
  assert.equal(view.record.winner_side, 'RED');
  assert.equal(services.matches.getActiveMatch(guild.id), null);

  const winner = view.red[0].discord_user_id;
  const loser = view.blue[0].discord_user_id;
  assert.deepEqual(
    (({ games, wins, losses, points }) => ({ games, wins, losses, points }))(services.points.getStats(guild.id, winner)),
    { games: 1, wins: 1, losses: 0, points: 1 },
  );
  assert.equal(services.points.getStats(guild.id, loser).points, 0);

  const ranking = services.points.getRanking(guild.id);
  assert.equal(ranking[0].points, 1);
  assert.equal(ranking.filter((r) => r.points === 1).length, 5);

  // 다음 대전을 새로 열 수 있다
  assert.equal(join(owner).created, true);
});

test('승점은 서버별로 따로 계산된다', () => {
  const { services, guild, users, register, join } = setup();
  const guild2 = services.guilds.ensureGuild('guild-2');
  users.slice(0, 10).forEach((u) => {
    register(u);
    join(u);
    register(u, guild2);
  });
  services.teams.shuffle({ guildId: guild.id, discordUserId: users[0] });
  services.matches.start({ guildId: guild.id, discordUserId: users[0] });
  services.matches.finish({ guildId: guild.id, discordUserId: users[0], winnerSide: 'BLUE' });

  const total = users.slice(0, 10).reduce((s, u) => s + services.points.getStats(guild.id, u).points, 0);
  assert.equal(total, 5);
  for (const u of users.slice(0, 10)) assert.equal(services.points.getStats(guild2.id, u).points, 0);
});

test('계정 탈퇴 시 모집 중인 대전에서도 빠지고, 승점 기록은 남는다', () => {
  const { services, guild, register, join } = setup();
  register('u1');
  const { match } = join('u1');
  const { leftMatchId } = services.accounts.withdraw({ guildId: guild.id, discordUserId: 'u1' });
  assert.equal(leftMatchId, match.id);
  assert.equal(services.matches.getMatchView(match.id).participants.length, 0);
  assert.equal(services.points.getStats(guild.id, 'u1').member.status, 'WITHDRAWN');
});

test('대전 취소 후 새 대전을 열 수 있다', () => {
  const { services, guild, register, join } = setup();
  register('u1');
  register('u2');
  join('u1');
  join('u2');
  assert.throws(() => services.matches.cancel({ guildId: guild.id, discordUserId: 'u2' }), isUserError(/만든 사람/));
  services.matches.cancel({ guildId: guild.id, discordUserId: 'u1' });
  assert.equal(join('u2').created, true);
});

test('서버 참가/퇴장 상태 관리', () => {
  const { db, services } = setup();
  services.guilds.markLeft('guild-1');
  assert.equal(db.prepare("SELECT status FROM guild WHERE discord_guild_id='guild-1'").get().status, 'LEFT');
  assert.equal(services.guilds.ensureGuild('guild-1').status, 'ACTIVE');
});
