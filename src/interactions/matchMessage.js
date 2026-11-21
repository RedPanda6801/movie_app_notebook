const { matchPublicMessage, finishMessage } = require('./views');

/**
 * 공개 대전 정보 메시지를 채널에 올리고 위치를 저장한다.
 */
async function postMatchMessage(channel, services, matchId) {
  const view = services.matches.getMatchView(matchId);
  const message = await channel.send(matchPublicMessage(view));
  services.matches.setMatchMessage(matchId, channel.id, message.id);
  return message;
}

/**
 * 공개 대전 정보 메시지를 최신 상태(참가자 수, 상태, 버튼)로 고친다.
 * 메시지가 지워졌거나 권한이 없으면 로그만 남긴다.
 */
async function refreshMatchMessage(client, services, matchId) {
  const view = services.matches.getMatchView(matchId);
  const { match } = view || {};
  if (!match?.message_channel_id || !match.message_id) return;
  try {
    const channel = await client.channels.fetch(match.message_channel_id);
    const message = await channel.messages.fetch(match.message_id);
    await message.edit(matchPublicMessage(view));
  } catch (err) {
    console.error(`대전 #${matchId} 정보 메시지 갱신 실패:`, err.message);
  }
}

/** 대전 종료 알림을 채널에 모두에게 보이게 올린다. */
async function postFinishMessage(channel, services, matchId) {
  const view = services.matches.getMatchView(matchId);
  return channel.send(finishMessage(view));
}

module.exports = { postMatchMessage, refreshMatchMessage, postFinishMessage };
