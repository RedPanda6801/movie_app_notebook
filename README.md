# 디스코드 5대5 대전 관리 봇

디스코드 서버에서 5대5 내전을 모집하고, 팀을 나누고, 결과와 승점을 기록하는 봇입니다.
(Node.js · discord.js v14 · SQLite)

## 실행 방법

1. **봇 만들기**: [Discord Developer Portal](https://discord.com/developers/applications)에서 애플리케이션을 만들고 Bot 토큰을 발급받습니다.
2. **서버에 초대**: OAuth2 > URL Generator에서 scope `bot`, `applications.commands`를 선택하고, 권한은 `Send Messages`, `Embed Links`를 체크한 URL로 초대합니다.
3. **설치**
   ```bash
   npm install
   cp .env.example .env   # DISCORD_TOKEN, DISCORD_CLIENT_ID 입력
   ```
4. **슬래시 커맨드 등록** (커맨드 정의가 바뀔 때마다 실행)
   ```bash
   npm run deploy
   ```
   `.env`에 `DISCORD_DEV_GUILD_ID`를 넣으면 그 서버에만 즉시 등록되고, 비우면 전역으로 등록됩니다(반영까지 시간이 걸릴 수 있음).
5. **봇 실행**
   ```bash
   npm start
   ```

데이터는 `data/bot.sqlite`에 저장됩니다. (`DATABASE_PATH`로 변경 가능)

## 사용 흐름

```
/계정 등록 → /대전 참가 (10명) → /대전 포지션 · /팀 등록 (선택)
→ /팀 셔플 → /대전 시작 → /대전 결과 → /승점 조회 · /승점 랭킹
```

전체 커맨드와 설계 문서는 [CLAUDE.md](CLAUDE.md)를 참고하세요.

## 테스트

```bash
npm test
```
