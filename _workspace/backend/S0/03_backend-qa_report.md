# S0 QA 보고

`run-checks.sh --build` (2026-10-24)

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | PASS | `next typegen && tsc --noEmit` |
| lint | PASS | 경고 0 |
| vitest | PASS | 2개 파일, 24개 테스트 |
| build | PASS | `/`, `/_not-found` 정적 |
| pgTAP | SKIP | Docker 없음, `supabase/tests/`에 테스트 없음 |

추가 확인: `.env.example`에는 더미 값만 있음. `.env.local`, `supabase/.env`, `supabase/.temp`, `supabase/.branches`는 gitignore 대상.
열린 이슈 없음.
