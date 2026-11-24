/**
 * 결과 캡쳐 → 판 기록 (Gemini API)
 *
 * /관리자 데이터적재에서 올린 결과 이미지와 그 판의 팀 구성(1팀/2팀 각 5명, 입력창 양식과 같은 순서)을
 * Gemini에게 보내 10명의 챔피언 · K/D/A · CS와 승리팀을 JSON으로 받는다.
 * 줄 모양은 봇이 만들고(형식 오류 방지), Gemini에게는 값만 받는다.
 *
 * GEMINI_API_KEY가 없으면 꺼진다(enabled = false). 그때는 관리자가 직접 입력한다.
 */
const { SIDE_LABELS } = require('../constants');
const { normalizeChampion } = require('../services/statInput');

const DEFAULT_MODEL = 'gemini-flash-latest';
const TIMEOUT_MS = 90 * 1000;
const SUPPORTED_MIME = new Set(['image/png', 'image/jpeg', 'image/webp']);
const LIMITS = { kills: 99, deaths: 99, assists: 99, cs: 2000 };
const WINNER_VALUES = { [SIDE_LABELS.RED]: 'RED', [SIDE_LABELS.BLUE]: 'BLUE' };

/** 응답 JSON 형식 (responseJsonSchema가 지원하는 키워드만 사용) */
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    winning_team: {
      type: 'string',
      enum: [SIDE_LABELS.RED, SIDE_LABELS.BLUE, '모름'],
      description: '승리한 쪽 참가자들이 속한 팀 (참가자 목록 기준)',
    },
    players: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '참가자 목록의 번호 (1~10)' },
          champion: { type: 'string', description: '챔피언 한국어 공식 이름 (예: 이즈리얼, 릴리아)' },
          kills: { type: 'integer' },
          deaths: { type: 'integer' },
          assists: { type: 'integer' },
          cs: { type: 'integer', description: 'CS (미니언 + 정글 몬스터 처치 수). 안 보이면 -1' },
          win: { type: 'boolean', description: '이 참가자가 화면에서 승리 쪽에 있으면 true' },
        },
        required: ['id', 'champion', 'kills', 'deaths', 'assists', 'cs', 'win'],
      },
    },
    notes: { type: 'string', description: '읽기 어려웠던 점 (한국어). 없으면 빈 문자열' },
  },
  required: ['winning_team', 'players', 'notes'],
};

/** 판 구성 → Gemini에게 보낼 번호 목록 (1팀 1~5, 2팀 6~10, 입력창 양식과 같은 순서) */
function rosterEntries(roster) {
  return [
    ...roster.red.map((member) => ({ side: 'RED', member })),
    ...roster.blue.map((member) => ({ side: 'BLUE', member })),
  ].map((e, i) => ({ ...e, id: i + 1 }));
}

function entryLine(e) {
  const name = String(e.member.display_name || e.member.discord_user_id || '').replace(/\n/g, ' ');
  return `${e.id}. ${name}${e.member.game_name ? ` (${e.member.game_name})` : ''}`;
}

