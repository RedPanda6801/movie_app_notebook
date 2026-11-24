#!/usr/bin/env node
/**
 * 대전 결과 캡쳐 → 관리자 입력 양식 텍스트 (Gemini API)
 *
 * 결과 이미지와 "관리자가 입력해야 하는 양식"을 Gemini에게 보내서, 양식의 각 줄을 채운 텍스트를 출력한다.
 * 출력은 디스코드 봇의 [대전 기록] / [/관리자 데이터적재] 입력창에 그대로 붙여넣을 수 있다.
 *
 *   node scripts/gemini-scoreboard.mjs <이미지> <양식 파일> [옵션]
 *   cat 양식.txt | node scripts/gemini-scoreboard.mjs <이미지> [옵션]
 *
 * 양식 예시 (입력창에 미리 채워진 줄을 그대로 복사해 오면 된다. ` : ` 뒤는 비어 있거나 아무 값이어도 됨)
 *   1. 박승규 (롤하기싫1다#KR1) : 챔피언 0/0/0/0
 *   2. 청욱이 (살고싶어 제발#kr12)
 *
 * 출력 예시
 *   1. 박승규 (롤하기싫1다#KR1) : 이즈리얼 7/5/10/187
 *
 * 옵션
 *   --fourth cs   4번째 값 = CS (기본값, 봇 입력창 형식)
 *   --fourth kda  4번째 값 = KDA 비율 (킬+어시)/데스, 소수 첫째 자리 (예: 7/5/10/3.4)
 *   --model <id>  Gemini 모델 (기본: GEMINI_MODEL 환경 변수 또는 gemini-flash-latest)
 *   --out <파일>  결과를 파일로도 저장
 *
 * 필요: .env 또는 환경 변수의 GEMINI_API_KEY
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_MODEL = 'gemini-flash-latest';
const PLACEHOLDER = '챔피언 0/0/0/0';
const MIME_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
const MAX_IMAGE_BYTES = 20 * 1024 * 1024; // 요청 한 번에 보낼 수 있는 인라인 데이터 여유분

/* ───────────── 양식 읽기 / 쓰기 (순수 함수) ───────────── */

/**
 * 양식 텍스트에서 참가자 줄을 찾는다.
 * `번호. 이름 (롤아이디)` 로 시작하는 줄이 참가자 줄이고, 그 밖의 줄(빈 줄, "1팀" 같은 제목)은 그대로 둔다.
 * @returns {{ lines: { raw: string, player: null | { id: number, prefix: string, name: string, gameName: string|null } }[], players: object[] }}
 */
export function parseTemplate(text) {
  const lines = [];
  const players = [];
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const m = /^\s*(\d{1,2})\s*\.\s*(.+?)\s*$/.exec(raw);
    if (!m) {
      lines.push({ raw, player: null });
      continue;
    }
    // ` : ` 뒤(챔피언 · 숫자)는 버리고 "번호. 이름 (아이디)" 부분만 남긴다.
    const head = m[2].split(/\s*[:：]\s*/)[0].trim();
    const idMatch = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(head);
    const player = {
      id: players.length + 1, // 양식 전체에서의 순서 (팀마다 번호가 1부터 다시 시작해도 구분되도록)
      prefix: `${m[1]}. ${head}`,
      name: idMatch ? idMatch[1].trim() : head,
      gameName: idMatch ? idMatch[2].trim() : null,
    };
    players.push(player);
    lines.push({ raw, player });
  }
  return { lines, players };
}

/** KDA 비율: (킬 + 어시) / 데스, 데스가 0이면 킬 + 어시. 소수 첫째 자리 */
export function kdaRatio(k, d, a) {
  const value = (k + a) / Math.max(1, d);
  return (Math.round(value * 10) / 10).toFixed(1);
}

function isCount(v, max) {
  return Number.isInteger(v) && v >= 0 && v <= max;
}

/**
 * Gemini가 돌려준 값으로 양식을 채운다. 못 읽은 줄은 `챔피언 0/0/0/0`으로 두고 경고를 남긴다.
 * @param {ReturnType<typeof parseTemplate>} template
 * @param {{ players: { id: number, champion: string|null, kills: number|null, deaths: number|null, assists: number|null, cs: number|null }[], notes?: string }} data
 * @param {'cs'|'kda'} fourth
 * @returns {{ text: string, warnings: string[] }}
 */
