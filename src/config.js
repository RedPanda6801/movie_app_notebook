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
  logTimeZone: process.env.LOG_TIMEZONE || 'Asia/Seoul',
  // (선택) /관리자 데이터적재 이미지 자동 읽기. 키가 없으면 관리자가 직접 입력한다.
  geminiApiKey: process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || null,
  geminiModel: (process.env.GEMINI_MODEL || '').trim() || 'gemini-flash-latest',
};
