import type { User } from "@supabase/supabase-js";
import { dateToYearMonth } from "@/lib/contracts/career";
import { AppError } from "@/lib/contracts/errors";
import { PROFILE_OPTION_CATEGORIES, type ProfileOptionCategory } from "@/lib/contracts/enums";
import {
  MAX_JOB_INTERESTS,
  type ProfileBasicsDto,
  type ProfileBasicsViewDto,
  type ProfileJobInterestDto,
  type ProfileOptionDto,
  type ProfileDto,
  type SaveProfileBasicsParsed,
  type SaveProfileBasicsResult,
  type UpdateProfileInput,
} from "@/lib/contracts/profile";
import { mapDbError } from "@/server/db/errors";
import type { UserSupabaseClient } from "@/server/db/types";

/**
 * 설정 "내 정보" (S-24 ① 계정 탭, DM 2.1.1·2.1.2·§7, R13).
 *
 * Read = three reads as the user (RLS: own row): `profiles` + `profile_job_interests`
 * (`sort_order` 순) + `profile_options` (셀렉트 라벨). Write = one RPC
 * `save_profile_basics` (섹션 전체 덮어쓰기, 쌍은 delete → insert in one transaction).
 *
 * None of these values is an AI input (SD-6, DM 2.1.5) and none gates a feature
 * (DM 6-A — `profile_filled` is gone).
 */

/** The 내 정보 columns of `profiles` (+ `updated_at` = 기대 버전의 원천). */
const PROFILE_BASICS_COLUMNS =
  "id, updated_at, display_name, job_search_status, interested_company_type, interested_industry, " +
  "highest_education_school_name, highest_education_degree, highest_education_status, " +
  "highest_education_start_month, highest_education_end_month, highest_education_major, highest_education_gpa";

type ProfileBasicsRow = {
  updated_at: string;
  display_name: string | null;
  job_search_status: string | null;
  interested_company_type: string | null;
  interested_industry: string | null;
  highest_education_school_name: string | null;
  highest_education_degree: string | null;
  highest_education_status: string | null;
  highest_education_start_month: string | null;
  highest_education_end_month: string | null;
  highest_education_major: string | null;
  highest_education_gpa: string | null;
};

type JobInterestRow = { sort_order: number; job_family: string; job_role: string | null };

type ProfileOptionRow = {
  category: string;
  code: string;
  parent_code: string | null;
  label: string;
  sort_order: number;
  is_active: boolean;
};

export function toProfileBasicsDto(row: ProfileBasicsRow, interests: JobInterestRow[]): ProfileBasicsDto {
  return {
    updatedAt: row.updated_at,
    displayName: row.display_name,
    jobSearchStatus: row.job_search_status,
    interestedCompanyType: row.interested_company_type,
    interestedIndustry: row.interested_industry,
    highestEducation: {
      // DB date → `'YYYY-MM'` (same as 커리어 읽기 경로, DM-4).
      schoolName: row.highest_education_school_name,
      degree: row.highest_education_degree,
      status: row.highest_education_status,
      startMonth: dateToYearMonth(row.highest_education_start_month),
      endMonth: dateToYearMonth(row.highest_education_end_month),
      major: row.highest_education_major,
      gpa: row.highest_education_gpa,
    },
    jobInterests: interests
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(toJobInterestDto),
  };
}

export function toJobInterestDto(row: JobInterestRow): ProfileJobInterestDto {
  return { sortOrder: row.sort_order, jobFamily: row.job_family, jobRole: row.job_role };
}

