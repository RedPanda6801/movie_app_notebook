const { MATCH_SIZE, POSITIONS, SIDES, SIDE_LABELS, UNDECIDED_LABEL } = require('../constants');
const { UserError } = require('../utils/errors');
const { positionLabel } = require('../utils/format');
const {
  saveScreenshot,
  removeScreenshot,
  findPendingScreenshot,
  promotePendingScreenshot,
  readPendingReading,
  removePendingReading,
} = require('../utils/screenshotStore');
const { applyReading } = require('../integrations/geminiScoreboard');
const adminViews = require('./adminViews');
const { ACTIONS, buildId, parseId } = require('./ids');
const views = require('./views');
const statsViews = require('./statsViews');
const { parseStatLines } = require('../services/statInput');
const { postMatchMessage, refreshMatchMessage, postFinishMessage } = require('./matchMessage');

/**
 * 버튼 / 선택 메뉴 / 입력창(모달) 처리.
 *
 * ⚠️ 디스코드는 상호작용에 **3초 안에** 첫 응답(reply/update/showModal/defer)을 받아야 한다.
 *    늦으면 "Unknown interaction(10062)" 오류가 나고 사용자는 응답을 못 받는다.
 *    그래서 네트워크를 타는 작업(공개 메시지 갱신/게시, 캡쳐 다운로드)은
 *    - 응답을 먼저 보낸 **뒤에** 하거나 (refreshMatchMessage)
 *    - 응답 결과에 필요하면 **defer로 먼저 예약**한 뒤 처리하고 editReply 한다.
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

/** 참가 입력창의 포지션 선택 값 (미정 = null) */
function selectedPosition(interaction) {
  let value = null;
  try {
    value = interaction.fields.getStringSelectValues('position')?.[0] ?? null;
  } catch {
    /* 포지션 칸이 없는 이전 입력창 */
  }
  return POSITIONS.includes(value) ? value : null;
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
    const { gameName } = ctx.services.accounts.getRegisterDefaults(ctx.guild.id, interaction.user.id);
    return interaction.showModal(views.accountGameNameModal(ACTIONS.ACCOUNT_REGISTER_MODAL, '계정 등록', gameName));
  },

  async [ACTIONS.ACCOUNT_REGISTER_MODAL](interaction, ctx) {
    const { reactivated, member } = ctx.services.accounts.register({
      guildId: ctx.guild.id,
      discordUserId: interaction.user.id,
      username: interaction.user.username,
      displayName: interaction.member?.displayName ?? interaction.user.globalName ?? null,
      gameName: interaction.fields.getTextInputValue('gameName'),
    });
    return interaction.reply(
      (reactivated
        ? '✅ 계정이 다시 등록되었습니다. 이전 승점 기록이 그대로 이어집니다.'
        : '✅ 계정이 등록되었습니다. 이제 대전에 참가할 수 있습니다.') +
        `\n🎮 롤 아이디: **${member.game_name}** · 선호 포지션은 [선호 포지션]으로 정할 수 있습니다.`,
    );
  },

  async [ACTIONS.ACCOUNT_CHANGE_ID](interaction, ctx) {
    const member = ctx.services.accounts.getActiveMember(ctx.guild.id, interaction.user.id);
    return interaction.showModal(
      views.accountGameNameModal(ACTIONS.ACCOUNT_CHANGE_ID_MODAL, '롤 아이디 변경', member.game_name),
    );
  },

  async [ACTIONS.ACCOUNT_CHANGE_ID_MODAL](interaction, ctx) {
    const { gameName, matchId } = ctx.services.accounts.changeGameName({
      guildId: ctx.guild.id,
      discordUserId: interaction.user.id,
      gameName: interaction.fields.getTextInputValue('gameName'),
    });
    await interaction.reply(
      `✏️ 롤 아이디를 **${gameName}**(으)로 바꿨습니다.${matchId ? ` 모집 중인 대전 #${matchId}에도 반영했습니다.` : ''}`,
    );
    if (matchId) await refreshMatchMessage(ctx.client, ctx.services, matchId);
  },

  async [ACTIONS.ACCOUNT_POSITION](interaction, ctx) {
    const member = ctx.services.accounts.getActiveMember(ctx.guild.id, interaction.user.id);
    return interaction.reply(views.preferredPositionSelect(member.preferred_position));
  },

  async [ACTIONS.ACCOUNT_POSITION_SELECT](interaction, ctx) {
    const { position } = ctx.services.accounts.setPreferredPosition({
      guildId: ctx.guild.id,
      discordUserId: interaction.user.id,
      position: interaction.values[0],
    });
    return interaction.update({
      content: `🎯 선호 포지션: **${positionLabel(position)}** · 다음 대전 참가부터 기본값으로 선택됩니다.`,
      components: [],
    });
  },

  async [ACTIONS.PANEL_WITHDRAW](interaction, ctx) {
    const { leftMatchId } = ctx.services.accounts.withdraw({
      guildId: ctx.guild.id,
      discordUserId: interaction.user.id,
    });
    await interaction.reply(
      `👋 계정을 탈퇴했습니다.${leftMatchId ? ` 참가 중이던 대전 #${leftMatchId}에서도 빠졌습니다.` : ''}`,
    );
    if (leftMatchId) await refreshMatchMessage(ctx.client, ctx.services, leftMatchId);
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
      views.joinModal(
        buildId(ACTIONS.CREATE_MODAL, gameCount),
        `대전 등록 (${gameCount}판)`,
        member.preferred_position,
        member.game_name,
      ),
    );
  },

  async [ACTIONS.CREATE_MODAL](interaction, ctx, [gameCount]) {
    // 공개 메시지 게시(네트워크)가 끝나야 결과를 알려줄 수 있으므로 먼저 응답을 예약한다.
    await interaction.deferReply();
    const match = ctx.services.matches.createMatch({
      ...base(interaction, ctx),
      channelId: interaction.channelId,
      gameCount: Number(gameCount),
      position: selectedPosition(interaction),
    });

    let notice = `✅ **대전 #${match.id}**(${match.game_count}판)이 등록되었고, 자동으로 참가했습니다.`;
    try {
      await postMatchMessage(await resolveChannel(interaction), ctx.services, match.id);
    } catch (err) {
      console.error('대전 정보 메시지 전송 실패:', err.message);
      notice += '\n⚠️ 채널에 대전 정보 메시지를 올리지 못했습니다. 봇에게 이 채널의 메시지 보내기 권한이 있는지 확인해 주세요.';
    }
    return interaction.editReply(views.controlPanel(ctx.services.matches.getMatchView(match.id), notice));
  },

  /* ───────────── 공개 대전 정보 메시지 버튼 ───────────── */

  async [ACTIONS.JOIN](interaction, ctx, [matchId]) {
    const { member, match } = ctx.services.matches.checkCanJoin(base(interaction, ctx, matchId));
    return interaction.showModal(
      views.joinModal(
        buildId(ACTIONS.JOIN_MODAL, match.id),
        `대전 #${match.id} 참가`,
        member.preferred_position,
        member.game_name,
      ),
    );
  },

  async [ACTIONS.JOIN_MODAL](interaction, ctx, [matchId]) {
    const position = selectedPosition(interaction);
    const { match, count } = ctx.services.matches.join({ ...base(interaction, ctx, matchId), position });
    const lines = [`🙋 대전 #${match.id}에 참가했습니다. (${count}/${MATCH_SIZE}) · 포지션: **${positionLabel(position)}**`];
    if (count === MATCH_SIZE) lines.push('🎉 10명이 모두 모였습니다! 관리자가 대전을 시작하면 진행됩니다.');
    lines.push('포지션과 팀은 대전 정보 메시지의 [포지션 등록/변경] · [팀 등록/변경] 버튼으로 정할 수 있습니다.');
    await interaction.reply(lines.join('\n'));
    await refreshMatchMessage(ctx.client, ctx.services, match.id);
  },

  async [ACTIONS.LEAVE](interaction, ctx, [matchId]) {
    const { match, count } = ctx.services.matches.leave(base(interaction, ctx, matchId));
    await interaction.reply(`🚪 대전 #${match.id} 참가를 철회했습니다. (${count}/${MATCH_SIZE})`);
    await refreshMatchMessage(ctx.client, ctx.services, match.id);
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
        : `🎯 이번 대전 포지션: **${UNDECIDED_LABEL}**`,
      components: [],
    });
  },

  async [ACTIONS.TEAM](interaction, ctx, [matchId]) {
    const member = ctx.services.accounts.getActiveMember(ctx.guild.id, interaction.user.id);
    const match = ctx.services.matches.requireActiveMatchById(ctx.guild.id, matchId);
    ctx.services.matches.requireRecruiting(match);
    const participant = ctx.services.matches.requireParticipant(match, member.id);
    // 셔플로 배정된 팀은 직접 고른 팀이 아니므로 미정으로 보여준다.
    const view = ctx.services.matches.getMatchView(match.id);
    const me = view.participants.find((p) => p.id === participant.id);
    return interaction.reply(views.teamSelect(match.id, me?.is_team_locked ? me.side : null));
  },

  async [ACTIONS.TEAM_SELECT](interaction, ctx, [matchId]) {
    const value = interaction.values[0];
    const side = SIDES.includes(value) ? value : null;
    const { match } = ctx.services.teams.setTeam({ ...base(interaction, ctx, matchId), side });
    await interaction.update({
      content: side
        ? `👥 이번 대전 팀: **${SIDE_LABELS[side]}** (팀 셔플에서 제외됩니다)`
        : `👥 이번 대전 팀: **${UNDECIDED_LABEL}** (팀 셔플로 정해집니다)`,
      components: [],
    });
    await refreshMatchMessage(ctx.client, ctx.services, match.id);
  },

  async [ACTIONS.MANAGE](interaction, ctx, [matchId]) {
    const match = ctx.services.matches.checkManager(base(interaction, ctx, matchId));
    return interaction.reply(views.controlPanel(ctx.services.matches.getMatchView(match.id)));
  },

  /* ───────────── 관리 패널 (관리자 / 대전 등록자) ───────────── */

  async [ACTIONS.SHUFFLE](interaction, ctx, [matchId]) {
    const view = ctx.services.teams.shuffle(base(interaction, ctx, matchId));
    await interaction.update(
      views.controlPanel(
        view,
        view.match.status === 'IN_PROGRESS'
          ? `🎲 팀을 다시 섞었습니다. 다음 판(${view.games.length + 1}판)부터 이 팀으로 기록됩니다.`
          : '🎲 팀을 랜덤으로 섞었습니다. 마음에 들지 않으면 다시 눌러 주세요.',
        [views.teamsEmbed(view)],
      ),
    );
    await refreshMatchMessage(ctx.client, ctx.services, view.match.id);
  },

  async [ACTIONS.START](interaction, ctx, [matchId]) {
    const view = ctx.services.matches.start(base(interaction, ctx, matchId));
    await interaction.update(views.controlPanel(view, '▶️ 대전을 시작했습니다. 판이 끝날 때마다 [대전 기록]으로 결과를 등록해 주세요.'));
    await refreshMatchMessage(ctx.client, ctx.services, view.match.id);
  },

  async [ACTIONS.RECORD](interaction, ctx, [matchId]) {
    const { match, gameNo, red, blue, signature, usedChampions } = ctx.services.matches.checkCanRecord(
      base(interaction, ctx, matchId),
    );
    return interaction.showModal(views.recordModal(match.id, gameNo, red, blue, signature, usedChampions));
  },

  async [ACTIONS.RECORD_MODAL](interaction, ctx, [matchId, gameNo, signature]) {
    // 캡쳐 다운로드가 3초를 넘을 수 있어 먼저 응답을 예약한다.
    await interaction.deferReply();
    const params = base(interaction, ctx, matchId);
    const { gameNo: expected, red, blue, signature: current } = ctx.services.matches.checkCanRecord(params);
    if (Number(gameNo) !== expected) {
      throw new UserError(`${gameNo}판은 이미 기록되었습니다. 다시 [대전 기록]을 눌러 주세요.`);
    }
    if (signature && signature !== current) {
      // 입력창 양식의 줄 순서는 팀 구성 기준이라, 그 사이 셔플되면 다른 사람에게 기록될 수 있다.
      throw new UserError('입력창을 연 뒤 팀 구성이 바뀌었습니다. (팀 셔플 등) 다시 [대전 기록]을 눌러 주세요.');
    }
    const winnerSide = interaction.fields.getStringSelectValues('winnerSide')[0];
    const redText = interaction.fields.getTextInputValue('statsRED');
    const blueText = interaction.fields.getTextInputValue('statsBLUE');
    let stats;
    try {
      // 입력창 양식과 같은 순서(팀별 참가 순서)로 K/D/A/CS를 읽는다.
      stats = [
        ...parseStatLines(redText, red, SIDE_LABELS.RED),
        ...parseStatLines(blueText, blue, SIDE_LABELS.BLUE),
      ].map(({ member, ...st }) => ({ participantId: member.id, ...st }));
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      // 입력창이 닫히면 내용이 사라지므로, 다시 붙여넣을 수 있게 입력한 내용을 돌려준다.
      throw new UserError(
        `${err.message}\n\n다시 [대전 기록]을 눌러 아래 내용을 붙여넣고 고쳐 주세요.\n` +
          `**${SIDE_LABELS.RED}**\n\`\`\`\n${redText}\n\`\`\`\n**${SIDE_LABELS.BLUE}**\n\`\`\`\n${blueText}\n\`\`\``.slice(0, 1700),
      );
    }
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
      result = ctx.services.matches.recordGame({
        ...params,
        gameNo: expected,
        signature: current,
        winnerSide,
        stats,
        screenshotPath,
      });
    } catch (err) {
      await removeScreenshot(screenshotPath);
      throw err;
    }
    const view = ctx.services.matches.getMatchView(result.match.id);
    const done = view.games.length >= view.match.game_count;
    await interaction.editReply(
      views.controlPanel(
        view,
        `📸 **${result.gameNo}판** 결과를 기록했습니다. (${view.games.length}/${view.match.game_count}판)` +
          (done ? '\n모든 판을 기록했습니다. [대전 종료]를 눌러 결과를 공개해 주세요.' : ''),
      ),
    );
    await refreshMatchMessage(ctx.client, ctx.services, result.match.id);
  },

  async [ACTIONS.FINISH](interaction, ctx, [matchId]) {
    const view = ctx.services.matches.finish(base(interaction, ctx, matchId));
    // 종료 알림 게시(네트워크, 캡쳐 첨부)가 끝나야 결과를 알려줄 수 있으므로 먼저 응답을 예약한다.
    await interaction.deferUpdate();
    let notice = '🏁 대전을 종료했습니다. 채널에 결과를 공개했습니다.';
    try {
      await postFinishMessage(await resolveMatchChannel(interaction, view.match), ctx.services, view.match.id);
    } catch (err) {
      console.error('대전 종료 알림 전송 실패:', err.message);
      notice = '🏁 대전을 종료했지만 채널에 결과를 올리지 못했습니다. 봇의 메시지 보내기/파일 첨부 권한을 확인해 주세요.';
    }
    await interaction.editReply(views.controlPanel(view, notice));
    await refreshMatchMessage(ctx.client, ctx.services, view.match.id);
  },

  async [ACTIONS.CANCEL](interaction, ctx, [matchId]) {
    const view = ctx.services.matches.cancel(base(interaction, ctx, matchId));
    await interaction.update(views.controlPanel(view, `🛑 대전 #${view.match.id}을(를) 취소했습니다.`));
    await refreshMatchMessage(ctx.client, ctx.services, view.match.id);
  },

  /* ───────────── /전적 관리 패널 ───────────── */

  async [ACTIONS.STATS_BY_MATCH](interaction, ctx) {
    return interaction.reply(statsViews.matchListSelect(ctx.services.records.listMatches(ctx.guild.id)));
  },

  async [ACTIONS.STATS_MATCH_SELECT](interaction, ctx) {
    const data = ctx.services.records.getMatchRecords(ctx.guild.id, interaction.values[0]);
    // 대전 목록 메시지는 그대로 두고, 결과는 새 메시지(본인만)로 보여준다.
    return interaction.reply(statsViews.matchStatsMessage(data, null));
  },

  async [ACTIONS.STATS_GAME_SELECT](interaction, ctx, [matchId]) {
    const value = interaction.values[0];
    const data = ctx.services.records.getMatchRecords(ctx.guild.id, matchId);
    // 캡쳐 이미지 첨부가 있을 수 있어 먼저 예약한다.
    await interaction.deferUpdate();
    return interaction.editReply({
      ...statsViews.matchStatsMessage(data, value === 'SUMMARY' ? null : Number(value)),
      attachments: [],
    });
  },

  async [ACTIONS.STATS_BY_MEMBER](interaction) {
    return interaction.reply(statsViews.memberSelect());
  },

  async [ACTIONS.STATS_MEMBER_SELECT](interaction, ctx) {
    const data = ctx.services.records.getMemberRecords(ctx.guild.id, interaction.values[0]);
    return interaction.reply(statsViews.memberStatsMessage(data));
  },

  async [ACTIONS.STATS_ALL](interaction, ctx) {
    await interaction.deferReply(); // CSV 파일 첨부
    return interaction.editReply(statsViews.guildStatsMessage(ctx.services.records.getGuildRecords(ctx.guild.id)));
  },

  /* ───────────── /관리자 데이터적재 ───────────── */

  async [ACTIONS.ADMIN_LOAD_OPEN](interaction, ctx, [matchId, gameNo, token]) {
    requireAdmin(ctx);
    const roster = ctx.services.admin.getGameRoster(ctx.guild.id, matchId, gameNo);
    // Gemini가 읽었지만 저장하지 못한 값이 있으면 그 값으로 미리 채운다.
    const reading = token === adminViews.EDIT_TOKEN ? null : await readPendingReading(ctx.config.recordsDir, interaction.guildId, token);
    return interaction.showModal(adminViews.loadModal(applyReading(roster, reading), token));
  },

  async [ACTIONS.ADMIN_LOAD_MODAL](interaction, ctx, [matchId, gameNo, token, signature]) {
    requireAdmin(ctx);
    await interaction.deferReply(); // 캡쳐 파일 이동 + 결과 표시
    const roster = ctx.services.admin.getGameRoster(ctx.guild.id, matchId, gameNo);
    if (signature && signature !== roster.signature) {
      throw new UserError('입력창을 연 뒤 이 판의 팀 구성이 바뀌었습니다. 다시 `/관리자 데이터적재`를 실행해 주세요.');
    }
    const winnerSide = interaction.fields.getStringSelectValues('winnerSide')[0];
    const redText = interaction.fields.getTextInputValue('statsRED');
    const blueText = interaction.fields.getTextInputValue('statsBLUE');
    let stats;
    try {
      stats = [
        ...parseStatLines(redText, roster.red, SIDE_LABELS.RED),
        ...parseStatLines(blueText, roster.blue, SIDE_LABELS.BLUE),
      ].map(({ member, ...st }) => ({ guildMemberId: member.guild_member_id, ...st }));
    } catch (err) {
      if (!(err instanceof UserError)) throw err;
      throw new UserError(
        `${err.message}\n\n위 미리보기의 [전적 입력]을 다시 눌러 아래 내용을 붙여넣고 고쳐 주세요.\n` +
          `**${SIDE_LABELS.RED}**\n\`\`\`\n${redText}\n\`\`\`\n**${SIDE_LABELS.BLUE}**\n\`\`\`\n${blueText}\n\`\`\``.slice(0, 1700),
      );
    }

    // 먼저 DB에 저장하고(검사 통과 시), 성공하면 대기 캡쳐를 이 판의 캡쳐로 옮긴다.
    const editOnly = token === adminViews.EDIT_TOKEN; // 자동 저장 뒤 [수정]: 캡쳐는 이미 저장됨
    const pending = editOnly ? null : await findPendingScreenshot(ctx.config.recordsDir, interaction.guildId, token);
    const result = ctx.services.admin.loadGameRecord({
      guildId: ctx.guild.id,
      discordUserId: interaction.user.id,
      matchId,
      gameNo,
      signature: roster.signature,
      winnerSide,
      stats,
    });
    let note = '';
    if (pending) {
      const finalPath = await promotePendingScreenshot(pending, {
        dir: ctx.config.recordsDir,
        discordGuildId: interaction.guildId,
        matchId: result.match.id,
        gameNo: result.gameNo,
      });
      ctx.services.admin.setGameScreenshot(result.match.id, result.gameNo, finalPath);
    } else if (!editOnly) {
      note = '\n⚠️ 올린 이미지를 찾지 못해 캡쳐는 바꾸지 않았습니다. (하루가 지나 정리되었거나 이미 저장됨)';
    }

    if (!editOnly) await removePendingReading(ctx.config.recordsDir, interaction.guildId, token);

    const points = new Map(
      result.players.map((p) => [p.discord_user_id, ctx.services.points.getStats(ctx.guild.id, p.discord_user_id).points]),
    );
    const message = adminViews.loadResultMessage(result, winnerSide, points);
    if (note) message.content = note.trim();
    await interaction.editReply(message);
  },
};

/** 관리자 전용 버튼/입력창 (본인만 보이는 메시지라도 다시 확인한다) */
function requireAdmin(ctx) {
  if (!ctx.isAdmin) throw new UserError('권한이 없습니다. 관리자만 할 수 있습니다.');
}

/** 버튼/선택 메뉴/입력창을 처리한다. 처리할 수 없는 customId면 false */
async function handleComponent(interaction, ctx) {
  const { action, args } = parseId(interaction.customId);
  const handler = handlers[action];
  if (!handler) return false;
  await handler(interaction, ctx, args);
  return true;
}

module.exports = { handleComponent };
