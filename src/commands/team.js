const { SlashCommandBuilder } = require('discord.js');
const { SIDE_LABELS } = require('../constants');
const { matchEmbed } = require('../utils/format');

const sideChoices = Object.entries(SIDE_LABELS).map(([value, name]) => ({ name, value }));

module.exports = {
  data: new SlashCommandBuilder()
    .setName('팀')
    .setDescription('대전관리 - 팀 관리')
    .addSubcommand((s) =>
      s
        .setName('등록')
        .setDescription('원하는 팀을 직접 선택합니다. (팀 셔플에서 제외됩니다)')
        .addStringOption((o) =>
          o.setName('팀').setDescription('레드팀 / 블루팀').setRequired(true).addChoices(...sideChoices),
        ),
    )
    .addSubcommand((s) => s.setName('탈퇴').setDescription('소속된 팀에서 빠집니다.'))
    .addSubcommand((s) =>
      s.setName('셔플').setDescription('10명이 모이면 팀을 자동으로 섞어 정합니다. (포지션 우선)'),
    ),

  async execute(interaction, { services, guild }) {
    const base = { guildId: guild.id, discordUserId: interaction.user.id };
    const sub = interaction.options.getSubcommand();

    if (sub === '등록') {
      const side = interaction.options.getString('팀', true);
      services.teams.joinTeam({ ...base, side });
      return interaction.reply(`📌 ${interaction.user} 님이 **${SIDE_LABELS[side]}**에 등록했습니다.`);
    }

    if (sub === '탈퇴') {
      services.teams.leaveTeam(base);
      return interaction.reply(`↩️ ${interaction.user} 님이 팀에서 빠졌습니다.`);
    }

    if (sub === '셔플') {
      const view = services.teams.shuffle(base);
      return interaction.reply({
        content: '🎲 팀 셔플 완료! 준비되면 `/대전 시작`을 입력해 주세요.',
        embeds: [matchEmbed(view, `대전 #${view.match.id} 팀 구성`)],
      });
    }
  },
};
