/**
 * Structured JSON logger. Cloud Run forwards stdout to Cloud Logging, which
 * reads the `severity` and `message` fields natively — no agent or SDK needed.
 * Error-level entries carrying a stack trace are picked up by Error Reporting.
 */

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
const SEVERITY = { debug: 'DEBUG', info: 'INFO', warn: 'WARNING', error: 'ERROR' };

/**
 * @param {{ level?: keyof ORDER, sink?: (line: string) => void }} [opts]
 */
export function createLogger({
  level = 'info',
  sink = (line) => process.stdout.write(`${line}\n`),
} = {}) {
  const threshold = ORDER[level] ?? ORDER.info;

  const log = (lvl, message, fields = {}) => {
    if (ORDER[lvl] < threshold) return;
    const entry = { severity: SEVERITY[lvl], message, time: new Date().toISOString(), ...fields };
    if (fields.err instanceof Error) {
      // Error Reporting groups errors by the stack trace in `stack_trace`/`message`.
      entry.stack_trace = fields.err.stack;
      entry.err = { name: fields.err.name, message: fields.err.message };
    }
    sink(JSON.stringify(entry));
  };

  return {
    debug: (msg, f) => log('debug', msg, f),
    info: (msg, f) => log('info', msg, f),
    warn: (msg, f) => log('warn', msg, f),
    error: (msg, f) => log('error', msg, f),
  };
}
