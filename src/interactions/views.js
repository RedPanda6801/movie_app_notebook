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
  SIDE_LABELS,
  TEAM_SIZE,
  UNDECIDED_LABEL,
} = require('../constants');
const { COLORS, mention, positionLabel } = require('../utils/format');
const { ACTIONS, buildId } = require('./ids');
const { buildStatTemplate } = require('../services/statInput');
const { aggregateByMember } = require('../services/recordService');

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

/* ───────────── /계정 관리 패널 (모두에게 보임) ───────────── */

function accountPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('👤 계정 관리')
    .setColor(COLORS.GREEN)
    .setDescription(
      [
        '내전에 참가하려면 먼저 이 서버에 계정을 등록해야 합니다.',
        '',
        '✅ **[계정 등록]** 롤 아이디와 함께 계정을 등록합니다. (계정당 아이디 1개)',
        '✏️ **[아이디 변경]** 등록한 롤 아이디를 바꿉니다.',
        '🎯 **[선호 포지션]** 대전 참가 때 기본으로 선택될 포지션을 정합니다.',
        '👋 **[계정 탈퇴]** 계정을 탈퇴합니다. (기록은 남고, 다시 등록하면 이어집니다)',
        '',
        '버튼을 누른 결과는 누른 사람에게만 보입니다.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    button(ACTIONS.PANEL_REGISTER, '계정 등록', ButtonStyle.Success, '✅'),
    button(ACTIONS.ACCOUNT_CHANGE_ID, '아이디 변경', ButtonStyle.Secondary, '✏️'),
    button(ACTIONS.ACCOUNT_POSITION, '선호 포지션', ButtonStyle.Secondary, '🎯'),
    button(ACTIONS.PANEL_WITHDRAW, '계정 탈퇴', ButtonStyle.Danger, '👋'),
  );
  return { embeds: [embed], components: [row] };
}

/** 계정 등록 / 아이디 변경 입력창: 롤 아이디 (계정당 1개) */
function accountGameNameModal(customId, title, defaultValue) {
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
        .setDescription('계정당 1개만 등록할 수 있고, 다른 사람이 등록한 아이디는 쓸 수 없습니다.')
        .setTextInputComponent(input),
    );
}

function positionOptions(current) {
  return [
    ...POSITIONS.map((value) => ({ label: POSITION_LABELS[value], value, default: current === value })),
    { label: UNDECIDED_LABEL, value: 'NONE', default: !current },
  ];
}

/** 선호 포지션 선택 메뉴 (본인만) */
function preferredPositionSelect(current) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(ACTIONS.ACCOUNT_POSITION_SELECT)
    .setPlaceholder('선호 포지션')
    .addOptions(positionOptions(current));
  return {
    content: `🎯 대전 참가 때 기본으로 선택될 포지션을 골라 주세요. (현재: **${positionLabel(current)}**)`,
    components: [new ActionRowBuilder().addComponents(select)],
  };
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
        '1️⃣ 처음이라면 계정관리 채널에서 **[계정 등록]**을 먼저 눌러 주세요.',
        '2️⃣ **[대전 등록]**으로 판 수를 정해 대전을 엽니다. (서버당 1개)',
        '3️⃣ 대전 정보 메시지의 **[대전 참가]**로 포지션을 골라 참가합니다. (롤 아이디는 계정에 등록된 아이디)',
        '',
        '버튼을 누른 결과는 누른 사람에게만 보입니다.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    button(ACTIONS.PANEL_CREATE, '대전 등록', ButtonStyle.Primary, '📝'),
    button(ACTIONS.PANEL_ACTIVE, '진행중인 대전 조회', ButtonStyle.Secondary, '🔎'),
  );
  return { embeds: [embed], components: [row] };
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
/**
 * 참가 입력창 (대전 등록 / 대전 참가 공용): 포지션 선택
 * 롤 아이디는 계정에 등록된 아이디를 쓰므로 입력하지 않는다.
 * @param {string|null} defaultPosition 선호 포지션 (null = 미정)
 */
