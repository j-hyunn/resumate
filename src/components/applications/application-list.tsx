"use client"

/**
 * S-13 자기소개서 목록 행 — (v5.20 재작성, CF-3·CF-9·CF-A8·CF-A14 / design-system v5.15 6장 A3 "S-13 목록").
 *
 * 넓은 화면은 `Table` 4열(이름 · 포지션 · 만든 날 · 마감), 좁은 화면은 두 줄 카드. 행 전체가 S-46으로
 * 가고(정본 행이 없으면 문항 설정 상태), 행 끝 `⋯`는 **"자기소개서 삭제"(C-05) 한 항목**이다.
 *
 * **되살리지 않는 것**(CF-3·CF-A14): 전형 단계 칩·전형 결과 배지·단계 이동(C-12)·기능 진행 칸
 * (인사이트·서류 수·면접 수)·정렬 선택·전형 단계 거르기·"보드로 보기". 전형 단계 변경은 S-39에서만 한다.
 * 이름은 화면이 다시 만들지 않고 `application_projects.name`을 그대로 보인다 — v5.20 전에 만든
 * "회사명 – 포지션명"과 새 "{기업 명} 자기소개서"가 **섞여 보이는 것이 정상**이다(UX S-13 `[가정]`).
 */
import * as React from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MoreHorizontal, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { DDay } from "@/components/common/basics"
import type { CoverLetterListRow } from "@/lib/data/cover-letters"
import { applicationDisplayName, formatDate } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { useDeleteApplication } from "./shared"

/**
 * 본문 위 정렬 표기 — 시안 1의 회색 알약(`Button variant="chip"`과 같은 모양) 그대로지만 **바꿀 수 없는 글자**다
 * (정렬 선택·필터·검색 없음, CF-9). 누를 것이 없으므로 버튼·⌄를 두지 않는다 `[UI-가정]`.
 */
export function ApplicationSortNote() {
  return (
    <p className="inline-flex h-8 items-center rounded-full bg-muted px-3 text-sm text-foreground">
      <span className="sr-only">정렬: </span>최근 작성 순
    </p>
  )
}

const WIDE_QUERY = "(min-width: 768px)"
function subscribeWide(cb: () => void) {
  const mq = window.matchMedia(WIDE_QUERY)
  mq.addEventListener("change", cb)
  return () => mq.removeEventListener("change", cb)
}
/** one layout at a time so each row has a single menu state. Server: wide. */
function useWide() {
  return React.useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  )
}

export function ApplicationList({ rows }: { rows: CoverLetterListRow[] }) {
  const del = useDeleteApplication()
  const wide = useWide()
  if (!wide)
    return (
      <>
        <ul className="space-y-2">
          {rows.map((row) => (
            <ApplicationRow key={row.id} row={row} onDelete={del.open} layout="card" />
          ))}
        </ul>
        {del.dialog}
      </>
    )
  return (
    <>
      <div className="rounded-lg border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {/* [UI-가정] 열 머리 글자 (G-82) */}
              <TableHead className="w-[46%]">이름</TableHead>
              <TableHead>포지션</TableHead>
              <TableHead className="w-32">만든 날</TableHead>
              <TableHead className="w-28">마감</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">행 메뉴</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <ApplicationRow key={row.id} row={row} onDelete={del.open} layout="table" />
            ))}
          </TableBody>
        </Table>
      </div>
      {del.dialog}
    </>
  )
}

function ApplicationRow({
  row,
  onDelete,
  layout,
}: {
  row: CoverLetterListRow
  onDelete: (id: string, name: string) => void
  layout: "table" | "card"
}) {
  const router = useRouter()
  const name = applicationDisplayName(row.name, row.name_source, row.created_at)
  const href = routes.coverLetter(row.id)
  const menu = (
    <span onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          {/* UQ-124: 어느 자기소개서의 메뉴인지 읽히게 */}
          <Button variant="ghost" size="icon-sm" aria-label={`${name} 메뉴`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem variant="destructive" onSelect={() => onDelete(row.id, name)}>
            <Trash2 aria-hidden />
            자기소개서 삭제
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )

  if (layout === "table")
    return (
      <TableRow interactive className="h-12" onClick={() => router.push(href)}>
        <TableCell className="max-w-0">
          <NameCell row={row} name={name} href={href} />
        </TableCell>
        {/* 비면 셀을 비운다 — "—"를 넣지 않는다 (G-82) */}
        <TableCell className="max-w-0">
          {row.position_title ? <span className="block truncate text-sm text-muted-foreground">{row.position_title}</span> : null}
        </TableCell>
        <TableCell className="text-sm text-muted-foreground tabular-nums">{formatDate(row.created_at)}</TableCell>
        {/* 마감 D-day는 값이 있을 때만 (CF-2·CF-9) */}
        <TableCell>{row.deadline ? <DDay deadline={row.deadline} /> : null}</TableCell>
        <TableCell>{menu}</TableCell>
      </TableRow>
    )

  // 좁은 화면: 1행 이름 / 2행 "포지션 · 만든 날 · D-day" (빈 조각은 구분점째 뺀다) [UI-가정] G-82
  return (
    <li>
      <Card size="sm" interactive className="relative gap-2 px-4">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <NameCell row={row} name={name} href={href} stretched />
          </div>
          <div className="relative z-10">{menu}</div>
        </div>
        <div className="flex flex-wrap items-center gap-x-1.5 text-sm text-muted-foreground">
          {row.position_title ? (
            <>
              <span className="truncate">{row.position_title}</span>
              <span aria-hidden>·</span>
            </>
          ) : null}
          <span className="tabular-nums">{formatDate(row.created_at)}</span>
          {row.deadline ? (
            <>
              <span aria-hidden>·</span>
              <DDay deadline={row.deadline} />
            </>
          ) : null}
        </div>
      </Card>
    </li>
  )
}

function NameCell({ row, name, href, stretched }: { row: CoverLetterListRow; name: string; href: string; stretched?: boolean }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Link
        href={href}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "block truncate font-medium hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          // 추출 대기 이름("새 자기소개서 (YYYY-MM-DD)")은 흐리게
          !row.name && "text-muted-foreground",
          stretched && "after:absolute after:inset-0",
        )}
        title={name}
      >
        {name}
      </Link>
      {/* AI가 채운 이름 (v5.13까지 S-14 폼에 있던 규칙을 목록 행으로 옮겼다 — design-system 6장 A3) */}
      {row.name_source === "ai" ? (
        <Badge variant="ai" className="shrink-0">
          AI 추출
        </Badge>
      ) : null}
    </div>
  )
}
