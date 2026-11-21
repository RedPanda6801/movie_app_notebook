const fs = require('node:fs');
const path = require('node:path');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  UserSelectMenuBuilder,
} = require('discord.js');
const { MATCH_STATUS_LABELS, SIDE_LABELS, UNDECIDED_LABEL } = require('../constants');
const { COLORS, mention, positionLabel } = require('../utils/format');
const { ACTIONS, buildId } = require('./ids');

/* ───────────── 공통 표시 ───────────── */

const SIDE_ICON = { RED: '🔴', BLUE: '🔵' };

function sideText(side) {
  return side ? `${SIDE_ICON[side]} ${SIDE_LABELS[side]}` : `⚪ ${UNDECIDED_LABEL}`;
}

function kdaText(p) {
  const champion = p.champion ? `**${p.champion}** ` : '';
  if (p.kills == null) return `${champion}K/D/A -`;
  const kda = (p.kills + p.assists) / Math.max(1, p.deaths);
  return `${champion}${p.kills}/${p.deaths}/${p.assists} (${kda.toFixed(2)}) · CS ${p.cs}`;
}

/** 전적 요약 한 줄: 2승 1패 (67%) · 평균 5.0/2.3/8.1 (KDA 5.70) · 평균 CS 180 */
function summaryText(s) {
  const base = `${s.wins}승 ${s.losses}패 (${s.winRate}%)`;
  if (!s.statGames) return base;
  const f = (n) => n.toFixed(1);
  return `${base} · 평균 ${f(s.avgKills)}/${f(s.avgDeaths)}/${f(s.avgAssists)} (KDA ${s.kda.toFixed(2)}) · 평균 CS ${Math.round(s.avgCs)}`;
}

function dateText(sqliteUtc) {
  // SQLite datetime('now')는 UTC 'YYYY-MM-DD HH:MM:SS'
  const d = new Date(`${String(sqliteUtc).replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return String(sqliteUtc ?? '');
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/* ───────────── /전적 관리 패널 (모두에게 보임) ───────────── */

function statsPanelMessage() {
  const embed = new EmbedBuilder()
    .setTitle('📊 전적 관리')
    .setColor(COLORS.GREEN)
    .setDescription(
      [
        '대전에서 기록된 판별 전적(팀 · 킬/데스/어시 · CS · 승패)을 조회합니다.',
        '',
        '⚔️ **[대전별 전적 조회]** 대전을 골라 참가자별 · 판별 전적을 봅니다.',
        '👤 **[개인별 전적 조회]** 계정을 골라 그 계정의 전적을 봅니다.',
        '🌐 **[전체 전적 조회]** 모든 계정의 전적 요약과 판별 전적 파일(CSV)을 받습니다.',
        '',
        '조회 결과는 누른 사람에게만 보입니다. 개인별/전체 전적은 종료된 대전만 포함합니다.',
      ].join('\n'),
    );
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(ACTIONS.STATS_BY_MATCH).setLabel('대전별 전적 조회').setEmoji('⚔️').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(ACTIONS.STATS_BY_MEMBER).setLabel('개인별 전적 조회').setEmoji('👤').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(ACTIONS.STATS_ALL).setLabel('전체 전적 조회').setEmoji('🌐').setStyle(ButtonStyle.Secondary),
  );
  return { embeds: [embed], components: [row] };
}

/* ───────────── 대전별 전적 ───────────── */

function matchListSelect(matchList) {
  if (matchList.length === 0) {
    return { content: '📭 아직 전적을 볼 수 있는 대전이 없습니다. (진행 중이거나 종료된 대전만 조회할 수 있습니다)' };
  }
  const select = new StringSelectMenuBuilder()
    .setCustomId(ACTIONS.STATS_MATCH_SELECT)
    .setPlaceholder('전적을 볼 대전을 고르세요')
    .addOptions(
      matchList.map((m) => ({
        label: `대전 #${m.id} · ${dateText(m.created_at).slice(0, 10)}`,
        description: `${MATCH_STATUS_LABELS[m.status]} · ${m.record_count}/${m.game_count}판 기록`,
        value: String(m.id),
      })),
    );
  return {
    content: '⚔️ **대전별 전적 조회** - 대전을 골라 주세요. (최근 25개)',
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

/** 대전 안의 판 선택 메뉴 (요약 / 1판 / 2판 ...) */
function gameSelectRow(data, selected) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(buildId(ACTIONS.STATS_GAME_SELECT, data.match.id))
    .setPlaceholder('판별 상세 보기')
    .addOptions([
      { label: '참가자별 합계', value: 'SUMMARY', default: selected == null },
      ...data.games.slice(0, 24).map((g) => ({
        label: `${g.game_no}판`,
        description: g.winnerSide ? `${SIDE_LABELS[g.winnerSide]} 승리` : '기록',
        value: String(g.game_no),
        default: selected === g.game_no,
      })),
    ]);
  return new ActionRowBuilder().addComponents(select);
}

