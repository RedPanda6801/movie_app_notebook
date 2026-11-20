const { createRepositories } = require('../repositories');
const { createGuildService } = require('./guildService');
const { createAccountService } = require('./accountService');
const { createMatchService } = require('./matchService');
const { createTeamService } = require('./teamService');
const { createPointService } = require('./pointService');

/**
 * 서비스 묶음을 만든다. 서비스는 Repository만 사용하고 DB에 직접 쿼리하지 않는다.
 */
function createServices(db, { random = Math.random } = {}) {
  const repos = createRepositories(db);
  const guilds = createGuildService(repos);
  const accounts = createAccountService(repos);
  const matches = createMatchService(repos, accounts);
  const teams = createTeamService(repos, accounts, matches, random);
  const points = createPointService(repos, accounts);
  return { guilds, accounts, matches, teams, points };
}

module.exports = { createServices };
