import { HttpError } from '../lib/httpError.js';

// Plain-language messages for errors raised by Express's body parsers.
const PARSER_MESSAGES = {
  'entity.too.large': 'That file is too large. Please use a smaller photo.',
  'entity.parse.failed': 'The request could not be read. Please try again.',
  'encoding.unsupported': 'The request could not be read. Please try again.',
};

/** 404 for unknown API routes. */
export function notFound() {
  return (req, _res, next) => next(new HttpError(404, 'Not found', 'NOT_FOUND'));
}

/**
 * Final error handler. Never leaks stack traces or internal messages to clients.
 */
export function errorHandler(logger) {
  // Express identifies error handlers by their 4-argument signature.
  return (err, req, res, _next) => {
    const isKnown = err instanceof HttpError;
    // body-parser errors (bad JSON, too large) carry a status/expose flag.
    const status = isKnown ? err.status : err.expose && err.status ? err.status : 500;

    if (status >= 500) {
      logger.error('unhandled_error', { requestId: req.id, err });
    }

    res.status(status).json({
      error: {
        code: isKnown ? err.code : status === 500 ? 'INTERNAL' : status === 413 ? 'TOO_LARGE' : 'BAD_REQUEST',
        message: status === 500 ? 'Something went wrong. Please try again.' : (!isKnown && PARSER_MESSAGES[err.type]) || err.message,
        requestId: req.id,
      },
    });
  };
}
