const fs = require('node:fs');
const path = require('node:path');
const { UserError } = require('./errors');

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/**
 * 디스코드에 올린 결과 캡쳐를 로컬에 저장한다.
 * 디스코드 첨부파일 주소는 시간이 지나면 만료되므로 파일로 내려받아 보관한다.
 *   <dir>/<디스코드 서버 ID>/match-<대전ID>-game-<판>.<확장자>
 *
 * @returns {Promise<string>} 저장된 파일 경로
 */
async function saveScreenshot({ dir, discordGuildId, matchId, gameNo, attachment, fetchImpl = fetch }) {
  if (!attachment) throw new UserError('결과 캡쳐 이미지를 올려 주세요.');
  if (!String(attachment.contentType || '').startsWith('image/')) {
    throw new UserError('결과 캡쳐는 이미지 파일(png, jpg 등)만 올릴 수 있습니다.');
  }
  if (attachment.size > MAX_BYTES) {
    throw new UserError('이미지는 10MB 이하로 올려 주세요.');
  }

  let ext = path.extname(String(attachment.name || '')).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) ext = '.png';
  const guildDir = path.join(dir, String(discordGuildId).replace(/[^0-9A-Za-z_-]/g, '') || 'unknown');
  await fs.promises.mkdir(guildDir, { recursive: true });
  const target = path.join(guildDir, `match-${Number(matchId)}-game-${Number(gameNo)}${ext}`);

  const res = await fetchImpl(attachment.url);
  if (!res.ok) throw new Error(`캡쳐 다운로드 실패: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(target, buffer);
  return target;
}

async function removeScreenshot(filePath) {
  if (!filePath) return;
  await fs.promises.rm(filePath, { force: true });
}

module.exports = { saveScreenshot, removeScreenshot };
