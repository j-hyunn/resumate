# UI QA — 42 런 설정 다이얼로그(settings-dialog, SD-*) (라운드 1)

- 날짜: 2026-11-05 · 브랜치 `claude/epic-sutherland-f2c874` (커밋 안 함)
- 범위: S-24 ①~④ · S-30 `/policies/ai_data_use` · S-04 리다이렉트 · C-01/C-02 `profile` 칩 · (부수) S-41 공급자 선택 행
- 기준: UX v5.17a(02-user-flows 1773~1965행) · design-system v5.11 5.11 · 백엔드 R13 `02_api_notes.md` §8
- 점검: Q1~Q7 + Q11 + 기계 검사. Q8~Q10은 코드상으로만. **Q12(브라우저)는 리더 몫 — 이 리뷰에서는 미확인**

## 요약

- **Critical 0 / Major 0 / Minor 7**
- 기계 검사: typecheck 통과 · lint 통과(경고 0) · vitest 156 파일 2504 테스트 통과 · build 통과
- 백엔드 소유 경로 수정 없음: `git diff --stat HEAD`에 `src/server/`·`src/app/api/`·`src/lib/contracts/`·`supabase/` 없음. `lib/data/{profile,ai-usage,actions,consent-items}.ts`·`types/db.ts` 수정은 R13 §8 요청 범위 안(`profile.ts`는 미리보기 분기만 교체, 실제 분기 그대로). 새 `lib/data/policies.ts`만 범위 밖 판단 필요(QA-42-06)
- 문구: 탭 이름 4개, 버튼, 검증 문구 5종, 저장 오류 6종, 빈 상태, 미저장 확인 제목·버튼, 개선 요청 "준비 중", 약관 탭, 사용량 블록 문구 모두 UX v5.17a와 글자 그대로. 차이는 사용량 표 열 머리 "(USD)" 하나(QA-42-03). 새 문구(`선택 안 함`, 미저장 확인 설명 줄, 계정 탭 불러오기 실패, 정렬 Select 라벨, 약관 토글 sr 알림)는 `[UI-가정]` 표시 있음

## 화면별 점검표

| 화면 | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | Q11 | Q12 |
|------|----|----|------|----|----|----|----|----|-----|-----|-----|
| S-24 틀 (탭 4개·미저장 확인) | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | — | 미확인 |
| S-24 ① 계정 탭 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ⚠️ (QA-42-07) | ✅ | ⚠️ (QA-42-01·02) | 미확인 |
| S-24 ② AI 연결 탭 (S-40·S-42) | ✅ | ⚠️ (QA-42-03) | ✅ | ✅ | ✅ | ✅ (키 확인 동기) | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-24 ③ 약관 탭 | ✅ | ⚠️ (QA-42-04) | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-24 ④ 개선 요청 탭 | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-30 `/policies/ai_data_use` | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ⚠️ (QA-42-06) | 미확인 |
| S-04 리다이렉트 | ✅ | — | — | ✅ | — | — | — | — | — | ⚠️ (QA-42-05) | 미확인 |
| C-01·C-02 `profile` 칩 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | — | ✅ | 미확인 |

## 중점 확인 결과

