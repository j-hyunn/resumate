# Resumate 기획 정합성 리뷰 — 처리방침·이용약관 확정과 장기 미접속 파기 (privacy-terms, 1차)

## 요약
- 검토 문서: PRD v4.8, UX v5.8, DM v4.6, `decisions.md`(3.12·4.6), `README.md`, `docs/ui/design-system.md` v5.2, `docs/ui/screen-status.md`
- 대조 원본: `docs/legal/privacy-policy.md`·`terms-of-service.md`, `src/components/account/policy-content.ts`, PR #24 코드(이 브랜치), PR #25 diff(미머지)
- 이슈: Critical 0 / Major 4 / Minor 6 — 전부 열림(문서 수정은 리더가 함)
- 맞는 것으로 확인한 사실: 시각 1년 − 30일 / 안내 뒤 30일 / 6시간 쿠키 / 1시간 RPC 건너뜀 / 실행당 30·30·20 / 연속 실패 3회 / RPC 이름 6개 + `private.delete_account_data` / `reason = 'inactivity'`(A.17에 이미 있음) / `/api/cron/retention` / Gmail 환경 변수 이름 / `policy_versions` `2026-11-04` 3행과 재동의 플래그 / 308 리다이렉트 두 규칙 / 문서 경로 3개 / 돌아가기 → S-08 대체 / 없는 문서는 not found / S-03 연령 행이 맨 위, 모두 동의에 포함, 누락 안내 첫 항목, 저장 안 함 / S-01·S-02 두 링크 / 계정 메뉴 → `/policies/privacy`. 이 항목들은 PRD↔UX↔DM↔코드가 모두 같다.

