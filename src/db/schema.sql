-- 디스코드 5대5 대전 관리 봇 스키마 (SQLite) - 최신 버전
-- 설계 문서: CLAUDE.md > 데이터베이스 설계
-- 새 DB는 이 파일로 만들고, 기존 DB는 src/db/migrations.js로 이 모양까지 올린다.

PRAGMA foreign_keys = ON;

-- 봇이 참가한 디스코드 서버
CREATE TABLE IF NOT EXISTS guild (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_guild_id TEXT    NOT NULL UNIQUE,
    name             TEXT,
    status           TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'LEFT')),
    joined_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    left_at          TEXT
);

-- 디스코드 사용자 (사용자당 1계정)
CREATE TABLE IF NOT EXISTS account (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_user_id TEXT    NOT NULL UNIQUE,
    username        TEXT,
    last_game_name  TEXT,   -- 마지막으로 입력한 롤 아이디 (참가 입력창 기본값)
    created_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- 서버 <-> 계정 (N:M). 커맨드의 "계정 등록/탈퇴" 단위
CREATE TABLE IF NOT EXISTS guild_member (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id      INTEGER NOT NULL REFERENCES guild (id),
    account_id    INTEGER NOT NULL REFERENCES account (id),
    display_name  TEXT,
    status        TEXT    NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'WITHDRAWN')),
    registered_at TEXT    NOT NULL DEFAULT (datetime('now')),
    withdrawn_at  TEXT,
    UNIQUE (guild_id, account_id)
);

-- 대전 (서버 1:N). 대전 안에 여러 판(game)이 있다.
CREATE TABLE IF NOT EXISTS match (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   INTEGER NOT NULL REFERENCES guild (id),
    channel_id TEXT,
    status     TEXT    NOT NULL DEFAULT 'RECRUITING'
               CHECK (status IN ('RECRUITING', 'IN_PROGRESS', 'FINISHED', 'CANCELED')),
    created_by INTEGER REFERENCES guild_member (id),
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    game_count INTEGER NOT NULL DEFAULT 1 CHECK (game_count BETWEEN 1 AND 10), -- 진행할 판 수
    message_channel_id TEXT, -- 공개 대전 정보 메시지 위치
    message_id         TEXT
);

-- 서버당 진행 중인(모집 중 포함) 대전은 1개만 허용
CREATE UNIQUE INDEX IF NOT EXISTS ux_match_active_per_guild
    ON match (guild_id)
    WHERE status IN ('RECRUITING', 'IN_PROGRESS');

-- 대전의 팀 (대전당 RED / BLUE 2개)
CREATE TABLE IF NOT EXISTS team (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id INTEGER NOT NULL REFERENCES match (id) ON DELETE CASCADE,
    side     TEXT    NOT NULL CHECK (side IN ('RED', 'BLUE')),
    UNIQUE (match_id, side)
);

-- 대전 참가자 (대전 <-> 서버회원 N:M)
CREATE TABLE IF NOT EXISTS match_participant (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        INTEGER NOT NULL REFERENCES match (id) ON DELETE CASCADE,
    guild_member_id INTEGER NOT NULL REFERENCES guild_member (id),
    team_id         INTEGER REFERENCES team (id),
    position        TEXT    CHECK (position IN ('TOP', 'MID', 'JUNGLE', 'ADC', 'SUPPORT')),
    is_team_locked  INTEGER NOT NULL DEFAULT 0 CHECK (is_team_locked IN (0, 1)),
    joined_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    game_name       TEXT,   -- 이번 대전에서 쓰는 롤 아이디 (예: Hide on bush#KR1)
    UNIQUE (match_id, guild_member_id)
);

-- 판별 기록 (대전 1:N). 판마다 결과 캡쳐와 승리자를 남긴다.
CREATE TABLE IF NOT EXISTS match_record (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id        INTEGER NOT NULL REFERENCES match (id),
    game_no         INTEGER NOT NULL,              -- 몇 번째 판인지 (1부터)
    winner_team_id  INTEGER REFERENCES team (id),  -- 팀 기준으로 기록한 경우만 (nullable)
    screenshot_path TEXT,                          -- 결과 캡쳐 파일 경로
    recorded_by     INTEGER REFERENCES guild_member (id),
    played_at       TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE (match_id, game_no)
);

-- 판별 승리자 (판 1:N). 승리자 1명당 승점 1점
CREATE TABLE IF NOT EXISTS match_record_winner (
    record_id       INTEGER NOT NULL REFERENCES match_record (id) ON DELETE CASCADE,
    guild_member_id INTEGER NOT NULL REFERENCES guild_member (id),
    PRIMARY KEY (record_id, guild_member_id)
);

CREATE INDEX IF NOT EXISTS ix_guild_member_account ON guild_member (account_id);
CREATE INDEX IF NOT EXISTS ix_match_guild ON match (guild_id);
CREATE INDEX IF NOT EXISTS ix_participant_member ON match_participant (guild_member_id);
CREATE INDEX IF NOT EXISTS ix_participant_team ON match_participant (team_id);
CREATE INDEX IF NOT EXISTS ix_record_winner_member ON match_record_winner (guild_member_id);
