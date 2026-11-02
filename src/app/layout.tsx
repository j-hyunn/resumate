import type { Metadata, Viewport } from "next"
import localFont from "next/font/local"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ResponsiveToaster } from "@/components/common/shell/shell-parts"
import { ThemeScript } from "@/components/common/theme-script"
import "./globals.css"

// Pretendard Variable, self-hosted (leader decision Q-1). License: ./fonts/Pretendard-LICENSE.txt (OFL-1.1)
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  variable: "--font-pretendard",
  weight: "45 920",
  display: "swap",
})

export const metadata: Metadata = {
  title: { default: "Resumate", template: "%s · Resumate" },
  description: "커리어를 정리하고, 기업 JD마다 인사이트·서류·면접을 준비하고, 지원 현황을 관리하세요",
}

export const viewport: Viewport = {
  colorScheme: "light dark",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning: THEME_SCRIPT sets .dark / color-scheme on <html> before hydration
    <html lang="ko" className={pretendard.variable} suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body className="min-h-dvh">
        <TooltipProvider delayDuration={500}>
          {children}
          <ResponsiveToaster />
        </TooltipProvider>
      </body>
    </html>
  )
}
