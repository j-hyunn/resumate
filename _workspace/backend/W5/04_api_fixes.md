# W5 QA 수정 (api-engineer, 라운드 1)

2026-11-02. 근거 리포트: `03_backend-qa_report.md`, `_workspace/ui/19_ui-qa_w5_review.md`.
커밋, `pnpm build`, `supabase db reset`, 실제 공급자 호출은 하지 않았다. SQL은 추가하지 않아 `pnpm db:test`는 돌리지 않았다.

## 검사 결과
| 검사 | 결과 |
|------|------|
| `pnpm typecheck` | 통과 |
| `pnpm lint` | 통과 |
| `pnpm test` | 통과. 111파일 1,675건(로컬 스택 통합 시험 포함) |
| `pnpm db:test` | 돌리지 않음(SQL 변경 없음) |

## 이슈별

### UQ-700 [수정] S-13·S-39 면접 수가 질문 0개인 그만둔 세션까지 셌다
- `src/server/services/interview/progress.ts`: `countsTowardInterviews`(= `labels.ts`의 `countsAsInterview`와 같은 규칙)로 센다. `abandoned` 세션만 `interview_questions` 수를 읽는다. `interviewInProgress`는 그대로다.
- 검증: `progress.test.ts`(접기 규칙, UI 규칙과 상태×질문 수 전 조합 일치). `interview.integration.test.ts`의 기대값을 2 → 1로 고쳤다(질문 0개 그만둔 세션은 목록에 남고 수에서 빠짐).

### QA-W5-02 [수정] 경력기술서 대기 쿠키가 사용자에 묶이지 않음
- 새 파일 `src/server/services/drafts/pending-cookie.ts`: 쿠키 값에 `user_id`를 넣고, 읽을 때 현재 사용자·id·UUID 형식·`options` 모양을 대조한다. 다른 사용자, 옛 형식(사용자 없음), 위조·깨진 값은 null.
- `src/lib/data/drafts-real.ts`: 모든 읽기가 `requireConsentedUser()`의 사용자로 대조한다(`realCareerDescriptionStreamPlan`도 이제 로그인 확인). `realCreateCareerDescriptionDraft`는 지원 프로젝트가 RLS로 읽히는지 먼저 본다. 없으면 `not_found`이고 쿠키를 바꾸지 않는다.
- 로그아웃·탈퇴: 새 `src/server/auth/user-cookies.ts`의 `clearUserScopedCookies()`를 `server/actions/auth.ts` `signOut`과 `server/actions/account.ts` `deleteAccount`의 `signOut`에서 부른다. Auth 호출이 실패해도 `finally`로 지운다.
- 검증: `pending-cookie.test.ts`, `user-cookies.test.ts`, `server/actions/auth.test.ts`(로그아웃이 쿠키를 지움, Auth 실패에도). `w3.integration.test.ts`: 쿠키가 본인 id를 담고 다른 사용자로는 null, 없는 지원 프로젝트로 생성하면 `not_found`이고 쿠키 그대로.

### QA-W5-03 [수정] 프록시를 건너뛰는 경로의 미리보기 헤더 위조
- 방식: 프로세스별 비밀 값. 새 `src/server/auth/preview-marker.ts`가 `globalThis`(Symbol 키)에 무작위 32바이트를 한 번 만든다. 프록시(`proxy-session.ts`)는 미리보기 요청에 `"1"` 대신 이 값을 넣는다. `source.ts`의 `isPreviewRequest()`는 같은 값일 때만(상수 시간 비교) 참이다. 클라이언트가 보낸 `"1"`이나 다른 값은 어느 경로에서든 실제 경로로 간다. matcher 제외 경로(`*.png` 등)에서 헤더가 지워지지 않아도 신뢰하지 않는다. 운영 빌드는 전과 같이 헤더를 읽지도 않는다.
- 전제: Next 16 Node.js proxy는 렌더러와 같은 프로세스에서 돈다(`next-server.js` "Node.js middleware runs in-process"). 모듈 인스턴스가 달라도 `globalThis` 칸을 같이 쓴다.
- 검증: `preview-marker.test.ts`(값 안정, 위조값 거부, 모듈을 다시 불러도 같은 비밀). `source.test.ts`("1"·"true"·잘린 값·덧붙인 값 → 실제 경로). `proxy-session.test.ts`(`?state=` + 위조 "1" → 프록시 자신의 값으로 바뀜). 통합 시험 2개의 미리보기 헤더도 이 값으로 바꿨고 통과.
- **확인하지 못한 것**: 실제 `next dev`에서 `?state=` 미리보기가 계속 mock으로 열리는지. 포트 3000 서버는 사용자 것이라 재시작하지 않았다. 리더의 빌드 뒤 `next dev`에서 `/career?state=empty`가 fixture를 보이는지, `curl -H 'x-resumate-preview: 1' /career/projects/foo.png`가 fixture 없이 끝나는지 확인이 필요하다.

