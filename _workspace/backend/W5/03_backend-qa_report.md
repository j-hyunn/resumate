# W5 백엔드 QA 리포트 (라운드 1, W0~W5 연결 통합)

2026-11-02. 검토만 했다. 코드 수정, 커밋, `supabase db reset`, `pnpm build`, 실제 공급자 호출은 하지 않았다.
- 실행 환경: 로컬 Supabase 스택, 기존 빌드(BUILD_ID 15:52)로 `next start -p 3711`(끝나고 종료), 메일 수신함(Mailpit 54324).
- 시험 계정: `w5-qa-*@example.test`를 실제 매직 링크로 가입시켜 썼다. 끝에 전부 지웠다(`auth.users` 0행, 고아 키 0행, 내 수신 메일 삭제). S-25 탈퇴로 지운 계정 2개는 `account_deletion_log`에 해시 행이 남는다(설계대로, 개인 정보 없음).
- 시험 코드는 저장소 밖(스크래치 폴더)에 두었다. 공급자는 W3 대본 어댑터만 썼다.
- 포트 3000 개발 서버(PID 94014, 이 작업 트리)는 GET만 보냈고 끄지 않았다.

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh`(빌드 제외) |
| lint | 통과 | |
| vitest | 통과 | 102파일 1,626건 |
| pgTAP (`run-checks.sh`) | 통과 | 51파일 2,383건 |
| `pnpm db:test` (따로 다시 실행) | 통과 | 51파일 2,383건. 시험 계정 정리 뒤 실행 |
| 생성 타입 최신 여부 | 통과 | `supabase gen types --local`과 `database.types.ts`의 차이 0줄 |
| build | SKIP | 지시대로 돌리지 않음(공유 `.next`). 기존 빌드로 `next start`를 썼다 |

## 실행으로 확인한 범위 (요약)
| 영역 | 방법 | 결과 |
|------|------|------|
| W1 인증 | `next start` + 메일 수신함 링크 + Server Action HTTP | 아래 "W1" 표. 전부 통과 |
| 미리보기 격리 | 운영 빌드 위조 헤더, 개발 서버 위조 헤더, Action 147개 쓸기 | 운영 통과. 개발에 우회 1건 (QA-W5-03) |
| Server Action 공개면 | 매니페스트의 Action 147개를 익명 142개, 동의 없는 사용자 138개로 호출 | 데이터 노출 0건, mock 저장소 접근 0건(아래) |
| 교차 사용자 | B가 A의 id로 Action 76개, API 라우트 16개, 페이지 14개 호출 | 노출 0건, A의 행 22개 표 해시 변화 없음 |
| AI 게이트 ①~⑤ | 실제 라우트·data 함수 + 대본 어댑터(vitest, 로컬 스택) | 스펙 표와 같음. 공급자 호출 0, 사용 기록 0 |
| 자동 저장 | HTTP | CAS 정상. 경계 사례 2건 (QA-W5-06) |
| S-19 연결 | 실제 라우트 SSE → `realBlockStream` → **실제 `useAiStream` 훅 코드** | 블록·근거 수는 맞음. `omitted` 매핑 오류 (QA-W5-01) |
| S-25 마무리 | vitest + 실제 RPC(Auth 삭제만 실패시킴), HTTP 탈퇴 | 통과 |
| Server Action 안의 `after()` | HTTP `startInsight` → 폴링 | `next start`에서 작업이 끝까지 돈다. 시간 제한 위험은 QA-W5-05 |

## W1 (처음 하는 QA 라운드)
| 항목 | 결과 |
|------|------|
| 익명 `/career` `/applications` `/settings/ai` `/settings/ai/connect` `/settings/withdraw` `/consent` `/board` | 전부 307 → `/sign-in?next=` |
| 매직 링크 (`/sign-in?next=/career/skills?x=1` → 메일 → `/auth/callback`) | 307 → `/consent?next=%2Fcareer%2Fskills%3Fx%3D1`, 세션 쿠키 4개. `next` 유지 |
| 링크 재사용, 틀린 code, 공급자 오류 | 셋 다 `/sign-in?error=auth_callback` |
| 동의 전 `(gated)` 7개 경로, `(focus)` `/settings/ai/connect` | 200 스트림 안에서 `/consent?next=…`로 이동. 본문 데이터 없음 |
| 동의 전 `/settings/withdraw`, `/consent`, `/policies` | 열림(A7) |
| S-03 실제 폼 값 (`terms`, `privacy_required` true, 선택 2개 false) | `{ok:true, href:"/board"}`. `consents`에 2행, `cross_border_transfer` 0행. ⑲ 해소를 HTTP로 확인했다. `terms`만 보내면 `{ok:false}` |
| 동의 후 | `/career` 200, 실제 메일 주소 보임. `/consent` → `/career` |
| `next` 열린 이동 시도 (`//evil`, `https://evil`, `/\evil`) | 전부 `/career`로 바뀜. 차이 1건 (QA-W5-08) |
| `provider_url` (Google) | `signInWithGoogleAction`이 로컬 Auth의 `/authorize` 주소(`redirect_to`에 `next` 포함, PKCE)를 돌려준다. `sign-in-form.tsx:108`은 `router.push(href)`로 연다. App Router는 다른 출처 주소를 문서 이동으로 처리한다. 미리보기 경로에서는 값이 없다. Google 공급자가 로컬에서 꺼져 있어 그 뒤 단계는 못 돌렸다 |
| 로그아웃 | `{ok:true}` 뒤 `/career` → `/sign-in`. `scope: "local"` |
| S-25 탈퇴 (동의 없는 사용자) | 화면 200. `confirm:false`면 `failed`, `confirm:true`면 `{ok:true}`. `auth.users` 0행, 다음 요청은 `/sign-in` |
| 탈퇴 마무리 (Auth 삭제만 실패시킴, vitest) | 첫 요청 뒤 상태 `deletion_incomplete`. `requireConsentedUser` → `account_deletion_incomplete`. 게이트 페이지와 S-03은 `/settings/withdraw/finalize`로 이동. 동의 기록과 커리어 저장은 거부. 다시 요청하면 `{ok:true}`, Auth 사용자 삭제 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | 데이터 모델 문서 ↔ 마이그레이션 | 해당 범위 통과 | W1 필수 동의 2종을 DM v4.3b와 DB에서 확인. 다른 절은 W5 변경이 없어 다시 보지 않았다 |
| Q2 | 마이그레이션 ↔ 생성 타입 ↔ 쿼리 | 통과 | 타입 차이 0줄. `select("*")`·컬럼 목록 조회가 실제 HTTP에서 오류 없이 돈다 |
| Q3 | RPC ↔ 호출자 | 통과(표본) | `check_ai_run_allowed` → `mapRunGate`, `record_consents`, `delete_account`, `get_account_deletion_state` |
| Q4 | RPC raise 코드 ↔ 오류 변환 | 이슈 | QA-W5-07 (`stalled`, `provider_unavailable`로 뭉개지는 코드) |
| Q5 | 계약 ↔ 핸들러 ↔ 화면 | 이슈 | QA-W5-01 |
| Q6 | SSE 이벤트 | 통과 | AI-03: `generation_started → block_* → validated → done`. AI-04: `sources_selected`, `adjusting_length` 포함. 훅 매핑과 이름이 맞다 |
| Q7 | AI 출력 ↔ 저장 | 통과 | 훅 최종 블록 id·글자 = `draft_sections.ai_content`. `evidence_count` = `evidence_links.item_key` 수(AI-03 `p1-r`/`p1-b1`, AI-04 `q…-p1` + `sources.0`) |
| Q8 | enum DB ↔ TS | SKIP(이번 변경 없음) | 기존 계약 시험이 통과. 따로 대조하지 않았다 |
| Q9 | AI 작업 종료·사용 기록 | 통과(게이트 경로) | ③: 실행 중 동의 철회 → `failed`/`key_missing`/`failure_cause` null/`user_account`, 사용 기록 0. 키 복호화 실패 → `stalled`, 사용 기록 0 |
| Q10 | 보안·개인 정보 | 통과, 경미 2건 | 교차 사용자 0건. 서버 로그 2,686줄에 메일 주소·SENTINEL·토큰 0건. `.env.local`은 gitignore 대상. QA-W5-02, QA-W5-03 |
| Q11 | UI ↔ 백엔드 | 이슈 | QA-W5-01. `useAiStream` 반환 모양은 실제 SSE에서도 그대로다 |

