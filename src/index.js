const { Client, Events, GatewayIntentBits } = require('discord.js');
const config = require('./config');
const { openDatabase } = require('./db');
const { createServices } = require('./services');
const { commands } = require('./commands');
const { createInteractionHandler } = require('./interactions/router');
const { createCommandLogger } = require('./utils/commandLogger');
const { createGeminiReader } = require('./integrations/geminiScoreboard');

const db = openDatabase(config.databasePath);
const services = createServices(db);
const commandMap = new Map(commands.map((c) => [c.data.name, c]));
const commandLogger = createCommandLogger({ dir: config.logDir, timeZone: config.logTimeZone });
// /관리자 데이터적재 이미지 자동 읽기 (GEMINI_API_KEY가 없으면 꺼짐 → 관리자가 직접 입력)
const geminiReader = createGeminiReader({ apiKey: config.geminiApiKey, model: config.geminiModel });

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  // 메시지 안의 멘션으로 알림이 울리지 않게 한다.
  allowedMentions: { parse: [] },
});

// [자동] 봇이 켜지면 현재 참가 중인 서버를 DB와 동기화한다.
client.once(Events.ClientReady, (c) => {
  for (const guild of c.guilds.cache.values()) {
    services.guilds.ensureGuild(guild.id, guild.name);
  }
  console.log(`${c.user.tag} 로그인 완료 · 서버 ${c.guilds.cache.size}개`);
  console.log(geminiReader.enabled ? `데이터적재 이미지 자동 읽기: Gemini (${geminiReader.model})` : '데이터적재 이미지 자동 읽기: 꺼짐 (GEMINI_API_KEY 없음)');
});

// [자동] 봇이 서버에 참가하면 서버를 등록한다.
client.on(Events.GuildCreate, (guild) => {
  services.guilds.ensureGuild(guild.id, guild.name);
  console.log(`서버 참가: ${guild.name} (${guild.id})`);
});

// [자동] 봇이 서버에서 나가면 서버 상태를 LEFT로 바꾼다. (기록은 보존)
client.on(Events.GuildDelete, (guild) => {
  services.guilds.markLeft(guild.id);
  console.log(`서버 퇴장: ${guild.name ?? ''} (${guild.id})`);
});

// 슬래시 커맨드(관리자 전용) + 버튼/선택 메뉴/입력창(모든 사용자)
client.on(
  Events.InteractionCreate,
  createInteractionHandler({ services, commandMap, commandLogger, config, client, geminiReader }),
);

function shutdown() {
  client.destroy();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(config.token);
