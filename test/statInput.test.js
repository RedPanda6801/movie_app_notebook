const test = require('node:test');
const assert = require('node:assert/strict');
const { buildStatTemplate, parseStatLines } = require('../src/services/statInput');
const { UserError } = require('../src/utils/errors');

const members = [
  { display_name: '홍길동', game_name: 'Hide on bush#KR1' },
  { display_name: '김철수', game_name: null },
];

test('양식: 번호. 이름 (롤아이디) : 챔피언 0/0/0/0', () => {
  assert.equal(buildStatTemplate(members), '1. 홍길동 (Hide on bush#KR1) : 챔피언 0/0/0/0\n2. 김철수 : 챔피언 0/0/0/0');
});

test('챔피언 + K/D/A/CS 읽기 (구분자 / 공백 쉼표, 띄어쓰기 있는 챔피언)', () => {
  const rows = parseStatLines('2. 김철수 : 미스 포츈 1, 3, 4, 150\n1. 홍길동 : 제라스 5/2/10/180', members, '1팀');
  assert.deepEqual(
    rows.map((r) => [r.member.display_name, r.champion, r.kills, r.deaths, r.assists, r.cs]),
    [
      ['홍길동', '제라스', 5, 2, 10, 180],
      ['김철수', '미스 포츈', 1, 3, 4, 150],
    ],
  );
});

test('잘못된 입력은 줄 번호와 함께 안내', () => {
  const err = (re) => (e) => e instanceof UserError && re.test(e.message);
  assert.throws(() => parseStatLines(buildStatTemplate(members), members, '1팀'), err(/1번의 챔피언을 입력/));
  assert.throws(() => parseStatLines('1. a : 제라스 1/2/3', members, '1팀'), err(/읽을 수 없습니다/));
  assert.throws(() => parseStatLines('1. a : 제라스 1/2/3/4', members, '1팀'), err(/2번의 K\/D\/A\/CS가 입력되지 않았/));
  assert.throws(() => parseStatLines('1. a : 제라스 1/2/3/4\n1. b : 룰루 1/1/1/1', members, '1팀'), err(/두 번/));
  assert.throws(() => parseStatLines('3. a : 제라스 1/2/3/4', members, '1팀'), err(/3번 참가자가 없습니다/));
  assert.throws(() => parseStatLines('1. a : 제라스 100/2/3/4\n2. b : 룰루 1/1/1/1', members, '1팀'), err(/너무 큽니다/));
});
