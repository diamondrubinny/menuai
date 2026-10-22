import nodemailer from 'nodemailer';

export interface Mail {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  readonly configured: boolean;
  send(mail: Mail): Promise<void>;
}

/** SMTP mailer (any provider, configured by SMTP_URL). */
export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    configured: true,
    async send(mail) {
      await transport.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
    },
  };
}

/** Used until an email provider is chosen: nothing is sent; owners sign in with the CLI. */
export const disabledMailer: Mailer = {
  configured: false,
  async send() {},
};
