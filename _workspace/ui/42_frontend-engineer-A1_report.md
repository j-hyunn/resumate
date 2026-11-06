# 42 런 — frontend-engineer (A1 + 설정 다이얼로그 셸 + 근거 칩) 리포트

- 날짜: 2026-11-05 · 브랜치 `claude/epic-sutherland-f2c874` (커밋 안 함)
- 기준: UX v5.17a S-24 ①~④ · S-30 · S-40 · S-42 · C-01/C-02, design-system v5.11 5.11, 백엔드 R13 `02_api_notes.md`

## 1. 파일

### 새로 만든 파일
| 파일 | 내용 |
|------|------|
| `src/components/common/shell/settings-guard.tsx` | 미저장 확인 연결부 (`useSettingsGuard`, `useGuardedAction`) |
| `src/components/account/account-tab.tsx` | S-24 ① 계정 탭 (계정 · 내 정보 · 위험 구역) |
| `src/components/account/profile-basics-form.tsx` | 내 정보 폼 + `SectionSaveBar` · `JobInterestRows` · `HighestEducationFields` · `OptionSelect` |
| `src/components/account/profile-basics-model.ts` (+`.test.ts`) | 폼 모델(순수): DTO↔폼, 저장 페이로드, dirty, 검증 문구, 서버 `details.field` 매핑 |
| `src/components/account/policies-tab.tsx` | S-24 ③ 약관 탭 |
| `src/components/account/feedback-tab.tsx` | S-24 ④ 개선 요청 탭 |
| `src/components/account/provider-row.tsx` | `ProviderRow` (`ProviderCard` 대체, 앵커 `provider-row-{p}`) |
| `src/components/account/provider-names.ts` | 공급자 화면 이름(GPT)·순서(Gemini→GPT→Claude)·플랜 안내 (서버 컴포넌트도 읽는 일반 모듈) |
| `src/components/account/usage-rows.ts` (+`.test.ts`) | S-42 7행 접기 |
| `src/lib/data/usage-display.ts` | `USAGE_FEATURE_DISPLAY_GROUPS`를 클라이언트 안전 모듈로 옮김 (`ai-usage.ts`가 다시 내보냄) |
| `src/lib/data/policies.ts` | `getCurrentAiDisclosures()` — S-30 AI 데이터 처리의 `ai_disclosures` 6행 (기존 서비스 `loadCurrentDisclosureRow` 재사용, anon 읽기) |
| `src/lib/mock/profile-options.ts` | `profile_options` 시드 101행 그대로 (마이그레이션 `20261113001500`에서 생성) |

### 바꾼 파일
- 셸: `common/shell/settings-dialog.tsx`(전면 재작성), `nav-user.tsx`·`ui/sonner.tsx`·`app/globals.css`(“설정 › 화면” 주석 정리)
- `ui/button.tsx`: `destructive-outline` variant 추가
- `common/evidence.tsx`: C-02 `profile` 근거 → 이동 버튼 자리에 “이 근거의 원본 화면은 더 이상 없어요”
- A1: `actions.ts`(계정 탭·내 정보 저장·동의 상태 액션), `ai-connection-panel.tsx`(블록 ①·② 재구성), `ai-usage-panel.tsx`(`AiUsageByProvider`로 재작성), `key-connect-flow.tsx`(S-41 공급자 선택을 라디오 행으로), `policy-content.ts`(`ai_data_use: []` 제거 → `StaticPolicyType` + `AI_DATA_USE_SECTIONS`), `policy-document.tsx`(AI 데이터 처리 공급자별 요약), `settings-section-list.ts`(탭 4개 + 옛 ID 호환표), `sign-out-button.tsx`(`destructive-outline`), `withdraw-form.tsx`·`app/(dashboard)/settings/withdraw/page.tsx`(`routes.settings("account")`)
- S-30 페이지: `app/(public)/policies/[doc]/page.tsx`
- S-04 폐기: `app/(dashboard)/(gated)/career/profile/page.tsx` → `permanentRedirect(routes.settings("account"))`, `components/career/actions.ts`(`saveProfileAction` 삭제), `form-parts.tsx`·`return-banner.tsx`·`career-return-slot.tsx`(주석에서 S-04 제거), `lib/routes.ts`(`routes.profile` 삭제, `settings()` 인자 = `SettingsTabId`)
- 데이터 계층: `lib/data/profile.ts`(**미리보기 분기만** — store 3읽기 + RPC와 같은 오류 코드·details), `lib/data/ai-usage.ts`(레거시 `getAiUsageSummary`·`computeAiUsageSummary`·`toUiUsageSummary`·`USAGE_FEATURE_ORDER` 삭제), `lib/data/actions.ts`(`getAiUsageSummaryAction` → V412), `lib/data/consent-items.ts`(`POLICY_TYPES` 3→4종), `lib/data/labels.ts`(`displayInputTokens` 삭제 — 쓰는 곳 없음), `types/db.ts`(옛 `AiUsageSummary` 삭제 — 다른 호출자 없음 확인)
- mock: `lib/mock/fixtures.ts`(`profile_job_interests`·`profile_options`, 값 있는 내 정보 행, `policy_versions` `ai_data_use` 행, 비용 2열 = 토큰 × 가격표 단가(cost.ts 마이크로 USD 규칙), Claude 유료 기록 2건 — 키 없는 공급자 탭 미리보기), `lib/mock/ai.ts`(비용 2열·합계 같은 규칙)

