import { z } from "zod";
import { BlockCompletedEvent, BlockDeltaEvent, BlockStartedEvent, ErrorEvent } from "./ai";
import type { AiFailure } from "./application";
import type { ReadinessFeature } from "./career";
import {
  COUNT_BASES,
  COVER_LETTER_TEMPLATE_KEYS,
  DRAFT_BLOCK_KINDS,
  DRAFT_SECTION_KINDS,
  DRAFT_SECTION_STATUSES,
  DRAFT_SOURCE_ORIGINS,
  DRAFT_SOURCE_ROLES,
  DRAFT_STATUSES,
  DRAFT_TYPES,
  QUESTION_CLASSES,
  RANKING_RELEVANCES,
  SELECTION_ORIGINS,
  SOURCE_SELECTION_MODES,
  type AiJobStatus,
  type AiProvider,
  type ConnectionTier,
  type CountBasis,
  type CoverLetterTemplateKey,
  type DraftBlockKind,
  type DraftSectionKind,
  type DraftSectionStatus,
  type DraftSourceOrigin,
  type DraftSourceRole,
  type DraftStatus,
  type DraftType,
  type ModelTier,
  type QuestionClass,
  type RankingRelevance,
  type SelectionOrigin,
  type SourceSelectionMode,
} from "./enums";
import type { EvidenceChip } from "./evidence";

/**
 * S7 document drafts (F-DOC-01~04, 08, 09; AI-03 / AI-04 / AI-11; DM A.9–A.11,
 * §6.1; UX S-17, S-18, S-19, C-11, FL-03). Shared by the Server Actions, the
 * three Route Handlers, and the frontend.
 *
 * Key rule (D-36, FL-03): only generation needs an AI key. Question setup
 * (S-18), reading, editing, copying, renaming, and deleting work without one.
 */

export {
  COUNT_BASES,
  COVER_LETTER_TEMPLATE_KEYS,
  DRAFT_BLOCK_KINDS,
  DRAFT_SECTION_KINDS,
  DRAFT_SECTION_STATUSES,
  DRAFT_SOURCE_ORIGINS,
  DRAFT_SOURCE_ROLES,
  DRAFT_STATUSES,
  DRAFT_TYPES,
  QUESTION_CLASSES,
  RANKING_RELEVANCES,
  SELECTION_ORIGINS,
  SOURCE_SELECTION_MODES,
};

// ---------- limits ----------

/** drafts.title ≤ 100 [가정 S7-5]. */
export const DRAFT_TITLE_MAX = 100;
/** draft_sections.user_note ≤ 300 (F-DOC-09). */
export const SECTION_NOTE_MAX = 300;
/** Question text cap [가정] (db: 1–1,000). */
export const QUESTION_TEXT_MAX = 1_000;
/** char_limit range [가정] (db: 1–10,000; seed 1,000 공백 포함). */
export const CHAR_LIMIT_MIN = 1;
export const CHAR_LIMIT_MAX = 10_000;
export const DEFAULT_CHAR_LIMIT = 1_000;
/** Cover letter questions per draft (최소 1, F-DOC-02; 상한 [가정] 10). */
export const COVER_LETTER_MIN_QUESTIONS = 1;
export const COVER_LETTER_MAX_QUESTIONS = 10;
/** AI-03 [가정]: at most 8 projects in one career description. */
export const CAREER_DESCRIPTION_MAX_PROJECTS = 8;
/** C-11 사용자 선택: 0–5 sources per question [가정] (db set_section_sources; AI picks 0–2). */
export const COVER_LETTER_MAX_SOURCES = 5;
/** project_detail_ids per source (AI-04 `detail_refs` 1–2; the user may pick a few more [가정]). */
export const SOURCE_DETAIL_IDS_MAX = 5;
/** Edited block text cap [가정] (one block = a bullet or a paragraph). */
export const BLOCK_TEXT_MAX = 5_000;

const Id = z.guid();
const Ids = (max: number) => z.array(Id).max(max);