function buildPrompt(roster) {
  const entries = rosterEntries(roster);
  const team = (side) => entries.filter((e) => e.side === side).map(entryLine);
  return [
    '이 이미지는 리그 오브 레전드 사용자 설정 게임(5대5)의 경기 결과 화면(스코어보드)입니다.',
    '아래 참가자 목록의 각 사람을 화면에서 찾아, 그 사람의 챔피언과 킬/데스/어시스트, CS를 읽어 주세요.',
    '',
    '규칙:',
    '- 화면의 소환사 이름(롤 아이디의 # 앞부분, 대소문자 무시)으로 참가자를 찾습니다. 이름이 비슷하면 롤 아이디를 우선합니다.',
    '- champion: 그 줄의 챔피언을 한국어 공식 이름으로 적습니다. 영어로 보이거나 아이콘만 있어도 한국어 이름으로 적습니다.',
    '- kills / deaths / assists: 그 줄의 K/D/A 숫자입니다.',
    '- cs: 그 줄의 CS 숫자(미니언 처치 수)입니다. 골드나 피해량과 헷갈리지 마세요. 화면에 없으면 -1.',
    '- win: 그 참가자가 화면에서 승리(승리/Victory) 쪽에 있으면 true, 패배 쪽이면 false.',
    `- winning_team: 승리 쪽 참가자들이 아래 목록의 "${SIDE_LABELS.RED}"이면 "${SIDE_LABELS.RED}", "${SIDE_LABELS.BLUE}"이면 "${SIDE_LABELS.BLUE}", 판단할 수 없으면 "모름".`,
    '  (게임 화면의 블루/레드 진영 색은 이 목록의 팀 이름과 관계없습니다.)',
    '- 화면에서 찾지 못한 참가자는 players에 넣지 마세요. 값을 지어내지 마세요.',
    '- 읽기 어려웠던 점은 notes에 한국어로 적습니다.',
    '',
    `[${SIDE_LABELS.RED}]`,
    ...team('RED'),
    '',
    `[${SIDE_LABELS.BLUE}]`,
    ...team('BLUE'),
  ].join('\n');
}

function isCount(v, max) {
  return Number.isInteger(v) && v >= 0 && v <= max;
}

/**
 * Gemini 응답을 판 구성에 맞춰 해석한다. (순수 함수)
 * @returns {{
 *   winnerSide: 'RED'|'BLUE'|null,
 *   stats: { guildMemberId: number, champion: string, kills: number, deaths: number, assists: number, cs: number }[],
 *   missing: object[],   // 값을 읽지 못한 참가자 (member)
 *   warnings: string[],
 *   complete: boolean,   // 10명 모두 + 승리팀까지 읽음
 * }}
 */
function interpretReading(roster, data) {
  const entries = rosterEntries(roster);
  const warnings = [];
  const byId = new Map();
  for (const row of Array.isArray(data?.players) ? data.players : []) {
    if (!byId.has(row?.id)) byId.set(row?.id, row);
  }

  const stats = [];
  const missing = [];
  const wins = { RED: [], BLUE: [] };
  for (const e of entries) {
    const row = byId.get(e.id);
    const champion = normalizeChampion(row?.champion);
    const ok =
      row &&
      champion &&
      champion.length <= 20 &&
      Object.entries(LIMITS).every(([key, max]) => isCount(row[key], max));
    if (!ok) {
      missing.push(e.member);
      continue;
    }
    stats.push({
      guildMemberId: e.member.guild_member_id,
      champion,
      kills: row.kills,
      deaths: row.deaths,
      assists: row.assists,
      cs: row.cs,
    });
    if (typeof row.win === 'boolean') wins[e.side].push(row.win);
  }
  if (missing.length) {
    warnings.push(`이미지에서 읽지 못한 참가자: ${missing.map((m) => m.display_name || m.discord_user_id).join(', ')}`);
  }

  let winnerSide = WINNER_VALUES[data?.winning_team] ?? null;
  // 참가자별 승패와 승리팀이 어긋나면 믿지 않는다. (팀 구성이 화면과 다를 때)
  if (winnerSide) {
    const loser = winnerSide === 'RED' ? 'BLUE' : 'RED';
    if (wins[winnerSide].includes(false) || wins[loser].includes(true)) {
      warnings.push('참가자별 승패와 승리팀이 맞지 않습니다. 팀 구성이 화면과 같은지 확인해 주세요.');
      winnerSide = null;
    }
  } else {
    warnings.push('승리팀을 읽지 못했습니다.');
  }
  const notes = String(data?.notes ?? '').trim();
  if (notes) warnings.push(`Gemini 메모: ${notes.slice(0, 300)}`);

  return { winnerSide, stats, missing, warnings, complete: missing.length === 0 && winnerSide != null };
}