1. **문구** — 위 요약대로. `field_too_long` "{항목}이 너무 길어요"는 네 칸(이름·학교 명·전공·학점) 모두 받침이라 "이" 고정이 맞다.
2. **내 정보 저장 계약** — 입력은 섹션 전체(`payloadOf`: 11값 모두 키를 보내고 빈 값은 `null`, `profile-basics-model.ts:131-150`), 서비스 `toProfileValuesJson`도 모든 키를 보낸다. 연월 `'YYYY-MM'`(`ym`, 월 2자리 채움). 쌍은 직군 있는 행만 순서대로 보내고 `sort_order` 1..n은 RPC가 매긴다. 최대 2(`MAX_JOB_INTERESTS`, 추가 버튼 2쌍에서 disabled). 기대 버전 = 조회 `updatedAt` → 저장 응답 `updatedAt`으로 갱신(`profile-basics-form.tsx:179-181`), `stale_write`면 다시 읽어 갱신. `details.field` → 칸 포커스(`SERVER_FIELD`), `details.sortOrder` → 행 아래 인라인 + 그 행 직군 셀렉트 포커스. **mock 저장은 오류 코드는 같지만 순서·`details` 모양이 실제와 일부 다르다**(QA-42-01), 행 위치 매핑 한 곳이 약하다(QA-42-02).
3. **사용량 표** — 7행 접기는 `usage-rows.ts` `usageRowsOf` 한 곳에서만, 원천 상수 `USAGE_FEATURE_DISPLAY_GROUPS`(`lib/data/usage-display.ts`, `ai-usage.ts`가 다시 내보냄). `career_description`+`cover_letter` 합산 ✓, 매핑에 없는 값은 보이지 않음 ✓(UX `[가정]`). 기록 없는 공급자 탭 = "{공급자}로는 이번 달에 아직 AI를 쓰지 않았어요" + 0 행 표 ✓, 전체 기록 없음 · 연결 전 한 줄 ✓. 비용 2열은 저장 컬럼 합(역산 없음), 토큰 보조 표기 = 입력+캐시 읽기+캐시 쓰기 / 출력 ✓. **무료 등급 안내 판정 = 그 공급자 키의 `connection_tier`**(`ai-connection-panel.tsx:337` → `ai-usage-panel.tsx:168`), `providers[].connection_tiers`는 화면 어디서도 읽지 않음 ✓, 키 없으면 안내 없음 ✓. 레거시 `getAiUsageSummary`·`computeAiUsageSummary`·옛 `AiUsageSummary`·`displayInputTokens` 삭제, 남은 참조 없음.
4. **미저장 확인** — Dialog `onOpenChange(false)`(X·Esc·바깥 누르기) → `runGuarded`(`settings-dialog.tsx:201,273`), 사이드바·좁은 탭 줄 탭 버튼(`:204-210`), 열린 상태의 `openSettings(다른 탭)`(`:167-175`), [회원 탈퇴](`account-tab.tsx:136-141` `useGuardedAction`) 모두 거친다. 로그아웃(`SignOutButton`)은 거치지 않는다 ✓. dirty = 마지막 저장값 대비 페이로드 비교(`sameValues`)라 저장 후·값을 되돌린 뒤에는 묻지 않는다 ✓, 빈 쌍 행 추가만으로는 dirty 아님 ✓. "저장하고 닫기" 실패·검증 오류면 확인만 닫고 남음 ✓. 탭 본문이 언마운트되면 guard 해제(`settings-guard.tsx:41`).
5. **링크 회귀** — `routes.settings()`·`SettingsLink section`·`openSettings()` 인자가 `SettingsTabId`로 타입 고정되어 typecheck가 옛 ID 사용처를 막는다. 호출자 전수: S-41 `(focus)/settings/ai/connect/page.tsx:57`·`key-connect-flow.tsx:159,163`, S-25 `settings/withdraw/page.tsx:50`·`withdraw-form.tsx:135`(`withdraw` → `account`), C-20 `ai-error-notice.tsx:536`, C-19 `provider-badge.tsx:77`(경고면 `provider` → `#provider-row-{p}`), C-09 `data-gate.tsx:219`, `ai-connect-link.tsx:15`, L-01 `app-sidebar.tsx:158,184`, L-02 `page-shell.tsx:438`, S-04 리다이렉트 — 전부 새 탭 ID. URL의 옛 ID(`withdraw`·`ai-usage`·`consents`·`ai-data`)는 `resolveSettingsSection`이 탭+앵커로 바꾸고 모르는 값은 계정. `provider-card`·`/career/profile`·`routes.profile`·`?settings=` 하드코딩 잔여 없음. 앵커 `provider-row-{p}`(`provider-row.tsx:172`) 하나로 통일.
6. **백엔드 소유 파일** — 요약 참고. §8 요청 1~7 모두 반영.
7. **접근성** — 탭 목록은 `nav aria-label="설정 탭"` + 버튼 + `aria-current="page"`(Tab 키 이동, 화살표 이동은 없음 — 설계 5.11이 tablist를 요구하지 않음). 셀렉트는 `Label htmlFor` 또는 `aria-label`(쌍 "관심 직군 {n}"·연월 "기간 시작 연도" 등), Switch는 `Label htmlFor` + 설명 `aria-describedby`. 칸 오류는 `aria-invalid` + `aria-describedby="{id}-error"`, 기간은 묶음 `role=group`에 연결. 위험 구역 버튼은 글자 라벨. 미저장 확인은 AlertDialog(포커스 가둠, 닫으면 Radix가 직전 포커스로 복귀). 예외는 QA-42-07.
8. **좁은 화면(코드상)** — `md` 미만에서 사이드바 숨김 + `grid-cols-4` 탭 줄(320px 미만만 가로 스크롤, G-63), 사용량 `<640` 표 → 행 목록 + 정렬 Select, 내 정보 `sm:grid-cols-2` → 1열, 쌍 행은 직군/직무 두 줄 + 삭제 버튼 첫 줄 오른쪽(설계 5.11.1 그대로).

## 이슈

