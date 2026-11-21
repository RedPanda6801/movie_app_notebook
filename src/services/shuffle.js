const { TEAM_SIZE } = require('../constants');

/**
 * 배열에서 k개를 고르는 모든 조합의 인덱스를 생성한다. (n <= 10 이므로 최대 252개)
 */
function* combinations(n, k, start = 0, picked = []) {
  if (picked.length === k) {
    yield picked.slice();
    return;
  }
  for (let i = start; i <= n - (k - picked.length); i += 1) {
    picked.push(i);
    yield* combinations(n, k, i + 1, picked);
    picked.pop();
  }
}

/** 한 팀 안에서 포지션이 겹치는 인원 수 (포지션 미선택자는 제외) */
function positionConflicts(members) {
  const counts = new Map();
  for (const { position } of members) {
    if (!position) continue;
    counts.set(position, (counts.get(position) || 0) + 1);
  }
  let conflicts = 0;
  for (const c of counts.values()) conflicts += c - 1;
  return conflicts;
}

/** 셔플에 필요한 최소 인원 */
const MIN_SHUFFLE_SIZE = 2;

/**
 * 팀 자동셔플. 참가자가 10명이 안 되어도 쓸 수 있다. (2~10명)
 * - lockedSide가 있는 참가자(팀 직접 등록자)는 셔플에서 제외하고 그 팀에 고정한다.
 * - 나머지 참가자를 두 팀 인원이 **최대한 같도록** 나눈다. (팀당 최대 5명, 홀수면 1명 차이)
 * - 그중 같은 팀 안에서 포지션이 겹치는 경우가 가장 적은 배치를 우선 고른다. (포지션 우선)
 * - 같은 조건의 후보가 여러 개면 그중 하나를 무작위로 고른다.
 *
 * @param {{ id: number, position: string|null, lockedSide: 'RED'|'BLUE'|null }[]} participants
 * @param {() => number} [random] 0 이상 1 미만의 난수 함수 (테스트용 주입)
 * @returns {Map<number, 'RED'|'BLUE'>} 참가자 id -> 배정된 팀
 */
function shuffleTeams(participants, random = Math.random) {
  if (participants.length < MIN_SHUFFLE_SIZE || participants.length > TEAM_SIZE * 2) {
    throw new Error(`셔플은 ${MIN_SHUFFLE_SIZE}~${TEAM_SIZE * 2}명일 때 할 수 있습니다.`);
  }

  const lockedRed = participants.filter((p) => p.lockedSide === 'RED');
  const lockedBlue = participants.filter((p) => p.lockedSide === 'BLUE');
  const free = participants.filter((p) => !p.lockedSide);

  if (lockedRed.length > TEAM_SIZE || lockedBlue.length > TEAM_SIZE) {
    throw new Error(`한 팀에는 최대 ${TEAM_SIZE}명까지 등록할 수 있습니다.`);
  }

  // 1) 1팀에 넣을 자유 인원 수 후보: 팀당 5명을 넘지 않고, 두 팀 인원 차이가 가장 작은 값들
  const options = [];
  for (let k = 0; k <= free.length; k += 1) {
    const red = lockedRed.length + k;
    const blue = lockedBlue.length + free.length - k;
    if (red <= TEAM_SIZE && blue <= TEAM_SIZE) options.push({ k, gap: Math.abs(red - blue) });
  }
  const minGap = Math.min(...options.map((o) => o.gap));
  const redSlotCandidates = options.filter((o) => o.gap === minGap).map((o) => o.k);

  // 2) 그 인원 배분 안에서 포지션 겹침이 가장 적은 조합들
  let best = [];
  let bestCost = Infinity;
  for (const redSlots of redSlotCandidates) {
    for (const combo of combinations(free.length, redSlots)) {
      const inRed = new Set(combo);
      const red = [...lockedRed, ...free.filter((_, i) => inRed.has(i))];
      const blue = [...lockedBlue, ...free.filter((_, i) => !inRed.has(i))];
      const cost = positionConflicts(red) + positionConflicts(blue);
      if (cost < bestCost) {
        bestCost = cost;
        best = [inRed];
      } else if (cost === bestCost) {
        best.push(inRed);
      }
    }
  }

  // 3) 무작위로 하나 선택
  const chosen = best[Math.floor(random() * best.length)];
  const result = new Map();
  for (const p of lockedRed) result.set(p.id, 'RED');
  for (const p of lockedBlue) result.set(p.id, 'BLUE');
  free.forEach((p, i) => result.set(p.id, chosen.has(i) ? 'RED' : 'BLUE'));
  return result;
}

module.exports = { shuffleTeams, positionConflicts, MIN_SHUFFLE_SIZE };
