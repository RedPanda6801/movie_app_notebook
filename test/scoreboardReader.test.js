const test = require('node:test');
const assert = require('node:assert/strict');
const { createScoreboardReader, matchToRoster, overlayRecognition, ScoreboardReadError } = require('../src/integrations/scoreboardReader');

function fakeClient(reply) {
  const calls = [];
  return {
    calls,
    beta: {
      messages: {
        create: async (params) => {
          calls.push(params);
          if (reply instanceof Error) throw reply;
          return reply;
        },
      },
    },
  };
}

const okReply = (data) => ({ stop_reason: 'end_turn', model: 'claude-opus-5-5', content: [{ type: 'text', text: JSON.stringify(data) }] });

test('이미지와 참가자 목록을 Claude API에 보내고 JSON 결과를 받는다', async () => {
  const data = { readable: true, winning_side: 'blue', players: [], notes: '' };
  const client = fakeClient(okReply(data));
  const reader = createScoreboardReader({ client });
  assert.equal(reader.enabled, true);
  const result = await reader.read({
    buffer: Buffer.from([1, 2, 3]),
    mediaType: 'image/png',
    roster: [{ no: 1, displayName: '홍길동', gameName: 'Hide on bush#KR1' }],
  });
  assert.equal(result.winning_side, 'blue');
  const req = client.calls[0];
  assert.equal(req.model, 'claude-opus-5-5');
  assert.deepEqual(req.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(req.fallbacks, 'default');
  assert.equal(req.output_config.format.type, 'json_schema');
  assert.equal(req.messages[0].content[0].type, 'image');
  assert.equal(req.messages[0].content[0].source.data, Buffer.from([1, 2, 3]).toString('base64'));
  assert.match(req.messages[0].content[1].text, /1\. 홍길동 \/ 롤 아이디: Hide on bush#KR1/);
});

test('키가 없으면 꺼지고, 거절/형식 오류/지원하지 않는 이미지는 ScoreboardReadError', async () => {
  assert.equal(createScoreboardReader({ apiKey: null }).enabled, false);
  const roster = [];
  const buffer = Buffer.from([1]);
  const refusal = createScoreboardReader({ client: fakeClient({ stop_reason: 'refusal', content: [] }) });
  await assert.rejects(refusal.read({ buffer, mediaType: 'image/png', roster }), ScoreboardReadError);
  const broken = createScoreboardReader({ client: fakeClient({ stop_reason: 'end_turn', content: [{ type: 'text', text: '{' }] }) });
  await assert.rejects(broken.read({ buffer, mediaType: 'image/png', roster }), /결과를 읽지 못했습니다/);
  const reader = createScoreboardReader({ client: fakeClient(okReply({})) });
  await assert.rejects(reader.read({ buffer, mediaType: 'image/bmp', roster }), /png · jpg/);
  const failing = createScoreboardReader({ client: fakeClient(new Error('boom')) });
  await assert.rejects(failing.read({ buffer, mediaType: 'image/png', roster }), /이미지 인식 중 오류: boom/);
});

/** 1팀(RED) 1~5번, 2팀(BLUE) 6~10번 */
const roster = {
  red: [1, 2, 3, 4, 5].map((i) => ({ guild_member_id: i, display_name: `p${i}` })),
  blue: [6, 7, 8, 9, 10].map((i) => ({ guild_member_id: i, display_name: `p${i}` })),
};
const row = (no, side, extra = {}) => ({
  scoreboard_side: side,
  name_on_screen: `p${no}`,
  roster_no: no,
  champion: `챔프${no}`,
  kills: no,
  deaths: 1,
  assists: 2,
  cs: 100 + no,
  ...extra,
});

test('인식 결과를 팀에 맞춘다: 화면의 blue/red ↔ 1팀/2팀은 다수결, 승리팀 변환', () => {
  // 화면 위쪽(blue)이 2팀(6~10), 아래(red)가 1팀(1~5), 화면 blue 승리 → 2팀 승리
  const data = {
    readable: true,
    winning_side: 'blue',
    players: [...[6, 7, 8, 9, 10].map((n) => row(n, 'blue')), ...[1, 2, 3, 4, 5].map((n) => row(n, 'red'))],
    notes: '',
  };
  const m = matchToRoster(data, roster);
  assert.equal(m.complete, true);
  assert.equal(m.winnerSide, 'BLUE');
  assert.deepEqual(m.stats.get(3), { champion: '챔프3', kills: 3, deaths: 1, assists: 2, cs: 103, nameOnScreen: 'p3' });
  assert.deepEqual(m.warnings, []);

  const overlaid = overlayRecognition(
    { ...roster, winnerSide: null },
    { ok: true, winnerSide: m.winnerSide, stats: [...m.stats].map(([guildMemberId, st]) => ({ guildMemberId, ...st })) },
  );
  assert.equal(overlaid.winnerSide, 'BLUE');
  assert.equal(overlaid.red[0].champion, '챔프1');
});

test('빠진 사람, 중복 연결, 이상한 숫자, 승리팀 미확인은 미완료 + 경고', () => {
  const players = [1, 2, 3, 4, 5].map((n) => row(n, 'red'));
  players.push(row(6, 'blue'), row(6, 'blue', { name_on_screen: 'dup' }), row(7, 'blue', { kills: 500 }), row(8, 'blue', { roster_no: null }));
  const m = matchToRoster({ readable: true, winning_side: 'unknown', players, notes: '8번 이름이 흐림' }, roster);
  assert.equal(m.complete, false);
  assert.equal(m.winnerSide, null);
  const text = m.warnings.join('\n');
  assert.match(text, /6번 참가자가 화면에서 두 번/);
  assert.match(text, /p7`의 숫자가 이상합니다/);
  assert.match(text, /p8`을\(를\) 참가자와 연결하지 못했습니다/);
  assert.match(text, /읽지 못한 참가자: p7, p8, p9, p10/);
  assert.match(text, /승리팀을 읽지 못했습니다/);
  assert.match(text, /인식 메모: 8번 이름이 흐림/);

  assert.equal(matchToRoster({ readable: false, players: [] }, roster).complete, false);
});

test('PaliGemma 인식기: 서버 응답 → K/D/A · CS, 연결 실패/서버 오류/시간 초과 안내', async () => {
  const { createPaligemmaReader } = require('../src/integrations/paligemmaReader');
  const { createScoreboardReaderFromConfig } = require('../src/integrations/scoreboardReader');
  let sent;
  const ok = createPaligemmaReader({
    url: 'http://local:8765/',
    fetchImpl: async (url, init) => {
      sent = { url, body: JSON.parse(init.body) };
      return { ok: true, status: 200, json: async () => ({ model: 'paligemma2', tiles: [{ row: 0, col: 0, text: 'Aaaa 1/2/3 150' }] }) };
    },
  });
  const data = await ok.read({ buffer: Buffer.from([9]), roster: [{ no: 1, gameName: 'Aaaa#KR1', side: 'RED' }] });
  assert.equal(sent.url, 'http://local:8765/ocr');
  assert.deepEqual([sent.body.tiles_x, sent.body.tiles_y, sent.body.image], [2, 5, Buffer.from([9]).toString('base64')]);
  assert.deepEqual([data.players[0].kills, data.players[0].cs, data.model], [1, 150, 'PaliGemma (paligemma2)']);

  const refused = createPaligemmaReader({ fetchImpl: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(refused.read({ buffer: Buffer.from([1]), roster: [] }), /PaliGemma 서버\(http:\/\/127\.0\.0\.1:8765\)에 연결하지 못했습니다/);
  const broken = createPaligemmaReader({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({ error: 'ocr failed: CUDA OOM' }) }) });
  await assert.rejects(broken.read({ buffer: Buffer.from([1]), roster: [] }), /PaliGemma 서버 오류 \(500\): ocr failed: CUDA OOM/);
  const slow = createPaligemmaReader({ timeoutMs: 120000, fetchImpl: async () => { const e = new Error('t'); e.name = 'TimeoutError'; throw e; } });
  await assert.rejects(slow.read({ buffer: Buffer.from([1]), roster: [] }), /2분 안에 끝나지 않았습니다/);

  assert.equal(createScoreboardReaderFromConfig({ scoreboardProvider: 'paligemma' }).provider, 'paligemma');
  assert.equal(createScoreboardReaderFromConfig({ anthropicApiKey: 'k' }).provider, 'claude');
  assert.equal(createScoreboardReaderFromConfig({}).enabled, false);
});