| ID | 심각도 | 담당 | 화면 | 무엇이 어긋났나 | 근거 | 권고 |
|----|--------|------|------|----------------|------|------|
| QA-42-01 | Minor | frontend (A1, mock) | S-24 ① | mock `saveProfileBasics`가 실제 경로와 다르게 거부한다: ① 순서 — 실제는 서비스 `checkJobInterests`(쌍 수·중복)가 RPC 앞에서 먼저, RPC 안은 `stale_write` → `field_too_long` → 기간 → 쌍 수 → 중복 → 옵션(트리거), mock은 `stale_write` → 쌍 수 → 중복 → 옵션 → 기간이고 `field_too_long` 없음 ② 쌍의 `invalid_profile_option` `details.field`가 mock은 `job_interests.{n}`, 실제는 `job_family`/`job_role`(위치 없음) ③ mock 옵션 검사는 `is_active`를 보지 않음 | mock `src/lib/data/profile.ts:115-143` ↔ `src/server/services/profile/index.ts:215`, `supabase/migrations/20261113002100_r13_save_profile_basics.sql:77-132`, `20261113001800_r13_validate_profile_options.sql:47-80`. UX 1809-1816행 | mock을 실제 순서·`details` 모양에 맞춘다(쌍 옵션 오류는 `{ field: "job_family" \| "job_role" }`). 리포트의 "RPC와 같은 순서" 서술도 고친다 |
| QA-42-02 | Minor | frontend (A1) / 백엔드 요청 | S-24 ① | 오류 행 매핑: `pairIndex`는 서버 위치 n을 화면 행 n-1로 바꾸는데, 저장은 직군 없는 행을 빼고 보내므로(`filledPairs`) 1행이 비고 2행만 찬 경우 위치 1이 빈 1행을 가리킨다(지금은 mock `invalid_profile_option`만 해당 — 중복은 두 행 모두 차야 나므로 영향 없음). 실제 쌍 옵션 오류는 위치가 없어 "값이 있는 첫 행"으로 표시(`[UI-가정]`) — 2행이 문제여도 1행에 붙는다 | `src/components/account/profile-basics-form.tsx:189-194`, `profile-basics-model.ts:127-128`. UX 1810행 "문제가 된 칸으로 포커스", 1815행 "중복으로 걸린 쌍 행 아래" | 위치 → "n번째로 보낸(채워진) 행"으로 매핑. 백엔드에 쌍 트리거 오류의 위치(`job_interests.{n}`) 요청 검토 |
| QA-42-03 | Minor | frontend (A1) | S-24 ② / S-42 | 사용량 표 열 머리가 "입력 비용"·"출력 비용" — 명세는 "입력 비용(USD)"·"출력 비용(USD)" | `src/components/account/ai-usage-panel.tsx:225,227` ↔ UX 1837행(S-24 ② 기능별 표), 1957행(S-42 기능별 표) | 글자 그대로 "(USD)"를 붙이거나, 금액에 `$`가 있어 생략한다면 `[UI-가정]` 표시 |
| QA-42-04 | Minor | frontend (A1) | S-24 ③ | 토글 성공 sr 알림이 조사를 "을"로 고정 — "기능 업데이트, 소식 받기을 켰어요/껐어요"가 된다 | `src/components/account/policies-tab.tsx:162` | 받침에 따라 을/를(기존 `directionParticle`류 도우미) 또는 "{라벨} 설정을 켰어요"로 |
| QA-42-05 | Minor | 백엔드 | S-04 | S-04 폐기 뒤 쓰는 곳 없는 레거시 경로가 남음: `lib/data/career.ts` `getProfile`·`updateProfile`(주석 "profile (S-04)", 통합 테스트만 사용), `server/actions/profile.ts` "Legacy S-04" 읽기·저장, `lib/contracts/profile.ts` S-04 shim | `src/lib/data/career.ts:255-290`, `src/server/actions/profile.ts:38-46`, `src/lib/contracts/profile.ts:156-158` ↔ UX 1187-1192행(S-04 폐기) | 백엔드 다음 정리 슬라이스에서 삭제(UI가 손댈 파일 아님) |
| QA-42-06 | Minor | 백엔드 (검토) | S-30 | 새 데이터 함수 `getCurrentAiDisclosures`가 UI 규칙(새 함수 = mock + `연결 대기`, 실제 분기는 백엔드)과 달리 실제 분기를 직접 연결했다 — `createSupabaseServerClient` + 백엔드 서비스 `loadCurrentDisclosureRow`를 `lib/data`에서 바로 부름. 백엔드 경로 자체는 고치지 않았고 동작은 맞아 보인다(서비스 쿼리 재사용, 실패 시 페이지가 "공급자별 고지를 불러오지 못했어요"). 브리프 "연결 대기 없음 — 전부 있음"과 달리 이 읽기 함수는 계약에 없었다 | `src/lib/data/policies.ts:24-47`, `src/app/(public)/policies/[doc]/page.tsx:53-56` ↔ ui-context "Data layer", UX 1891행 | 백엔드가 이 함수를 백엔드 소유로 넘겨받을지(또는 `server/actions` 경유로 바꿀지) 판정. screen-status에 기록 |
| QA-42-07 | Minor | frontend (A1) | S-24 ① | `too_many_job_interests` 처리: 오류 줄(`pb-job-interest-too-many`)이 어느 컨트롤의 `aria-describedby`에도 묶이지 않고, 포커스 대상 [관심 직무 추가]는 2쌍이면 disabled라 `focus()`가 먹지 않는다(방어 문구라 실제로 볼 일은 거의 없음) | `src/components/account/profile-basics-form.tsx:243,572-588` ↔ UX 1816행, 설계 5.11.1 "오류는 칸 아래 + 포커스" | 포커스를 쌍 묶음 첫 셀렉트(또는 legend/섹션 머리)로, 오류 줄을 거기에 `aria-describedby`로 연결 |

