"use client"

/**
 * Secondary items pinned to the bottom of the menu (shadcn sidebar-08 NavSecondary).
 * An item is a link (`url`) or an action (`onSelect`, e.g. opening the settings dialog).
 */
import * as React from "react"
import Link from "next/link"
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar"

export type NavSecondaryItem = {
  title: string
  icon: React.ReactNode
  isActive?: boolean
} & ({ url: string; onClick?: () => void; onSelect?: never } | { onSelect: () => void; url?: never; onClick?: never })

export function NavSecondary({
  items,
  leading,
  ...props
}: {
  items: NavSecondaryItem[]
  /** v2: NavAiStatus as the first item (a <SidebarMenuItem>) */
  leading?: React.ReactNode
} & React.ComponentPropsWithoutRef<typeof SidebarGroup>) {
  return (
    <SidebarGroup {...props}>
      <SidebarGroupContent>
        <SidebarMenu>
          {leading}
          {items.map((item) => (
            <SidebarMenuItem key={item.title}>
              {item.url ? (
                <SidebarMenuButton asChild size="sm" tooltip={item.title} isActive={item.isActive} className="max-lg:h-11">
                  <Link href={item.url} onClick={item.onClick}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              ) : (
                <SidebarMenuButton size="sm" tooltip={item.title} isActive={item.isActive} className="max-lg:h-11" onClick={item.onSelect}>
                  {item.icon}
                  <span>{item.title}</span>
                </SidebarMenuButton>
              )}
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
