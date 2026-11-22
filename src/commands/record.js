const { SlashCommandBuilder } = require('discord.js');
const statsViews = require('../interactions/statsViews');

/**
 * /전적 - 관리자 전용 커맨드.
 * 전적관리 채널에 [대전별/개인별/전체 전적 조회] 버튼 패널을 올린다.
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('전적')
    .setDescription('전적관리 (관리자 전용)')
    .addSubcommand((s) =>
      s.setName('관리').setDescription('이 채널에 [대전별/개인별/전체 전적 조회] 버튼 패널을 올립니다.'),
    ),

  async execute(interaction) {
    if (interaction.options.getSubcommand() === '관리') {
      // 버튼 패널은 모두가 눌러야 하므로 공개 메시지로 올린다.
      return interaction.reply({ ...statsViews.statsPanelMessage(), public: true });
    }
  },
};
