import { validateItem, type EvidenceContext, type ItemInput, type ItemOutcome } from "./evidence";
import { findUnsupportedNumbers, replaceUnsupportedNumbers, type NumberMention } from "./numbers";
import { checkPlaceholders, type Placeholder } from "./placeholders";
import { mergeReports, type ValidationReport } from "./report";

/**
 * Block-level check for generated text blocks (draft blocks, improved
 * answers, directions): V-1..V-3, V-8, V-7, V-4 on its evidence, C-5 on its
 * placeholders, and V-5 detection. Used on `block_completed` and again in the
 * final pass. Number replacement is a separate step (after the one retry).
 */
export type TextBlockInput = Omit<ItemInput, "text"> & {
  text: string;
  placeholders?: ReadonlyArray<{ token: string; hint?: string | null }>;
};

export type TextBlockResult = {
  outcome: ItemOutcome;
  text: string;
  placeholders: Placeholder[];
  unsupportedNumbers: NumberMention[];
  report: ValidationReport;
};

export function validateTextBlock(
  block: TextBlockInput,
  ctx: EvidenceContext,
  allowedNumbers: ReadonlySet<string> | null,
): TextBlockResult {
  const placeholderCheck = checkPlaceholders(block.text, block.placeholders ?? []);
  const { outcome, report } = validateItem({ ...block, text: placeholderCheck.text }, ctx);
  const unsupportedNumbers = allowedNumbers ? findUnsupportedNumbers(placeholderCheck.text, allowedNumbers) : [];
  return {
    outcome,
    text: placeholderCheck.text,
    placeholders: placeholderCheck.placeholders,
    unsupportedNumbers,
    report: mergeReports(report, {
      placeholder_mismatches: placeholderCheck.mismatch ? 1 : 0,
      unknown_placeholders: placeholderCheck.unknownReplaced,
      number_violations: unsupportedNumbers.length,
    }),
  };
}

/**
 * Final V-5 step after the regeneration attempt: replace what is still
 * unsupported. `number_check_needed` goes into the block flags (AI-03 저장).
 */
export function finalizeBlockNumbers(
  text: string,
  allowedNumbers: ReadonlySet<string>,
): { text: string; flags: string[]; report: Partial<ValidationReport> } {
  const bad = findUnsupportedNumbers(text, allowedNumbers);
  if (!bad.length) return { text, flags: [], report: {} };
  return { text: replaceUnsupportedNumbers(text, bad), flags: [NUMBER_CHECK_NEEDED], report: { numbers_replaced: bad.length } };
}

export const NUMBER_CHECK_NEEDED = "number_check_needed";
