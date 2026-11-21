const test = require('node:test');
const assert = require('node:assert/strict');
const { setup } = require('./helpers');
const { participantsEmbed } = require('../src/utils/format');

test('참가자 목록 Embed: 참가 순서, 포지션, 팀 표시', () => {
  const { services, guild, register, create, join } = setup();
  ['u1', 'u2', 'u3'].forEach((u) => register(u));
  create('u1');
  join('u2');
  join('u3');
  services.matches.setPosition({ guildId: guild.id, discordUserId: 'u2', position: 'MID' });
  services.teams.joinTeam({ guildId: guild.id, discordUserId: 'u3', side: 'BLUE' });

  const match = services.matches.getActiveMatch(guild.id);
  const data = participantsEmbed(services.matches.getMatchView(match.id)).toJSON();
  assert.equal(data.title, `대전 #${match.id} 참가자 (3/10)`);
  assert.deepEqual(data.description.split('\n'), [
    '**1.** <@u1> · `포지션 미정` · ⚪ 팀 미배정 · 🎮 u1#KR1',
    '**2.** <@u2> · `미드` · ⚪ 팀 미배정 · 🎮 u2#KR1',
    '**3.** <@u3> · `포지션 미정` · 🔵 블루팀 📌 · 🎮 u3#KR1',
  ]);
});
