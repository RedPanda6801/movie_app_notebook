const MATCH_SIZE = 10;
const TEAM_SIZE = 5;

const POSITIONS = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'];
const POSITION_LABELS = {
  TOP: '탑',
  JUNGLE: '정글',
  MID: '미드',
  ADC: '원딜',
  SUPPORT: '서폿',
};

const SIDES = ['RED', 'BLUE'];
const SIDE_LABELS = { RED: '레드팀', BLUE: '블루팀' };

const MATCH_STATUS = {
  RECRUITING: 'RECRUITING',
  IN_PROGRESS: 'IN_PROGRESS',
  FINISHED: 'FINISHED',
  CANCELED: 'CANCELED',
};
const MATCH_STATUS_LABELS = {
  RECRUITING: '모집 중',
  IN_PROGRESS: '진행 중',
  FINISHED: '종료',
  CANCELED: '취소',
};

/** 대전 1개에서 진행할 수 있는 판 수 */
const MIN_GAMES = 1;
const MAX_GAMES = 10;

/** 판 1번 승리당 승점 (감점 없음) */
const POINTS_PER_WIN = 1;

module.exports = {
  MATCH_SIZE,
  TEAM_SIZE,
  POSITIONS,
  POSITION_LABELS,
  SIDES,
  SIDE_LABELS,
  MATCH_STATUS,
  MATCH_STATUS_LABELS,
  MIN_GAMES,
  MAX_GAMES,
  POINTS_PER_WIN,
};
