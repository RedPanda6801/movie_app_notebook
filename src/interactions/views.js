const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  FileUploadBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const {
  MATCH_SIZE,
  MAX_GAMES,
  MIN_GAMES,
  POSITIONS,
  POSITION_LABELS,
  MATCH_STATUS,
  MATCH_STATUS_LABELS,
  TEAM_SIZE,
} = require('../constants');
const { COLORS, mention, positionLabel } = require('../utils/format');
const { ACTIONS, buildId } = require('./ids');

const STATUS_COLORS = {
  RECRUITING: COLORS.BLUE,
  IN_PROGRESS: COLORS.RED,
  FINISHED: COLORS.GREEN,
  CANCELED: COLORS.NEUTRAL,
};

function button(customId, label, style = ButtonStyle.Secondary, emoji = null) {
  const b = new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(style);
  if (emoji) b.setEmoji(emoji);
  return b;
}

/* ───────────── /대전 관리 패널 (모두에게 보임) ───────────── */

function panelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('⚔️ 5대5 내전 관리')
    .setColor(COLORS.BLUE)
    .setDescription(
      [
        '아래 버튼으로 내전을 등록하고 참가할 수 있습니다.',
        '',
        '1️⃣ 처음이라면 **[계정 등록]**을 먼저 눌러 주세요.',
        '2️⃣ **[대전 등록]**으로 판 수를 정해 대전을 엽니다. (서버당 1개)',
        '3️⃣ 대전 정보 메시지의 **[대전 참가]**로 롤 아이디를 입력하고 참가합니다.',
        '',
        '버튼을 누른 결과는 누른 사람에게만 보입니다.',
      ].join('\n'),
    );
  const rows = [
    new ActionRowBuilder().addComponents(
      button(ACTIONS.PANEL_CREATE, '대전 등록', ButtonStyle.Primary, '📝'),
      button(ACTIONS.PANEL_ACTIVE, '진행중인 대전 조회', ButtonStyle.Secondary, '🔎'),
    ),
    new ActionRowBuilder().addComponents(
      button(ACTIONS.PANEL_REGISTER, '계정 등록', ButtonStyle.Success, '✅'),
      button(ACTIONS.PANEL_WITHDRAW, '계정 탈퇴', ButtonStyle.Danger, '👋'),
    ),
  ];
  return { embeds: [embed], components: rows };
}

/* ───────────── 대전 등록: 판 수 선택 → 롤 아이디 입력 ───────────── */

