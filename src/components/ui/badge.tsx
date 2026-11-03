import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary:
          "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive:
          "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline:
          "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        // design-system 3.x v4 (UQ-711): inactive / absent status (없음, 근거 없음, 중단, 해당 없음)
        muted: "border-border text-muted-foreground",
        // design-system v4 (UQ-717): neutral count pill (kanban column header next to stage colors)
        "count-neutral":
          "h-5 min-w-5 rounded-full bg-background px-1.5 text-xs text-muted-foreground tabular-nums",
        ghost:
          "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary-text underline-offset-4 hover:underline",
        // design-system 2: semantic subtle variants
        success: "bg-success-subtle text-success-subtle-foreground",
        warning: "bg-warning-subtle text-warning-subtle-foreground",
        info: "bg-info-subtle text-info-subtle-foreground",
        ai: "bg-ai-subtle text-ai-subtle-foreground",
        "destructive-subtle":
          "bg-destructive-subtle text-destructive-subtle-foreground",
        // "작성 중" draft badge (pair with CircleDashed icon)
        draft: "bg-warning-subtle text-warning-subtle-foreground",
        // design-system v2: S-40 "추천: 무료로 시작"
        recommend: "bg-primary-subtle text-primary-subtle-foreground",
        count:
          "h-5 min-w-5 rounded-full bg-primary-subtle px-1.5 text-xs text-primary-subtle-foreground tabular-nums",
        // design-system 3.1 evidence chip shape (shared with C-15)
        evidence:
          "h-6 max-w-[16rem] justify-start border-chip-border bg-chip px-1.5 text-chip-foreground hover:bg-accent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
