"use client"

/**
 * S-42 AI 사용량 미터 (02 S-42, F-AI-07, design-system 5.7) — shared by the `/settings/ai/usage`
 * page and the settings dialog section "AI 사용량". 이번 달(KST)만, 기능별·공급자별, 예상치 고지 상시.
 *
 * Never reads `?state=` (the dialog is outside <Suspense>); the page passes `preview`:
 * ai-locked (연결 전, C-18 영역형) · empty (연결했지만 이번 달 기록 없음) · error · loading
 */
import * as React from "react"
import { ArrowUpDown, ChevronDown, Gauge, Info, RotateCcw } from "lucide-react"
import type { AiPriceTable, AiUsageSummary } from "@/types/db"
import { cn } from "@/lib/utils"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { getAiConnectionStateAction, getAiUsageSummaryAction } from "@/lib/data/actions"
import { AI_USAGE_FEATURE_LABELS, CONNECTION_TIER_LABELS, displayInputTokens } from "@/lib/data/labels"
import { AI_PROVIDER_FULL_NAMES, AI_PROVIDER_LABELS, AI_PROVIDER_ORDER, AI_PROVIDERS } from "@/lib/mock/ai-providers"
import { routes } from "@/lib/routes"
import { AiLock } from "@/components/common/ai-lock"
import { ExternalProviderLink } from "@/components/common/ai-error-notice"
import { EmptyState } from "@/components/common/state-views"
import { formatKstDay, formatTokens, formatUnitPrice, formatUsd } from "./ai-format"
import { getAiPriceTablesAction } from "@/lib/data/actions"

type Load =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; summary: AiUsageSummary; prices: AiPriceTable[]; connected: boolean }

async function loadUsage(preview: string | null): Promise<Load> {
  try {
    if (preview === "error") throw new Error("preview error")
    const [summary, state] = await Promise.all([getAiUsageSummaryAction(), getAiConnectionStateAction()])
    const versions = summary.price_table_versions.map((v) => v.version)
    const prices = await getAiPriceTablesAction(versions.length ? versions : undefined)
    const noRecords = preview === "ai-locked" || preview === "empty"
    return {
      status: "ready",
      summary: noRecords ? emptySummary(summary) : summary,
      prices,
      connected: preview === "ai-locked" ? false : preview === "empty" ? true : !!state.connection.active_provider,
    }
  } catch {
    return { status: "error" }
  }
}

type SortKey = "order" | "cost" | "input" | "output" | "calls"

export function AiUsagePanel({
  variant = "page",
  onNavigate,
  preview = null,
}: {
  variant?: "page" | "section"
  onNavigate?: () => void
  /** page-only `?state=` value */
  preview?: string | null
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" })

  const fetchData = React.useCallback(async () => setLoad(await loadUsage(preview)), [preview])

  React.useEffect(() => {
    let alive = true
    void loadUsage(preview).then((l) => alive && setLoad(l))
    return () => {
      alive = false
    }
  }, [preview])

  return (
    <div className="space-y-6">
      <FixedNotice sticky={variant === "page" ? "top-16" : "top-0"} />
      {load.status === "loading" ? (
        <UsageSkeleton />
      ) : load.status === "error" ? (
        <section role="alert" className="space-y-3 py-6 text-center">
          {/* [UI-가정] design-system 5.7 오류 문구 */}
          <p className="text-base">사용량을 불러오지 못했어요</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoad({ status: "loading" })
              void fetchData()
            }}
          >
            <RotateCcw aria-hidden />
            다시 불러오기
          </Button>
        </section>
      ) : (
        <UsageBody data={load} onNavigate={onNavigate} />
      )}
    </div>
  )
}

function emptySummary(s: AiUsageSummary): AiUsageSummary {
  return {
    ...s,
    totals: { input_tokens: 0, cached_input_tokens: 0, cache_write_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, calls: 0, failed_calls: 0 },
    by_feature: s.by_feature.map((f) => ({ ...f, input_tokens: 0, output_tokens: 0, estimated_cost_usd: 0, calls: 0 })),
    by_provider: [],
    price_table_versions: [],
  }
}

/** 상시 고지 — 숨기거나 닫을 수 없음 (F-AI-07 (4)) */
function FixedNotice({ sticky }: { sticky: string }) {
  return (
    <div className={cn("sticky z-10 bg-background pb-1", sticky)}>
      <Alert variant="info">
        <Info aria-hidden />
        <AlertDescription className="space-y-1">
          <p>
            <span className="font-semibold">예상치이며 공급자 청구서가 아니에요.</span> 실제 청구는 공급자 대시보드에서 확인하세요
          </p>
          <p className="flex flex-wrap gap-x-3">
            {AI_PROVIDER_ORDER.map((p) => (
              <ExternalProviderLink key={p} href={AI_PROVIDERS[p].dashboard_url}>{`${AI_PROVIDER_LABELS[p]} 대시보드`}</ExternalProviderLink>
            ))}
          </p>
        </AlertDescription>
      </Alert>
    </div>
  )
}

function UsageSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <span className="sr-only">사용량을 불러오는 중</span>
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-24 w-full rounded-lg" />
      <Skeleton className="h-64 w-full rounded-lg" />
      <Skeleton className="h-32 w-full rounded-lg" />
    </div>
  )
}

function UsageBody({
  data,
  onNavigate,
}: {
  data: Extract<Load, { status: "ready" }>
  onNavigate?: () => void
}) {
  const { summary, prices, connected } = data
  const hasRecords = summary.totals.calls > 0
  // 02 S-42: 기간 = "2026년 10월 1일 ~ 오늘" (KST 달력 월)
  const period = `${formatKstDay(`${summary.period_month}T00:00:00+09:00`)} ~ 오늘 (KST)`

  // 연결 전 빈 상태 = C-18 영역형. 키를 지웠어도 기록이 있으면 표를 보인다.
  if (!hasRecords && !connected)
    return (
      <div
        onClickCapture={(e) => {
          if ((e.target as HTMLElement).closest("a")) onNavigate?.()
        }}
      >
        <React.Suspense fallback={null}>
          <AiLock entry="usage" size="area" featureLabel="AI 사용량" returnHref={routes.aiUsage()} />
        </React.Suspense>
      </div>
    )

  return (
    <div className="space-y-6">
      <p className="text-sm leading-5 text-muted-foreground tabular-nums">{period}</p>

      {!hasRecords ? (
        <EmptyState icon={Gauge} title="이번 달에는 아직 AI를 쓰지 않았어요" className="py-8" />
      ) : (
        <>
          <Card className="grid grid-cols-1 gap-4 p-5 md:grid-cols-3">
            <Total label="예상 비용" value={formatUsd(summary.totals.estimated_cost_usd)} />
            <Total label="입력 토큰" value={formatTokens(displayInputTokens(summary.totals))} />
            <Total label="출력 토큰" value={formatTokens(summary.totals.output_tokens)} />
          </Card>
          <FeatureTable summary={summary} />
          <ProviderTable summary={summary} />
        </>
      )}

      <PriceInfo summary={summary} prices={prices} />

      <ul className="space-y-1 text-sm leading-5 text-muted-foreground">
        <li className="flex items-start gap-1.5">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Resumate 밖에서 같은 키로 쓴 사용량은 포함되지 않아요. 실패한 호출도 공급자가 토큰을 알려 주면 포함돼요
        </li>
        <li className="flex items-start gap-1.5">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          AI 사용 후 1분 안에 반영돼요
        </li>
      </ul>
    </div>
  )
}

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <p className="text-xs leading-4 font-medium text-muted-foreground">{label}</p>
      <p className="text-2xl leading-8 font-semibold tabular-nums">{value}</p>
    </div>
  )
}

const SORT_LABELS: Record<SortKey, string> = {
  order: "기본 순서",
  cost: "예상 비용 순",
  input: "입력 토큰 순",
  output: "출력 토큰 순",
  calls: "호출 수 순",
}

