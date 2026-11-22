const { ScoreboardReadError } = require('./scoreboardReader');
const { parseScoreboardOcr } = require('./ocrScoreboardParser');

/**
 * 무료 이미지 인식: PC에서 돌리는 PaliGemma OCR 서버(scripts/paligemma/server.py)에 이미지를 보내고,
 * 받은 OCR 글자에서 참가자별 K/D/A · CS를 찾는다.
 *
 * - 비용 없음, 이미지가 외부로 나가지 않음 (모두 PC 안에서 처리)
 * - 챔피언(아이콘)과 승리팀은 읽지 못한다 → 관리자가 입력창에서 채운다.
 * - CPU에서는 느리다(조각당 수 초~수십 초). GPU가 있으면 훨씬 빠르다.
 */
function createPaligemmaReader({
  url = 'http://127.0.0.1:8765',
  tilesX = 2,
  tilesY = 5,
  timeoutMs = 10 * 60 * 1000,
  fetchImpl = fetch,
} = {}) {
  const base = String(url).replace(/\/+$/, '');

  async function read({ buffer, roster }) {
    let res;
    try {
      res = await fetchImpl(`${base}/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: buffer.toString('base64'), tiles_x: tilesX, tiles_y: tilesY }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'TimeoutError') {
        throw new ScoreboardReadError(`PaliGemma 인식이 ${Math.round(timeoutMs / 60000)}분 안에 끝나지 않았습니다. 직접 입력해 주세요.`, err);
      }
      throw new ScoreboardReadError(
        `PaliGemma 서버(${base})에 연결하지 못했습니다. PC에서 \`python scripts/paligemma/server.py\`가 실행 중인지 확인해 주세요.`,
        err,
      );
    }
    let body = null;
    try {
      body = await res.json();
    } catch {
      /* 아래에서 처리 */
    }
    if (!res.ok || !body || !Array.isArray(body.tiles)) {
      throw new ScoreboardReadError(`PaliGemma 서버 오류 (${res.status}): ${body?.error ?? '응답을 읽을 수 없음'}`);
    }
    return { ...parseScoreboardOcr(body.tiles, roster), model: `PaliGemma (${body.model || 'local'})` };
  }

  return { enabled: true, provider: 'paligemma', model: `PaliGemma (${base})`, read };
}

module.exports = { createPaligemmaReader };
