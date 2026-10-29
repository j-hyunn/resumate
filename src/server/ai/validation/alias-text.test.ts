import { describe, expect, it } from "vitest";
import { AliasMap, type AliasEntry } from "../context-pack/aliases";
import { aliasDisplayLabel, literalAliasTokens, replaceAliasesInText } from "./alias-text";

const entry = (alias: string, sourceType: AliasEntry["sourceType"], fields: Record<string, string | null>, label: string | null = null): AliasEntry => ({
  alias,
  sourceType,
  id: `id-${alias}`,
  fields,
  snapshotAt: null,
  label,
  parents: [],
});

function map(): AliasMap {
  const m = new AliasMap();
  m.add(entry("PRJ-3", "project", { name: "정산 배치 재설계" }));
  m.add(entry("DET-5", "project_detail", { title: "배치 재설계" }, "정산 배치 재설계 › 배치 재설계"));
  m.add(entry("REQ-2", "jd_requirement", { "": "Kotlin 사용 경험" }));
  m.add(entry("SKL-1", "skill", { name: "Spring Boot" }));
  m.add(entry("EXP-1", "experience", {}, "예시페이"));
  m.add(entry("PROFILE", "profile", {}));
  m.add(entry("S12", "jd_sentence", { "": "Kafka 등 메시지 큐 운영 경험이 있으면 좋습니다 그리고 이 문장은 꽤 깁니다" }));
  return m;
}

describe("replaceAliasesInText (QA-S6-04)", () => {
  it.each<[string, string, string, { replaced: number; removed: number }]>([
    ["project", "PRJ-3의 재시도 큐 설계를 정리해 두세요.", "'정산 배치 재설계'의 재시도 큐 설계를 정리해 두세요.", { replaced: 1, removed: 0 }],
    ["detail with field suffix", "DET-5.action에서 보듯", "'배치 재설계'에서 보듯", { replaced: 1, removed: 0 }],
    ["requirement", "REQ-2 요건은 부분 충족입니다.", "'Kotlin 사용 경험' 요건은 부분 충족입니다.", { replaced: 1, removed: 0 }],
    ["skill (unquoted)", "SKL-1 태그만 있습니다.", "Spring Boot 태그만 있습니다.", { replaced: 1, removed: 0 }],
    ["experience label", "EXP-1에서", "'예시페이'에서", { replaced: 1, removed: 0 }],
    ["profile", "PROFILE 기준", "프로필 기준", { replaced: 1, removed: 0 }],
    ["long sentence clipped", "S12 문장", "'Kafka 등 메시지 큐 운영 경험이 있으면 좋습니다 그리고 이 문장은…' 문장", { replaced: 1, removed: 0 }],
    ["unknown alias removed, parens tidied", "결제 경험(PRJ-99)이 있습니다.", "결제 경험이 있습니다.", { replaced: 0, removed: 1 }],
    ["several", "PRJ-3, REQ-2", "'정산 배치 재설계', 'Kotlin 사용 경험'", { replaced: 2, removed: 0 }],
    ["no alias untouched", "  그대로  둡니다 ", "  그대로  둡니다 ", { replaced: 0, removed: 0 }],
    ["alias-like inside a word untouched", "EC2와 K8s, OAuth2", "EC2와 K8s, OAuth2", { replaced: 0, removed: 0 }],
  ])("%s", (_, input, expected, stats) => {
    const out = replaceAliasesInText(input, map());
    expect(out.text).toBe(expected);
    expect(out.stats).toEqual(stats);
  });

  it("tokens that occur in the user's data are kept (e.g. AWS S3)", () => {
    const literal = literalAliasTokens(["AWS S3 마이그레이션", "티켓 REQ-2 처리"]);
    expect([...literal].sort()).toEqual(["REQ-2", "S3"]);
    const m = map();
    m.add(entry("S3", "jd_sentence", { "": "주요 업무" }));
    expect(replaceAliasesInText("S3 업로드와 REQ-2 처리, PRJ-3", m, literal).text).toBe("S3 업로드와 REQ-2 처리, '정산 배치 재설계'");
  });

  it("aliasDisplayLabel falls back to the entry label", () => {
    expect(aliasDisplayLabel(entry("ACH-1", "achievement", { metric: "x" }, "응답 시간"))).toBe("'응답 시간'");
    expect(aliasDisplayLabel(entry("ACH-2", "achievement", {}, null))).toBeNull();
  });
});
