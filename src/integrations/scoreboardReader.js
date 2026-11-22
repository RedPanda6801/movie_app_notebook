const AnthropicModule = require('@anthropic-ai/sdk');

const Anthropic = AnthropicModule.default || AnthropicModule.Anthropic || AnthropicModule;

/**
 * 경기 결과 캡쳐(리그 오브 레전드 결과 화면)를 Claude API로 읽어서
 * 참가자별 챔피언 · K/D/A · CS · 팀 · 승패를 JSON으로 받아온다.
 *
 * - ANTHROPIC_API_KEY가 설정되어 있을 때만 켜진다. (없으면 enabled = false → 직접 입력)
 * - 결과는 참고용이다. 관리자가 확인한 뒤 저장한다. (잘못 읽을 수 있음)
 */

const DEFAULT_MODEL = 'claude-opus-5-5';
// Claude API에 보낼 수 있는 이미지 크기 (base64 변환 전 기준으로 여유 있게)
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SUPPORTED_MEDIA_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** 응답 JSON 형식 (structured outputs) */
const SCOREBOARD_SCHEMA = {
  type: 'object',
  properties: {
    readable: {
      type: 'boolean',
      description: 'true if the image is a League of Legends post-game scoreboard whose rows can be read',
    },
    winning_side: {
      type: 'string',
      enum: ['blue', 'red', 'unknown'],
      description: 'Which scoreboard team won (blue = the team listed first/top/left, red = second)',
    },
    players: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          scoreboard_side: { type: 'string', enum: ['blue', 'red'] },
          name_on_screen: { type: 'string', description: 'Summoner / Riot ID exactly as shown' },
          roster_no: {
            type: ['integer', 'null'],
            description: 'Number of the matching roster entry, or null if no roster entry matches',
          },
          champion: { type: 'string', description: 'Champion name in official Korean (e.g. 제라스, 룰루)' },
          kills: { type: 'integer' },
          deaths: { type: 'integer' },
          assists: { type: 'integer' },
          cs: { type: 'integer', description: 'Total minions + monsters killed (CS)' },
        },
        required: ['scoreboard_side', 'name_on_screen', 'roster_no', 'champion', 'kills', 'deaths', 'assists', 'cs'],
        additionalProperties: false,
      },
    },
    notes: { type: 'string', description: 'Anything unclear or unreadable, in Korean. Empty string if none.' },
  },
  required: ['readable', 'winning_side', 'players', 'notes'],
  additionalProperties: false,
};

function buildPrompt(roster) {
  const lines = roster.map((p) => `${p.no}. ${p.displayName || '-'} / 롤 아이디: ${p.gameName || '-'}`);
  return [
    'This image is a League of Legends custom game post-game scoreboard (it may be from the Korean client).',
    'Read every player row and return the JSON described by the schema.',
    '',
    'Rules:',
    '- One entry per player row on the scoreboard (normally 10: 5 per team). Do not invent rows you cannot see.',
    '- scoreboard_side: "blue" for the team shown first (top or left), "red" for the second team.',
    '- champion: the official Korean champion name, even if the screen shows English or only an icon you recognize.',
    '- kills / deaths / assists: the K/D/A numbers of that row. cs: the minion/CS number of that row.',
    '- winning_side: the team marked as victory (승리 / VICTORY). "unknown" if it is not shown.',
    '- roster_no: match the row to the roster below by Riot ID (game name before #, case-insensitive) or display name.',
    '  Use each roster number at most once. If nothing matches clearly, use null.',
    '- If a value is hard to read, give your best reading and mention it in notes (Korean).',
    '- If the image is not a readable scoreboard, set readable to false and players to [].',
    '',
    'Roster (number. display name / Riot ID):',
    ...lines,
  ].join('\n');
}

/**
 * @param {{ apiKey?: string|null, model?: string, client?: object }} options
 */