### QA-W5-04 [수정] `mock-isolation.test.ts`가 놓치던 형태
- 판정을 이름 목록에서 "바인딩 추적"으로 바꿨다. `@/lib/mock/store`의 `getMockDb`·`resetMockDb`·`mockRequest`와 fixtures의 `createFixtures`가 씨앗이다. 별칭, 네임스페이스(`store.x()`, `store["x"]`, 네임스페이스 통째 전달), 동적 `import()`·`require`, 재수출(`export { h }`, `export { h as g }`, `export … from`, `export *`), 클래스(static 메서드), `export default`, 모듈 최상위 호출을 따라간다. `src/lib/data` 전체(하위 폴더 포함)와 `src/lib/mock`를 함께 읽어, 저장소를 부르는 mock 도우미(`planMockTurn` 등)를 오염으로 전파한다. 파일 간(`lib/data` ↔ `lib/data`) 전파도 바인딩으로 한다.
- store의 모든 export가 씨앗 또는 순수(`clone`)로 분류돼 있는지 시험한다(새 export가 생기면 실패).
- `lib/data`·`lib/mock` 밖에서 저장소에 닿는 `lib/mock` 바인딩을 가져오면 실패하는 시험을 추가했다.
- `src/lib/mock/store.ts`: `resetMockDb`에 운영 차단선 한 줄(승인된 수정).
- 검증: QA가 놓쳤다고 적은 경우 전부와 도우미 체인, 파일 간 전파를 예제 시험으로 넣었다. 지금 코드의 누수는 0건.

### QA-W5-05 [수정] `after()`로 단계를 돌리는 함수의 시간 제한
- `vercel.json`에 `"functions": { "src/app/**/page.tsx": { "maxDuration": 60 } }`를 넣었다. Server Action은 페이지 함수에서 돌므로(`getAiJob` 폴링의 재시도 깨우기 포함) 모든 페이지에 60초를 준다. 페이지 파일은 UI 소유라 건드리지 않았다.
- cron 라우트 2개에 `export const maxDuration = 60`을 추가했다. 나머지 API 라우트 14개는 이미 60이다.
- 전제(Fluid compute): 예산은 `INVOCATION_BUDGET_MS = 58_000`. 배포 프로젝트에서 Fluid compute가 켜져 있다고 본다(기본 300초, 60 설정은 그 안). Fluid가 꺼져 있어도 Hobby 최대 60초라 60이면 허용 범위다. 프로젝트 설정은 보지 않았다. 배포 전에 Vercel 프로젝트에서 Fluid compute 켜짐을 확인해야 한다.
- 검증: `src/server/jobs/function-duration.test.ts`. `vercel.json` 페이지 설정 ≥ 59초, 페이지 파일에 경쟁하는 `maxDuration` 없음, `src/app/api`의 모든 `route.ts`가 ≥ 59초. Vercel 문서(functions glob, App Router `maxDuration`)로 설정 형식을 확인했다. 실제 배포에서는 확인하지 못했다.