function joinModal(customId, title, defaultPosition = null, gameName = null) {
  return new ModalBuilder()
    .setCustomId(customId)
    .setTitle(title)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('포지션')
        .setDescription(
          `${gameName ? `🎮 ${gameName} · ` : ''}기본값은 선호 포지션입니다. (참가 후에도 바꿀 수 있습니다)`.slice(0, 100),
        )
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('position')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(positionOptions(defaultPosition)),
        ),
    );
}

/** 피어리스: 이 대전에서 이미 사용해 다시 쓸 수 없는 챔피언 (판별) */
function usedChampionsField(view) {
  const used = view.usedChampions || [];
  if (used.length === 0) return null;
  const byGame = new Map();
  for (const u of used) {
    if (!byGame.has(u.gameNo)) byGame.set(u.gameNo, []);
    byGame.get(u.gameNo).push(u.champion);
  }
  const value = [...byGame.entries()]
    .map(([gameNo, champs]) => `**${gameNo}판** ${champs.join(', ')}`)
    .join('\n')
    .slice(0, 1024);
  return { name: `🚫 피어리스 - 사용한 챔피언 (${used.length}) · 이 대전에서 다시 쓸 수 없음`, value };
}

/** 피어리스: 판 순서대로 플레이한 챔피언 (예: 제라스 - 룰루) */
function championText(view, p) {
  const list = view.champions?.[p.guild_member_id];
  return list && list.length ? list.join(' - ') : null;
}

/* ───────────── 공개 대전 정보 메시지 ───────────── */

