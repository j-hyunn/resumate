import { ROUTES } from "@/lib/contracts/routes";

/**
 * Inactivity notice e-mail (privacy policy 2026-11-04 §4: 1 year without access → told 30 days before deletion).
 * Pure: builds the message only. The address goes in `to` and nowhere else (no logs).
 */

export type InactivityNoticeInput = {
  /** When the account will be deleted (earliest date the cron may delete it). */
  deleteOn: Date;
  /** Public origin, e.g. https://resumate.example. */
  siteOrigin: string;
};

export type MailContent = { subject: string; text: string; html: string };

const KST_DATE = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "long",
  day: "numeric",
});

export function formatKstDate(date: Date): string {
  return KST_DATE.format(date);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export function buildInactivityNotice({ deleteOn, siteOrigin }: InactivityNoticeInput): MailContent {
  const date = formatKstDate(deleteOn);
  const signInUrl = new URL(ROUTES.login, siteOrigin).toString();
  const subject = `[Resumate] ${date}에 계정이 삭제될 예정입니다`;
  const lines = [
    "안녕하세요, Resumate입니다.",
    "",
    "회원님의 Resumate 계정에 1년 가까이 접속 기록이 없습니다.",
    `개인정보 처리방침에 따라 ${date} 이후 계정과 저장된 모든 데이터(커리어 정보, 자기소개서, 지원 현황, AI 연결 정보)를 파기합니다.`,
    "",
    "계정을 계속 쓰려면 그 전에 한 번 로그인해 주세요. 로그인하면 계정이 그대로 유지됩니다.",
    signInUrl,
    "",
    "계정을 더 쓰지 않으려면 아무것도 하지 않으셔도 됩니다. 파기된 데이터는 복구할 수 없습니다.",
    "",
    "이 메일은 발신 전용 안내입니다. 문의는 개인정보 처리방침의 개인정보 보호책임자 연락처로 보내 주세요.",
  ];
  const text = lines.join("\n");
  const html = [
    "<!doctype html><html lang=\"ko\"><body style=\"font-family:sans-serif;line-height:1.6;color:#111\">",
    ...lines.map((line) =>
      line === signInUrl
        ? `<p><a href="${escapeHtml(signInUrl)}">Resumate 로그인하기</a></p>`
        : line === ""
          ? ""
          : `<p>${escapeHtml(line)}</p>`,
    ),
    "</body></html>",
  ].join("");
  return { subject, text, html };
}
