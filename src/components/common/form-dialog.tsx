"use client"

/**
 * 공통 **입력 모달 틀** (`FormDialog`) — S-08 "커리어 추가"(C-22 `AddCareerDialog`)의 틀을 그대로 꺼낸 것.
 * S-14 "자기소개서 추가"(`AddApplicationDialog`)도 같은 틀을 쓴다 (58 런, 사용자 지시 "경력 추가 모달을 공통 모달로").
 *
 *   <FormDialog open onOpenChange onCloseAutoFocus>
 *     <FormDialogForm onSubmit={submit}>
 *       <FormDialogHeader title="경력 추가" description="…" />
 *       <FormDialogBody>
 *         <FormSection title="재직 정보">
 *           <FormField id="add-org" label="회사명" error={errors.org}><Input id="add-org" … /></FormField>
 *         </FormSection>
 *         <FormFillField id="add-body" label="근무 내용"><Textarea id="add-body" className="min-h-48 flex-1 …" /></FormFillField>
 *       </FormDialogBody>
 *       <FormDialogFooter><FormDialogSubmit pending={pending}>추가하기</FormDialogSubmit></FormDialogFooter>
 *     </FormDialogForm>
 *   </FormDialog>
 *
 * 틀: 폭 602 · 모서리 20 · `p-5` · 데스크톱(≥1024) 고정 높이 `calc(100dvh-200px)`(최대 840) — 단계나 종류가 바뀌어도
 * 모달 크기가 같다. 머리(제목 · 닫기 X) / 스크롤 본문 / 바닥(오른쪽 주 버튼).
 * 하위 조각은 **이름 붙은 export**다 — `"use client"` 컴포넌트에 정적 속성을 달지 않는다(RSC 경계, React #130).
 */
import * as React from "react"
import { CircleAlert, Loader2, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"

/** 틀 클래스 (C-22 그대로) */
export const FORM_DIALOG_CONTENT_CLASS =
  "flex max-h-[calc(100dvh-2rem)] w-[602px] flex-col gap-4 rounded-[20px] p-5 sm:max-w-[602px] lg:h-[calc(100dvh-200px)] lg:max-h-[840px]"

export function FormDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** where focus goes on close (default: the element focused before opening) */
  onCloseAutoFocus?: (e: Event) => void
  className?: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} onCloseAutoFocus={onCloseAutoFocus} className={cn(FORM_DIALOG_CONTENT_CLASS, className)}>
        {children}
      </DialogContent>
    </Dialog>
  )
}

/** 모달 안 `<form>` — 머리·본문·바닥을 감싸고 남은 높이를 채운다 */
export function FormDialogForm({ onSubmit, className, children, ...props }: React.ComponentProps<"form">) {
  return (
    <form onSubmit={onSubmit} noValidate className={cn("flex min-h-0 flex-1 flex-col gap-4", className)} {...props}>
      {children}
    </form>
  )
}

/** 머리: 제목(보이는 `DialogTitle`) + 화면 낭독기용 설명 + 닫기 X(`DialogClose` → 모달의 `onOpenChange` 가드) */
export function FormDialogHeader({ title, description }: { title: React.ReactNode; description: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <DialogTitle className="flex-1 text-xl leading-normal font-semibold">{title}</DialogTitle>
      <DialogDescription className="sr-only">{description}</DialogDescription>
      <DialogClose asChild>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="닫기">
          <X className="size-6" aria-hidden />
        </Button>
      </DialogClose>
    </div>
  )
}

/** 스크롤 본문 — 섹션 사이 `gap-6` */
export function FormDialogBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("-mx-1 flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-1", className)}>{children}</div>
}

/** 바닥 — 오른쪽 정렬 (주 버튼 하나) */
export function FormDialogFooter({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex justify-end", className)}>{children}</div>
}

/** 바닥 주 버튼 — 진행 중이면 `Loader2` + 비활성 */
export function FormDialogSubmit({ pending = false, disabled, children }: { pending?: boolean; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Button type="submit" disabled={pending || disabled}>
      {pending ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  )
}

/**
 * 섹션: 제목(`h3 text-base font-medium`) + 칸 묶음. `fill` = 마지막 섹션이 남은 높이를 채운다(그 안의 `FormField fill`이
 * 커지는 입력 칸을 둔다).
 */
export function FormSection({ title, fill = false, children }: { title: string; fill?: boolean; children: React.ReactNode }) {
  return (
    <section className={cn("flex flex-col gap-2", fill && "min-h-48 flex-1")}>
      <h3 className="text-base font-medium">{title}</h3>
      <div className={cn("flex flex-col", fill && "min-h-0 flex-1")}>{children}</div>
    </section>
  )
}

/** 칸: 라벨(`text-sm font-normal`) + 입력 + `FormFieldError`(`{id}-error`). `fill` = 남은 높이를 채운다 */
export function FormField({ id, label, error, fill = false, children }: { id: string; label: React.ReactNode; error?: string; fill?: boolean; children: React.ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-2 py-2", fill && "min-h-0 flex-1")}>
      <Label htmlFor={id} className="text-sm font-normal">
        {label}
      </Label>
      {children}
      <FormFieldError id={`${id}-error`} message={error} />
    </div>
  )
}

/** 칸 아래 오류 한 줄 (A-10) — 메시지가 없으면 그리지 않는다 */
export function FormFieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null
  return (
    <p id={id} className="flex items-center gap-1.5 text-sm text-destructive" role="alert">
      <CircleAlert className="size-4 shrink-0" aria-hidden />
      {message}
    </p>
  )
}

/**
 * 마지막 큰 칸 (C-22 "근무 내용" 등): 섹션 제목 크기의 라벨 + 남은 높이를 채우는 입력.
 * 입력에는 `className="min-h-48 flex-1 …"`을 준다.
 */
export function FormFillField({ id, label, children }: { id: string; label: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="flex min-h-48 flex-1 flex-col gap-2">
      <Label htmlFor={id} className="text-base font-medium">
        {label}
      </Label>
      {children}
    </section>
  )
}
