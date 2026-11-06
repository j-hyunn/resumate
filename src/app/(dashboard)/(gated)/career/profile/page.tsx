import { permanentRedirect } from "next/navigation"
import { routes } from "@/lib/routes"

/**
 * ~~S-04 기본 프로필 편집~~ — 폐기 (UX v5.17 SD-A2, 5.1j). 같은 값은 S-24 ① 계정 탭 "내 정보"에서 고친다.
 * 기존 주소는 커리어(S-08)로 영구 리다이렉트하면서 설정 다이얼로그 계정 탭을 연다
 * (`/career?settings=account`, UX 02 "URL 처리" `[가정]`).
 */
export default function Page(): never {
  permanentRedirect(routes.settings("account"))
}