/** 1팀 / 2팀 / 미정으로 나눈 참가자 필드 */
function teamFields(view, { detail = false } = {}) {
  const groups = [
    { name: `🔴 ${SIDE_LABELS.RED}`, list: view.red, max: TEAM_SIZE },
    { name: `🔵 ${SIDE_LABELS.BLUE}`, list: view.blue, max: TEAM_SIZE },
    { name: `⚪ ${UNDECIDED_LABEL}`, list: view.unassigned, max: null },
  ];
  return groups
    .filter((g) => g.max !== null || g.list.length > 0)
    .map((g) => ({
      name: `${g.name} (${g.list.length}${g.max ? `/${g.max}` : ''})`,
      value: g.list.length
        ? g.list
            .map((p) => {
              const parts = [mention(p.discord_user_id)];
              if (!detail) {
                // 공개 대전 정보: 피어리스 - 이전 판에 한 챔피언
                const champions = championText(view, p);
                if (champions) parts.push(`(${champions})`);
              }
              if (detail) {
                parts.push(`\`${positionLabel(p.position)}\``);
                const champions = championText(view, p);
                const name = p.game_name || '아이디 미입력';
                // 피어리스: 아이디(1판 챔피언 - 2판 챔피언 ...)
                parts.push(champions ? `🎮 ${name}(${champions})` : `🎮 ${name}`);
              }
              if (p.is_team_locked) parts.push('📌');
              return parts.join(' · ');
            })
            .join('\n')
            .slice(0, 1024)
        : '-',
      inline: !detail,
    }));
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
  fields.push({ name: `참가자 (${participants.length}/${MATCH_SIZE})`, value: '팀별로 표시합니다. (📌 = 팀 직접 선택)' });
  fields.push(...teamFields(view));
  const used = usedChampionsField(view);
  if (used) fields.push(used);
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
    button(buildId(ACTIONS.TEAM, match.id), '팀 등록/변경', ButtonStyle.Secondary, '👥').setDisabled(!recruiting),
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
    )
    .setDescription(`참가자 **${participants.length}/${MATCH_SIZE}**명 · 포지션 · 롤 아이디(이전 판 챔피언) (📌 = 팀 직접 선택)`)
    .addFields(teamFields(view, { detail: true }));
  const used = usedChampionsField(view);
  if (used) embed.addFields(used);
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
      { label: UNDECIDED_LABEL, value: 'NONE', description: '포지션을 정하지 않음 (기본값)', default: !current },
    ]);
  return {
    content: `🎯 이번 대전의 포지션을 골라 주세요. (현재: **${positionLabel(current)}**)`,
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

/* ───────────── 관리 패널 (관리자 / 대전 등록자, 본인만) ───────────── */

/* ───────────── 팀 선택 (본인만) ───────────── */

/** @param {'RED'|'BLUE'|null} current 직접 고른 팀 (셔플로 배정된 팀은 미정으로 본다) */
function teamSelect(matchId, current) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildId(ACTIONS.TEAM_SELECT, matchId))
    .setPlaceholder('이번 대전에서 들어갈 팀')
    .addOptions([
      { label: SIDE_LABELS.RED, value: 'RED', description: `최대 ${TEAM_SIZE}명, 팀 셔플에서 제외`, default: current === 'RED' },
      { label: SIDE_LABELS.BLUE, value: 'BLUE', description: `최대 ${TEAM_SIZE}명, 팀 셔플에서 제외`, default: current === 'BLUE' },
      { label: UNDECIDED_LABEL, value: 'NONE', description: '팀 셔플로 정해짐 (기본값)', default: !current },
    ]);
  return {
    content: `👥 이번 대전의 팀을 골라 주세요. (현재: **${current ? SIDE_LABELS[current] : UNDECIDED_LABEL}**)`,
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

/** 1팀 / 2팀 구성 (팀 셔플 결과) */
function teamsEmbed(view, title) {
  return new EmbedBuilder()
    .setTitle(title || `👥 대전 #${view.match.id} 팀 구성`)
    .setColor(COLORS.BLUE)
    .setDescription('포지션 · 롤 아이디 (📌 = 팀 직접 선택, 셔플에서 제외)')
    .addFields(teamFields(view, { detail: true }));
}

function controlPanel(view, notice = null, embeds = []) {
  const { match, participants, games } = view;
  const recruiting = match.status === MATCH_STATUS.RECRUITING;
  const inProgress = match.status === MATCH_STATUS.IN_PROGRESS;
  const lines = [
    `🛠️ **대전 #${match.id} 관리** · ${MATCH_STATUS_LABELS[match.status]}`,
    `참가자 ${participants.length}/${MATCH_SIZE}명 · 기록 ${games.length}/${match.game_count}판`,
  ];
  if (recruiting && participants.length < MATCH_SIZE) {
    lines.push(`팀 랜덤 셔플은 2명 이상이면 할 수 있고, 대전 시작은 ${MATCH_SIZE}명이 모두 모여야 합니다.`);
  }
  if (notice) lines.unshift(notice, '');

  const row = new ActionRowBuilder().addComponents(
    // 팀 랜덤 셔플은 대전 시작 후(진행 중)에도 판 사이에 다시 할 수 있다.
    button(buildId(ACTIONS.SHUFFLE, match.id), '팀 랜덤 셔플', ButtonStyle.Secondary, '🎲').setDisabled(
      !(recruiting || inProgress) || participants.length < 2,
    ),
    button(buildId(ACTIONS.START, match.id), '대전 시작', ButtonStyle.Success, '▶️').setDisabled(!recruiting),
    button(buildId(ACTIONS.RECORD, match.id), '대전 기록', ButtonStyle.Primary, '📸').setDisabled(
      !inProgress || games.length >= match.game_count,
    ),
    button(buildId(ACTIONS.FINISH, match.id), '대전 종료', ButtonStyle.Danger, '🏁').setDisabled(!inProgress),
    button(buildId(ACTIONS.CANCEL, match.id), '대전 취소', ButtonStyle.Secondary, '🛑').setDisabled(!recruiting && !inProgress),
  );
  const isActive = recruiting || inProgress;
  return { content: lines.join('\n'), embeds, components: isActive ? [row] : [] };
}

/**
 * 판 기록 입력창: 결과 캡쳐 + 승리팀 + 팀별 K/D/A/CS
 * 팀별 입력칸에는 팀원 이름이 미리 채워진 양식이 들어가며, 숫자만 바꾸면 된다.
 */
function recordModal(matchId, gameNo, red, blue, signature = '', usedChampions = []) {
  const banned = usedChampions.map((u) => u.champion);
  const bannedText = banned.length ? `사용 불가: ${banned.join(', ')}` : '이전 판에 쓴 챔피언은 쓸 수 없음 (피어리스)';
  const statInput = (customId, members) =>
    new TextInputBuilder()
      .setCustomId(customId)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000)
      .setValue(buildStatTemplate(members));
  return new ModalBuilder()
    .setCustomId(buildId(ACTIONS.RECORD_MODAL, matchId, gameNo, signature))
    .setTitle(`${gameNo}판 결과 기록`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('경기 결과 캡쳐')
        .setDescription('경기 결과 화면을 캡쳐한 이미지 1장')
        .setFileUploadComponent(
          new FileUploadBuilder().setCustomId('screenshot').setMinValues(1).setMaxValues(1).setRequired(true),
        ),
      new LabelBuilder()
        .setLabel('승리팀')
        .setDescription(`이긴 팀 ${TEAM_SIZE}명에게 승점 1점씩`)
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('winnerSide')
            .setMinValues(1)
            .setMaxValues(1)
            .setPlaceholder('승리팀 선택')
            .addOptions([
              { label: `🔴 ${SIDE_LABELS.RED} 승리`, value: 'RED' },
              { label: `🔵 ${SIDE_LABELS.BLUE} 승리`, value: 'BLUE' },
            ]),
        ),
      new LabelBuilder()
        .setLabel(`🔴 ${SIDE_LABELS.RED} 챔피언 · 킬/데스/어시/CS`)
        .setDescription(`챔피언과 숫자를 바꿔 주세요. ${bannedText}`.slice(0, 100))
        .setTextInputComponent(statInput('statsRED', red)),
      new LabelBuilder()
        .setLabel(`🔵 ${SIDE_LABELS.BLUE} 챔피언 · 킬/데스/어시/CS`)
        .setDescription(`예) 1. 홍길동 : 제라스 5/2/10/180 · ${bannedText}`.slice(0, 100))
        .setTextInputComponent(statInput('statsBLUE', blue)),
    );
}

