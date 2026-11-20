const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { MATCH_SIZE, POSITIONS, POSITION_LABELS, SIDE_LABELS } = require('../constants');
const { matchEmbed, participantsEmbed, positionLabel } = require('../utils/format');

const sideChoices = Object.entries(SIDE_LABELS).map(([value, name]) => ({ name, value }));
const positionChoices = [
  ...POSITIONS.map((value) => ({ name: POSITION_LABELS[value], value })),
  { name: '선택 해제', value: 'NONE' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('대전')
    .setDescription('대전관리 - 사용자 관리')
    .addSubcommand((s) => s.setName('생성').setDescription('새 대전을 엽니다. (서버당 1개)'))
    .addSubcommand((s) =>
      s.setName('참가').setDescription('이번 대전에 참가합니다. 대전이 없으면 새로 엽니다.'),
    )
    .addSubcommand((s) => s.setName('탈퇴').setDescription('이번 대전 참가를 철회합니다.'))
    .addSubcommand((s) =>
      s
        .setName('포지션')
        .setDescription('포지션을 선택합니다.')
        .addStringOption((o) =>
          o.setName('포지션').setDescription('희망 포지션').setRequired(true).addChoices(...positionChoices),
        ),
    )
    .addSubcommand((s) => s.setName('참가자').setDescription('이번 대전에 참가한 사람 목록을 봅니다.'))
    .addSubcommand((s) => s.setName('현황').setDescription('현재 대전 현황을 봅니다.'))
    .addSubcommand((s) =>
      s.setName('시작').setDescription('팀 구성이 끝난 대전을 시작합니다. (대전 생성자/서버 관리자)'),
    )
    .addSubcommand((s) =>
      s
        .setName('결과')
        .setDescription('대전 결과를 기록합니다. 승리팀 전원 승점 +1 (대전 생성자/서버 관리자)')
        .addStringOption((o) =>
          o.setName('승리팀').setDescription('이긴 팀').setRequired(true).addChoices(...sideChoices),
        ),
    )
    .addSubcommand((s) =>
      s.setName('취소').setDescription('진행 중인 대전을 취소합니다. (대전 생성자/서버 관리자)'),
    ),

  async execute(interaction, { services, guild }) {
    const base = {
      guildId: guild.id,
      discordUserId: interaction.user.id,
      channelId: interaction.channelId,
      isServerManager: interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) ?? false,
    };
    const { matches } = services;
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case '생성': {
        const match = matches.createMatch(base);
        return interaction.reply({
          content: `📣 대전 #${match.id}이(가) 열렸습니다! \`/대전 참가\`로 참가해 주세요.`,
          embeds: [matchEmbed(matches.getMatchView(match.id))],
        });
      }

      case '참가': {
        const { match, created, count } = matches.join(base);
        const lines = [];
        if (created) lines.push(`📣 진행 중인 대전이 없어 대전 #${match.id}을(를) 새로 열었습니다.`);
        lines.push(`🙋 ${interaction.user} 님이 대전에 참가했습니다. (${count}/${MATCH_SIZE})`);
        if (count === MATCH_SIZE) {
          lines.push(`\n🎉 ${MATCH_SIZE}명이 모두 모였습니다! \`/팀 셔플\`로 팀을 나눠 주세요.`);
        }
        // 참가할 때마다 현재 참가자 목록을 함께 보여준다.
        return interaction.reply({
          content: lines.join('\n'),
          embeds: [participantsEmbed(matches.getMatchView(match.id))],
        });
      }

      case '탈퇴': {
        const { count } = matches.leave(base);
        return interaction.reply(
          `🚪 ${interaction.user} 님이 대전 참가를 철회했습니다. (${count}/${MATCH_SIZE})`,
        );
      }

      case '포지션': {
        const value = interaction.options.getString('포지션', true);
        const position = value === 'NONE' ? null : value;
        matches.setPosition({ ...base, position });
        return interaction.reply(
          position
            ? `🎯 ${interaction.user} 님의 포지션: **${positionLabel(position)}**`
            : `🎯 ${interaction.user} 님의 포지션 선택을 해제했습니다.`,
        );
      }

      case '참가자': {
        const match = matches.requireActiveMatch(guild.id);
        return interaction.reply({ embeds: [participantsEmbed(matches.getMatchView(match.id))] });
      }

      case '현황': {
        const match = matches.requireActiveMatch(guild.id);
        return interaction.reply({ embeds: [matchEmbed(matches.getMatchView(match.id))] });
      }

      case '시작': {
        const view = matches.start(base);
        return interaction.reply({
          content: '⚔️ 대전을 시작합니다! 끝나면 `/대전 결과`로 승리팀을 기록해 주세요.',
          embeds: [matchEmbed(view)],
        });
      }

      case '결과': {
        const winnerSide = interaction.options.getString('승리팀', true);
        const view = matches.finish({ ...base, winnerSide });
        return interaction.reply({
          content: `🏆 **${SIDE_LABELS[winnerSide]}** 승리! 승리팀 전원에게 승점 1점이 추가되었습니다.`,
          embeds: [matchEmbed(view, `대전 #${view.match.id} 결과`)],
        });
      }

      case '취소': {
        const { match } = matches.cancel(base);
        return interaction.reply(`🛑 대전 #${match.id}이(가) 취소되었습니다.`);
      }
    }
  },
};
