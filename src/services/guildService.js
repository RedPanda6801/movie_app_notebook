/** 서버(guild) 등록/퇴장 관리 */
function createGuildService(repos) {
  const { guilds } = repos;

  /** 봇이 서버에 참가했거나 서버에서 커맨드가 들어왔을 때 guild 행을 보장한다. */
  function ensureGuild(discordGuildId, name = null) {
    const existing = guilds.findByDiscordId(discordGuildId);
    if (!existing) {
      guilds.insert(discordGuildId, name);
    } else if (existing.status !== 'ACTIVE' || (name && existing.name !== name)) {
      guilds.reactivate(existing.id, name);
    }
    return guilds.findByDiscordId(discordGuildId);
  }

  /** 봇이 서버에서 나갔을 때 */
  function markLeft(discordGuildId) {
    guilds.markLeftByDiscordId(discordGuildId);
  }

  return { ensureGuild, markLeft };
}

module.exports = { createGuildService };
