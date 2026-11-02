import { z } from "zod";
import { RANKING_RELEVANCES } from "@/lib/contracts/enums";

/**
 * AI-11 경력기술서 기본 선택 model output, schema_version 1 (card "출력 스키마").
 * Count caps are generous so an over-producing model still parses (V-6);
 * the server keeps at most 8 included projects.
 */
export const AI11_OUTPUT_SCHEMA_VERSION = 1;

export const Ai11RankingSchema = z.object({
  project_ref: z.string().max(20),
  relevance: z.enum(RANKING_RELEVANCES),
  include: z.boolean(),
  requirement_refs: z.array(z.string().max(20)).max(20),
  reason: z.string().max(300),
});

export const Ai11OutputSchema = z.object({
  schema_version: z.literal(AI11_OUTPUT_SCHEMA_VERSION),
  rankings: z.array(Ai11RankingSchema).max(100),
});

export type Ai11Ranking = z.infer<typeof Ai11RankingSchema>;
export type Ai11Output = z.infer<typeof Ai11OutputSchema>;
