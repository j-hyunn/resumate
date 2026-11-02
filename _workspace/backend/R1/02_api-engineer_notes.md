# R1 API 구현 노트 (A5 · A6 · A7 · A13 · A18 · A19 · A20 · A22 · A23)

기준: 사용자 확정 2026-11-05, 갱신 기획(UX v5.3, AI v4.3, DM v4.2), db·ai R1 노트의 시그니처.

## 엔드포인트·서비스 변경 (항목 ↔ 파일)

| 항목 | 변경 | 파일 |
|------|------|------|
| A5 | `message_count`는 시작 인사 제외(db). `hasRoomForTurn`(≤ 38이면 보냄)은 그대로, `remainingMessages = max(0, 40 − n)` 추가. `WritingChatDto.remainingMessages`, SSE `turn_done.remainingMessages` 추가 | `services/writing-chat/turn.ts`, `chat.ts`, `lib/contracts/writing-chat.ts` |
| A6 | Server Action `resumeWritingChat`(abandoned → active, 사용자 세션 직접 update, AI 호출 없음, 이미 active면 멱등 성공, saved·handed_off는 409 `writing_chat_not_resumable`). `listWritingChats`(S-08 작성 중 + 그만둔 대화), `listProjectWritingChats`(S-10 대화 기록, 모든 상태). 커리어 트리에 `abandonedWritingChats` 추가. 요약 행에 `status` 추가 | `actions/writing-chat.ts`, `services/writing-chat/chat.ts`, `services/career/tree.ts`, contracts |
| A7 | 계정 상태 판정 `getAccountState`: 본인 `profiles` 행이 있으면 `active`(RPC 없음), 없을 때만 service_role로 `get_account_deletion_state(p_user_id, p_subject_hash)`(HMAC = delete_account와 같음). `requireConsentedUser` → `account_deletion_incomplete`(403)를 동의 게이트보다 먼저. `requireConsentedUserOrRedirect` → S-25로 redirect(원래 URL·S-03보다 먼저). 신규 `requireUserForAccountDeletion()`(S-25 페이지용, 동의 게이트 밖). 로그인 콜백도 동의 확인 전에 S-25로. Action `getAccountStatus()`(S-25 진입 상태) | `services/account/state.ts`, `auth/account-state.ts`, `auth/session.ts`, `services/auth/index.ts`, `app/auth/callback/route.ts`, `actions/account.ts`, `lib/contracts/account.ts`·`routes.ts` |
| A13 | 경력기술서·자소서 문항 생성 prepare에서 요건 확인: 추출 중 409 `extraction_in_progress`, 추출 전·실패 409 `jd_not_extracted`(작업·공급자 호출 없음). 요청 안 추출(`ensureJd`, `preparing` 이벤트, 20초 추출 예산) 삭제 → 생성이 58초 예산 전체를 쓴다. AI-11도 요청 안에서 추출하지 않는다 | `services/drafts/career-description.ts`, `cover-letter.ts`, `ranking.ts`, `types.ts`, `jobs/drafts.ts`, 두 SSE 라우트 주석, `lib/contracts/draft.ts` |
| A18 | `READINESS_HINTS`에 `project_fields` | `lib/contracts/enums.ts` |
| A19 | `save_provider_key`·`record_provider_key_check`를 service_role 클라이언트(`deps.keyRpc()`)로 `p_user_id` = 세션 사용자 id와 함께 호출. 공급자 호출 전에 클라이언트를 만들어 설정 누락이면 실패(fail closed). service-role 모듈 주석에 사용처 추가 | `services/ai-connection/verification.ts`, `keys/app.ts`, `jobs/service-role.ts` |
| A20 | `consentStateOf().needsConsent` = `!mayRunWithConsent()`(통일 규칙). 키 등록·등급 변경의 "현재 버전과 정확히 일치" 검사 삭제. `p_disclosure_version`은 최신 유효 동의 행의 버전 | `services/ai-connection/consent.ts`, `verification.ts` |
| A22 | 면접 질문 생성 단계가 호출마다 `accumulate`(= ai `accumulateQuestionSetRecord`)로 세트 기록을 partial `set`에 쌓고, complete 단계가 세트 전체 `usage`·`report`·`attempts`를 payload로 넘긴다 | `services/interview/job.ts`, `jobs/interview.ts` |
| A23 | AI-11 실패 = 대체 선택 없음. `{ selectionOrigin: "user", failed: true, reason, 빈 목록, ranking: null }`. 파이프라인 `fallback` 인터페이스 삭제 | `services/drafts/ranking.ts`, `types.ts`, `jobs/drafts.ts`, `lib/contracts/draft.ts` |
| A24 | api에 `evidence_links` 직접 insert 경로 없음(읽기 2곳만) 확인 | — |

