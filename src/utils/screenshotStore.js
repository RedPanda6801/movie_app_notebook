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
async function saveScreenshot({ dir, discordGuildId, matchId, gameNo, attachment, baseName = null, fetchImpl = fetch }) {
  if (!attachment) throw new UserError('결과 캡쳐 이미지를 올려 주세요.');
  if (!String(attachment.contentType || '').startsWith('image/')) {
    throw new UserError('결과 캡쳐는 이미지 파일(png, jpg 등)만 올릴 수 있습니다.');
  }
  if (attachment.size > MAX_BYTES) {
    throw new UserError('이미지는 10MB 이하로 올려 주세요.');
  }

  let ext = path.extname(String(attachment.name || '')).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) ext = '.png';
  const guildDir = guildDirOf(dir, discordGuildId);
  await fs.promises.mkdir(guildDir, { recursive: true });
  const name = baseName ? String(baseName).replace(/[^0-9A-Za-z_-]/g, '') : `match-${Number(matchId)}-game-${Number(gameNo)}`;
  const target = path.join(guildDir, `${name}${ext}`);

  const res = await fetchImpl(attachment.url);
  if (!res.ok) throw new Error(`캡쳐 다운로드 실패: HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  await fs.promises.writeFile(target, buffer);
  return target;
}

function guildDirOf(dir, discordGuildId) {
  return path.join(dir, String(discordGuildId).replace(/[^0-9A-Za-z_-]/g, '') || 'unknown');
}

const PENDING_PREFIX = 'pending-';
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

/** 데이터 적재: 저장 전 대기 중인 캡쳐 파일 찾기 */
async function findPendingScreenshot(dir, discordGuildId, token) {
  const guildDir = guildDirOf(dir, discordGuildId);
  const prefix = `${PENDING_PREFIX}${String(token).replace(/[^0-9A-Za-z_-]/g, '')}.`;
  try {
    const name = (await fs.promises.readdir(guildDir)).find((f) => f.startsWith(prefix));
    return name ? path.join(guildDir, name) : null;
  } catch {
    return null;
  }
}

function pendingDataPath(dir, discordGuildId, token) {
  return path.join(guildDirOf(dir, discordGuildId), `${PENDING_PREFIX}${String(token).replace(/[^0-9A-Za-z_-]/g, '')}-read.json`);
}

/** 데이터 적재: 이미지 자동 인식 결과를 대기 캡쳐 옆에 저장 */
async function savePendingData(dir, discordGuildId, token, data) {
  await fs.promises.writeFile(pendingDataPath(dir, discordGuildId, token), JSON.stringify(data), 'utf8');
}

async function readPendingData(dir, discordGuildId, token) {
  try {
    return JSON.parse(await fs.promises.readFile(pendingDataPath(dir, discordGuildId, token), 'utf8'));
  } catch {
    return null;
  }
}

async function removePendingData(dir, discordGuildId, token) {
  await fs.promises.rm(pendingDataPath(dir, discordGuildId, token), { force: true });
}

/** 대기 중인 캡쳐를 그 판의 캡쳐로 옮긴다. (이전 캡쳐는 지운다) */
async function promotePendingScreenshot(pendingPath, { dir, discordGuildId, matchId, gameNo }) {
  const guildDir = guildDirOf(dir, discordGuildId);
  const base = `match-${Number(matchId)}-game-${Number(gameNo)}`;
  for (const f of await fs.promises.readdir(guildDir)) {
    if (f.startsWith(`${base}.`)) await fs.promises.rm(path.join(guildDir, f), { force: true });
  }
  const target = path.join(guildDir, `${base}${path.extname(pendingPath)}`);
  await fs.promises.rename(pendingPath, target);
  return target;
}

/** 하루 넘게 저장되지 않은 대기 캡쳐 정리 */
async function cleanupPendingScreenshots(dir, discordGuildId, now = Date.now()) {
  const guildDir = guildDirOf(dir, discordGuildId);
  let files = [];
  try {
    files = await fs.promises.readdir(guildDir);
  } catch {
    return;
  }
  for (const f of files.filter((name) => name.startsWith(PENDING_PREFIX))) {
    const full = path.join(guildDir, f);
    const { mtimeMs } = await fs.promises.stat(full);
    if (now - mtimeMs > PENDING_TTL_MS) await fs.promises.rm(full, { force: true });
  }
}

async function removeScreenshot(filePath) {
  if (!filePath) return;
  await fs.promises.rm(filePath, { force: true });
}

module.exports = {
  saveScreenshot,
  removeScreenshot,
  findPendingScreenshot,
  promotePendingScreenshot,
  cleanupPendingScreenshots,
  savePendingData,
  readPendingData,
  removePendingData,
  PENDING_PREFIX,
};
