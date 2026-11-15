/**
 * Email channel. 'smtp' sends real email (e.g. Gmail with an app password);
 * 'log' only writes a log line (local development); 'memory' keeps messages in
 * an outbox array (tests).
 */
export async function createEmailChannel({ config, logger }) {
  const { transport, host, port, user, pass, from } = config.mail;

  if (transport === 'smtp') {
    const { default: nodemailer } = await import('nodemailer');
    const mailer = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    return {
      name: 'email',
      async send({ to, subject, text, html }) {
        const info = await mailer.sendMail({ from, to, subject, text, html });
        return { id: info.messageId };
      },
    };
  }

  return {
    name: 'email',
    async send({ to, subject }) {
      logger.info('email_logged', { to, subject });
      return { id: `log-${Date.now()}` };
    },
  };
}

export function createMemoryEmailChannel() {
  const outbox = [];
  return {
    name: 'email',
    outbox,
    failNext: 0,
    async send(message) {
      if (this.failNext > 0) {
        this.failNext -= 1;
        throw new Error('Simulated email failure');
      }
      outbox.push(message);
      return { id: `mem-${outbox.length}` };
    },
  };
}
