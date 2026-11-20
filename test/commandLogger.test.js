const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EmbedBuilder } = require('discord.js');
const {
  createCommandLogger,
  describeCommand,
  describeUser,
  describeReply,
} = require('../src/utils/commandLogger');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cmdlog-'));
}

test('서버별로 다른 파일에 한 줄씩 남긴다', async () => {
  const dir = tmpDir();
  const logger = createCommandLogger({ dir });
  const date = new Date('2026-11-20T06:30:12Z'); // KST 15:30:12
  await logger.log({ discordGuildId: '111', date, command: '/계정 등록', user: '홍길동 (hong, 1)', success: true, message: '✅ 등록' });
  await logger.log({ discordGuildId: '111', date, command: '/대전 참가', user: '홍길동 (hong, 1)', success: false, message: '⚠️ 실패\n둘째 줄' });
  await logger.log({ discordGuildId: '222', date, command: '/승점 랭킹', user: '김철수 (kim, 2)', success: true, message: '[임베드] 랭킹' });

  assert.deepEqual(fs.readdirSync(dir).sort(), ['111.log', '222.log']);
  const lines = fs.readFileSync(path.join(dir, '111.log'), 'utf8').trimEnd().split('\n');
  assert.deepEqual(lines, [
    '[2026-11-20 15:30:12] /계정 등록 | 홍길동 (hong, 1) | 성공 | ✅ 등록',
    '[2026-11-20 15:30:12] /대전 참가 | 홍길동 (hong, 1) | 실패 | ⚠️ 실패 / 둘째 줄',
  ]);
  assert.match(fs.readFileSync(path.join(dir, '222.log'), 'utf8'), /\/승점 랭킹 \| 김철수/);
});

test('서버 ID가 없으면 direct-message.log, 파일명에 쓸 수 없는 문자는 제거', () => {
  const logger = createCommandLogger({ dir: 'logs' });
  assert.equal(logger.filePath(null), path.join('logs', 'direct-message.log'));
  assert.equal(logger.filePath('../../etc/x'), path.join('logs', 'etcx.log'));
});

test('입력한 커맨드, 등록자, 결과 메시지를 문자열로 만든다', () => {
  const interaction = {
    commandName: '대전',
    options: { data: [{ name: '포지션', type: 1, options: [{ name: '포지션', type: 3, value: 'MID' }] }] },
    user: { id: '42', username: 'hong', globalName: 'Hong' },
    member: { displayName: '홍길동' },
  };
  assert.equal(describeCommand(interaction), '/대전 포지션 포지션:MID');
  assert.equal(describeUser(interaction), '홍길동 (hong, 42)');
  assert.equal(describeUser({ ...interaction, member: null }), 'Hong (hong, 42)');

  assert.equal(describeReply('텍스트'), '텍스트');
  const embed = new EmbedBuilder().setTitle('대전 #1').setDescription('상태: 모집 중');
  assert.equal(describeReply({ content: '셔플 완료', embeds: [embed] }), '셔플 완료 / [임베드] 대전 #1 상태: 모집 중');
});
