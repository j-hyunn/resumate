# R1 백엔드 QA 리포트 (라운드 1)

- 범위: R1 = HEAD(1a1f7aa) 대비 커밋 전 diff. 기획 결정 A5·A6·A7·A10·A11·A13·A18·A19·A20·A22·A23·A24
- 비교 기준: 갱신 기획 문서(PRD v4.3, UX v5.3, AI v4.3, DM v4.2, `planning-backend-gaps-3192d0` 워크트리, 읽기만 함)
- 실행일: 2026-10-30 (로컬)

## 검사 실행 결과

`supabase db reset`(종료 0)을 먼저 돌리고 `run-checks.sh --build`를 실행했다(종료 0).

| 검사 | 결과 | 비고 |
|------|------|------|
| supabase db reset | 통과 | R1 마이그레이션 7개 포함 전체 적용, seed 적용 |
| typecheck (`next typegen && tsc --noEmit`) | 통과 | |
| lint (`eslint`) | 통과 | |
| vitest | 통과 | 89 파일, 1410 테스트, skip 0. 로컬 스택이 떠 있어 통합 테스트(`*.integration.test.ts`)도 실행됨 |
| build (`next build`) | 통과 | |
| pgTAP (`supabase test db`) | 통과 | 44 파일, 2078 테스트 |
| 타입 재생성 일치 | 통과 | `supabase gen types typescript --local` 결과와 `src/server/db/database.types.ts`가 공백 제거 후 같음(md5 일치) |

## 결정별 확인 (문서 ↔ 마이그레이션 ↔ 타입 ↔ 서비스·라우트 ↔ 테스트)

