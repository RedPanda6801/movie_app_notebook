const { MATCH_SIZE, POSITIONS } = require('../constants');
const { UserError } = require('../utils/errors');
const { positionLabel } = require('../utils/format');
const { saveScreenshot, removeScreenshot } = require('../utils/screenshotStore');
const { ACTIONS, buildId, parseId } = require('./ids');
const views = require('./views');
const { postMatchMessage, refreshMatchMessage, postFinishMessage } = require('./matchMessage');

/**
 * 버튼 / 선택 메뉴 / 입력창(모달) 처리.
 * 모든 응답은 기본적으로 누른 사람에게만 보인다(ephemeral).
 * 모두에게 보이는 메시지는 공개 대전 정보 메시지와 대전 종료 알림뿐이다.
 *
 * ctx: { services, guild, isAdmin, client, config }
 */

async function resolveChannel(interaction) {
  return interaction.channel ?? interaction.client.channels.fetch(interaction.channelId);
}

/** 대전 정보 메시지가 있는 채널 (없으면 지금 채널) */
async function resolveMatchChannel(interaction, match) {
  if (match.message_channel_id) {
    try {
      return await interaction.client.channels.fetch(match.message_channel_id);
    } catch {
      /* 지금 채널로 대체 */
    }
  }
  return resolveChannel(interaction);
}

function base(interaction, ctx, matchId = null) {
  return {
    guildId: ctx.guild.id,
    discordUserId: interaction.user.id,
    matchId: matchId == null ? null : Number(matchId),
    isAdmin: ctx.isAdmin,
  };
}

