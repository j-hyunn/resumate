"use client"

/**
 * S-24 ② 블록 ② 모델 공급자 별 사용량 확인 = S-42 (UX v5.17 S-42 SD-A10~A12, F-AI-07;
 * design-system 5.11.2 `AiUsageByProvider`). 이번 달(KST)만, **공급자 탭 + 그 공급자의 기능별 표 7행**
 * (열 = 기능 / 입력 비용 / 호출 수 / 출력 비용, 토큰은 비용 칸 둘째 줄). 합계 카드·`by_provider` 표 없음.
 * 원천: `get_ai_usage_summary`의 `providers[]` (DM v4.12 2.9.5) + 표시 7행 묶음 `USAGE_FEATURE_DISPLAY_GROUPS`.
 *
 * Never reads `?state=` (the dialog is outside <Suspense>); the AI 연결 탭 passes `preview`:
 * loading · usage-loading · error · usage-error · empty (이번 달 기록 없음) · ai-locked (연결 전)
 */
import * as React from "react"
import { ArrowUpDown, ArrowUpRight, ChevronDown, Info, RotateCcw } from "lucide-react"
import type { AiPriceTable, AiProviderName, ConnectionTier } from "@/types/db"
import type { AiUsageSummary } from "@/lib/contracts/ai"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { getAiPriceTablesAction, getAiUsageSummaryAction } from "@/lib/data/actions"
import { AI_PROVIDERS } from "@/lib/mock/ai-providers"
import { formatKstDay, formatTokens, formatUnitPrice, formatUsd } from "./ai-format"
import { PROVIDER_ROW_NAMES, PROVIDER_ROW_ORDER } from "./provider-names"
import { SETTINGS_ANCHORS } from "./settings-section-list"
import { usageRowsOf, type UsageRow } from "./usage-rows"

type Load = { status: "loading" } | { status: "error" } | { status: "ready"; summary: AiUsageSummary; prices: AiPriceTable[] }

async function loadUsage(preview: string | null): Promise<Load> {
  if (preview === "loading" || preview === "usage-loading") return { status: "loading" }
  try {
    if (preview === "error" || preview === "usage-error") throw new Error("preview error")
    const summary = await getAiUsageSummaryAction()
    const versions = summary.priceTableVersions.map((v) => v.version)
    const prices = await getAiPriceTablesAction(versions.length ? versions : undefined)
    const noRecords = preview === "ai-locked" || preview === "empty"
    return { status: "ready", summary: noRecords ? { ...summary, providers: [], priceTableVersions: [] } : summary, prices }
  } catch {
    return { status: "error" }
  }
}

export function AiUsageByProvider({
  preview = null,
  activeProvider,
  keyTiers,
  connected,
}: {
  preview?: string | null
  /** 기본 탭 = 활성 공급자, 없으면 Gemini (UX S-42 `[가정]`) */
  activeProvider: AiProviderName | null
  /** 공급자마다 그 키의 등급 (키가 없으면 null) — 무료 등급 안내의 판정 원천 (UX S-42 v5.17 리뷰 라운드 1) */
  keyTiers: Record<AiProviderName, ConnectionTier | null>
  /** 등록한 키가 하나라도 있는가 (연결 전 빈 상태 판정) */
  connected: boolean
}) {
  const [load, setLoad] = React.useState<Load>({ status: "loading" })

  React.useEffect(() => {
    let alive = true
    void loadUsage(preview).then((l) => alive && setLoad(l))
    return () => {
      alive = false
    }
  }, [preview])

  return (
    <section id={SETTINGS_ANCHORS.aiUsage} aria-labelledby="settings-ai-usage-heading" className="scroll-mt-4 space-y-3">
      {/* 상시 고지 = 머리 설명 줄 (v5.12 원본 화면, G-76) — 늘 보이고 숨기거나 닫을 수 없음 (F-AI-07 (4)). 문구는 UX (끝 마침표 없음) */}
      <div className="space-y-0.5">
        <h3 id="settings-ai-usage-heading" className="text-base leading-6 font-semibold">
          모델 공급자 별 사용량 확인
        </h3>
        {/* 첫 문장 굵게 = UX 필수 고지 강조 (QP-43-1 리더 판정: UX를 따른다) */}
        <p className="text-sm leading-5 text-muted-foreground">
          <span className="font-medium text-foreground">예상치이며 공급자 청구서가 아니에요.</span> 실제 청구는 공급자 대시보드에서
          확인하세요
        </p>
      </div>
      {load.status === "loading" ? (
        <div className="space-y-3" aria-busy="true">
          <span className="sr-only">사용량을 불러오는 중</span>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-64 w-full rounded-lg" />
        </div>
      ) : load.status === "error" ? (
        <div role="alert" className="space-y-3 py-6 text-center">
          <p className="text-base">사용량을 불러오지 못했어요</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoad({ status: "loading" })
              void loadUsage(preview === "error" || preview === "usage-error" ? null : preview).then(setLoad)
            }}
          >
            <RotateCcw aria-hidden />
            다시 불러오기
          </Button>
        </div>
      ) : !connected && load.summary.providers.length === 0 ? (
        // 연결 전 빈 상태: C-18 영역형이 아니라 한 줄 (블록 ①이 바로 위에 있다)
        <p className="text-sm text-muted-foreground">AI를 연결하면 Resumate에서 쓴 토큰과 예상 비용을 여기서 볼 수 있어요</p>
      ) : (
        <UsageTabs summary={load.summary} prices={load.prices} activeProvider={activeProvider} keyTiers={keyTiers} />
      )}
      <ul className="space-y-1.5 text-sm text-muted-foreground">
        <li className="flex items-start gap-1.5">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          Resumate 밖에서 같은 키로 쓴 사용량은 포함되지 않아요. 실패한 호출도 공급자가 토큰을 알려 주면 포함돼요
        </li>
        <li className="flex items-start gap-1.5">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          AI 사용 후 1분 안에 반영돼요
        </li>
      </ul>
    </section>
  )
}

