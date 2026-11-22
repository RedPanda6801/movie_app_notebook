const { SlashCommandBuilder } = require('discord.js');
const { MATCH_STATUS_LABELS } = require('../constants');
const adminViews = require('../interactions/adminViews');
const { saveScreenshot, cleanupPendingScreenshots } = require('../utils/screenshotStore');

/**
 * /관리자 - 관리자 전용 커맨드
 * - 계정정보: 모든 계정의 정보를 행렬 표로 (+ CSV)
 * - 데이터적재: 대전 + 판 + 이미지를 받아, DB의 대전 목록에서 그 판을 찾아 K/D/A · 승점을 갱신
 */
module.exports = {
  data: new SlashCommandBuilder()
    .setName('관리자')
    .setDescription('관리자 기능 (관리자 전용)')
    .addSubcommand((s) => s.setName('계정정보').setDescription('이 서버의 모든 계정 정보를 표로 봅니다.'))
    .addSubcommand((s) =>
      s
        .setName('데이터적재')
        .setDescription('종료된 대전의 한 판을 찾아 이미지를 보고 K/D/A · 승패(승점)를 입력/갱신합니다.')
        .addIntegerOption((o) =>
          o.setName('대전').setDescription('종료된 대전 번호 (입력하면 목록에서 고를 수 있습니다)').setRequired(true).setMinValue(1).setAutocomplete(true),
        )
        .addIntegerOption((o) =>
          o.setName('판').setDescription('몇 번째 판인지 (1~10)').setRequired(true).setMinValue(1).setMaxValue(10),
        )
        .addAttachmentOption((o) => o.setName('이미지').setDescription('경기 결과 캡쳐 이미지').setRequired(true)),
    ),

  /** 대전 번호 자동완성: 이 서버의 종료된 대전 (최근 25개) */
  async autocomplete(interaction, { services, guild }) {
    const typed = String(interaction.options.getFocused() ?? '').trim();
    const choices = services.admin
      .listLoadableMatches(guild.id, 100)
      .filter((m) => !typed || String(m.id).startsWith(typed))
      .slice(0, 25)
      .map((m) => ({
        name: `대전 #${m.id} · ${String(m.created_at).slice(0, 10)} · ${MATCH_STATUS_LABELS[m.status]} · ${m.record_count}/${m.game_count}판 기록`,
        value: m.id,
      }));
    return interaction.respond(choices);
  },

  async execute(interaction, { services, guild, config, fetchImpl }) {
    const sub = interaction.options.getSubcommand();

    if (sub === '계정정보') {
      return interaction.reply(adminViews.accountTableMessage(services.admin.listAccounts(guild.id)));
    }

    if (sub === '데이터적재') {
      const matchId = interaction.options.getInteger('대전', true);
      const gameNo = interaction.options.getInteger('판', true);
      const attachment = interaction.options.getAttachment('이미지', true);
      // 대전/판 확인 (없으면 바로 안내)
      const roster = services.admin.getGameRoster(guild.id, matchId, gameNo);
      // 이미지 다운로드가 3초를 넘을 수 있어 먼저 응답을 예약한다.
      await interaction.deferReply();
      await cleanupPendingScreenshots(config.recordsDir, interaction.guildId);
      // 디스코드 첨부 주소는 만료되므로 바로 내려받아 '대기 캡쳐'로 둔다. 저장하면 그 판의 캡쳐가 된다.
      const token = interaction.id;
      const pendingPath = await saveScreenshot({
        dir: config.recordsDir,
        discordGuildId: interaction.guildId,
        attachment,
        baseName: `pending-${token}`,
        ...(fetchImpl ? { fetchImpl } : {}),
      });
      return interaction.editReply(adminViews.loadPreviewMessage(roster, pendingPath, token));
    }
  },
};
