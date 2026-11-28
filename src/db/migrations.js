/**
 * 기존 DB 파일을 최신 스키마로 올리는 마이그레이션.
 * PRAGMA user_version에 적용된 버전을 기록한다.
 *
 * - 새 DB: schema.sql(최신 모양)로 만들고 user_version = LATEST_VERSION
 * - 기존 DB: user_version보다 큰 버전의 마이그레이션만 순서대로 적용
 */
const MIGRATIONS = [
  {
    // v1 -> v2: 대전에 판 수/공개 메시지 추가, 판별 기록(1:N) + 판별 승리자
    version: 2,
    up(db) {
      db.exec(`
        ALTER TABLE account ADD COLUMN last_game_name TEXT;
        ALTER TABLE match ADD COLUMN game_count INTEGER NOT NULL DEFAULT 1 CHECK (game_count BETWEEN 1 AND 10);
        ALTER TABLE match ADD COLUMN message_channel_id TEXT;
        ALTER TABLE match ADD COLUMN message_id TEXT;
        ALTER TABLE match_participant ADD COLUMN game_name TEXT;

        CREATE TABLE match_record_v2 (
            id              INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id        INTEGER NOT NULL REFERENCES match (id),
            game_no         INTEGER NOT NULL,
            winner_team_id  INTEGER REFERENCES team (id),
            screenshot_path TEXT,
            recorded_by     INTEGER REFERENCES guild_member (id),
            played_at       TEXT    NOT NULL DEFAULT (datetime('now')),
            UNIQUE (match_id, game_no)
        );
        INSERT INTO match_record_v2 (id, match_id, game_no, winner_team_id, played_at)
             SELECT id, match_id, 1, winner_team_id, played_at FROM match_record;
        DROP TABLE match_record;
        ALTER TABLE match_record_v2 RENAME TO match_record;

        CREATE TABLE match_record_winner (
            record_id       INTEGER NOT NULL REFERENCES match_record (id) ON DELETE CASCADE,
            guild_member_id INTEGER NOT NULL REFERENCES guild_member (id),
            PRIMARY KEY (record_id, guild_member_id)
        );
        -- 기존 기록(팀 기준 1판)의 승리팀 인원을 승리자로 옮긴다. (기존 승점 유지)
        INSERT INTO match_record_winner (record_id, guild_member_id)
             SELECT r.id, mp.guild_member_id
               FROM match_record r
               JOIN match_participant mp ON mp.match_id = r.match_id AND mp.team_id = r.winner_team_id;
        CREATE INDEX IF NOT EXISTS ix_record_winner_member ON match_record_winner (guild_member_id);
      `);
    },
  },
  {
    // v2 -> v3: 판별 승리자(match_record_winner) -> 판별 참가자 전적(match_record_player)
    //           팀 · K/D/A · CS · 승패를 참가자별로 저장한다.
    version: 3,
    up(db) {
      db.exec(`
        CREATE TABLE match_record_player (
            record_id       INTEGER NOT NULL REFERENCES match_record (id) ON DELETE CASCADE,
            guild_member_id INTEGER NOT NULL REFERENCES guild_member (id),
            side            TEXT    CHECK (side IN ('RED', 'BLUE')),
            game_name       TEXT,
            position        TEXT    CHECK (position IN ('TOP', 'MID', 'JUNGLE', 'ADC', 'SUPPORT')),
            kills           INTEGER CHECK (kills >= 0),
            deaths          INTEGER CHECK (deaths >= 0),
            assists         INTEGER CHECK (assists >= 0),
            cs              INTEGER CHECK (cs >= 0),
            is_win          INTEGER NOT NULL CHECK (is_win IN (0, 1)),
            PRIMARY KEY (record_id, guild_member_id)
        );
        -- 기존 기록: 그 대전의 참가자 전원을 옮기고, 승리자 목록으로 승패를 채운다. (K/D/A/CS는 기록이 없어 NULL)
        INSERT INTO match_record_player (record_id, guild_member_id, side, game_name, position, is_win)
             SELECT r.id, mp.guild_member_id, t.side, mp.game_name, mp.position,
                    EXISTS (SELECT 1 FROM match_record_winner w
                             WHERE w.record_id = r.id AND w.guild_member_id = mp.guild_member_id)
               FROM match_record r
               JOIN match_participant mp ON mp.match_id = r.match_id
               LEFT JOIN team t ON t.id = mp.team_id;
        DROP TABLE match_record_winner;
        CREATE INDEX IF NOT EXISTS ix_record_player_member ON match_record_player (guild_member_id);
      `);
    },
  },
  {
    // v3 -> v4: 판별 챔피언(피어리스 표시용), 계정의 마지막 포지션(참가 입력창 기본값)
    version: 4,
    up(db) {
      db.exec(`
        ALTER TABLE match_record_player ADD COLUMN champion TEXT;
        ALTER TABLE account ADD COLUMN last_position TEXT
          CHECK (last_position IN ('TOP', 'MID', 'JUNGLE', 'ADC', 'SUPPORT'));
      `);
    },
  },
  {
    // v4 -> v5: 롤 아이디를 계정에 1개로 등록 (중복 불가), 선호 포지션
    //   last_game_name -> game_name, last_position -> preferred_position
    version: 5,
    up(db) {
      db.exec(`
        ALTER TABLE account RENAME COLUMN last_game_name TO game_name;
        ALTER TABLE account RENAME COLUMN last_position TO preferred_position;
        -- 같은 아이디를 여러 계정이 쓰고 있었다면 먼저 쓴 계정만 남긴다.
        UPDATE account SET game_name = NULL
         WHERE game_name IS NOT NULL
           AND id NOT IN (SELECT MIN(id) FROM account WHERE game_name IS NOT NULL GROUP BY lower(game_name));
        CREATE UNIQUE INDEX IF NOT EXISTS ux_account_game_name ON account (lower(game_name)) WHERE game_name IS NOT NULL;
      `);
    },
  },
  {
    // v5 -> v6: 팀을 판(game_no)별로 둘 수 있게 team.game_no 추가
    //   UNIQUE(match_id, side) -> UNIQUE(match_id, game_no, side). 기존 팀은 1판(game_no = 1)으로 둔다.
    //   팀 id는 그대로 옮기므로 match_participant.team_id / match_record.winner_team_id 참조가 유지된다.
    version: 6,
    up(db) {
      db.exec(`
        CREATE TABLE team_v6 (
            id       INTEGER PRIMARY KEY AUTOINCREMENT,
            match_id INTEGER NOT NULL REFERENCES match (id) ON DELETE CASCADE,
            game_no  INTEGER NOT NULL DEFAULT 1 CHECK (game_no BETWEEN 1 AND 10),
            side     TEXT    NOT NULL CHECK (side IN ('RED', 'BLUE')),
            UNIQUE (match_id, game_no, side)
        );
        INSERT INTO team_v6 (id, match_id, game_no, side) SELECT id, match_id, 1, side FROM team;
        DROP TABLE team;
        ALTER TABLE team_v6 RENAME TO team;
      `);
    },
  },
];

const LATEST_VERSION = Math.max(1, ...MIGRATIONS.map((m) => m.version));

function tableExists(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} schemaSql 최신 스키마 SQL
 */
function migrate(db, schemaSql) {
  const isNew = !tableExists(db, 'guild');
  if (isNew) {
    db.exec(schemaSql);
    db.pragma(`user_version = ${LATEST_VERSION}`);
    return;
  }

  let current = db.pragma('user_version', { simple: true }) || 1;
  const pending = MIGRATIONS.filter((m) => m.version > current).sort((a, b) => a.version - b.version);
  if (pending.length > 0) {
    // 테이블 재생성 중 외래키 검사를 잠시 끈다. (트랜잭션 밖에서만 바꿀 수 있음)
    db.pragma('foreign_keys = OFF');
    try {
      for (const m of pending) {
        db.transaction(() => {
          m.up(db);
          db.pragma(`user_version = ${m.version}`);
        })();
        current = m.version;
        console.log(`DB 마이그레이션 적용: v${m.version}`);
      }
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
  // 새로 추가된 인덱스 등 IF NOT EXISTS 구문을 보충한다.
  db.exec(schemaSql);
}

module.exports = { migrate, LATEST_VERSION, MIGRATIONS };