## 요청 항목별 결과

### AI 게이트 (`terms` + `privacy_required`만 있는 사용자, 실제 라우트, 대본 어댑터 호출 수 집계)
| 경로 | 키 없음 | 키 있음, C-21 철회 | 키 무효 |
|------|---------|-------------------|---------|
| ① `POST insights`, `POST interview-sessions` | 409 `ai_not_connected` | 409 `ai_consent_required` | 409 `key_invalid` |
| ② `POST ai-jobs/{id}/retry` | 409 `key_missing` | 409 `ai_consent_required` | 409 `key_invalid` |
| ③ 실행기 `check_ai_run_allowed` → `mapRunGate` | — | RPC `consent_required` → `key_missing`. 작업 `failed`, `failure_cause` null | — |
| ④ `POST turns` | SSE `error:key_missing`, 메시지 0행 | SSE `error:key_missing` | SSE `error:key_invalid` |
| ⑤ `career-descriptions`, `generate` | SSE `error:key_missing` | SSE `error:key_missing` | SSE `error:key_invalid` |
| ⑤ data `retryJdExtraction`, `rankDraftSources` | `key_missing` | `key_missing` | `key_invalid` |
| data `startInsight` / `startInterviewSession` / `sendWritingChatTurn` | `{rejected:key_missing, refusal:ai_not_connected}` | `refusal:ai_consent_required` | `key_invalid` |
| readiness `consent_required` | null | true | false |
| 공급자 호출 / 새 사용 기록 / 새 작업 행 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |

