import { EVIDENCE_OWNER_TYPES, EVIDENCE_SOURCE_TYPES, type EvidenceOwnerType, type EvidenceSourceType } from "./enums";

/**
 * C-01 evidence chip / C-02 evidence panel read shape (UX v5, AI C-3, DM §2.8,
 * A.14). One chip = one `evidence_links` row plus the current state of its
 * source. Shared by insights (S6), drafts (S7), and interview results (S8).
 */

export { EVIDENCE_OWNER_TYPES, EVIDENCE_SOURCE_TYPES };
export type { EvidenceOwnerType, EvidenceSourceType };

/**
 * C-01 상태: `current` 정상 / `changed` 변경됨 (source `updated_at` >
 * `source_snapshot_at`) / `deleted` 원본 삭제됨 (`source_deleted_at`, or the
 * source row no longer exists). `jd_sentence` is always `current`.
 */
export const EVIDENCE_SOURCE_STATES = ["current", "changed", "deleted"] as const;
export type EvidenceSourceState = (typeof EVIDENCE_SOURCE_STATES)[number];

/** C-01 chip kind label by source type (Korean, screen copy). */
export const EVIDENCE_KIND_LABELS: Record<EvidenceSourceType, string> = {
  profile: "기본 프로필",
  experience: "경력",
  education: "교육",
  project: "프로젝트",
  project_detail: "상세 내용",
  achievement: "정량 성과",
  skill: "스킬",
  jd_requirement: "JD 요건",
  jd_sentence: "공고 원문",
  interview_answer: "내 답변",
  user_note: "내 메모",
};

/** C-01 `project_detail` field labels ("상세 내용 · 행동"). */
export const PROJECT_DETAIL_FIELD_LABELS: Record<string, string> = {
  title: "제목",
  situation: "상황",
  task: "과제",
  action: "행동",
  result: "결과",
  learnings: "회고 및 배운 점",
};

/**
 * Where "원본으로 이동" goes (C-02). Ids only; the screen builds the route.
 * `project_detail` → S-35 field focus, `achievement` → S-11, `education` → S-34.
 */
export type EvidenceTarget =
  | { type: "profile" }
  | { type: "experience"; experienceId: string }
  | { type: "education"; educationId: string }
  | { type: "project"; projectId: string }
  | { type: "project_detail"; projectId: string; projectDetailId: string; field: string | null }
  | { type: "achievement"; achievementId: string; projectDetailId: string | null; projectId: string | null; experienceId: string | null }
  | { type: "skill"; skillId: string }
  | { type: "jd_requirement"; requirementId: string }
  | { type: "jd_sentence"; jobDescriptionId: string; sid: string | null; start: number | null; end: number | null }
  | { type: "other"; sourceId: string };

export type EvidenceChip = {
  id: string;
  /** `item_key` of the result item the chip belongs to (C-01). */
  itemKey: string;
  sortOrder: number;
  sourceType: EvidenceSourceType;
  sourceId: string;
  sourceField: string | null;
  /**
   * C-01 chip label: kind (+ STAR field for project details), e.g. "상세 내용 · 행동".
   * A `learnings` chip reads "회고 및 배운 점" (U-2, no extra marker).
   */
  kindLabel: string;
  /** Name of the source at generation time (`source_label`). */
  sourceLabel: string | null;
  /** Quote kept with the evidence; null after the source was deleted (D-AI-04 (b)). */
  quote: string | null;
  quoteAdjusted: boolean;
  /** `project_detail.learnings` evidence (C-9, NFR-AI-06). */
  isReflection: boolean;
  state: EvidenceSourceState;
  sourceSnapshotAt: string | null;
  sourceDeletedAt: string | null;
  /** Null when the source is deleted (no navigation, C-02). */
  target: EvidenceTarget | null;
};