/** 전적 한 줄: K/D/A · CS (입력 안 된 이전 기록은 -) */
function statText(p) {
  if (p.kills == null) return 'K/D/A -';
  return `${p.kills}/${p.deaths}/${p.assists} · CS ${p.cs}`;
}

/* ───────────── 대전 종료 알림 (모두에게 보임) ───────────── */

function finishMessage(view) {
  const { match, games } = view;
  const rows = games.flatMap((g) => g.players);
  const members = aggregateByMember(rows).sort(
    (a, b) => b.summary.wins - a.summary.wins || b.summary.kills - a.summary.kills,
  );

  const gameLines = games.length
    ? games
        .map((g) => {
          const team = g.winnerSide ? `${g.winnerSide === 'RED' ? '🔴' : '🔵'} ${SIDE_LABELS[g.winnerSide]} 승리` : '승리';
          return `**${g.game_no}판** 🏆 ${team} · ${g.winnerDiscordUserIds.map(mention).join(' ')}`;
        })
        .join('\n')
    : '기록된 판이 없습니다.';
  const memberLines = members
    .map((m) => {
      const s = m.summary;
      const kda = s.statGames ? ` · ${s.kills}/${s.deaths}/${s.assists} (KDA ${s.kda.toFixed(2)}) · CS ${s.cs}` : '';
      const champions = m.champions.length ? ` · ${m.champions.join(' - ')}` : '';
      return `${mention(m.discord_user_id)} **${s.points}점** (${s.wins}승 ${s.losses}패)${kda}${champions}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle(`🏁 대전 #${match.id} 종료`)
    .setColor(COLORS.GREEN)
    .setDescription(`총 ${match.game_count}판 중 **${games.length}판** 기록 · 판 1승당 승점 1점`)
    .addFields(
      { name: '판별 결과', value: gameLines.slice(0, 1024) },
      { name: '이번 대전 전적 (승점 · 승패 · K/D/A · CS)', value: (memberLines || '-').slice(0, 1024) },
    )
    .setFooter({ text: '자세한 전적은 전적관리 채널의 [대전별 전적 조회]에서 볼 수 있습니다.' });

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
  accountPanelMessage,
  panelMessage,
  gameCountSelect,
  accountGameNameModal,
  preferredPositionSelect,
  joinModal,
  matchPublicMessage,
  matchDetailEmbed,
  matchMessageLink,
  positionSelect,
  teamSelect,
  teamsEmbed,
  controlPanel,
  recordModal,
  finishMessage,
  statText,
};
