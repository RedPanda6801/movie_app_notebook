/**
 * 디스코드 코드 블록(고정폭 글꼴)에 보여줄 텍스트 표.
 * 한글/한자/전각 문자는 영문의 두 칸 너비로 계산해 열을 맞춘다.
 * (글꼴에 따라 한 칸 정도 어긋날 수 있다)
 */

/** 화면 표시 너비: 전각(한글 등) = 2, 그 외 = 1 */
function displayWidth(text) {
  let width = 0;
  for (const ch of String(text)) {
    const code = ch.codePointAt(0);
    const wide =
      (code >= 0x1100 && code <= 0x115f) || // 한글 자모
      (code >= 0x2e80 && code <= 0xa4cf) || // CJK, 한글 호환 자모 등
      (code >= 0xac00 && code <= 0xd7a3) || // 한글 음절
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) || // 전각 영숫자
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff); // 이모지
    width += wide ? 2 : 1;
  }
  return width;
}

/** 표시 너비가 max를 넘으면 잘라서 … 를 붙인다. */
function truncate(text, max) {
  const value = String(text ?? '');
  if (displayWidth(value) <= max) return value;
  let out = '';
  for (const ch of value) {
    if (displayWidth(out + ch) > max - 1) break;
    out += ch;
  }
  return `${out}…`;
}

function pad(text, width, align = 'left') {
  const gap = Math.max(0, width - displayWidth(text));
  return align === 'right' ? ' '.repeat(gap) + text : text + ' '.repeat(gap);
}

/**
 * @param {{ key: string, title: string, max?: number, align?: 'left'|'right' }[]} columns
 * @param {object[]} rows
 * @returns {string} 줄바꿈으로 이어진 표 (코드 블록 없이)
 */
function renderTable(columns, rows) {
  const cells = rows.map((row) => columns.map((c) => truncate(row[c.key] ?? '', c.max ?? 20)));
  const widths = columns.map((c, i) =>
    Math.max(displayWidth(c.title), ...cells.map((r) => displayWidth(r[i]))),
  );
  const line = (values) =>
    values.map((v, i) => pad(v, widths[i], columns[i].align)).join(' │ ').replace(/\s+$/, '');
  const header = line(columns.map((c) => c.title));
  const rule = widths.map((w) => '─'.repeat(w)).join('─┼─');
  return [header, rule, ...cells.map(line)].join('\n');
}

module.exports = { displayWidth, truncate, renderTable };
