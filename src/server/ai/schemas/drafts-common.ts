import { z } from "zod";
import { ModelEvidenceSchema } from "../validation/evidence";

/** Shared pieces of the S7 document schemas (AI-03, AI-04). Canonical form (C-10.2). */

export const DraftRef = z.string().max(20);
export const DraftRefs = z.array(DraftRef).max(20);
export const DraftEvidence = z.array(ModelEvidenceSchema).max(12);

/** C-5: `{token, hint}` in body order. Tokens are checked by the server (6 fixed tokens). */
export const PlaceholderOutputSchema = z.object({ token: z.string().max(30), hint: z.string().max(200) });
export const PlaceholdersOutput = z.array(PlaceholderOutputSchema).max(20);

/** A generated text block (C-3: draft blocks carry block_id). */
export const TextBlockOutputSchema = z.object({
  block_id: z.string().max(60),
  text: z.string().max(3000),
  evidence: DraftEvidence,
  placeholders: PlaceholdersOutput,
});
export type TextBlockOutput = z.infer<typeof TextBlockOutputSchema>;

export const NotesForUser = z.array(z.string().max(300)).max(10);
