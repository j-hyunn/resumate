import { z } from "zod";
import { PROFILE_OPTION_CATEGORIES, type ProfileOptionCategory } from "./enums";

/**
 * 설정 "내 정보" (S-24 ① 계정 탭, DM 2.1.1 / 2.1.2 / §7, F-P1-01).
 *
 * R13 (v4.12, SD-2·SD-A2·SD-A4·SD-A17): `total_years_of_experience`,
 * `desired_job_title`, `interested_industries` are gone; the values are codes of
 * `profile_options` plus a flat 최종 학력 block and the pair table
 * `profile_job_interests` (최대 2쌍). Nothing here reaches a prompt (SD-6, 2.1.5)
 * and nothing gates a feature (DM 6-A: no `profile_filled`).
 */

/** 최대 쌍 수 (DM 2.1.2, SD-Q3 (가)): PK `(user_id, sort_order)` + `CHECK (sort_order between 1 and 2)`. */
export const MAX_JOB_INTERESTS = 2;

/** Length limits (DM 2.1.1 / A.1 CHECKs). */
export const PROFILE_LIMITS = {
  displayName: 50,
  schoolName: 100,
  major: 100,
  gpa: 20,
} as const;

/** `profile_options` row (reference table, DM 2.1.1 — PK `(category, code)`). */
export type ProfileOptionDto = {
  category: ProfileOptionCategory;
  code: string;
  /** Only category `job_role`: the `job_family` code it belongs to. */
  parentCode: string | null;
  label: string;
  sortOrder: number;
  /** `false` = 목록에서 내려간 값. Still shown when the user already stored it. */
  isActive: boolean;
};

export type ProfileJobInterestDto = {
  /** 1..2 (DM 2.1.2). */
  sortOrder: number;
  jobFamily: string;
  /** null = 직군만 고른 상태 (허용). */
  jobRole: string | null;
};

export type HighestEducationDto = {
  schoolName: string | null;
  /** `profile_options` category `degree`. */
  degree: string | null;
  /** `profile_options` category `graduation_status`. */
  status: string | null;
  /** `'YYYY-MM'` (the column keeps the 1st of the month, DM-4). */
  startMonth: string | null;
  endMonth: string | null;
  major: string | null;
  /** 자유 입력 (예 `3.8/4.5`). 형식 검사 없음. */
  gpa: string | null;
};

export type ProfileBasicsDto = {
  /** 기대 버전의 원천: the next save sends this as `p_expected_updated_at`. */
  updatedAt: string;
  displayName: string | null;
  jobSearchStatus: string | null;
  interestedCompanyType: string | null;
  interestedIndustry: string | null;
  highestEducation: HighestEducationDto;
  jobInterests: ProfileJobInterestDto[];
};

/** What S-24 ① needs in one read (DM §7 "내 정보 조회": three reads). */
export type ProfileBasicsViewDto = {
  profile: ProfileBasicsDto;
  /** Active options + the rows for codes the user already stored (even `is_active = false`). */
  options: ProfileOptionDto[];
};

/** Year-months travel as `'YYYY-MM'` and are stored as the 1st of the month (DM-4), like 커리어. */
const month = z
  .string()
  .regex(/^((?:19|20)\d{2})-(0[1-9]|1[0-2])$/, "YYYY-MM")
  .nullable();

const optionCode = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9_]+$/, "snake_case code")
  .nullable();

const text = (max: number) =>
  z
    .string()
    .max(max)
    .nullable()
    .transform((v) => {
      const trimmed = v?.trim() ?? null;
      return trimmed === "" ? null : trimmed;
    });

/**
 * 섹션 전체 덮어쓰기 `[가정]` (R13 plan): the screen saves the whole "내 정보"
 * section, so every key is required and a null empties the column. There is no
 * partial patch API.
 */
export const ProfileBasicsValues = z.object({
  displayName: text(PROFILE_LIMITS.displayName),
  jobSearchStatus: optionCode,
  interestedCompanyType: optionCode,
  interestedIndustry: optionCode,
  highestEducation: z.object({
    schoolName: text(PROFILE_LIMITS.schoolName),
    degree: optionCode,
    status: optionCode,
    startMonth: month,
    endMonth: month,
    major: text(PROFILE_LIMITS.major),
    gpa: text(PROFILE_LIMITS.gpa),
  }),
});
export type ProfileBasicsValues = z.infer<typeof ProfileBasicsValues>;

export const ProfileJobInterestInput = z.object({
  jobFamily: z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_]+$/, "snake_case code"),
  jobRole: optionCode,
});

/**
 * RPC `save_profile_basics(p_values jsonb, p_job_interests jsonb, p_expected_updated_at timestamptz)`.
 * The pair list is capped loosely here so a 3rd pair comes back as
 * `too_many_job_interests` (400) instead of a generic `invalid_input` (DM §7).
 */
export const SaveProfileBasicsInput = z
  .object({
    values: ProfileBasicsValues,
    jobInterests: z.array(ProfileJobInterestInput).max(10),
    expectedUpdatedAt: z.string().min(1),
  })
  .refine(
    (v) =>
      v.values.highestEducation.startMonth === null ||
      v.values.highestEducation.endMonth === null ||
      v.values.highestEducation.endMonth >= v.values.highestEducation.startMonth,
    { message: "invalid_period", path: ["values", "highestEducation", "endMonth"] },
  );
export type SaveProfileBasicsInput = z.input<typeof SaveProfileBasicsInput>;
/** The parsed (trimmed, null-normalized) shape services work with. */
export type SaveProfileBasicsParsed = z.output<typeof SaveProfileBasicsInput>;

/**
 * Legacy S-04 shim (R13): `display_name` is the only editable column left on
 * `profiles` for the old form — `desired_job_title`, `total_years_of_experience`
 * and `interested_industries` are dropped (DM 2.1.1). S-04 자체는 UI가 폐기한다.
 */
export type ProfileDto = {
  id: string;
  displayName: string | null;
  careerDataUpdatedAt: string | null;
};

export const UpdateProfileInput = z.object({
  displayName: text(PROFILE_LIMITS.displayName),
});
export type UpdateProfileInput = z.input<typeof UpdateProfileInput>;

/** RPC response (DM §7). */
export type SaveProfileBasicsResult = { updatedAt: string };

/** Save-path error codes the screen branches on (DM §7, UX S-24 ① 오류 표). */
export const PROFILE_SAVE_ERROR_CODES = [
  "stale_write",
  "invalid_profile_option",
  "field_too_long",
  "invalid_period",
  "too_many_job_interests",
  "duplicate_job_interest",
] as const;
export type ProfileSaveErrorCode = (typeof PROFILE_SAVE_ERROR_CODES)[number];

export function isProfileOptionCategory(value: unknown): value is ProfileOptionCategory {
  return typeof value === "string" && (PROFILE_OPTION_CATEGORIES as readonly string[]).includes(value);
}
