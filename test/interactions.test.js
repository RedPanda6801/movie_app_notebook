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

  let interactionSeq = 0;
  async function send({ kind, user, admin = false, customId, values, fields = {}, command, sub, opts = {}, focused = '' }) {
    const calls = [];
    const record = (type) => async (payload) => {
      calls.push({ type, payload });
      if (type === 'reply' || type === 'update') interaction.replied = true;
      if (type === 'deferReply') interaction.deferred = true;
      if (type === 'editReply') interaction.replied = true;
    };
    const interaction = {
      id: String(9000000000000 + (interactionSeq += 1)),
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
      isUserSelectMenu: () => kind === 'userSelect',
      isAutocomplete: () => kind === 'autocomplete',
      respond: record('respond'),
      isModalSubmit: () => kind === 'modal',
      options: {
        getSubcommand: () => sub,
        getString: (k) => opts[k] ?? null,
        getUser: () => null,
        getInteger: (k) => opts[k] ?? null,
        getAttachment: (k) => opts[k] ?? null,
        getFocused: () => focused,
        data: [{ name: sub, options: Object.entries(opts).map(([name, value]) => ({ name, value: value?.url ?? value })) }],
      },
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
      deferUpdate: record('deferUpdate'),
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
  assert.deepEqual(accountButtons, ['계정 등록', '아이디 변경', '선호 포지션', '계정 탈퇴']);
  calls = await send({ kind: 'command', user: 'u1', command: '계정', sub: '관리' });
  assert.match(textOf(calls[0].payload), /권한이 없습니다/);

  // 계정 등록: 버튼 → 롤 아이디 입력창 (계정당 1개, 본인만 보임)
  for (const u of users) {
    calls = await send({ kind: 'button', user: u, customId: 'panel.register' });
    assert.equal(calls[0].type, 'showModal');
    calls = await send({ kind: 'modal', user: u, customId: 'account.registerModal', fields: { gameName: `lol${u}#KR1` } });
    assert.match(textOf(calls[0].payload), /계정이 등록되었습니다/);
    assert.match(textOf(calls[0].payload), new RegExp(`lol${u}#KR1`));
    assert.ok(isEphemeral(calls[0].payload));
  }
  // 다른 사람이 등록한 아이디는 쓸 수 없다
  calls = await send({ kind: 'button', user: 'u11', customId: 'panel.register' });
  calls = await send({ kind: 'modal', user: 'u11', customId: 'account.registerModal', fields: { gameName: 'LOLU1#kr1' } });
  assert.match(textOf(calls[0].payload), /이미 다른 계정이 등록한 롤 아이디/);
  // 이미 등록한 계정은 [아이디 변경]으로
  calls = await send({ kind: 'button', user: 'u1', customId: 'panel.register' });
  assert.match(textOf(calls[0].payload), /\[아이디 변경\]/);
  calls = await send({ kind: 'button', user: 'u1', customId: 'account.changeId' });
  assert.equal(calls[0].payload.toJSON().components[0].component.value, 'lolu1#KR1', '현재 아이디가 채워져 있다');

  // 선호 포지션: u3은 원딜
  calls = await send({ kind: 'button', user: 'u3', customId: 'account.position' });
  assert.ok(isEphemeral(calls[0].payload));
  calls = await send({ kind: 'select', user: 'u3', customId: 'account.positionSelect', values: ['ADC'] });
  assert.match(textOf(calls[0].payload), /선호 포지션: \*\*원딜\*\*/);

  // 대전 등록: 버튼 → 판 수 선택 → 포지션 입력창 (롤 아이디는 입력하지 않음)
  calls = await send({ kind: 'button', user: 'u1', customId: 'panel.create' });
  assert.ok(isEphemeral(calls[0].payload));
  calls = await send({ kind: 'select', user: 'u1', customId: 'create.games', values: ['2'] });
  assert.equal(calls[0].type, 'showModal');
  const createModal = calls[0].payload.toJSON();
  assert.equal(createModal.components.length, 1, '포지션만 고른다');
  assert.equal(createModal.components[0].component.custom_id, 'position');
  calls = await send({ kind: 'modal', user: 'u1', customId: 'create.modal|2', fields: { position: ['MID'] } });
  assert.equal(calls[0].type, 'deferReply', '공개 메시지 게시 전에 먼저 응답을 예약한다 (3초 제한)');
  assert.ok(isEphemeral(calls[0].payload), '등록자 관리 패널은 본인만');
  assert.match(textOf(calls[1].payload), /대전 #1\*\*\(2판\)이 등록되었고/);
  assert.equal(discord.sent.length, 1, '공개 대전 정보 메시지가 올라가야 한다');
  const matchMessage = discord.sent[0];
  assert.ok(!matchMessage.payload.flags, '대전 정보 메시지는 모두에게 보인다');

  // 두 번째 대전 등록은 막힌다
  calls = await send({ kind: 'button', user: 'u2', customId: 'panel.create' });
  assert.match(textOf(calls[0].payload), /하나만/);

  // 참가 입력창: 포지션만 고르고, 기본값은 선호 포지션 (u3 = 원딜, 나머지 = 미정)
  calls = await send({ kind: 'button', user: 'u3', customId: 'match.join|1' });
  const joinModal = calls[0].payload.toJSON();
  assert.equal(joinModal.components.length, 1, '롤 아이디 입력 없이 포지션만');
  assert.equal(joinModal.components[0].component.options.find((o) => o.default)?.label, '원딜');
  calls = await send({ kind: 'button', user: 'u4', customId: 'match.join|1' });
  assert.equal(calls[0].payload.toJSON().components[0].component.options.find((o) => o.default)?.label, '미정');

  // 나머지 9명 참가 (버튼 → 포지션 입력창, 기본값 그대로 제출)
  for (const u of users.slice(1)) {
    calls = await send({ kind: 'button', user: u, customId: 'match.join|1' });
    assert.equal(calls[0].type, 'showModal');
    const defaultPosition = calls[0].payload.toJSON().components[0].component.options.find((o) => o.default).value;
    calls = await send({
      kind: 'modal',
      user: u,
      customId: 'match.joinModal|1',
      fields: { position: [defaultPosition] },
    });
    assert.equal(calls[0].type, 'reply', '공개 메시지 갱신보다 응답이 먼저다 (3초 제한)');
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

  // 포지션 선택 메뉴에 미정 옵션 (기본값)
  calls = await send({ kind: 'button', user: 'u4', customId: 'match.position|1' });
  const positionOptions = calls[0].payload.components[0].toJSON().components[0].options;
  assert.deepEqual(positionOptions.map((o) => o.label), ['탑', '정글', '미드', '원딜', '서폿', '미정']);
  assert.equal(positionOptions.find((o) => o.default)?.label, '미정');

  // 팀 등록/변경: 1팀 · 2팀 · 미정
  calls = await send({ kind: 'button', user: 'u2', customId: 'match.team|1' });
  assert.ok(isEphemeral(calls[0].payload));
  const teamOptions = calls[0].payload.components[0].toJSON().components[0].options;
  assert.deepEqual(teamOptions.map((o) => o.label), ['1팀', '2팀', '미정']);
  assert.equal(teamOptions.find((o) => o.default)?.label, '미정');
  calls = await send({ kind: 'select', user: 'u2', customId: 'match.teamSelect|1', values: ['BLUE'] });
  assert.equal(calls[0].type, 'update');
  assert.match(textOf(calls[0].payload), /2팀/);
  assert.match(JSON.stringify(matchMessage.payload.embeds[0].toJSON()), /2팀 \(1\/5\)/, '공개 메시지에 팀별 표시');

  // 팀 랜덤 셔플: 등록자가 아니면 권한 없음
  calls = await send({ kind: 'button', user: 'u5', customId: 'control.shuffle|1' });
  assert.match(textOf(calls[0].payload), /권한이 없습니다/);
  // 등록자의 관리 패널에서 셔플 → 1팀/2팀 구성 표시
  calls = await send({ kind: 'button', user: 'u1', customId: 'control.shuffle|1' });
  assert.equal(calls[0].type, 'update');
  const shuffled = JSON.stringify(calls[0].payload.embeds[0].toJSON());
  assert.match(shuffled, /1팀 \(5\/5\)/);
  assert.match(shuffled, /2팀 \(5\/5\)/);
  assert.ok(!/미정 \(/.test(shuffled), '셔플 후에는 미정 인원이 없다');
  const blue = services.matches.getMatchView(1).blue.map((p) => p.discord_user_id);
  assert.ok(blue.includes('u2'), '직접 고른 팀은 셔플에서 유지된다');

  // 대전 조회 (본인만, 포지션/아이디 표시)
  calls = await send({ kind: 'button', user: 'u3', customId: 'match.view|1' });
  assert.ok(isEphemeral(calls[0].payload));
  assert.match(JSON.stringify(calls[0].payload.embeds[0].toJSON()), /u2>.*미드.*lolu2#KR1/);

  // 대전 관리: 일반 참가자는 권한 없음, 관리자/등록자는 가능
  calls = await send({ kind: 'button', user: 'u5', customId: 'match.manage|1' });
  assert.match(textOf(calls[0].payload), /권한이 없습니다/);
  calls = await send({ kind: 'button', user: 'admin', admin: true, customId: 'match.manage|1' });
  assert.match(textOf(calls[0].payload), /대전 #1 관리/);

  // 대전 시작
  calls = await send({ kind: 'button', user: 'u1', customId: 'control.start|1' });
  assert.equal(calls[0].type, 'update');
  assert.match(textOf(calls[0].payload), /대전을 시작했습니다/);
  const shuffleButton = calls[0].payload.components[0].toJSON().components.find((c) => c.label === '팀 랜덤 셔플');
  assert.ok(!shuffleButton.disabled, '대전 시작 후에도 팀 랜덤 셔플을 누를 수 있다');
  calls = await send({ kind: 'button', user: 'u1', customId: 'control.shuffle|1' });
  assert.match(textOf(calls[0].payload), /다음 판\(1판\)부터 이 팀으로 기록됩니다/);

  // 대전 기록: 버튼 → 캡쳐 + 승리팀 + 팀별 K/D/A/CS 입력창 (팀원 이름이 미리 채워진 양식)
  calls = await send({ kind: 'button', user: 'u1', customId: 'control.record|1' });
  assert.equal(calls[0].type, 'showModal');
  const modal = calls[0].payload.toJSON();
  assert.equal(modal.components.length, 4);
  const redTemplate = modal.components[2].component.value;
  const blueTemplate = modal.components[3].component.value;
  assert.equal(redTemplate.split('\n').length, 5);
  assert.match(redTemplate, /^1\. .+ \(lol.+#KR1\) : 챔피언 0\/0\/0\/0$/m);
  const recordCustomId = modal.custom_id;
  assert.match(recordCustomId, /^control\.recordModal\|1\|1\|[0-9a-f]{8}$/, '팀 구성 서명 포함');
  let champSeq = 0;
  const fillIn = (template, k) => template.replace(/챔피언 0\/0\/0\/0/g, () => `챔피언${(champSeq += 1)} ${k}/1/2/150`);

  // 숫자를 덜 채우면 본인에게 안내 + 입력한 내용을 돌려준다
  const attachment = { url: 'https://cdn.example/r.png', name: 'r.png', contentType: 'image/png', size: 3 };
  calls = await send({
    kind: 'modal',
    user: 'u1',
    customId: recordCustomId,
    fields: {
      winnerSide: ['RED'],
      statsRED: redTemplate.split('\n').slice(0, 4).join('\n'),
      statsBLUE: blueTemplate,
      screenshot: attachment,
    },
  });
  assert.match(textOf(calls.at(-1).payload), /1팀 1번의 챔피언을 입력해 주세요|1팀 5번의 K\/D\/A\/CS가 입력되지 않았습니다/);
  assert.match(textOf(calls.at(-1).payload), /붙여넣고 고쳐 주세요/);

  calls = await send({
    kind: 'modal',
    user: 'u1',
    customId: recordCustomId,
    fields: {
      winnerSide: ['RED'],
      statsRED: fillIn(redTemplate, 7).replace(/챔피언\d+ 7\/1\/2\/150/, '제라스 7/1/2/150'),
      statsBLUE: fillIn(blueTemplate, 3),
      screenshot: attachment,
    },
  });
  assert.equal(calls[0].type, 'deferReply');
  assert.ok(isEphemeral(calls[0].payload));
  assert.match(textOf(calls[1].payload), /1판\*\* 결과를 기록했습니다/);
  const saved = path.join(tmp, 'records', 'guild-1', 'match-1-game-1.png');
  assert.ok(fs.existsSync(saved), '캡쳐가 저장되어야 한다');

  // 피어리스: 공개 대전 정보 메시지에 이전 판 챔피언 + 사용한 챔피언 목록
  const publicText = JSON.stringify(matchMessage.payload.embeds[0].toJSON());
  assert.match(publicText, /\(제라스\)/);
  assert.match(publicText, /🚫 피어리스 - 사용한 챔피언 \(10\)/);
  assert.match(publicText, /\*\*1판\*\* .*제라스/);

  // 피어리스: 진행 중 [대전 조회]에서 아이디(챔피언) 표시
  calls = await send({ kind: 'button', user: 'u9', customId: 'match.view|1' });
  assert.match(JSON.stringify(calls[0].payload.embeds[0].toJSON()), /🎮 lolu\d+#KR1\(제라스\)/);

  // 이미지가 아닌 파일은 거부
  calls = await send({
    kind: 'modal',
    user: 'u1',
    customId: 'control.recordModal|1|2',
    fields: { winnerSide: ['BLUE'], statsRED: fillIn(redTemplate, 1), statsBLUE: fillIn(blueTemplate, 1), screenshot: { ...attachment, contentType: 'text/plain' } },
  });
  assert.match(textOf(calls.at(-1).payload), /이미지 파일/);

  // 대전 종료 → 모두에게 보이는 종료 알림 (캡쳐 첨부, K/D/A 포함)
  calls = await send({ kind: 'button', user: 'u1', customId: 'control.finish|1' });
  assert.equal(calls[0].type, 'deferUpdate', '종료 알림 게시 전에 먼저 응답을 예약한다 (3초 제한)');
  assert.equal(calls[1].type, 'editReply');
  assert.equal(discord.sent.length, 2);
  const finish = discord.sent[1].payload;
  assert.match(finish.content, /대전 #1이\(가\) 종료되었습니다/);
  assert.equal(finish.files.length, 1);
  const finishText = JSON.stringify(finish.embeds[0].toJSON());
  assert.match(finishText, /2판 중 \*\*1판\*\* 기록/);
  assert.match(finishText, /1팀 승리/);
  assert.match(finishText, /7\/1\/2/);
  assert.match(finishText, /제라스/, '종료 알림에 챔피언 표시');
  assert.equal(matchMessage.payload.components.length, 0, '종료 후 공개 메시지 버튼은 사라진다');

  // 승점 반영 (판 1승 = 1점)
  // 참가 입력창에서 고른 포지션이 저장된다
  assert.equal(services.matches.getMatchView(1).participants.find((p) => p.discord_user_id === 'u3').position, 'ADC');
  const finalView = services.matches.getMatchView(1);
  const redUser = finalView.red[0].discord_user_id;
  const blueUser = finalView.blue[0].discord_user_id;
  assert.equal(services.points.getStats(1, redUser).points, 1);
  assert.equal(services.points.getStats(1, blueUser).points, 0);

  // ───── 전적관리 ─────
  calls = await send({ kind: 'command', user: 'admin', admin: true, command: '전적', sub: '관리' });
  assert.ok(!isEphemeral(calls[0].payload), '전적 패널은 모두에게 보여야 한다');
  assert.deepEqual(
    calls[0].payload.components[0].toJSON().components.map((c) => c.label),
    ['대전별 전적 조회', '개인별 전적 조회', '전체 전적 조회'],
  );

  // 대전별 전적: 대전 선택 → 참가자별 합계 → 판 선택(캡쳐 포함)
  calls = await send({ kind: 'button', user: 'u7', customId: 'stats.byMatch' });
  assert.ok(isEphemeral(calls[0].payload));
  assert.match(calls[0].payload.components[0].toJSON().components[0].options[0].label, /대전 #1/);
  calls = await send({ kind: 'select', user: 'u7', customId: 'stats.matchSelect', values: ['1'] });
  assert.ok(isEphemeral(calls[0].payload));
  const matchStats = JSON.stringify(calls[0].payload.embeds[0].toJSON());
  assert.match(matchStats, /참가자별 전적/);
  assert.match(matchStats, /1승 0패 \(100%\)/);
  assert.match(matchStats, /합계 7\/1\/2 · CS 150/);
  assert.match(matchStats, /lolu\d+#KR1\(제라스\)/, '피어리스: 아이디(챔피언)');
  calls = await send({ kind: 'select', user: 'u7', customId: 'stats.gameSelect|1', values: ['1'] });
  assert.equal(calls[0].type, 'deferUpdate');
  const gameStats = calls[1].payload;
  assert.match(JSON.stringify(gameStats.embeds[0].toJSON()), /1팀.*🏆 승/);
  assert.equal(gameStats.files.length, 1, '판 결과 캡쳐 첨부');

  // 개인별 전적: 계정 선택
  calls = await send({ kind: 'button', user: 'u7', customId: 'stats.byMember' });
  assert.ok(isEphemeral(calls[0].payload));
  calls = await send({ kind: 'userSelect', user: 'u7', customId: 'stats.memberSelect', values: [redUser] });
  const memberStats = JSON.stringify(calls[0].payload.embeds[0].toJSON());
  assert.match(memberStats, /1판 1승 0패/);
  assert.match(memberStats, /승점 \*\*1점\*\*/);
  assert.match(memberStats, /대전 #1 1판 · 🔴 1팀 · \*\*승\*\*/);
  calls = await send({ kind: 'userSelect', user: 'u7', customId: 'stats.memberSelect', values: ['stranger'] });
  assert.match(textOf(calls[0].payload), /등록된 적이 없는 계정/);

  // 전체 전적: 요약 + 판별 CSV
  calls = await send({ kind: 'button', user: 'u7', customId: 'stats.all' });
  assert.equal(calls[0].type, 'deferReply');
  assert.ok(isEphemeral(calls[0].payload));
  const all = calls[1].payload;
  assert.match(JSON.stringify(all.embeds[0].toJSON()), /판별 기록 10건/);
  const csv = all.files[0].attachment.toString('utf8');
  const csvLines = csv.trim().split('\r\n');
  assert.equal(csvLines.length, 11, '헤더 + 10명');
  assert.match(csvLines[0], /대전,판,기록일시,디스코드ID,이름,롤아이디,팀,포지션,챔피언,킬,데스,어시,CS,승패/);
  assert.match(csv, /,제라스,7,1,2,150,승/);
  assert.match(csv, /,7,1,2,150,승/);
  assert.match(csv, /,3,1,2,150,패/);

  // ───── 관리자: 계정정보 ─────
  calls = await send({ kind: 'command', user: 'u2', command: '관리자', sub: '계정정보' });
  assert.match(textOf(calls[0].payload), /권한이 없습니다/);
  calls = await send({ kind: 'command', user: 'admin', admin: true, command: '관리자', sub: '계정정보' });
  assert.ok(isEphemeral(calls[0].payload));
  const accountTable = calls[0].payload.embeds[0].toJSON().description;
  assert.match(accountTable, /^```\n *# │ 이름/);
  assert.match(accountTable, /lolu1#KR1/);
  assert.equal(accountTable.split('\n').length, 2 + 2 + 10, '코드블록 2줄 + 머리글/구분선 + 10명 (중복 아이디 u11은 등록 실패)');
  assert.match(calls[0].payload.files[0].attachment.toString('utf8'), /번호,이름,디스코드 사용자명,디스코드ID,롤아이디/);

  // ───── 관리자: 데이터적재 (대전 #1 1판을 찾아 K/D/A · 승패 갱신) ─────
  calls = await send({ kind: 'autocomplete', user: 'admin', admin: true, command: '관리자', focused: '1' });
  assert.equal(calls[0].type, 'respond');
  assert.match(calls[0].payload[0].name, /대전 #1 .* 종료 · 1\/2판 기록/);
  calls = await send({ kind: 'autocomplete', user: 'u2', command: '관리자', focused: '' });
  assert.deepEqual(calls[0].payload, [], '관리자가 아니면 자동완성 목록 없음');

  const upload = { url: 'https://cdn.example/new.png', name: 'new.png', contentType: 'image/png', size: 3 };
  calls = await send({ kind: 'command', user: 'admin', admin: true, command: '관리자', sub: '데이터적재', opts: { 대전: 99, 판: 1, 이미지: upload } });
  assert.match(textOf(calls[0].payload), /대전 #99을\(를\) 이 서버의 대전 목록에서 찾을 수 없습니다/);
  calls = await send({ kind: 'command', user: 'admin', admin: true, command: '관리자', sub: '데이터적재', opts: { 대전: 1, 판: 3, 이미지: upload } });
  assert.match(textOf(calls[0].payload), /2판까지 있습니다/);

  calls = await send({ kind: 'command', user: 'admin', admin: true, command: '관리자', sub: '데이터적재', opts: { 대전: 1, 판: 1, 이미지: upload } });
  assert.equal(calls[0].type, 'deferReply');
  const preview = calls[1].payload;
  assert.match(JSON.stringify(preview.embeds[0].toJSON()), /기존 기록을 \*\*덮어씁니다\*\*/);
  assert.equal(preview.files.length, 1, '올린 이미지를 미리보기로 보여준다');
  const openId = preview.components[0].toJSON().components[0].custom_id;
  assert.match(openId, /^admin\.loadOpen\|1\|1\|/);
  const pendingFiles = () => fs.readdirSync(path.join(tmp, 'records', 'guild-1')).filter((f) => f.startsWith('pending-'));
  assert.equal(pendingFiles().length, 1);

  // 버튼: 관리자만, 기존 값으로 채워진 입력창
  calls = await send({ kind: 'button', user: 'u2', customId: openId });
  assert.match(textOf(calls[0].payload), /권한이 없습니다/);
  calls = await send({ kind: 'button', user: 'admin', admin: true, customId: openId });
  assert.equal(calls[0].type, 'showModal');
  const loadModal = calls[0].payload.toJSON();
  assert.equal(loadModal.components[0].component.options.find((o) => o.default)?.value, 'RED', '기존 승리팀 선택됨');
  const loadRed = loadModal.components[1].component.value;
  const loadBlue = loadModal.components[2].component.value;
  assert.match(loadRed, /제라스 7\/1\/2\/150/, '기존 기록으로 미리 채움');

  // 승리팀을 2팀으로 바꾸고 제라스 K/D/A 수정 → 승점이 바뀐다
  calls = await send({
    kind: 'modal',
    user: 'admin',
    admin: true,
    customId: loadModal.custom_id,
    fields: { winnerSide: ['BLUE'], statsRED: loadRed.replace('제라스 7/1/2/150', '제라스 9/9/9/99'), statsBLUE: loadBlue },
  });
  assert.equal(calls[0].type, 'deferReply');
  const loaded = JSON.stringify(calls[1].payload.embeds[0].toJSON());
  assert.match(loaded, /데이터 적재 완료/);
  assert.match(loaded, /제라스\*\* 9\/9\/9 · CS 99/);
  assert.equal(services.points.getStats(1, redUser).points, 0, '승리팀이 바뀌어 1팀 승점 1 → 0');
  assert.equal(services.points.getStats(1, blueUser).points, 1, '2팀 승점 0 → 1');
  assert.equal(pendingFiles().length, 0, '대기 캡쳐가 판 캡쳐로 옮겨졌다');
  assert.ok(fs.existsSync(path.join(tmp, 'records', 'guild-1', 'match-1-game-1.png')));

  // 끝난 대전의 옛 버튼
  calls = await send({ kind: 'button', user: 'u2', customId: 'match.join|1' });
  assert.match(textOf(calls[0].payload), /진행 중인 대전이 없습니다/);

  // 서버별 로그
  const log = fs.readFileSync(path.join(tmp, 'logs', 'guild-1.log'), 'utf8');
  assert.match(log, /\[버튼\] 대전 참가 \| u2님 \(u2, u2\) \| 성공/);
  assert.match(log, /\[입력\] 계정 등록 - 롤 아이디 입력: lolu3#KR1 \| u3님/);
  assert.match(log, /\[입력\] 대전 참가 - 포지션 선택: ADC \| u3님/);
  assert.match(log, /\[버튼\] 대전 관리 \| u5님 .* \| 실패 \| ⚠️ 권한이 없습니다/);
});
