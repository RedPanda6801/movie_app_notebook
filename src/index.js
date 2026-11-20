const { Client, Events, GatewayIntentBits, MessageFlags } = require('discord.js');
const config = require('./config');
const { openDatabase } = require('./db');
const { createServices } = require('./services');
const { commands } = require('./commands');
const { UserError } = require('./utils/errors');

const db = openDatabase(config.databasePath);
const services = createServices(db);
const commandMap = new Map(commands.map((c) => [c.data.name, c]));

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

// [수동] 슬래시 커맨드 처리
client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const command = commandMap.get(interaction.commandName);
  if (!command) return;

  try {
    if (!interaction.inGuild()) {
      throw new UserError('이 봇의 커맨드는 서버 채널에서만 사용할 수 있습니다.');
    }
    const guild = services.guilds.ensureGuild(interaction.guildId, interaction.guild?.name ?? null);
    await command.execute(interaction, { services, guild });
  } catch (err) {
    const isUserError = err instanceof UserError;
    if (!isUserError) console.error(`/${interaction.commandName} 처리 중 오류:`, err);
    const content = isUserError ? `⚠️ ${err.message}` : '❌ 요청을 처리하는 중 오류가 발생했습니다.';
    const payload = { content, flags: MessageFlags.Ephemeral };
    try {
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload);
      else await interaction.reply(payload);
    } catch (replyErr) {
      console.error('오류 응답 전송 실패:', replyErr);
    }
  }
});

function shutdown() {
  client.destroy();
  db.close();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

client.login(config.token);
