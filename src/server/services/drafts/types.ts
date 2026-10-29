import type { AiProvider, ModelTier } from "@/lib/contracts/enums";
import type { CareerRows } from "@/server/ai/context-pack/career-rows";
import type { JdRequirementInput, JdSentence } from "@/server/ai/context-pack/jd";
import type { Llm } from "@/server/ai/llm";
import type { AiWriterSupabaseClient, UserSupabaseClient } from "@/server/db/types";
import type { EnsureJdResult } from "@/server/services/application/extraction";
import type { ReadinessFeature } from "@/lib/contracts/career";
import type { AiRunDeps } from "./ai-run";
import type { DraftStore, InsightSignal } from "./db";

/**
 * Interfaces of the S7 draft services. The services depend only on these;
 * `src/server/jobs/drafts.ts` wires them to Supabase and the ai-pipeline
 * functions (AI-11 / AI-03 / AI-04, ai notes "api-engineer용 시그니처"), tests
 * use fakes. Ids, not aliases, cross this boundary.
 */

/** AI-11 `RankingItem` (ids; drafts.options.ranking copy). */
export type RankingItemRow = {
  project_id: string;
  relevance: "high" | "medium" | "low";
  include: boolean;
  requirement_ids: string[];
  reason: string;
};

export type DraftSourceSelection = {
  includedProjectIds: string[];
  projectOrder: string[];
  includedExperienceIds: string[];
  includedEducationIds: string[];
};

/** Opaque per pipeline; the service only reads the two hashes. */
export type HashedContext = { careerSnapshotHash: string; requirementsHash: string };

export type PipelineCallDeps = { llm: Llm; signal: AbortSignal; jobId: string; callKey: string };

export interface RankingPipeline {
  tier: ModelTier;
  promptVersion: string;
  buildContext(input: { careerRows: CareerRows; jobDescriptionId: string; requirements: readonly JdRequirementInput[] }): HashedContext;
  inputHash(parts: { provider: AiProvider; model: string; careerSnapshotHash: string; requirementsHash: string }): string;
  rank(context: HashedContext, deps: PipelineCallDeps): Promise<DraftSourceSelection & { ranking: RankingItemRow[]; output: unknown; promptVersion: string; model: string }>;
  /** Reuse path: a stored ai_jobs.output → selection for the current pack (null = unreadable output). */
  fromOutput(output: unknown, careerRows: CareerRows): (DraftSourceSelection & { ranking: RankingItemRow[] }) | null;
  fromInsight(priorities: readonly { project_id: string; rank: number }[], careerRows: CareerRows): DraftSourceSelection;
  fallback(careerRows: CareerRows): DraftSourceSelection;
}

/** drafts.options (db Options shape). */
export type DraftOptionsRow = {
  included_experience_ids: string[];
  included_education_ids: string[];
  included_project_ids: string[];
  project_order: string[];
  selection_origin: "insight" | "ai_ranking" | "user";
  ranking: RankingItemRow[] | null;
  tone: "concise" | "detailed" | null;
};

export type CareerDescriptionPlan = {
  options: DraftOptionsRow;
  sections: Array<{
    sort_order: number;
    section_kind: "experience" | "education" | "standalone_projects";
    experience_id: string | null;
    education_id: string | null;
    heading: string;
    project_ids: string[];
  }>;
  truncatedProjectIds: string[];
};

/** Events a streaming draft pipeline yields (ai `S7StreamEvent`). */
export type PipelineStreamEvent = { type: string } & Record<string, unknown>;

export type StreamDeps = PipelineCallDeps & { persist: (payload: unknown) => Promise<{ resultId: string | null }> };

export interface CareerDescriptionPipeline {
  tier: ModelTier;
  promptVersion: string;
  plan(input: { careerRows: CareerRows; options: DraftOptionsRow }): CareerDescriptionPlan;
  buildContext(input: {
    careerRows: CareerRows;
    plan: CareerDescriptionPlan;
    jobDescriptionId: string;
    requirements: readonly JdRequirementInput[];
    insightSignal: { positioning: string | null; projectPriorities: InsightSignal["projectPriorities"]; requirementStatuses: InsightSignal["requirementStatuses"] } | null;
  }): HashedContext;
  inputHash(parts: { provider: AiProvider; model: string; careerSnapshotHash: string; requirementsHash: string; options: DraftOptionsRow }): string;
  stream(input: { context: HashedContext; sections: ReadonlyArray<{ section_id: string; sort_order: number }> }, deps: StreamDeps): AsyncIterable<PipelineStreamEvent>;
}

export type CoverLetterQuestionInput = {
  section_id: string;
  question_text: string;
  template_key: "motivation" | "job_competency" | "future_plan" | null;
  char_limit: number | null;
  count_basis: "with_spaces" | "without_spaces";
  user_note: string | null;
  user_note_updated_at?: string | null;
};

export type UserSourceInput = {
  experience_id: string | null;
  education_id: string | null;
  project_id: string | null;
  project_detail_ids: string[];
  role: "primary" | "supporting";
};

export interface CoverLetterPipeline {
  tier: ModelTier;
  promptVersion: string;
  buildContext(input: {
    careerRows: CareerRows;
    jobDescriptionId: string;
    jobDescriptionUpdatedAt: string | null;
    sentences: readonly JdSentence[];
    companySids: readonly string[];
    requirements: readonly JdRequirementInput[];
    positionTitle: string | null;
    question: CoverLetterQuestionInput;
    mode: "ai" | "user";
    userSources: UserSourceInput[];
    otherSections: Array<{ question_text: string; primary_project_ids: string[] }>;
    insightSignal: { strengths: InsightSignal["strengths"]; positioning: string | null } | null;
  }): HashedContext;
  inputHash(parts: {
    provider: AiProvider;
    model: string;
    careerSnapshotHash: string;
    requirementsHash: string;
    question: Omit<CoverLetterQuestionInput, "section_id" | "user_note_updated_at">;
    mode: "ai" | "user";
    userSources: UserSourceInput[];
  }): string;
  stream(input: { context: HashedContext }, deps: StreamDeps & { adjustCallKey: string }): AsyncIterable<PipelineStreamEvent>;
}

export type DraftPipelines = {
  ranking: RankingPipeline;
  careerDescription: CareerDescriptionPipeline;
  coverLetter: CoverLetterPipeline;
};

/** Everything an S7 AI path needs. */
export type DraftAiDeps = AiRunDeps & {
  /** User session (RLS): ownership, readiness, reads before the stream. */
  user: UserSupabaseClient;
  /** app_ai_writer of this user: reads inside the run, ai_jobs.output, RPCs. */
  writer: AiWriterSupabaseClient;
  drafts: DraftStore;
  pipelines: DraftPipelines;
  /** D-30 extraction (S5 `ensureJdExtracted` with this user's deps). */
  ensureJd: (applicationProjectId: string, signal?: AbortSignal) => Promise<EnsureJdResult>;
  loadCareerRows: (db: UserSupabaseClient | AiWriterSupabaseClient) => Promise<CareerRows>;
  getReadiness?: (db: UserSupabaseClient) => Promise<{ features: { draft: ReadinessFeature } }>;
};
