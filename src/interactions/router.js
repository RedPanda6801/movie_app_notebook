const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { UserError } = require('../utils/errors');
const { describeInteraction, describeUser, describeReply } = require('../utils/commandLogger');
const { handleComponent } = require('./handlers');
const { ACTION_LABELS } = require('./ids');

const labelFor = (action) => ACTION_LABELS[action];

/**
 * 응답은 기본적으로 본인에게만 보이게(ephemeral) 한다.
 * 모두에게 보여야 하는 응답은 payload에 public: true를 넣는다.
 */
function withVisibility(payload) {
  const obj = typeof payload === 'string' ? { content: payload } : { ...payload };
  const isPublic = obj.public === true;
  delete obj.public;
  if (!isPublic) obj.flags = (obj.flags ?? 0) | MessageFlags.Ephemeral;
  return obj;
}

/** 응답 함수를 감싸서 나만 보기 기본값을 적용하고, 로그용 결과 메시지를 모은다. */
function wrapResponses(interaction, onMessage) {
  const wrap = (name, transform) => {
    if (typeof interaction[name] !== 'function') return;
    const original = interaction[name].bind(interaction);
    interaction[name] = (payload) => {
      onMessage(name === 'showModal' ? `[입력창 표시] ${payload?.toJSON?.().title ?? ''}` : describeReply(payload));
      return original(transform ? transform(payload) : payload);
    };
  };
  wrap('reply', withVisibility);
  wrap('followUp', withVisibility);
  wrap('deferReply', (p) => withVisibility(p ?? {}));
  wrap('update');
  wrap('deferUpdate');
  wrap('editReply');
  wrap('showModal');
}

/** 3초 응답 제한을 넘겨 디스코드가 이미 버린 상호작용 */
const UNKNOWN_INTERACTION = 10062;

async function replyError(interaction, content, err) {
  if (err?.code === UNKNOWN_INTERACTION) return; // 응답할 수 없는 상태라 다시 시도하지 않는다.
  try {
    if (interaction.deferred && !interaction.replied) await interaction.editReply({ content, embeds: [], components: [] });
    else if (interaction.replied) await interaction.followUp({ content });
    else await interaction.reply({ content });
  } catch (replyErr) {
    console.error('오류 응답 전송 실패:', replyErr.message);
  }
}

/**
 * InteractionCreate 이벤트 처리기를 만든다.
 * - 슬래시 커맨드: 서버 관리자만 실행 가능
 * - 버튼/선택 메뉴/입력창: 모든 사용자 (버튼별 권한은 서비스에서 확인)
 * - 모든 상호작용을 서버별 로그 파일에 남긴다.
 */
function createInteractionHandler({ services, commandMap, commandLogger, config, client, fetchImpl }) {
  return async function onInteraction(interaction) {
    const isCommand = interaction.isChatInputCommand();
    const isComponent = interaction.isButton() || interaction.isStringSelectMenu() || interaction.isModalSubmit();
    if (!isCommand && !isComponent) return;
    const command = isCommand ? commandMap.get(interaction.commandName) : null;
    if (isCommand && !command) return;

    let resultMessage = '';
    wrapResponses(interaction, (msg) => {
      if (msg) resultMessage = msg;
    });

    let success = true;
    try {
      if (!interaction.inGuild()) {
        throw new UserError('이 봇은 서버 채널에서만 사용할 수 있습니다.');
      }
      const isAdmin = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;
      if (isCommand && !isAdmin) {
        throw new UserError('권한이 없습니다. 커맨드는 서버 관리자만 사용할 수 있습니다. 버튼을 이용해 주세요.');
      }
      const guild = services.guilds.ensureGuild(interaction.guildId, interaction.guild?.name ?? null);
      const ctx = { services, guild, isAdmin, client, config, fetchImpl };

      if (isCommand) {
        await command.execute(interaction, ctx);
      } else if (!(await handleComponent(interaction, ctx))) {
        throw new UserError('알 수 없는 버튼입니다. 최신 메시지를 이용해 주세요.');
      }
    } catch (err) {
      success = false;
      const isUserError = err instanceof UserError;
      if (err?.code === UNKNOWN_INTERACTION) {
        console.error(
          `${describeInteraction(interaction, labelFor)}: 3초 안에 응답하지 못해 디스코드가 요청을 버렸습니다. (네트워크 지연 확인)`,
        );
      } else if (!isUserError) {
        console.error(`${describeInteraction(interaction, labelFor)} 처리 중 오류:`, err);
      }
      const content = isUserError ? `⚠️ ${err.message}` : '❌ 요청을 처리하는 중 오류가 발생했습니다.';
      await replyError(interaction, content, err);
      resultMessage = isUserError ? content : `${content} (${err?.message ?? err})`;
    }

    // 서버별 로그 (logs/<서버 ID>.log)
    try {
      await commandLogger.log({
        discordGuildId: interaction.guildId,
        command: describeInteraction(interaction, labelFor),
        user: describeUser(interaction),
        success,
        message: resultMessage,
      });
    } catch (logErr) {
      console.error('로그 기록 실패:', logErr);
    }
  };
}

module.exports = { createInteractionHandler, withVisibility };
