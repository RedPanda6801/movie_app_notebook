const test = require('node:test');
const assert = require('node:assert/strict');
const { shuffleTeams, positionConflicts } = require('../src/services/shuffle');

const POS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];

function sides(result, side) {
  return [...result].filter(([, s]) => s === side).map(([id]) => id);
}

test('2명 미만이면 셔플할 수 없다', () => {
  assert.throws(() => shuffleTeams([{ id: 1, position: null, lockedSide: null }]));
});

test('10명이 안 되어도 두 팀 인원이 최대한 같게 나눈다', () => {
  for (let n = 2; n <= 10; n += 1) {
    for (let trial = 0; trial < 10; trial += 1) {
      const players = Array.from({ length: n }, (_, i) => ({ id: i + 1, position: POS[i % 5], lockedSide: null }));
      const result = shuffleTeams(players);
      const red = sides(result, 'RED').length;
      const blue = sides(result, 'BLUE').length;
      assert.equal(red + blue, n);
      assert.ok(Math.abs(red - blue) <= 1, `${n}명: ${red} vs ${blue}`);
    }
  }
});

test('인원이 적어도 직접 고른 팀은 유지하고, 팀당 5명을 넘지 않는다', () => {
  // 1팀 고정 4명 + 자유 3명 → 1팀 4~5명, 2팀 2~3명 중 차이가 가장 작은 배분 (4:3)
  const players = [
    ...Array.from({ length: 4 }, (_, i) => ({ id: i + 1, position: null, lockedSide: 'RED' })),
    ...Array.from({ length: 3 }, (_, i) => ({ id: 5 + i, position: null, lockedSide: null })),
  ];
  for (let trial = 0; trial < 20; trial += 1) {
    const result = shuffleTeams(players);
    for (const id of [1, 2, 3, 4]) assert.equal(result.get(id), 'RED');
    assert.equal(sides(result, 'RED').length, 4);
    assert.equal(sides(result, 'BLUE').length, 3);
  }
  // 1팀 고정 5명 + 자유 2명 → 자유 인원은 모두 2팀
  const full = [
    ...Array.from({ length: 5 }, (_, i) => ({ id: i + 1, position: null, lockedSide: 'RED' })),
    { id: 6, position: null, lockedSide: null },
    { id: 7, position: null, lockedSide: null },
  ];
  const result = shuffleTeams(full);
  assert.equal(result.get(6), 'BLUE');
  assert.equal(result.get(7), 'BLUE');
});

test('5:5로 나누고 포지션이 겹치지 않게 배치한다', () => {
  for (let trial = 0; trial < 50; trial += 1) {
    const players = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      position: POS[i % 5],
      lockedSide: null,
    }));
    const result = shuffleTeams(players);
    const red = players.filter((p) => result.get(p.id) === 'RED');
    const blue = players.filter((p) => result.get(p.id) === 'BLUE');
    assert.equal(red.length, 5);
    assert.equal(blue.length, 5);
    assert.equal(positionConflicts(red), 0);
    assert.equal(positionConflicts(blue), 0);
  }
});

test('팀 직접 등록자는 셔플에서 제외되어 자기 팀을 유지한다', () => {
  for (let trial = 0; trial < 50; trial += 1) {
    const players = Array.from({ length: 10 }, (_, i) => ({
      id: i + 1,
      position: null,
      lockedSide: i < 3 ? 'BLUE' : i === 3 ? 'RED' : null,
    }));
    const result = shuffleTeams(players);
    for (const id of [1, 2, 3]) assert.equal(result.get(id), 'BLUE');
    assert.equal(result.get(4), 'RED');
    assert.equal(sides(result, 'RED').length, 5);
    assert.equal(sides(result, 'BLUE').length, 5);
  }
});

test('고정 인원의 포지션까지 고려해서 겹침을 최소화한다', () => {
  // RED에 고정된 TOP, MID / 나머지 8명 중 TOP 1, MID 1 -> 이 둘은 BLUE로 가야 한다.
  const players = [
    { id: 1, position: 'TOP', lockedSide: 'RED' },
    { id: 2, position: 'MID', lockedSide: 'RED' },
    { id: 3, position: 'TOP', lockedSide: null },
    { id: 4, position: 'MID', lockedSide: null },
    ...Array.from({ length: 6 }, (_, i) => ({ id: 5 + i, position: null, lockedSide: null })),
  ];
  for (let trial = 0; trial < 30; trial += 1) {
    const result = shuffleTeams(players);
    assert.equal(result.get(3), 'BLUE');
    assert.equal(result.get(4), 'BLUE');
  }
});

test('같은 조건의 후보가 여러 개면 무작위로 고른다', () => {
  const players = Array.from({ length: 10 }, (_, i) => ({ id: i + 1, position: null, lockedSide: null }));
  const seen = new Set();
  for (let trial = 0; trial < 30; trial += 1) {
    seen.add(sides(shuffleTeams(players), 'RED').join(','));
  }
  assert.ok(seen.size > 1);
});
