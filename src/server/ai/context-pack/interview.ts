import { buildAllowedNumbers } from "../validation/numbers";
import { literalAliasTokens } from "../validation/alias-text";
import { normalizeForMatch } from "../validation/normalize";
import type { InterviewType } from "../schemas/interview-common";
import { AliasMap } from "./aliases";
import { buildCareerPack, type CareerPack } from "./career-pack";
import type { CareerRows } from "./career-rows";
import { buildJdContext, type JdRequirementInput, type JdSentence } from "./jd";
import type { YearMonth } from "./months";

/**
 * Shared context of the interview features (AI-05, AI-06; AI spec C-1, C-2).
 * - Career pack: C-1 as everywhere (`complete` rows only). Culture fit with
 *   `none` data may pass `careerRows: null` → an empty pack.
 * - JD: requirements (REQ-n) always; for culture fit also the organisation /
 *   way-of-working sentences (`extraction.other_sids`, `jd` anchor source).
 *   Job interviews get no sentences (card 입력 컨텍스트 "직무: 넣지 않음").
 * - V-5 sets: `allowedNumbers` = pack factual text + computed durations + JD;
 *   `jdNumbers` = JD only (culture questions not anchored on experience may
 *   not state the user's numbers, 4.1 "사용자 사실을 가정하지 않는다").
 * - `careerTerms`: the pack's proper nouns (company / institution / program /
 *   project names, rank / position / department) for that same check.
 */

export type InterviewBaseInput = {
  interviewType: InterviewType;
  careerRows: CareerRows | null;
  asOf?: YearMonth;
  jobDescriptionId: string;
  jobDescriptionUpdatedAt: string | null;
  sentences: readonly JdSentence[];
  /** job_descriptions.extraction.other_sids (culture fit only). */
  cultureSids: readonly string[];
  requirements: readonly JdRequirementInput[];
  positionTitle: string | null;
};

export type InterviewBase = {
  pack: CareerPack;
  /** <jd> block as sent. Never log it. */
  jdText: string;
  aliases: AliasMap;
  careerSnapshotHash: string;
  requirementsHash: string;
  allowedNumbers: ReadonlySet<string>;
  jdNumbers: ReadonlySet<string>;
  literalAliasTokens: ReadonlySet<string>;
  /** Normalized (normalizeForMatch) proper nouns of the pack, ≥ 2 chars, not in the JD or the desired job title. */
  careerTerms: readonly string[];
  /** Texts of the user's data (for later V-5 sets that add the answer). */
  factualTexts: readonly string[];
  jdTexts: readonly string[];
  /** Number of culture sentences in the JD block (0 → no `jd` anchor possible). */
  cultureSentenceCount: number;
};

export function emptyCareerRows(): CareerRows {
  return { profile: null, experiences: [], educations: [], projects: [], projectDetails: [], achievements: [], skills: [], projectSkills: [] };
}

export function buildInterviewBase(input: InterviewBaseInput): InterviewBase {
  const rows = input.careerRows ?? emptyCareerRows();
  const pack = buildCareerPack(rows, { asOf: input.asOf });
  const cultureSids = new Set(input.interviewType === "culture_fit" ? input.cultureSids : []);
  const jd = buildJdContext({
    jobDescriptionId: input.jobDescriptionId,
    jobDescriptionUpdatedAt: input.jobDescriptionUpdatedAt,
    sentences: input.sentences.filter((s) => cultureSids.has(s.sid)),
    requirements: input.requirements,
    includeSentences: input.interviewType === "culture_fit" ? "all" : "none",
    positionTitle: input.positionTitle,
  });
  const aliases = AliasMap.merge(pack.aliases, jd.aliases);
  const factualTexts = pack.numberSources.factualTexts;
  const allowedNumbers = buildAllowedNumbers({ texts: [...factualTexts, ...jd.numberTexts], numbers: pack.numberSources.computedNumbers });
  const jdNumbers = buildAllowedNumbers({ texts: jd.numberTexts });

  const jdNorm = normalizeForMatch(jd.numberTexts.join(" ")).text;
  const desired = normalizeForMatch(rows.profile?.desired_job_title ?? "").text;
  const terms = new Set<string>();
  const addTerm = (value: string | null | undefined) => {
    const t = normalizeForMatch(value ?? "").text;
    if (t.length < 2 || /^\d+$/.test(t)) return;
    if (jdNorm.includes(t) || (desired && desired.includes(t))) return;
    terms.add(t);
  };
  for (const e of pack.aliases.values()) {
    if (e.sourceType === "experience") {
      addTerm(e.label); // company_name
      addTerm(e.fields.job_rank);
      addTerm(e.fields.job_position);
      addTerm(e.fields.department);
    } else if (e.sourceType === "education") {
      addTerm(e.fields.institution_name);
      addTerm(e.fields.program_name);
    } else if (e.sourceType === "project") {
      addTerm(e.fields.name);
    }
  }

  return {
    pack,
    jdText: jd.text,
    aliases,
    careerSnapshotHash: pack.careerSnapshotHash,
    requirementsHash: jd.requirementsHash,
    allowedNumbers,
    jdNumbers,
    literalAliasTokens: literalAliasTokens([...factualTexts, ...jd.numberTexts]),
    careerTerms: [...terms].sort(),
    factualTexts,
    jdTexts: jd.numberTexts,
    cultureSentenceCount: [...jd.aliases.values()].filter((e) => e.sourceType === "jd_sentence").length,
  };
}
