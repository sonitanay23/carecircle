/** An error that maps cleanly onto an HTTP response. */
export class HttpError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} message Safe, user-facing message
   * @param {string} [code] Machine-readable code
   */
  constructor(status, message, code = 'ERROR') {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}