- `registerProviderKey`(서비스, Action, data `verifyAndSaveProviderKey`): 동의가 없으면 셋 다 `ai_consent_required`(data는 `consent_required`) 거부. `verify` 호출 0, 공급자 호스트로 나간 fetch 0, 키 행 0. 순서: `verification.ts:309-310`(공급자 확인 → 동의) → `:313`(형식) → `:333`(검증 호출).
- ③은 처음에 `withdrawAiDataUseConsent` 서비스로 철회했는데 작업이 `canceled`로 끝났다. 서비스가 진행 중 작업을 취소하기 때문이다(DM 808행과 같다). 그래서 DB에서 직접 철회해 단계 게이트를 따로 확인했다.
- 실행하지 못한 것: `evaluation/retry`, `questions/retry`의 ① 게이트. 내가 넣은 세션 행이 `input_only`/`not_failed` 판정에 먼저 걸렸다. W4가 같은 `startJob` 게이트를 시험했다.

### Server Action 공개면 (매니페스트 147개)
- 익명: 공개 페이지(`/sign-in`, `/policies`)나 프록시가 돌지 않는 `.png` 경로로 보냈다. 데이터를 돌려준 Action은 없다. 값이 온 것은 `getDeletionState → "active"`, 빈 JD 상태, `signInWithGoogle` URL, 그리고 `prepareCoverLetterSection`(id만 이어 붙인 주소)뿐이다.
- 동의 없는 사용자: 본인 행만 읽는 셸 계열(배지, readiness, 동의 상태, 가격표, 탈퇴 요약)은 열려 있다. A7과 W1 설계대로다. 커리어·지원·면접 쓰기와 읽기는 전부 `consent_required`.
- `getMockDb`의 운영 차단선이 이미 들어가 있다(`store.ts:15`. W5 API 노트 "확인 필요 3"은 옛 내용이다). 쓰기 뒤 서버 로그에 "mock store is not available"이 0건이다. 운영 빌드에서 평범한 요청이 저장소에 닿은 경우가 없다는 동적 증거다.

