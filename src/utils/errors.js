/** 사용자에게 그대로 보여줄 수 있는 업무 오류 */
class UserError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UserError';
  }
}

module.exports = { UserError };
