const { openDatabase } = require('../src/db');
const { createServices } = require('../src/services');

function setup({ random } = {}) {
  const db = openDatabase(':memory:');
  const services = createServices(db, { random });
  const guild = services.guilds.ensureGuild('guild-1', '테스트 서버');
  const users = Array.from({ length: 12 }, (_, i) => `user-${i + 1}`);
  const register = (u, g = guild) =>
    services.accounts.register({ guildId: g.id, discordUserId: u, username: u });
  const join = (u, g = guild) =>
    services.matches.join({ guildId: g.id, discordUserId: u, channelId: 'ch' });
  return { db, services, guild, users, register, join };
}

module.exports = { setup };
