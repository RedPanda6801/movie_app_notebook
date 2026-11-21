const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS, mention } = require('../utils/format');

const MEDALS = ['🥇', '🥈', '🥉'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('승점')
    .setDescription('대전관리 - 개인별 승점 조회 (판 1승 = 1점, 관리자 전용)')
    .addSubcommand((s) =>
      s
        .setName('조회')
        .setDescription('승점을 조회합니다.')
        .addUserOption((o) => o.setName('사용자').setDescription('조회할 사용자 (기본: 나)')),
    )
    .addSubcommand((s) => s.setName('랭킹').setDescription('이 서버의 승점 랭킹 TOP 10')),

  async execute(interaction, { services, guild }) {
    const sub = interaction.options.getSubcommand();

    if (sub === '조회') {
      const user = interaction.options.getUser('사용자') ?? interaction.user;
      const stats = services.points.getStats(guild.id, user.id);
      const rate = stats.games ? Math.round((stats.wins / stats.games) * 100) : 0;
      const embed = new EmbedBuilder()
        .setColor(COLORS.GREEN)
        .setTitle('승점 조회')
        .setDescription(
          `${mention(user.id)}${stats.member.status === 'WITHDRAWN' ? ' (탈퇴)' : ''}\n` +
            `**${stats.points}점** · ${stats.games}전 ${stats.wins}승 ${stats.losses}패 (승률 ${rate}%)`,
        );
      return interaction.reply({ embeds: [embed] });
    }

    if (sub === '랭킹') {
      const ranking = services.points.getRanking(guild.id, 10);
      const body = ranking.length
        ? ranking
            .map(
              (r, i) =>
                `${MEDALS[i] ?? `**${i + 1}.**`} ${mention(r.discordUserId)} — **${r.points}점** (${r.games}전 ${r.wins}승 ${r.losses}패)`,
            )
            .join('\n')
        : '아직 등록된 계정이 없습니다.';
      const embed = new EmbedBuilder().setColor(COLORS.GREEN).setTitle('🏆 승점 랭킹').setDescription(body);
      return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
    }
  },
};
