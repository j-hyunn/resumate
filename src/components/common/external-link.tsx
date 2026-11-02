"use client"

/** 3.20 외부 링크 규칙: link button + ExternalLink icon, new tab, "(새 탭)" in the accessible name */
import { ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

export function ExternalProviderLink({ href, children, className }: { href: string; children: string; className?: string }) {
  return (
    <Button variant="link" size="sm" asChild className={cn("h-auto px-0", className)}>
      <a href={href} target="_blank" rel="noopener noreferrer" aria-label={`${children} (새 탭)`}>
        {children}
        <ExternalLink className="size-3.5" aria-hidden />
      </a>
    </Button>
  )
}