| 결정 | 결과 | 확인 내용 |
|------|------|-----------|
| A5 메시지 수 | 통과 | `start_writing_chat`이 `message_count` 0으로 시작(`20261105000100`:72). 기존 행 보정은 인사 행(sequence 1, assistant, `ai_job_id` null)이 있을 때만 −1, `updated_at` 트리거를 잠시 끔. 보정 전 최솟값이 1이라 CHECK(0~40) 위반 없음. `append_writing_chat_message` 수락 `≤ 38`, `begin_assistant_message` `is_final = v_count > 38`(S4 `…message_rpcs.sql`:331) 그대로 → 실제 최대 40, 40번째 답에 is_final. TS `hasRoomForTurn`·`remainingMessages`(`turn.ts`:124-131), `isLastTurn`은 DB `is_final`에서 옴(`turn.ts`:304). DTO·SSE `remainingMessages` 추가. 단위·통합·pgTAP 수치 갱신. 보정 쿼리 자체는 빈 DB라 자동 테스트 없음(db 수동 확인 기록) |
| A6 재개 | 통과 | 트리거 `private.writing_chats_guard`: `abandoned`에서 나가는 길은 `active`뿐이고 `last_activity_at = now()`, `saved`·`handed_off`는 모든 역할에서 최종(`20261105000200`). 서비스는 `.eq("status","abandoned")` 조건 update → 이미 active면 멱등 성공, saved·handed_off는 409 `writing_chat_not_resumable`, 타인·없는 대화는 `not_found`. AI 호출·작업 없음(통합 테스트가 `ai_jobs` 수 비교). 90일 정리(`purge_unlinked_writing_chats`)가 `last_activity_at` 기준이라 재개 시 기간이 다시 시작됨(DM 3.4와 일치). S-08 두 묶음·S-10 목록·커리어 트리 `abandonedWritingChats` 있음 |
| A7 탈퇴 미완료 | 이슈(Minor) | RPC `get_account_deletion_state(p_user_id, p_subject_hash)` definer, service_role만 execute(grants.test 반영). hash는 `delete_account`와 같은 `computeSubjectHash`(`services/account/index.ts`:82 ↔ `services/account/state.ts`:51). `profiles`가 보일 때는 RPC를 부르지 않음(`state.ts`:43). `requireConsentedUser`·`requireConsentedUserOrRedirect`는 계정 상태 → 동의 게이트 순서(`session.ts`:42-75). S-25용 `requireUserForAccountDeletion`과 탈퇴 액션 3개는 `requireUser`만 씀(동의 게이트 밖). 콜백은 동의 확인 전에 S-25로, `profile_missing`은 로그아웃 후 `?error=auth_callback`. 남은 틈: QA-R1-02 |
| A10 희망 정보 제외 | 통과 | `isCareerSupportEvidence`(`evidence-rules.ts`:114-119)가 `desired_job_title`·`interested_industries`를 뺌, `total_years_of_experience`는 셈. V-2가 profile 근거에 field를 강제(`validation/evidence.ts`:74)하므로 field 없는 profile 근거로 규칙을 피할 수 없음. 사용처: V-4 `validateItem`(AI-02·03·04 공통, 커스텀 `supportSourceTypes`도 같은 함수 통과), AI-02 `isCareerFact`, AI-05 앵커·사실 전제·주 대상, AI-06 개선 답변·`consistency_notes`. 남은 직접 비교(`CAREER_SUPPORT_SOURCE_TYPES.has`) 없음. 프롬프트 규칙은 AI-02~06 system 블록에만, `common.v1` 불변. 테스트: V-4 표·`applyMatchRules`·`profile-preference.test.ts` |
| A11 사실 전제 | 통과 | `premisesUserFacts`: `project_deep_dive`·`requirement_fit`은 항상, `gap_probe`는 anchor experience / 사실 경력 근거 / 경력 고유명사일 때만(`AI-05.ts`:240-244). 사실 전제면 action·result·성과 근거 필수(`AI-05.ts`:362). 면제 gap_probe 저장 테스트, 유사 경험 action 근거 통과 테스트 있음. AI v4.3 §4.1(1223행)과 일치 |
| A13 요청 안 추출 없음 | 통과 | 세 경로(`career-description.ts`, `cover-letter.ts`, `ranking.ts`)에서 `ensureJd` 삭제. `assertJdExtracted`: running → 409 `extraction_in_progress`, 그 밖 미추출 → 409 `jd_not_extracted`(`career-description.ts`:71-78), 둘 다 작업 생성·공급자 호출 전(prepare 단계). 검사 순서: readiness 422 → 빈 선택 422 → JD 409 → 연결 게이트. `jd_not_extracted`는 `db/errors.ts`:88에 409로 매핑. 남은 `"preparing"` 이벤트·`ensureJd`(서류) 참조 없음(insight·interview 비동기 prepare 추출은 C-6 팀 확정대로 유지). 단위 테스트가 작업 0·호출 0·`remaining() ≥ 58s − settle` 확인. AI-11은 같은 상태에서 200 실패 답(A23 모양) |
| A18 readiness | 통과 | `get_data_readiness` 판정 순서 ①경력 → ②`project_fields`(form + `suggested_project_id`, `suggested_mode` 없음) → ③키 없음/무효 form → ④augment → ⑤new_project(`20261105000400`)가 DM 6장 v4.2(888-893행)와 같음. ②는 AI 연결과 무관하게 같은 값(pgTAP 확인). 포함 규칙·최근 수정 1건 적용. TS `READINESS_HINTS`에 `project_fields`, 계약 `suggested_project_id` optional로 form에서도 통과. `complete_projects = 0` 조건은 db spec-gap ④로 기록됨 |
| A19 키 RPC 서버 전용 | 통과 | 옛 시그니처 drop, `p_user_id` 판은 service_role만 execute(anon·authenticated·app_ai_writer·app_key_reader revoke). TS 호출 2곳 모두 `deps.keyRpc()`(service_role) + `p_user_id: deps.userId`(`verification.ts`:269-270, 408-412). 사용자 세션으로 부르는 경로 없음(grep). 공급자 호출 전 클라이언트 생성으로 fail closed. grants.test의 service_role 전용 목록·authenticated 목록 갱신. 통합 테스트가 사용자 JWT 직접 호출 42501 확인 |
| A20 재동의 통일 | 통과 | DB: `save_provider_key`가 `private.ai_consent_allows_run` 사용(`check_ai_run_allowed`·`create_application_project`와 같은 헬퍼), `has_current_ai_consent` drop. TS: `consentStateOf().needsConsent = !mayRunWithConsent()`, 등록·등급 변경 `assertConsent`가 같은 규칙, 실행 게이트(`keys.ts`:191, 203)도 `mayRunWithConsent`. TS `mayRunWithConsent`와 SQL 헬퍼의 판정(최신 미철회 동의 → 그 버전이 시행 중 → 이후 시행된 `requires_reconsent` 없음)이 같음. `p_disclosure_version` = 동의 행의 버전이라 DB "알려진 버전" 검사도 통과 |
| A22 세트 기록 | 통과 | 컬럼 2개 + object CHECK, `complete_interview_questions` 본문 diff는 payload 검사 2줄 + 컬럼 쓰기 2줄뿐(나머지 S8과 같음). 생성 단계가 호출마다 `accumulate`로 partial `set`에 쌓고 complete가 세트 전체 `usage`·`report`·`attempts`를 넘김(`services/interview/job.ts`:433-456). 체크포인트에 `set`이 없던 작업도 `setRecordOf` → null로 안전. 통합 테스트가 세션에 저장 확인 |
| A23 AI-11 대체 없음 | 통과 | `fallbackSelection`·`fallbackSelectionFromAliases`·파이프라인 `fallback` 삭제, 모든 실패가 `failedRanking`(네 목록 빈 배열, `selectionOrigin: "user"`, `failed: true`, `ranking: null`). 계약 `origin`/`fallback`/`fallbackReason` → `selectionOrigin`/`failed`/`reason`, 남은 옛 이름 참조 없음. 422 `insufficient_data`만 오류 |
| A24 evidence_links INSERT 회수 | 통과 | 정책 drop + 테이블·컬럼 INSERT revoke. grants.test allow-list에서 `evidence_links` 제거. TS의 `evidence_links` 접근은 select 2곳뿐(`services/evidence/index.ts`:236, `services/interview/db.ts`:131) |
| 프롬프트 버전 | 통과 | AI-02 match/synthesize v3, AI-03 v2, AI-04 generate/adjust v2, AI-05 v2, AI-06 v2. `computeInputHash`가 `prompt_version`을 포함하므로 R1 이전 결과는 재사용되지 않음(의도된 1회 재생성). `prompt_version`을 값으로 비교하는 코드·CHECK는 없음(CHECK는 길이만) → 다른 회귀 없음 |
| 로그 | 통과 | 새 로그는 `account.state_*`(state만), `draft_ranking.failed`(ID·reason). 프롬프트·응답·경력 원문·사용자 id·hash 없음. `.env.local` 미추적 |

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | 데이터 모델 문서 ↔ 마이그레이션 | 통과 | 차이(`get_account_deletion_state`의 `p_subject_hash`, `project_fields` 조건)는 spec-gaps R1 (db) ①④에 기록됨 |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 | 재생성 결과와 일치, 새 컬럼·RPC 이름이 호출부와 같음 |
| Q3 | RPC 시그니처 ↔ 호출부 | 통과 | `save_provider_key`·`record_provider_key_check`(`p_user_id`), `get_account_deletion_state`(`p_user_id`, `p_subject_hash`), `complete_interview_questions` payload 키 `validation_report`·`usage` |
| Q4 | RPC raise 코드 ↔ 앱 오류 매핑 | 이슈 | QA-R1-01 |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 명세 | 통과 | `DraftSourceRankingResponse`, `WritingChatDto.remainingMessages`, `WritingChatLists`, `ProjectWritingChatSummary`, `AccountStatus`. UI 미연결 |
| Q6 | SSE 이벤트 | 통과 | `preparing` 삭제가 계약·스키마·라우트 주석·서비스에서 함께 빠짐, `turn_done.remainingMessages` 추가 |
| Q7 | AI 출력 ↔ 저장 | 통과 | A10 희망 정보 근거는 "세지 않음"만 하고 저장될 수 있음(ai spec-gap ①, 기획 확인 대상) |
| Q8 | enum DB ↔ TS | 통과 | DB CHECK 변경 없음, `READINESS_HINTS`·`ACCOUNT_STATES`가 RPC 반환 값과 같음 |
| Q9 | AI 작업 종료·사용량 기록 | 통과 | A13 거부는 작업·사용량 행 0, A23 실패는 작업 failed + 호출마다 1행(단위 테스트), A22 세트 usage는 기록용 합계일 뿐 `ai_usage_records`는 호출 단위 그대로 |
| Q10 | 보안·개인정보 | 이슈(Minor) | 키 RPC·탈퇴 상태 RPC 권한, `app_ai_writer` 쓰기 allow-list 통과. QA-R1-02 |
| Q11 | UI ↔ 백엔드 | 해당 없음 | 화면 연결 전. `pnpm build`는 통과 |

