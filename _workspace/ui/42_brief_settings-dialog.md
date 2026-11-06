# 42 런 브리프 — 새 설정 다이얼로그 UI 후속 (settings-dialog, SD-*)

- 날짜: 2026-11-05
- 요청: 사용자 "UI 후속 런" — 설정 다이얼로그 기획 사이클(`settings-dialog`)의 UI 후속
- 브랜치: `claude/epic-sutherland-f2c874` (PR #58). **백엔드 R13이 같은 브랜치에 이미 있다** — 이 UI 런은 같은 머지로 나간다(백엔드 응답 키가 사라졌으므로 따로 나가면 화면이 깨진다)

## 기준 기획
PRD v4.14 · UX **v5.17a** · AI v4.12a · DM v4.12a. 결정: `docs/planning/decisions.md` 3.22(SD-*)·3.23(R13-U1~U4)·4.16(UI 후속 목록)·4.17.

## 디자인 입력
**Figma 없음.** 기획 사이클의 원천은 사용자가 올린 화면 3장(계정 / AI 연결 / 약관)이었고 파일로 남아 있지 않다. 그 화면을 글로 옮긴 것이 **UX v5.17 S-24 ①~④ 컴포넌트 표**다 — 이것이 정본이다. "개선 요청" 탭은 원래 화면이 없었다.

## 범위 (영역 A1 계정 + 공통 셸 일부)

| ID | 무엇 | UX 위치 |
|----|------|---------|
| S-24 | 설정 다이얼로그를 **왼쪽 탭 4개**(계정 · AI 연결 · 약관 · 개선 요청)로 재구현. 기존 섹션 7개(계정·AI 연결·AI 사용량·동의 관리·AI 데이터 처리·처리방침·약관·회원 탈퇴 + 화면)는 없어진다 | 02-user-flows 1773~ |
| S-24 ① | 계정 탭: 계정(이메일 읽기 전용) · **내 정보**(섹션 단위 저장, 셀렉트 5 + 관심 직군·직무 쌍 최대 2 + 최종 학력 6칸, 오류 6종, 미저장 확인) · 위험 구역(로그아웃 · 회원 탈퇴) | 1783~ |
| S-24 ② | AI 연결 탭 = **S-40**(라디오 행 3개 + [연결] + ⋯ 메뉴 + 플랜 안내 문구) + **S-42**(공급자 탭 + 기능별 교차 표 7행, 열 = 기능 / 입력 비용 / 호출 수 / 출력 비용 + 토큰 보조 표기) | 1822~ |
| S-24 ③ | 약관 탭: 문서 4개 [전문 확인] + 선택 동의 토글 2개. **필수 동의 기록은 표시하지 않는다**(SD-Q3 (다) 확정) | 1846~ |
| S-24 ④ | 개선 요청 탭: 외부 폼 링크. **주소 없음 → "준비 중"**(decisions 3.23 R13-U3) | 1857~ |
| S-04 | **폐기** — `/career/profile`은 리다이렉트 `[가정]`(UX 명세대로). 화면 목록·링크에서 걷어낸다 | 5.1j·사이트맵 |
| S-30 | `/policies/ai_data_use` 페이지 추가 = `policy_versions` 머리글 + `ai_disclosures` 6행 공급자·등급별 사실 표 | S-30 |
| C-01·C-02 | 근거 칩 `source_type = 'profile'`: 라벨은 저장값 그대로, **"원본으로 이동"만 비활성** | C-01·C-02 |
| L-01·L-02 | 계정 메뉴 3항목 유지, "기본 프로필" 서술 정리 | L-01 |

## 백엔드 계약 (전부 있음 — 연결 대기 없음)

| 쓰임 | 데이터 함수 (`src/lib/data/`) |
|------|------------------------------|
| 내 정보 조회·저장 | `profile.ts` — `getProfileBasics()` · `saveProfileBasics()` · `optionsOf` · `jobRolesOf` · `optionLabel` · `MAX_JOB_INTERESTS` (=2). 기대 버전 = 조회의 `profile.updatedAt`, 저장 응답 `updatedAt`으로 갱신. 오류 `details.field`로 포커스, 쌍 중복은 `details = { field: "job_interests.{n}", sortOrder: n }`. 연월 `'YYYY-MM'` |
| 사용량 | `ai-usage.ts` — **`getAiUsageSummaryV412()`** (`providers[]` 교차) + `USAGE_FEATURE_DISPLAY_GROUPS`(7행 묶음 상수). 끝나면 레거시 `getAiUsageSummary()`와 `src/types/db.ts`의 옛 `AiUsageSummary`를 지운다 |
| 약관 문서 | `consent-items.ts` `POLICY_DOCUMENT_TYPES`(4종) · `account.ts` `getPolicyVersions()`(4종). 구현하면 `POLICY_TYPES`(3종) → 4종, `components/account/policy-content.ts`의 `ai_data_use: []` 빈 항목 정리 |
| 개선 요청 | `src/lib/contracts/feedback.ts` — `FEEDBACK_FORM_URL` · `IS_FEEDBACK_FORM_READY` (읽기만, 이 파일은 백엔드 소유) |
| 선택 동의 토글 | 기존 그대로(`consents` 새 행 / `withdrawn_at`) |

백엔드가 UI 소유 파일을 최소 수정한 것(이번 런에서 제대로 고칠 대상): `components/career/profile-form.tsx`(이름 한 칸만 남음 → S-04 폐기로 없어질 파일), `lib/mock/fixtures.ts`, `lib/mock/ai.ts`(비용 2열 임시 7:3), `components/account/policy-content.ts`.

**mock 미리보기 데이터**도 이 런 몫: `profile_job_interests`·`profile_options` 픽스처(시드 101행의 일부라도), 값 있는 내 정보 행, `policy_versions`의 `ai_data_use` 행, 사용 기록 비용 2열.

## 진행
1. ui-designer — `docs/ui/design-system.md`의 설정 다이얼로그 절(지금은 섹션 7개 기준)을 탭 4개 기준으로 개정 + 새 패턴(섹션 단위 저장 폼, 쌍 행 편집, 공급자 탭 + 교차 표, 라디오 행 연결 목록)
2. frontend-engineer (A1 + 셸의 설정 다이얼로그 + 근거 칩) — 한 명. 공통 파일을 함께 다뤄 동시 편집이 없다
3. ui-qa — Q1~Q7 + Q11 + 빌드
4. 리더 브라우저 확인 — 로컬 Supabase + 테스트 계정
