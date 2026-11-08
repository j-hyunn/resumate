import { EVIDENCE_OWNER_TYPES, EVIDENCE_SOURCE_TYPES, type EvidenceOwnerType, type EvidenceSourceType } from "./enums";

/**
 * C-01 evidence chip / C-02 evidence panel read shape (UX v5, AI C-3, DM §2.8,
 * A.14). One chip = one `evidence_links` row plus the current state of its
 * source. Shared by insights (S6), drafts (S7), and chat messages.
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
  project_deliverable: "산출물",
  skill: "스킬",
  jd_requirement: "JD 요건",
  jd_sentence: "공고 원문",
  user_note: "내 메모",
};

/**
 * C-01 `project` field labels (DM v4.4 2.8, CR-2): "프로젝트 · 행동". `learnings` reads "배운 점"
 * alone (the user's reflection, NFR-AI-06). name / period stay "프로젝트".
 */
export const PROJECT_FIELD_LABELS: Record<string, string> = {
  situation: "상황",
  task: "역할",
  action: "행동",
  result: "결과/성과",
  learnings: "배운 점",
  role: "담당 업무",
  description: "프로젝트 내용",
};

/**
 * Where "원본으로 이동" goes (C-02). Ids only; the screen builds the route.
 * `project` → S-10 (affiliated, STAR section focus) or S-08 `?item=project:` (standalone, S-43);
 * `project_deliverable` → S-44; `education` → S-34.
 */
export type EvidenceTarget =
  | { type: "profile" }
  | { type: "experience"; experienceId: string }
  | { type: "education"; educationId: string }
  | { type: "project"; projectId: string; field: string | null; standalone: boolean | null }
  | { type: "project_deliverable"; deliverableId: string; projectId: string | null }
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
   * C-01 chip label: kind (+ STAR field for projects), e.g. "프로젝트 · 행동".
   * A `learnings` chip reads "배운 점" (CR-2, no extra marker).
   */
  kindLabel: string;
  /** Name of the source at generation time (`source_label`). */
  sourceLabel: string | null;
  /** Quote kept with the evidence; null after the source was deleted (D-AI-04 (b)). */
  quote: string | null;
  quoteAdjusted: boolean;
  /** `project.learnings` evidence (C-9, NFR-AI-06, V-8). */
  isReflection: boolean;
  state: EvidenceSourceState;
  sourceSnapshotAt: string | null;
  sourceDeletedAt: string | null;
  /** Null when the source is deleted (no navigation, C-02). */
  target: EvidenceTarget | null;
};
