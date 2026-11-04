/**
 * S-30 처리방침·약관 열람 (NFR-PRV-10) — one policy document per page (/policies/{policy_type}).
 * Server component: static copy from policy-content.ts plus the current policy_versions row.
 */
import Link from "next/link"
import type { PolicyType, PolicyVersion } from "@/types/db"
import { formatDate } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { POLICY_DOCUMENTS, POLICY_TYPES, POLICY_TYPE_LABELS } from "./policy-content"

export function PolicyDocument({ type, version }: { type: PolicyType; version: PolicyVersion }) {
  const others = POLICY_TYPES.filter((t) => t !== type)
  return (
    <article className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl leading-8 font-bold">{POLICY_TYPE_LABELS[type]}</h1>
        <p className="text-sm leading-5 text-muted-foreground tabular-nums">
          버전 {version.version} · 시행일 {formatDate(version.effective_at)}
        </p>
      </header>
      {POLICY_DOCUMENTS[type].map((section, i) => (
        <section key={section.heading} className="space-y-2">
          <h2 className="text-base leading-6 font-semibold">
            {i + 1}. {section.heading}
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
      ))}
      <nav aria-label="다른 문서" className="border-t pt-6">
        <ul className="flex flex-wrap gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {others.map((t) => (
            <li key={t}>
              <Link
                href={routes.policies(t)}
                className="underline underline-offset-4 hover:text-foreground max-md:inline-flex max-md:min-h-11 max-md:items-center"
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
