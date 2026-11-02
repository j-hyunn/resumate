/**
 * 커리어 data layer v4.4 (DM §2.3–2.4, §7 v4.4; UX v5.5 S-08 2단 · S-09 · S-34 · S-43 · S-44 · S-10 머리/STAR).
 * Server only — Server Components or server actions. 연결 대기: the reworked screens (resumate-ui) import
 * these; the current screens still use `./career` (v4.3b shims). No `?state=` mock branch yet: the mock
 * store is still the v4.3b model (UI rework adds the previews).
 */
import "server-only"
import type { z } from "zod"
import {
  CreateProjectInput,
  ReorderDeliverablesInput,
  SaveDeliverableInput,
  SaveProjectInput,
  type CareerListDto,
  type DeliverableDetailDto,
  type EducationDetailDto,
  type ExperienceDetailDto,
  type ProjectDetailDto,
  type SaveResult,
  type StandaloneProjectDetailDto,
} from "@/lib/contracts/career"
import { AppError, invalid } from "@/lib/contracts/errors"
import { requireConsentedUser } from "@/server/auth/session"
import { wasRowDeleted } from "@/server/auth/user-cookies"
import * as career from "@/server/services/career"
import type { DeliverableSaveResult } from "@/server/services/career/save"
import { unwrap } from "./source"

function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const parsed = schema.safeParse(input)
  if (!parsed.success) unwrap(invalid(parsed.error))
  return parsed.data as z.output<S>
}

// ---------------- reads ----------------

/** S-08 left list (CR-4): experiences, educations, standalone projects once under their start year. */
export async function getCareerList(): Promise<CareerListDto> {
  const { supabase } = await requireConsentedUser()
  return career.getCareerList(supabase)
}

/** S-09 panel: experience + project cards. null = not found. */
export async function getExperiencePanel(id: string): Promise<ExperienceDetailDto | null> {
  const { supabase } = await requireConsentedUser()
  return career.getExperienceDetail(supabase, id)
}

/** S-34 panel: education + project cards. */
export async function getEducationPanel(id: string): Promise<EducationDetailDto | null> {
  const { supabase } = await requireConsentedUser()
  return career.getEducationDetail(supabase, id)
}

/** S-43 panel: standalone project + skills + deliverables. null for an affiliated id (open S-10). */
export async function getStandaloneProject(id: string): Promise<StandaloneProjectDetailDto | null> {
  const { supabase } = await requireConsentedUser()
  return career.getStandaloneProjectDetail(supabase, id)
}

/** S-10 page: affiliated project + parent + chat history. null for a standalone id (open S-08 `?item=project:`). */
export async function getProjectPage(id: string): Promise<ProjectDetailDto | null> {
  const { supabase } = await requireConsentedUser()
  return career.getProjectDetail(supabase, id)
}

/** S-44. */
export async function getDeliverable(id: string): Promise<DeliverableDetailDto | null> {
  const { supabase } = await requireConsentedUser()
  return career.getDeliverable(supabase, id)
}

// ---------------- writes ----------------

/**
 * C-23 "프로젝트 추가" (CR-6): `{ id?, name, affiliation }` → draft project. A retried create with the
 * same client id returns the same row; a client id of a row this browser deleted → `not_found` (QA-W5-06).
 */
export async function createProject(input: z.input<typeof CreateProjectInput>): Promise<SaveResult> {
  const { supabase, user } = await requireConsentedUser()
  const parsed = parseInput(CreateProjectInput, input)
  if (parsed.id && (await wasRowDeleted(user.id, parsed.id))) throw new AppError("not_found")
  return career.createProject(supabase, parsed)
}

/** C-24 section save for S-10 (머리 / one STAR field) and S-43 (정보 / 내용). Update only. */
export async function saveProjectSection(input: z.input<typeof SaveProjectInput>): Promise<SaveResult> {
  const { supabase } = await requireConsentedUser()
  return career.saveProject(supabase, parseInput(SaveProjectInput, input))
}

/** S-44 save (create: projectId + title; then updates with expectedUpdatedAt). */
export async function saveDeliverable(input: z.input<typeof SaveDeliverableInput>): Promise<DeliverableSaveResult> {
  const { supabase } = await requireConsentedUser()
  return career.saveDeliverable(supabase, parseInput(SaveDeliverableInput, input))
}

/** S-43 deliverable order ([가정] — only if the screen gets a reorder UI). */
export async function reorderDeliverables(input: z.input<typeof ReorderDeliverablesInput>): Promise<void> {
  const { supabase } = await requireConsentedUser()
  await career.reorderProjectDeliverables(supabase, parseInput(ReorderDeliverablesInput, input))
}
