const fs = require('node:fs');
const path = require('node:path');

/**
 * 커맨드 실행 로그를 서버별 텍스트 파일에 한 줄씩 남긴다.
 *
 *   logs/<디스코드 서버 ID>.log
 *   [2026-11-20 15:30:12] /대전 포지션 포지션:MID | 홍길동 (hong, 123456789) | 성공 | 🎯 <@123456789> 님의 포지션: **미드**
 *
 * 서버 밖(DM)에서 들어온 커맨드는 logs/direct-message.log에 남긴다.
 */
function createCommandLogger({ dir = 'logs', timeZone = 'Asia/Seoul' } = {}) {
  const dateFormat = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  let dirReady = false;

  function filePath(discordGuildId) {
    const name = discordGuildId ? String(discordGuildId).replace(/[^0-9A-Za-z_-]/g, '') : 'direct-message';
    return path.join(dir, `${name || 'unknown'}.log`);
  }

  /** 줄바꿈과 구분자가 로그 한 줄을 깨지 않도록 정리한다. */
  function clean(text) {
    return String(text ?? '').replace(/\r?\n+/g, ' / ').replace(/\|/g, '¦').trim();
  }

  function formatLine({ date = new Date(), command, user, success, message }) {
    return `[${dateFormat.format(date)}] ${clean(command)} | ${clean(user)} | ${success ? '성공' : '실패'} | ${clean(message)}\n`;
  }

  /**
   * @param {{ discordGuildId: string|null, date?: Date, command: string, user: string, success: boolean, message: string }} entry
   */
  async function log(entry) {
    if (!dirReady) {
      await fs.promises.mkdir(dir, { recursive: true });
      dirReady = true;
    }
    await fs.promises.appendFile(filePath(entry.discordGuildId), formatLine(entry), 'utf8');
  }

  return { log, formatLine, filePath };
}

/** `/대전 포지션 포지션:MID` 형태로 입력된 커맨드 전체를 문자열로 만든다. */
function describeCommand(interaction) {
  const parts = [`/${interaction.commandName}`];
  const walk = (options = []) => {
    for (const opt of options) {
      if (opt.options) {
        parts.push(opt.name); // 서브커맨드(그룹)
        walk(opt.options);
      } else if (opt.value !== undefined) {
        parts.push(`${opt.name}:${opt.value}`);
      }
    }
  };
  walk(interaction.options?.data);
  return parts.join(' ');
}

/**
 * 커맨드뿐 아니라 버튼/선택 메뉴/입력창도 로그용 문자열로 만든다.
 *   [버튼] 대전 참가 · [선택] 포지션 선택: MID · [입력] 대전 참가 - 롤 아이디 입력: Hide on bush#KR1
 * @param {(action: string) => string} labelFor customId의 action을 사람이 읽는 이름으로 바꾸는 함수
 */
function describeInteraction(interaction, labelFor = (a) => a) {
  if (interaction.isChatInputCommand?.()) return describeCommand(interaction);
  const action = String(interaction.customId ?? '').split('|')[0];
  const label = labelFor(action) || action;
  if (interaction.isButton?.()) return `[버튼] ${label}`;
  if (interaction.isStringSelectMenu?.() || interaction.isUserSelectMenu?.()) {
    return `[선택] ${label}: ${(interaction.values ?? []).join(', ')}`;
  }
  if (interaction.isModalSubmit?.()) {
    let detail = '';
    try {
      detail = interaction.fields.getTextInputValue('gameName');
    } catch {
      /* 롤 아이디 입력창이 아님 */
    }
    return `[입력] ${label}${detail ? `: ${detail}` : ''}`;
  }
  return label;
}

/** 등록자: 서버 표시 이름 (사용자명, 디스코드 ID) */
function describeUser(interaction) {
  const { user } = interaction;
  const display = interaction.member?.displayName ?? user.globalName ?? user.username;
  return `${display} (${user.username}, ${user.id})`;
}

/** reply 내용(문자열/내용/임베드)을 결과 메시지 한 줄로 요약한다. */
function describeReply(payload) {
  if (typeof payload === 'string') return payload;
  const texts = [];
  if (payload?.content) texts.push(payload.content);
  for (const embed of payload?.embeds ?? []) {
    const data = typeof embed.toJSON === 'function' ? embed.toJSON() : embed;
    texts.push(['[임베드]', data.title, data.description].filter(Boolean).join(' '));
  }
  return texts.join(' / ');
}

module.exports = { createCommandLogger, describeCommand, describeInteraction, describeUser, describeReply };
