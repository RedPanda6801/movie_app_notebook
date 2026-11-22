require('dotenv').config({ quiet: true });

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`환경 변수 ${name}이(가) 설정되지 않았습니다. .env.example을 참고해 .env를 만들어 주세요.`);
  }
  return value;
}

module.exports = {
  get token() {
    return required('DISCORD_TOKEN');
  },
  get clientId() {
    return required('DISCORD_CLIENT_ID');
  },
  devGuildId: process.env.DISCORD_DEV_GUILD_ID || null,
  databasePath: process.env.DATABASE_PATH || 'data/bot.sqlite',
  logDir: process.env.LOG_DIR || 'logs',
  recordsDir: process.env.RECORDS_DIR || 'data/records',
  // 데이터적재 이미지 자동 인식: paligemma(무료, 로컬) | claude(유료) | off
  scoreboardProvider: process.env.SCOREBOARD_PROVIDER || null,
  paligemmaUrl: process.env.PALIGEMMA_URL || 'http://127.0.0.1:8765',
  paligemmaTilesX: Number(process.env.PALIGEMMA_TILES_X || 2),
  paligemmaTilesY: Number(process.env.PALIGEMMA_TILES_Y || 5),
  paligemmaTimeoutMs: Number(process.env.PALIGEMMA_TIMEOUT_SEC || 600) * 1000,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  scoreboardModel: process.env.SCOREBOARD_MODEL || 'claude-opus-5-5',
  logTimeZone: process.env.LOG_TIMEZONE || 'Asia/Seoul',
};
