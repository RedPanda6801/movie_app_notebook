// 슬래시 커맨드를 디스코드에 등록한다. 커맨드 정의가 바뀔 때마다 한 번 실행한다.
//   npm run deploy
const { REST, Routes } = require('discord.js');
const config = require('./config');
const { commands } = require('./commands');

async function main() {
  const rest = new REST().setToken(config.token);
  const body = commands.map((c) => c.data.toJSON());

  if (config.devGuildId) {
    // 개발 서버에만 등록 (즉시 반영)
    await rest.put(Routes.applicationGuildCommands(config.clientId, config.devGuildId), { body });
    console.log(`개발 서버(${config.devGuildId})에 커맨드 ${body.length}개를 등록했습니다.`);
  } else {
    // 전역 등록 (봇이 참가한 모든 서버, 반영까지 시간이 걸릴 수 있음)
    await rest.put(Routes.applicationCommands(config.clientId), { body });
    console.log(`전역 커맨드 ${body.length}개를 등록했습니다.`);
  }
}

main().catch((err) => {
  console.error('커맨드 등록 실패:', err);
  process.exit(1);
});
