// 버튼/선택 메뉴/입력창 흐름을 가짜 디스코드 객체로 처음부터 끝까지 확인한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { openDatabase } = require('../src/db');
const { createServices } = require('../src/services');
const { commands } = require('../src/commands');
const { createInteractionHandler } = require('../src/interactions/router');
const { createCommandLogger } = require('../src/utils/commandLogger');

const isEphemeral = (payload) => Boolean(payload && payload.flags & MessageFlags.Ephemeral);
const textOf = (payload) => (typeof payload === 'string' ? payload : payload?.content ?? '');

function createFakeDiscord() {
  let seq = 0;
  const messages = new Map();
  const sent = [];
  const channel = {
    id: 'chan-1',
    async send(payload) {
      const message = {
        id: `msg-${(seq += 1)}`,
        payload,
        async edit(p) {
          message.payload = p;
          return message;
        },
      };
      messages.set(message.id, message);
      sent.push(message);
      return message;
    },
    messages: { fetch: async (id) => messages.get(id) },
  };
  const client = { channels: { fetch: async () => channel } };
  return { channel, client, sent };
}

function createHarness() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bot-e2e-'));
  const db = openDatabase(':memory:');
  const services = createServices(db);
  const discord = createFakeDiscord();
  const config = { recordsDir: path.join(tmp, 'records') };
  const handler = createInteractionHandler({
    services,
    commandMap: new Map(commands.map((c) => [c.data.name, c])),
    commandLogger: createCommandLogger({ dir: path.join(tmp, 'logs') }),
    config,
    client: discord.client,
    fetchImpl: async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }),
  });

  async function send({ kind, user, admin = false, customId, values, fields = {}, command, sub }) {
    const calls = [];
    const record = (type) => async (payload) => {
      calls.push({ type, payload });
      if (type === 'reply' || type === 'update') interaction.replied = true;
      if (type === 'deferReply') interaction.deferred = true;
      if (type === 'editReply') interaction.replied = true;
    };
    const interaction = {
      customId,
      values,
      commandName: command,
      guildId: 'guild-1',
      guild: { name: '테스트 서버' },
      channelId: discord.channel.id,
      channel: discord.channel,
      client: discord.client,
      user: { id: user, username: user, globalName: user },
      member: { displayName: `${user}님` },
      memberPermissions: { has: () => admin },
      replied: false,
      deferred: false,
      inGuild: () => true,
      isChatInputCommand: () => kind === 'command',
      isButton: () => kind === 'button',
      isStringSelectMenu: () => kind === 'select',
      isModalSubmit: () => kind === 'modal',
      options: { getSubcommand: () => sub, getString: () => null, getUser: () => null, data: [{ name: sub, options: [] }] },
      fields: {
        getTextInputValue: (id) => {
          if (!(id in fields)) throw new Error('no field');
          return fields[id];
        },
        getStringSelectValues: (id) => fields[id],
        getUploadedFiles: (id) => ({ first: () => fields[id] }),
      },
      reply: record('reply'),
      update: record('update'),
      editReply: record('editReply'),
      followUp: record('followUp'),
      deferReply: record('deferReply'),
      showModal: record('showModal'),
    };
    await handler(interaction);
    return calls;
  }

  return { tmp, services, discord, send };
}