### 지운 파일
`components/career/profile-form.tsx`, `components/account/settings-sections.tsx`, `consent-settings.tsx`, `ai-status-line.tsx`(계정 탭에서 빠져 쓰는 곳 없음), `provider-card.tsx`

## 2. 화면별 요약

- **S-24 틀**: 탭 4개(계정 `UserRound` · AI 연결 `PlugZap` · 약관 `FileText` · 개선 요청 `MessageSquarePlus`), `md:max-w-[760px] lg:max-w-[880px]`, 본문 높이 `min(640px, 100dvh−4rem)` 고정, 탭 목록 `--sidebar-width: 12rem`, 머리 `h-16` “설정 › {탭}”, 본문 `#settings-body px-6`. 좁은 화면 `grid-cols-4` 탭 줄. AI 연결 경고 점 유지(invalid·needs_check). 옛 ID: `withdraw`→계정+`#settings-danger-zone`, `ai-usage`→AI 연결+`#settings-ai-usage`, `consents`·`ai-data`→약관, 그 밖 → 계정. 열 때마다 탭 본문 재마운트(다시 읽기), 열 때 탭 지정 없으면 계정.
- **미저장 확인**: Dialog `onOpenChange(false)`(Esc·바깥 누르기 포함)·탭 버튼(사이드바/좁은 탭 줄 둘 다)·`openSettings` 다른 탭·[회원 탈퇴]가 `runGuarded`를 거친다. AlertDialog `sm:max-w-md`, “저장하지 않고 닫기”(muted-ghost, 폼 리셋) / “저장하고 닫기”(default, 저장 중 Loader2) / X = 계속 편집. 저장 실패·검증 오류면 확인만 닫고 첫 오류 칸/섹션 머리로 포커스. 로그아웃은 묻지 않음.
- **S-24 ① 계정 탭**: 이메일 읽기 전용, 내 정보(`getProfileBasics`/`saveProfileBasics`, 기대 버전 = 조회 `updatedAt` → 응답 `updatedAt`), 셀렉트 placeholder “선택해 주세요” + “선택 안 함”(sentinel `__none` → null), 내려간 저장값은 계속 보임, 쌍 행 최대 2(직군 전 직무 disabled “직군을 먼저 골라 주세요”, 직군 바꾸면 직무 비움, 2쌍이면 추가 disabled + “최대 2개까지 고를 수 있어요”), 최종 학력 6칸 + 안내 줄, 검증 문구 4종 + 기간, 오류 6종 처리(`stale_write` 재조회 + warning Alert 안 “내가 고친 값” 목록 / `invalid_profile_option` 옵션 재조회 + 머리 줄 + 칸 아래 + 포커스 / `field_too_long` / `invalid_period` / `duplicate_job_interest` `details.sortOrder` 행 아래 인라인 + 그 행 포커스 / `too_many_job_interests` 추가 버튼 아래), 그 밖 실패 “내 정보를 저장하지 못했어요 · 다시 시도”, 성공 C-06 “저장됨 HH:MM” + sr-only “내 정보를 저장했어요”, 빈 상태 줄, Enter 제출 막음. 위험 구역 `destructive-outline` 로그아웃·회원 탈퇴.
- **S-24 ②**: 블록 ① “모델 공급자 설정” + 안내, 활성 없음 경고, `ProviderRow` 3줄(Gemini→GPT→Claude, 플랜 안내, 추천 배지는 Gemini 미연결만, 상태 배지 = C-19 글자 그대로, 2행 상태 줄, 무효 3행 “무효 키는 교체한 뒤 활성으로 고를 수 있어요”, 동의 필요 3행, [연결] / [키 교체]·[다시 확인]·[동의하기] + ⋯ “{공급자} 키 관리”), 사용량 입구·원칙 줄 삭제. 블록 ② `AiUsageByProvider`: 고지 Alert(sticky 아님) → line 탭 3개 + 고른 공급자 대시보드 링크 → 기간 → 무료 등급 줄(그 공급자 키의 `connection_tier`) → 7행 표(기능/입력 비용/호출 수/출력 비용, 비용 칸 둘째 줄 토큰, 0행 흐림, 합계 없음, 정렬) → 가격표 줄 + 가격표 보기 → 하단 안내 2줄. <640 행 목록 + 정렬 Select. 연결 전 한 줄 / 기록 없음 / 그 공급자만 없음 문구.
- **S-24 ③**: 문서 4행 [전문 확인](새 탭, `aria-label` “{문서} 전문 확인 (새 탭)”), 선택 동의 Switch 2개(즉시 저장, 그 스위치만 disabled, 실패 시 되돌림 + “변경하지 못했어요 · {항목} 설정이 그대로예요 · 다시 시도”), 원칙 줄 상자 + `/policies/ai_data_use` 링크. 필수 동의 기록 없음.
- **S-24 ④**: `IS_FEEDBACK_FORM_READY` 분기. 지금은 준비 중(disabled 버튼 + “준비 중” 배지 + 안내).
- **S-30 `/policies/ai_data_use`**: 머리글 = `policy_versions`(ai_data_use) 버전·시행일, 조항 2개(원칙 · 보내는 내용) + “공급자별 데이터 사용” 6개 소제목+단락(`DISCLOSURE_FACTS` 문장 + 행의 고지 버전·시행일·약관 확인일 + 공급자 약관 링크). 다른 세 문서 링크. 로컬 Supabase(anon)·미리보기 둘 다 6행 렌더 확인(curl).
- **S-04 폐기**: `/career/profile` → 308 `/career?settings=account`(로그인 상태; 비로그인은 게이트가 먼저 sign-in으로 보냄 — curl 확인). 화면 안 링크(옛 계정 섹션 “기본 프로필 편집”) 제거.
- **C-01/C-02**: 칩 그대로, `source_type === "profile"`이고 `href` 없으면 Info 아이콘 + “이 근거의 원본 화면은 더 이상 없어요”.

