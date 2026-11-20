-- 디스코드 5대5 대전 관리 봇 스키마 (SQLite)
-- 설계 문서: CLAUDE.md > 데이터베이스 설계

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

-- 대전 (서버 1:N)
CREATE TABLE IF NOT EXISTS match (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id   INTEGER NOT NULL REFERENCES guild (id),
    channel_id TEXT,
    status     TEXT    NOT NULL DEFAULT 'RECRUITING'
               CHECK (status IN ('RECRUITING', 'IN_PROGRESS', 'FINISHED', 'CANCELED')),
    created_by INTEGER REFERENCES guild_member (id),
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
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
    UNIQUE (match_id, guild_member_id)
);

-- 대전 기록 (현재 대전과 1:1 -> 1:n 전환 시 UNIQUE 제거)
CREATE TABLE IF NOT EXISTS match_record (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    match_id       INTEGER NOT NULL UNIQUE REFERENCES match (id),
    winner_team_id INTEGER NOT NULL REFERENCES team (id),
    played_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS ix_guild_member_account ON guild_member (account_id);
CREATE INDEX IF NOT EXISTS ix_match_guild ON match (guild_id);
CREATE INDEX IF NOT EXISTS ix_participant_member ON match_participant (guild_member_id);
CREATE INDEX IF NOT EXISTS ix_participant_team ON match_participant (team_id);