export function toProfileOptionDto(row: ProfileOptionRow): ProfileOptionDto {
  if (!(PROFILE_OPTION_CATEGORIES as readonly string[]).includes(row.category)) {
    throw new AppError("internal_error", undefined, { status: 500 });
  }
  return {
    category: row.category as ProfileOptionCategory,
    code: row.code,
    parentCode: row.parent_code,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

/** `p_values` keys = column names (DM §7). Section-wide overwrite: every key is sent, null empties it. */
export function toProfileValuesJson(values: SaveProfileBasicsParsed["values"]): Record<string, string | null> {
  const edu = values.highestEducation;
  return {
    display_name: values.displayName ?? null,
    job_search_status: values.jobSearchStatus ?? null,
    interested_company_type: values.interestedCompanyType ?? null,
    interested_industry: values.interestedIndustry ?? null,
    highest_education_school_name: edu.schoolName ?? null,
    highest_education_degree: edu.degree ?? null,
    highest_education_status: edu.status ?? null,
    highest_education_start_month: edu.startMonth ?? null,
    highest_education_end_month: edu.endMonth ?? null,
    highest_education_major: edu.major ?? null,
    highest_education_gpa: edu.gpa ?? null,
  };
}

/** `p_job_interests`: ordered list; the RPC assigns `sort_order` 1..n (DM 2.1.2). */
export function toJobInterestsJson(
  interests: SaveProfileBasicsParsed["jobInterests"],
): Array<{ job_family: string; job_role: string | null }> {
  return interests.map((i) => ({ job_family: i.jobFamily, job_role: i.jobRole ?? null }));
}

/**
 * Pre-checks that own the two list-shaped errors so the screen gets a stable code
 * (the RPC enforces both again — `CHECK (sort_order between 1 and 2)` and
 * `unique nulls not distinct`, R-SD-18).
 */
export function checkJobInterests(interests: SaveProfileBasicsParsed["jobInterests"]): void {
  if (interests.length > MAX_JOB_INTERESTS) {
    throw new AppError("too_many_job_interests", `관심 직군·직무는 최대 ${MAX_JOB_INTERESTS}개까지 고를 수 있어요.`, { status: 400 });
  }
  const seen = new Set<string>();
  for (const [index, interest] of interests.entries()) {
    // null 직무끼리도 같은 값으로 본다 (DM 2.1.2, R-SD-18).
    const key = `${interest.jobFamily}\u0000${interest.jobRole ?? ""}`;
    if (seen.has(key)) {
      throw new AppError("duplicate_job_interest", "이미 고른 직군·직무예요. 다른 쌍을 고르거나 지워 주세요.", {
        status: 400,
        details: { field: `job_interests.${index + 1}`, sortOrder: index + 1 },
      });
    }
    seen.add(key);
  }
}

export async function getProfileBasics(supabase: UserSupabaseClient, user: Pick<User, "id">): Promise<ProfileBasicsDto> {
  const [profile, interests] = await Promise.all([
    supabase.from("profiles").select(PROFILE_BASICS_COLUMNS).eq("id", user.id).maybeSingle(),
    supabase.from("profile_job_interests").select("sort_order, job_family, job_role").order("sort_order"),
  ]);
  if (profile.error) throw mapDbError(profile.error);
  if (interests.error) throw mapDbError(interests.error);
  if (!profile.data) throw new AppError("not_found");
  return toProfileBasicsDto(profile.data as unknown as ProfileBasicsRow, (interests.data ?? []) as JobInterestRow[]);
}

/**
 * Select options (DM 2.1.1): active rows, plus the rows of codes the user already
 * stored even when they were taken down (`is_active = false`) so the screen can
 * still show their label.
 */
export async function getProfileOptions(
  supabase: UserSupabaseClient,
  storedCodes: readonly string[] = [],
): Promise<ProfileOptionDto[]> {
  const columns = "category, code, parent_code, label, sort_order, is_active";
  const active = await supabase.from("profile_options").select(columns).eq("is_active", true).order("category").order("sort_order");
  if (active.error) throw mapDbError(active.error);
  const rows = (active.data ?? []) as unknown as ProfileOptionRow[];

  const missing = [...new Set(storedCodes.filter((c) => c && !rows.some((r) => r.code === c)))];
  if (missing.length > 0) {
    const extra = await supabase.from("profile_options").select(columns).in("code", missing);
    if (extra.error) throw mapDbError(extra.error);
    rows.push(...((extra.data ?? []) as unknown as ProfileOptionRow[]));
  }
  return rows.map(toProfileOptionDto);
}

/** Codes stored on the profile (used to keep inactive labels readable). */
export function storedOptionCodes(profile: ProfileBasicsDto): string[] {
  return [
    profile.jobSearchStatus,
    profile.interestedCompanyType,
    profile.interestedIndustry,
    profile.highestEducation.degree,
    profile.highestEducation.status,
    ...profile.jobInterests.flatMap((i) => [i.jobFamily, i.jobRole]),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);
}

/** One read for S-24 ① (DM §7 "내 정보 조회"). */
export async function getProfileBasicsView(supabase: UserSupabaseClient, user: Pick<User, "id">): Promise<ProfileBasicsViewDto> {
  const profile = await getProfileBasics(supabase, user);
  const options = await getProfileOptions(supabase, storedOptionCodes(profile));
  return { profile, options };
}

/**
 * RPC `save_profile_basics(p_values, p_job_interests, p_expected_updated_at)`
 * (security invoker, one transaction). Errors: `stale_write`(409) ·
 * `invalid_profile_option` · `field_too_long` · `invalid_period` ·
 * `too_many_job_interests` · `duplicate_job_interest` (all 400) — mapped by
 * `mapDbError` from the RPC's raises (DM §7).
 */
export async function saveProfileBasics(
  supabase: UserSupabaseClient,
  input: SaveProfileBasicsParsed,
): Promise<SaveProfileBasicsResult> {
  checkJobInterests(input.jobInterests);
  const { data, error } = await supabase.rpc("save_profile_basics", {
    p_values: toProfileValuesJson(input.values),
    p_job_interests: toJobInterestsJson(input.jobInterests),
    p_expected_updated_at: input.expectedUpdatedAt,
  });
  if (error) throw mapDbError(error);
  const updatedAt = readUpdatedAt(data);
  if (!updatedAt) throw new AppError("internal_error", undefined, { status: 500 });
  return { updatedAt };
}

/** The RPC returns `{ updated_at }` (jsonb); accept a bare timestamp too. */
export function readUpdatedAt(data: unknown): string | null {
  if (typeof data === "string" && data.length > 0) return data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>).updated_at;
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Legacy S-04 path (R13): display_name only — the three dropped columns are gone
// (DM 2.1.1 ④). The screen itself is retired by the UI harness.
// ---------------------------------------------------------------------------

const PROFILE_COLUMNS = "id, display_name, career_data_updated_at" as const;

type ProfileSelect = { id: string; display_name: string | null; career_data_updated_at: string | null };

export function toProfileDto(row: ProfileSelect): ProfileDto {
  return { id: row.id, displayName: row.display_name, careerDataUpdatedAt: row.career_data_updated_at };
}

export async function getProfile(supabase: UserSupabaseClient, user: Pick<User, "id">): Promise<ProfileDto> {
  const { data, error } = await supabase.from("profiles").select(PROFILE_COLUMNS).eq("id", user.id).maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new AppError("not_found");
  return toProfileDto(data);
}

export async function updateProfile(
  supabase: UserSupabaseClient,
  user: Pick<User, "id">,
  patch: UpdateProfileInput,
): Promise<ProfileDto> {
  if (patch.displayName === undefined) throw new AppError("invalid_input");
  const { data, error } = await supabase
    .from("profiles")
    .update({ display_name: patch.displayName })
    .eq("id", user.id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new AppError("not_found");
  return toProfileDto(data);
}