## 계약 변경 (UI 연결 전이라 화면 영향 없음)
- `DraftSourceRankingResponse`: `origin`/`fallback`/`fallbackReason` → `selectionOrigin`/`failed`/`reason`.
- `DraftStreamEvent`: `preparing` 삭제.
- `WritingChatDto.remainingMessages`, `TurnDoneEvent.remainingMessages`, `ActiveWritingChatSummary.status`, 새 `WritingChatLists`, `ProjectWritingChatSummary`, `ResumeWritingChatResult`.
- `CareerTreeDto.abandonedWritingChats`.
- `ACCOUNT_STATES`, `AccountStatus`, `ROUTES.accountDeletion` `[가정]`.
- 새 오류 코드: `jd_not_extracted`(409, 서류 생성), `writing_chat_not_resumable`(409), `account_deletion_incomplete`(403, 게이트), `account_profile_missing`(500 `[가정]`).

## 테스트
- 단위: drafts(A13 세 상태·작업/호출 없음·예산, A23 실패 모양), turn(A5 경계 0/38/39/40, 남은 수), session·auth 콜백(A7 순서·profile_missing·S-25 동의 게이트 밖), consent(A20 통일 규칙 = 실행 규칙), interview job(A22 두 번 호출 합산), contracts(A18).
- 로컬 DB 통합: drafts(미추출 → 실패 답·409·작업 0개 → 별도 추출 → AI-11 실패 → 성공·재사용), writing-chat(인사 제외 0/2/4, 그만둔 목록 → 재개 → 멱등 → saved 재개 거부, S-10 목록), career(A18 `project_fields` + `form` + id, 키 없음), ai-connection(A19 사용자 세션 직접 호출 42501, 등록·다시 확인·등급 변경을 service_role로), account(A7 active는 RPC 없이, 미완료 = `deletion_incomplete`, 사용자 세션 직접 호출 42501, 다른 hash → `profile_missing`), interview(A22 세션에 report·usage 저장).
- 결과: `pnpm typecheck` 통과, `pnpm lint` 통과, `pnpm vitest run` 89 파일 1410 테스트 통과(로컬 스택 기동 상태, 통합 테스트 포함).

## 스펙 차이·가정
`spec-gaps.md` "2026-11-05 · R1 (api)" ①~⑨: profile_missing 처리, S-25 경로, get_account_deletion_state 인자, 콜백 판정 실패 시 진행, AI-11 응답 필드 이름, 생성 요청의 요건 상태 코드, p_disclosure_version 값, S-10 목록 신설, 재개 멱등.

## QA 1차 반영 (03_backend-qa_report.md)
- **QA-R1-01**: `db/errors.ts`에 `invalid_user_id`·`user_not_found`를 500 일반 문구로 추가하고 `internal_error`로 묶었다(`invalid_subject_hash`와 같은 처리, 호출 버그 신호).
- **QA-R1-02**: `session.ts`에 `requireActiveUser()`(로그인 + 계정 상태, 동의 게이트 없음)를 두고 동의 액션 3개(`getConsentStatus`·`submitConsents`·`withdrawConsent`)가 이것을 쓴다 → 탈퇴 미완료 계정은 403 `account_deletion_incomplete`, 동의 행을 쓰지 않는다. S-03 페이지용 `requireUserForConsentPage(currentPath)`: 로그아웃 → S-02, 탈퇴 미완료 → S-25 redirect, 동의 필요는 그대로 둔다(이 페이지의 일). 단위 테스트: `auth/session.test.ts`(두 헬퍼), `actions/consent.test.ts`(미완료 계정의 세 액션 거부·서비스 미호출, 정상 계정 제출).
- 참고 항목: `jobs/service-role.ts` 주석의 사용처 파일명을 `auth/account-state.ts`로 고쳤다.
- 결과: typecheck·lint 통과, vitest 90 파일 1414 테스트 통과(통합 포함).
