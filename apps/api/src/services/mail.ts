import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../config/env';
import { logger } from '../utils/logger';

/**
 * Mail is used for exactly two things: invitations and password resets.
 * No client data is ever emailed.
 */

let transport: Transporter | null = null;

function getTransport(): Transporter | null {
  if (env.MAIL_TRANSPORT === 'console') return null;
  if (!transport) {
    transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      ...(env.SMTP_USER ? { auth: { user: env.SMTP_USER, pass: env.SMTP_PASS ?? '' } } : {}),
    });
  }
  return transport;
}

export interface MailInput {
  to: string;
  subject: string;
  text: string;
}

export async function sendMail(input: MailInput): Promise<void> {
  const t = getTransport();

  if (!t) {
    // Console transport: log that mail WOULD be sent. The body may contain a
    // one-time link, so it is only printed outside production.
    logger.info({ to: input.to, subject: input.subject }, 'mail (console transport)');
    if (env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.log(`\n--- mail to ${input.to} ---\n${input.text}\n---\n`);
    }
    return;
  }

  try {
    await t.sendMail({ from: env.MAIL_FROM, to: input.to, subject: input.subject, text: input.text });
    logger.info({ to: input.to, subject: input.subject }, 'mail sent');
  } catch (err) {
    // A failed invitation email must not fail the request that triggered it.
    logger.error({ err, to: input.to }, 'mail send failed');
  }
}
