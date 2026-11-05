/**
 * 개선 요청 (S-24 ④ 개선 요청 탭, PRD F-COM-11, DM 2.1.6 — SD-3).
 *
 * 서비스는 내용을 받지도, 보낸 내역을 보여 주지도 않는다: 테이블·컬럼·RPC가 없고
 * **외부 폼으로 나가는 링크 하나**뿐이다. 주소는 env 하나(`NEXT_PUBLIC_FEEDBACK_FORM_URL`)에
 * 두고 DB에 두지 않는다. 주소는 `[결정 필요]` SD-Q1 — 비어 있으면 화면은 "준비 중"이다.
 *
 * Client-safe: `NEXT_PUBLIC_*` is a literal property access so Next.js inlines it
 * at build time (클라이언트 컴포넌트에서 `@/server/env`를 쓰면 안 된다).
 */

/** 외부 폼 주소, 미정이면 null. */
export const FEEDBACK_FORM_URL: string | null = process.env.NEXT_PUBLIC_FEEDBACK_FORM_URL?.trim() || null;

/** false면 화면은 링크 대신 "준비 중"(비활성 버튼)을 보인다 (UX S-24 ④). */
export const IS_FEEDBACK_FORM_READY: boolean = FEEDBACK_FORM_URL !== null;