### QA-W5-06 (2) [수정, 범위 제한 있음] `client_id` 재시도가 다른 탭에서 지운 행을 되살림
- DB에 삭제 이력이 없어 첫 insert와 재시도를 서버가 구별할 수 없다. 그래서 같은 브라우저 범위로 막는다. `lib/data/deletion.ts` `deleteCareerItem`이 성공하면 지운 id를 사용자에 묶인 httpOnly 쿠키(`resumate_deleted_rows`, 최근 40개, 30분)에 남긴다. `lib/data/career.ts` `saveIdentity`는 `client_id`가 그 목록에 있으면 `not_found`를 던진다(화면의 `gone`, id 경로와 같은 결과 모양). 지운 부모의 자식 재시도는 FK로 이미 실패한다. 로그아웃·탈퇴 때 지운다.
- 남는 경우: 다른 기기나 다른 브라우저에서 지운 경우는 막지 못한다. 막으려면 삭제 이력 테이블(db-engineer)이 필요하다. QA 리포트대로 기획 판단 항목으로 넘긴다.
- 검증: `deleted-rows.test.ts`(사용자 구분, 상한·중복, 위조값). `career.integration.test.ts`: 지운 뒤 같은 `client_id`로 다시 저장 → `not_found`, 행 수 그대로.
- (1) 거짓 충돌은 이번 지시 범위가 아니라 손대지 않았다.

### QA-W5-07 [일부 수정] 오류 코드 뭉개짐
- `draftId` 충돌: `prepareCareerDescription`이 작업을 열기 전에 같은 id의 초안이 있으면 409 `conflict`. 덮어쓰기와 작업 생성, 공급자 호출 0. 검증: `drafts.test.ts`.
- `realRankDraftSources`: 형식이 틀린 id도 서비스와 같이 `AppError("not_found")`를 던진다. 서비스의 소유 확인도 `not_found`(이미 그랬다). 검증: `w3.integration.test.ts`(없는 UUID, 형식 틀린 값 → `not_found`).
- **안 고친 부분**: 화면이 받는 `provider_unavailable`은 `src/app/(dashboard)/(gated)/applications/_lib/actions.ts`의 `rankDraftSourcesAction`이 `MockAiError`가 아닌 예외를 모두 그 값으로 바꾸기 때문이다. 이 파일은 내 범위 밖(UI)이다. frontend 쪽에서 catch에 `if (isAppError(e) && e.code === "not_found") notFound()` (또는 결과 모양에 not_found 추가)를 넣어야 화면까지 바로 간다.
- 입력 검사: 컴포넌트 Action이 부르는 data 함수에 검사를 넣었다. 컴포넌트 파일은 건드리지 않았다.
  - `interviews.ts` `startInterviewSession`·`restartInterviewSession`: zod `safeParse` → `invalid_input`(전에는 TypeError와 ZodError).
  - `career.ts` `updateProfile`, `save{Experience,Education,Project,ProjectDetail,Achievement}`: 패치가 객체가 아니면 `invalid_input`. `setProjectSkills`: 문자열 배열이 아니면 `invalid_input`.
  - `writing-chats.ts` `startWritingChat`(null 입력), `setWritingChatAffiliation`(모양이 틀린 값), `evidence-real.ts` `loadEvidenceRows`(배열 아님).
  - 검증: `career.integration.test.ts`에 31개 호출(커리어, 대화, 면접, 삭제, 작업, 근거)을 null·형식 틀린 값으로 부르고 모두 `AppError`인지 보는 시험을 넣었다. 처음 돌렸을 때 TypeError 9건과 ZodError 1건이 나왔고, 고친 뒤 0건이다. `_lib/actions.ts`의 페이지 Action(예: `createApplicationAction`이 `input.raw_text`를 직접 읽음)은 범위 밖이라 보지 않았다.

### QA-W5-09 [수정] `startWritingChat`가 원자적이지 않음
- 새 서비스 `startWritingChatWithAffiliation`(`services/writing-chat/chat.ts`): 소속 행이 RLS로 읽히는지 먼저 본다. 없으면 `not_found`이고 대화를 만들지 않는다. 시작 뒤 소속 지정이 실패하면(사이에 지워진 경우) 방금 만든 대화를 `delete_career_item`으로 지우고 원래 오류를 다시 던진다. 소속 id 형식은 zod로 검사한다(`invalid_input`).
- 검증: `start-affiliation.test.ts`(읽히지 않으면 RPC 0개, 지정 실패 시 `start → set → delete` 순서). `career.integration.test.ts`: 없는 경력·교육 id → `not_found`, 형식 틀린 id → `invalid_input`, 사용자 대화 수 그대로.

