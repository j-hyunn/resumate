"use client"

/**
 * Main menu group (shadcn sidebar-08 NavMain). Items with `items` get a collapsible sub-menu;
 * Resumate's four menus currently have none. Badges follow design-system 5.1.
 */
import * as React from "react"
import Link from "next/link"
import { ChevronRight } from "lucide-react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar"

export interface NavMainItem {
  title: string
  url: string
  icon: React.ReactNode
  isActive?: boolean
  /** count/dot badge next to the label (hidden when collapsed; `dot` shows on the icon instead) */
  badge?: React.ReactNode
  dot?: boolean
  onClick?: () => void
  items?: { title: string; url: string }[]
}

export function NavMain({ label, items }: { label: string; items: NavMainItem[] }) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <nav aria-label="주 메뉴">
        <SidebarMenu>
          {items.map((item) => (
            <Collapsible key={item.title} asChild defaultOpen={item.isActive}>
              <SidebarMenuItem>
                <SidebarMenuButton asChild tooltip={item.title} isActive={item.isActive} className="max-lg:h-11">
                  <Link href={item.url} aria-current={item.isActive ? "page" : undefined} onClick={item.onClick}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
                {item.badge}
                {item.dot ? (
                  <span
                    className="pointer-events-none absolute top-1.5 left-6 hidden size-2 rounded-full bg-primary ring-2 ring-sidebar group-data-[collapsible=icon]:block"
                    aria-hidden
                  />
                ) : null}
                {item.items?.length ? (
                  <>
                    <CollapsibleTrigger asChild>
                      <SidebarMenuAction className="data-[state=open]:rotate-90">
                        <ChevronRight aria-hidden />
                        <span className="sr-only">{item.title} 하위 메뉴 펼치기</span>
                      </SidebarMenuAction>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <SidebarMenuSub>
                        {item.items.map((sub) => (
                          <SidebarMenuSubItem key={sub.title}>
                            <SidebarMenuSubButton asChild>
                              <Link href={sub.url} onClick={item.onClick}>
                                <span>{sub.title}</span>
                              </Link>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    </CollapsibleContent>
                  </>
                ) : null}
              </SidebarMenuItem>
            </Collapsible>
          ))}
        </SidebarMenu>
      </nav>
    </SidebarGroup>
  )
}