### 교차 사용자 (B가 A의 id로)
- 커리어 저장 5종(id, `client_id`, `expected_updated_at`), A의 경력 밑에 프로젝트 만들기, A의 상세 밑에 성과 만들기: 전부 `{ok:false, reason:"gone"}`, A의 `latest` 노출 없음. 삭제, 대화, 지원, 초안, 문항, 면접, 작업 Action: 예외 또는 null/0. API 16개: 404, cron은 401. 페이지 14개에 SENTINEL 0.
- `interview-rows.ts`, `applications-real.ts`, `drafts-real.ts`의 직접 조회는 RLS 안에서만 읽는다. 본인으로 봐도 제출 전 `intent`·`good_answer_signals`가 Action 응답과 S-20·S-22 HTML에 없다. `getAiConnectionOverview`에 암호문 컬럼이 없다.
- W3 httpOnly 쿠키: QA-W5-02.

## 이슈

### QA-W5-01 [Major] S-19 "포함하지 않은 항목"이 enum 원문만 보이고 어떤 항목인지 빠진다
- 담당: api-engineer(`ai-stream-client.ts`), 이름 붙이기를 서버에서 할 경우 ai-pipeline-engineer
- 근거: `src/server/ai/pipelines/AI-03.ts:485,487`의 `validated.result.omitted`는 `{ project_id, reason }`이다(실제 SSE에서 `[{"project_id":"b5cd…","reason":"low_relevance"}]`). `src/lib/data/ai-stream-client.ts:105`는 `label ?? reason`만 읽는다. 실제 훅의 결과는 `notes[""].omitted = ["low_relevance"]`이다. `draft-editor.tsx:1043`은 이 문자열을 `" — "`로 나눠 "항목 — 이유"로 그리는데, 실제 값에는 둘 다 없다.
- 실패 시나리오: 9개 이상 고르거나 AI가 관련도 낮음으로 뺀 프로젝트가 있으면, S-19 안내 상자에 "포함하지 않은 항목 · low_relevance"(또는 `user_excluded`)만 보인다. 무엇이 빠졌는지 알 수 없다. 02 S-19(1241행)는 "항목 + 이유"를 요구한다. 미리보기 문구("프로젝트 — 이유")와도 다르다.
- 재현: `useAiStream` 원본 코드를 대본 어댑터 + 실제 라우트에 연결한 시험에서 재현했다. 브라우저 화면은 보지 않았다.
- 수정 제안: 서버가 `validated.result.omitted`에 표시 이름(예: "회사 › 프로젝트")을 넣거나, 클라이언트가 소스 트리로 `project_id`를 이름으로 바꾼다. `reason`은 한국어 문구로 바꾼다. 둘 다 `ai-stream-client.test.ts`에 실제 모양으로 시험을 붙인다.
- 상태: 열림

### QA-W5-02 [Minor] 경력기술서 대기 쿠키가 사용자에 묶이지 않고 로그아웃 뒤에도 남는다
- 담당: api-engineer
- 근거: `src/lib/data/drafts-real.ts:40-75`(쿠키에 user id 없음, 서명 없음), `:111-118`(`realCreateCareerDescriptionDraft`는 지원 프로젝트의 소유를 확인하지 않음), `:131`(계획이 쿠키 값을 그대로 씀). 로그아웃(`services/auth/index.ts:69`)은 이 쿠키를 지우지 않는다.
- 재현(HTTP): A가 쿠키를 만들고 로그아웃해도 쿠키가 남는다. 같은 브라우저에 B가 로그인해 `prepareCareerDescriptionAction(A의 대기 id)`를 부르면 A의 지원 프로젝트 id, 프로젝트 id, 경험 id가 담긴 `{endpoint, body}`를 받는다. B는 A의 지원 프로젝트 id로 `createCareerDescriptionAction`도 성공한다(대기 초안 id를 받음). 행 데이터는 새지 않는다. S-19 페이지는 B에게 not-found이고, 라우트는 404다. 위조 쿠키, 깨진 쿠키, 이상한 `options`는 모두 200이고 노출이 없다.
- 실패 시나리오: 공용 PC에서 다음 사용자에게 앞 사용자의 UUID가 보인다. B는 남의 프로젝트로 "생성 중" 대기 화면에 들어갔다가 라우트 404로 실패한다.
- 수정 제안: 쿠키에 `user_id`를 넣고 읽을 때 대조한다(또는 HMAC 서명). 로그아웃과 탈퇴 때 지운다. `realCreateCareerDescriptionDraft`에서 지원 프로젝트가 RLS로 읽히는지 먼저 확인한다.
- 상태: 열림