## 경계별 결과
| 경계 | 결과 | 이슈 |
|------|------|------|
| PRD ↔ UX (S-01/S-02/S-03/S-30, 계정 메뉴) | 대체로 일치. 재동의 진입과 S-30 진입점 누락 | R-PT-7, R-PT-8 |
| PRD ↔ DM (NFR-PRV-06 ↔ 4.4/4.6/A.1, D-10 ↔ 4.5/A.2) | 남은 옛 문장 | R-PT-1, R-PT-2, R-PT-3 |
| 문서 ↔ 법무 원본 ↔ 코드(#24/#25) | 처리방침 두 판, Gmail 메일 삭제 약속, 접속 기록 보관 주체 | R-PT-4, R-PT-5, R-PT-6 |
| B12 결정 추적 | PT-1 영향 "DM A.2" 미반영, decisions 표 렌더 깨짐 | R-PT-2, R-PT-10 |
| B13 후속 목록(decisions 4.6) | #25 머지 시 충돌 파일, 운영 할 일 누락 | R-PT-4, R-PT-5 |
| 엣지 상태 | 미접속 파기 뒤 Auth 삭제 실패 사용자의 화면 | R-PT-9 |

## 이슈

### R-PT-1 [Major] PRD 9.0 D-10 행이 아직 "정책 문서 버전은 구현용 가정"이라고 말함
- 경계: B12
- 근거: `docs/planning/01-prd.md:532` — 앞부분에 "(v4.8, PT-1) 처리방침·이용약관·국외 이전 고지 본문과 버전(`2026-11-04`)은 확정"을 넣었지만, 뒤에 옛 문장이 남아 있다: "정책·AI 고지 문서의 실제 버전과 문구(공급자·등급별, D-39 법무 확인과 함께)", "지금 들어간 초기 버전 값은 구현용 `[가정]`". 같은 행 안에서 정책 문서가 확정이라고 했다가 가정이라고 한다. `decisions.md:18`은 "정책 3종은 `2026-11-04`로 확정. AI 고지 6행 `v2026-10-29`는 구현용 `[가정]`"으로 제대로 줄였다.
- 담당: PRD (product-planner)
- 수정안: 532행 셋째 칸의 "— 남은 것은 AI 고지(공급자·등급별, `ai_disclosures`) 문구다." 뒤를 다음으로 바꾼다: "AI 고지 문서의 실제 버전과 문구(공급자·등급별, D-39 법무 확인과 함께). **AI 작성 대화 시작 인사의 무료 등급 문장과 공급자·등급 배지 툴팁(F-AI-09) 문구도 같은 문장이라 함께 확정**한다(리뷰 R-57). 지금 들어간 AI 고지 버전 값(`v2026-10-29`)은 구현용 `[가정]`"
- 상태: 열림

### R-PT-2 [Major] DM A.2와 4.5 정책 버전 행에 "출시 전 확정 / 초기값 가정"이 남음 (PT-1 영향 "DM A.2" 미반영)
- 경계: PRD D-10 ↔ DM 4.5·A.2, B12
- 근거:
  - `docs/planning/04-data-model.md:1615` A.2 `policy_versions` 행: "초기값 4.5 `[가정]`". 헤더(4행)는 "`policy_versions` `2026-11-04`(4.5·A.2)"를 고쳤다고 하지만 A.2는 바뀌지 않았다. 입력 PT-1의 영향 칸도 "DM 4.5·A.2"다.
  - `04-data-model.md:1182` 4.5 정책 버전 행 끝: "이전 값: … 실제 문서·시행일은 출시 전 확정(D-10)". 이 문장은 이제 틀렸다. 또 4.5 제목(1154행)이 "(v4.2, 모두 `[가정]`)"인데 이 행만 확정이다.
  - `04-data-model.md:1460` 8장 "구현이 정한 값 | … 초기 정책·고지 버전 … | `[가정]`".
- 담당: DM (data-architect)
- 수정안:
  - 1615행 끝 "초기값 4.5 `[가정]`" → "현재 `2026-11-04` 3종 **확정 2026-11-04 (사용자, PT-1)**, 값은 4.5"
  - 1182행 "이전 값: … 실제 문서·시행일은 출시 전 확정(D-10)" → "이전 값: `policy_versions` 3종 `version = '2026-10-01'`(임시, `[가정]`이었음), `document_path = '/policies/{type}/{version}'`. 선택 동의는 `privacy` 버전을 따른다. 이 행은 4.5의 `[가정]` 예외로 **확정**이다"
  - 1460행 "초기 정책·고지 버전" → "초기 AI 고지 버전(정책 3종은 PT-1로 확정)"
- 상태: 열림

### R-PT-3 [Minor] S-30 주소와 `document_path`가 "같다"는 문장이 실제 값과 다름
- 경계: UX ↔ DM ↔ 코드
- 근거: `docs/planning/02-user-flows.md:1713` "주소의 문서 이름은 `policy_type`·`document_path`와 같다". 마이그레이션 `20261111000100_policy_versions_2026_11_04.sql`의 `document_path`는 `'/policies/terms/2026-11-04'`처럼 버전이 붙은 경로인데, 이 경로를 받는 라우트가 없다(`src/app/(public)/policies/[doc]`만 있음 → 404). 코드는 `document_path`를 링크로 쓰지 않는다(`routes.policies(type)`만 사용). 이 문장을 보고 `document_path`로 링크를 만들면 404가 난다.
- 담당: UX (ux-planner)
- 수정안: 1713행 둘째 문장을 "주소의 문서 이름은 `policy_type`과 같다. `policy_versions.document_path`(`/policies/{type}/{version}`)는 버전 식별용 기록이며 링크로 쓰지 않는다(버전별 페이지 없음, 항상 현재 판을 보여 준다)"로 바꾼다. DM 4.5 정책 버전 행에도 같은 한 줄을 넣는다.
- 상태: 열림

### R-PT-4 [Major] 처리방침 `2026-11-04` 본문이 #24판과 #25판 두 가지인데 버전은 하나
- 경계: 문서 ↔ 법무 원본 ↔ 코드
- 근거:
  - 이 브랜치의 `docs/legal/privacy-policy.md` 5번 위탁 표에는 Supabase·Vercel만 있고 Gmail이 없다. 9번 쿠키는 "로그인 상태를 유지하는 데 꼭 필요한 쿠키만". #25 diff가 Google LLC(Gmail) 위탁·국외 처리 단락을 더하고 쿠키 문장을 "마지막 접속 일시 기록"까지 넓힌다(`policy-content.ts`도 같음). 두 판 모두 버전 `2026-11-04`이고 #25는 `policy_versions` 행을 새로 넣지 않는다.
  - 그런데 기획 문서는 #25판을 기준으로 쓴다: PRD `01-prd.md:349` NFR-PRV-06 "처리방침의 처리 위탁(국외)에 적는다", `decisions.md` 3.12 PT-4 "처리방침 처리 위탁에 Google LLC(Gmail, 국외) 추가", PRD NFR-PRV-10 "본문 원본은 `docs/legal/`".
  - #24만 원격에 먼저 나가 누가 동의하면 Gmail 위탁·쿠키 문구가 없는 판에 `2026-11-04`로 동의한 것이 된다(같은 버전 문자열로 내용이 달라짐).
  - 또 #25 diff는 `src/app/(public)/policies/page.tsx`를 고친다. 이 파일은 #24에서 지워지고 `next.config.ts` 리다이렉트로 바뀌었다. 그대로 머지하면 충돌하거나 옛 페이지가 되살아난다.
- 담당: decisions.md 4.6 (리더)
- 수정안: `decisions.md:424` "원격 반영 (미완료)" 행 끝에 다음을 더한다: "**#24와 #25는 함께 머지·배포한다.** 처리방침 `2026-11-04` 확정본은 #25의 Gmail 위탁·국외 처리·쿠키 문구를 포함한 판이다(#24만 먼저 배포하지 않는다). #25를 머지할 때 `src/app/(public)/policies/page.tsx` 변경은 버리고(#24에서 삭제됨) `next.config.ts` 리다이렉트를 유지한다." 같은 순서 조건을 README "원격 반영 대기" 줄에도 한 구절로 넣는다.
- 상태: 열림

### R-PT-5 [Major] 처리방침이 "보낸 안내 메일을 지체 없이 삭제"를 약속하는데 기획·후속 목록에 처리 방법이 없음
- 경계: 법무 원본(#25) ↔ DM 4.6 ↔ decisions 4.6
- 근거: #25 `docs/legal/privacy-policy.md` 5번 "발송한 메일은 운영자의 Gmail 보낸편지함에 남으며, 해당 계정을 파기하거나 이용자가 다시 로그인한 뒤 지체 없이 삭제합니다"(`policy-content.ts`도 같은 약속). Gmail SMTP는 보낸 메일을 보낸편지함에 자동 저장한다. 그런데 DM 4.6(`04-data-model.md:1195-1209`)과 `decisions.md` 4.6에는 이 삭제를 누가 언제 하는지가 없고, #25 코드도 보낸편지함을 지우지 않는다. 그대로면 법무 문서의 약속을 지킬 방법이 정해지지 않은 채 출시된다.
- 담당: DM 4.6 (data-architect) + decisions 4.6 (리더)
- 수정안:
  - DM 4.6 아래 목록에 한 줄 추가: "- 보낸 안내 메일: Gmail 보낸편지함에 남는다. 처리방침 5번에 따라 해당 계정을 파기했거나 다시 접속해 안내가 취소된 뒤 지체 없이 지운다. 지금은 운영자가 직접 지운다 `[가정]`(자동화는 후속)."
  - `decisions.md` 4.6 표에 행 추가: "| 운영 (미완료) | Gmail 보낸편지함의 미접속 안내 메일 삭제 절차(처리방침 5번 약속). 수동이면 주기를 정하고, 자동화하면 Gmail API 권한이 따로 필요하다 `[결정 필요]` |"
- 상태: 열림

### R-PT-6 [Major] "접속 기록 1년"을 Vercel·Supabase가 보관한다고 적었지만 실제로 1년을 보관하는 곳이 없음
- 경계: PRD NFR-PRV-06 ↔ DM 4.4 ↔ 처리방침 3번
- 근거: `04-data-model.md:1151` "1년. 호스팅·인증 인프라(Vercel·Supabase)의 접속 로그(접속 일시·IP·브라우저 정보). 서비스 테이블에는 `profiles.last_active_at`만 둔다". 처리방침 3번 표 "접속 기록 | 1년", 1번 자동 생성 정보에 "접속 IP 주소, 브라우저·기기 정보". 그러나 #24·#25 어디에도 접속 로그를 1년 쌓는 장치(로그 드레인, 테이블)가 없고, 호스팅·인증 인프라의 기본 로그 보관은 1년보다 훨씬 짧다(플랜에 따라 몇 시간~며칠). 1년을 "최대 보관 기간"으로 읽을지 "1년 보관 의무"로 읽을지 문서에 없어서, 운영 중 접속 기록을 요구받으면 낼 수 없거나 약속과 다르게 된다.
- 담당: PRD (product-planner) — 범위·의미 결정. DM은 결정에 따라 4.4 문장만 고침
- 수정안: `[결정 필요]`로 올린다. 선택지 (a) "최대 1년": DM 4.4 → "1년 이내. 서비스가 따로 쌓지 않고 Vercel·Supabase 기본 로그 보관 기간(1년보다 짧음)이 지나면 사라진다. 서비스 테이블에는 `profiles.last_active_at`만 둔다" (처리방침 문구는 그대로 둘 수 있는지 법무 확인) / (b) "1년 보관": 로그 드레인 또는 접속 기록 테이블을 새로 두고 DM·백엔드 후속에 추가. 권고는 (a)이며, 어느 쪽이든 PRD NFR-PRV-06 "접속 기록은 1년 보관"에 같은 뜻을 적는다.
- 상태: 열림

### R-PT-7 [Minor] 기존 사용자가 정책 재동의로 S-03에 가는 경로가 UX에 없음
- 경계: PRD/DM(PT-1 재동의) ↔ UX S-02·S-03
- 근거: PT-1 "`terms`·`privacy` `requires_reconsent = true` → 임시 버전 동의자는 다음 로그인 때 S-03 재동의", DM `04-data-model.md:1182`도 같은 내용. 그런데 UX `02-user-flows.md:1147` S-02 상태 표는 "기존 | 로그인 후 **S-08** 또는 원래 URL"뿐이고, S-03(1151~1152행)은 신규 가입만 말한다. 이번 사이클로 지금 있는 모든 사용자가 이 경로를 처음 탄다. 코드(`consent-form.tsx`, `/consent` page)에도 재동의 안내 문구는 없다(신규와 같은 화면, 연령 확인도 다시 받음).
- 담당: UX (ux-planner)
- 수정안: 1147행을 "기존 | 로그인 후 **S-08** 또는 원래 URL. 필수 정책에 재동의가 필요한 새 버전이 있으면(A3, v5.8 PT-1: `2026-11-04` terms·privacy) **S-03**"으로 바꾸고, S-03 항목에 한 줄 추가: "- (v5.8) 재동의도 같은 화면이다. 연령 확인 포함 필수 항목을 다시 체크한다. 재동의 전용 안내 문구는 두지 않는다 `[가정]`."
- 상태: 열림

### R-PT-8 [Minor] S-30 진입점 목록이 코드와 다름 (S-24 섹션, 필수 항목 "보기")
- 경계: UX S-30 ↔ 코드
- 근거: `02-user-flows.md:1710` "계정 메뉴 '처리방침'·동의 화면 선택 항목의 '보기'가 여는 기본 문서". 코드에서는 S-24 설정 다이얼로그의 "처리방침·약관" 섹션이 세 문서 링크를 모두 보여 주고(`settings-sections.tsx:95-110`), 동의 항목 "보기"는 항목마다 자기 문서를 연다(`consent-items.ts`: `terms` → terms, `privacy_required`·선택 2개 → privacy). S-30 표만 보면 S-24 진입과 이용약관 "보기"가 빠진다.
- 담당: UX (ux-planner)
- 수정안: S-30 공통 목록(1713행 앞)에 한 줄 추가: "- 진입: S-01 하단·S-02 약관 안내(이용약관·처리방침), S-03·S-24 동의 항목의 '보기'(항목의 `policy_type` 문서), S-24 '처리방침·약관' 섹션(세 문서 링크), 계정 메뉴 '처리방침'(→ 개인정보 처리방침)." 그리고 1710행 비고는 "계정 메뉴 '처리방침'이 여는 문서, `/policies`의 기본 문서"로 줄인다.
- 상태: 열림

### R-PT-9 [Minor] 미접속 파기 뒤 Auth 삭제가 실패한 사용자가 로그인하면 "탈퇴 마무리" 화면을 봄
- 경계: DM 4.6 ↔ UX S-25 재진입
- 근거: DM `04-data-model.md:1206` "Auth 정리: 공개 데이터는 지웠지만 Auth 삭제가 실패한 사용자(`deletion_incomplete`, 사용자 탈퇴 미완료 포함)". 다음 크론 전까지 그 사용자는 Google로 다시 로그인할 수 있고, UX `02-user-flows.md:1702` "재진입 | 탈퇴 마무리 상태로 로그인하면 … 바로 이 화면의 탈퇴 마무리 상태"와 "데이터는 모두 지웠지만 계정 정보 삭제를 마치지 못했어요" 문구를 보게 된다. 본인은 탈퇴를 요청한 적이 없다. UX v5.8 헤더는 "PT-3은 화면 없이 안내 메일만"이라고 해 이 경우를 다루지 않는다.
- 담당: UX (ux-planner)
- 수정안: S-25 재진입 행 비고에 추가: "(v5.8, PT-3) 장기 미접속으로 파기된 뒤 Auth 삭제만 남은 계정도 같은 상태로 본다(판정이 같다, `reason`은 보지 않는다). 문구는 같게 둔다 `[가정]` — 하루 안에 크론이 Auth 사용자를 지운다." 문구를 나눠야 한다면 DM에 `get_account_deletion_state`가 `reason`을 돌려주도록 요청하는 `[결정 필요]`로 올린다.
- 상태: 열림

### R-PT-10 [Minor] decisions.md 3.12 PT-6 행의 `|`가 표를 깨뜨림 / DM 4.6 RPC 서명 누락
- 경계: B12 (표기)
- 근거:
  - `docs/planning/decisions.md:318` 표 셀 안의 `` `/policies/{terms|privacy|cross_border_transfer}` ``. GFM 표에서는 코드 안의 `|`도 열 구분자로 읽혀 행이 5칸으로 쪼개진다.
  - `04-data-model.md:1206` `list_incomplete_account_deletions`만 인자 없이 적혀 있다. #25의 서명은 `list_incomplete_account_deletions(p_limit integer default 50)`이고, 이 RPC는 `profiles`가 없는 Auth 사용자 전체를 돌려주며 `deletion_incomplete` 확인(`get_account_deletion_state`)은 서버가 한다. 또 A.1(1608행) 백필 설명 "`auth.users.last_sign_in_at`으로 백필"은 실제로 `greatest(coalesce(last_sign_in_at, created_at), created_at)`다.
- 담당: decisions.md (리더) / DM (data-architect)
- 수정안:
  - decisions 318행: `` `/policies/terms` · `/policies/privacy` · `/policies/cross_border_transfer` ``로 풀어 쓴다(또는 `\|`로 이스케이프).
  - DM 1206행 RPC 칸: "`list_incomplete_account_deletions(p_limit)` (service_role) — `profiles` 없는 Auth 사용자 id, 서버가 `get_account_deletion_state = deletion_incomplete`일 때만 Auth 삭제"
  - DM 1608행: "기존 계정은 `greatest(coalesce(auth.users.last_sign_in_at, created_at), created_at)`으로 백필"
- 상태: 열림

## 결정 필요 통합
| 항목 | 출처 | 비고 |
|------|------|------|
| 접속 기록 "1년"의 뜻(최대 보관 vs 보관 의무)과 보관 주체 | R-PT-6 | 권고 (a) 최대 1년, 인프라 기본 보관 |
| Gmail 보낸편지함 안내 메일 삭제 절차(수동 주기 / 자동화) | R-PT-5 | 처리방침 5번 약속 |
| (선택) 미접속 파기 사용자의 Auth 잔여 상태 문구를 탈퇴와 나눌지 | R-PT-9 | 권고: 나누지 않음 `[가정]` |
| D-10 AI 고지 문구(기존, 이번 사이클에서 범위만 줄어듦) | PRD 9.0, decisions 1장 | 변경 없음 |