## 3. `?state=` (다이얼로그를 URL `?settings={tab}&state=…`로 열 때)

| 탭 | 값 |
|----|----|
| 계정 | `loading` · `error` · `empty` · `save-failed` · `stale-write` · `invalid-option` · `duplicate-interest` (뒤 셋은 첫 저장만 그 결과; 그 밖에 mock 저장도 RPC와 같은 순서로 실제 거부함 — 같은 쌍 두 번 고르면 `duplicate_job_interest`) |
| AI 연결 | `loading` · `error` · `ai-locked` · `key-invalid` · `key-check` · `no-active` · `paused` · `recheck-failed` · `save-failed` · `ai-return` · `consent-required` · 사용량 `empty` · `usage-loading` · `usage-error` |
| 약관 | `loading` · `error` · `save-failed` |
| 개선 요청 | `feedback-ready` (주소 있는 모양) |
| S-30 | 기존 `loading` · `error` · `not-found` |

예: `/career?settings=withdraw&state=empty` → 계정 탭 + 위험 구역 스크롤, `/career?settings=ai-usage` → AI 연결 탭 + 사용량 블록.

## 4. 검사 결과
- `pnpm typecheck` 통과 · `pnpm lint` 통과(경고 0) · `pnpm vitest run` 156 파일 2504 통과(새 테스트 8건) · `pnpm build` 통과
- **브라우저 확인: 못 함** — Claude in Chrome 확장이 연결되지 않았다. dev 서버(3142)에서 curl로 S-30 AI 데이터 처리(미리보기·실제), `/career/profile` 리다이렉트, `/career?settings=account&state=empty` 200만 확인. 다이얼로그(클라이언트 렌더)는 화면으로 보지 못했다 → `QA 통과 (mock·브라우저 미확인)` 대상.