### QA-W5-03 [Minor] 개발 모드에서 프록시를 건너뛰는 경로로 미리보기 헤더를 위조할 수 있다
- 담당: api-engineer
- 근거: `src/proxy.ts:22-25` matcher가 `.png`·`.txt`·`.svg` 등으로 끝나는 경로를 빼므로, `proxy-session.ts:29`의 헤더 제거가 돌지 않는다. `[id]` 경로는 `foo.png`를 id로 받는다.
- 재현(포트 3000 개발 서버, GET): `curl -H 'x-resumate-preview: 1' localhost:3000/career/projects/foo.png` → 익명에 200, fixture 문자열(김지우) 있음. 같은 요청에 헤더가 없으면 500, `/career`에 헤더를 붙이면 307. W1 노트의 "클라이언트가 보낸 같은 헤더는 프록시가 지운다"는 이 경로에서 성립하지 않는다.
- 영향: 개발 환경에서만, mock 저장소만이다. 운영 빌드(`next start`)는 같은 요청이 로그인 이동으로 끝나고 fixture 0을 확인했다. 실제 행에는 닿지 않는다.
- 수정 제안: 헤더 신뢰를 프록시 표식에 맡기지 말고, 프록시가 요청별 비밀 값(nonce)을 붙여 대조한다. 또는 matcher 제외를 `_next/static`·`_next/image`·`favicon.ico`만으로 줄인다.
- 상태: 열림

### QA-W5-04 [Minor] `mock-isolation.test.ts`는 저장소 경로 일부를 보지 못한다
- 담당: api-engineer
- 근거: `src/lib/data/mock-isolation.test.ts:16`(이름 4개만), `:132`(`store.x()` 속성 접근은 건너뜀), `:155`(`lib/data` 최상위 `.ts`만 읽고 `lib/mock`은 읽지 않음). 검사 함수 `auditSources`를 그대로 복사해 예제를 돌렸다. 아래 경우를 **표시하지 않았다**(빈 결과).
  - `lib/mock` 안에서 저장소를 부르는 함수: `planMockTurn`, `readPlannedTurn`, `applyPlannedTurn`, `markAsked`(`lib/mock/writing-chat-turn.ts:161,269,281,324`). `writing-chats.ts`가 지금 가드 뒤에서 쓰지만, 가드 없이 불러도 시험은 통과한다.
  - `import * as store` 뒤 `store.mockRequest()`, `mockRequest as read` 별칭, `await import("@/lib/mock/store")`, `export { h }`, 클래스 static 메서드.
  - 시험이 잡은 것: 예제 기본형, `export default`, `previewOr` 두 인자 모두 저장소인 경우.
- 보완: `store.ts:15`의 운영 차단선이 `getMockDb`·`mockRequest` 경로를 운영에서 막는다(동적으로 0건 확인). 다만 `resetMockDb`(`store.ts:23`)에는 차단선이 없다.
- 지금 실제 누수: 정적 분류와 동적 쓰기(147개) 모두 0건이다.
- 수정 제안: STORE_CALLS를 이름 대신 "`@/lib/mock/store`에서 온 바인딩"(별칭·네임스페이스 포함)으로 판정하고, `lib/mock`도 읽어 전파한다. `resetMockDb`에도 같은 차단선을 둔다.
- 상태: 열림

### QA-W5-05 [Minor·배포 전 확인] W3-13: 페이지 POST의 `after()`에 시간 제한 설정이 없다
- 담당: api-engineer
- 근거: `vercel.json`에는 `crons`(하루 1번, `0 17 * * *`)만 있고 `functions`가 없다. `src/app/(dashboard)/**/page.tsx`에 `maxDuration`이 없다(라우트 14개에만 60). 그런데 다음 일이 페이지 POST의 Server Action 안에서 `after()`로 돈다.
  - `startJdExtractionInBackground`(`jobs/jd-extraction.ts:73`): S-14 생성, S-15/S-17 재추출
  - `startInsight`, `startInterviewSession`/`restart`/`submit`, `retryAiJob`, `regradeFailedAnswers`, `startRemainingQuestions`
  - **폴링** `getAiJob`(`lib/data/ai-jobs.ts:380`): `runner.getStatus`가 예약된 재시도(`next_run_at`)를 깨워 그 단계를 이 요청의 `after()`에서 돌린다. 작업 한 번의 예산은 `INVOCATION_BUDGET_MS = 58_000`이다.