### QA-W5-10 [수정] Action 응답의 내부 컬럼
- 화면이 읽는 것을 grep으로 확인했다. 화면이 쓰는 것은 `draft_sections.validation_report.char_adjust_needed`(S-19 A21)와 작업의 `model`(C-19 툴팁)뿐이다.
- `drafts-real.ts`: 초안·섹션 응답(`realGetDraft`, `realListDrafts`, `sectionRow` → `addQuestion`·저장, `draftRow`)에서 `input_hash`, `career_snapshot_hash`, `requirements_hash`, `usage`, `prompt_version`, `schema_version`, `validation_report`를 null로 바꾼다. 섹션의 `validation_report`는 `{ char_adjust_needed: true }`만 남긴다.
- `ai-jobs.ts` `realJobView`: `input_hash`, `prompt_version`, `usage`, `output`을 null로 바꾼다. `model`은 남긴다.
- `interview-rows.ts`: 세션 행의 `career_snapshot_hash`를 null로 바꾼다(`question_*`는 이미 null). 평가 행의 해시는 채점 판정 코드가 쓸 수 있어 이번에는 두었다.
- 검증: 기존 W3·면접 통합 시험이 통과(화면용 필드 영향 없음). 내부 컬럼이 빠졌는지 따로 확인하는 시험은 넣지 않았다.

### UQ-704 [수정] 동의 전 `/career`의 `consent_required` 서버 오류 로그
- 원인: App Router는 레이아웃과 페이지를 병렬로 렌더한다. 그래서 `(gated)` 레이아웃의 `ConsentGate`가 이동시키기 전에 페이지의 data 읽기가 `requireConsentedUser()`에서 `AppError`를 던져 로그에 남았다.
- `src/server/auth/session.ts` `requireConsentedUser`: 페이지 렌더 안이면(프록시 경로 표식 있음, `next-action` 없음, `/api/` 아님) 게이트와 같은 `redirect(/consent?next=…)`를 던진다. `NEXT_REDIRECT`라 오류 로그가 남지 않는다. Server Action, Route Handler, 요청 밖(시험)에서는 그대로 403 `consent_required`다.
- 검증: `session.test.ts`(페이지 렌더 → `/consent?next=%2Fcareer%3Fx%3D1`, Action·`/api/`·표식 없음·요청 밖 → 403, redirect 호출 0). 실제 서버 로그로는 확인하지 못했다(서버를 띄우지 않음).

## 변경 파일
- 서버: `src/server/services/interview/progress.ts`, `src/server/services/drafts/pending-cookie.ts`(새), `src/server/services/drafts/career-description.ts`, `src/server/services/career/deleted-rows.ts`(새), `src/server/services/writing-chat/chat.ts`, `src/server/auth/preview-marker.ts`(새), `src/server/auth/user-cookies.ts`(새), `src/server/auth/proxy-session.ts`, `src/server/auth/session.ts`, `src/server/actions/auth.ts`, `src/server/actions/account.ts`
- 라우트·설정: `src/app/api/cron/ai-jobs/route.ts`, `src/app/api/cron/retention/route.ts`, `vercel.json`
- data 계층: `src/lib/data/source.ts`, `drafts-real.ts`, `career.ts`, `deletion.ts`, `writing-chats.ts`, `interviews.ts`, `evidence-real.ts`, `ai-jobs.ts`, `interview-rows.ts`, `mock-isolation.test.ts`; `src/lib/mock/store.ts`(한 줄)
- 시험(새): `progress.test.ts`, `pending-cookie.test.ts`, `deleted-rows.test.ts`, `start-affiliation.test.ts`, `preview-marker.test.ts`, `user-cookies.test.ts`, `server/actions/auth.test.ts`, `server/jobs/function-duration.test.ts`. 시험(고침): `drafts.test.ts`, `interview.integration.test.ts`, `session.test.ts`, `proxy-session.test.ts`, `source.test.ts`, `career.integration.test.ts`, `interviews.integration.test.ts`, `w3.integration.test.ts`

## 넘길 것
- frontend: `_lib/actions.ts` `rankDraftSourcesAction`의 `not_found` 처리(위 QA-W5-07).
- 기획·db-engineer: 다른 기기에서 지운 행의 `client_id` 재시도(삭제 이력 테이블 필요 여부).
- 리더: 빌드 뒤 `next dev`에서 `?state=` 미리보기 동작 확인(QA-W5-03 전제). 배포 전 Fluid compute 켜짐 확인(QA-W5-05).