// ---------- AI-11 default selection: POST /api/application-projects/{id}/draft-source-ranking ----------

/** Body `{ refresh?: boolean }`: `refresh` skips ai_jobs.output reuse (an explicit "AI에게 다시 맡기기"). */
export const DraftSourceRankingInput = z.object({ refresh: z.boolean().optional().default(false) }).strict();
export type DraftSourceRankingInput = z.input<typeof DraftSourceRankingInput>;

/** AI-11 ranking item, aliases resolved to ids (copied to drafts.options.ranking at generation). */
export type DraftSourceRankingItem = {
  projectId: string;
  relevance: RankingRelevance;
  include: boolean;
  requirementIds: string[];
  reason: string;
};

/**
 * 200 `{ data }` (C-6 동기, F-DOC-01 기본 선택; AI-03 트리거 (1)–(3); R1 A23):
 * - `selectionOrigin: 'insight'` — latest ready insight's `strategy.project_priorities` (no AI call).
 * - `selectionOrigin: 'ai_ranking'` — AI-11 result (`reused: true` = same career/requirements hash, no call).
 * - `selectionOrigin: 'user'` + `failed: true` — AI-11 failed or was not possible (A23: no substitute
 *   selection). Every id list is empty: the screen shows the list unchecked, without an error
 *   screen, and the user picks (UX S-17 / C-11). Generation then sends `selectionOrigin: 'user'`.
 * The screen pre-checks the ids of a successful answer; when the user changes them, generation
 * sends `selectionOrigin: 'user'`.
 *
 * Errors: 401, 404, 422 `insufficient_data` (+ readiness, F-AI-06; never calls AI). Everything else
 * (key missing / invalid, provider, schema, JD not extracted or being extracted, ranking already
 * running) is the `failed` answer above. Requirements are never extracted inside this request
 * (A13): the screen runs the extraction route first.
 */
export type DraftSourceRankingResponse = {
  selectionOrigin: SelectionOrigin;
  /** A23: AI-11 failed → empty selection, `selectionOrigin: 'user'`. */
  failed: boolean;
  reused: boolean;
  /** ai_jobs id of the AI-11 run (null for insight / a failure without a call). */
  jobId: string | null;
  /** Insight the priorities came from (selectionOrigin insight). */
  insightId: string | null;
  includedExperienceIds: string[];
  includedEducationIds: string[];
  includedProjectIds: string[];
  /** Project order for the draft (= includedProjectIds order). */
  projectOrder: string[];
  /** AI-11 rankings (selectionOrigin ai_ranking), null otherwise. */
  ranking: DraftSourceRankingItem[] | null;
  /**
   * Why it failed (logs / analytics only; the screen shows nothing): a C-11 code, `key_missing` /
   * `key_invalid` (no AI), `jd_not_extracted`, `extraction_in_progress`, `ranking_in_progress`, or
   * `no_rankable_projects`. Null unless `failed`.
   */
  reason: string | null;
};

// ---------- AI-03 career description: POST /api/application-projects/{id}/career-descriptions (SSE) ----------

/** drafts.options.tone [가정] (AI-03 "간결/상세"). */
export const DRAFT_TONES = ["concise", "detailed"] as const;
export type DraftTone = (typeof DRAFT_TONES)[number];

export const CreateCareerDescriptionInput = z
  .object({
    includedExperienceIds: Ids(50).default([]),
    includedEducationIds: Ids(50).default([]),
    includedProjectIds: Ids(CAREER_DESCRIPTION_MAX_PROJECTS).default([]),
    /** Order of the included projects (JD relevance order); ids not included are ignored. */
    projectOrder: Ids(50).default([]),
    /** Where the checked list came from (C-11 출처 표시); 'user' once the user changed it. */
    selectionOrigin: z.enum(SELECTION_ORIGINS),
    tone: z.enum(DRAFT_TONES).optional(),
    /** "다시 생성" of an existing career description: a new drafts row, the old one is kept (AI-03 저장). */
    regeneratedFromId: Id.optional(),
  })
  .strict()
  .refine((v) => v.includedExperienceIds.length + v.includedEducationIds.length + v.includedProjectIds.length > 0, {
    message: "empty_selection",
  });
