import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

/**
 * Clickable list row / card entry (design-system 1.3 v4). Hover and `active` (selected) use the same
 * green as the ghost button: bg-primary/10 + text-primary-text, direct svg children follow.
 * Use `asChild` for a <Link>. Layout classes may be passed in; colors may not (variant instead).
 * `active` also sets aria-current. Disable a link-type Item with `aria-disabled` (no `disabled` on <a>).
 */
const itemVariants = cva(
  "group/item flex w-full items-center gap-2 text-left text-base transition-colors outline-none hover:bg-primary/10 hover:text-primary-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-active:bg-primary/10 data-active:font-medium data-active:text-primary-text [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:text-muted-foreground hover:[&>svg]:text-primary-text data-active:[&>svg]:text-primary-text",
  {
    variants: {
      variant: {
        // list row inside a sidebar-like list
        ghost: "rounded-xl",
        // row inside a bordered `divide-y rounded-md border` list: square, except the first/last row
        // follow the list corners so the hover fill doesn't bleed (UQ-722). No overflow-hidden on the
        // list, so the focus ring is not clipped.
        row: "rounded-none [li:first-child>&]:rounded-t-[calc(var(--radius-md)-1px)] [li:last-child>&]:rounded-b-[calc(var(--radius-md)-1px)]",
        // standalone bordered entry (settings links, provider cards)
        outline: "rounded-lg border bg-card",
      },
      size: {
        default: "min-h-11 px-3 py-2.5",
        sm: "min-h-10 px-2 max-md:min-h-11",
        lg: "p-4",
        none: "",
      },
    },
    defaultVariants: {
      variant: "ghost",
      size: "default",
    },
  }
)

function Item({
  className,
  variant = "ghost",
  size = "default",
  active = false,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof itemVariants> & {
    /** selected row: green fill + font-medium, and aria-current="true" unless the caller passes one (UQ-713) */
    active?: boolean
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <Comp
      // `type` is overridable on purpose (e.g. type="submit"); asChild (Link) gets no type
      {...(asChild ? {} : { type: "button" as const })}
      {...props}
      aria-current={active ? (props["aria-current"] ?? "true") : props["aria-current"]}
      // set after the spread so callers can't clobber the component's own state attributes (UQ-714)
      data-slot="item"
      data-variant={variant}
      data-active={active || undefined}
      className={cn(itemVariants({ variant, size, className }))}
    />
  )
}

export { Item, itemVariants }
