/**
 * Resumate 로고 — 심볼(`LogoMark`)과 워드마크(`LogoWordmark`). L-01 사이드바 머리, L-02 ShellBar,
 * 셸 밖 화면(S-01~S-03, S-30) 상단에서 같은 파일을 쓴다. 원본: public/brand/logo-{symbol,wordmark}.svg
 * (leader Q-9: 서비스 표기는 "Resumate" — 워드마크 이미지의 alt도 같다).
 */
import Image from "next/image"
import { cn } from "@/lib/utils"

/** 심볼 (정사각형). 워드마크와 함께 쓰면 장식이라 alt를 비운다. */
export function LogoMark({ className, label }: { className?: string; label?: string }) {
  return (
    <Image
      src="/brand/logo-symbol.svg"
      alt={label ?? ""}
      width={592}
      height={592}
      unoptimized
      priority
      className={cn("size-8 shrink-0", className)}
    />
  )
}

/** 워드마크 (2088 × 324). 높이만 정하면 너비는 비율대로. */
export function LogoWordmark({ className }: { className?: string }) {
  return (
    <Image
      src="/brand/logo-wordmark.svg"
      alt="Resumate"
      width={2088}
      height={324}
      unoptimized
      priority
      className={cn("h-4 w-auto shrink-0", className)}
    />
  )
}