/**
 * 대전별 전적 화면
 * @param {number|null} gameNo null이면 참가자별 합계, 숫자면 그 판의 상세(캡쳐 포함)
 */
function matchStatsMessage(data, gameNo = null) {
  const { match, games, members } = data;
  const header = `${MATCH_STATUS_LABELS[match.status]} · ${games.length}/${match.game_count}판 기록 · ${dateText(match.created_at)}`;

  if (games.length === 0) {
    return { content: `⚔️ **대전 #${match.id}** - 아직 기록된 판이 없습니다.`, embeds: [], components: [], files: [] };
  }

  if (gameNo == null) {
    const lines = [...members]
      .sort((a, b) => (a.side || 'Z').localeCompare(b.side || 'Z') || b.summary.wins - a.summary.wins)
      .map((m) => {
        const s = m.summary;
        const total = s.statGames ? ` · 합계 ${s.kills}/${s.deaths}/${s.assists} · CS ${s.cs}` : '';
        // 피어리스: 아이디(1판 챔피언 - 2판 챔피언 ...)
        const name = m.game_name || '아이디 미입력';
        const who = m.champions.length ? `${name}(${m.champions.join(' - ')})` : name;
        return `${mention(m.discord_user_id)} 🎮 ${who}\n　${summaryText(s)}${total}`;
      });
    const embed = new EmbedBuilder()
      .setTitle(`⚔️ 대전 #${match.id} 참가자별 전적`)
      .setColor(COLORS.BLUE)
      .setDescription(`${header}\n\n${lines.join('\n')}`.slice(0, 4096))
      .setFooter({ text: '아래 메뉴에서 판을 고르면 판별 상세와 결과 캡쳐를 볼 수 있습니다.' });
    return { content: '', embeds: [embed], components: [gameSelectRow(data, null)], files: [] };
  }

  const game = games.find((g) => g.game_no === Number(gameNo));
  if (!game) return matchStatsMessage(data, null);
  const teamField = (side) => {
    const list = game.players.filter((p) => p.side === side);
    const result = game.winnerSide ? (game.winnerSide === side ? '🏆 승' : '패') : '';
    return {
      name: `${sideText(side)} ${result}`,
      value:
        list
          .map((p) => `${mention(p.discord_user_id)} · \`${positionLabel(p.position)}\` · ${kdaText(p)}`)
          .join('\n')
          .slice(0, 1024) || '-',
    };
  };
  const embed = new EmbedBuilder()
    .setTitle(`⚔️ 대전 #${match.id} · ${game.game_no}판`)
    .setColor(game.winnerSide === 'BLUE' ? COLORS.BLUE : COLORS.RED)
    .setDescription(`${dateText(game.played_at)} 기록 · 킬/데스/어시 (KDA) · CS`)
    .addFields(teamField('RED'), teamField('BLUE'));
  const players = game.players.filter((p) => !p.side);
  if (players.length) {
    embed.addFields({ name: `⚪ ${UNDECIDED_LABEL}`, value: players.map((p) => `${mention(p.discord_user_id)} · ${kdaText(p)}`).join('\n') });
  }
  const files = [];
  if (game.screenshot_path && fs.existsSync(game.screenshot_path)) {
    const name = `game-${game.game_no}${path.extname(game.screenshot_path)}`;
    files.push(new AttachmentBuilder(game.screenshot_path, { name }));
    embed.setImage(`attachment://${name}`);
  }
  return { content: '', embeds: [embed], components: [gameSelectRow(data, game.game_no)], files };
}

/* ───────────── 개인별 전적 ───────────── */

