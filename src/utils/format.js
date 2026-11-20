const { EmbedBuilder } = require('discord.js');
const {
  MATCH_SIZE,
  POSITIONS,
  POSITION_LABELS,
  SIDE_LABELS,
  MATCH_STATUS_LABELS,
} = require('../constants');

const COLORS = { RED: 0xe74c3c, BLUE: 0x3498db, NEUTRAL: 0x95a5a6, GREEN: 0x2ecc71 };

function mention(discordUserId) {
  return `<@${discordUserId}>`;
}

function positionLabel(position) {
  return position ? POSITION_LABELS[position] : '포지션 미정';
}

/** 포지션 순서(탑-정글-미드-원딜-서폿)로 정렬해서 한 줄씩 표시 */
function formatMembers(members, { showLock = true } = {}) {
  if (members.length === 0) return '-';
  const order = (p) => (p.position ? POSITIONS.indexOf(p.position) : POSITIONS.length);
  return [...members]
    .sort((a, b) => order(a) - order(b))
    .map((p) => {
      const lock = showLock && p.is_team_locked ? ' 📌' : '';
      return `\`${positionLabel(p.position)}\` ${mention(p.discord_user_id)}${lock}`;
    })
    .join('\n');
}

/** 대전 현황 Embed */
function matchEmbed(view, title) {
  const { match, participants, red, blue, unassigned, record } = view;
  const embed = new EmbedBuilder()
    .setTitle(title || `대전 #${match.id}`)
    .setColor(record ? COLORS[record.winner_side] : COLORS.NEUTRAL)
    .setDescription(
      `상태: **${MATCH_STATUS_LABELS[match.status]}** · 참가자 **${participants.length}/${MATCH_SIZE}**명`,
    )
    .addFields(
      { name: `🔴 ${SIDE_LABELS.RED} (${red.length})`, value: formatMembers(red), inline: true },
      { name: `🔵 ${SIDE_LABELS.BLUE} (${blue.length})`, value: formatMembers(blue), inline: true },
    );
  if (unassigned.length > 0) {
    embed.addFields({ name: `⚪ 팀 미배정 (${unassigned.length})`, value: formatMembers(unassigned) });
  }
  if (record) {
    embed.addFields({ name: '🏆 결과', value: `**${SIDE_LABELS[record.winner_side]} 승리**` });
  }
  embed.setFooter({ text: '📌 = 팀 직접 등록 (셔플 제외)' });
  return embed;
}

/** 대전 참가자 목록 Embed (참가 순서대로 번호, 포지션, 팀 표시) */
function participantsEmbed(view, title) {
  const { match, participants } = view;
  const lines = participants.map((p, i) => {
    const team = p.side ? `${p.side === 'RED' ? '🔴' : '🔵'} ${SIDE_LABELS[p.side]}${p.is_team_locked ? ' 📌' : ''}` : '⚪ 팀 미배정';
    return `**${i + 1}.** ${mention(p.discord_user_id)} · \`${positionLabel(p.position)}\` · ${team}`;
  });
  return new EmbedBuilder()
    .setTitle(title || `대전 #${match.id} 참가자 (${participants.length}/${MATCH_SIZE})`)
    .setColor(COLORS.NEUTRAL)
    .setDescription(lines.length ? lines.join('\n') : '아직 참가자가 없습니다.')
    .setFooter({ text: `상태: ${MATCH_STATUS_LABELS[match.status]} · 📌 = 팀 직접 등록 (셔플 제외)` });
}

module.exports = { COLORS, mention, positionLabel, matchEmbed, participantsEmbed };
