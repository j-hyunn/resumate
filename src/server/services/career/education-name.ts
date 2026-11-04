/**
 * An education's display name on the career screens (S-08 list · S-10 parent / affiliation list ·
 * S-34 · C-23 affiliation choice): 교육 명 (`program_name`), falling back to 운영 기관
 * (`institution_name`) when it's empty after trimming. null = both empty ("이름 없는 교육" on screen).
 * User decision 2026-11-04 (UI32-1, UQ-734). Pure — no Next.js or DB imports.
 */
export function educationDisplayName(
  programName: string | null | undefined,
  institutionName: string | null | undefined,
): string | null {
  return programName?.trim() || institutionName?.trim() || null;
}
