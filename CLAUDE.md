# 프로젝트 개요

디스코드 채팅방 내에서 5대5 게임 대전을 관리할 디스코드 커스텀 봇 개발

## 개발 요건

- 대전을 조율 및 관리해줄 디스코드 봇을 생성한다.
- 봇은 자동 또는 수동(입력되는 명령어)으로 작업을 수행한다.
- 구조: **계정관리 서비스**(서비스 이용 자격 관리) + **대전관리 서비스**(대전별 등록 및 팀 섞기)

### 1. 계정관리 서비스
- **계정 등록**: 커맨드로 아이디별 계정을 등록한다.
- **계정 탈퇴**: 커맨드로 계정을 탈퇴한다.

### 2. 대전관리 서비스
사용자 관리 / 팀 관리 / 개인별 승점 조회

#### 2-1. 사용자 관리
- **대전 등록**: 커맨드로 이번 대전에 참가한다.
- **대전 탈퇴**: 커맨드로 대전 참가를 철회한다.
- **포지션 선택**: 커맨드로 탑/미드/정글/원딜/서폿 중 하나를 선택한다.

#### 2-2. 팀 관리
- **팀 등록**: 커맨드로 원하는 팀을 선택한다.
- **팀 탈퇴**: 커맨드로 팀에서 탈퇴한다.
- **팀 자동셔플**: 대전에 10명이 등록되어 있을 때만 사용 가능하며, 랜덤으로 팀을 섞어 정해준다.
  - 개인에게 포지션이 등록되어 있다면 포지션을 우선으로 고려한다.
  - 개인이 팀 등록을 미리 했다면 해당 인원은 셔플 대상에서 제외한다(선택한 팀 유지).

#### 2-3. 개인별 승점 조회
- 사용자별 승점을 조회할 수 있다.

## 기술 스택

- **Runtime**: Node.js
- **Discord 라이브러리**: discord.js
- **DB**: SQLite

## 데이터베이스 설계 (RDB)

### 설계 원칙

- DB는 **SQLite 파일 1개**를 모든 디스코드 서버가 함께 쓰고, **서버(guild) 단위로 데이터를 논리적으로 분리**한다.
- 기본 흐름: **서버(guild) - 계정(account) - 대전(match) - 팀(team) - 대전기록(match_record)**
- **계정은 디스코드 사용자당 1개** (`account.discord_user_id` UNIQUE)
- **서버 ↔ 계정 = N:M**: 한 사람이 여러 서버에 가입할 수 있다. 연결 테이블은 **서버회원(guild_member)**이며, `UNIQUE(guild_id, account_id)`로 서버당 1회만 가입할 수 있다.
  - 커맨드의 "계정 등록/탈퇴"는 **해당 서버의 guild_member 등록/탈퇴**를 뜻한다. `account`는 처음 등록할 때 자동으로 만들어진다.
  - 그래서 A 서버에서 탈퇴해도 B 서버의 가입과 승점에는 영향이 없다.
- **서버 ↔ 대전 = 1:N**: 대전은 반드시 하나의 서버에 속하고, 서버마다 대전을 여러 개 만들 수 있다.
- 대전마다 팀은 **2개**, 기본값은 **레드팀(RED) / 블루팀(BLUE)** (`UNIQUE(match_id, side)`)
- **대전 ↔ 서버회원 = N:M**이므로 **대전참가자(match_participant)**로 풀어낸다. 참가자는 `guild_member`를 참조하므로 **해당 서버에 가입한 사람만** 대전에 참가할 수 있다.
- 대전기록은 현재 대전과 **1:1** (`match_record.match_id` UNIQUE). 이후 요구사항이 바뀌면 **1:n**으로 확장 (UNIQUE 제약만 제거)

### ERD

