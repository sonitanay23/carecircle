/** Logs one structured line per request, in Cloud Logging's httpRequest format. */
export function requestLogger(logger) {
  return (req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const latencyMs = Number(process.hrtime.bigint() - start) / 1e6;
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
      logger[level]('request', {
        requestId: req.id,
        httpRequest: {
          requestMethod: req.method,
          requestUrl: req.originalUrl,
          status: res.statusCode,
          latency: `${(latencyMs / 1000).toFixed(3)}s`,
        },
      });
    });
    next();
  };
}
