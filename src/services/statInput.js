const { UserError } = require('../utils/errors');

/**
 * 대전 기록 입력창의 팀별 챔피언 + K/D/A/CS 입력 양식.
 *
 * 한 줄에 한 명씩, 미리 채워진 양식의 `챔피언`과 숫자만 바꾸면 된다.
 *   1. 홍길동 (Hide on bush#KR1) : 챔피언 0/0/0/0   →   1. 홍길동 (Hide on bush#KR1) : 제라스 5/2/10/180
 * 숫자는 K/D/A/CS 순서이며, `/`, 공백, 쉼표 어느 것으로 나눠도 된다. (예: 5/2/10/180, 5 2 10 180)
 * 줄 맨 앞 번호로 사람을 찾는다. (이름 부분은 바꾸거나 지워도 된다)
 */

const LIMITS = { kills: 99, deaths: 99, assists: 99, cs: 2000 };
const CHAMPION_PLACEHOLDER = '챔피언';
const MAX_CHAMPION_LENGTH = 20;
// 번호. (이름 :) 챔피언 K/D/A/CS
const LINE_PATTERN =
  /^\s*(\d{1,2})\s*[.)]?\s*(?:[^:：]*[:：])?\s*(.*?)\s*(\d+)\s*[/\s,]\s*(\d+)\s*[/\s,]\s*(\d+)\s*[/\s,]\s*(\d+)\s*$/;

/** 챔피언 이름 정리 (공백 정리, 대소문자/띄어쓰기 차이 비교용 키) */
function normalizeChampion(name) {
  return String(name ?? '').trim().replace(/\s+/g, ' ');
}
function championKey(name) {
  return normalizeChampion(name).replace(/\s/g, '').toLowerCase();
}

function memberLabel(m) {
  const name = (m.display_name || m.discord_user_id || '').replace(/[:：\n]/g, ' ').slice(0, 20);
  return m.game_name ? `${name} (${m.game_name})` : name;
}

/**
 * 입력창에 미리 채울 양식.
 * 팀원에 이미 기록된 값(champion, kills ...)이 있으면 그 값으로 채운다. (데이터 적재 시 수정용)
 */
function buildStatTemplate(members) {
  return members
    .map((m, i) => {
      const champion = m.champion || CHAMPION_PLACEHOLDER;
      const nums = m.kills != null ? `${m.kills}/${m.deaths}/${m.assists}/${m.cs}` : '0/0/0/0';
      return `${i + 1}. ${memberLabel(m)} : ${champion} ${nums}`;
    })
    .join('\n');
}

/**
 * 입력한 텍스트를 팀원 순서대로의 K/D/A/CS 배열로 바꾼다.
 * @param {string} text
 * @param {object[]} members 양식을 만들 때와 같은 순서의 팀원
 * @param {string} teamLabel 오류 메시지용 (예: '1팀')
 * @returns {{ member: object, champion: string, kills: number, deaths: number, assists: number, cs: number }[]}
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
      throw new UserError(`${teamLabel} 입력을 읽을 수 없습니다: \`${line.slice(0, 60)}\`\n한 줄에 \`번호. 이름 : 챔피언 킬/데스/어시/CS\` 형식으로 입력해 주세요. (예: \`1. 홍길동 : 제라스 5/2/10/180\`)`);
    }
    const no = Number(m[1]);
    if (no < 1 || no > members.length) {
      throw new UserError(`${teamLabel}에는 ${no}번 참가자가 없습니다. 1~${members.length}번만 입력해 주세요.`);
    }
    if (byNo.has(no)) throw new UserError(`${teamLabel} ${no}번이 두 번 입력되었습니다.`);
    const champion = normalizeChampion(m[2]);
    if (!champion || champion === CHAMPION_PLACEHOLDER) {
      throw new UserError(`${teamLabel} ${no}번의 챔피언을 입력해 주세요. (\`챔피언\` 자리에 이름, 예: 제라스)`);
    }
    if (champion.length > MAX_CHAMPION_LENGTH || /^\d+$/.test(champion)) {
      throw new UserError(`${teamLabel} ${no}번의 챔피언 이름(\`${champion.slice(0, 30)}\`)을 확인해 주세요.`);
    }
    const [kills, deaths, assists, cs] = [m[3], m[4], m[5], m[6]].map(Number);
    for (const [key, value] of Object.entries({ kills, deaths, assists, cs })) {
      if (value > LIMITS[key]) {
        throw new UserError(`${teamLabel} ${no}번의 ${key === 'cs' ? 'CS' : key} 값(${value})이 너무 큽니다.`);
      }
    }
    byNo.set(no, { champion, kills, deaths, assists, cs });
  }
  const missing = members.map((_, i) => i + 1).filter((no) => !byNo.has(no));
  if (missing.length > 0) {
    throw new UserError(`${teamLabel} ${missing.join(', ')}번의 K/D/A/CS가 입력되지 않았습니다.`);
  }
  return members.map((member, i) => ({ member, ...byNo.get(i + 1) }));
}

module.exports = { buildStatTemplate, parseStatLines, normalizeChampion, championKey, CHAMPION_PLACEHOLDER };
