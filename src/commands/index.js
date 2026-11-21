const { InteractionContextType, PermissionFlagsBits } = require('discord.js');

const commands = [
  require('./account'),
  require('./match'),
  require('./team'),
  require('./points'),
  require('./record'),
];

// 모든 커맨드는 서버 관리자 전용이다. (일반 사용자 목록에는 보이지 않음, 실행 시에도 다시 확인)
for (const command of commands) {
  command.data
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .setContexts(InteractionContextType.Guild);
}

module.exports = { commands };
