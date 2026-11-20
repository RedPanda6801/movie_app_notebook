const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('계정')
    .setDescription('계정관리 (이 서버 기준)')
    .addSubcommand((s) => s.setName('등록').setDescription('이 서버에 계정을 등록합니다.'))
    .addSubcommand((s) => s.setName('탈퇴').setDescription('이 서버에서 계정을 탈퇴합니다.')),

  async execute(interaction, { services, guild }) {
    const discordUserId = interaction.user.id;
    const sub = interaction.options.getSubcommand();

    if (sub === '등록') {
      const { reactivated } = services.accounts.register({
        guildId: guild.id,
        discordUserId,
        username: interaction.user.username,
        displayName: interaction.member?.displayName ?? interaction.user.globalName ?? null,
      });
      return interaction.reply(
        reactivated
          ? `✅ ${interaction.user} 님의 계정이 다시 등록되었습니다. 이전 승점 기록이 그대로 이어집니다.`
          : `✅ ${interaction.user} 님의 계정이 등록되었습니다. 이제 \`/대전 참가\`로 대전에 참가할 수 있습니다.`,
      );
    }

    if (sub === '탈퇴') {
      const { leftMatchId } = services.accounts.withdraw({ guildId: guild.id, discordUserId });
      const extra = leftMatchId ? ` 참가 중이던 대전 #${leftMatchId}에서도 빠졌습니다.` : '';
      return interaction.reply(`👋 ${interaction.user} 님이 계정을 탈퇴했습니다.${extra}`);
    }
  },
};