/** Gemini 오류 → 관리자에게 보여줄 문장 */
function describeGeminiError(err) {
  const status = err?.status;
  const message = String(err?.message ?? err);
  if (/API_KEY_INVALID|API key not valid/i.test(message)) return 'API 키가 올바르지 않습니다. 봇의 .env GEMINI_API_KEY를 확인해 주세요.';
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return '응답이 너무 오래 걸려 중단했습니다.';
  if (status === 401 || status === 403) return 'API 키가 올바르지 않거나 권한이 없습니다.';
  if (status === 404) return `모델을 찾을 수 없습니다. GEMINI_MODEL을 확인해 주세요.`;
  if (status === 429) return '무료 사용량(요청 한도)을 넘었습니다. 잠시 후 다시 시도해 주세요.';
  if (status >= 500) return `Gemini 서버 오류 (${status}). 잠시 후 다시 시도해 주세요.`;
  return message.slice(0, 300);
}

/**
 * @param {{ apiKey?: string|null, model?: string, ai?: { models: { generateContent: Function } } }} options
 *   ai를 넘기면 그것을 쓴다(테스트용).
 */
function createGeminiReader({ apiKey = null, model = DEFAULT_MODEL, ai = null, timeoutMs = TIMEOUT_MS } = {}) {
  let client = ai;
  const enabled = Boolean(ai || apiKey);

  function getClient() {
    if (!client) {
      const { GoogleGenAI } = require('@google/genai');
      client = new GoogleGenAI({ apiKey });
    }
    return client;
  }

  /**
   * @param {{ image: Buffer, mimeType: string, roster: object }} params
   * @returns {Promise<ReturnType<typeof interpretReading> & { raw: object }>}
   */
  async function read({ image, mimeType, roster }) {
    if (!enabled) throw new Error('Gemini API 키가 설정되지 않았습니다.');
    const type = String(mimeType || '').toLowerCase();
    if (!SUPPORTED_MIME.has(type)) throw new Error('Gemini는 png · jpg · webp 이미지만 읽을 수 있습니다.');
    const response = await getClient().models.generateContent({
      model,
      contents: [{ inlineData: { mimeType: type, data: image.toString('base64') } }, { text: buildPrompt(roster) }],
      config: {
        temperature: 0,
        responseMimeType: 'application/json',
        responseJsonSchema: RESPONSE_SCHEMA,
        abortSignal: AbortSignal.timeout(timeoutMs),
      },
    });
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && finish !== 'STOP') throw new Error(`Gemini 응답이 정상적으로 끝나지 않았습니다 (${finish}).`);
    const text = response.text;
    if (!text) throw new Error('Gemini 응답에 내용이 없습니다.');
    let raw;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error('Gemini 응답을 JSON으로 읽지 못했습니다.');
    }
    return { ...interpretReading(roster, raw), raw };
  }

  return { enabled, model, read };
}

/** 읽은 값을 판 구성에 덮어 입력창/미리보기에 쓸 수 있게 한다. (못 읽은 사람은 기존 값 유지) */
function applyReading(roster, reading) {
  if (!reading) return roster;
  const byMember = new Map((reading.stats || []).map((s) => [Number(s.guildMemberId), s]));
  const apply = (m) => {
    const s = byMember.get(m.guild_member_id);
    return s ? { ...m, champion: s.champion, kills: s.kills, deaths: s.deaths, assists: s.assists, cs: s.cs } : m;
  };
  return {
    ...roster,
    red: roster.red.map(apply),
    blue: roster.blue.map(apply),
    winnerSide: reading.winnerSide || roster.winnerSide,
  };
}

module.exports = {
  DEFAULT_MODEL,
  RESPONSE_SCHEMA,
  buildPrompt,
  interpretReading,
  applyReading,
  describeGeminiError,
  createGeminiReader,
};
