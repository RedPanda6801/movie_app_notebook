const test = require('node:test');
const assert = require('node:assert/strict');
const { displayWidth, truncate, renderTable } = require('../src/utils/textTable');

test('한글은 두 칸으로 계산해 열을 맞춘다', () => {
  assert.equal(displayWidth('abc'), 3);
  assert.equal(displayWidth('드므드므드#KR1'), 14);
  const lines = renderTable(
    [{ key: 'a', title: '이름' }, { key: 'b', title: '승점', align: 'right' }],
    [{ a: '드므드므드', b: 3 }, { a: 'LittleFinger', b: 12 }],
  ).split('\n');
  const col = (line) => displayWidth(line.split('│')[0]);
  assert.equal(col(lines[0]), col(lines[2]));
  assert.equal(col(lines[2]), col(lines[3]));
  assert.equal(truncate('아주긴이름입니다', 7), '아주긴…');
});
