import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-control border border-transparent bg-clip-padding text-base font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline:
          "border-input bg-card hover:bg-accent hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-primary/10 text-primary-text hover:bg-primary/15 aria-expanded:bg-primary/15 aria-expanded:text-primary-text",
        // data-pending (v4, UQ-712): a not-yet-reached step (writing-chat step bar) stays muted until hovered
        ghost:
          "hover:bg-primary/10 hover:text-primary-text aria-expanded:bg-primary/10 aria-expanded:text-primary-text aria-[current]:bg-primary/10 aria-[current]:font-medium aria-[current]:text-primary-text aria-pressed:bg-primary/10 aria-pressed:font-medium aria-pressed:text-primary-text data-pending:not-hover:text-muted-foreground",
        // design-system 3.5: solid destructive for confirm-delete buttons
        destructive:
          "bg-destructive text-destructive-foreground hover:bg-destructive/90",
        // design-system 3.5 v4 (UQ-712): outline button that points at items needing review (경고)
        "warning-outline":
          "border-warning bg-card text-warning-subtle-foreground hover:bg-warning-subtle hover:text-warning-subtle-foreground",
        // design-system 3.5 v4 (UQ-708): ghost button that starts a destructive action (삭제, 그래도 닫기)
        "destructive-ghost":
          "text-destructive hover:bg-destructive/10 hover:text-destructive aria-expanded:bg-destructive/10 aria-expanded:text-destructive dark:hover:bg-destructive/20",
        // design-system 2 (v5.11, G-68): S-24 위험 구역 입구 (로그아웃 · 회원 탈퇴) — destructive but not the confirm button
        "destructive-outline":
          "border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10 hover:text-destructive dark:border-destructive/50 dark:hover:bg-destructive/20",
        // 알림·경고 모달 보조 버튼 (2026-11 모달 개편): grey text, no fill at rest
        "muted-ghost":
          "text-muted-foreground hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground",
        link: "text-primary-text underline-offset-4 hover:underline",
        // design-system 3.5 v4 (UQ-708): inline link inside a red error sentence (저장 실패 — 다시 시도)
        "destructive-link": "text-destructive underline-offset-4 hover:underline",
        // (v4) design-system 2: L-02 / Resumate AI 패널 빠른 버튼 칩 (Figma 회색 채움 알약), A-4 max-md:h-8
        // (v5) UQ-BR-9: warning-coloured ghost (S-44 "확인이 필요한 내용 N개" 트리거)
        "warning-ghost":
          "text-warning-subtle-foreground hover:bg-warning-subtle hover:text-warning-subtle-foreground aria-expanded:bg-warning-subtle aria-expanded:text-warning-subtle-foreground",
        // UQ-BR-5 (leader): Figma grey fill at rest, v4 hover / open = bg-primary/10 + text-primary-text
        chip: "h-8 rounded-full border-transparent bg-muted bg-clip-border px-3 text-sm font-normal text-foreground hover:bg-primary/10 hover:text-primary-text aria-expanded:bg-primary/10 aria-expanded:text-primary-text max-md:h-8",
        // (v4) missing_slots 슬롯 묻기: chip 모양 + 점선 테두리
        "chip-dashed":
          "h-8 rounded-full border border-dashed border-input bg-transparent px-3 text-sm font-normal text-foreground hover:bg-primary/10 hover:text-primary-text aria-expanded:bg-primary/10 aria-expanded:text-primary-text max-md:h-8",
      },
      // design-system 2: sm h-8 text-sm / default h-10 text-base / lg h-11 / icon size-9 / icon-sm size-8
      // narrow rule (was A-4 44px): below 768px the sizes use 32px (h-8 / size-8); desktop keeps the original size
      size: {
        default:
          "h-10 gap-2 px-4 max-md:h-8 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2 text-xs max-md:h-8 max-md:px-4 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-sm max-md:h-8 max-md:px-4 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-11 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        icon: "size-9 max-md:size-8",
        "icon-xs": "size-7 max-md:size-8 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 max-md:size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