function createScoreboardReader({ apiKey = process.env.ANTHROPIC_API_KEY, model = DEFAULT_MODEL, client = null } = {}) {
  const enabled = Boolean(client || apiKey);
  const anthropic = client || (enabled ? new Anthropic({ apiKey }) : null);

  /**
   * @param {{ buffer: Buffer, mediaType: string, roster: { no: number, displayName: string, gameName: string }[] }} input
   * @returns {Promise<{ readable: boolean, winning_side: string, players: object[], notes: string, model: string }>}
   */
  async function read({ buffer, mediaType, roster }) {
    if (!enabled) throw new ScoreboardReadError('자동 인식이 꺼져 있습니다. (ANTHROPIC_API_KEY 미설정)');
    if (!SUPPORTED_MEDIA_TYPES.has(mediaType)) {
      throw new ScoreboardReadError('자동 인식은 png · jpg · webp · gif 이미지만 지원합니다.');
    }
    if (buffer.length > MAX_IMAGE_BYTES) {
      throw new ScoreboardReadError('이미지가 커서(5MB 초과) 자동 인식을 건너뜁니다.');
    }

    let response;
    try {
      response = await anthropic.beta.messages.create({
        model,
        max_tokens: 16000,
        // 안전 분류기가 요청을 거절하면 서버에서 다른 모델로 다시 시도한다.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: SCOREBOARD_SCHEMA },
        },
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: buffer.toString('base64') } },
              { type: 'text', text: buildPrompt(roster) },
            ],
          },
        ],
      });
    } catch (err) {
      throw new ScoreboardReadError(describeApiError(err), err);
    }

    if (response.stop_reason === 'refusal') {
      throw new ScoreboardReadError('이미지 인식 요청이 거절되었습니다. 직접 입력해 주세요.');
    }
    if (response.stop_reason === 'max_tokens') {
      throw new ScoreboardReadError('이미지 인식 응답이 너무 길어 중간에 끊겼습니다. 직접 입력해 주세요.');
    }
    const text = response.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');
    let data;
    try {
      data = JSON.parse(text);
    } catch (err) {
      throw new ScoreboardReadError('이미지 인식 결과를 읽지 못했습니다. 직접 입력해 주세요.', err);
    }
    return { ...data, model: response.model };
  }

  return { enabled, provider: 'claude', model, read };
}

class ScoreboardReadError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'ScoreboardReadError';
    if (cause) this.cause = cause;
  }
}

/** SDK의 오류 종류별로 관리자에게 보여줄 안내 */
function describeApiError(err) {
  if (err instanceof Anthropic.AuthenticationError) return 'Claude API 키가 올바르지 않습니다. (.env의 ANTHROPIC_API_KEY 확인)';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Claude API 키에 이 모델을 쓸 권한이 없습니다.';
  if (err instanceof Anthropic.RateLimitError) return 'Claude API 사용량 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.';
  if (err instanceof Anthropic.BadRequestError) return `Claude API가 요청을 거부했습니다: ${err.message}`;
  if (err instanceof Anthropic.APIConnectionError) return 'Claude API에 연결하지 못했습니다. (네트워크 확인)';
  if (err instanceof Anthropic.APIError) return `Claude API 오류 (${err.status}): ${err.message}`;
  return `이미지 인식 중 오류: ${err?.message ?? err}`;
}

/**
 * 인식 결과를 이 판의 팀 구성(1팀/2팀)에 맞춘다.
 * - roster_no로 참가자를 찾고, 화면의 blue/red를 1팀/2팀 중 어디인지 다수결로 정한다.
 * - 값 범위를 검사하고, 빠진 사람/중복/애매한 점을 warnings로 돌려준다.
 *
 * @param {object} data read() 결과
 * @param {{ red: object[], blue: object[] }} roster 판의 팀 구성 (각 참가자에 guild_member_id)
 * @returns {{ complete: boolean, winnerSide: 'RED'|'BLUE'|null, stats: Map<number, object>, warnings: string[] }}
 */