function memberSelect() {
  const select = new UserSelectMenuBuilder()
    .setCustomId(ACTIONS.STATS_MEMBER_SELECT)
    .setPlaceholder('전적을 볼 계정 (이름을 입력해 검색)')
    .setMinValues(1)
    .setMaxValues(1);
  return {
    content: '👤 **개인별 전적 조회** - 계정을 골라 주세요.',
    components: [new ActionRowBuilder().addComponents(select)],
  };
}

function memberStatsMessage(data) {
  const { member, summary: s, recent } = data;
  const embed = new EmbedBuilder()
    .setTitle('👤 개인별 전적')
    .setColor(COLORS.GREEN)
    .setDescription(
      [
        `${mention(member.discord_user_id)}${member.status === 'WITHDRAWN' ? ' (탈퇴)' : ''}${member.last_game_name ? ` · 🎮 ${member.last_game_name}` : ''}`,
        '',
        `**${s.games}판 ${summaryText(s)}**`,
        `승점 **${s.points}점**`,
        s.statGames ? `합계 ${s.kills}/${s.deaths}/${s.assists} · CS ${s.cs} (K/D/A 기록 ${s.statGames}판)` : 'K/D/A 기록이 없습니다.',
      ].join('\n'),
    );
  embed.addFields({
    name: `최근 ${recent.length}판`,
    value:
      recent
        .map(
          (p) =>
            `대전 #${p.match_id} ${p.game_no}판 · ${sideText(p.side)} · ${p.is_win ? '**승**' : '패'} · \`${positionLabel(p.position)}\` · ${kdaText(p)}`,
        )
        .join('\n')
        .slice(0, 1024) || '종료된 대전의 기록이 없습니다.',
  });
  return { content: '', embeds: [embed], components: [] };
}

/* ───────────── 전체 전적 ───────────── */

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** 모든 계정의 판별 전적 CSV (엑셀에서 한글이 깨지지 않도록 BOM 포함) */
function buildRecordsCsv(rows) {
  const header = ['대전', '판', '기록일시', '디스코드ID', '이름', '롤아이디', '팀', '포지션', '챔피언', '킬', '데스', '어시', 'CS', '승패'];
  const lines = rows.map((r) =>
    [
      r.match_id,
      r.game_no,
      dateText(r.played_at),
      r.discord_user_id,
      r.display_name,
      r.game_name,
      r.side ? SIDE_LABELS[r.side] : UNDECIDED_LABEL,
      r.position ? positionLabel(r.position) : UNDECIDED_LABEL,
      r.champion,
      r.kills,
      r.deaths,
      r.assists,
      r.cs,
      r.is_win ? '승' : '패',
    ]
      .map(csvCell)
      .join(','),
  );
  return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`;
}

function guildStatsMessage(data) {
  const { members, rows } = data;
  if (rows.length === 0) {
    return { content: '📭 아직 종료된 대전의 전적이 없습니다.', embeds: [], files: [] };
  }
  const lines = members.map((m, i) => {
    const s = m.summary;
    const withdrawn = m.member_status === 'WITHDRAWN' ? ' (탈퇴)' : '';
    return `**${i + 1}.** ${mention(m.discord_user_id)}${withdrawn} · ${s.games}판 ${summaryText(s)}`;
  });
  let description = '';
  let shown = 0;
  for (const line of lines) {
    if (description.length + line.length + 1 > 3800) break;
    description += `${line}\n`;
    shown += 1;
  }
  if (shown < lines.length) description += `\n…외 ${lines.length - shown}명은 첨부 파일에서 확인하세요.`;

  const embed = new EmbedBuilder()
    .setTitle('🌐 전체 전적')
    .setColor(COLORS.GREEN)
    .setDescription(description)
    .setFooter({ text: `계정 ${members.length}명 · 판별 기록 ${rows.length}건 · 모든 판별 전적은 첨부된 CSV 파일에 있습니다.` });
  const file = new AttachmentBuilder(Buffer.from(buildRecordsCsv(rows), 'utf8'), { name: 'records.csv' });
  return { content: '', embeds: [embed], files: [file] };
}

module.exports = {
  statsPanelMessage,
  matchListSelect,
  matchStatsMessage,
  memberSelect,
  memberStatsMessage,
  guildStatsMessage,
  buildRecordsCsv,
};