function UsageTabs({
  summary,
  prices,
  activeProvider,
  keyTiers,
}: {
  summary: AiUsageSummary
  prices: AiPriceTable[]
  activeProvider: AiProviderName | null
  keyTiers: Record<AiProviderName, ConnectionTier | null>
}) {
  const [tab, setTab] = React.useState<AiProviderName>(activeProvider ?? "gemini")
  const anyRecords = summary.providers.length > 0
  // 02 S-42: 기간 = "2026년 11월 1일 ~ 오늘" (KST 달력 월)
  const period = `${formatKstDay(`${summary.periodMonth.slice(0, 10)}T00:00:00+09:00`)} ~ 오늘`
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as AiProviderName)} className="gap-3">
      {/* v5.12: 알약 탭 + 같은 줄 가격 안내 + 오른쪽 끝 대시보드 ↗ (원본 화면) */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <TabsList variant="pill" aria-label="공급자">
          {PROVIDER_ROW_ORDER.map((p) => (
            <TabsTrigger key={p} value={p}>
              {PROVIDER_ROW_NAMES[p]}
            </TabsTrigger>
          ))}
        </TabsList>
        <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          공급자 가격이 바뀌면 갱신해요. 지난 기록은 당시 가격표로 계산돼요
        </p>
        <Button variant="link" size="sm" className="ml-auto h-auto px-0 hover:underline" asChild>
          <a href={AI_PROVIDERS[tab].dashboard_url} target="_blank" rel="noopener noreferrer">
            {PROVIDER_ROW_NAMES[tab]} 대시보드
            <ArrowUpRight className="size-4" aria-hidden />
            <span className="sr-only">(새 탭)</span>
          </a>
        </Button>
      </div>
      {PROVIDER_ROW_ORDER.map((p) => {
        const record = summary.providers.find((x) => x.provider === p)
        const name = PROVIDER_ROW_NAMES[p]
        return (
          <TabsContent key={p} value={p} className="space-y-3">
            {/* 표 위 줄 — 화면엔 없지만 UX (기간 · 무료 등급 · 빈 상태) */}
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground tabular-nums">{period}</p>
              {keyTiers[p] === "free" ? (
                <p className="flex items-start gap-1.5 text-sm text-muted-foreground">
                  <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                  무료 등급: 청구되지 않을 수 있어요(유료 단가로 환산한 예상치)
                </p>
              ) : null}
              {!anyRecords ? (
                <p className="text-sm text-muted-foreground">이번 달에는 아직 AI를 쓰지 않았어요</p>
              ) : !record ? (
                <p className="text-sm text-muted-foreground">{name}로는 이번 달에 아직 AI를 쓰지 않았어요</p>
              ) : null}
            </div>
            <FeatureTable rows={usageRowsOf(record)} />
            <PriceInfo versions={record?.priceTableVersions ?? []} prices={prices.filter((x) => x.provider === p)} />
          </TabsContent>
        )
      })}
    </Tabs>
  )
}

type SortKey = "order" | "input" | "calls" | "output"

const SORT_LABELS: Record<SortKey, string> = {
  order: "기본 순서",
  input: "입력 비용 순",
  calls: "호출 수 순",
  output: "출력 비용 순",
}

