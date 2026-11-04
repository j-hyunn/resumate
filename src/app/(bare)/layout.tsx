/**
 * 상단 로고 헤더도 없는 셸 밖 화면 (S-02 가입/로그인). 화면 가운데 브랜드 로고를 직접 그린다.
 * `(public)` 레이아웃의 h-14 헤더를 피하려고 route group을 나눴다 — URL은 그대로(`/sign-in`).
 */
export default function BareLayout({ children }: { children: React.ReactNode }) {
  return <main className="min-h-dvh">{children}</main>
}