## 기획 확인 필요

| # | 화면 | 내용 (양쪽 인용) |
|---|------|------------------|
| QP-1 | S-40 / S-24 ② | 블록 ① 안내 문구가 두 곳에서 다르다 — S-24 ②(1830행) "본인 AI 키를 연결하면 연결한 모델의 한도 내에서 인사이트·서류 초안·모의 면접·AI 작성 대화를 쓸 수 있어요. 비용은 연결한 공급자에 직접 내요" vs S-40 표(1909행) "AI 기능은 선택이에요. 본인 AI 키를 연결하면 인사이트·서류 초안·모의 면접·AI 작성 대화를 쓸 수 있어요. 비용은 연결한 공급자에 직접 내요". 구현은 S-24 ② 쪽. S-40 절이 원천이라고 한 S-24 ② 머리(1824행)와 충돌 — 어느 쪽이 정본인지 |
| QP-2 | S-40 행 · S-41 · C-19 | "화면 이름은 GPT(공급자 값 `openai`), 문서·데이터는 OpenAI"(1831행)의 범위. 구현은 행 제목·사용량 탭·S-30 소제목만 "GPT"이고, **같은 GPT 행 안의** C-19 배지("OpenAI · 유료 · 연결됨")·상태 줄("OpenAI 연결을 잠시 멈췄어요", 무효 원인 문구)·S-41 단계 문구는 "OpenAI"(`provider-row.tsx:65-66,95,156`, `key-connect-flow.tsx:142,526,624`). 한 행에 두 이름이 섞인다 — C-19·C-20·토스트까지 GPT로 바꿀지 |
| QP-3 | S-24 ① | 엔지니어 리포트의 P-22~P-26(미저장 확인 버튼 글자, 다크 모드 시스템 복귀, 계정 탭 불러오기 실패 문구, "선택 안 함"·연도만 고른 기간, `stale_write` 표시 방법)과 S-30 AI 데이터 처리 본문 원문 부재, 처리방침 본문의 "기본 프로필(선택): 표시 이름, 희망 직무, 총 경력 연수, 관심 산업"(`policy-content.ts:210,237`) 잔존 — QA도 같은 판단(구현은 보수적 해석 + `[UI-가정]` 표시 확인함) |

## 재확인 결과

첫 라운드 — 해당 없음.

## 기계 검사 출력

| 검사 | 결과 |
|------|------|
| `pnpm typecheck` (`next typegen && tsc --noEmit`) | 통과 (EXIT 0) |
| `pnpm lint` (`eslint`) | 통과, 경고·오류 0 (EXIT 0) |
| `pnpm vitest run` | Test Files 156 passed · Tests 2504 passed (38.2s), `mock-isolation` 포함 |
| `pnpm build` | 통과 (EXIT 0). `/policies/[doc]` 4경로 생성(`generateStaticParams` = `POLICY_TYPES` 4종) |

## 참고 (이슈 아님)

- `profile_job_interests`·`profile_options` 행 타입이 `types/db.ts`에 없고 mock이 생성 타입을 직접 쓴다(엔지니어 리포트 7절 요청) — 백엔드 행 타입 추가 시 맞추면 됨.
- `lib/data/profile.ts`의 `optionsOf`·`jobRolesOf`·`optionLabel`은 server-only 모듈이라 클라이언트 폼이 같은 필터를 다시 구현했다(`profile-basics-form.tsx:453-457`). 동작은 같다.
