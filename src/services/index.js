const { createGuildService } = require('./guildService');
const { createAccountService } = require('./accountService');
const { createMatchService } = require('./matchService');
const { createTeamService } = require('./teamService');
const { createPointService } = require('./pointService');

function createServices(db, { random = Math.random } = {}) {
  const guilds = createGuildService(db);
  const accounts = createAccountService(db);
  const matches = createMatchService(db, accounts);
  const teams = createTeamService(db, accounts, matches, random);
  const points = createPointService(db, accounts);
  return { guilds, accounts, matches, teams, points };
}

module.exports = { createServices };
