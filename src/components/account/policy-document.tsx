/**
 * S-30 처리방침·약관 열람 (NFR-PRV-10) — one policy document per page (/policies/{policy_type}).
 * Server component: static copy from policy-content.ts plus the current policy_versions row.
 * (UX v5.17 SD-A13) `ai_data_use` = 같은 페이지 모양, 머리글은 `policy_versions`(ai_data_use) 행, 본문 = 조항 +
 * **공급자별 요약 단락**(`ai_disclosures` 6행 — 공급자·등급마다 소제목 + 단락, design-system 6 A1 · G-74).
 */
import Link from "next/link"
import type { AiDisclosure, PolicyType, PolicyVersion } from "@/types/db"
import { DISCLOSURE_FACTS } from "@/lib/ai-disclosures"
import { CONNECTION_TIER_LABELS, formatDate } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { AI_DATA_USE_SECTIONS, POLICY_DOCUMENTS, POLICY_TYPES, POLICY_TYPE_LABELS, type PolicySection } from "./policy-content"
import { PROVIDER_ROW_NAMES } from "./provider-names"

export function PolicyDocument({
  type,
  version,
  disclosures = [],
}: {
  type: PolicyType
  version: PolicyVersion
  /** `ai_data_use` only: current `ai_disclosures` rows (provider × tier) */
  disclosures?: AiDisclosure[]
}) {
  const others = POLICY_TYPES.filter((t) => t !== type)
  const sections = type === "ai_data_use" ? AI_DATA_USE_SECTIONS : POLICY_DOCUMENTS[type]
  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl leading-8 font-bold">{POLICY_TYPE_LABELS[type]}</h1>
        <p className="text-sm leading-5 text-muted-foreground tabular-nums">
          버전 {version.version} · 시행일 {formatDate(version.effective_at)}
        </p>
      </header>
      {sections.map((section, i) => (
        <Section key={section.heading} index={i + 1} section={section} />
      ))}
      {type === "ai_data_use" ? <ProviderSummaries index={sections.length + 1} disclosures={disclosures} /> : null}
      <nav aria-label="다른 문서" className="border-t pt-6">
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {others.map((t) => (
            <li key={t}>
              <Link
                href={routes.policies(t)}
                className="underline underline-offset-4 hover:text-foreground max-md:inline-flex max-md:min-h-8 max-md:items-center"
              >
                {POLICY_TYPE_LABELS[t]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </article>
  )
}

function Section({ index, section }: { index: number; section: PolicySection }) {
  return (
    <section className="space-y-2">
      <h2 className="text-base leading-6 font-semibold">
        {index}. {section.heading}
      </h2>
      {section.paragraphs?.map((p) => (
        <p key={p} className="text-base leading-[1.75]">
          {p}
        </p>
      ))}
      {section.items ? (
        <ul className="list-disc space-y-1 pl-5 text-base leading-[1.75]">
          {section.items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {section.notes?.map((p) => (
        <p key={p} className="text-base leading-[1.75]">
          {p}
        </p>
      ))}
    </section>
  )
}

/**
 * 공급자별 요약 (`ai_disclosures` 6행). 단락 문장은 C-21 고지 사실(`DISCLOSURE_FACTS`, AI C-7.1)을 잇고,
 * 행의 고지 버전·약관 확인일을 덧붙인다 [UI-가정] (G-74 — 표·탭으로 만들지 않는다).
 */
function ProviderSummaries({ index, disclosures }: { index: number; disclosures: AiDisclosure[] }) {
  return (
    <section className="space-y-4">
      <h2 className="text-base leading-6 font-semibold">
        {index}. 공급자별 데이터 사용
      </h2>
      {disclosures.length === 0 ? (
        // [UI-가정] 고지 행을 읽지 못했을 때
        <p className="text-base leading-[1.75]">공급자별 고지를 불러오지 못했어요. 잠시 후 다시 확인해 주세요.</p>
      ) : (
        disclosures.map((d) => {
          const facts = DISCLOSURE_FACTS[d.provider][d.connection_tier]
          return (
            <div key={`${d.provider}-${d.connection_tier}`} className="space-y-1">
              <h3 className="text-base leading-6 font-semibold">
                {PROVIDER_ROW_NAMES[d.provider]}({CONNECTION_TIER_LABELS[d.connection_tier]})
              </h3>
              <p className="text-base leading-[1.75]">
                처리 국가: {facts.country}. 학습: {facts.training}. 사람 검토: {facts.human_review}. 보관: {facts.retention}.
              </p>
              <p className="text-sm leading-5 text-muted-foreground tabular-nums">
                고지 {d.version} · 시행일 {formatDate(d.effective_at)}
                {d.terms_checked_at ? ` · 공급자 약관 확인일 ${formatDate(d.terms_checked_at)}` : ""} ·{" "}
                <a href={facts.terms_url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4 hover:text-foreground">
                  공급자 약관 보기
                </a>
              </p>
            </div>
          )
        })
      )}
    </section>
  )
}
