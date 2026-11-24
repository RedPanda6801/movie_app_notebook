const test = require('node:test');
const assert = require('node:assert/strict');
const {
  interpretReading,
  applyReading,
  buildPrompt,
  createGeminiReader,
  describeGeminiError,
} = require('../src/integrations/geminiScoreboard');

const member = (id, name) => ({ guild_member_id: id, display_name: name, game_name: `${name}#KR1`, discord_user_id: `d${id}` });
const roster = {
  red: [1, 2, 3, 4, 5].map((i) => member(i, `레드${i}`)),
  blue: [6, 7, 8, 9, 10].map((i) => member(i, `블루${i}`)),
  winnerSide: null,
};
const row = (id, extra = {}) => ({ id, champion: `챔프${id}`, kills: 1, deaths: 2, assists: 3, cs: 100, win: id <= 5, ...extra });

test('Gemini 응답 해석: 10명 + 승리팀이면 complete', () => {
  const r = interpretReading(roster, { winning_team: '1팀', players: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => row(i)), notes: '' });
  assert.equal(r.complete, true);
  assert.equal(r.winnerSide, 'RED');
  assert.deepEqual(r.stats[5], { guildMemberId: 6, champion: '챔프6', kills: 1, deaths: 2, assists: 3, cs: 100 });
});

test('Gemini 응답 해석: 못 읽은 값 · 이상한 값 · 승패 불일치는 저장하지 않는다', () => {
  const players = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => row(i));
  players[1] = row(2, { cs: -1 });
  players[2] = row(3, { champion: ' ' });
  const r = interpretReading(roster, { winning_team: '2팀', players, notes: '흐림' });
  assert.equal(r.complete, false);
  assert.equal(r.winnerSide, null, '1팀 참가자가 승리로 읽혔는데 2팀 승리 → 믿지 않음');
  assert.deepEqual(r.missing.map((m) => m.guild_member_id), [2, 3, 10]);
  assert.match(r.warnings.join('\n'), /읽지 못한 참가자: 레드2, 레드3, 블루10/);
  assert.match(r.warnings.join('\n'), /Gemini 메모: 흐림/);

  const unknown = interpretReading(roster, { winning_team: '모름', players: [], notes: '' });
  assert.equal(unknown.winnerSide, null);
  assert.match(unknown.warnings.join('\n'), /승리팀을 읽지 못했습니다/);
});

test('읽은 값을 판 구성에 덮어 입력창을 채운다', () => {
  const r = interpretReading(roster, { winning_team: '2팀', players: [row(6, { win: true })], notes: '' });
  const applied = applyReading(roster, r);
  assert.equal(applied.winnerSide, 'BLUE');
  assert.equal(applied.blue[0].champion, '챔프6');
  assert.equal(applied.red[0].champion, undefined);
  assert.equal(applyReading(roster, null), roster);
});

test('프롬프트: 1팀 1~5번, 2팀 6~10번', () => {
  const prompt = buildPrompt(roster);
  assert.match(prompt, /\[1팀\]\n1\. 레드1 \(레드1#KR1\)/);
  assert.match(prompt, /\[2팀\]\n6\. 블루6 \(블루6#KR1\)/);
});

test('Gemini 읽기: 키 없음 · 지원하지 않는 이미지 · 비정상 종료', async () => {
  assert.equal(createGeminiReader({ apiKey: null }).enabled, false);
  const ai = { models: { generateContent: async () => ({ text: '{}', candidates: [{ finishReason: 'SAFETY' }] }) } };
  const reader = createGeminiReader({ ai });
  await assert.rejects(reader.read({ image: Buffer.from([1]), mimeType: 'image/gif', roster }), /png · jpg · webp/);
  await assert.rejects(reader.read({ image: Buffer.from([1]), mimeType: 'image/png', roster }), /SAFETY/);
  assert.match(describeGeminiError({ status: 400, message: 'API_KEY_INVALID' }), /API 키가 올바르지 않습니다/);
  assert.match(describeGeminiError({ status: 429, message: 'x' }), /요청 한도/);
});
