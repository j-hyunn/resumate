"use client"

/**
 * S-13 자기소개서 목록 행 — (v5.20 재작성, CF-3·CF-9·CF-A8·CF-A14 / design-system v5.15 6장 A3 "S-13 목록").
 *
 * (59 런, 시안 4) 표·카드 대신 세 줄 행의 세로 목록(이름 · 포지션 · 만든 날 [+ D-day]). 행 전체가 S-46으로
 * 가고(정본 행이 없으면 문항 설정 상태), 행 끝 `⋯`는 **"자기소개서 삭제"(C-05) 한 항목**이다.
 *
 * **되살리지 않는 것**(CF-3·CF-A14): 전형 단계 칩·전형 결과 배지·단계 이동(C-12)·기능 진행 칸
 * (인사이트·서류 수·면접 수)·정렬 선택·전형 단계 거르기·"보드로 보기". 전형 단계 변경은 S-39에서만 한다.
 * 이름은 화면이 다시 만들지 않고 `application_projects.name`을 그대로 보인다 — v5.20 전에 만든
 * "회사명 – 포지션명"과 새 "{기업 명} 자기소개서"가 **섞여 보이는 것이 정상**이다(UX S-13 `[가정]`).
 */
import * as React from "react"
import Link from "next/link"
import { MoreHorizontal, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Item } from "@/components/ui/item"
import { DDay } from "@/components/common/basics"
import type { CoverLetterListRow } from "@/lib/data/cover-letters"
import { applicationDisplayName, formatDate } from "@/lib/data/labels"
import { routes } from "@/lib/routes"
import { cn } from "@/lib/utils"
import { useDeleteApplication } from "./shared"

/**
 * 본문 위 정렬 표기 — 시안 1의 회색 둥근 사각(공통 버튼 모서리 `rounded-control`, 59 QA UQ-768) 그대로지만 **바꿀 수 없는 글자**다
 * (정렬 선택·필터·검색 없음, CF-9). 누를 것이 없으므로 버튼·⌄를 두지 않는다 `[UI-가정]`.
 */
export function ApplicationSortNote() {
  return (
    <p className="inline-flex h-8 items-center rounded-control bg-muted px-3 text-sm text-foreground">
      <span className="sr-only">정렬: </span>최근 작성 순
    </p>
  )
}

/**
 * 목록 (시안 4, 59 런): **표가 아니라 세 줄 행의 세로 목록** — ① 이름(기본 글자) ② 포지션(회색, 비면 줄째 생략)
 * ③ 만든 날(회색) + 마감 D-day(값이 있을 때만, 날짜 옆 `[UI-가정]`). 열 머리 없음, 행 사이 전폭 가로 구분선
 * (`divide-y`). 행 = 공통 `Item variant="row"`(목록 행의 hover·포커스 모양) + `Link` → S-46. 행 안쪽 왼쪽 여백(`px-3`)이
 * 위 정렬 칩 글자(`px-3`)와 맞는다. 좁은 화면도 같은 목록이다.
 */
export function ApplicationList({ rows }: { rows: CoverLetterListRow[] }) {
  const del = useDeleteApplication()
  return (
    <>
      <ul className="divide-y" aria-label="자기소개서 목록">
        {rows.map((row) => (
          <ApplicationRow key={row.id} row={row} onDelete={del.open} />
        ))}
      </ul>
      {del.dialog}
    </>
  )
}

function ApplicationRow({ row, onDelete }: { row: CoverLetterListRow; onDelete: (id: string, name: string) => void }) {
  const name = applicationDisplayName(row.name, row.name_source, row.created_at)
  return (
    <li className="group/row relative">
      <Item asChild variant="row" size="none" className="flex-col items-start gap-1 px-3 py-6 pr-14">
        <Link href={routes.coverLetter(row.id)} title={name}>
          <span className="flex max-w-full min-w-0 items-center gap-1.5">
            {/* 추출 대기 이름("새 자기소개서 (YYYY-MM-DD)")은 흐리게 */}
            <span className={cn("truncate", !row.name && "text-muted-foreground")}>{name}</span>
            {/* AI가 채운 이름 (design-system 6장 A3) */}
            {row.name_source === "ai" ? (
              <Badge variant="ai" className="shrink-0">
                AI 추출
              </Badge>
            ) : null}
          </span>
          {/* 비면 줄째 뺀다 — "—"를 넣지 않는다 (G-82) */}
          {row.position_title ? <span className="max-w-full truncate text-sm text-muted-foreground">{row.position_title}</span> : null}
          <span className="flex items-center gap-1.5 text-sm text-muted-foreground tabular-nums">
            {formatDate(row.created_at)}
            {/* 마감 D-day는 값이 있을 때만 (CF-2·CF-9) — 시안에 자리가 없어 날짜 옆에 `[UI-가정]` */}
            {row.deadline ? (
              <>
                <span aria-hidden>·</span>
                <DDay deadline={row.deadline} />
              </>
            ) : null}
          </span>
        </Link>
      </Item>
      {/* 행 메뉴 ⋯ ("자기소개서 삭제" 하나, C-05) — 시안에 없어 마우스를 올리거나 포커스가 들어올 때만 보인다(터치 기기는 늘).
          링크 밖 형제라 링크 안에 버튼이 겹치지 않고, Tab으로 늘 닿는다 `[UI-가정]` */}
      <div className="absolute top-5 right-2 [@media(hover:hover)]:opacity-0 group-focus-within/row:opacity-100 group-hover/row:opacity-100 has-data-[state=open]:opacity-100">
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
      </div>
    </li>
  )
}