function FeatureTable({ rows: source }: { rows: UsageRow[] }) {
  const [sort, setSort] = React.useState<SortKey>("order")
  const rows = React.useMemo(() => {
    const list = [...source]
    // 정렬 기준은 비용 1줄 값 (토큰 아님)
    const val = (r: UsageRow) => (sort === "input" ? r.inputCost : sort === "output" ? r.outputCost : r.calls)
    if (sort !== "order") list.sort((a, b) => val(b) - val(a) || a.order - b.order)
    return list
  }, [source, sort])
  const zero = (r: UsageRow) => r.calls === 0 && r.inputCost === 0 && r.outputCost === 0

  // v5.12: 숫자 열 왼쪽 정렬 (머리 글자와 같은 x), 화살표만 회색으로 작게 — 화면엔 정렬 표시가 없다 (G-78)
  const head = (key: Exclude<SortKey, "order">, label: string, width: string) => (
    <TableHead className={cn("h-10 px-4 text-sm font-medium text-foreground", width)} aria-sort={sort === key ? "descending" : "none"}>
      <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 font-medium" onClick={() => setSort(sort === key ? "order" : key)}>
        {label}
        <ArrowUpDown className="size-3.5 text-muted-foreground" aria-hidden />
      </Button>
    </TableHead>
  )
  const last = rows.length - 1
  const cell = (i: number) => cn("h-auto px-4 py-1.5 align-top", i === 0 && "pt-3", i === last && "pb-3")

  return (
    <>
      {/* 본문 ≥ 512: 표 — 회색 머리 + 둥근 테두리 + 행 구분선 없음 (원본 화면, G-78) */}
      <div className="hidden overflow-hidden rounded-lg border @lg/settings:block">
        <Table className="table-fixed">
          <TableHeader className="bg-muted">
            <TableRow>
              <TableHead className="h-10 px-4 text-sm font-medium text-foreground">기능</TableHead>
              {head("input", "입력 비용(USD)", "w-[20%]")}
              {head("calls", "호출 수", "w-[18%]")}
              {head("output", "출력 비용(USD)", "w-[22%]")}
            </TableRow>
          </TableHeader>
          <TableBody className="[&_tr]:border-0">
            {rows.map((r, i) => (
              <TableRow key={r.label} muted={zero(r)}>
                <TableCell className={cn(cell(i), "text-sm whitespace-normal")}>{r.label}</TableCell>
                <TableCell className={cell(i)}>
                  <CostCell cost={r.inputCost} tokens={r.inputTokens} />
                </TableCell>
                <TableCell className={cn(cell(i), "tabular-nums")}>{formatTokens(r.calls)}</TableCell>
                <TableCell className={cell(i)}>
                  <CostCell cost={r.outputCost} tokens={r.outputTokens} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {/* 본문 < 512: 행 목록 + 정렬 Select (G-70) */}
      <div className="space-y-2 @lg/settings:hidden">
        <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
          <SelectTrigger size="sm" aria-label="기능별 정렬" className="w-fit">
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
        <ul className="divide-y">
          {rows.map((r) => (
            <li key={r.label} className={cn("space-y-0.5 py-2.5", zero(r) && "text-muted-foreground")}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-base">{r.label}</span>
                <span className="text-sm text-muted-foreground tabular-nums">호출 {formatTokens(r.calls)}회</span>
              </div>
              <p className="text-sm text-muted-foreground tabular-nums">
                입력 {formatUsd(r.inputCost)} · {formatTokens(r.inputTokens)} 토큰
              </p>
              <p className="text-sm text-muted-foreground tabular-nums">
                출력 {formatUsd(r.outputCost)} · {formatTokens(r.outputTokens)} 토큰
              </p>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

/** 비용 칸: 1줄 금액 + 2줄 토큰 보조 표기 (UX S-42 "각 비용 칸 아래 보조 표기") */
function CostCell({ cost, tokens }: { cost: number; tokens: number }) {
  return (
    <span className="flex flex-col items-start">
      <span className="tabular-nums">{formatUsd(cost)}</span>
      <span className="text-xs text-muted-foreground tabular-nums">{formatTokens(tokens)} 토큰</span>
    </span>
  )
}

function PriceInfo({ versions, prices }: { versions: AiUsageSummary["priceTableVersions"]; prices: AiPriceTable[] }) {
  if (!versions.length && !prices.length) return null
  const versionLine = versions.length ? (
    <span className="tabular-nums">
      {versions.map((v) => `가격표 ${v.version} · 기준일 ${v.sourceCheckedAt.replaceAll("-", ".")}`).join(" · ")}
    </span>
  ) : null
  // v5.12: 표 바로 아래 한 줄 = 가격표 버전 + "가격표 보기" link (가격 안내 문장은 알약 줄로 옮김). 기록이 없으면 버전 줄을 뺀다 [UI-가정]
  if (!prices.length) return <p className="text-sm text-muted-foreground">{versionLine}</p>
  return (
    <Collapsible>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
        {versionLine}
        <CollapsibleTrigger asChild>
          {/* [UI-가정] 가격표 펼쳐 보기 */}
          <Button variant="link" size="sm" className="group h-auto px-0">
            가격표 보기
            <ChevronDown className="transition-transform group-data-[state=open]:rotate-180" aria-hidden />
          </Button>
        </CollapsibleTrigger>
      </div>
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
                    <TableCell className="font-mono text-xs">{p.model}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUnitPrice(p.input_usd_per_mtok)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatUnitPrice(p.output_usd_per_mtok)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CollapsibleContent>
    </Collapsible>
  )
}