function gameCountSelect() {
  const select = new StringSelectMenuBuilder()
    .setCustomId(ACTIONS.CREATE_GAMES)
    .setPlaceholder('진행할 판 수를 선택하세요')
    .addOptions(
      Array.from({ length: MAX_GAMES - MIN_GAMES + 1 }, (_, i) => {
        const n = MIN_GAMES + i;
        return { label: `${n}판`, value: String(n) };
      }),
    );
  return {
    content: '📝 **대전 등록** - 이번 대전에서 진행할 판 수를 골라 주세요. (1~10판)',
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

/** 롤 아이디 입력창 (대전 등록 / 대전 참가 공용) */
function gameNameModal(customId, title, defaultValue) {
  const input = new TextInputBuilder()
    .setCustomId('gameName')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(5)
    .setMaxLength(30)
    .setPlaceholder('게임이름#태그 (예: Hide on bush#KR1)');
  if (defaultValue) input.setValue(defaultValue);
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('롤 아이디')
        .setDescription('대전에서 사용할 롤 아이디를 입력해 주세요.')
        .setTextInputComponent(input),
    );
}

/* ───────────── 공개 대전 정보 메시지 ───────────── */

function participantLines(participants, { detail = false } = {}) {
  if (participants.length === 0) return '아직 참가자가 없습니다.';
  return participants
    .map((p, i) => {
      const parts = [`**${i + 1}.** ${mention(p.discord_user_id)}`];
      if (detail) {
        parts.push(`\`${positionLabel(p.position)}\``);
        parts.push(p.game_name ? `🎮 ${p.game_name}` : '🎮 아이디 미입력');
      }
      return parts.join(' · ');
    })
    .join('\n');
}

function matchSummaryFields(view) {
  const { match, participants, games } = view;
  const fields = [
    { name: '등록자', value: view.creatorDiscordUserId ? mention(view.creatorDiscordUserId) : '-', inline: true },
    { name: '판 수', value: `${match.game_count}판`, inline: true },
    { name: '상태', value: MATCH_STATUS_LABELS[match.status], inline: true },
  ];
  if (match.status !== MATCH_STATUS.RECRUITING) {
    fields.push({ name: '기록된 판', value: `${games.length}/${match.game_count}판`, inline: true });
  }
  fields.push({ name: `참가자 (${participants.length}/${MATCH_SIZE})`, value: participantLines(participants) });
  return fields;
}

/** 채널에 모두에게 보이는 대전 정보 메시지 (참가/탈퇴/조회/포지션 버튼 포함) */
function matchPublicMessage(view) {
  const { match, participants } = view;
  const embed = new EmbedBuilder()
    .setTitle(`⚔️ 대전 #${match.id}`)
    .setColor(STATUS_COLORS[match.status])
    .addFields(matchSummaryFields(view));

  const isActive = match.status === MATCH_STATUS.RECRUITING || match.status === MATCH_STATUS.IN_PROGRESS;
  if (match.status === MATCH_STATUS.RECRUITING) {
    embed.setDescription(
      participants.length >= MATCH_SIZE
        ? '🎉 10명이 모두 모였습니다! 관리자가 대전을 시작할 수 있습니다.'
        : '아래 **[대전 참가]** 버튼을 눌러 롤 아이디를 입력하고 참가하세요.',
    );
  } else if (match.status === MATCH_STATUS.IN_PROGRESS) {
    embed.setDescription('⚔️ 대전이 진행 중입니다.');
  } else {
    embed.setDescription(match.status === MATCH_STATUS.FINISHED ? '🏁 종료된 대전입니다.' : '🛑 취소된 대전입니다.');
  }

  if (!isActive) return { embeds: [embed], components: [] };

  const recruiting = match.status === MATCH_STATUS.RECRUITING;
  const row1 = new ActionRowBuilder().addComponents(
    button(buildId(ACTIONS.JOIN, match.id), '대전 참가', ButtonStyle.Success, '🙋').setDisabled(!recruiting),
    button(buildId(ACTIONS.LEAVE, match.id), '대전 탈퇴', ButtonStyle.Danger, '🚪').setDisabled(!recruiting),
    button(buildId(ACTIONS.VIEW, match.id), '대전 조회', ButtonStyle.Secondary, '🔎'),
    button(buildId(ACTIONS.POSITION, match.id), '포지션 등록/변경', ButtonStyle.Secondary, '🎯').setDisabled(!recruiting),
  );
  const row2 = new ActionRowBuilder().addComponents(
    button(buildId(ACTIONS.MANAGE, match.id), '대전 관리', ButtonStyle.Primary, '🛠️'),
  );
  return { embeds: [embed], components: [row1, row2] };
}

/* ───────────── 대전 조회 (본인만) ───────────── */

function matchDetailEmbed(view) {
  const { match, participants, games } = view;
  const embed = new EmbedBuilder()
    .setTitle(`🔎 대전 #${match.id} 현황`)
    .setColor(STATUS_COLORS[match.status])
    .addFields(
      { name: '판 수', value: `${match.game_count}판`, inline: true },
      { name: '상태', value: MATCH_STATUS_LABELS[match.status], inline: true },
      { name: '기록된 판', value: `${games.length}/${match.game_count}판`, inline: true },
      {
        name: `참가자 (${participants.length}/${MATCH_SIZE}) · 포지션 · 롤 아이디`,
        value: participantLines(participants, { detail: true }),
      },
    );
  return embed;
}

/** 대전 정보 메시지로 이동하는 링크 */
function matchMessageLink(discordGuildId, match) {
  if (!match.message_channel_id || !match.message_id) return null;
  return `https://discord.com/channels/${discordGuildId}/${match.message_channel_id}/${match.message_id}`;
}

/* ───────────── 포지션 선택 (본인만) ───────────── */

function positionSelect(matchId, current) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildId(ACTIONS.POSITION_SELECT, matchId))
    .setPlaceholder('이번 대전에서 맡을 포지션')
    .addOptions([
      ...POSITIONS.map((value) => ({
        label: POSITION_LABELS[value],
        value,
        default: current === value,
      })),
      { label: '선택 해제', value: 'NONE' },
    ]);
  return {
    content: `🎯 이번 대전의 포지션을 골라 주세요. (현재: **${positionLabel(current)}**)`,
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

/* ───────────── 관리 패널 (관리자 / 대전 등록자, 본인만) ───────────── */

function controlPanel(view, notice = null) {
  const { match, participants, games } = view;
  const recruiting = match.status === MATCH_STATUS.RECRUITING;
  const inProgress = match.status === MATCH_STATUS.IN_PROGRESS;
  const lines = [
    `🛠️ **대전 #${match.id} 관리** · ${MATCH_STATUS_LABELS[match.status]}`,
    `참가자 ${participants.length}/${MATCH_SIZE}명 · 기록 ${games.length}/${match.game_count}판`,
  ];
  if (recruiting && participants.length < MATCH_SIZE) lines.push(`대전 시작은 ${MATCH_SIZE}명이 모두 모여야 할 수 있습니다.`);
  if (notice) lines.unshift(notice, '');

  const row = new ActionRowBuilder().addComponents(
    button(buildId(ACTIONS.START, match.id), '대전 시작', ButtonStyle.Success, '▶️').setDisabled(!recruiting),
    button(buildId(ACTIONS.RECORD, match.id), '대전 기록', ButtonStyle.Primary, '📸').setDisabled(
      !inProgress || games.length >= match.game_count,
    ),
    button(buildId(ACTIONS.FINISH, match.id), '대전 종료', ButtonStyle.Danger, '🏁').setDisabled(!inProgress),
    button(buildId(ACTIONS.CANCEL, match.id), '대전 취소', ButtonStyle.Secondary, '🛑').setDisabled(!recruiting && !inProgress),
  );
  const isActive = recruiting || inProgress;
  return { content: lines.join('\n'), embeds: [], components: isActive ? [row] : [] };
}

/** 판 기록 입력창: 결과 캡쳐 + 이긴 사람 5명 */
function recordModal(matchId, gameNo, participants) {
  return new ModalBuilder()
    .setCustomId(buildId(ACTIONS.RECORD_MODAL, matchId, gameNo))
    .setTitle(`${gameNo}판 결과 기록`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('경기 결과 캡쳐')
        .setDescription('경기 결과 화면을 캡쳐한 이미지 1장')
        .setFileUploadComponent(
          new FileUploadBuilder().setCustomId('screenshot').setMinValues(1).setMaxValues(1).setRequired(true),
        ),
      new LabelBuilder()
        .setLabel(`이긴 사람 ${TEAM_SIZE}명`)
        .setDescription(`이번 판에서 이긴 팀 ${TEAM_SIZE}명을 골라 주세요. (1명당 승점 1점)`)
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('winners')
            .setMinValues(TEAM_SIZE)
            .setMaxValues(TEAM_SIZE)
            .setPlaceholder(`승리자 ${TEAM_SIZE}명 선택`)
            .addOptions(
              participants.map((p) => ({
                label: (p.display_name || p.discord_user_id).slice(0, 100),
                description: (p.game_name || '롤 아이디 미입력').slice(0, 100),
                value: p.discord_user_id,
              })),
            ),
        ),
    );
}