export type CreateCareerDescriptionInput = z.input<typeof CreateCareerDescriptionInput>;

// ---------- SSE events (C-6 block events + S7 additions) ----------

/** Generation began: the rows exist (draftId / sectionId) and the job is fixed to this provider (C-19). */
export const GenerationStartedEvent = z.object({
  type: z.literal("generation_started"),
  jobId: z.string(),
  draftId: z.string(),
  /** AI-04 only: the question being generated. */
  sectionId: z.string().nullable(),
  provider: z.string(),
  model: z.string(),
  modelTier: z.string(),
  connectionTier: z.string(),
});

// R1 A13: no `preparing` event — generation never extracts requirements; a JD without them is
// refused before the stream (409 `jd_not_extracted` / `extraction_in_progress`).

/** One chosen source as streamed (AI-04 `sources_selected`; ids, not aliases). */
export const StreamedSourceSchema = z.object({
  sort_order: z.number().int(),
  role: z.enum(DRAFT_SOURCE_ROLES),
  experience_id: z.string().nullable(),
  education_id: z.string().nullable(),
  project_id: z.string().nullable(),
  project_detail_ids: z.array(z.string()),
  /** "회사명 › 프로젝트명". */
  label: z.string(),
  rationale: z.string(),
  reuse_reason: z.string().nullable(),
  requirement_ids: z.array(z.string()),
});

/** AI-04: the sources were chosen (C-11 cards before the body). Once per generation. */
export const SourcesSelectedEvent = z.object({
  type: z.literal("sources_selected"),
  sectionId: z.string(),
  selectionMode: z.enum(SOURCE_SELECTION_MODES),
  questionClass: z.enum(QUESTION_CLASSES).nullable(),
  sources: z.array(StreamedSourceSchema),
});

/** AI-04: outside ±10% of the limit (or unsupported numbers); one adjustment call runs (C-6 `adjust_length`). */
export const AdjustingLengthEvent = z.object({
  type: z.literal("adjusting_length"),
  sectionId: z.string(),
  charCount: z.number().int(),
  charLimit: z.number().int(),
  countBasis: z.enum(COUNT_BASES),
  reasons: z.array(z.enum(["length", "numbers"])),
});

/**
 * Block id rule (ai notes): `block_started` / `block_completed.blockId` is the MODEL's id; the stored
 * ids can differ (server re-ids, header blocks are added). On `validated` the client REPLACES every
 * streamed block with `validated.result` (and later getDraft) — never merge by streamed id.
 *
 * `block_completed.block` of AI-03 / AI-04 (ai streaming notes): the block after block-level checks,
 * with its evidence as stream chips (ids; no link row yet). Numbers are settled at `validated`.
 */
export type StreamedDraftBlock = {
  block_id: string;
  block_kind: DraftBlockKind;
  project_id: string | null;
  text: string;
  requirement_ids: string[];
  placeholders: Array<{ token: string; hint?: string | null }>;
  flags: string[];
  evidence: Array<{
    source_type: string;
    source_id: string;
    source_field: string | null;
    quote: string | null;
    quote_adjusted: boolean;
    source_label: string | null;
    source_locator: unknown;
  }>;
};

/**
 * Final: saved (after `validated`, which carries the stored content). The screen may reload the
 * draft (getDraft) for the stored view with C-01 chip states.
 */
export const DraftDoneEvent = z.object({
  type: z.literal("done"),
  draftId: z.string(),
  /** AI-03: an identical ready draft already existed (same input_hash, C-6 재사용) — no provider call, open it. */
  reused: z.boolean(),
  sectionId: z.string().nullable(),
  meta: z.object({ promptVersion: z.string(), model: z.string(), resultId: z.string().nullable() }),
});

export const DraftValidatedEvent = z.object({
  type: z.literal("validated"),
  result: z.unknown(),
  validationReport: z.unknown(),
});

