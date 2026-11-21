const { SlashCommandBuilder } = require('discord.js');
const { MATCH_SIZE, POSITIONS, POSITION_LABELS, SIDE_LABELS } = require('../constants');
const { matchEmbed, participantsEmbed, positionLabel } = require('../utils/format');
const views = require('../interactions/views');
const { refreshMatchMessage, postFinishMessage } = require('../interactions/matchMessage');

const sideChoices = Object.entries(SIDE_LABELS).map(([value, name]) => ({ name, value }));
const positionChoices = [
  ...POSITIONS.map((value) => ({ name: POSITION_LABELS[value], value })),
  { name: '미정', value: 'NONE' },
];

/**
 * /대전 - 관리자 전용 커맨드.
 * 일반 사용자는 /대전 관리 로 올린 패널과 대전 정보 메시지의 버튼을 사용한다.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('대전')
    .setDescription('대전관리 (관리자 전용)')
    .addSubcommand((s) =>
      s.setName('관리').setDescription('이 채널에 [대전 등록]/[진행중인 대전 조회] 버튼 패널을 올립니다.'),
    )
    .addSubcommand((s) =>
      s
        .setName('참가')
        .setDescription('(관리자 본인) 진행 중인 대전에 참가합니다.')
        .addStringOption((o) => o.setName('아이디').setDescription('롤 아이디 (예: Hide on bush#KR1)')),
    )
    .addSubcommand((s) => s.setName('탈퇴').setDescription('(관리자 본인) 대전 참가를 철회합니다.'))
    .addSubcommand((s) =>
      s
        .setName('포지션')
        .setDescription('(관리자 본인) 포지션을 선택합니다.')
        .addStringOption((o) =>
          o.setName('포지션').setDescription('희망 포지션').setRequired(true).addChoices(...positionChoices),
        ),
    )
    .addSubcommand((s) => s.setName('참가자').setDescription('이번 대전에 참가한 사람 목록을 봅니다.'))
    .addSubcommand((s) => s.setName('현황').setDescription('현재 대전 현황(팀 구성, 기록)을 봅니다.'))
    .addSubcommand((s) => s.setName('시작').setDescription('10명이 모인 대전을 시작합니다.'))
    .addSubcommand((s) =>
      s
        .setName('결과')
        .setDescription('팀 기준으로 다음 판 결과를 기록합니다. (팀 구성이 끝난 경우, 승리팀 5명 승점 +1)')
        .addStringOption((o) =>
          o.setName('승리팀').setDescription('이긴 팀').setRequired(true).addChoices(...sideChoices),
        ),
    )
    .addSubcommand((s) => s.setName('종료').setDescription('진행 중인 대전을 종료하고 결과를 채널에 공개합니다.'))
    .addSubcommand((s) => s.setName('취소').setDescription('진행 중인 대전을 취소합니다.')),

  async execute(interaction, { services, guild, isAdmin, client }) {
    const base = {
      guildId: guild.id,
      discordUserId: interaction.user.id,
      channelId: interaction.channelId,
      isAdmin,
    };
    const { matches } = services;
    const refresh = (matchId) => refreshMatchMessage(client, services, matchId);
    const sub = interaction.options.getSubcommand();

    switch (sub) {
      case '관리':
        // 버튼 패널은 모두가 눌러야 하므로 공개 메시지로 올린다.
        return interaction.reply({ ...views.panelMessage(), public: true });

      case '참가': {
        const gameName = interaction.options.getString('아이디');
        const { match, count } = matches.join({ ...base, gameName, requireGameName: false });
        await interaction.reply(`🙋 대전 #${match.id}에 참가했습니다. (${count}/${MATCH_SIZE})`);
        return refresh(match.id);
      }

      case '탈퇴': {
        const { match, count } = matches.leave(base);
        await interaction.reply(`🚪 대전 참가를 철회했습니다. (${count}/${MATCH_SIZE})`);
        return refresh(match.id);
      }

      case '포지션': {
        const value = interaction.options.getString('포지션', true);
        const position = value === 'NONE' ? null : value;
        matches.setPosition({ ...base, position });
        return interaction.reply(
          position ? `🎯 포지션: **${positionLabel(position)}**` : '🎯 포지션: **미정**',
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
        await interaction.reply('▶️ 대전을 시작했습니다.');
        return refresh(view.match.id);
      }

      case '결과': {
        const winnerSide = interaction.options.getString('승리팀', true);
        const { match, gameNo } = matches.recordGameByTeam({ ...base, winnerSide });
        await interaction.reply(`📸 ${gameNo}판: **${SIDE_LABELS[winnerSide]}** 승리로 기록했습니다.`);
        return refresh(match.id);
      }

      case '종료': {
        const view = matches.finish(base);
        await interaction.deferReply(); // 종료 알림 게시(네트워크) 전에 3초 제한을 피한다.
        await postFinishMessage(interaction.channel, services, view.match.id);
        await interaction.editReply('🏁 대전을 종료하고 결과를 채널에 공개했습니다.');
        return refresh(view.match.id);
      }

      case '취소': {
        const { match } = matches.cancel(base);
        await interaction.reply(`🛑 대전 #${match.id}이(가) 취소되었습니다.`);
        return refresh(match.id);
      }
    }
  },
};