/* ───────────── 대전 종료 알림 (모두에게 보임) ───────────── */

function finishMessage(view) {
  const { match, participants, games } = view;
  const wins = new Map(participants.map((p) => [p.discord_user_id, 0]));
  for (const g of games) for (const id of g.winnerDiscordUserIds) wins.set(id, (wins.get(id) || 0) + 1);

  const gameLines = games.length
    ? games.map((g) => `**${g.game_no}판** 🏆 ${g.winnerDiscordUserIds.map(mention).join(' ')}`).join('\n')
    : '기록된 판이 없습니다.';
  const pointLines = [...wins.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, n]) => `${mention(id)} **${n}점**`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🏁 대전 #${match.id} 종료`)
    .setColor(COLORS.GREEN)
    .setDescription(`총 ${match.game_count}판 중 **${games.length}판** 기록 · 판 1승당 승점 1점`)
    .addFields(
      { name: '판별 결과', value: gameLines.slice(0, 1024) },
      { name: '이번 대전 승점', value: (pointLines || '-').slice(0, 1024) },
    );

  const files = games
    .filter((g) => g.screenshot_path && fs.existsSync(g.screenshot_path))
    .slice(0, 10)
    .map((g) => new AttachmentBuilder(g.screenshot_path, { name: `game-${g.game_no}${path.extname(g.screenshot_path)}` }));

  return {
    content: `🏁 **대전 #${match.id}이(가) 종료되었습니다!** 결과를 확인하세요.`,
    embeds: [embed],
    files,
  };
}

module.exports = {
  panelMessage,
  gameCountSelect,
  gameNameModal,
  matchPublicMessage,
  matchDetailEmbed,
  matchMessageLink,
  positionSelect,
  controlPanel,
  recordModal,
  finishMessage,
};
