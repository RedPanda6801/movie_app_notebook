const { createGuildRepository } = require('./guildRepository');
const { createAccountRepository } = require('./accountRepository');
const { createGuildMemberRepository } = require('./guildMemberRepository');
const { createMatchRepository } = require('./matchRepository');
const { createTeamRepository } = require('./teamRepository');
const { createMatchParticipantRepository } = require('./matchParticipantRepository');
const { createMatchRecordRepository } = require('./matchRecordRepository');
const { createMatchRecordWinnerRepository } = require('./matchRecordWinnerRepository');

/**
 * 테이블별 Repository 묶음. 서비스는 DB를 직접 다루지 않고 이 객체만 사용한다.
 * transaction(fn): fn을 하나의 DB 트랜잭션으로 감싼 함수를 돌려준다.
 */
function createRepositories(db) {
  return {
    transaction: (fn) => db.transaction(fn),
    guilds: createGuildRepository(db),
    accounts: createAccountRepository(db),
    guildMembers: createGuildMemberRepository(db),
    matches: createMatchRepository(db),
    teams: createTeamRepository(db),
    participants: createMatchParticipantRepository(db),
    records: createMatchRecordRepository(db),
    recordWinners: createMatchRecordWinnerRepository(db),
  };
}

module.exports = { createRepositories };
