/**
 * 버튼/선택 메뉴/입력창(모달)의 customId 규칙: "<action>|<인자1>|<인자2>..."
 * 대전 관련 버튼에는 대전 ID를 넣어, 끝난 대전의 옛 메시지 버튼을 구분한다.
 */
const ACTIONS = {
  // /계정 관리 패널
  PANEL_REGISTER: 'panel.register',
  PANEL_WITHDRAW: 'panel.withdraw',
  // /대전 관리 패널
  PANEL_CREATE: 'panel.create',
  PANEL_ACTIVE: 'panel.active',
  // 대전 등록 과정
  CREATE_GAMES: 'create.games', // 판 수 선택 메뉴
  CREATE_MODAL: 'create.modal', // 등록자 롤 아이디 입력창 |<판 수>
  // 공개 대전 정보 메시지
  JOIN: 'match.join', // |<matchId>
  JOIN_MODAL: 'match.joinModal', // |<matchId>
  LEAVE: 'match.leave',
  VIEW: 'match.view',
  POSITION: 'match.position',
  POSITION_SELECT: 'match.positionSelect',
  TEAM: 'match.team',
  TEAM_SELECT: 'match.teamSelect',
  MANAGE: 'match.manage',
  // 관리 패널 (관리자 / 대전 등록자)
  START: 'control.start',
  SHUFFLE: 'control.shuffle',
  RECORD: 'control.record',
  RECORD_MODAL: 'control.recordModal', // |<matchId>|<판 번호>
  FINISH: 'control.finish',
  CANCEL: 'control.cancel',
  // /전적 관리 패널
  STATS_BY_MATCH: 'stats.byMatch',
  STATS_MATCH_SELECT: 'stats.matchSelect',
  STATS_GAME_SELECT: 'stats.gameSelect', // |<matchId>
  STATS_BY_MEMBER: 'stats.byMember',
  STATS_MEMBER_SELECT: 'stats.memberSelect',
  STATS_ALL: 'stats.all',
};

/** 로그에 남길 이름 */
const ACTION_LABELS = {
  [ACTIONS.PANEL_CREATE]: '대전 등록',
  [ACTIONS.PANEL_ACTIVE]: '진행중인 대전 조회',
  [ACTIONS.PANEL_REGISTER]: '계정 등록',
  [ACTIONS.PANEL_WITHDRAW]: '계정 탈퇴',
  [ACTIONS.CREATE_GAMES]: '대전 등록 - 판 수 선택',
  [ACTIONS.CREATE_MODAL]: '대전 등록 - 롤 아이디 입력',
  [ACTIONS.JOIN]: '대전 참가',
  [ACTIONS.JOIN_MODAL]: '대전 참가 - 롤 아이디 입력',
  [ACTIONS.LEAVE]: '대전 탈퇴',
  [ACTIONS.VIEW]: '대전 조회',
  [ACTIONS.POSITION]: '포지션 등록/변경',
  [ACTIONS.POSITION_SELECT]: '포지션 선택',
  [ACTIONS.TEAM]: '팀 등록/변경',
  [ACTIONS.TEAM_SELECT]: '팀 선택',
  [ACTIONS.MANAGE]: '대전 관리',
  [ACTIONS.START]: '대전 시작',
  [ACTIONS.SHUFFLE]: '팀 랜덤 셔플',
  [ACTIONS.RECORD]: '대전 기록',
  [ACTIONS.RECORD_MODAL]: '대전 기록 - 결과 입력',
  [ACTIONS.FINISH]: '대전 종료',
  [ACTIONS.CANCEL]: '대전 취소',
  [ACTIONS.STATS_BY_MATCH]: '대전별 전적 조회',
  [ACTIONS.STATS_MATCH_SELECT]: '대전별 전적 - 대전 선택',
  [ACTIONS.STATS_GAME_SELECT]: '대전별 전적 - 판 선택',
  [ACTIONS.STATS_BY_MEMBER]: '개인별 전적 조회',
  [ACTIONS.STATS_MEMBER_SELECT]: '개인별 전적 - 계정 선택',
  [ACTIONS.STATS_ALL]: '전체 전적 조회',
};

function buildId(action, ...args) {
  return [action, ...args].join('|');
}

function parseId(customId) {
  const [action, ...args] = String(customId).split('|');
  return { action, args };
}

module.exports = { ACTIONS, ACTION_LABELS, buildId, parseId };