## 5. [UI-가정]
- G-62 크기·고정 높이, G-63 좁은 탭 줄(`min-w-72` 아래로는 가로 스크롤), G-64 경고 점 범위, G-65 “선택 안 함”(새 문구), G-66 저장 줄 위치·토스트 없음·Enter 제출 막음, G-67 마지막 쌍 행 삭제 = 비우기, G-68 `destructive-outline`, G-69/G-70 사용량 표 열 폭·좁은 화면 목록, G-71 개선 요청 준비 중 모양, G-72 `stale_write` 내가 고친 값 목록, G-73 Switch·원칙 상자, G-74 S-30 공급자별 소제목+단락(브리프의 “사실 표”가 아니라 설계 5.11/6 A1을 따름)
- 미저장 확인 설명 줄 “저장하지 않고 닫으면 내 정보에서 고친 내용이 사라져요”(새 문구)
- 계정 탭 불러오기 실패 “설정을 불러오지 못했어요 · 다시 시도”(v5.10 문구, P-24)
- 기간 연도·월 중 하나만 고르면 저장을 막고 묶음 `aria-invalid`만(문구 없음, P-25). 연도 범위 1960 ~ 올해+6
- 선택 동의 새 라벨(“이용 패턴 기록 활용”·“기능 업데이트, 소식 받기”)은 **약관 탭에서만**, S-03 가입 라벨은 그대로
- “GPT” 화면 이름은 S-40 행·사용량 탭·S-30 요약에만. C-19 배지·C-20·토스트는 기존 “OpenAI” 그대로(설계 “C-19 글자 그대로”)
- `invalid_profile_option`의 `details.field`가 `job_family`/`job_role`(행 위치 없음)이면 값이 있는 첫 쌍 행에 표시
- S-30 AI 데이터 처리 조항 구성(원칙 · 보내는 내용 · 공급자별) — docs/legal 원문 없음
- 성공 sr-only 알림 “…을 켰어요/껐어요”(약관 토글)

## 6. 기획 확인 필요
- P-22~P-26 (설계 노트 그대로 — 미저장 확인 버튼 글자, 다크 모드 시스템 복귀, 계정 탭 실패 문구, 셀렉트 비우기·연도만 고른 기간, `stale_write` 표시 방법)
- S-30 AI 데이터 처리 **본문 원문**이 없다(docs/legal에 문서 없음). 지금은 화면 문구 조합 — 법무 문구 필요(D-39 범위)
- 개인정보 처리방침 본문(`policy-content.ts`, docs/legal 미러)에 아직 “기본 프로필(선택): 표시 이름, 희망 직무, 총 경력 연수, 관심 산업”이 남아 있다 — SD-2·SD-A17 반영 개정 필요(법무 문서라 UI가 고치지 않음)
- 브리프 “6행 사실 표” vs 설계·UX “한 단락” — 단락으로 구현