export const DraftStreamEventSchema = z.discriminatedUnion("type", [
  GenerationStartedEvent,
  SourcesSelectedEvent,
  BlockStartedEvent,
  BlockDeltaEvent,
  BlockCompletedEvent,
  DraftValidatedEvent,
  AdjustingLengthEvent,
  DraftDoneEvent,
  ErrorEvent,
]);
export type DraftStreamEvent = z.infer<typeof DraftStreamEventSchema>;
export const DRAFT_STREAM_EVENT_TYPES = [
  "generation_started",
  "sources_selected",
  "block_started",
  "block_delta",
  "block_completed",
  "validated",
  "adjusting_length",
  "done",
  "error",
] as const satisfies readonly DraftStreamEvent["type"][];
export const DRAFT_STREAM_TERMINAL_EVENTS = ["done", "error"] as const;

/** 422 body of the generation routes (same as S6 insight). */
export type DraftInsufficientDataResponse = {
  error: { code: "insufficient_data"; message: string };
  readiness: ReadinessFeature;
};

// ---------- AI-04 cover letter: actions + POST /api/draft-sections/{id}/generate (SSE) ----------

export const CreateCoverLetterDraftInput = z.object({ applicationProjectId: Id }).strict();
export type CreateCoverLetterDraftInput = z.input<typeof CreateCoverLetterDraftInput>;

const QuestionText = z.string().trim().min(1).max(QUESTION_TEXT_MAX);
const CharLimit = z.number().int().min(CHAR_LIMIT_MIN).max(CHAR_LIMIT_MAX);
const Note = z.string().max(SECTION_NOTE_MAX);

export const AddCoverLetterQuestionInput = z
  .object({
    draftId: Id,
    questionText: QuestionText,
    charLimit: CharLimit.nullable().optional(),
    countBasis: z.enum(COUNT_BASES).optional(),
    userNote: Note.nullable().optional(),
  })
  .strict();
export type AddCoverLetterQuestionInput = z.input<typeof AddCoverLetterQuestionInput>;

/** Question / memo / limit edit (S-18, F-DOC-02/09). `template_key` stays (문구만 수정). Omitted = unchanged. */
export const UpdateCoverLetterQuestionInput = z
  .object({
    sectionId: Id,
    questionText: QuestionText.optional(),
    charLimit: CharLimit.nullable().optional(),
    countBasis: z.enum(COUNT_BASES).optional(),
    userNote: Note.nullable().optional(),
  })
  .strict();
export type UpdateCoverLetterQuestionInput = z.input<typeof UpdateCoverLetterQuestionInput>;

export const DeleteCoverLetterQuestionInput = z.object({ sectionId: Id }).strict();
export type DeleteCoverLetterQuestionInput = z.input<typeof DeleteCoverLetterQuestionInput>;

/** Full new order of the draft's questions (every question exactly once). */
export const ReorderCoverLetterQuestionsInput = z.object({ draftId: Id, sectionIds: z.array(Id).min(1).max(COVER_LETTER_MAX_QUESTIONS) }).strict();
export type ReorderCoverLetterQuestionsInput = z.input<typeof ReorderCoverLetterQuestionsInput>;

/** One user-picked source (C-11 체크 트리): a project (+ its affiliation) or an experience / education alone. */
export const SectionSourceInput = z
  .object({
    projectId: Id.nullable().optional(),
    experienceId: Id.nullable().optional(),
    educationId: Id.nullable().optional(),
    projectDetailIds: Ids(SOURCE_DETAIL_IDS_MAX).optional(),
    role: z.enum(DRAFT_SOURCE_ROLES).optional(),
    /** 관련 요건 (this project's JD requirements only). */
    requirementIds: Ids(50).optional(),
  })
  .strict()
  .refine((s) => Boolean(s.projectId || s.experienceId || s.educationId), { message: "empty_source" })
  .refine((s) => !(s.experienceId && s.educationId), { message: "one_affiliation" });