const handlers = {
  /* ───────────── /계정 관리 패널 ───────────── */

  async [ACTIONS.PANEL_REGISTER](interaction, ctx) {
    const { reactivated } = ctx.services.accounts.register({
      guildId: ctx.guild.id,
      discordUserId: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.member?.displayName ?? interaction.user.globalName ?? null,
    });
    return interaction.reply(
      reactivated
        ? '✅ 계정이 다시 등록되었습니다. 이전 승점 기록이 그대로 이어집니다.'
        : '✅ 계정이 등록되었습니다. 이제 대전에 참가할 수 있습니다.',
    );
  },

  async [ACTIONS.PANEL_WITHDRAW](interaction, ctx) {
    const { leftMatchId } = ctx.services.accounts.withdraw({
      guildId: ctx.guild.id,
      discordUserId: interaction.user.id,
    });
    if (leftMatchId) await refreshMatchMessage(ctx.client, ctx.services, leftMatchId);
    return interaction.reply(
      `👋 계정을 탈퇴했습니다.${leftMatchId ? ` 참가 중이던 대전 #${leftMatchId}에서도 빠졌습니다.` : ''}`,
    );
  },

  /* ───────────── /대전 관리 패널 ───────────── */

  async [ACTIONS.PANEL_CREATE](interaction, ctx) {
    ctx.services.matches.checkCanCreate(base(interaction, ctx));
    return interaction.reply(views.gameCountSelect());
  },

  async [ACTIONS.PANEL_ACTIVE](interaction, ctx) {
    const match = ctx.services.matches.requireActiveMatch(ctx.guild.id);
    const view = ctx.services.matches.getMatchView(match.id);
    const link = views.matchMessageLink(interaction.guildId, match);
    return interaction.reply({
      ...(link ? { content: `대전 정보 메시지로 이동: ${link}` } : {}),
      embeds: [views.matchDetailEmbed(view)],
      components: views.matchPublicMessage(view).components,
    });
  },

  /* ───────────── 대전 등록: 판 수 선택 → 롤 아이디 입력 ───────────── */

  async [ACTIONS.CREATE_GAMES](interaction, ctx) {
    const gameCount = Number(interaction.values[0]);
    const member = ctx.services.matches.checkCanCreate(base(interaction, ctx));
    return interaction.showModal(
      views.gameNameModal(
        buildId(ACTIONS.CREATE_MODAL, gameCount),
        `대전 등록 (${gameCount}판) - 롤 아이디`,
        member.last_game_name,
      ),
    );
  },

  async [ACTIONS.CREATE_MODAL](interaction, ctx, [gameCount]) {
    const match = ctx.services.matches.createMatch({
      ...base(interaction, ctx),
      channelId: interaction.channelId,
      gameCount: Number(gameCount),
      gameName: interaction.fields.getTextInputValue('gameName'),
    });

    let notice = `✅ **대전 #${match.id}**(${match.game_count}판)이 등록되었고, 자동으로 참가했습니다.`;
    try {
      await postMatchMessage(await resolveChannel(interaction), ctx.services, match.id);
    } catch (err) {
      console.error('대전 정보 메시지 전송 실패:', err.message);
      notice += '\n⚠️ 채널에 대전 정보 메시지를 올리지 못했습니다. 봇에게 이 채널의 메시지 보내기 권한이 있는지 확인해 주세요.';
    }
    return interaction.reply(views.controlPanel(ctx.services.matches.getMatchView(match.id), notice));
  },

  /* ───────────── 공개 대전 정보 메시지 버튼 ───────────── */

  async [ACTIONS.JOIN](interaction, ctx, [matchId]) {
    const { member, match } = ctx.services.matches.checkCanJoin(base(interaction, ctx, matchId));
    return interaction.showModal(
      views.gameNameModal(buildId(ACTIONS.JOIN_MODAL, match.id), `대전 #${match.id} 참가`, member.last_game_name),
    );
  },

  async [ACTIONS.JOIN_MODAL](interaction, ctx, [matchId]) {
    const gameName = interaction.fields.getTextInputValue('gameName');
    const { match, count } = ctx.services.matches.join({ ...base(interaction, ctx, matchId), gameName });
    await refreshMatchMessage(ctx.client, ctx.services, match.id);
    const lines = [`🙋 대전 #${match.id}에 참가했습니다. (${count}/${MATCH_SIZE})`];
    if (count === MATCH_SIZE) lines.push('🎉 10명이 모두 모였습니다! 관리자가 대전을 시작하면 진행됩니다.');
    lines.push('포지션은 대전 정보 메시지의 [포지션 등록/변경] 버튼으로 정할 수 있습니다.');
    return interaction.reply(lines.join('\n'));
  },

  async [ACTIONS.LEAVE](interaction, ctx, [matchId]) {
    const { match, count } = ctx.services.matches.leave(base(interaction, ctx, matchId));
    await refreshMatchMessage(ctx.client, ctx.services, match.id);
    return interaction.reply(`🚪 대전 #${match.id} 참가를 철회했습니다. (${count}/${MATCH_SIZE})`);
  },

  async [ACTIONS.VIEW](interaction, ctx, [matchId]) {
    const match = ctx.services.matches.requireActiveMatchById(ctx.guild.id, matchId);
    return interaction.reply({ embeds: [views.matchDetailEmbed(ctx.services.matches.getMatchView(match.id))] });
  },

  async [ACTIONS.POSITION](interaction, ctx, [matchId]) {
    const member = ctx.services.accounts.getActiveMember(ctx.guild.id, interaction.user.id);
    const match = ctx.services.matches.requireActiveMatchById(ctx.guild.id, matchId);
    ctx.services.matches.requireRecruiting(match);
    const participant = ctx.services.matches.requireParticipant(match, member.id);
    return interaction.reply(views.positionSelect(match.id, participant.position));
  },

  async [ACTIONS.POSITION_SELECT](interaction, ctx, [matchId]) {
    const value = interaction.values[0];
    const position = POSITIONS.includes(value) ? value : null;
    ctx.services.matches.setPosition({ ...base(interaction, ctx, matchId), position });
    return interaction.update({
      content: position
        ? `🎯 이번 대전 포지션: **${positionLabel(position)}**`
        : '🎯 포지션 선택을 해제했습니다.',
      components: [],
    });
  },

  async [ACTIONS.MANAGE](interaction, ctx, [matchId]) {
    const match = ctx.services.matches.checkManager(base(interaction, ctx, matchId));
    return interaction.reply(views.controlPanel(ctx.services.matches.getMatchView(match.id)));
  },

  /* ───────────── 관리 패널 (관리자 / 대전 등록자) ───────────── */

  async [ACTIONS.START](interaction, ctx, [matchId]) {
    const view = ctx.services.matches.start(base(interaction, ctx, matchId));
    await refreshMatchMessage(ctx.client, ctx.services, view.match.id);
    return interaction.update(views.controlPanel(view, '▶️ 대전을 시작했습니다. 판이 끝날 때마다 [대전 기록]으로 결과를 등록해 주세요.'));
  },

  async [ACTIONS.RECORD](interaction, ctx, [matchId]) {
    const { match, gameNo, participants } = ctx.services.matches.checkCanRecord(base(interaction, ctx, matchId));
    return interaction.showModal(views.recordModal(match.id, gameNo, participants));
  },

  async [ACTIONS.RECORD_MODAL](interaction, ctx, [matchId, gameNo]) {
    // 캡쳐 다운로드가 3초를 넘을 수 있어 먼저 응답을 예약한다.
    await interaction.deferReply();
    const params = base(interaction, ctx, matchId);
    const { gameNo: expected } = ctx.services.matches.checkCanRecord(params);
    if (Number(gameNo) !== expected) {
      throw new UserError(`${gameNo}판은 이미 기록되었습니다. 다시 [대전 기록]을 눌러 주세요.`);
    }
    const winnerDiscordUserIds = interaction.fields.getStringSelectValues('winners');
    const attachment = interaction.fields.getUploadedFiles('screenshot', true).first();

    const screenshotPath = await saveScreenshot({
      dir: ctx.config.recordsDir,
      discordGuildId: interaction.guildId,
      matchId: params.matchId,
      gameNo: expected,
      attachment,
      ...(ctx.fetchImpl ? { fetchImpl: ctx.fetchImpl } : {}),
    });
    let result;
    try {
      result = ctx.services.matches.recordGame({ ...params, gameNo: expected, winnerDiscordUserIds, screenshotPath });
    } catch (err) {
      await removeScreenshot(screenshotPath);
      throw err;
    }
    await refreshMatchMessage(ctx.client, ctx.services, result.match.id);
    const view = ctx.services.matches.getMatchView(result.match.id);
    const done = view.games.length >= view.match.game_count;
    return interaction.editReply(
      views.controlPanel(
        view,
        `📸 **${result.gameNo}판** 결과를 기록했습니다. (${view.games.length}/${view.match.game_count}판)` +
          (done ? '\n모든 판을 기록했습니다. [대전 종료]를 눌러 결과를 공개해 주세요.' : ''),
      ),
    );
  },

  async [ACTIONS.FINISH](interaction, ctx, [matchId]) {
    const view = ctx.services.matches.finish(base(interaction, ctx, matchId));
    await refreshMatchMessage(ctx.client, ctx.services, view.match.id);
    let notice = '🏁 대전을 종료했습니다. 채널에 결과를 공개했습니다.';
    try {
      await postFinishMessage(await resolveMatchChannel(interaction, view.match), ctx.services, view.match.id);
    } catch (err) {
      console.error('대전 종료 알림 전송 실패:', err.message);
      notice = '🏁 대전을 종료했지만 채널에 결과를 올리지 못했습니다. 봇의 메시지 보내기/파일 첨부 권한을 확인해 주세요.';
    }
    return interaction.update(views.controlPanel(view, notice));
  },

  async [ACTIONS.CANCEL](interaction, ctx, [matchId]) {
    const view = ctx.services.matches.cancel(base(interaction, ctx, matchId));
    await refreshMatchMessage(ctx.client, ctx.services, view.match.id);
    return interaction.update(views.controlPanel(view, `🛑 대전 #${view.match.id}을(를) 취소했습니다.`));
  },
};

/** 버튼/선택 메뉴/입력창을 처리한다. 처리할 수 없는 customId면 false */
async function handleComponent(interaction, ctx) {
  const { action, args } = parseId(interaction.customId);
  const handler = handlers[action];
  if (!handler) return false;
  await handler(interaction, ctx, args);
  return true;
}

module.exports = { handleComponent };