## 이슈

### QA-R1-01 [Minor] 새 RPC 오류 코드 2개가 `db/errors.ts`에 매핑되지 않음
- 담당: api-engineer
- 근거: `supabase/migrations/20261105000300_r1_account_deletion_state.sql`:31 `invalid_user_id`, `supabase/migrations/20261105000500_r1_provider_key_rpcs_server_role.sql`:47·183 `user_not_found` ↔ `src/server/db/errors.ts`(`RAISE_MESSAGES`에 두 이름 없음; 같은 마이그레이션의 `invalid_subject_hash`는 148·162행에 있음)
- 영향: `mapDbError`가 마지막 분기에서 `internal_error` 500으로 바꾸므로 지금 동작은 같다. 다만 Q4 규칙(raise 이름마다 매핑)에서 빠졌고, 로그·분석에서 원인이 사라진다. 정상 흐름에서는 세션 게이트가 먼저 막아 닿지 않는다(호출 버그 신호).
- 수정 제안: `RAISE_MESSAGES`에 `invalid_user_id`·`user_not_found`를 `invalid_subject_hash`처럼 500 일반 문구로 넣고 `RAISE_CODE_ALIASES`로 `internal_error`에 묶는다.
- 상태: 열림

### QA-R1-02 [Minor] 약관 동의 액션(S-03·S-24)이 탈퇴 미완료 판정을 거치지 않음
- 담당: api-engineer
- 근거: `src/server/actions/consent.ts`:13·26·38(`getConsentStatus`·`submitConsents`·`withdrawConsent`가 `requireUser()`만 씀) ↔ `src/server/auth/session.ts`:30-35(`assertAccountActive`는 `requireConsentedUser`에만 있음). DB 쪽 `record_consents`(`supabase/migrations/20261024000600_s1_consent_rpcs.sql`:93-141)는 프로필 존재를 보지 않고, `consents.user_id`는 `auth.users`를 참조(`20261024000500_s1_consents.sql`:7)하므로 프로필이 지워진 계정도 동의 행을 넣을 수 있다.
- 영향: UX v5.3 FL-07(540행)·S-25(1291행) "미완료 상태에서는 다른 메뉴로 갈 수 없고 탈퇴 마무리·로그아웃만"과 어긋난다. 콜백은 S-25로 보내지만 `/onboarding/consent`를 직접 열면 S-03이 뜨고 제출이 성공해 탈퇴 요청 뒤에 동의 행(`user_agent_hash` 포함)이 새로 생긴다. "탈퇴 마무리"를 다시 실행하면 `delete_account`가 다시 지우므로(`20261104000200`:153) 남는 기간은 마무리 전까지다. 그 사이 화면은 S-03 → S-08 → 게이트에서 S-25로 되돌아간다.
- 수정 제안: 동의 액션 3개에도 계정 상태 확인(`deletion_incomplete` → `account_deletion_incomplete` 403)을 넣는다. 화면 연결용으로 S-03 페이지가 쓸 헬퍼(`requireUserForConsentPage` 등: 미완료면 S-25로 redirect, 동의 게이트는 없음)를 `session.ts`에 둔다. 단위 테스트에 "미완료 계정의 submitConsents 거부"를 추가한다.
- 상태: 열림

