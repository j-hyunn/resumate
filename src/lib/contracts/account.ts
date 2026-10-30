import { z } from "zod";

/**
 * Account contracts — S-25 회원 탈퇴 (F-COM-05, FL-07, DM §4.3, NFR-PRV-06,
 * NFR-KEY-06 / -09, D-11, D-DM-02).
 */

// ---------------- summary (S-25 삭제 범위) ----------------

/** Counts from RPC `get_account_deletion_summary()` (DM §4.3), grouped like S-25. */
export type AccountDeletionSummary = {
  career: {
    experiences: number;
    educations: number;
    projects: number;
    projectDetails: number;
    achievements: number;
    skills: number;
    writingChats: number;
  };
  applications: {
    applicationProjects: number;
    insights: number;
    drafts: number;
    interviewSessions: number;
    stageEvents: number;
  };
  aiConnection: {
    providerKeys: number;
    dataUseConsents: number;
    usageRecords: number;
  };
  /**
   * NFR-KEY-09: true when the user has at least one registered key — S-25 then
   * shows "공급자 사이트에서도 키를 폐기하는 것을 권해요". Never carries a key or
   * any part of it.
   */
  recommendProviderKeyRevocation: boolean;
};

// ---------------- delete (FL-07) ----------------

/**
 * S-25 confirmation. FL-07 says only "확인 문구" without a typed phrase, so the
 * screen sends an explicit check flag ([가정] S9 plan 4, spec-gaps 2026-11-04 · S9 (api)).
 */
export const DeleteAccountInput = z.object({ confirm: z.literal(true) }).strict();
export type DeleteAccountInput = z.input<typeof DeleteAccountInput>;

/** After success the session cookies are cleared; the screen moves to S-01 (`redirectTo`). */
export type DeleteAccountResult = {
  deleted: true;
  /** In-flight AI jobs a cancel was requested for before the delete. */
  canceledJobs: number;
  redirectTo: string;
};

/** S-01 landing (public). FL-07: "즉시 로그아웃 → S-01". */
export const ACCOUNT_DELETED_REDIRECT = "/" as const;