function FeatureTable({ summary }: { summary: AiUsageSummary }) {
  const [sort, setSort] = React.useState<SortKey>("order")
  const rows = React.useMemo(() => {
    const list = [...summary.by_feature]
    const val = (r: (typeof list)[number]) =>
      sort === "cost" ? r.estimated_cost_usd : sort === "input" ? r.input_tokens : sort === "output" ? r.output_tokens : r.calls
    if (sort !== "order") list.sort((a, b) => val(b) - val(a))
    return list
  }, [summary.by_feature, sort])

  const head = (key: SortKey, label: string) => (
    <TableHead className="text-right" aria-sort={sort === key ? "descending" : "none"}>
      <Button variant="ghost" size="sm" className="-mr-2 h-8 px-2" onClick={() => setSort(sort === key ? "order" : key)}>
        {label}
        <ArrowUpDown className="size-3.5" aria-hidden />
      </Button>
    </TableHead>
  )

  return (
    <Card className="gap-3 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg leading-7 font-semibold">기능별</h2>
        {/* 좁은 화면 정렬 (5.7) */}
        <div className="md:hidden">
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger size="sm" aria-label="기능별 정렬">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <SelectItem key={k} value={k}>
                  정렬: {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      {/* ≥768: table */}
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>기능</TableHead>
              {head("input", "입력 토큰")}
              {head("output", "출력 토큰")}
              {head("cost", "예상 비용")}
              {head("calls", "호출 수")}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.feature} className={r.calls === 0 ? "text-muted-foreground" : undefined}>
                <TableCell className="text-sm">{AI_USAGE_FEATURE_LABELS[r.feature]}</TableCell>
                <TableCell className="text-right tabular-nums">{formatTokens(r.input_tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatTokens(r.output_tokens)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatUsd(r.estimated_cost_usd)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatTokens(r.calls)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* <768: two-line rows */}
      <ul className="divide-y md:hidden">
        {rows.map((r) => (
          <li key={r.feature} className={cn("space-y-0.5 py-2.5", r.calls === 0 && "text-muted-foreground")}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-base">{AI_USAGE_FEATURE_LABELS[r.feature]}</span>
              <span className="font-medium tabular-nums">{formatUsd(r.estimated_cost_usd)}</span>
            </div>
            <p className="text-sm text-muted-foreground tabular-nums">
              입력 {formatTokens(r.input_tokens)} · 출력 {formatTokens(r.output_tokens)} · 호출 {formatTokens(r.calls)}회
            </p>
          </li>
        ))}
      </ul>
    </Card>
  )
}

const FREE_ROW_NOTE = "무료 등급: 청구되지 않을 수 있어요(유료 단가로 환산한 예상치)"

function ProviderTable({ summary }: { summary: AiUsageSummary }) {
  const rows = summary.by_provider
  return (
    <Card className="gap-3 p-5">
      <h2 className="text-lg leading-7 font-semibold">공급자별</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">이번 달 기록이 없어요</p>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>공급자</TableHead>
                  <TableHead>등급</TableHead>
                  <TableHead className="text-right">토큰(입력+출력)</TableHead>
                  <TableHead className="text-right">예상 비용</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <React.Fragment key={`${r.provider}-${r.connection_tier}`}>
                    <TableRow className={r.connection_tier === "free" ? "border-b-0" : undefined}>
                      <TableCell className="text-sm">{AI_PROVIDER_FULL_NAMES[r.provider]}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{CONNECTION_TIER_LABELS[r.connection_tier]}</Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{formatTokens(r.input_tokens + r.output_tokens)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsd(r.estimated_cost_usd)}</TableCell>
                    </TableRow>
                    {r.connection_tier === "free" ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={4} className="pt-0 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Info className="size-3.5 shrink-0" aria-hidden />
                            {FREE_ROW_NOTE}
                          </span>
                        </TableCell>
                      </TableRow>
                    ) : null}
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="divide-y md:hidden">
            {rows.map((r) => (
              <li key={`${r.provider}-${r.connection_tier}`} className="space-y-0.5 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-base">
                    {AI_PROVIDER_LABELS[r.provider]}
                    <Badge variant="outline">{CONNECTION_TIER_LABELS[r.connection_tier]}</Badge>
                  </span>
                  <span className="font-medium tabular-nums">{formatUsd(r.estimated_cost_usd)}</span>
                </div>
                <p className="text-sm text-muted-foreground tabular-nums">토큰 {formatTokens(r.input_tokens + r.output_tokens)}</p>
                {r.connection_tier === "free" ? <p className="text-xs text-muted-foreground">{FREE_ROW_NOTE}</p> : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  )
}

function PriceInfo({ summary, prices }: { summary: AiUsageSummary; prices: AiPriceTable[] }) {
  const versions = summary.price_table_versions.length
    ? summary.price_table_versions
    : prices[0]
      ? [{ version: prices[0].version, source_checked_at: prices[0].source_checked_at }]
      : []
  return (
    <div className="space-y-2">
      <p className="text-sm leading-5 text-muted-foreground tabular-nums">
        {versions.map((v) => `가격표 ${v.version} · 기준일 ${v.source_checked_at.replaceAll("-", ".")}`).join(" / ")}
        {versions.length ? " · " : ""}공급자 가격이 바뀌면 갱신해요. 지난 기록은 당시 가격표로 계산돼요
      </p>
      {prices.length ? (
        <Collapsible>
          <CollapsibleTrigger asChild>
            {/* [UI-가정] 가격표 펼쳐 보기 */}
            <Button variant="ghost" size="sm" className="group -ml-2">
              가격표 보기
              <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>모델</TableHead>
                  <TableHead className="text-right">입력 $/MTok</TableHead>
                  <TableHead className="text-right">출력 $/MTok</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prices.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="text-sm">
                      {AI_PROVIDER_LABELS[p.provider]} · <span className="font-mono text-xs">{p.model}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{formatUnitPrice(p.input_usd_per_mtok)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUnitPrice(p.output_usd_per_mtok)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
        </Collapsible>
      ) : null}
    </div>
  )
}
