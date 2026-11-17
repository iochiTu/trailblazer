import type { Mailer } from "@traiblazer/core";
import { createTransport } from "nodemailer";

/**
 * Email transport for add-on notifications. With SMTP_URL (e.g. smtps://user:pass@smtp.example.com)
 * mail is sent from MAIL_FROM. Local development can explicitly simulate delivery.
 */
export function createMailerFromEnv(
  env: NodeJS.ProcessEnv,
  log: (msg: string, data?: Record<string, unknown>) => void,
): Mailer {
  const from = env.MAIL_FROM ?? "Traiblazer <notifications@traiblazer.local>";
  if (!env.SMTP_URL) {
    return {
      async send() {
        if (env.MAIL_SIMULATE === "true" && env.NODE_ENV === "development") {
          log("email delivery simulated");
          return;
        }
        throw new Error("Email delivery unavailable: SMTP_URL is missing");
      },
    };
  }
  const transport = createTransport(env.SMTP_URL);
  return {
    async send(message) {
      // Under another name (a business writing to its customer), the address stays ours.
      const address = /<([^>]+)>/.exec(from)?.[1] ?? from;
      await transport.sendMail({
        from: message.fromName ? { name: message.fromName, address } : from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        replyTo: message.replyTo,
      });
    },
  };
}
