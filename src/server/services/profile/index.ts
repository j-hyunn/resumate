import type { User } from "@supabase/supabase-js";
import type { ProfileDto } from "@/lib/contracts/profile";
import { AppError } from "@/lib/contracts/errors";
import { mapDbError } from "@/server/db/errors";
import type { Database } from "@/server/db/database.types";
import type { UserSupabaseClient } from "@/server/db/types";

/** profiles (DM A.1). Read and edit as the user (RLS: own row). */

type ProfileRow = Database["public"]["Tables"]["profiles"]["Row"];
type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];

const PROFILE_COLUMNS =
  "id, display_name, desired_job_title, total_years_of_experience, interested_industries, career_data_updated_at" as const;

type ProfileSelect = Pick<
  ProfileRow,
  "id" | "display_name" | "desired_job_title" | "total_years_of_experience" | "interested_industries" | "career_data_updated_at"
>;

export function toProfileDto(row: ProfileSelect): ProfileDto {
  return {
    id: row.id,
    displayName: row.display_name,
    desiredJobTitle: row.desired_job_title,
    totalYearsOfExperience: row.total_years_of_experience,
    interestedIndustries: row.interested_industries,
    careerDataUpdatedAt: row.career_data_updated_at,
  };
}

export type ProfilePatch = {
  displayName?: string | null;
  desiredJobTitle?: string | null;
  totalYearsOfExperience?: number | null;
  interestedIndustries?: string[];
};

/** DTO patch → only the four user-editable columns (the column grant allows nothing else). */
export function toProfileUpdate(patch: ProfilePatch): ProfileUpdate {
  const update: ProfileUpdate = {};
  if (patch.displayName !== undefined) update.display_name = patch.displayName;
  if (patch.desiredJobTitle !== undefined) update.desired_job_title = patch.desiredJobTitle;
  if (patch.totalYearsOfExperience !== undefined) update.total_years_of_experience = patch.totalYearsOfExperience;
  if (patch.interestedIndustries !== undefined) update.interested_industries = patch.interestedIndustries;
  return update;
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
  patch: ProfilePatch,
): Promise<ProfileDto> {
  const update = toProfileUpdate(patch);
  if (Object.keys(update).length === 0) throw new AppError("invalid_input");
  const { data, error } = await supabase
    .from("profiles")
    .update(update)
    .eq("id", user.id)
    .select(PROFILE_COLUMNS)
    .maybeSingle();
  if (error) throw mapDbError(error);
  if (!data) throw new AppError("not_found");
  return toProfileDto(data);
}
