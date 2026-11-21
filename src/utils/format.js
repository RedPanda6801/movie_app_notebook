const { EmbedBuilder } = require('discord.js');
const {
  MATCH_SIZE,
  POSITIONS,
  POSITION_LABELS,
  SIDE_LABELS,
  UNDECIDED_LABEL,
  MATCH_STATUS_LABELS,
} = require('../constants');

const COLORS = { RED: 0xe74c3c, BLUE: 0x3498db, NEUTRAL: 0x95a5a6, GREEN: 0x2ecc71 };

function mention(discordUserId) {
  return `<@${discordUserId}>`;
}

function positionLabel(position) {
  return position ? POSITION_LABELS[position] : UNDECIDED_LABEL;
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
  const { match, participants, red, blue, unassigned, games = [] } = view;
  const embed = new EmbedBuilder()
    .setTitle(title || `대전 #${match.id}`)
    .setColor(COLORS.NEUTRAL)
    .setDescription(
      `상태: **${MATCH_STATUS_LABELS[match.status]}** · 참가자 **${participants.length}/${MATCH_SIZE}**명 · 기록 **${games.length}/${match.game_count}**판`,
    )
    .addFields(
      { name: `🔴 ${SIDE_LABELS.RED} (${red.length})`, value: formatMembers(red), inline: true },
      { name: `🔵 ${SIDE_LABELS.BLUE} (${blue.length})`, value: formatMembers(blue), inline: true },
    );
  if (unassigned.length > 0) {
    embed.addFields({ name: `⚪ 팀 ${UNDECIDED_LABEL} (${unassigned.length})`, value: formatMembers(unassigned) });
  }
  if (games.length > 0) {
    embed.addFields({
      name: '🏆 판별 결과',
      value: games
        .map((g) => `**${g.game_no}판** ${g.winnerDiscordUserIds.map(mention).join(' ')}`)
        .join('\n')
        .slice(0, 1024),
    });
  }
  embed.setFooter({ text: '📌 = 팀 직접 등록 (셔플 제외)' });
  return embed;
}

/** 대전 참가자 목록 Embed (참가 순서대로 번호, 포지션, 팀 표시) */
function participantsEmbed(view, title) {
  const { match, participants } = view;
  const lines = participants.map((p, i) => {
    const team = p.side ? `${p.side === 'RED' ? '🔴' : '🔵'} ${SIDE_LABELS[p.side]}${p.is_team_locked ? ' 📌' : ''}` : `⚪ 팀 ${UNDECIDED_LABEL}`;
    const gameName = p.game_name ? ` · 🎮 ${p.game_name}` : '';
    return `**${i + 1}.** ${mention(p.discord_user_id)} · \`${positionLabel(p.position)}\` · ${team}${gameName}`;
  });
  return new EmbedBuilder()
    .setTitle(title || `대전 #${match.id} 참가자 (${participants.length}/${MATCH_SIZE})`)
    .setColor(COLORS.NEUTRAL)
    .setDescription(lines.length ? lines.join('\n') : '아직 참가자가 없습니다.')
    .setFooter({ text: `상태: ${MATCH_STATUS_LABELS[match.status]} · 📌 = 팀 직접 등록 (셔플 제외)` });
}

module.exports = { COLORS, mention, positionLabel, matchEmbed, participantsEmbed };