- 확인한 것: `next start`에서 Server Action 안의 `after()`가 작업을 끝까지 돌린다(`startInsight` → `failed/stalled`, 키 복호화 실패라 공급자 호출과 사용 기록 0). Next 문서(`maxDuration.md`)는 Server Action의 시간 제한을 페이지 단위 `maxDuration`으로 정한다고 적는다.
- 위험(재현 못 함): Vercel 함수 기본 시간이 58초보다 짧은 설정(Fluid compute 꺼짐: Hobby 10초, Pro 15초. 이 기본값은 Vercel 문서 검색으로 확인하지 못했고 기억 기준이다. 프로젝트 설정도 보지 않았다)이면 단계가 공급자 호출 도중 잘린다. 그러면 사용 기록 없이 사용자 키 비용만 나가고, 작업은 2분 뒤 `stalled`가 된다. JD는 다음 폴링까지 `running`으로 남는다. Fluid compute가 켜진 프로젝트(기본 300초)라면 문제가 없다. 배포 환경이 없어 재현하지 못했으므로 Major로 올리지 않았다.
- 수정 제안: 위 Action을 쓰는 페이지(또는 `(dashboard)/(gated)` 레이아웃)에 `export const maxDuration = 60`을 두거나 `vercel.json` `functions`에 넣는다. 배포 전에 Fluid compute 설정을 확인한다. 하루 1번인 cron이 되살리기 수단이라는 점도 함께 판단해야 한다.
- 상태: 열림

### QA-W5-06 [Minor] 자동 저장 경계 사례 2건
- 담당: api-engineer
- 근거와 재현(HTTP, 5종 행 모두):
  1. 같은 `client_id`로 저장 4번(응답 유실 가정): 1, 2번째는 ok이고 행은 1개다. 3번째(새 값)부터 `conflict`가 된다. 2번째 재전송도 `updated_at`을 올리기 때문이다(`services/career/save.ts:119`). 폼 쪽 `decideConflict`는 `base`가 null이고 값이 달라 `conflict`를 고른다(`row-save.ts`). 그래서 첫 저장 응답이 두 번 잃어버려지면 사용자에게 거짓 충돌 안내가 뜬다. 상세 내용 행만 3번째도 ok였다.
  2. 다른 탭에서 지운 행의 `client_id`로 다시 저장하면 같은 id로 행이 **되살아난다**(`lib/data/career.ts:144` — id 경로는 `gone`이지만 `client_id` 경로는 insert). 첫 응답을 잃은 사이에 지운 경우에만 생긴다.
- 정상 확인: 같은 `expected_updated_at`으로 동시 4건 → 1건 ok, 3건 `conflict`(CAS). ms로 자른 `expected_updated_at` → conflict(µs 비교). 잘못된 값 → `invalid`. 패치에 넣은 `user_id`·`created_at`은 무시된다. 지운 행에 id로 저장 → `gone`. B의 `latest`는 노출되지 않는다.
- 수정 제안: (1) 재전송 replay가 값이 같으면 update를 건너뛰게 하거나, 폼이 `base`가 null일 때도 `already_saved` 판정을 쓰게 한다. (2) 되살림을 막으려면 삭제 이력이 필요하다. 드문 경우라 기획 판단으로 넘겨도 된다.
- 상태: 열림

### QA-W5-07 [Minor] 오류 코드가 뭉개지는 경로
- 담당: api-engineer
- 근거와 재현:
  - `rankDraftSourcesAction`: 남의 지원 프로젝트나 없는 지원 프로젝트에 `{ok:false, error_code:"provider_unavailable"}`(`drafts-real.ts:405-409`). 화면은 공급자 장애 문구를 보인다.
  - `POST career-descriptions`의 `draftId`가 이미 있는 초안 id면 SSE `error: stalled`. 덮어쓰기는 없다(대본 호출 0).
  - 컴포넌트 Action(`components/interviews/actions.ts:41` 등)이 입력을 검사하지 않아, 잘못된 인자에 500 `TypeError`가 난다(로그에 `Cannot read properties of null (reading 'interview_type')` 등 15건). 데이터 영향은 없다.