## 7. 백엔드 요청
- 연결 대기 함수 없음(모든 계약 사용).
- 참고(백엔드 소유 파일을 고친 곳 — 확인 부탁): `lib/data/profile.ts` **미리보기 분기만** 교체, `lib/data/ai-usage.ts` 레거시 함수 삭제·상수 이전, `lib/data/actions.ts` `getAiUsageSummaryAction` V412로, `lib/data/consent-items.ts` `POLICY_TYPES` 4종, `types/db.ts` 옛 `AiUsageSummary` 삭제, 새 `lib/data/policies.ts`(`loadCurrentDisclosureRow` 재사용).
- 원하면: `profile_job_interests`·`profile_options` 행 타입을 `types/db.ts`에 (지금 mock은 생성 타입 `Database[...]`를 직접 씀).

## 8. QA-42 1라운드 수정

| 이슈 | 고친 것 |
|------|---------|
| QA-42-01 | `src/lib/data/profile.ts` mock 저장을 실제 경로 순서·모양으로: ① 서비스 `checkJobInterests`처럼 `too_many_job_interests` → `duplicate_job_interest`(`{field: "job_interests.{n}", sortOrder: n}`)를 `stale_write`보다 먼저 ② RPC 순서 `stale_write` → `field_too_long`(`PROFILE_LIMITS`, `details.field` = 컬럼명) → `invalid_period` ③ 트리거 순서: profiles 코드 5칸 → 쌍 `job_family` → `job_role`(부모 불일치 포함), 쌍 오류 `details.field` = `"job_family"`/`"job_role"`(위치 없음) ④ profiles 칸의 `is_active = false` 코드는 저장값과 다를 때(새로 고를 때)만 거부. **쌍은 실제 RPC가 delete → insert라 늘 새 행(`p_is_new = true`)이어서, 내려간 쌍 코드는 재저장도 거부된다 — mock도 실제와 같게 했다** (아래 백엔드 확인) |
| QA-42-02 | `profile-basics-model.ts`에 `sentPairRows(v)`(보낸 위치 → 화면 행)·`pairRowOf(details, sentRows)` 추가. 폼은 저장 직전 대응표를 만들어 `duplicate_job_interest`·위치 있는 오류를 그 화면 행에 붙인다. 위치 없는 쌍 `invalid_profile_option`은 보낸 첫 쌍의 행(폴백 `[UI-가정]`)에 붙이고 `job_role`이면 직무 셀렉트, `job_family`면 직군 셀렉트로 포커스. 테스트: 1행 빈 칸 + 2행 값 → 2행(index 1) |
| QA-42-03 | 사용량 표 열 머리 "입력 비용(USD)" · "출력 비용(USD)" (UX 글자 그대로, 열 폭 `w-32`) |
| QA-42-04 | 약관 탭 sr 알림 조사를 `labels.ts`의 `objectParticle`로 → "기능 업데이트, 소식 받기를 켰어요" |
| QA-42-07 | `too_many_job_interests` 오류 줄(`#pb-job-interest-too-many`)을 쌍 `fieldset`의 `aria-describedby`(+`aria-invalid`)로 잇고, 포커스는 마지막 쌍 행의 직군 셀렉트로 |

검사: `pnpm typecheck` 통과 · `pnpm lint` 통과 · `pnpm build` 통과 · `pnpm vitest run` **2503 통과 / 1 실패** — 실패는 `src/lib/data/career.integration.test.ts:317`(로컬 스택) `profile.display_name: "홍길동"` 기대값. 리더의 QA-42-05 작업(같은 파일에서 `updateProfile` 테스트를 지움)으로 그 값을 쓰던 테스트가 없어져서 남은 단정이 깨진 것이고, 이번 수정과 무관하다(내 파일 밖 — 손대지 않음). 새 테스트 1건(`profile-basics-model.test.ts`) 추가.

백엔드 확인 요청(추가): 쌍 저장이 delete → insert라 `profile_job_interests`의 트리거가 늘 `p_is_new = true`로 본다 → 목록에서 내려간 직군·직무를 이미 저장한 사용자는 그 쌍을 지우지 않으면 내 정보를 다시 저장할 수 없다. DM 2.1.1 "내려간 값은 계속 보인다"와 어긋날 수 있다.
