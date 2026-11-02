import { z } from "zod";

/** profiles (DM A.1), edited on S-04. */

export type ProfileDto = {
  id: string;
  displayName: string | null;
  desiredJobTitle: string | null;
  totalYearsOfExperience: number | null;
  interestedIndustries: string[];
  careerDataUpdatedAt: string | null;
};

const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => (v === "" ? null : v));

/** Partial update; omitted keys are left alone. Limits mirror DM A.1 CHECKs. */
export const UpdateProfileInput = z
  .object({
    displayName: nullableText(50),
    desiredJobTitle: nullableText(100),
    totalYearsOfExperience: z.number().int().min(0).max(50).nullable(),
    interestedIndustries: z.array(z.string().trim().min(1).max(50)).max(20),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
export type UpdateProfileInput = z.input<typeof UpdateProfileInput>;
