import "server-only";
import nodemailer from "nodemailer";
import { AppError } from "@/lib/contracts/errors";
import type { MailContent } from "./inactivity-notice";

/**
 * Gmail SMTP sender (operator decision 2026-11-04: Gmail SMTP for service notices; Google LLC is listed as a
 * processor in the privacy policy). Uses the operator's Gmail account with an app password.
 * Errors never carry the recipient address or the SMTP response text (no PII in logs).
 */

export type SendMail = (to: string, content: MailContent) => Promise<void>;

export type GmailConfig = { user: string | undefined; appPassword: string | undefined };

/** Returns a sender, or throws `internal_error` when the Gmail settings are missing (fail closed). */
export function createGmailSender(config: GmailConfig): { send: SendMail; close: () => void } {
  if (!config.user || !config.appPassword) {
    throw new AppError("internal_error", undefined, { status: 500, cause: new Error("GMAIL_SMTP_USER / GMAIL_SMTP_APP_PASSWORD missing") });
  }
  const from = { name: "Resumate", address: config.user };
  const transport = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    pool: true,
    maxConnections: 1,
    auth: { user: config.user, pass: config.appPassword.replace(/\s+/g, "") },
  });
  return {
    async send(to, content) {
      try {
        await transport.sendMail({ from, to, subject: content.subject, text: content.text, html: content.html });
      } catch (err) {
        const code = err && typeof err === "object" && "code" in err ? String((err as { code: unknown }).code) : "unknown";
        throw new AppError("internal_error", undefined, { status: 500, cause: new Error(`gmail send failed (code ${code})`) });
      }
    },
    close() {
      transport.close();
    },
  };
}