## 참고 (이슈 아님)
- A5 기존 행 보정 쿼리는 빈 DB에서 자동 테스트할 수 없다(db 노트의 수동 확인 기록만 있음). 원격 브랜치에 적용할 때 적용 전후 `message_count` 분포를 한 번 확인하기를 권한다.
- `src/server/jobs/service-role.ts` 주석의 사용처가 `auth/deletion-state.ts`로 적혀 있으나 실제 파일은 `src/server/auth/account-state.ts`다(주석만, 동작 영향 없음).
- A1 해석(같은 행 다시 시도 = 처음 공급자, 새 작업 = 활성 공급자)은 계획대로 변경 없음.

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- 새로 넘긴 항목 없음. 엔지니어들이 "2026-11-05 · R1 (ai/db/api)"에 기록한 항목(희망 정보 근거 칩 저장, gap_probe 사실 전제 판별, `p_subject_hash` 인자, `p_disclosure_version`, `project_fields` 조건, `profile_missing` 처리, S-25 경로, AI-11 응답 필드 이름 등)을 확인했고 구현과 일치한다.

---

# R1 백엔드 QA 리포트 (라운드 2, 최종)

- 입력: api-engineer "QA 1차 반영"(`02_api-engineer_notes.md`)
- `run-checks.sh --build`를 다시 실행했다(종료 0). 1라운드에서 `supabase db reset`을 한 DB를 그대로 썼다. 이번 수정에는 마이그레이션 변경이 없다.

