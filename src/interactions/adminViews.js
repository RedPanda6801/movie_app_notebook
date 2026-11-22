const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  LabelBuilder,
  ModalBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} = require('discord.js');
const { MATCH_STATUS_LABELS, SIDE_LABELS } = require('../constants');
const { COLORS, mention, positionLabel } = require('../utils/format');
const { renderTable } = require('../utils/textTable');
const { buildStatTemplate } = require('../services/statInput');
const { ACTIONS, buildId } = require('./ids');

const MEMBER_STATUS_LABELS = { ACTIVE: '가입', WITHDRAWN: '탈퇴' };

function dateOnly(sqliteUtc) {
  const d = new Date(`${String(sqliteUtc).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/* ───────────── /관리자 계정정보 ───────────── */

/** 계정 정보 행 (표 · CSV 공용) */
function accountRows(accountList) {
  return accountList.map((a, i) => {
    const s = a.summary;
    return {
      no: i + 1,
      name: a.display_name || a.username || a.discord_user_id,
      gameName: a.game_name || '-',
      position: positionLabel(a.preferred_position),
      status: MEMBER_STATUS_LABELS[a.status] || a.status,
      games: s.games,
      wins: s.wins,
      losses: s.losses,
      winRate: `${s.winRate}%`,
      kda: s.kda == null ? '-' : s.kda.toFixed(2),
      points: s.points,
      registered: dateOnly(a.registered_at),
      discordUserId: a.discord_user_id,
      username: a.username || '',
    };
  });
}

const TABLE_COLUMNS = [
  { key: 'no', title: '#', align: 'right' },
  { key: 'name', title: '이름', max: 12 },
  { key: 'gameName', title: '롤 아이디', max: 20 },
  { key: 'position', title: '선호' },
  { key: 'status', title: '상태' },
  { key: 'games', title: '판', align: 'right' },
  { key: 'wins', title: '승', align: 'right' },
  { key: 'losses', title: '패', align: 'right' },
  { key: 'kda', title: 'KDA', align: 'right' },
  { key: 'points', title: '승점', align: 'right' },
  { key: 'registered', title: '등록일' },
];

function accountsCsv(rows) {
  const header = ['번호', '이름', '디스코드 사용자명', '디스코드ID', '롤아이디', '선호포지션', '상태', '판', '승', '패', '승률', 'KDA', '승점', '등록일'];
  const lines = rows.map((r) =>
    [r.no, r.name, r.username, r.discordUserId, r.gameName, r.position, r.status, r.games, r.wins, r.losses, r.winRate, r.kda, r.points, r.registered]
      .map(csvCell)
      .join(','),
  );
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
}

/**
 * 모든 계정 정보를 행렬 표로 보여준다. 표가 메시지 길이 제한을 넘으면 앞부분만 보여주고,
 * 전체는 CSV 파일로 첨부한다.
 */
function accountTableMessage(accountList) {
  if (accountList.length === 0) return { content: '📭 이 서버에 등록된 계정이 없습니다.' };
  const rows = accountRows(accountList);
  const LIMIT = 3900; // 임베드 설명 4096자 - 코드 블록 여유
  let shown = rows.length;
  let table = renderTable(TABLE_COLUMNS, rows);
  while (table.length > LIMIT && shown > 1) {
    shown -= 1;
    table = renderTable(TABLE_COLUMNS, rows.slice(0, shown));
  }
  const active = accountList.filter((a) => a.status === 'ACTIVE').length;
  const embed = new EmbedBuilder()
    .setTitle('👤 계정 정보')
    .setColor(COLORS.GREEN)
    .setDescription(`\`\`\`\n${table}\n\`\`\``)
    .setFooter({
      text:
        `계정 ${rows.length}개 (가입 ${active} · 탈퇴 ${rows.length - active}) · 전적은 종료된 대전 기준` +
        (shown < rows.length ? ` · 표에는 ${shown}개만 보입니다. 전체는 CSV를 확인하세요.` : ''),
    });
  const file = new AttachmentBuilder(Buffer.from(accountsCsv(rows), 'utf8'), { name: 'accounts.csv' });
  return { embeds: [embed], files: [file] };
}

/* ───────────── /관리자 데이터적재 ───────────── */

function playerLine(p, winnerSide) {
  const champion = p.champion ? `**${p.champion}**` : '챔피언 -';
  const kda = p.kills == null ? 'K/D/A -' : `${p.kills}/${p.deaths}/${p.assists} · CS ${p.cs}`;
  const result = winnerSide ? (p.side === winnerSide ? ' · 승' : ' · 패') : '';
  return `${mention(p.discord_user_id)} ${champion} ${kda}${result}`;
}

function rosterFields(roster) {
  return ['RED', 'BLUE'].map((side) => ({
    name: `${side === 'RED' ? '🔴' : '🔵'} ${SIDE_LABELS[side]}${roster.winnerSide ? (roster.winnerSide === side ? ' 🏆' : '') : ''}`,
    value:
      roster[side === 'RED' ? 'red' : 'blue']
        .map((p) => playerLine({ ...p, side }, roster.winnerSide))
        .join('\n')
        .slice(0, 1024) || '-',
  }));
}

