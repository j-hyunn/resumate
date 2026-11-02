import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AddManualSkillInput,
  AddProjectSkillInput,
  CreateProjectInput,
  SaveDeliverableInput,
  SaveEducationInput,
  SaveExperienceInput,
  SaveProjectInput,
} from "@/lib/contracts/career";
import type { Database } from "@/server/db/database.types";
import { hasTable, isStackReady, readLocalSupabase } from "@/test/local-supabase";
import {
  addManualSkill,
  addProjectSkill,
  createProject,
  deleteCareerItem,
  getCareerList,
  getDataReadiness,
  getDeletionImpact,
  getDeliverable,
  getExperienceDetail,
  getProjectDetail,
  getStandaloneProjectDetail,
  removeProjectSkill,
  reorderProjectDeliverables,
  saveDeliverable,
  saveEducation,
  saveExperience,
  saveProject,
} from "./index";

/**
 * Career services v4.4 (R4) against the local stack as real user sessions:
 * DB-computed status on section saves, affiliated (STAR) vs standalone
 * (description / deliverables / skills) projects, optimistic concurrency,
 * cross-user isolation, readiness v4.4, deletion v4.4 (CR-15 cascade).
 * Skips when the stack isn't running or the R4 migrations aren't applied.
 */

const stack = readLocalSupabase();
const ready = stack ? (await isStackReady(stack)) && (await hasTable(stack, "project_deliverables")) : false;

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
  let standaloneId = "";

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
    await deleteCareerItem(alice, { entityType: "experience", entityId: id, resultMode: "keep_results" });
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
    await deleteCareerItem(alice, { entityType: "experience", entityId: id, resultMode: "keep_results" });
  });

  it("isCurrent → end month cleared; a stored end month can't break the CHECK", async () => {
    const e = await saveExperience(alice, SaveExperienceInput.parse({ id: newId(), companyName: "베타", startMonth: "2020-01", endMonth: "2021-06", jobRank: "사원" }));
    await expect(saveExperience(alice, SaveExperienceInput.parse({ id: e.id, isCurrent: true }))).resolves.toMatchObject({ status: "complete" });
    await deleteCareerItem(alice, { entityType: "experience", entityId: e.id, resultMode: "keep_results" });
  });

  it("another user can't see or edit the row (not_found), nor attach a project to it", async () => {
    await expect(saveExperience(bob, SaveExperienceInput.parse({ id: experienceId, summary: "hack" }))).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(
      createProject(bob, CreateProjectInput.parse({ name: "x", affiliation: { type: "experience", id: experienceId } })),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("C-23 create (CR-6): name only → draft; STAR section saves make it complete (name + situation + action)", async () => {
    const id = newId();
    const p = await createProject(alice, CreateProjectInput.parse({ id, name: "결제 개선", affiliation: { type: "experience", id: experienceId } }));
    expect(p).toMatchObject({ id, status: "draft" });
    // A retried create with the same client id is the same row.
    await expect(createProject(alice, CreateProjectInput.parse({ id, name: "결제 개선", affiliation: { type: "experience", id: experienceId } }))).resolves.toMatchObject({ id });
    projectId = id;
    const s1 = await saveProject(alice, SaveProjectInput.parse({ id, expectedUpdatedAt: p.updatedAt, situation: "결제 승인 응답이 느렸다", startMonth: "2024-02" }));
    expect(s1.status).toBe("draft");
    const s2 = await saveProject(alice, SaveProjectInput.parse({ id, expectedUpdatedAt: s1.updatedAt, action: "인덱스를 재설계했다" }));
    expect(s2.status).toBe("complete");
    // Stale section save → conflict.
    await expect(saveProject(alice, SaveProjectInput.parse({ id, expectedUpdatedAt: s1.updatedAt, result: "x" }))).rejects.toMatchObject({ code: "conflict" });
    // Classification + is_current (clears end month).
    await expect(
      saveProject(alice, SaveProjectInput.parse({ id, projectType: "improvement", competencies: ["analysis", "execution"], endMonth: "2024-06" })),
    ).resolves.toMatchObject({ status: "complete" });
    await saveProject(alice, SaveProjectInput.parse({ id, isCurrent: true }));
    const row = await alice.from("projects").select("is_current, end_month, competencies, project_type").eq("id", id).single();
    expect(row.data).toEqual({ is_current: true, end_month: null, competencies: ["analysis", "execution"], project_type: "improvement" });
  });

  it("DM-20: standalone-only columns on an affiliated project are refused; scope can't change", async () => {
    await expect(saveProject(alice, SaveProjectInput.parse({ id: projectId, description: "내용" }))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(saveProject(alice, SaveProjectInput.parse({ id: projectId, affiliation: { type: "none" } }))).rejects.toMatchObject({
      code: "project_scope_change_not_allowed",
    });
    await expect(saveProject(bob, SaveProjectInput.parse({ id: projectId, name: "탈취" }))).rejects.toMatchObject({ code: "not_found" });
  });

  it("standalone project (S-43): description completes it; deliverables + skills only here", async () => {
    const p = await createProject(alice, CreateProjectInput.parse({ name: "사이드 프로젝트", affiliation: { type: "none" } }));
    standaloneId = p.id;
    await expect(saveProject(alice, SaveProjectInput.parse({ id: p.id, situation: "s" }))).rejects.toMatchObject({ code: "invalid_input" });
    const done = await saveProject(alice, SaveProjectInput.parse({ id: p.id, role: "1인 개발", description: "가계부 앱", linkUrl: "https://example.com" }));
    expect(done.status).toBe("complete");

    const d1 = await saveDeliverable(alice, SaveDeliverableInput.parse({ id: newId(), projectId: p.id, title: "설계 문서", body: "# 구조" }));
    const d2 = await saveDeliverable(alice, SaveDeliverableInput.parse({ id: newId(), projectId: p.id, title: "회고" }));
    await expect(saveDeliverable(alice, SaveDeliverableInput.parse({ id: d1.id, expectedUpdatedAt: d1.updatedAt, body: "## 구조" }))).resolves.toMatchObject({ id: d1.id });
    await expect(saveDeliverable(alice, SaveDeliverableInput.parse({ id: newId(), projectId, title: "x" }))).rejects.toMatchObject({
      code: "deliverable_requires_standalone_project",
    });
    await expect(saveDeliverable(bob, SaveDeliverableInput.parse({ id: newId(), projectId: p.id, title: "x" }))).rejects.toMatchObject({ code: "not_found" });

    await reorderProjectDeliverables(alice, { projectId: p.id, orderedIds: [d2.id, d1.id] });
    await expect(reorderProjectDeliverables(alice, { projectId: p.id, orderedIds: [d1.id] })).rejects.toMatchObject({ code: "conflict" });

    const t = await addProjectSkill(alice, AddProjectSkillInput.parse({ projectId: p.id, name: "Type  Script" }));
    const again = await addProjectSkill(alice, AddProjectSkillInput.parse({ projectId: p.id, name: "type script" }));
    expect(again.skill.id).toBe(t.skill.id);
    await expect(addProjectSkill(alice, AddProjectSkillInput.parse({ projectId, name: "Go" }))).rejects.toMatchObject({
      code: "project_skill_requires_standalone_project",
    });

    const detail = await getStandaloneProjectDetail(alice, p.id);
    expect(detail).toMatchObject({ project: { scope: "standalone", role: "1인 개발", linkUrl: "https://example.com" }, deliverableLimitReached: false });
    expect(detail!.deliverables.map((d) => d.title)).toEqual(["회고", "설계 문서"]);
    expect(detail!.deliverables[0]).not.toHaveProperty("body");
    expect(detail!.skills.map((s) => s.name)).toEqual(["Type Script"]);
    await expect(getDeliverable(alice, d1.id)).resolves.toMatchObject({ deliverable: { body: "## 구조" }, project: { id: p.id, name: "사이드 프로젝트" } });
    await expect(getDeliverable(bob, d1.id)).resolves.toBeNull();
    expect(await getStandaloneProjectDetail(alice, projectId)).toBeNull();

    // The last unlink deletes a tag skill, not a manual one.
    await expect(removeProjectSkill(alice, { projectId: p.id, skillId: t.skill.id })).resolves.toEqual({ removed: true, skillDeleted: true });
    const manual = await addManualSkill(alice, AddManualSkillInput.parse({ name: "Go", proficiency: "practical" }));
    await addProjectSkill(alice, AddProjectSkillInput.parse({ projectId: p.id, name: "go" }));
    await expect(removeProjectSkill(alice, { projectId: p.id, skillId: manual.id })).resolves.toEqual({ removed: true, skillDeleted: false });
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

  it("S-08 list (CR-4): experiences, educations, standalone projects once under their start year; S-09 cards; S-10 page", async () => {
    const list = await getCareerList(alice);
    const all = list.years.flatMap((y) => y.items);
    expect(all.map((i) => i.id)).not.toContain(projectId);
    expect(all.filter((i) => i.id === experienceId)).toHaveLength(1);
    expect(list.years.find((y) => y.year === 2023)!.items.map((i) => i.id)).toContain(experienceId);
    expect(list.years.at(-1)!.year).toBeNull();
    expect(list.years.at(-1)!.items.map((i) => i.id)).toContain(standaloneId);

    const exp = await getExperienceDetail(alice, experienceId);
    expect(exp!.projects).toEqual([expect.objectContaining({ id: projectId, name: "결제 개선", projectType: "improvement", isCurrent: true })]);
    const page = await getProjectDetail(alice, projectId);
    expect(page).toMatchObject({ project: { scope: "affiliated", action: "인덱스를 재설계했다" }, parent: { type: "experience", id: experienceId, name: "알파" }, writingChats: [] });
    expect(await getProjectDetail(alice, standaloneId)).toBeNull();
    expect(await getProjectDetail(bob, projectId)).toBeNull();
  });

  it("readiness v4.4: ready with a complete experience + affiliated project; bob → form", async () => {
    const r = await getDataReadiness(alice);
    expect(r.counts).toMatchObject({ complete_experiences: 1, complete_projects: 2, projects_without_complete_star: 0 });
    expect(r.features.insight.ready).toBe(true);
    const b = await getDataReadiness(bob);
    expect(b.features.draft).toMatchObject({ ready: false, next_action: "form" });
    expect(b.features.draft).not.toHaveProperty("suggested_mode");
  });

  it("readiness v4.4: an affiliated project without STAR → hint project_star, form + suggested project (no key)", async () => {
    const carol = await signedInUser("career-c");
    const exp = await saveExperience(carol, SaveExperienceInput.parse({ id: newId(), companyName: "감마", startMonth: "2022-01", jobPosition: "백엔드", isCurrent: true }));
    const p = await createProject(carol, CreateProjectInput.parse({ name: "정산 개선", affiliation: { type: "experience", id: exp.id } }));
    const r = await getDataReadiness(carol);
    expect(r.ai_connection).toEqual({ active_provider: null, key_status: null, connection_tier: null, consent_required: null });
    expect(r.counts.projects_without_complete_star).toBe(1);
    for (const f of [r.features.insight, r.features.draft, r.features.job_interview]) {
      expect(f).toMatchObject({ ready: false, next_action: "form", suggested_project_id: p.id });
      expect(f.hints).toContain("project_star");
    }
  });

  it("deletion v4.4: deliverable (no cascade), project (deliverables + skills), experience takes its projects (CR-15)", async () => {
    const detail = await getStandaloneProjectDetail(alice, standaloneId);
    const dlv = detail!.deliverables[0]!.id;
    await expect(getDeletionImpact(alice, { entityType: "project_deliverable", entityId: dlv })).resolves.toMatchObject({
      cascade: { projects: 0, project_deliverables: 0, project_skills: 0, writing_chats: 0 },
    });
    await deleteCareerItem(alice, { entityType: "project_deliverable", entityId: dlv, resultMode: "keep_results" });
    const sp = await getDeletionImpact(alice, { entityType: "project", entityId: standaloneId });
    // The skill links were removed above; one deliverable is left.
    expect(sp.cascade).toMatchObject({ project_deliverables: 1, project_skills: 0 });

    await expect(getDeletionImpact(alice, { entityType: "experience", entityId: experienceId, affiliationMode: "keep_projects" as never })).rejects.toMatchObject({
      code: "invalid_input",
    });
    const impact = await getDeletionImpact(alice, { entityType: "experience", entityId: experienceId });
    expect(impact.cascade).toMatchObject({ projects: 1 });
    await expect(deleteCareerItem(bob, { entityType: "project", entityId: projectId, resultMode: "keep_results" })).rejects.toMatchObject({ code: "not_found" });
    const res = await deleteCareerItem(alice, { entityType: "experience", entityId: experienceId, resultMode: "keep_results" });
    expect(res).toMatchObject({ entity_type: "experience", affiliation_mode: "delete_projects", cascade: { projects: 1 } });
    const gone = await alice.from("projects").select("id").eq("id", projectId);
    expect(gone.data).toEqual([]);
  });
});