## 검사 실행 결과

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | |
| lint | 통과 | |
| vitest | 통과 | 90 파일, 1414 테스트(1라운드보다 +1 파일, +4 테스트). 통합 테스트 포함 |
| build | 통과 | |
| pgTAP | 통과 | 44 파일, 2078 테스트 |

## 이슈 재확인

| 이슈 | 상태 | 근거 |
|------|------|------|
| QA-R1-01 | 수정됨(확인 완료) | `src/server/db/errors.ts`:151-152(`RAISE_MESSAGES`, 500 일반 문구), :167-168(`RAISE_CODE_ALIASES` → `internal_error`). `invalid_subject_hash`와 같은 처리. 이제 R1 마이그레이션의 raise 이름이 모두 매핑된다 |
| QA-R1-02 | 수정됨(확인 완료) | `src/server/auth/session.ts`:41-45 `requireActiveUser`는 `requireUser`와 `assertAccountActive`만 거치고 동의 게이트는 없다. 동의 액션 3개(`src/server/actions/consent.ts`의 `getConsentStatus`·`submitConsents`·`withdrawConsent`)가 이 헬퍼를 쓴다. S-03 페이지용 `requireUserForConsentPage`(`session.ts`:106-112): 로그아웃이면 S-02(`next`=S-03), 탈퇴 미완료면 S-25로 redirect, `profile_missing`이면 500. 동의 필요 상태는 그대로 둔다. 테스트: `session.test.ts`:112-130, `src/server/actions/consent.test.ts`:24(미완료 계정의 세 액션 403 거부, 서비스 미호출)·:35(정상 계정 제출) |
| 참고(주석) | 수정됨 | `src/server/jobs/service-role.ts`:22 → `auth/account-state.ts` |

## 추가 확인: 동의 게이트를 거치지 않고 쓰기가 되는 경로

탈퇴 미완료 계정이 동의 게이트(`requireConsentedUser`) 없이 데이터를 쓸 수 있는 경로가 남았는지 확인했다.
- Server Action 12개 파일: 모든 export가 게이트를 하나씩 부른다(export 수 = 게이트 호출 수). 파일별로 보면:
  - `requireUser()`만 쓰는 곳은 `account.ts` 3개(`getAccountStatus`, `getAccountDeletionSummary`, `deleteAccount`)뿐이다. 이 셋은 S-25 동작이라 의도대로 게이트 밖에 있고, 쓰기는 `deleteAccount`(멱등 삭제)뿐이다.
  - `consent.ts`는 `requireActiveUser`를 쓴다.
  - 나머지 10개 파일은 `requireConsentedUser`를 쓴다.
  - `auth.ts`(매직 링크·Google·로그아웃)는 세션 게이트가 없지만 Supabase Auth만 부르고 public 테이블에 쓰지 않는다.
- Route Handler 17개:
  - 사용자용 13개는 모두 `requireConsentedUser`를 쓴다.
  - 크론 2개는 크론 비밀값, `ai-jobs/[id]/continue`는 HMAC continue 토큰으로 인증한다. 셋 다 사용자 요청 경로가 아니다. 진행 중이던 작업은 `delete_account`가 취소한다.
  - `auth/callback`은 세션 교환과 판정만 한다.
- 결론: 탈퇴 미완료 계정이 데이터를 쓸 수 있는 사용자 경로는 `deleteAccount`(탈퇴 마무리)뿐이다. UX FL-07·S-25와 일치한다.

## 최종 상태
- 열린 이슈 0건(Critical 0 / Major 0 / Minor 0). 미해결로 넘기는 항목 없음.
- spec-gaps로 넘긴 새 항목 없음.
- 원격 브랜치에 적용할 때 남은 권고(1라운드 참고와 같음): A5 기존 행 보정은 적용 전후 `message_count` 분포를 한 번 확인한다.
