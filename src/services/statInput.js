const { UserError } = require('../utils/errors');

/**
 * 대전 기록 입력창의 팀별 K/D/A/CS 입력 양식.
 *
 * 한 줄에 한 명씩, 미리 채워진 양식의 숫자만 바꾸면 된다.
 *   1. 홍길동 (Hide on bush#KR1) : 0/0/0/0
 *   2. 김철수 (Faker#KR1) : 0/0/0/0
 * 숫자는 K/D/A/CS 순서이며, `/`, 공백, 쉼표 어느 것으로 나눠도 된다. (예: 5/2/10/180, 5 2 10 180)
 * 줄 맨 앞 번호로 사람을 찾는다. (이름 부분은 바꾸거나 지워도 된다)
 */

const LIMITS = { kills: 99, deaths: 99, assists: 99, cs: 2000 };
const LINE_PATTERN = /^\s*(\d{1,2})\s*[.)]?\s*(?:[^:：]*[:：])?\s*(\d+)\s*[/\s,]\s*(\d+)\s*[/\s,]\s*(\d+)\s*[/\s,]\s*(\d+)\s*$/;

function memberLabel(m) {
  const name = (m.display_name || m.discord_user_id || '').replace(/[:：\n]/g, ' ').slice(0, 20);
  return m.game_name ? `${name} (${m.game_name})` : name;
}

/** 입력창에 미리 채울 양식 */
function buildStatTemplate(members) {
  return members.map((m, i) => `${i + 1}. ${memberLabel(m)} : 0/0/0/0`).join('\n');
}

/**
 * 입력한 텍스트를 팀원 순서대로의 K/D/A/CS 배열로 바꾼다.
 * @param {string} text
 * @param {object[]} members 양식을 만들 때와 같은 순서의 팀원
 * @param {string} teamLabel 오류 메시지용 (예: '1팀')
 * @returns {{ member: object, kills: number, deaths: number, assists: number, cs: number }[]}
 */
function parseStatLines(text, members, teamLabel) {
  const lines = String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const byNo = new Map();
  for (const line of lines) {
    const m = LINE_PATTERN.exec(line);
    if (!m) {
      throw new UserError(`${teamLabel} 입력을 읽을 수 없습니다: \`${line.slice(0, 60)}\`\n한 줄에 \`번호. 이름 : 킬/데스/어시/CS\` 형식으로 입력해 주세요. (예: \`1. 홍길동 : 5/2/10/180\`)`);
    }
    const no = Number(m[1]);
    if (no < 1 || no > members.length) {
      throw new UserError(`${teamLabel}에는 ${no}번 참가자가 없습니다. 1~${members.length}번만 입력해 주세요.`);
    }
    if (byNo.has(no)) throw new UserError(`${teamLabel} ${no}번이 두 번 입력되었습니다.`);
    const [kills, deaths, assists, cs] = [m[2], m[3], m[4], m[5]].map(Number);
    for (const [key, value] of Object.entries({ kills, deaths, assists, cs })) {
      if (value > LIMITS[key]) {
        throw new UserError(`${teamLabel} ${no}번의 ${key === 'cs' ? 'CS' : key} 값(${value})이 너무 큽니다.`);
      }
    }
    byNo.set(no, { kills, deaths, assists, cs });
  }
  const missing = members.map((_, i) => i + 1).filter((no) => !byNo.has(no));
  if (missing.length > 0) {
    throw new UserError(`${teamLabel} ${missing.join(', ')}번의 K/D/A/CS가 입력되지 않았습니다.`);
  }
  return members.map((member, i) => ({ member, ...byNo.get(i + 1) }));
}

module.exports = { buildStatTemplate, parseStatLines };