/** 적재 전 미리보기: 찾은 대전/판 + 올린 이미지 + 지금 기록 + [전적 입력] 버튼 */
function loadPreviewMessage(roster, pendingPath, token) {
  const { match, gameNo, record } = roster;
  const name = `upload${path.extname(pendingPath)}`;
  const embed = new EmbedBuilder()
    .setTitle(`🛠️ 데이터 적재 · 대전 #${match.id} ${gameNo}판`)
    .setColor(COLORS.BLUE)
    .setDescription(
      [
        `상태: **${MATCH_STATUS_LABELS[match.status]}** · ${match.game_count}판 중 ${gameNo}판 · ${record ? '기존 기록을 **덮어씁니다**' : '**새 기록**을 만듭니다'}`,
        '',
        '아래 이미지를 보고 **[전적 입력]**을 눌러 승리팀과 챔피언 · K/D/A · CS를 입력해 주세요.',
        '저장하면 이 판의 기록과 승점이 갱신되고, 이미지는 이 판의 결과 캡쳐로 저장됩니다.',
      ].join('\n'),
    )
    .addFields(rosterFields(roster))
    .setImage(`attachment://${name}`);
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(buildId(ACTIONS.ADMIN_LOAD_OPEN, match.id, gameNo, token))
      .setLabel('전적 입력')
      .setEmoji('📝')
      .setStyle(ButtonStyle.Primary),
  );
  return {
    embeds: [embed],
    components: [row],
    files: fs.existsSync(pendingPath) ? [new AttachmentBuilder(pendingPath, { name })] : [],
  };
}

/** 적재 입력창: 승리팀 + 팀별 챔피언 · K/D/A · CS (기존 값으로 미리 채움) */
function loadModal(roster, token) {
  const { match, gameNo } = roster;
  const banned = roster.usedChampions.map((u) => u.champion);
  const bannedText = banned.length ? `사용 불가: ${banned.join(', ')}` : '다른 판에 쓴 챔피언은 쓸 수 없음 (피어리스)';
  const statInput = (customId, members) =>
    new TextInputBuilder()
      .setCustomId(customId)
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true)
      .setMaxLength(1000)
      .setValue(buildStatTemplate(members));
  return new ModalBuilder()
    .setCustomId(buildId(ACTIONS.ADMIN_LOAD_MODAL, match.id, gameNo, token, roster.signature))
    .setTitle(`대전 #${match.id} ${gameNo}판 데이터 적재`)
    .addLabelComponents(
      new LabelBuilder()
        .setLabel('승리팀')
        .setStringSelectMenuComponent(
          new StringSelectMenuBuilder()
            .setCustomId('winnerSide')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions([
              { label: `🔴 ${SIDE_LABELS.RED} 승리`, value: 'RED', default: roster.winnerSide === 'RED' },
              { label: `🔵 ${SIDE_LABELS.BLUE} 승리`, value: 'BLUE', default: roster.winnerSide === 'BLUE' },
            ]),
        ),
      new LabelBuilder()
        .setLabel(`🔴 ${SIDE_LABELS.RED} 챔피언 · 킬/데스/어시/CS`)
        .setDescription(`예) 1. 홍길동 : 제라스 5/2/10/180 · ${bannedText}`.slice(0, 100))
        .setTextInputComponent(statInput('statsRED', roster.red)),
      new LabelBuilder()
        .setLabel(`🔵 ${SIDE_LABELS.BLUE} 챔피언 · 킬/데스/어시/CS`)
        .setDescription(`챔피언과 숫자를 바꿔 주세요. ${bannedText}`.slice(0, 100))
        .setTextInputComponent(statInput('statsBLUE', roster.blue)),
    );
}

/** 적재 결과: 저장된 판 + 10명의 갱신된 승점 */
function loadResultMessage(result, winnerSide, pointsByUser) {
  const { match, gameNo, created, players } = result;
  const fields = ['RED', 'BLUE'].map((side) => ({
    name: `${side === 'RED' ? '🔴' : '🔵'} ${SIDE_LABELS[side]}${winnerSide === side ? ' 🏆 승' : ' 패'}`,
    value: players
      .filter((p) => p.side === side)
      .map((p) => `${playerLine(p, null)} · 승점 **${pointsByUser.get(p.discord_user_id) ?? '-'}**`)
      .join('\n')
      .slice(0, 1024),
  }));
  const embed = new EmbedBuilder()
    .setTitle(`✅ 대전 #${match.id} ${gameNo}판 데이터 적재 완료`)
    .setColor(COLORS.GREEN)
    .setDescription(
      `${created ? '새 기록을 만들었습니다.' : '기존 기록을 갱신했습니다.'} 승점은 종료된 대전 기준 누적 값입니다.`,
    )
    .addFields(fields);
  return { content: '', embeds: [embed], components: [], files: [], attachments: [] };
}

module.exports = { accountTableMessage, accountsCsv, accountRows, loadPreviewMessage, loadModal, loadResultMessage };
