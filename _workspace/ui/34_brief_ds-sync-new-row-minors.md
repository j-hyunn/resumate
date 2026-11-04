# 34 런 브리프 — S-02 문서 동기화 · 새 행 안내 Minor(UQ-331~333)

- 날짜: 2026-11-04 · 요청: 상위 세션(사이드 세션 위임)
- 범위: A1 S-02(문서만), A2 S-10·S-44 새 행(코드 3파일 + 테스트)
- 기획 버전 변경 없음. 백엔드 계약 변경 없음.

## 할 일
1. design-system 6장 A1 S-02를 `(bare)` 헤더·카드 없는 배치로 갱신 (코드 `src/app/(bare)/sign-in/page.tsx`, `account/sign-in-form.tsx`)
2. UQ-331: 5.9 "머리 — 새 행 안내" 패턴 신설, 5.8 CrumbRow·6장 A2 S-10·S-44 서술 갱신
3. UQ-332: 안내 테두리 `border-info/20` → `border-info` (대비 근사: 라이트 1.2→4.3:1, 다크 2.1→6.3:1)
4. UQ-333: 새 행 첫 포커스 `focus({ preventScroll: true })`, S-44 `autoFocus` 제거 → effect
5. 소스 가드 `new-row-notice.test.ts`에 UQ-332·333 가드 3건 추가

## 실행 방식
작은 문서·코드 수정이라 리더가 직접 했다(ui-designer·frontend-engineer 역할 분담만 따름, 서브 에이전트 없음).

## 확인
lint · typecheck · test. **브라우저 미확인**(로컬 로그인 Google 전용) — 점선 대비·낮은 창 포커스 동작은 눈으로 보지 않았다.
