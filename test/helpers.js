const { openDatabase } = require('../src/db');
const { createServices } = require('../src/services');

function setup({ random } = {}) {
  const db = openDatabase(':memory:');
  const services = createServices(db, { random });
  const guild = services.guilds.ensureGuild('guild-1', '테스트 서버');
  const users = Array.from({ length: 12 }, (_, i) => `user-${i + 1}`);
  const gameName = (u) => `lol${u.replace(/\W/g, "")}#KR1`;
  const register = (u, g = guild) =>
    services.accounts.register({ guildId: g.id, discordUserId: u, username: u });
  const create = (u, gameCount = 3, g = guild) =>
    services.matches.createMatch({ guildId: g.id, discordUserId: u, channelId: 'ch', gameCount, gameName: gameName(u) });
  const join = (u, g = guild) =>
    services.matches.join({ guildId: g.id, discordUserId: u, gameName: gameName(u) });
  // 등록자 users[0] + 9명 참가 = 10명
  const fill = (gameCount = 3) => {
    users.slice(0, 10).forEach((u) => register(u));
    const match = create(users[0], gameCount);
    users.slice(1, 10).forEach((u) => join(u));
    return match;
  };
  return { db, services, guild, users, register, create, join, fill, gameName };
}

module.exports = { setup };