function matchToRoster(data, { red, blue }) {
  const warnings = [];
  const list = [...red, ...blue];
  const stats = new Map();
  if (!data?.readable) {
    return { complete: false, winnerSide: null, stats, warnings: ['결과 화면을 읽을 수 없는 이미지입니다.'] };
  }

  const sideOf = new Map([...red.map((p) => [p.guild_member_id, 'RED']), ...blue.map((p) => [p.guild_member_id, 'BLUE'])]);
  const votes = { blue: { RED: 0, BLUE: 0 }, red: { RED: 0, BLUE: 0 } };
  const usedNos = new Set();
  const inRange = (v, max) => Number.isInteger(v) && v >= 0 && v <= max;

  for (const row of data.players || []) {
    const no = row.roster_no;
    if (no == null || no < 1 || no > list.length) {
      warnings.push(`화면의 \`${row.name_on_screen}\`을(를) 참가자와 연결하지 못했습니다.`);
      continue;
    }
    if (usedNos.has(no)) {
      warnings.push(`${no}번 참가자가 화면에서 두 번 연결되었습니다. (\`${row.name_on_screen}\`)`);
      continue;
    }
    usedNos.add(no);
    const member = list[no - 1];
    const values = { kills: row.kills, deaths: row.deaths, assists: row.assists, cs: row.cs };
    if (!inRange(values.kills, 99) || !inRange(values.deaths, 99) || !inRange(values.assists, 99) || !inRange(values.cs, 2000)) {
      warnings.push(`\`${row.name_on_screen}\`의 숫자가 이상합니다. 확인해 주세요.`);
      continue;
    }
    votes[row.scoreboard_side][sideOf.get(member.guild_member_id)] += 1;
    stats.set(member.guild_member_id, { champion: String(row.champion || '').trim(), ...values, nameOnScreen: row.name_on_screen });
  }

  const missing = list.filter((p) => !stats.has(p.guild_member_id));
  if (missing.length) warnings.push(`읽지 못한 참가자: ${missing.map((p) => p.display_name || p.discord_user_id).join(', ')}`);
  const noChampion = [...stats.values()].filter((s) => !s.champion).length;
  if (noChampion) warnings.push(`챔피언을 읽지 못했습니다 (${noChampion}명). 입력창에서 챔피언을 채워 주세요.`);

  // 화면 팀 ↔ 우리 팀 (1팀/2팀): 연결된 사람들의 다수결
  const blueIs = votes.blue.RED >= votes.blue.BLUE ? 'RED' : 'BLUE';
  const redIs = votes.red.RED > votes.red.BLUE ? 'RED' : 'BLUE';
  const sideMismatch = blueIs === redIs && (votes.blue.RED + votes.blue.BLUE > 0) && (votes.red.RED + votes.red.BLUE > 0);
  if (sideMismatch) warnings.push('화면의 팀 구성이 이 판의 1팀/2팀과 맞지 않습니다. 팀을 확인해 주세요.');
  const mixed = votes.blue.RED > 0 && votes.blue.BLUE > 0;
  if (mixed) warnings.push('화면의 한 팀에 1팀과 2팀 인원이 섞여 있습니다. 팀 구성을 확인해 주세요.');

  let winnerSide = null;
  if (data.winning_side === 'blue') winnerSide = blueIs;
  else if (data.winning_side === 'red') winnerSide = blueIs === 'RED' ? 'BLUE' : 'RED';
  else warnings.push('승리팀을 읽지 못했습니다.');

  if (data.notes) warnings.push(`인식 메모: ${data.notes}`);

  const complete = missing.length === 0 && winnerSide != null && !sideMismatch && !mixed && [...stats.values()].every((s) => s.champion);
  return { complete, winnerSide, stats, warnings };
}

/**
 * 저장해 둔 인식 결과(recognition)를 판의 팀 구성 위에 덮어씌운다.
 * 입력창 양식과 미리보기를 인식한 값으로 채우는 데 쓴다. (인식 못 한 사람은 기존 값 그대로)
 */
function overlayRecognition(roster, recognition) {
  if (!recognition?.ok) return roster;
  const byMember = new Map((recognition.stats || []).map((s) => [s.guildMemberId, s]));
  const apply = (p) => {
    const st = byMember.get(p.guild_member_id);
    return st ? { ...p, champion: st.champion || p.champion, kills: st.kills, deaths: st.deaths, assists: st.assists, cs: st.cs } : p;
  };
  return {
    ...roster,
    red: roster.red.map(apply),
    blue: roster.blue.map(apply),
    winnerSide: recognition.winnerSide || roster.winnerSide,
  };
}

/**
 * 설정으로 이미지 인식기를 고른다.
 *   SCOREBOARD_PROVIDER=paligemma : 무료 로컬 PaliGemma OCR 서버 (scripts/paligemma/server.py)
 *   SCOREBOARD_PROVIDER=claude    : Claude API (유료, ANTHROPIC_API_KEY 필요)
 *   SCOREBOARD_PROVIDER=off 또는 미설정이고 키도 없음 : 꺼짐 (직접 입력)
 * 미설정이면 ANTHROPIC_API_KEY가 있을 때 claude, 없으면 off (이전 버전과 같은 동작)
 */
function createScoreboardReaderFromConfig(config, { fetchImpl } = {}) {
  const provider = (config.scoreboardProvider || (config.anthropicApiKey ? 'claude' : 'off')).toLowerCase();
  if (provider === 'paligemma') {
    // 순환 참조를 피하려고 여기서 불러온다.
    const { createPaligemmaReader } = require('./paligemmaReader');
    return createPaligemmaReader({
      url: config.paligemmaUrl,
      tilesX: config.paligemmaTilesX,
      tilesY: config.paligemmaTilesY,
      timeoutMs: config.paligemmaTimeoutMs,
      ...(fetchImpl ? { fetchImpl } : {}),
    });
  }
  if (provider === 'claude') return createScoreboardReader({ apiKey: config.anthropicApiKey, model: config.scoreboardModel });
  return { enabled: false, provider: 'off', model: null, read: async () => { throw new ScoreboardReadError('자동 인식이 꺼져 있습니다.'); } };
}

module.exports = {
  createScoreboardReaderFromConfig,
  createScoreboardReader,
  matchToRoster,
  overlayRecognition,
  ScoreboardReadError,
  SCOREBOARD_SCHEMA,
  DEFAULT_MODEL,
};
