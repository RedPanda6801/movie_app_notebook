const { POSITIONS } = require('../constants');
const { UserError } = require('../utils/errors');

/**
 * 롤 아이디(Riot ID) 형식: 게임이름#태그 (예: Hide on bush#KR1)
 * - 게임이름: 글자/숫자/공백 3~16자
 * - 태그: 글자/숫자 3~5자 (특수문자 불가)
 */
const GAME_NAME_PATTERN = /^[\p{L}\p{N} ]{3,16}#[\p{L}\p{N}]{3,5}$/u;
const GAME_NAME_HELP =
  '롤 아이디는 `게임이름#태그` 형식으로 입력해 주세요. 게임이름은 3~16자, 태그는 특수문자 없이 3~5자입니다. (예: Hide on bush#KR1)';

function normalizeGameName(gameName) {
  const raw = String(gameName ?? '').trim();
  const parts = raw.split('#');
  if (parts.length !== 2) throw new UserError(GAME_NAME_HELP);
  const value = `${parts[0].trim().replace(/\s+/g, ' ')}#${parts[1].trim()}`;
  if (!GAME_NAME_PATTERN.test(value)) throw new UserError(GAME_NAME_HELP);
  return value;
}

/** 포지션 값 검사 (null = 미정) */
function normalizePosition(position) {
  if (position == null || position === 'NONE') return null;
  if (!POSITIONS.includes(position)) throw new UserError('알 수 없는 포지션입니다.');
  return position;
}

module.exports = { normalizeGameName, normalizePosition };
