import { describe, expect, it, vi } from "vitest";
import { getProfile, toProfileDto, toProfileUpdate, updateProfile } from "./index";

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  display_name: "홍길동",
  desired_job_title: "백엔드",
  total_years_of_experience: 3,
  interested_industries: ["핀테크"],
  career_data_updated_at: null,
};

function fakeClient(result: { data: unknown; error: unknown }) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    update: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(result),
  };
  const from = vi.fn().mockReturnValue(chain);
  return { client: { from } as unknown as Parameters<typeof getProfile>[0], from, chain };
}

describe("profile mapping", () => {
  it("row → dto", () => {
    expect(toProfileDto(row)).toEqual({
      id: row.id,
      displayName: "홍길동",
      desiredJobTitle: "백엔드",
      totalYearsOfExperience: 3,
      interestedIndustries: ["핀테크"],
      careerDataUpdatedAt: null,
    });
  });
  it("patch → only the four editable columns, nulls kept", () => {
    expect(toProfileUpdate({ displayName: null, interestedIndustries: [] })).toEqual({
      display_name: null,
      interested_industries: [],
    });
    expect(toProfileUpdate({})).toEqual({});
  });
});

describe("getProfile / updateProfile", () => {
  it("reads own row", async () => {
    const { client, from, chain } = fakeClient({ data: row, error: null });
    await expect(getProfile(client, { id: row.id })).resolves.toMatchObject({ displayName: "홍길동" });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(chain.eq).toHaveBeenCalledWith("id", row.id);
  });
  it("missing row → not_found", async () => {
    const { client } = fakeClient({ data: null, error: null });
    await expect(getProfile(client, { id: row.id })).rejects.toMatchObject({ code: "not_found" });
  });
  it("updates and returns the dto", async () => {
    const { client, chain } = fakeClient({ data: { ...row, desired_job_title: "PM" }, error: null });
    await expect(updateProfile(client, { id: row.id }, { desiredJobTitle: "PM" })).resolves.toMatchObject({ desiredJobTitle: "PM" });
    expect(chain.update).toHaveBeenCalledWith({ desired_job_title: "PM" });
  });
  it("empty patch → invalid_input without a DB call", async () => {
    const { client, from } = fakeClient({ data: row, error: null });
    await expect(updateProfile(client, { id: row.id }, {})).rejects.toMatchObject({ code: "invalid_input" });
    expect(from).not.toHaveBeenCalled();
  });
  it("check violation → invalid_input", async () => {
    const { client } = fakeClient({ data: null, error: { code: "23514", message: "check" } });
    await expect(updateProfile(client, { id: row.id }, { totalYearsOfExperience: 3 })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
