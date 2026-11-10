import { describe, expect, it } from "vitest";
import { parseCoverLetterDraft } from "@/lib/contracts/writing-chat";
import type { UserSupabaseClient } from "@/server/db/types";
import { fakeSupabase } from "@/test/fake-supabase";
import { loadDocumentSourceLabels } from "./source-labels";

/**
 * R15 후속 4: labels for a reopened 서류 대화's `draft.sources[]`. The local-stack test checks the
 * labels equal the SSE card; this pins the rule per source kind, the deleted case, the order, and
 * that the reads are batched (one query per table, never one per source).
 */

const P = (n: number) => `00000000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const draftWith = (questions: Array<{ slot: string; sources: Array<{ source_type: string; source_id: string; role: "primary" | "supporting" }> }>) =>
  parseCoverLetterDraft({
    target: "cover_letter",
    document: { questions: questions.map((q, i) => ({ slot: q.slot, question_id: P(90 + i), draft: { sources: q.sources, blocks: [] } })) },
  });

function counting(tables: Record<string, Record<string, unknown>[]>) {
  const db = fakeSupabase(tables);
  const client = db.client as { from: (t: string) => unknown };
  const from = client.from.bind(client);
  const calls: string[] = [];
  client.from = (t: string) => {
    calls.push(t);
    return from(t);
  };
  return { client: client as unknown as UserSupabaseClient, calls };
}

const tables = {
  experiences: [{ id: P(1), company_name: "알파" }],
  educations: [{ id: P(2), program_name: "  데이터 분석 과정  ", institution_name: "한빛 아카데미" }, { id: P(3), program_name: "  ", institution_name: "  열린 학교 " }],
  projects: [
    { id: P(11), name: "결제 개선", experience_id: P(1), education_id: null },
    { id: P(12), name: "추천 모델", experience_id: null, education_id: P(2) },
    { id: P(13), name: "개인 블로그", experience_id: null, education_id: null },
  ],
};

describe("loadDocumentSourceLabels", () => {
  it("labels each kind with the shared rule (부모 › 프로젝트, ED-3 education name, standalone = name)", async () => {
    const { client } = counting(tables);
    const labels = await loadDocumentSourceLabels(
      client,
      draftWith([
        {
          slot: "q_1",
          sources: [
            { source_type: "project", source_id: P(11), role: "primary" },
            { source_type: "project", source_id: P(12), role: "supporting" },
            { source_type: "project", source_id: P(13), role: "supporting" },
            { source_type: "experience", source_id: P(1), role: "supporting" },
            // ED-3 fallback: blank program name → trimmed institution name.
            { source_type: "education", source_id: P(3), role: "supporting" },
          ],
        },
      ]),
    );
    expect(labels.q_1!.map((l) => l.label)).toEqual(["알파 › 결제 개선", "데이터 분석 과정 › 추천 모델", "개인 블로그", "알파", "열린 학교"]);
    expect(labels.q_1!.every((l) => !l.deleted)).toBe(true);
  });

  it("a source whose row is gone → deleted, no label, no error", async () => {
    const { client } = counting(tables);
    const labels = await loadDocumentSourceLabels(client, draftWith([{ slot: "q_1", sources: [{ source_type: "project", source_id: P(99), role: "primary" }] }]));
    expect(labels.q_1).toEqual([{ sourceType: "project", sourceId: P(99), label: null, deleted: true }]);
  });

  it("other storable kinds get the evidence chip's kind label (user_note = 내 메모)", async () => {
    const { client } = counting(tables);
    const labels = await loadDocumentSourceLabels(client, draftWith([{ slot: "q_1", sources: [{ source_type: "user_note", source_id: P(90), role: "supporting" }] }]));
    expect(labels.q_1).toEqual([{ sourceType: "user_note", sourceId: P(90), label: "내 메모", deleted: false }]);
  });

  it("keeps each slot's order and gives an empty list to a slot with no sources", async () => {
    const { client } = counting(tables);
    const labels = await loadDocumentSourceLabels(
      client,
      draftWith([
        { slot: "q_1", sources: [{ source_type: "project", source_id: P(13), role: "primary" }, { source_type: "project", source_id: P(11), role: "supporting" }] },
        { slot: "q_2", sources: [] },
      ]),
    );
    expect(labels.q_1!.map((l) => l.sourceId)).toEqual([P(13), P(11)]);
    expect(labels.q_2).toEqual([]);
  });

  it("batches: at most one query per source table, however many sources and slots", async () => {
    const { client, calls } = counting(tables);
    const many = Array.from({ length: 5 }, (_, i) => ({
      slot: `q_${i + 1}`,
      sources: [
        { source_type: "project", source_id: P(11), role: "primary" as const },
        { source_type: "project", source_id: P(12), role: "supporting" as const },
        { source_type: "education", source_id: P(3), role: "supporting" as const },
      ],
    }));
    await loadDocumentSourceLabels(client, draftWith(many));
    expect(calls.sort()).toEqual(["educations", "experiences", "projects"]);
  });

  it("no sources → no query at all", async () => {
    const { client, calls } = counting(tables);
    await loadDocumentSourceLabels(client, draftWith([{ slot: "q_1", sources: [] }]));
    expect(calls).toEqual([]);
  });
});