test('버튼 흐름: 패널 → 계정 등록 → 대전 등록 → 참가 → 시작 → 판 기록 → 종료', async () => {
  const { tmp, services, discord, send } = createHarness();
  const users = Array.from({ length: 10 }, (_, i) => `u${i + 1}`);

  // 일반 사용자는 커맨드를 쓸 수 없다
  let calls = await send({ kind: 'command', user: 'u1', command: '대전', sub: '관리' });
  assert.match(textOf(calls[0].payload), /권한이 없습니다/);
  assert.ok(isEphemeral(calls[0].payload));

  // 관리자가 /대전 관리 → 모두에게 보이는 패널
  calls = await send({ kind: 'command', user: 'admin', admin: true, command: '대전', sub: '관리' });
  assert.equal(calls[0].type, 'reply');
  assert.ok(!isEphemeral(calls[0].payload), '패널은 모두에게 보여야 한다');
  assert.equal(calls[0].payload.components.length, 1);
  const matchPanelButtons = calls[0].payload.components[0].toJSON().components.map((c) => c.label);
  assert.deepEqual(matchPanelButtons, ['대전 등록', '진행중인 대전 조회'], '대전 패널에는 계정 버튼이 없다');

  // 계정이 없으면 대전 등록 불가 → 계정관리 채널 안내
  calls = await send({ kind: 'button', user: 'u1', customId: 'panel.create' });
  assert.match(textOf(calls[0].payload), /계정관리 채널에서 \[계정 등록\]/);

  // 관리자가 계정관리 채널에서 /계정 관리 → 모두에게 보이는 계정 패널
  calls = await send({ kind: 'command', user: 'admin', admin: true, command: '계정', sub: '관리' });
  assert.ok(!isEphemeral(calls[0].payload), '계정 패널은 모두에게 보여야 한다');
  const accountButtons = calls[0].payload.components[0].toJSON().components.map((c) => c.label);
  assert.deepEqual(accountButtons, ['계정 등록', '계정 탈퇴']);
  calls = await send({ kind: 'command', user: 'u1', command: '계정', sub: '관리' });
  assert.match(textOf(calls[0].payload), /권한이 없습니다/);

  // 계정 등록 (본인만 보임)
  for (const u of users) {
    calls = await send({ kind: 'button', user: u, customId: 'panel.register' });
    assert.match(textOf(calls[0].payload), /계정이 등록되었습니다/);
    assert.ok(isEphemeral(calls[0].payload));
  }

  // 대전 등록: 버튼 → 판 수 선택 → 롤 아이디 입력
  calls = await send({ kind: 'button', user: 'u1', customId: 'panel.create' });
  assert.ok(isEphemeral(calls[0].payload));
  calls = await send({ kind: 'select', user: 'u1', customId: 'create.games', values: ['2'] });
  assert.equal(calls[0].type, 'showModal');
  calls = await send({ kind: 'modal', user: 'u1', customId: 'create.modal|2', fields: { gameName: 'u1#KR1' } });
  assert.match(textOf(calls[0].payload), /대전 #1\*\*\(2판\)이 등록되었고/);
  assert.ok(isEphemeral(calls[0].payload), '등록자 관리 패널은 본인만');
  assert.equal(discord.sent.length, 1, '공개 대전 정보 메시지가 올라가야 한다');
  const matchMessage = discord.sent[0];
  assert.ok(!matchMessage.payload.flags, '대전 정보 메시지는 모두에게 보인다');

  // 두 번째 대전 등록은 막힌다
  calls = await send({ kind: 'button', user: 'u2', customId: 'panel.create' });
  assert.match(textOf(calls[0].payload), /하나만/);

  // 나머지 9명 참가 (버튼 → 아이디 입력창)
  for (const u of users.slice(1)) {
    calls = await send({ kind: 'button', user: u, customId: 'match.join|1' });
    assert.equal(calls[0].type, 'showModal');
    calls = await send({ kind: 'modal', user: u, customId: 'match.joinModal|1', fields: { gameName: `${u}#KR1` } });
    assert.match(textOf(calls[0].payload), /참가했습니다/);
    assert.ok(isEphemeral(calls[0].payload), '참가 알림은 본인만');
  }
  const fieldText = JSON.stringify(matchMessage.payload.embeds[0].toJSON());
  assert.match(fieldText, /참가자 \(10\/10\)/, '공개 메시지의 참가자 수가 갱신된다');

  // 포지션 등록
  calls = await send({ kind: 'button', user: 'u2', customId: 'match.position|1' });
  assert.ok(isEphemeral(calls[0].payload));
  calls = await send({ kind: 'select', user: 'u2', customId: 'match.positionSelect|1', values: ['MID'] });
  assert.equal(calls[0].type, 'update');
  assert.match(textOf(calls[0].payload), /미드/);

  // 대전 조회 (본인만, 포지션/아이디 표시)
  calls = await send({ kind: 'button', user: 'u3', customId: 'match.view|1' });
  assert.ok(isEphemeral(calls[0].payload));
  assert.match(JSON.stringify(calls[0].payload.embeds[0].toJSON()), /미드.*u2#KR1/);

  // 대전 관리: 일반 참가자는 권한 없음, 관리자/등록자는 가능
  calls = await send({ kind: 'button', user: 'u5', customId: 'match.manage|1' });
  assert.match(textOf(calls[0].payload), /권한이 없습니다/);
  calls = await send({ kind: 'button', user: 'admin', admin: true, customId: 'match.manage|1' });
  assert.match(textOf(calls[0].payload), /대전 #1 관리/);

  // 대전 시작
  calls = await send({ kind: 'button', user: 'u1', customId: 'control.start|1' });
  assert.equal(calls[0].type, 'update');
  assert.match(textOf(calls[0].payload), /대전을 시작했습니다/);

  // 대전 기록: 버튼 → 캡쳐 + 승리자 5명 입력창
  calls = await send({ kind: 'button', user: 'u1', customId: 'control.record|1' });
  assert.equal(calls[0].type, 'showModal');
  const attachment = { url: 'https://cdn.example/r.png', name: 'r.png', contentType: 'image/png', size: 3 };
  calls = await send({
    kind: 'modal',
    user: 'u1',
    customId: 'control.recordModal|1|1',
    fields: { winners: users.slice(0, 5), screenshot: attachment },
  });
  assert.equal(calls[0].type, 'deferReply');
  assert.ok(isEphemeral(calls[0].payload));
  assert.match(textOf(calls[1].payload), /1판\*\* 결과를 기록했습니다/);
  const saved = path.join(tmp, 'records', 'guild-1', 'match-1-game-1.png');
  assert.ok(fs.existsSync(saved), '캡쳐가 저장되어야 한다');

  // 이미지가 아닌 파일은 거부
  calls = await send({
    kind: 'modal',
    user: 'u1',
    customId: 'control.recordModal|1|2',
    fields: { winners: users.slice(5), screenshot: { ...attachment, contentType: 'text/plain' } },
  });
  assert.match(textOf(calls.at(-1).payload), /이미지 파일/);

  // 대전 종료 → 모두에게 보이는 종료 알림 (캡쳐 첨부)
  calls = await send({ kind: 'button', user: 'u1', customId: 'control.finish|1' });
  assert.equal(calls[0].type, 'update');
  assert.equal(discord.sent.length, 2);
  const finish = discord.sent[1].payload;
  assert.match(finish.content, /대전 #1이\(가\) 종료되었습니다/);
  assert.equal(finish.files.length, 1);
  assert.match(JSON.stringify(finish.embeds[0].toJSON()), /2판 중 \*\*1판\*\* 기록/);
  assert.equal(matchMessage.payload.components.length, 0, '종료 후 공개 메시지 버튼은 사라진다');

  // 승점 반영 (판 1승 = 1점)
  assert.equal(services.points.getStats(1, 'u1').points, 1);
  assert.equal(services.points.getStats(1, 'u6').points, 0);

  // 끝난 대전의 옛 버튼
  calls = await send({ kind: 'button', user: 'u2', customId: 'match.join|1' });
  assert.match(textOf(calls[0].payload), /진행 중인 대전이 없습니다/);

  // 서버별 로그
  const log = fs.readFileSync(path.join(tmp, 'logs', 'guild-1.log'), 'utf8');
  assert.match(log, /\[버튼\] 대전 참가 \| u2님 \(u2, u2\) \| 성공/);
  assert.match(log, /\[입력\] 대전 참가 - 롤 아이디 입력: u3#KR1/);
  assert.match(log, /\[버튼\] 대전 관리 \| u5님 .* \| 실패 \| ⚠️ 권한이 없습니다/);
});
