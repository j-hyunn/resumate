import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AddManualSkillInput,
  AddProjectSkillInput,
  SaveAchievementInput,
  SaveEducationInput,
  SaveExperienceInput,
  SaveProjectDetailInput,
  SaveProjectInput,
} from "@/lib/contracts/career";
import type { Database } from "@/server/db/database.types";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import {
  addManualSkill,
  addProjectSkill,
  deleteCareerItem,
  getCareerTree,
  getDataReadiness,
  getDeletionImpact,
  removeProjectSkill,
  reorderProjectDetails,
  saveAchievement,
  saveEducation,
  saveExperience,
  saveProject,
  saveProjectDetail,
} from "./index";

/**
 * S2 career services against the local stack as real user sessions:
 * DB-computed status on auto-save, project ↔ detail recalculation, optimistic
 * concurrency, cross-user isolation, skills, reorder, readiness, deletion.
 * Skips when the stack isn't running or S2 migrations aren't applied.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "project_details")) : false;

type Client = SupabaseClient<Database>;
const newId = () => crypto.randomUUID();

describe.skipIf(!ready)("career services (local stack)", () => {
  const s = stack!;
  let admin: Client;
  let alice: Client;
  let bob: Client;
  const userIds: string[] = [];

  async function signedInUser(tag: string): Promise<Client> {
    const email = `${tag}-${crypto.randomUUID()}@example.test`;
    const password = `pw-${crypto.randomUUID()}`;
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (created.error || !created.data.user) throw new Error(`createUser failed: ${created.error?.code}`);
    userIds.push(created.data.user.id);
    const client = createClient<Database>(s.url, s.anonKey, { auth: { persistSession: false } });
    const signIn = await client.auth.signInWithPassword({ email, password });
    if (signIn.error) throw new Error(`signIn failed: ${signIn.error.code}`);
    return client;
  }

  beforeAll(async () => {
    admin = createClient<Database>(s.url, s.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });
    alice = await signedInUser("career-a");
    bob = await signedInUser("career-b");
  });

  afterAll(async () => {
    for (const id of userIds) await admin.auth.admin.deleteUser(id);
  });

  let experienceId = "";
  let projectId = "";
  let detailId = "";

  it("auto-saves an experience: draft → complete, status from the DB", async () => {
    const draft = await saveExperience(alice, SaveExperienceInput.parse({ id: newId(), companyName: "알파" }));
    expect(draft.status).toBe("draft");
    experienceId = draft.id;
    const done = await saveExperience(
      alice,
      SaveExperienceInput.parse({ id: draft.id, expectedUpdatedAt: draft.updatedAt, startMonth: "2023-03", jobPosition: "백엔드", isCurrent: true }),
    );
    expect(done).toMatchObject({ id: draft.id, status: "complete" });
    expect(done.updatedAt).not.toBe(draft.updatedAt);
  });

  it("rejects a stale expectedUpdatedAt with conflict", async () => {
    await expect(
      saveExperience(alice, SaveExperienceInput.parse({ id: experienceId, expectedUpdatedAt: "2000-01-01T00:00:00Z", summary: "x" })),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  it("create → resend create (no edit) stays idempotent: one row (QA-S2-03)", async () => {
    const id = newId();
    const first = await saveExperience(alice, SaveExperienceInput.parse({ id, companyName: "재시도" }));
    const again = await saveExperience(alice, SaveExperienceInput.parse({ id, companyName: "재시도" }));
    expect(again).toMatchObject({ id: first.id, status: "draft" });
    const rows = await alice.from("experiences").select("id").eq("id", id);
    expect(rows.data).toHaveLength(1);
    // Another user replaying that id can neither read nor overwrite it.
    await expect(saveExperience(bob, SaveExperienceInput.parse({ id, companyName: "탈취" }))).rejects.toMatchObject({ code: "not_found" });
    await expect(saveExperience(bob, SaveExperienceInput.parse({ id }))).rejects.toMatchObject({ code: "not_found" });
    await deleteCareerItem(alice, { entityType: "experience", entityId: id, affiliationMode: "keep_projects", resultMode: "keep_results" });
  });

  it("create → edit → resend same create: the edit survives, the resend gets conflict (QA-S2-08)", async () => {
    const id = newId();
    const created = await saveExperience(alice, SaveExperienceInput.parse({ id, companyName: "원래 이름" }));
    const editedRow = await saveExperience(
      alice,
      SaveExperienceInput.parse({ id, expectedUpdatedAt: created.updatedAt, companyName: "고친 이름", jobRank: "과장" }),
    );
    await expect(saveExperience(alice, SaveExperienceInput.parse({ id, companyName: "원래 이름" }))).rejects.toMatchObject({
      code: "conflict",
    });
    const row = await alice.from("experiences").select("company_name, job_rank, updated_at").eq("id", id).single();
    expect(row.data).toEqual({ company_name: "고친 이름", job_rank: "과장", updated_at: editedRow.updatedAt });
    await deleteCareerItem(alice, { entityType: "experience", entityId: id, affiliationMode: "keep_projects", resultMode: "keep_results" });
  });

  it("isCurrent → end month cleared; a stored end month can't break the CHECK", async () => {
    const e = await saveExperience(alice, SaveExperienceInput.parse({ id: newId(), companyName: "베타", startMonth: "2020-01", endMonth: "2021-06", jobRank: "사원" }));
    await expect(saveExperience(alice, SaveExperienceInput.parse({ id: e.id, isCurrent: true }))).resolves.toMatchObject({ status: "complete" });
    await deleteCareerItem(alice, { entityType: "experience", entityId: e.id, affiliationMode: "keep_projects", resultMode: "keep_results" });
  });

  it("another user can't see or edit the row (not_found), nor attach to it", async () => {
    await expect(saveExperience(bob, SaveExperienceInput.parse({ id: experienceId, summary: "hack" }))).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      saveProject(bob, SaveProjectInput.parse({ id: newId(), affiliation: { type: "experience", id: experienceId }, name: "x" })),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("a project is complete only with a complete detail; the detail save reports it", async () => {
    const p = await saveProject(
      alice,
      SaveProjectInput.parse({ id: newId(), affiliation: { type: "experience", id: experienceId }, name: "결제 개선", role: "리드", startMonth: "2024-02" }),
    );
    expect(p.status).toBe("draft");
    projectId = p.id;
    const d1 = await saveProjectDetail(alice, SaveProjectDetailInput.parse({ id: newId(), projectId, title: "응답 속도", situation: "느림" }));
    expect(d1).toMatchObject({ status: "draft", sortOrder: 1, project: { status: "draft" } });
    const d1done = await saveProjectDetail(alice, SaveProjectDetailInput.parse({ id: d1.id, action: "캐시 도입" }));
    expect(d1done).toMatchObject({ status: "complete", project: { id: projectId, status: "complete" } });
    // QA-S2-04: the project form continues with the updatedAt the detail save returned.
    await expect(
      saveProject(alice, SaveProjectInput.parse({ id: projectId, expectedUpdatedAt: d1done.project.updatedAt, summary: "한 줄" })),
    ).resolves.toMatchObject({ status: "complete" });
    // A late resend of d1's create after it was edited: conflict, no new row, no new sort_order.
    await expect(saveProjectDetail(alice, SaveProjectDetailInput.parse({ id: d1.id, projectId, title: "응답 속도" }))).rejects.toMatchObject({
      code: "conflict",
    });
    const d1rows = await alice.from("project_details").select("id, sort_order, action").eq("project_id", projectId);
    expect(d1rows.data).toEqual([{ id: d1.id, sort_order: 1, action: "캐시 도입" }]);
    detailId = d1.id;
    const d2 = await saveProjectDetail(alice, SaveProjectDetailInput.parse({ id: newId(), projectId, title: "두 번째" }));
    expect(d2.sortOrder).toBe(2);
  });

  it("bob can't add a detail under alice's project", async () => {
    await expect(saveProjectDetail(bob, SaveProjectDetailInput.parse({ id: newId(), projectId, title: "x" }))).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("saves an achievement on a detail (kind generated)", async () => {
    const a = await saveAchievement(
      alice,
      SaveAchievementInput.parse({ id: newId(), target: { type: "project_detail", id: detailId }, metricName: "p95", valueBefore: 800, valueAfter: 200, unit: "ms" }),
    );
    expect(a.status).toBe("complete");
    const tree = await getCareerTree(alice);
    expect(tree.achievements.find((x) => x.id === a.id)).toMatchObject({ kind: "quantitative", projectDetailId: detailId });
    expect(tree.projectDetails.find((d) => d.id === detailId)?.achievementCount).toBe(1);
  });

  it("education: enrolled clears end month", async () => {
    const e = await saveEducation(
      alice,
      SaveEducationInput.parse({ id: newId(), institutionName: "한국대", educationType: "degree", startMonth: "2016-03", endMonth: "2020-02" }),
    );
    expect(e.status).toBe("complete");
    await expect(saveEducation(alice, SaveEducationInput.parse({ id: e.id, enrollmentStatus: "enrolled" }))).resolves.toMatchObject({
      status: "complete",
    });
  });

  it("skills: tags reuse by normalized name; the last unlink deletes a tag skill, not a manual one", async () => {
    const t1 = await addProjectSkill(alice, AddProjectSkillInput.parse({ projectId, name: "Type  Script" }));
    const t2 = await addProjectSkill(alice, AddProjectSkillInput.parse({ projectId, name: "type script" }));
    expect(t2.skill.id).toBe(t1.skill.id);
    expect(t2.skill).toMatchObject({ isManual: false, projectCount: 1 });
    await expect(removeProjectSkill(alice, { projectId, skillId: t1.skill.id })).resolves.toEqual({ removed: true, skillDeleted: true });

    const manual = await addManualSkill(alice, AddManualSkillInput.parse({ name: "Go", proficiency: "practical" }));
    expect(manual).toMatchObject({ isManual: true, proficiency: "practical" });
    await addProjectSkill(alice, AddProjectSkillInput.parse({ projectId, name: "go" }));
    await expect(removeProjectSkill(alice, { projectId, skillId: manual.id })).resolves.toEqual({ removed: true, skillDeleted: false });
  });

  it("reorders details; a partial list is invalid_detail_order", async () => {
    const tree = await getCareerTree(alice);
    const ids = tree.projectDetails.filter((d) => d.projectId === projectId).map((d) => d.id);
    const reversed = [...ids].reverse();
    await reorderProjectDetails(alice, { projectId, orderedIds: reversed });
    const after = await getCareerTree(alice);
    expect(after.projectDetails.filter((d) => d.projectId === projectId).map((d) => d.id)).toEqual(reversed);
    await expect(reorderProjectDetails(alice, { projectId, orderedIds: [ids[0]!] })).rejects.toMatchObject({ code: "invalid_detail_order" });
    await expect(reorderProjectDetails(bob, { projectId, orderedIds: ids })).rejects.toMatchObject({ code: "not_found" });
  });

  it("readiness: one complete experience + one complete project → ready", async () => {
    const r = await getDataReadiness(alice);
    expect(r.counts).toMatchObject({ complete_experiences: 1, complete_projects: 1 });
    expect(r.features.insight.ready).toBe(true);
    expect(r.features.culture_fit_interview.data_sufficiency).toBe("ok");
    const b = await getDataReadiness(bob);
    expect(b.features.draft).toMatchObject({ ready: false, next_action: "form" });
  });

  it("career tree groups by year (experience 2023→now, project in 2024)", async () => {
    const tree = await getCareerTree(alice, new Date("2026-10-25T00:00:00Z"));
    const y2024 = tree.years.find((y) => y.year === 2024)!;
    expect(y2024.affiliations.find((a) => a.id === experienceId)?.projectIds).toEqual([projectId]);
    expect(tree.years.find((y) => y.year === 2023)!.affiliations.find((a) => a.id === experienceId)?.projectIds).toEqual([]);
    expect(tree.isEmpty).toBe(false);
    expect(tree.projects.find((p) => p.id === projectId)).toMatchObject({ detailCount: 2, completeDetailCount: 1, skillIds: [] });
  });

  it("deleting the last complete detail sends the project back to draft", async () => {
    const impact = await getDeletionImpact(alice, { entityType: "project_detail", entityId: detailId, affiliationMode: "keep_projects" });
    expect(impact.cascade.achievements).toBe(1);
    expect(impact.affected_results.by_application_project).toEqual([]);
    const res = await deleteCareerItem(alice, {
      entityType: "project_detail",
      entityId: detailId,
      affiliationMode: "keep_projects",
      resultMode: "keep_results",
    });
    // QA-S2-04: the response carries the parent's new state for the open project form.
    expect(res.updatedProjects).toEqual([{ id: projectId, status: "draft", updatedAt: expect.any(String) }]);
    const tree = await getCareerTree(alice);
    const project = tree.projects.find((p) => p.id === projectId);
    expect(project?.status).toBe("draft");
    expect(project?.updatedAt).toBe(res.updatedProjects[0]!.updatedAt);
  });

  it("deleting an experience keeps its projects as standalone by default", async () => {
    const impact = await getDeletionImpact(alice, { entityType: "experience", entityId: experienceId, affiliationMode: "delete_projects" });
    expect(impact.cascade.projects).toBe(1);
    const res = await deleteCareerItem(alice, {
      entityType: "experience",
      entityId: experienceId,
      affiliationMode: "keep_projects",
      resultMode: "keep_results",
    });
    expect(res).toMatchObject({ entity_type: "experience", cascade: { projects: 0 } });
    expect(res.updatedProjects.map((p) => p.id)).toEqual([projectId]);
    const tree = await getCareerTree(alice);
    expect(tree.projects.find((p) => p.id === projectId)?.experienceId).toBeNull();
    await expect(
      deleteCareerItem(bob, { entityType: "project", entityId: projectId, affiliationMode: "keep_projects", resultMode: "keep_results" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