export function fillTemplate(template, data, fourth = 'cs') {
  const warnings = [];
  const byId = new Map();
  for (const row of data?.players || []) {
    if (byId.has(row.id)) warnings.push(`${row.id}번째 참가자가 두 번 나왔습니다. 첫 번째 값을 씁니다.`);
    else byId.set(row.id, row);
  }

  const out = template.lines.map(({ raw, player }) => {
    if (!player) return raw;
    const row = byId.get(player.id);
    const champion = String(row?.champion ?? '').trim();
    const ok =
      row &&
      champion &&
      isCount(row.kills, 99) &&
      isCount(row.deaths, 99) &&
      isCount(row.assists, 99) &&
      (fourth === 'kda' || isCount(row.cs, 2000));
    if (!ok) {
      warnings.push(`${player.prefix} : 이미지에서 찾지 못했거나 값이 이상합니다. 직접 채워 주세요.`);
      return `${player.prefix} : ${PLACEHOLDER}`;
    }
    const last = fourth === 'kda' ? kdaRatio(row.kills, row.deaths, row.assists) : String(row.cs);
    return `${player.prefix} : ${champion} ${row.kills}/${row.deaths}/${row.assists}/${last}`;
  });

  if (data?.notes) warnings.push(`Gemini 메모: ${data.notes}`);
  return { text: out.join('\n'), warnings };
}

/* ───────────── Gemini 요청 ───────────── */

/** 응답 JSON 형식 (Gemini의 responseJsonSchema가 지원하는 키워드만 사용) */
export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    players: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'integer', description: '참가자 목록의 번호' },
          champion: { type: 'string', description: '챔피언 한국어 공식 이름 (예: 이즈리얼, 릴리아). 모르면 빈 문자열' },
          kills: { type: 'integer' },
          deaths: { type: 'integer' },
          assists: { type: 'integer' },
          cs: { type: 'integer', description: 'CS (미니언 + 정글 몬스터 처치 수). 안 보이면 -1' },
        },
        required: ['id', 'champion', 'kills', 'deaths', 'assists', 'cs'],
      },
    },
    notes: { type: 'string', description: '읽기 어려웠던 점 (한국어). 없으면 빈 문자열' },
  },
  required: ['players', 'notes'],
};

export function buildPrompt(players) {
  return [
    '이 이미지는 리그 오브 레전드 사용자 설정 게임의 경기 결과 화면(스코어보드)입니다.',
    '아래 참가자 목록의 각 사람을 화면에서 찾아, 그 사람의 챔피언과 킬/데스/어시스트, CS를 읽어 주세요.',
    '',
    '규칙:',
    '- 화면의 소환사 이름(롤 아이디의 # 앞부분, 대소문자 무시)이나 이름으로 참가자를 찾습니다.',
    '- champion: 그 줄의 챔피언을 한국어 공식 이름으로 적습니다. 영어로 보이거나 아이콘만 있어도 한국어 이름으로 적습니다.',
    '- kills / deaths / assists: 그 줄의 K/D/A 숫자입니다.',
    '- cs: 그 줄의 CS 숫자(미니언 처치 수)입니다. 골드나 피해량과 헷갈리지 마세요. 화면에 없으면 -1.',
    '- 화면에서 찾지 못한 참가자는 players에 넣지 마세요. 값을 지어내지 마세요.',
    '- 읽기 어려웠던 점은 notes에 한국어로 적습니다.',
    '',
    '참가자 목록 (번호. 이름 (롤 아이디)):',
    ...players.map((p) => `${p.id}. ${p.name}${p.gameName ? ` (${p.gameName})` : ''}`),
  ].join('\n');
}

/**
 * @param {{ ai: { models: { generateContent: Function } }, image: Buffer, mimeType: string, template: ReturnType<typeof parseTemplate>, model?: string }} params
 */
