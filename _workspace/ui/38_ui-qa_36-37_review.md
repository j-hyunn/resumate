# UI QA — 36 런(열린 결정 UI 후속) · 37 런(U36 후속) · 1a3522d R11 계약 연결 (라운드 1)

- 기준: main `5c0933a`(PR #48·#49·#50 머지 뒤), 브랜치 `claude/qa-36-37-r12-status`
- 기획: PRD v4.13 / UX v5.14 / AI v4.11 / DM v4.11, decisions 3.18·3.19·4.12·4.13, design-system v5.8
- 본 범위: `git diff a7af00f 5c0933a -- src/components src/app src/lib src/types`(UI 쪽 95파일), 1a3522d 데이터 계층(`git diff 7a1356e 1a3522d -- src/lib/data src/lib/mock src/types`)
- 브라우저 확인: **하지 않음**(요청 범위 밖, 사용자가 따로 확인). Q12 전부 "미확인" → screen-status는 `QA 통과 (mock·브라우저 미확인)`까지만 가능

## 요약

- **Critical 0 / Major 2 / Minor 8**
- 기계 검사: lint 통과(경고 0) · typecheck 통과 · vitest 146 파일 / 2381 테스트 전부 통과(37 런 때 실패하던 로컬 통합 테스트 4건도 통과) · build 통과(`/interviews/[sessionId]/result` 라우트 생성)
- 큰 줄기(OD-I1·I2 점수 표시, OD-I6 자기소개서 삭제됨 읽기 전용·새 주소, OD-C3·C6·P2·P6·P11·B1·B4, 5.1i 문구 6건, CR-23 전체 용어, C-21 고지 모듈, R11 연결)는 명세와 맞다. 남은 것은 C-17 항목 등급 라벨과 질문별 점수 근거(Major 2건), 그리고 정리성 Minor.

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 | Q11 | Q12 |
|---------|----|----|------|----|----|----|----|----|-----|-----|-----|
| C-17 점수 표시 | ⚠️ UQ-381 | ❌ UQ-380 | ✅ | — | ✅ | — | ⚠️ UQ-387 | ✅ | ✅ | ✅ | 미확인 |
| S-22 면접 결과 (+ `/interviews/{id}/result`) | ⚠️ UQ-381 | ⚠️ UQ-380 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ UQ-382 | 미확인 |
| S-33 면접 답변지 | ✅ | ✅ | ✅ | ✅ (삭제됨 → 새 주소) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-37 모의 면접 전체 세션 | ✅ | ✅ | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ⚠️ UQ-382 | 미확인 |
| S-20 면접 준비 (CR-23 문구) | ✅ | ✅ | ✅ | ✅ (`/applications/deleted/interview` 404) | — | — | ✅ | — | — | ✅ | 미확인 |
| C-05 삭제 확인 | ✅ | ⚠️ UQ-383 | ✅ | — | ✅ | — | ✅ | ✅ | — | ✅ (R11 RPC) | 미확인 |
| C-14 인터뷰 전형 팝업 | ✅ | ✅ | — | ✅ | — | — | ✅ | — | — | — | 미확인 |
| S-39 지원 현황 보드 | ✅ | ✅ (토스트는 UQ-383 메모) | — | ✅ | ✅ | — | ✅ | — | — | — | 미확인 |
| C-18 AI 잠금 | ✅ | ✅ | — | — | ✅ | — | ✅ | — | — | — | 미확인 |
| C-19 공급자 배지 | ✅ | ✅ (B-7, R-OD-15) | — | — | — | — | ✅ | — | — | — | 미확인 |
| C-20 AI 오류 안내 | ✅ | ✅ (OD-B1, Q-25) | — | — | ⚠️ UQ-389 | — | ✅ | ✅ | — | — | 미확인 |
| C-21 데이터 사용 고지 | ✅ | ✅ (AI C-7.1과 대조) | — | — | ✅ | — | ✅ | — | — | ✅ | 미확인 |
| S-10 프로젝트 상세 (패널) | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ (`clientId`, `turnFailure`) | 미확인 |
| S-44 산출물 상세 (패널) | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | — | ✅ | 미확인 |
| S-18 자소서 문항 설정 | ✅ | ✅ (K-28) | — | ✅ | — | — | ✅ | — | — | — | 미확인 |
| S-40 AI 연결 | ✅ | ✅ (Q-15) | — | — | — | — | ✅ | — | — | — | 미확인 |
| S-24 · S-30 | ✅ | ✅ (탈퇴 설명, 정량 성과 삭제 U36-5) | — | — | — | — | ✅ | — | — | — | 미확인 |
| CR-23 전체(S-13~S-19·S-31·메뉴·이동 경로) | ✅ | ✅ (화면 안 "기업 JD" 0곳) | — | ✅ (`menuKeyForPath`) | — | — | ⚠️ UQ-387 (문서) | — | — | — | 미확인 |
| 데이터 계층 R11 연결 (1a3522d) | — | — | ✅ (생성 타입 nullable·스냅샷 컬럼) | — | — | — | — | — | — | ⚠️ UQ-382·UQ-384·UQ-385 | 미확인 |

## 브라우저 확인

하지 않음(요청 범위 밖). 사용자가 브라우저로 볼 때 아래를 확인해야 한다 — 코드로는 판단할 수 없는 것만 적었다.

1. **실제 삭제 → 남은 면접**: 끝난 면접이 있는 자기소개서를 지울 때 C-05 영향 줄("작성 중인 면접 {N}" / "끝난 모의 면접 {M}개는 기록에 남아요")의 수가 RPC 값과 맞는지 → 삭제 뒤 S-37에 "{회사 – 포지션}" + "자기소개서 삭제됨" 행, 필터 "삭제된 자기소개서", 행을 누르면 `/interviews/{id}/result`, 이동 경로 "모의 면접 › … · 자기소개서 삭제됨 › 면접 결과", 다시 채점·새 면접·자기소개서 링크 없음.
2. 그 세션의 질문 근거 칩 중 JD 요건 근거가 C-01 "원본 삭제됨"(인용문·이동 없음)으로 보이는지(R11 트리거가 근거를 분리한 실제 행).
3. 옛 주소 `/applications/{지운 id}/interview/{sessionId}`·`…/result` → 새 주소로 이동하는지, 살아 있는 세션을 `/interviews/{id}/result`로 열면 원래 S-22로 가는지.
4. S-22 점수: 백필 뒤 실제 세션의 "{n}점 / 100", "반영 질문 {n}개 · 미응답 {n}개(0점으로 반영)", 모두 미응답 = "0점 / 100" + "답변이 없어 0점이에요", 항목 등급이 점수 있을 때만.
5. S-10·S-44: 새 페이지 첫 저장 토스트 1회, 패널 첫 메시지 저장 때는 패널 토스트만, 응답 중 탭 닫기 → 다시 열면 "답을 받지 못한 메시지예요 · 다시 보내기" → 다시 보내면 사용자 메시지가 늘지 않음, 중지 직후 같은 줄.
6. Claude 기존 동의 사용자의 재동의(C-21 알림 "데이터 사용 고지가 바뀌어 다시 동의가 필요해요"), Gemini·OpenAI는 재동의 없음.
7. 좁은 화면: S-37 카드의 "자기소개서 삭제됨" 배지 줄바꿈, 답 없는 메시지 줄(오른쪽 정렬) 넘침.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 | 고치는 법 |
|----|--------|------|------|-----------|-----------|------|------|-----------|
| UQ-380 | Major | foundation | C-17 / S-22 | `02-user-flows.md` C-17 "항목별 등급·다음 연습 (v5.13, OD-I2)" 1712줄: 등급 라벨 **우수 / 양호 / 보완 필요 / 미흡 / 해당 없음**. 서버 근거 문구도 같은 이름(`supabase/migrations/20261113000900_r11_interview_score_d14v1.sql:18,32` "구체성 보완 필요 · 의도 부합 양호 …") | `src/lib/data/labels.ts:165-171` `GRADE_LABELS`(사용 `src/components/interviews/result-view.tsx:718`) | 항목 등급 배지가 명세 라벨과 같고, 같은 카드의 점수 근거 문장과 같은 말 | "매우 좋음 / 좋음 / 보통 / 부족"(`[UI-가정]` 그대로, design-system P-2 시절 임시값). 세션 근거 "구조는 보완 필요"인데 배지는 "보통"으로 보여 같은 화면에서 두 말이 섞인다 | `GRADE_LABELS = { excellent: "우수", good: "양호", fair: "보완 필요", poor: "미흡", not_applicable: "해당 없음" }`, `[UI-가정]` 주석 삭제. 색 매핑(design-system 3.16)은 그대로. UQ-387과 함께 |
| UQ-381 | Major | A4 | C-17 / S-22 답변 카드 | C-17 표 `scored` 행 질문별 열 1703줄: **"{score_value}점" / 100 + `score_rationale`** | `src/components/interviews/result-view.tsx:633`(점수), `:652`(고지) — 답변 `score_rationale`을 그리는 곳 없음(세션 것만 `:563-571`) | 질문이 `scored`면 점수 옆(또는 아래)에 그 답의 근거 한 줄(서버 문구 "구체성 … → 66점", 미응답은 "미응답 · 0점") | 답변 행은 `select("*")`로 `score_rationale`을 받지만(`src/lib/data/interview-rows.ts:199`) 카드에 보이지 않음 | 질문 카드의 질문 문장 아래 `ScoreDisclaimer` 옆에 `answer.score_rationale`을 `text-sm text-muted-foreground`로(세션처럼 펼치기로 할지는 ui-designer — UQ-387). `score_status === 'scored'`일 때만 |
| UQ-382 | Minor | 백엔드 요청(데이터 계층, 연결된 함수) | S-22 / S-37 다시 채점 | S-22 "자기소개서 삭제됨 — 읽기 전용" 없는 것 행 1694줄 "서버도 거부(DM)", `src/lib/contracts/interview.ts:158-161` `INTERVIEW_EVALUATION_REFUSAL_CODES`에 `interview_session_read_only` 포함(R11) | `src/lib/data/ai-jobs.ts:549`(real 분기는 `input_only`·`not_retryable`만 `refused`로 바꿈), `src/components/interviews/session-list.tsx:142`, `result-view.tsx:166-170` | 낡은 탭(다른 탭에서 자기소개서 삭제)에서 누르면 409 `interview_session_read_only` → 서버 문구 "자기소개서가 삭제된 면접 기록은 볼 수만 있어요." 안내 + 새로 읽기 | `read_only`가 throw로 올라가 일반 실패 토스트 "다시 채점 …하지 못했어요"가 뜸. 매핑해도 S-37 쪽 문구는 "다시 채점할 답변이 없어요"로 떨어짐 | `ai-jobs.ts` 거절 매핑에 `interview_session_read_only` 추가(`refused`로). S-37·S-22는 그 코드일 때 서버 문구 토스트 + `router.refresh()`. 화면은 버튼을 숨기므로 드문 경로 |
| UQ-383 | Minor | foundation | C-05 자기소개서 삭제 · 삭제 토스트 | C-05 자기소개서 행 858줄 첫 줄 "'{회사명 – 포지션명}' 자기소개서를 삭제할까요?", decisions 3.19 U36-7(이름에 "자기소개서"가 있으면 뒤 생략) | `src/components/common/delete-confirm-dialog.tsx:207`, `src/components/applications/shared.tsx:46,51` | 기본 이름 자기소개서도 "'새 자기소개서 (2026-11-05)'를 삭제할까요?"처럼 겹치지 않음(S-31 제목과 같은 규칙) | "'새 자기소개서 (2026-11-05)' 자기소개서를 삭제할까요?" / 토스트 "새 자기소개서 (…) 자기소개서를 삭제했어요". 같은 삭제인데 S-39 토스트는 "자기소개서를 삭제했어요"(`kanban-board.tsx:315`), S-13·S-31은 "{이름} 자기소개서를 삭제했어요" — 둘 다 `[UI-가정]` | 다이얼로그 첫 줄·토스트에 U36-7 규칙(`name.includes("자기소개서")`면 뒤 " 자기소개서" 생략)을 공통 헬퍼로. 토스트 문구는 하나로 맞추되 어느 쪽인지는 기획 확인(아래) |
| UQ-384 | Minor | foundation (mock) | S-22 삭제됨 미리보기 근거 칩 | FL-06 680줄 "근거 분리", DM v4.11 2.7.2(트리거가 `evidence_links.application_project_id`를 null로) | `src/lib/data/deletion.ts:468`(남는 세션 근거를 지우지 않고 `application_project_id`를 그대로 둠), 결과 `src/lib/data/evidence.ts:188,191` | mock 삭제도 실제처럼 남는 근거의 `application_project_id = null` → C-01 이동 없음 | mock에서 자기소개서를 지운 뒤 S-22의 JD 요건 근거 칩 링크가 `/applications/{지운 id}/jd`(없는 주소, 404) | `deletion.ts` mock 삭제 끝에서 `keptIds`가 가진 근거 행의 `application_project_id = null`(+ 트리거와 같게 인용문 비움). 미리보기와 실제가 같은 경로를 타게 |
| UQ-385 | Minor | A4 | 데이터 계층 정리 | DM v4.11 11.6 #1(이제 생성 타입이 `string \| null`, 스냅샷 컬럼 있음) | `src/lib/data/interviews.ts:209`("still carries the gone project's id" — 지금 mock 삭제는 null로 바꿈), `:219-220`("generated type still says string" + `as string \| null` 캐스트 불필요), `src/lib/mock/fixtures.ts:65-68` `MockInterviewSession`(스냅샷 필드가 이미 `InterviewSession`에 있음), `src/types/db.ts:1271-1276` `detached_interview_sessions?`(R11이 항상 줌) | 주석·타입이 R11 뒤 사실과 맞음 | 연결 전 주석·중복 타입이 남아 다음 수정자가 잘못 읽을 수 있음 | 주석 갱신, 캐스트 삭제, `MockInterviewSession = InterviewSession` 또는 삭제, `detached_interview_sessions` 필수로(타입은 A4 view model 영역, `DeletionImpact`는 foundation과 함께) |
| UQ-386 | Minor | A2 | S-10·S-44 패널 | `02-user-flows.md` S-10 "답을 받지 못한 메시지" 1465줄(v5.14, U36-3 확정 — 두 토스트 문구가 명세에 들어감) | `src/lib/data/career-v45-shared.ts:572,574` | 확정된 문구라 `[UI-가정]` 없음 | `turnInProgress`·`nothingToRetry`에 `[UI-가정]`·"no spec row"가 남음(4.13 UI 3 "표시만 정리"가 이 두 줄은 빠짐) | 두 주석을 "UX v5.14 U36-3"으로 바꿈 |
| UQ-387 | Minor | ui-designer | design-system | C-17 v5.13(OD-I1·I2), CR-23(U36-2), S-22·S-37 "자기소개서 삭제됨"(OD-I6) | `docs/ui/design-system.md:880-886`(3.16: "미응답" 배지, 등급 라벨 매우 좋음…, 모두 미응답·미응답 반영 줄 없음), `:2194-2196`(P-1·P-2가 열린 항목으로 남음 — 둘 다 v5.13에서 명세 문구가 생김), "기업 JD" 17곳(예: `:878` "기업 JD 추가"), "자기소개서 삭제됨" 표식 패턴 없음(코드는 `Badge variant="muted"`, `session-status.tsx:81-86`) | 3.16이 지금 C-17과 같고, 닫힌 P 항목은 해소 표시, 화면 용어가 CR-23 | 위 그대로 | 3.16을 C-17 v5.13으로(질문 "미응답 · 0점", 모두 미응답 0점 줄, 등급 라벨 우수…, 질문별 근거 자리 — UQ-381), P-1·P-2 해소, "기업 JD" → "자기소개서", 삭제됨 표식 = `Badge muted` 한 줄 |
| UQ-388 | Minor | 리더 | screen-status · decisions | ui-context "State preview switch"(화면별 `?state=` 값은 screen-status 맨 위에 적는다), decisions 3.19 U36-1·U36-2 | `docs/ui/screen-status.md:58`(S-22 경로 열에 `/interviews/[sessionId]/result` 없음), `:83-84`(U36-1·U36-2로 닫힌 기획 확인이 열린 채), `:100` 이하 "백엔드 연결 대기" 표(1a3522d·R12로 연결됨), 새 `?state=` 값 미기록(S-10·S-44 `unanswered`·`unanswered-canceled`·`reopen-failed`, S-22 `pending-method`·`not-scored`·`application-deleted`); `docs/planning/decisions.md:623` 4.12 UI 2가 아직 `/applications/deleted/…` `[UI-가정]` | 현재 상태와 맞음 | 낡은 줄 | 리더가 screen-status 갱신(36·37 대상 행을 `QA 통과 (mock·브라우저 미확인)`으로 + 이 리뷰 링크), 4.12 UI 2 문장은 기획 하네스로 넘김 |
| UQ-389 | Minor | foundation | C-20 `daily_quota_exhausted` 미리보기 | C-20 표 `daily_quota_exhausted` 행(OD-B1): 초기화 줄은 `quota_resets_at`이 있을 때만 | `src/components/common/ai-error-notice.tsx:480-481` | `?state=ai-failed-daily-quota`로 두 변형(초기화 줄 있음 / 제목만) 모두 볼 수 있음 | OD-B1로 미리보기 대체값(`nextQuotaReset`)을 지워서, 작업 행 없이 코드만 넘기는 `?state=` 미리보기는 이제 "제목만" 변형만 보임 — 초기화 줄 변형은 mock 작업을 실제로 실패시켜야만 보임 | 미리보기 전용 값 하나 추가(예: `ai-failed-daily-quota-reset` → mock `quota_resets_at` 채움). 실제 경로 동작은 그대로 |

## 기획 확인 필요

1. **자기소개서 삭제 성공 토스트 문구** (UQ-383): 명세 C-05 자기소개서 행은 "삭제 성공 토스트·이동은 FL-06"이라고만 하고 FL-06(670줄)은 "출발 화면으로 + 토스트"뿐이라 문구가 없다. 지금 S-39 "자기소개서를 삭제했어요" / S-13·S-31 "{이름} 자기소개서를 삭제했어요"로 둘로 갈림. (면접 세션은 "면접 세션을 삭제했어요"로 정해져 있음 — 같은 꼴이면 "자기소개서를 삭제했어요".)
2. **S-13 페이지 제목**: 명세 화면 이름은 "S-13 자기소개서 목록"(1521줄, "메뉴: 자기소개서 관리"), 구현 제목은 "자기소개서 관리"(37 런 `[UI-가정]` 3, 다른 메뉴처럼 메뉴 이름). U36-6~8에 안 들어가 열린 채.
3. (참고, 범위 밖) S-16 인사이트 안내 "프로젝트와 정량 성과를 더하면 더 정확해져요"(`src/components/applications/insight-view.tsx:356`) — 정량 성과는 v5.5에서 폐기(CR-11). U36-5는 법무 문서만 다뤘다. 문구 교체 여부.

## 재확인 결과

이번 범위(36·37 런)는 첫 QA라 이전 이슈 없음. 36·37 보고의 `[UI-가정]` 중 U36-1~U36-8로 닫힌 것은 코드에서 정리됨을 확인(삭제됨 라우트 `[UI-가정]` 삭제, `AI_FEATURE_NAMES.cover_letter` U36-6, S-31 제목 U36-7, 답 없는 메시지 줄 U36-3 — 단 UQ-386 두 줄 남음).

## 점검 메모 (맞은 것)

- OD-I6 라우트: 새 `src/app/(dashboard)/(gated)/interviews/[sessionId]/result/page.tsx`는 살아 있는 세션을 원래 S-22로, 옛 `…/result`·S-33은 삭제된 세션을 새 주소로 보냄(`withPreviewState`로 `?state=` 유지). 서로 되돌려 보내는 고리 없음(새 주소는 `application_project_id !== null`일 때만, 옛 주소는 `=== null` 또는 `deleted`일 때만 이동). S-20 `/applications/deleted/interview`는 404.
- S-22 삭제됨 화면: 이동 경로 "모의 면접 › {이름} · 자기소개서 삭제됨 › 면접 결과", 자기소개서 링크·다시 채점·종합 다시 정리·새 면접·면접 준비로 모두 숨김(`result-view.tsx:117,148,216,262,381`), JD·형제 세션 조회 안 함, "다룬 보완 요건" 원본 삭제됨. 결과 열람 표식은 R11 가드가 허용(`mark_interview_result_viewed`).
- S-37: 스냅샷 이름(R-OD-12 규칙이 서버 `detachedSessionName`과 같음), 표식, 메뉴 "삭제"만, 필터 "삭제된 자기소개서"(그만둔 묶음 포함), 자기소개서 0개 + 남은 세션 = 빈 상태 안내 + 목록.
- C-05: K-2·K-3 문구, `kept_interview_sessions` = 0이면 줄 숨김, 커리어 삭제 "삭제된 자기소개서의 면접 기록 {n}개"(0이면 숨김), 실제 경로 `getApplicationProjectDeletionImpact` RPC(`cascade`·`kept`).
- R11 연결: `career-v45-save.ts` `clientId`는 새 행일 때만, 페이지 상태 `crypto.randomUUID()` 한 번(`project-page.tsx:162`, `deliverable-page.tsx:73`) — 패널 첫 메시지 저장도 같은 값. `messagesOf`가 `turnFailure` → `turn_job`(canceled/failed). `interview-rows.ts` `SESSION_SELECT`에 스냅샷 컬럼, null 프로젝트는 이름 조회에서 뺌.
- 문구 5.1i 6건(K-2·K-3·K-28·B-7·Q-15·Q-25), C-14·S-39·S-24 "기업 JD" 잔여, C-18 설명 2곳 — 명세 문장과 일치. 화면 안 "기업 JD" 0곳(남은 2곳은 `src/lib/contracts/application.ts` 주석, 백엔드 소유).
- C-21: `src/lib/ai-disclosures.ts` 사실 값이 AI C-7.1 표와 일치(Claude "추론: global(여러 국가) · 저장: 미국", 보관 기간 구체 값, "작성 중인(저장하지 않은) 내용 포함"), 무료 강조 고지·체크는 Gemini 무료만(R-OD-15). C-19 툴팁도 같은 범위.
- 화면은 `src/lib/data`만 import(바뀐 컴포넌트·페이지에 `@/server`·contracts·supabase import 없음), 바뀐 파일에 원색·팔레트 클래스 없음.

## 기계 검사 출력

| 검사 | 결과 |
|------|------|
| `pnpm lint` | 통과 (eslint, 경고 0) |
| `pnpm typecheck` | 통과 (`next typegen && tsc --noEmit`) |
| `pnpm test` | 통과 — Test Files 146 passed (146), Tests 2381 passed (2381), 43.2s |
| `pnpm build` | 통과 — Compiled successfully, `/interviews/[sessionId]/result` 동적 라우트 생성 |