- 수정 제안: `not_found`는 그대로 전달하고, `draftId` 충돌은 409 `conflict`로 바꾼다. 컴포넌트 Action 입구에 zod 검사를 둔다.
- 상태: 열림

### QA-W5-08 [Minor] 클라이언트용 `safeNextPath`가 계약판과 다르다
- 담당: api-engineer(UI 소유 파일이라 UI 요청으로)
- 근거: `src/lib/routes.ts:144-152`는 `/sign-in`·`/consent`만 막는다. `src/lib/contracts/routes.ts:56`은 `/auth/callback`도 막는다. 재현: `recordConsentsAction(…, "/auth/callback?x=1")` → `href:"/auth/callback?x=1"`. 같은 출처라 열린 이동은 아니다. 다만 동의 직후 `/sign-in?error=auth_callback`(만료 문구)로 떨어진다.
- 수정 제안: 한 구현으로 합친다.
- 상태: 열림

### QA-W5-09 [Minor] `startWritingChat` 실제 경로가 원자적이지 않다
- 담당: api-engineer
- 근거: `src/lib/data/writing-chats.ts:174-190`. 대화를 만든 뒤 소속을 따로 RPC로 건다. 재현: B가 A의 경력 id로 `startWritingChatAction` → 500인데 B의 `writing_chats`에 빈 `active` 대화가 남았다(3번 호출, 3행). 지워진 소속으로 시작하면 정상 사용자에게도 생긴다.
- 수정 제안: 소속을 먼저 검증하거나, 실패하면 만든 대화를 지운다(또는 RPC 하나로 합친다).
- 상태: 열림

### QA-W5-10 [Minor] Action 응답에 내부 컬럼이 실린다 (본인 행만)
- 담당: api-engineer
- 근거: `addQuestionAction`, `getDraft` 계열이 `draft_sections`/`drafts` 전체 행(`input_hash`, `career_snapshot_hash`, `validation_report`, `usage`, `prompt_version`)을 RSC 페이로드로 보낸다. `getAiJobAction` 뷰에는 `input_hash`, `usage`, `model`이 있다. 다른 사용자에게는 가지 않는다(교차 시험 0건). 비밀값은 없다.
- 수정 제안: 화면이 쓰는 컬럼만 고른다. 우선순위는 낮다.
- 상태: 열림

## 스펙 차이 (spec-gaps.md로 넘길 항목, 이번에는 적지 않았다)
- QA-W5-01: AI-03 `omitted`를 화면에 보일 이름과 문구를 서버와 클라이언트 중 어디서 만드는지 정해야 한다(03 AI-03 1048~1055행에는 `ref`와 enum만 있다).
- QA-W5-05: 배포 함수의 시간 제한을 Fluid 전제로 둘지, 페이지 `maxDuration`으로 고정할지.
- QA-W5-06 (2): `client_id` 재시도가 지운 행을 되살려도 되는가.

## 실행하지 못한 것
- 브라우저 화면 전부(Chrome 연결 없음). 클릭, 폼 타이머, 스트리밍 표시, 충돌 다이얼로그, 안내 상자의 실제 렌더는 보지 않았다. `useAiStream`은 React 상태만 흉내 내고 원본 훅 코드를 Node에서 돌렸다.
- Google 로그인 끝까지(로컬 공급자 꺼짐), 실제 공급자 호출, 실제 키 복호화 뒤 공급자 호출, Vercel 배포 환경의 시간 제한.
- 개발 모드의 미리보기 쓰기가 실제 행에 가지 않는지: 포트 3000이 W5 노트대로 `[id]` 500 상태라 GET 위조 헤더만 확인했다. 미리보기 Action은 W2 통합 시험 결과에 의존한다.
- ① 게이트의 `evaluation/retry`, `questions/retry` 경로(위 사유). 제출 뒤 `intent` 공개는 다시 보지 않았다(W4 시험).
- `pnpm build` 후 회귀(지시로 제외).
