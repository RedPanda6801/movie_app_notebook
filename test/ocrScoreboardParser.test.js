const test = require('node:test');
const assert = require('node:assert/strict');
const { parseScoreboardOcr, findCs, namePattern } = require('../src/integrations/ocrScoreboardParser');

const roster = [
  { no: 1, displayName: '홍길동', gameName: 'Aaaa#KR1', side: 'RED' },
  { no: 2, displayName: '철수', gameName: 'Bbbb#KR1', side: 'RED' },
  { no: 6, displayName: '드므드므드', gameName: '드므드므드#KR1', side: 'BLUE' },
];
const pairs = (tiles) => parseScoreboardOcr(tiles, roster).players.map((p) => [p.roster_no, `${p.kills}/${p.deaths}/${p.assists}`, p.cs]);

test('조각이 나뉘어 이름끼리, K/D/A끼리 모여 읽혀도 순서대로 짝짓는다', () => {
  assert.deepEqual(pairs([{ row: 0, col: 0, text: 'Aaaa Bbbb' }, { row: 0, col: 1, text: '1 / 0 / 5 170 12,345 ; 2/3/4 140 9.8k' }]), [
    [1, '1/0/5', 170],
    [2, '2/3/4', 140],
  ]);
  assert.deepEqual(pairs([{ row: 0, col: 0, text: 'Aaaa 1/0/5 170 Bbbb 2/3/4 140' }]), [
    [1, '1/0/5', 170],
    [2, '2/3/4', 140],
  ]);
});

test('애매하면 짝짓지 않는다 (틀린 사람에게 값이 들어가지 않게)', () => {
  assert.deepEqual(pairs([{ row: 0, col: 0, text: 'Aaaa Bbbb' }, { row: 0, col: 1, text: '1/0/5 170' }]), []);
  assert.deepEqual(pairs([{ row: 0, col: 0, text: 'xx Bbbb' }, { row: 0, col: 1, text: '1/0/5 170 ; 2/3/4 140' }]), []);
  assert.deepEqual(pairs([{ row: 0, col: 0, text: 'Aaaa 1/0/5 170 Bbbb ???' }]), [[1, '1/0/5', 170]]);
});

test('이름: 롤 아이디 # 앞부분 또는 표시 이름, 대소문자/띄어쓰기 무시, 띠마다 따로', () => {
  const players = parseScoreboardOcr(
    [
      { row: 0, col: 0, text: 'AAAA 3/1/2 99' },
      { row: 1, col: 0, text: '드므 드므드 0/9/1 50' },
    ],
    roster,
  ).players;
  assert.deepEqual(players.map((p) => [p.roster_no, p.name_on_screen, p.scoreboard_side]), [
    [1, 'AAAA', 'blue'],
    [6, '드므 드므드', 'red'],
  ]);
  assert.equal(players[0].champion, '', '챔피언은 읽지 않는다');
  assert.ok(namePattern('Hide on bush').test('hideonbush'));
});

test('CS: 골드(쉼표 · 소수점 · k)는 건너뛰고, 없으면 -1', () => {
  assert.equal(findCs(' 12,345 9.8k 187'), 187);
  assert.equal(parseScoreboardOcr([{ row: 0, col: 0, text: 'Aaaa 1/2/3 12,000' }], roster).players[0].cs, -1);
  const empty = parseScoreboardOcr([{ row: 0, col: 0, text: '아무 글자' }], roster);
  assert.equal(empty.readable, false);
  assert.equal(empty.winning_side, 'unknown');
});
