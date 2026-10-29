import { z } from "zod";
import { DraftRef, DraftRefs, NotesForUser, TextBlockOutputSchema } from "./drafts-common";

/**
 * AI-03 경력기술서 model output, schema_version 1 (card "출력 스키마"). The
 * model writes no headers (server fills them). Canonical form: every key
 * present, absent = null; depth: root → section → project → bullet → evidence = 5.
 */
export const AI03_OUTPUT_SCHEMA_VERSION = 1;

export const OMITTED_REASONS = ["user_excluded", "low_relevance"] as const;

export const Ai03BulletSchema = TextBlockOutputSchema.extend({ requirement_refs: DraftRefs });

export const Ai03ProjectSchema = z.object({
  project_ref: DraftRef,
  role_line: TextBlockOutputSchema.nullable(),
  bullets: z.array(Ai03BulletSchema).max(10),
});

export const Ai03SectionSchema = z.object({
  experience_ref: DraftRef,
  summary: TextBlockOutputSchema.nullable(),
  projects: z.array(Ai03ProjectSchema).max(20),
});

export const Ai03EducationSectionSchema = z.object({
  education_ref: DraftRef,
  summary: TextBlockOutputSchema.nullable(),
  projects: z.array(Ai03ProjectSchema).max(20),
});

export const Ai03OutputSchema = z.object({
  schema_version: z.literal(AI03_OUTPUT_SCHEMA_VERSION),
  draft_type: z.literal("career_description"),
  sections: z.array(Ai03SectionSchema).max(20),
  education_sections: z.array(Ai03EducationSectionSchema).max(20),
  standalone_projects: z.array(Ai03ProjectSchema).max(20),
  omitted: z.array(z.object({ ref: DraftRef, reason: z.enum(OMITTED_REASONS) })).max(50),
  notes_for_user: NotesForUser,
});

export type Ai03Output = z.infer<typeof Ai03OutputSchema>;
export type Ai03Project = z.infer<typeof Ai03ProjectSchema>;
export type Ai03Bullet = z.infer<typeof Ai03BulletSchema>;