```mermaid
erDiagram
    GUILD        ||--o{ GUILD_MEMBER      : "가입자"
    ACCOUNT      ||--o{ GUILD_MEMBER      : "가입 서버"
    GUILD        ||--o{ MATCH             : "대전 (1:N)"
    GUILD_MEMBER ||--o{ MATCH_PARTICIPANT : "대전 참가"
    MATCH        ||--o{ MATCH_PARTICIPANT : "참가자 (최대 10명)"
    MATCH        ||--|{ TEAM              : "보유 (정확히 2개)"
    TEAM         ||--o{ MATCH_PARTICIPANT : "소속 (최대 5명)"
    MATCH        ||--o| MATCH_RECORD      : "기록 (현재 1:1 → 추후 1:n)"
    TEAM         ||--o{ MATCH_RECORD      : "승리팀"

    GUILD {
        INTEGER id PK
        TEXT    discord_guild_id UK "디스코드 서버 ID"
        TEXT    name
        TEXT    status "ACTIVE | LEFT (봇이 서버에서 나감)"
        TEXT    joined_at "봇 참가 일시"
        TEXT    left_at   "nullable"
    }

    ACCOUNT {
        INTEGER id PK
        TEXT    discord_user_id UK "디스코드 사용자 ID (사용자당 1계정)"
        TEXT    username
        TEXT    created_at
    }

    GUILD_MEMBER {
        INTEGER id PK
        INTEGER guild_id   FK "UNIQUE: guild_id + account_id"
        INTEGER account_id FK
        TEXT    display_name "서버 내 표시 이름"
        TEXT    status "ACTIVE | WITHDRAWN"
        TEXT    registered_at
        TEXT    withdrawn_at "nullable"
    }

    MATCH {
        INTEGER id PK
        INTEGER guild_id FK
        TEXT    channel_id "디스코드 채널 ID"
        TEXT    status "RECRUITING | READY | IN_PROGRESS | FINISHED | CANCELED"
        INTEGER created_by FK "guild_member.id"
        TEXT    created_at
    }

    TEAM {
        INTEGER id PK
        INTEGER match_id FK
        TEXT    side "RED | BLUE  (UNIQUE: match_id + side)"
    }

    MATCH_PARTICIPANT {
        INTEGER id PK
        INTEGER match_id        FK
        INTEGER guild_member_id FK "UNIQUE: match_id + guild_member_id"
        INTEGER team_id         FK "nullable - 셔플 전에는 미배정"
        TEXT    position "TOP | MID | JUNGLE | ADC | SUPPORT (nullable)"
        INTEGER is_team_locked "1 = 팀 직접 등록 → 셔플 제외"
        TEXT    joined_at
    }

    MATCH_RECORD {
        INTEGER id PK
        INTEGER match_id       FK "현재 UNIQUE (1:1)"
        INTEGER winner_team_id FK "team.id"
        TEXT    played_at
    }
```

### 테이블 설명

| 테이블 | 역할 | 주요 제약 |
|---|---|---|
| `guild` | 봇이 참가한 디스코드 서버 | `discord_guild_id` UNIQUE. 봇이 서버에 들어올 때(`guildCreate` 이벤트) 자동 생성하고, 나갈 때(`guildDelete`) `status = LEFT`로 바꾼다 |
| `account` | 디스코드 사용자 (전역) | `discord_user_id` UNIQUE. 사용자당 1개 |
| `guild_member` | 서버별 가입 정보 (계정 등록/탈퇴) | `UNIQUE(guild_id, account_id)`. 탈퇴하면 `status = WITHDRAWN`으로 바꾸는 soft delete (기록 보존용). 다시 가입하면 같은 행을 `ACTIVE`로 되돌린다 |
| `match` | 대전 1건 | `guild_id` NOT NULL. `status`로 모집 → 진행 → 종료 상태를 관리 |
| `team` | 대전의 팀 (RED/BLUE) | 대전을 만들 때 2개를 자동 생성. `UNIQUE(match_id, side)`, `side IN ('RED','BLUE')` |
| `match_participant` | 대전 참가자 (대전 등록/탈퇴, 포지션 선택, 팀 등록/탈퇴) | `UNIQUE(match_id, guild_member_id)`. 대전당 10명, 팀당 5명 제한, 참가자가 대전과 같은 서버 회원인지는 애플리케이션에서 검증 |
| `match_record` | 대전 결과 | 현재 `match_id` UNIQUE (1:1) |

### 기능 ↔ 테이블 매핑

- **봇 서버 참가 / 퇴장** → `guild` INSERT(또는 `ACTIVE`로 복구) / `status = LEFT`
- **계정 등록** → `account`가 없으면 INSERT → `guild_member` INSERT(또는 `ACTIVE`로 복구)
- **계정 탈퇴** → 해당 서버의 `guild_member.status = WITHDRAWN` (다른 서버 가입에는 영향 없음)
- **대전 등록 / 탈퇴** → `match_participant` INSERT / DELETE (`ACTIVE` 상태의 guild_member만 가능)
- **포지션 선택** → `match_participant.position` UPDATE
- **팀 등록 / 탈퇴** → `match_participant.team_id` 설정 + `is_team_locked = 1` / `team_id = NULL` + `is_team_locked = 0`
- **팀 자동셔플** → 참가자가 10명인지 확인 → `is_team_locked = 0`인 참가자만 대상으로, 포지션이 겹치지 않도록 우선 배치한 뒤 나머지를 랜덤으로 `team_id` 배정
- **개인별 승점 조회** → `guild_member` 기준으로 `match_participant.team_id`와 `match_record.winner_team_id`를 JOIN해서 **서버별로** 계산 (승점 규칙은 추후 확정)

### 구현 시 주의

- 모든 조회와 변경은 **현재 커맨드가 들어온 서버(guild) 범위**로 한정한다. 다른 서버의 데이터가 섞이지 않도록 서비스 계층에서 `guild_id` 조건을 강제한다.

### 확장 메모 (대전기록 1:n 전환 시)

- `match_record.match_id`의 UNIQUE 제약을 제거한다.
- 판마다 팀 구성이 바뀔 수 있다면, 판별 팀 배정을 저장하는 `record_participant(record_id, guild_member_id, team_id, position)` 테이블을 추가하는 방안을 검토한다.
