/**
 * OCR 글자(PaliGemma 등)에서 결과 화면의 참가자별 K/D/A · CS를 찾는다.
 *
 * OCR 서버는 이미지를 가로 띠(행) × 세로 칸(열) 조각으로 나눠 읽는다. 결과 화면은 한 참가자가
 * 한 가로줄에 있으므로, 같은 가로 띠의 글자를 왼쪽→오른쪽으로 이어 붙여서
 * 참가자 이름(롤 아이디의 # 앞 / 서버 표시 이름)과 `K / D / A`(+ 바로 뒤의 CS)를 각각 찾고 짝짓는다.
 *
 * 짝짓기 (틀린 사람에게 값이 들어가지 않도록 보수적으로):
 *   - 한 띠에서 찾은 이름 수 = K/D/A 수 → 위에서부터 순서대로 짝짓는다.
 *     (조각이 나뉘어 "이름A 이름B ... KDA_A KDA_B"로 읽혀도, "이름A KDA_A 이름B KDA_B"로 읽혀도 순서는 같다)
 *   - 수가 다르면, 이름과 다음 이름 사이에 K/D/A가 정확히 하나 있을 때만 짝짓는다. 나머지는 비워 둔다.
 *
 * 한계: 챔피언은 결과 화면에 글자가 아니라 아이콘으로만 나오므로 읽지 않는다(빈 값).
 *       승리팀 · 화면의 팀 위치도 OCR만으로는 알 수 없어 'unknown'이다. → 관리자가 입력한다.
 */

const KDA_PATTERN = /(\d{1,2})\s*[/|]\s*(\d{1,2})\s*[/|]\s*(\d{1,2})/g;

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 이름을 OCR 글자에서 찾기 위한 정규식: 대소문자 무시, 글자 사이 공백 허용 */
function namePattern(name) {
  const chars = [...String(name).replace(/\s+/g, '')].map(escapeRegExp);
  if (chars.length < 2) return null;
  return new RegExp(chars.join('\\s*'), 'i');
}

/** 참가자를 찾을 이름 후보: 롤 아이디의 # 앞부분, 서버 표시 이름 (긴 것부터) */
function nameCandidates(member) {
  const names = [];
  if (member.gameName) names.push(String(member.gameName).split('#')[0]);
  if (member.displayName) names.push(member.displayName);
  return [...new Set(names.map((n) => n.trim()).filter((n) => n.replace(/\s/g, '').length >= 2))].sort(
    (a, b) => b.length - a.length,
  );
}

/** 가로 띠별 글자 (조각을 열 순서로 이어 붙임) */
function bandsFromTiles(tiles) {
  const byRow = new Map();
  for (const t of tiles || []) {
    if (!byRow.has(t.row)) byRow.set(t.row, []);
    byRow.get(t.row).push(t);
  }
  return [...byRow.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([row, list]) => ({
      row,
      text: list
        .sort((a, b) => a.col - b.col)
        .map((t) => String(t.text || ''))
        .join(' ')
        .replace(/\s+/g, ' '),
    }));
}

/** KDA 뒤에 나오는 첫 번째 CS 후보 숫자 (골드처럼 쉼표/점/k가 붙은 숫자는 건너뜀) */
function findCs(text) {
  const re = /(\d{1,4})(?![\d.,kK])/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text[m.index - 1];
    if (before === '.' || before === ',') continue;
    const value = Number(m[1]);
    if (value <= 2000) return value;
  }
  return null;
}

/**
 * @param {{ row: number, col: number, text: string }[]} tiles OCR 조각
 * @param {{ no: number, displayName: string, gameName: string, side?: 'RED'|'BLUE' }[]} roster 참가자 (번호 = 입력창 양식 순서)
 * @returns {{ readable: boolean, winning_side: 'unknown', players: object[], notes: string }}
 *   scoreboard-reader와 같은 모양 (scoreboard_side는 참가자의 팀으로 채운다: 1팀 = 'blue', 2팀 = 'red')
 */
function parseScoreboardOcr(tiles, roster) {
  const bands = bandsFromTiles(tiles);
  const players = [];
  const found = new Set();

  for (const band of bands) {
    // 이 띠에서 찾은 이름 위치
    const hits = [];
    for (const member of roster) {
      if (found.has(member.no)) continue;
      for (const name of nameCandidates(member)) {
        const re = namePattern(name);
        const m = re && re.exec(band.text);
        if (m) {
          hits.push({ member, index: m.index, end: m.index + m[0].length, text: m[0] });
          break;
        }
      }
    }
    hits.sort((a, b) => a.index - b.index);

    // 이 띠의 K/D/A (+ 그 뒤 다음 K/D/A 전까지의 첫 숫자 = CS)
    const kdas = [];
    KDA_PATTERN.lastIndex = 0;
    let km;
    while ((km = KDA_PATTERN.exec(band.text))) {
      kdas.push({ index: km.index, end: km.index + km[0].length, k: Number(km[1]), d: Number(km[2]), a: Number(km[3]) });
    }
    kdas.forEach((kda, i) => {
      const limit = i + 1 < kdas.length ? kdas[i + 1].index : band.text.length;
      kda.cs = findCs(band.text.slice(kda.end, limit));
    });

    const pairs = [];
    if (hits.length > 0 && hits.length === kdas.length) {
      hits.forEach((hit, i) => pairs.push([hit, kdas[i]]));
    } else {
      // "이름 K/D/A 이름 K/D/A"처럼 섞여 있는 배치인지 ("이름 이름 ... K/D/A K/D/A" 배치가 아닌지)
      const interleaved = hits.length > 0 && kdas.some((k) => k.index < hits[hits.length - 1].index);
      hits.forEach((hit, i) => {
        const isLast = i === hits.length - 1;
        // 이름이 먼저 다 나오는 배치에서는 마지막 이름 뒤의 K/D/A가 누구 것인지 알 수 없다.
        if (isLast && hits.length > 1 && !interleaved) return;
        const limit = isLast ? Infinity : hits[i + 1].index;
        const between = kdas.filter((k) => k.index > hit.end && k.index < limit);
        if (between.length === 1) pairs.push([hit, between[0]]);
      });
    }

    for (const [hit, kda] of pairs) {
      found.add(hit.member.no);
      players.push({
        scoreboard_side: hit.member.side === 'BLUE' ? 'red' : 'blue',
        name_on_screen: hit.text,
        roster_no: hit.member.no,
        champion: '',
        kills: kda.k,
        deaths: kda.d,
        assists: kda.a,
        cs: kda.cs ?? -1, // 못 찾으면 -1 → 숫자 이상으로 표시되어 직접 입력
      });
    }
  }

  // 이름은 못 찾았어도 K/D/A 모양의 글자가 있으면 결과 화면으로 본다.
  const hasKda = bands.some((b) => /\d{1,2}\s*[/|]\s*\d{1,2}\s*[/|]\s*\d{1,2}/.test(b.text));
  return {
    readable: players.length > 0 || hasKda,
    winning_side: 'unknown',
    players,
    notes: '무료 인식(PaliGemma OCR)은 챔피언 아이콘과 승리팀을 읽지 못합니다. 챔피언과 승리팀은 직접 입력해 주세요.',
  };
}

module.exports = { parseScoreboardOcr, bandsFromTiles, namePattern, nameCandidates, findCs };