export async function readScoreboard({ ai, image, mimeType, template, model = DEFAULT_MODEL }) {
  const response = await ai.models.generateContent({
    model,
    contents: [{ inlineData: { mimeType, data: image.toString('base64') } }, { text: buildPrompt(template.players) }],
    config: {
      temperature: 0,
      responseMimeType: 'application/json',
      responseJsonSchema: RESPONSE_SCHEMA,
    },
  });
  const finish = response.candidates?.[0]?.finishReason;
  if (finish && finish !== 'STOP') {
    throw new Error(`Gemini 응답이 정상적으로 끝나지 않았습니다 (${finish}).`);
  }
  const text = response.text;
  if (!text) throw new Error('Gemini 응답에 내용이 없습니다.');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Gemini 응답을 JSON으로 읽지 못했습니다: ${text.slice(0, 200)}`);
  }
}

/* ───────────── CLI ───────────── */

function parseArgs(argv) {
  const args = { fourth: 'cs', model: process.env.GEMINI_MODEL || DEFAULT_MODEL, positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--fourth') args.fourth = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '-h' || a === '--help') args.help = true;
    else args.positional.push(a);
  }
  return args;
}

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
}

function describeError(err) {
  const status = err?.status;
  // 잘못된 키도 400(API_KEY_INVALID)으로 온다.
  if (/API_KEY_INVALID|API key not valid/i.test(String(err?.message))) {
    return 'API 키가 올바르지 않습니다. .env의 GEMINI_API_KEY를 확인해 주세요.';
  }
  if (status === 400) return `요청이 거부되었습니다 (400). 모델 이름이나 이미지를 확인해 주세요: ${err.message}`;
  if (status === 401 || status === 403) return 'API 키가 올바르지 않거나 권한이 없습니다. .env의 GEMINI_API_KEY를 확인해 주세요.';
  if (status === 404) return `모델을 찾을 수 없습니다. --model 값을 확인해 주세요: ${err.message}`;
  if (status === 429) return '무료 사용량(요청 한도)을 넘었습니다. 잠시 후 다시 시도해 주세요.';
  if (status >= 500) return `Gemini 서버 오류 (${status}). 잠시 후 다시 시도해 주세요.`;
  return err?.message ?? String(err);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const [imagePath, templatePath] = args.positional;
  if (args.help || !imagePath) {
    console.error('사용법: node scripts/gemini-scoreboard.mjs <이미지> [양식 파일] [--fourth cs|kda] [--model <id>] [--out <파일>]');
    console.error('양식 파일을 생략하면 표준 입력에서 읽습니다. (예: pbpaste | node scripts/gemini-scoreboard.mjs 결과.png)');
    process.exit(args.help ? 0 : 1);
  }
  if (!['cs', 'kda'].includes(args.fourth)) {
    console.error('--fourth 는 cs 또는 kda 만 쓸 수 있습니다.');
    process.exit(1);
  }

  // .env의 GEMINI_API_KEY를 읽는다. (봇 폴더에서 실행)
  try {
    const dotenv = await import('dotenv');
    dotenv.default.config({ quiet: true });
  } catch {
    /* dotenv가 없으면 환경 변수만 사용 */
  }
  if (!process.env.GEMINI_API_KEY && !process.env.GOOGLE_API_KEY) {
    console.error('GEMINI_API_KEY가 없습니다. .env에 GEMINI_API_KEY=발급받은_키 를 넣어 주세요.');
    process.exit(1);
  }

  const mimeType = MIME_TYPES[path.extname(imagePath).toLowerCase()];
  if (!mimeType) {
    console.error('이미지는 png, jpg, jpeg, webp만 쓸 수 있습니다.');
    process.exit(1);
  }
  const image = fs.readFileSync(imagePath);
  if (image.length > MAX_IMAGE_BYTES) {
    console.error('이미지가 너무 큽니다 (20MB 초과).');
    process.exit(1);
  }
  const template = parseTemplate(templatePath ? fs.readFileSync(templatePath, 'utf8') : await readStdin());
  if (template.players.length === 0) {
    console.error('양식에서 참가자 줄(예: "1. 박승규 (롤하기싫1다#KR1)")을 찾지 못했습니다.');
    process.exit(1);
  }

  const { GoogleGenAI } = await import('@google/genai');
  const ai = new GoogleGenAI({});
  console.error(`Gemini(${args.model})에게 이미지를 보내는 중... (참가자 ${template.players.length}명)`);
  let data;
  try {
    data = await readScoreboard({ ai, image, mimeType, template, model: args.model });
  } catch (err) {
    console.error(`❌ ${describeError(err)}`);
    process.exit(2);
  }

  const { text, warnings } = fillTemplate(template, data, args.fourth);
  console.log(text);
  if (args.out) fs.writeFileSync(args.out, `${text}\n`, 'utf8');
  if (warnings.length) {
    console.error('\n⚠️ 확인할 점');
    for (const w of warnings) console.error(`- ${w}`);
  }
  console.error('\n※ 잘못 읽을 수 있으니 이미지와 비교해 확인한 뒤 입력창에 붙여넣어 주세요.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