/** C-11 변경: replaces the list with `origin = 'user'` rows; `[]` = 모두 제외 (after the warning). */
export const SetSectionSourcesInput = z.object({ sectionId: Id, sources: z.array(SectionSourceInput).max(COVER_LETTER_MAX_SOURCES) }).strict();
export type SetSectionSourcesInput = z.input<typeof SetSectionSourcesInput>;

/** Body of `POST /api/draft-sections/{id}/generate`: none needed. `{}` or empty. */
export const GenerateSectionInput = z.object({}).strict();

// ---------- edit / copy / rename / delete (F-DOC-04, no key) ----------

export const EditedBlockInput = z
  .object({
    blockId: z.string().min(1).max(64),
    text: z.string().max(BLOCK_TEXT_MAX),
  })
  .strict();

/**
 * Save the edited blocks of one section (S-19). `blocks` is the whole edited list in display
 * order; every `blockId` must be one of the section's AI blocks (block ids are kept, AI-03 저장).
 * Blocks whose text differs from the AI original are marked `user_modified`.
 */
export const SaveSectionEditInput = z.object({ sectionId: Id, blocks: z.array(EditedBlockInput).max(200) }).strict();
export type SaveSectionEditInput = z.input<typeof SaveSectionEditInput>;

export const DraftIdInput = z.object({ draftId: Id }).strict();
export type DraftIdInput = z.input<typeof DraftIdInput>;

export const RenameDraftInput = z.object({ draftId: Id, title: z.string().trim().min(1).max(DRAFT_TITLE_MAX) }).strict();
export type RenameDraftInput = z.input<typeof RenameDraftInput>;

export const ListDraftsInput = z.object({ applicationProjectId: Id }).strict();
export type ListDraftsInput = z.input<typeof ListDraftsInput>;

export const GetDraftInput = z.object({ draftId: Id }).strict();
export type GetDraftInput = z.input<typeof GetDraftInput>;

// ---------- read views ----------

/** C-19 result badge (F-AI-09): who made it. Null fields = not generated yet. */
export type DraftProviderBadge = {
  provider: AiProvider | null;
  model: string | null;
  modelTier: ModelTier | null;
  connectionTier: ConnectionTier | null;
};

/** S-17 row. */
export type DraftListItem = {
  id: string;
  draftType: DraftType;
  title: string;
  status: DraftStatus;
  /** Cover letter: number of questions / ready questions. Career description: sections. */
  sectionCount: number;
  readySectionCount: number;
  selectionOrigin: SelectionOrigin | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  firstCopiedAt: string | null;
  regeneratedFromId: string | null;
  badge: DraftProviderBadge;
  /** An AI job generating this draft (or one of its questions) right now. */
  generating: boolean;
};

export type DraftList = {
  applicationProjectId: string;
  /** Newest first. */
  drafts: DraftListItem[];
};

export type DraftPlaceholder = { token: string; hint: string | null };

/** One block as the editor shows it: edited text first, AI original kept (A.10). */
export type DraftBlockView = {
  blockId: string;
  blockKind: DraftBlockKind;
  projectId: string | null;
  /** Edited text when the user changed it, else the AI text. */
  text: string;
  /** AI original (unchangeable). Null for a block only the edited list has (never in MVP). */
  aiText: string | null;
  userModified: boolean;
  requirementIds: string[];
  placeholders: DraftPlaceholder[];
  /** `evidence_check_needed`, `number_check_needed`, … (C-3 / V-4 / V-5). */
  flags: string[];
  /** Header blocks are filled by the server from career data (no evidence). */
  generatedBy: string | null;
  /** C-01 chips (`item_key = block_id`). "편집됨 — 근거 재확인 권장" when `userModified`. */
  evidence: EvidenceChip[];
};

