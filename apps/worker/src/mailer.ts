import type { Mailer } from "@traiblazer/core";
import { createTransport } from "nodemailer";

/**
 * Email transport for add-on notifications. With SMTP_URL (e.g. smtps://user:pass@smtp.example.com)
 * mail is sent from MAIL_FROM; without it, messages are written to the worker log so development
 * works with no mail server.
 */
export function createMailerFromEnv(
  env: NodeJS.ProcessEnv,
  log: (msg: string, data?: Record<string, unknown>) => void,
): Mailer {
  const from = env.MAIL_FROM ?? "Traiblazer <notifications@traiblazer.local>";
  if (!env.SMTP_URL) {
    return {
      async send(message) {
        log("email (not sent: SMTP_URL is not set)", { from, ...message });
      },
    };
  }
  const transport = createTransport(env.SMTP_URL);
  return {
    async send(message) {
      await transport.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
    },
  };
}
