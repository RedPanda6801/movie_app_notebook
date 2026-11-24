const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const load = () => import(pathToFileURL(path.join(__dirname, '..', 'scripts', 'gemini-scoreboard.mjs')).href);

const TEMPLATE = [
  '1팀',
  '1. 박승규 (롤하기싫1다#KR1) : 챔피언 0/0/0/0',
  '2. 청욱이 (살고싶어 제발#kr12) : 챔피언 0/0/0/0',
  '',
  '2팀',
  '1. MW (카시스소다#1922)',
].join('\n');

const reply = (data, finishReason = 'STOP') => ({ text: JSON.stringify(data), candidates: [{ finishReason }] });

test('양식 읽기: 참가자 줄만 골라 순서대로 번호를 매기고, 나머지 줄은 그대로', async () => {
  const { parseTemplate } = await load();
  const t = parseTemplate(TEMPLATE);
  assert.deepEqual(
    t.players.map((p) => [p.id, p.prefix, p.name, p.gameName]),
    [
      [1, '1. 박승규 (롤하기싫1다#KR1)', '박승규', '롤하기싫1다#KR1'],
      [2, '2. 청욱이 (살고싶어 제발#kr12)', '청욱이', '살고싶어 제발#kr12'],
      [3, '1. MW (카시스소다#1922)', 'MW', '카시스소다#1922'],
    ],
  );
  assert.equal(t.lines.length, 6);
});

test('Gemini 요청: 이미지 + 참가자 목록 + JSON 형식 지정, 결과로 양식 채우기 (CS / KDA 비율)', async () => {
  const { parseTemplate, readScoreboard, fillTemplate } = await load();
  const template = parseTemplate(TEMPLATE);
  let sent;
  const ai = {
    models: {
      generateContent: async (params) => {
        sent = params;
        return reply({
          players: [
            { id: 1, champion: '이즈리얼', kills: 7, deaths: 5, assists: 10, cs: 187 },
            { id: 2, champion: '릴리아', kills: 9, deaths: 2, assists: 10, cs: 160 },
            { id: 3, champion: '레오나', kills: 3, deaths: 7, assists: 17, cs: 30 },
          ],
          notes: '',
        });
      },
    },
  };
  const data = await readScoreboard({ ai, image: Buffer.from([1, 2]), mimeType: 'image/png', template, model: 'gemini-flash-latest' });
  assert.equal(sent.model, 'gemini-flash-latest');
  assert.deepEqual(sent.contents[0], { inlineData: { mimeType: 'image/png', data: Buffer.from([1, 2]).toString('base64') } });
  assert.match(sent.contents[1].text, /^3\. MW \(카시스소다#1922\)$/m);
  assert.equal(sent.config.responseMimeType, 'application/json');
  assert.equal(sent.config.temperature, 0);

  const cs = fillTemplate(template, data, 'cs');
  assert.equal(
    cs.text,
    [
      '1팀',
      '1. 박승규 (롤하기싫1다#KR1) : 이즈리얼 7/5/10/187',
      '2. 청욱이 (살고싶어 제발#kr12) : 릴리아 9/2/10/160',
      '',
      '2팀',
      '1. MW (카시스소다#1922) : 레오나 3/7/17/30',
    ].join('\n'),
  );
  assert.deepEqual(cs.warnings, []);

  // 예시 형식 (4번째 값 = KDA 비율)
  const kda = fillTemplate(template, data, 'kda');
  assert.match(kda.text, /이즈리얼 7\/5\/10\/3\.4$/m);
  assert.match(kda.text, /릴리아 9\/2\/10\/9\.5$/m);
  assert.match(kda.text, /레오나 3\/7\/17\/2\.9$/m);
});

test('못 찾은 사람 · 이상한 값은 양식 그대로 두고 경고, 봇 입력창 형식과 맞는다', async () => {
  const { parseTemplate, fillTemplate } = await load();
  const { parseStatLines } = require('../src/services/statInput');
  const template = parseTemplate(TEMPLATE);
  const { text, warnings } = fillTemplate(
    template,
    { players: [{ id: 1, champion: '이즈리얼', kills: 7, deaths: 5, assists: 10, cs: -1 }, { id: 2, champion: '', kills: 1, deaths: 1, assists: 1, cs: 1 }], notes: '3번 이름이 가려짐' },
    'cs',
  );
  assert.match(text, /1\. 박승규 \(롤하기싫1다#KR1\) : 챔피언 0\/0\/0\/0/);
  assert.equal(warnings.length, 4, '1번(CS 없음) · 2번(챔피언 없음) · 3번(못 찾음) · 메모');

  // 정상적으로 채운 줄은 봇의 입력창 파서가 그대로 읽는다.
  const ok = fillTemplate(template, { players: [1, 2, 3].map((id) => ({ id, champion: `챔프${id}`, kills: id, deaths: 0, assists: 2, cs: 100 + id })) }, 'cs');
  const team1 = ok.text.split('\n').filter((l) => /^\d\./.test(l)).slice(0, 2).join('\n');
  const parsed = parseStatLines(team1, [{}, {}], '1팀');
  assert.deepEqual(parsed.map((r) => [r.champion, r.kills, r.cs]), [['챔프1', 1, 101], ['챔프2', 2, 102]]);
});

test('응답 이상: 안전 차단 등으로 끝나지 않음 / JSON 아님', async () => {
  const { parseTemplate, readScoreboard } = await load();
  const template = parseTemplate(TEMPLATE);
  const ai = (r) => ({ models: { generateContent: async () => r } });
  await assert.rejects(readScoreboard({ ai: ai(reply({}, 'SAFETY')), image: Buffer.from([1]), mimeType: 'image/png', template }), /SAFETY/);
  await assert.rejects(readScoreboard({ ai: ai({ text: 'not json', candidates: [{ finishReason: 'STOP' }] }), image: Buffer.from([1]), mimeType: 'image/png', template }), /JSON으로 읽지 못했습니다/);
});