/** C-11 one source row ("회사명 또는 기관명 › 프로젝트명 › 상세 내용 제목"). */
export type DraftSectionSourceView = {
  id: string;
  experienceId: string | null;
  educationId: string | null;
  projectId: string | null;
  projectDetailIds: string[];
  /** Current names (null when the row is gone; then `sourceLabel` is shown). */
  affiliationName: string | null;
  projectName: string | null;
  detailTitles: string[];
  role: DraftSourceRole;
  origin: DraftSourceOrigin;
  rationale: string | null;
  requirementIds: string[];
  reuseReason: string | null;
  sortOrder: number;
  sourceLabel: string | null;
  sourceDeletedAt: string | null;
  /** Evidence quoted for this choice (`item_key = sources.{n}`). */
  evidence: EvidenceChip[];
};

export type DraftSectionView = {
  id: string;
  sortOrder: number;
  sectionKind: DraftSectionKind;
  status: DraftSectionStatus;
  experienceId: string | null;
  educationId: string | null;
  heading: string | null;
  // cover letter question fields (null for career description sections)
  questionText: string | null;
  templateKey: CoverLetterTemplateKey | null;
  charLimit: number | null;
  countBasis: CountBasis | null;
  userNote: string | null;
  sourceSelectionMode: SourceSelectionMode | null;
  sourcesModifiedAt: string | null;
  generationNo: number;
  questionClass: QuestionClass | null;
  aiCharCount: number | null;
  /** Characters of the shown text (edited first) by `count_basis`. */
  currentCharCount: number | null;
  correctionApplied: boolean;
  /** Section-level flags from the validation report (e.g. `char_adjust_needed`). */
  flags: string[];
  notesForUser: string[];
  blocks: DraftBlockView[];
  sources: DraftSectionSourceView[];
  edited: boolean;
  badge: DraftProviderBadge;
  updatedAt: string;
};

/** The AI job running for this draft / question now (C-03). */
export type DraftActiveJob = {
  jobId: string;
  jobType: "career_description" | "cover_letter";
  sectionId: string | null;
  status: Extract<AiJobStatus, "queued" | "running">;
  provider: AiProvider;
  connectionTier: ConnectionTier;
};

/**
 * The last failed generation after the shown content (C-20). "다시 시도" = call the generation route
 * again (career description → a new draft; question → the same question). The generic
 * `POST /api/ai-jobs/{jobId}/retry` answers 409 `ai_job_not_retryable` for these jobs (QA-S7-02).
 */
export type DraftFailure = AiFailure & { jobId: string; sectionId: string | null; failedAt: string | null };

export type DraftOptionsView = {
  includedExperienceIds: string[];
  includedEducationIds: string[];
  includedProjectIds: string[];
  projectOrder: string[];
  selectionOrigin: SelectionOrigin | null;
  tone: DraftTone | null;
  ranking: DraftSourceRankingItem[] | null;
};

/** S-19 editor. */
export type DraftView = {
  id: string;
  applicationProjectId: string;
  draftType: DraftType;
  title: string;
  status: DraftStatus;
  options: DraftOptionsView | null;
  insightId: string | null;
  regeneratedFromId: string | null;
  createdAt: string;
  updatedAt: string;
  editedAt: string | null;
  firstCopiedAt: string | null;
  badge: DraftProviderBadge;
  sections: DraftSectionView[];
  activeJobs: DraftActiveJob[];
  failures: DraftFailure[];
};

// ---------- action results ----------

export type CoverLetterQuestionResult = { draftId: string; section: DraftSectionView };
export type DeleteQuestionResult = { draftId: string; sectionId: string; remaining: number };
export type ReorderQuestionsResult = { draftId: string; sectionIds: string[] };
export type SaveSectionEditResult = { sectionId: string; draftId: string; editedAt: string; blocks: DraftBlockView[] };
export type MarkDraftCopiedResult = { draftId: string; firstCopiedAt: string };
export type RenameDraftResult = { draftId: string; title: string; updatedAt: string };
export type DeleteDraftResult = { draftId: string; deleted: true };

export type { CountBasis, CoverLetterTemplateKey, DraftBlockKind, DraftSectionKind, DraftSectionStatus, DraftSourceOrigin, DraftSourceRole, DraftStatus, DraftType, QuestionClass, RankingRelevance, SelectionOrigin, SourceSelectionMode };
