# R15 백엔드 QA 리포트 (라운드 1 + 라운드 2 + 후속 라운드 + 후속 라운드 2)

## 최종 판정 (후속 라운드 2 재확인 반영, 2026-11-09)

| 심각도 | 열림 | 닫힘 | 합계 |
|--------|------|------|------|
| **Critical** | **0** | 1 (QA-01) | 1 |
| **Major** | **0** | 3 (QA-02 · R15-API-7 · **QA-07**) | 3 |
| **Minor** | **0** | 5 (QA-03 · QA-04 · QA-05 · QA-06 · **QA-08**) | 5 |

**열린 항목 0건.** 후속 라운드 2에서 찾은 **QA-07·QA-08이 둘 다 닫혔다** — 내 재현 스크립트를 그대로 다시 돌려 확인했다(G-R 절). 수정이 만든 새 결함 0건, 산출물·STAR 패치 회귀 없음, 새 definer 헬퍼는 우회 경로가 아니다. 파이프라인 "알려진 한계"(미저장 슬롯 제안에 `question_id`가 없을 수 있다)는 **실제로는 생기지 않는다**(G-R4).

최종 검사 수치(재확인, **다른 사용자 잔여 행을 심은 상태 · `db reset` 없이**): typecheck **통과** · lint **통과** · Vitest **150파일 2,432건 통과** · pgTAP **66파일 2,708 단정 전부 통과**(+20 — QA-07·08 단정 편입) · 로컬 스모크 4경로는 후속 라운드 2에 통과 · 동시 첫 저장 25/25 정상.

> 이전 판정 기록: 2라운드 종료 시 Minor 1건(QA-04) 열림 → 후속 라운드 0건 → 후속 라운드 2에서 Major 1(QA-07)·Minor 1(QA-08) 열림 → 재확인에서 0건. 각 기록은 아래 해당 절에 그대로 둔다.

---

# 라운드 1 (2026-11-09)

- 날짜: 2026-11-09 · 워크트리 `/Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68`
- 기준 판: DM v4.15 · AI v4.15 · UX v5.20 · PRD v4.17 + `decisions.md` 2026-11-09(리더 판정 4건 · CF-S1 · 계약 대조)
- 원격 쓰기 0건 · 커밋·푸시·PR 0건 · `docs/planning/`·`docs/legal/` 미수정 · 실제 공급자 호출 0건
- **코드는 고치지 않았다.** 결함마다 담당자를 적었다. 내가 만든 임시 QA 테스트 2개는 저장소에서 지우고 스크래치패드에 보관했다(아래 "내가 만든 테스트").

## 종합 — Critical 1건 (열림) → **슬라이스를 done으로 올릴 수 없다**

| 심각도 | 건수 |
|--------|------|
| **Critical** | **1** (QA-01) |
| Major | 1 (QA-02) |
| Minor | 4 (QA-03 ~ QA-06) |

**Critical 목록**
- **QA-01 — `public.begin_assistant_message`가 `job_type = 'writing_chat_turn'`만 받아 서류 대화 턴이 전부 실패한다.** 로컬 스모크에서 실제 의존으로 재현했다. 단위 테스트(`document-turn.test.ts`)는 이 RPC를 가짜(`MemoryChatDb`)로 대체해 통과했다 — `332ec0c`와 같은 유형이다.

## 검사 실행 결과

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck (`next typegen && tsc --noEmit`) | **통과** | |
| lint (`eslint`) | **통과** | 경고 0 |
| Vitest (`pnpm test`) | **통과** | 147파일 2,398건 (로컬 스택 통합 테스트 포함) |
| pgTAP (`supabase test db`) | **통과** | 63파일 2,584 단정 — **단, `supabase db reset` 직후에만**(QA-04) |
| 로컬 스모크 — 서류 저장·대화 시작·서류 턴 | **실패(QA-01)** | 저장·대화 시작·extract·패치까지 통과, 턴이 `begin_assistant_message`에서 멈춤 |
| 로컬 스모크 — 미리 보기·생성 RPC 적용 | **통과** | 실제 로컬 Supabase 행으로 확인 |
| 로컬 스모크 — SSRF(실제 resolver) | **통과** | 14주소 전부 차단, 로그 키 4개만 |
| 로컬 스모크 — 라우트 부팅·폐기 라우트 404 | **통과** | `pnpm dev -p 3217` |
| 파괴 마이그레이션 가드 | **통과** | 실제 가드 텍스트로 재현 |
| 생성 타입 최신성 | **통과** | `gen types --local` 결과가 `database.types.ts`와 **완전 동일** |
| **건너뛴 검사** | — | ① 로그인 세션을 붙인 **HTTP 라우트** 호출(턴·미리 보기·가져오기) — Supabase SSR 쿠키를 손으로 만들어야 해서 돌리지 않았다. 서비스 계층은 실제 의존으로 돌렸고 라우트는 401·404만 확인했다. ② `pnpm build`(연결 단계가 아니라 `--build` 미사용). ③ 원격 `list_migrations` 대조 — 원격 접속을 쓰지 않았다(원격 미반영 슬라이스) |

최초 실행에서 pgTAP이 FAIL(7 단정)했으나 `supabase db reset` 뒤 재현되지 않았다. 원인은 코드가 아니라 로컬 DB에 남아 있던 이전 세션의 행 + pgTAP의 전역 `count(*)` 단정이다 → QA-04.

## 경계면 검사

| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM 11.8·11.10·2.5.0b·2.5.1·2.6.2·2.7.3·2.8 ↔ 마이그레이션 | 통과 | 테이블·CHECK·unique·복합 FK·생성 컬럼·인덱스 모두 일치. `migration_note` 없음 확인 |
| Q2 | 마이그레이션 ↔ `database.types.ts` ↔ 쿼리 | 통과 | 타입 재생성 결과 바이트 단위 동일 |
| Q3 | RPC 시그니처 ↔ 호출부 | 통과 | `create_application_project`는 **10인자 오버로드 1개만** 존재(8인자 drop 확인), 실제 호출부는 `src/server/services/application/write.ts:60` 한 자리뿐이고 인자 10개가 일치. `save_application_document`(8인자/반환 10키)·`start_document_writing_chat`(3인자/uuid)·`purge_unused_jd_preview_outputs`도 일치 |
| Q4 | raise 코드 ↔ 오류 매핑 | **이슈** | 살아 있는 114개 raise 코드 중 매핑 누락 0건(미매핑 3개는 R15 범위 밖의 선행 코드). 반대로 **죽은 코드 16개**가 `errors.ts`에 남았다 → QA-03 |
| Q5 | zod 계약 ↔ 핸들러 ↔ 화면 명세 | 부분(연결 대기) | 요청·응답 계약과 핸들러는 일치. S-13·S-14·S-46은 1-E로 **이 슬라이스에서 연결하지 않는다** — 화면 대조는 UI 세션 몫 |
| Q6 | SSE 이벤트 이름·payload | **이슈** | **새 이름 0개** 확인(`sources_selected`·`draft_started`·`draft_block`·`adjusting_length`·`draft_done`에 `slot`·`questionNo` 추가). 그러나 실패 때 보내는 `error` 이벤트가 계약(`ErrorEvent`)을 만족하지 못한다 → QA-02 |
| Q7 | AI 출력 ↔ 저장 매핑(CF-S1) | 통과 | `replace_draft` payload가 `{op, slot, question_id?, draft}`로 양쪽 일치(`storage/cover-letter-patch.ts:146-149` ↔ `private.wc_patch_document` 98-115행). `value` 미전송 · `char_limit_at_generation` null이면 키 부재 · `sources` 키 없음 ≠ 빈 배열 · 허용 출처 8값 동일 · 슬롯 근거 행의 `source_field`·`source_locator` 부재 — 전부 일치 |
| Q8 | enums DB CHECK ↔ TS | 통과 | `EVIDENCE_OWNER_TYPES` 3값(파괴 뒤 CHECK와 동일) · `AI_JOB_TARGET_TYPES`에 `jd_preview` + 보관용 `draft`·`draft_section` · `AI_JOB_TYPES`·`USAGE_FEATURES`에 `career_description`·`draft_source_ranking` 보존(CF-A3) · `APPLICATION_DOCUMENT_KINDS` 1값 · `START_WRITING_CHAT_RETURN_TARGET_FEATURES` 2값(테이블 CHECK는 3값) — db 노트 ④와 1:1 |
| Q9 | 작업 종료 경로·사용량 기록 | 통과(스모크 범위) | 미리 보기: 게이트 409 → **작업 행·사용량 행 0건**(실제 DB로 확인), 성공 → `jd_preview` 행 1개 + 사용량 1행(`application_project_id` null). 서류 턴: 호출 2회 → 사용량 2행(`feature='cover_letter'`), `next_run_at` 미사용 |
| Q10 | 보안·비밀 | 통과 | 아래 "보안 항목 판정" |
| Q11 | UI ↔ 백엔드 | 해당 없음(연결 대기) | `src/lib/data/`의 서류 함수는 전부 `// 연결 대기`. `useAiStream`·`useAiJob` 반환 모양 **변경 없음**(R15-L2대로) — 서류 턴은 이 두 훅을 쓰지 않는다 |
| Q12 | 실제 의존 wiring | **이슈(QA-01)** | `createWritingChatTurnDeps`는 `documentPipelines`를 올바르게 등록하고 키 소스를 사용자에 묶는다(AI-12·AI-13과 같은 경로). 그런데 그 아래 RPC가 서류 `job_type`을 거부한다 |
| Q13 | 릴리스 준비 | 통과 | 파괴 파일 `20261113004700`이 **마지막 번호**, 첫 줄 `-- DESTRUCTIVE:`, 자기 파일 1개, 가드 동작 확인. 새 환경 변수 0건(`.env.example`·`src/server/env.ts` 미변경 확인) |

폐기 완결성·가드·보안은 아래에 따로 적었다.

---

## 이슈

### QA-01 [Critical] `begin_assistant_message`가 서류 턴의 `job_type='cover_letter'`를 거부해 모든 서류 대화 턴이 실패한다

- 담당: **db-engineer** (api-engineer 확인 필요)
- 근거(양쪽):
  - DB: `public.begin_assistant_message` 본문 —
    ```
    if not exists (select 1 from public.ai_jobs j
       where j.id = p_ai_job_id and j.user_id = v_uid and j.job_type = 'writing_chat_turn'
         and j.target_type = 'writing_chat' and j.target_id = p_writing_chat_id) then
      raise exception using errcode = 'P0001', message = 'invalid_ai_job';
    ```
    (정의 위치: `supabase/migrations/` S4 판의 `begin_assistant_message`. R15 어느 마이그레이션도 이 함수를 교체하지 않았다 — db 노트 ①의 15개 파일 목록에 없다.)
  - 코드: `src/server/services/writing-chat/turn.ts:164-166`
    ```ts
    export function turnJobType(target: ChatTarget): AiJobType {
      return target === "application_document" ? "cover_letter" : "writing_chat_turn";
    }
    ```
    호출: `src/server/services/writing-chat/db.ts:103` `writer.rpc("begin_assistant_message", …)` ← `turn.ts:417` `prepareTurn`
  - 재현(실제 로컬 Supabase, 실제 `createDocumentPipelines`):
    ```
    AppError: 일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.
      ❯ mapDbError src/server/db/errors.ts:320
      ❯ Object.beginAssistant src/server/services/writing-chat/db.ts:111
      ❯ prepareTurn src/server/services/writing-chat/turn.ts:417
      Caused by: invalid_ai_job  { code: 'P0001' }
    ```
    (스모크 테스트: 스크래치패드 `qa-r15-smoke.integration.test.ts`, 첫 번째 `describe`)
- 영향: 서류 대화 턴이 **사용자 메시지를 저장한 뒤** 어시스턴트 메시지를 열지 못해 `internal_error` 500으로 끝난다. 질문 턴·초안 턴 모두. 즉 **CL-*·CF-* 자소서 작성 대화 기능 전체가 동작하지 않는다.**
- 왜 테스트가 못 잡았나: `document-turn.test.ts`는 `MemoryChatDb`(`src/test/writing-chat-fakes.ts`)의 `beginAssistant`를 쓰고, 그 가짜는 `ai_jobs.job_type`을 보지 않는다. 서류 대화에는 통합 테스트가 없다(산출물 대화는 `deliverable-chat.integration.test.ts`가 있다).
- 수정 제안: 비파괴 마이그레이션 1개를 **`20261113004700`보다 작은 번호**(예: `20261113004650`)로 더해 `create or replace function public.begin_assistant_message`의 조건을 `j.job_type in ('writing_chat_turn','cover_letter')`로 바꿀 것. 반대 방향(코드가 `writing_chat_turn`을 보내게 하기)은 **쓸 수 없다** — R15 D3의 `ai_jobs_document_chat_turn_check`가 서류 대화 턴에 `cover_letter`를 요구한다. 함께 확인할 것: `finish_assistant_message`는 `job_type`을 보지 않아 영향 없음, `private.writing_chats_cancel_jobs`는 이미 `in ('writing_chat_turn','cover_letter')`로 고쳐져 있다(확인함), `private.delete_account_data`는 영향 없음.
- 검증: 로컬 DB에서 그 한 줄만 임시로 넓히고 같은 스모크를 다시 돌리자 **통과**했다(실제 extract 파이프라인 → 실제 `apply_structured_draft_patch` 서류 분기 → `facts` 1건 저장(`review:"needs_review"`, `origin:"ai"`) → `reply_done`·`turn_done` → 사용량 2행 → 로그에 키·프롬프트·커리어 텍스트 0건). **이 한 줄이 유일한 막힌 지점이다.** 확인 뒤 `supabase db reset`으로 로컬 DB를 마이그레이션 상태로 되돌려 놓았다.
- 상태: **열림**

### QA-02 [Major] 실패 때 보내는 `error` SSE 이벤트가 계약 `ErrorEvent`를 만족하지 않는다

- 담당: **api-engineer**
- 근거(양쪽):
  - 계약: `src/lib/contracts/ai.ts:279-292` — `ErrorEvent`는 `type`·`code`·**`category`**·**`failureCause`**·**`message`**·**`retryable`**·`retryAfter`·`quotaResetsAt`를 **전부 필수**로 요구한다. 이 스키마가 `WritingChatTurnEventSchema`·`DeliverableTurnEventSchema`·`DocumentTurnEventSchema`(`src/lib/contracts/writing-chat.ts:519, 746-759`)에 모두 들어간다.
  - 발신: `src/server/services/writing-chat/turn.ts:1277` `safeEmit({ type: "error", ...errorFields(f) })` + `turn.ts:1304-1306`
    ```ts
    function errorFields(f: CallFailure): { code: AiErrorCode; retryAfter: string | null; quotaResetsAt: string | null } {
      return { code: f.code, retryAfter: f.retryAfter, quotaResetsAt: f.quotaResetsAt };
    }
    ```
    또 `src/app/api/writing-chats/[id]/turns/route.ts:54`는 `{ type: "error", code: prepared.code }`만 보낸다(as 캐스팅으로 타입 검사를 우회).
  - 재현: 실제 턴에서 나온 이벤트 `{"type":"error","code":"stalled","retryAfter":null,"quotaResetsAt":null}`를 `DocumentTurnEventSchema.safeParse`에 넣으면 `category`·`failureCause` 값 불일치 + `message`·`retryable` **누락** 4건으로 거부된다.
- 영향: 계약대로 파싱하는 화면은 **AI 실패 이벤트를 버린다** → C-20 오류 안내(`<AiErrorNotice>`)가 뜨지 않고 스트림이 조용히 끝난다. S-46 연결 때 바로 드러난다.
- 범위: R15가 만든 결함은 **아니다**(S4 커밋 `444dd9a`부터 공유 코드). 다만 서류 턴도 같은 발신 경로를 쓰고 `DocumentTurnEventSchema`에 같은 `ErrorEvent`를 넣었으므로 이 슬라이스의 경계에 걸린다. 기존 테스트들은 이벤트 스키마를 **성공 경로에서만** 검증한다(`turn.test.ts:131`, `document-turn.test.ts:188·267` — 어느 것도 `error` 이벤트를 포함하지 않는다).
- 수정 제안: `errorFields`가 `category`·`failureCause`·`message`·`retryable`을 함께 채우게 하고(이미 있는 `failureCauseOf`·`isManuallyRetryable`·`AI_ERROR_MESSAGES` 재사용), 라우트의 `prepared.code` 이벤트도 같은 조립을 쓰게 할 것. `as SseEvent`·`as AnyWritingChatTurnEvent` 캐스팅을 지우면 typecheck가 다시 막아 준다. 세 턴 테스트에 실패 이벤트 1건씩 스키마 검증을 더할 것.

**정정 (api-engineer 확인, 리더 승인 2026-11-09)** — 위 "영향" 한 줄은 한 단계 과하다. `src/server/sse.ts`의 `normalizeErrorEvent`가 **내보내는 모든 `error` 이벤트를 `aiErrorEvent(code, times)`로 다시 조립**한다(`formatSseEvent`·`emit` 양쪽에서 호출). 그래서 **와이어 모양은 이미 완전했고 C-20 안내(`<AiErrorNotice>`)도 떴다** — 화면이 실패 이벤트를 버리는 일은 없었다. 실제 결함은 두 가지였다: ① 턴이 만든 **객체**가 계약을 어겨 SSE 작성기를 거치지 않는 in-process 소비자(테스트, 그리고 앞으로의 비-SSE 소비자)가 버린다 ② **`as` 캐스팅이 타입 검사를 우회해 실제 버그를 가린다**.

**심각도 Major는 그대로 맞다 — ②가 실제 버그를 가리고 있었다는 것이 수정 과정에서 증명됐다.** 캐스팅 7곳(`as AnyWritingChatTurnEvent` 6 + `as SseEvent` 1)을 지우자 컴파일러가 숨어 있던 결함 1건을 드러냈다: **AI-04의 `sources_selected`는 저장 행 모양의 snake_case(`sort_order`·`experience_id`·`project_id`…)인데 SSE 계약(`DocumentSourcesSelectedEvent`)은 camelCase**다. 그대로 나갔으면 **S-46의 근거 칩이 하나도 파싱되지 않았다** — QA가 "와이어는 정상"이라고 본 것과는 **별개의, 화면에 보이는 결함**이다. 캐스팅 제거가 값을 한 자리이므로 기록에 남긴다.

수정 내역: `errorFields` → `turnErrorEvent` → `aiErrorEvent`(코드 → C-11 `category`·`failureCause`·한국어 `message`·`retryable`을 매기는 한 지점) 재사용, 라우트 게이트 이벤트도 같은 함수, 캐스팅 7곳 삭제, `toDocumentSseEvent()`로 `sources_selected`를 한 자리에서만 camelCase로 변환. 테스트: 실패 경로 이벤트를 `ErrorEvent` + 각 대화 종류 유니온으로 파싱하는 단정을 **서류·산출물·STAR 세 턴 모두**에 추가(`category`·`failureCause`·`retryable`·한국어 메시지까지 값으로), `sources_selected`의 snake_case 키가 남지 않는지 확인하는 단정 추가.
- 상태: **닫힘 (api-engineer 수정 완료, 2026-11-09)**

### QA-03 [Minor] `src/server/db/errors.ts`에 S7 서류 거부 코드 16개가 고아로 남았다 (`invalid_draft_sections` 포함)

- 담당: **api-engineer**
- 근거: 파괴 마이그레이션까지 적용한 로컬 DB에서 `pg_proc.prosrc`를 전수 조회한 결과 — 아래 코드를 **raise하는 함수가 0개**이고 `src/` 참조도 `errors.ts` 자신뿐이다.
  - `invalid_draft_sections`(`errors.ts:146`·`:254`) · `draft_id_conflict` · `draft_not_found` · `invalid_draft_options` · `invalid_draft_payload` · `invalid_question` · `invalid_section_order` · `invalid_sources` · `invalid_title` · `last_question` · `question_limit_reached` · `section_generating` · `section_id_conflict` · `section_in_progress` · `section_not_found` · `source_not_found`
  - 확인 쿼리: `select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prosrc like '%<code>%';` → 전부 `0`
  - **코디네이터 질문 ①에 대한 답**: `invalid_draft_sections`는 정말 고아다. 과거에는 `20261102000400_s7_career_description_rpcs.sql:366` 등 S7 RPC가 raise했지만 그 함수들은 `20261113004700`이 drop했다. 문구 "포함할 항목을 확인해 주세요."는 CL-2로 폐기된 포함 항목 설정 화면의 것이다 — A7 폐기에서 빠진 잔여물로 확인됐다.
  - 고아가 **아닌** 것(오해 방지): `invalid_source`·`invalid_value`·`field_already_applied`·`field_not_patchable`·`protected_field`·`invalid_review_transition`는 살아 있는 함수가 쓴다(패치 `rejected[]` 사유 포함).
- 수정 제안: 16개를 `DB_ERRORS`·`RAISE_CODE_ALIASES`에서 지울 것. 다만 옛 화면 S-17·S-19가 문구를 참조하지 않는지 먼저 확인하고(참조 0건으로 보인다), 겹치면 UI 세션으로 넘길 것.
- 상태: **열림**

### QA-04 [Minor] R15 pgTAP 단정이 전역 `count(*)`를 써서 로컬 DB에 남은 행 하나에 깨진다

- 담당: **db-engineer**
- 근거: 처음 `run-checks.sh`를 돌렸을 때 pgTAP이 7 단정에서 FAIL했다(결정적으로 재현, `supabase db reset` 뒤 전부 통과).
  - `supabase/tests/r15_application_documents.test.sql:322`
    ```sql
    select is((select count(*)::int from public.application_documents), 0,
              'deleting the application project cascades to its document');
    ```
    `:324`도 같은 모양(`evidence_links where owner_type='application_document'`)
  - 같은 유형: `r15_document_deletion.test.sql`(단정 21) · `r15_document_writing_chat.test.sql`(단정 58) · `jd_extraction.test.sql`(81·95) · `ai_usage_cost_backfill.test.sql`(5, `have: 37 / want: 36`)
  - 실패 메시지가 전부 `have: 1 / want: 0`, `have: 37 / want: 36` 꼴 — 남의 행 1개에 깨지는 모양이다.
- 영향: 개발자가 로컬에서 수동 스모크를 한 뒤 `supabase test db`를 돌리면 **코드와 무관한 FAIL**이 난다. "pgTAP 전부 통과"라는 신호가 약해진다(내 첫 실행이 그랬다).
- 수정 제안: 그 단정을 픽스처 범위로 좁힐 것 — `where user_id = '<픽스처 사용자>'` 또는 `where application_project_id = '<픽스처 프로젝트>'`.
- 상태: **열림**

### QA-05 [Minor] db 노트의 가드 검증 재현 절차가 없는 파일 이름을 가리킨다

- 담당: **db-engineer**
- 근거: `_workspace/backend/R15/02_db-engineer_notes.md:311`
  `s=open('supabase/migrations/20261113004500_r15_drop_drafts.sql').read()`
  그런데 같은 노트 33행이 적은 대로 파일은 `20261113004700_r15_drop_drafts.sql`로 재번호됐다(`20261113004500`은 존재하지 않는다). 적힌 대로 실행하면 `FileNotFoundError`다.
- 수정 제안: 경로를 `20261113004700`으로 고칠 것. (나는 고친 경로로 가드를 재현해 확인했다 — 아래 "파괴 마이그레이션 검증".)
- 상태: **열림**

### QA-06 [Minor] api 노트 끝에 heredoc 찌꺼기 2줄이 남았다

- 담당: **api-engineer**
- 근거: `_workspace/backend/R15/02_api-engineer_notes.md:225-226` —
  ```
  EOF
  wc -l _workspace/backend/R15/02_api-engineer_notes.md
  ```
  노트를 쓴 셸 명령이 파일 안으로 들어갔다. 내용 결함은 아니다.
- 수정 제안: 두 줄 삭제.
- 상태: **열림**

---

## 로컬 스모크 결과

로컬 Supabase 스택(`127.0.0.1:54321` / DB `54322`)과 **운영 팩토리**(`createDocumentPipelines`·`createSupabaseJobStore`·`createSupabaseUsageStore`·`createTurnChatDb`·`createAiWriterClient`·`productionJdExtractorForTests`)로 돌렸다. 공급자만 가짜(`createScriptedAdapter`)다. 미리 보기/프리뷰 URL은 쓰지 않았다.

### 실제로 돈 경로

| 경로 | 결과 |
|------|------|
| `create_application_project`(회사명 있음) | 통과 — 이름 "에이비씨페이 자기소개서" |
| **`save_application_document`** (실제 RPC, 키·동의 없이) | 통과 — `slot_count` 2 / `filled_slot_count` 1(제목·빈 본문 문항 제외) |
| **`start_document_writing_chat`** | 통과 — `writing_chat_id` 반환, 시작 인사 `sequence=1` 1행, `project_id` null, `document_kind='cover_letter'` |
| **서류 턴(질문 턴)** | **실패 — QA-01.** `begin_assistant_message`에서 멈춤 |
| 서류 턴(QA-01을 로컬에서 임시 우회) | 통과 — `ai_jobs`가 `job_type='cover_letter'`·`target_type='writing_chat'`·`application_project_id` not null(D3 CHECK 통과)·`status='succeeded'`·`error_code ≠ 'stalled'`, 실제 extract 파이프라인 → 실제 `apply_structured_draft_patch` 서류 분기가 `facts` 1건 저장(`target:'cover_letter'`), 사용량 2행(`feature='cover_letter'`) |
| **미리 보기 라우트 게이트 409** | 통과 — `key_invalid` 409이고 **`ai_jobs` 0행 · `ai_usage_records` 0행** |
| **미리 보기 성공** | 통과 — `jd_extraction`+`jd_preview`+`target_id` null+`application_project_id` null+`succeeded`, `output` 채움, 사용량 1행(`application_project_id` null) |
| **생성 RPC 미리 보기 적용** | 통과 — `preview_applied=true`, `extraction_status='succeeded'`, 작업 행이 새 프로젝트로 연결됨 |
| **생성 RPC `preview_mismatch`** | 통과 — 같은 `previewJobId`에 **다른 원문**을 보내자 `preview_applied=false`·`preview_skip_reason='preview_mismatch'`, 그런데도 작업 행은 연결됨(설계대로). 보낸 해시를 믿지 않고 `p_raw_text`로 재계산하는 것이 실제로 동작한다 |
| `source_url` 전달 | 통과 — 유효한 https 주소로 생성 성공 |
| **URL 가져오기 차단 경로(실제 DNS resolver)** | 통과 — 14주소 전부 차단(아래) |
| 라우트 부팅·인증 게이트 | 통과 — `POST /api/job-descriptions/fetch`·`/extract-preview` 둘 다 세션 없이 **401 `unauthenticated`** |
| 폐기 라우트 | 통과 — `career-descriptions`·`draft-source-ranking`·`draft-sections/[id]/generate` 전부 **404** |

### 돌지 않은 경로

- **로그인 세션을 붙인 HTTP 호출**(턴 SSE·미리 보기·가져오기 본문 경로). Supabase SSR 쿠키를 손으로 만들어야 해서 하지 않았다 — 서비스 계층을 실제 의존으로 돌려 대신했고, 라우트는 인증·라우팅만 확인했다. **턴 라우트의 SSE 직렬화는 미검증이다**(QA-02가 바로 그 자리의 결함이다).
- 서류 **초안 턴**(compose) 실제 파이프라인. 질문 턴이 QA-01에 막혀 거기까지 가지 못했다. QA-01 수정 뒤 재검사 항목.
- 외부 사이트에 대한 실제 가져오기(사람인·잡코리아). 네트워크 외부 호출은 하지 않았다 — 픽스처 단위 테스트 22건에 의존한다.

## 보안 항목 판정

| 항목 | 판정 | 근거 |
|------|------|------|
| **A1 SSRF** | **통과** | `ssrf.ts`: http(s)만 · 2,048자 · 자격증명 거부 · 리터럴 IP 직접 검사 · `localhost`/`.localhost` 선차단 · `dns.lookup(all)` 뒤 **모든 응답 주소** 검사(하나라도 차단 범위면 거부) · 비정규 IPv4(`0177.0.0.1`·`127.1`) 파싱 거부 → `isBlockedAddress`가 **fail closed**. `fetch.ts:420-453`가 **홉마다 `assertSafeUrl` 재호출**, `hop > 3` 중단, 하나의 deadline(10초), `Content-Length` 선검사 + 스트림 2MB 절단, 추출 200자 미만 실패, 50,000자 자름. 실제 resolver로 직접 돌려 **14주소 전부 차단**: `169.254.169.254` · `127.0.0.1` · `localhost` · `LOCALHOST.` · `[::1]` · **`[::]`** · **`0.0.0.0`** · **`2130706433`(십진수)** · **`0177.0.0.1`(8진수)** · `10.0.0.1` · `[::ffff:127.0.0.1]` + `file:`·`gopher:`·자격증명 URL은 `invalid_source_url`. **쉬운 우회 경로를 찾지 못했다.** |
| R15-API-6 (DNS 리바인딩 잔여 창) | **코드 주석에 명시됨** | `ssrf.ts:175-183` `assertSafeUrl` 주석에 `[가정]`으로 적혀 있고 spec-gaps R15-API-6과 일치. 참고(결함 아님): 6to4 `2002::/16`·Teredo `2001::/32`는 차단 목록에 없다 — 그 주소로 가는 요청은 중계기로 가고 로컬 자원에 닿지 않으므로 현실적 경로가 아니다. 남겨 두는 판단에 동의한다 |
| **A1 로그 비밀** | **통과** | `fetch.ts:531·535`가 `{host, code, bytes, elapsedMs}`만 남긴다. 실제로 돌려 로그 객체의 **키가 정확히 `bytes`·`code`·`elapsedMs`·`event`·`host` 5개**임을 단정했고 `meta-data`·`rest/v1`·`etc/passwd` 같은 **경로·쿼리 문자열이 로그에 없다**. 라우트도 본문을 로그하지 않는다 |
| 키·커리어 텍스트·프롬프트 로그 (C-7·NFR-KEY-05) | **통과** | 서류 턴 스모크에서 모든 로그 라인을 모아 가짜 키 문자열·사용자 발화("병목 쿼리를 재설계")·문항 문구("지원 동기를 써 주세요")가 **0건**임을 단정했다. 남은 것은 `ai_validation` 통계(개수·검사 이름)와 `turn_started`/`turn_finished`의 메타뿐 |
| **A2 게이트 409 때 `ai_jobs` 행 미생성** | **통과** | `preview.ts:183-196`이 공급자 컨텍스트를 **`store.insert` 전에** 읽는다. 실제 DB로 확인: `key_invalid` 409 뒤 `ai_jobs` 0행·`ai_usage_records` 0행 |
| **미리 보기가 남의 작업을 적용하지 못함** | **통과** | `create_application_project`가 `where j.id = p_preview_job_id and j.user_id = v_uid`로 조회하고, 아니면 `preview_not_found`로 연결도 하지 않는다. pgTAP `r15_jd_preview_and_deadline.test.sql`가 "남의 작업 미연결"을 단정 |
| **생성 RPC가 보낸 해시를 믿지 않음 (CF-A17 위조 차단)** | **통과** | RPC 본문 `v_hash := lower(encode(extensions.digest(p_raw_text,'sha256'),'hex'));` → `params.raw_text_hash`와 비교 + `jsonb_array_length(p_sentences) = params.sentence_count` + `succeeded` + `target_id is null` + 24시간. 실제 DB 스모크에서 원문을 한 줄 바꾸자 `preview_mismatch`가 났다. 화면이 보낸 `p_raw_text_hash`는 어디에도 비교에 쓰이지 않는다 |
| **RLS 교차 사용자 격리** | **통과** | pgTAP `r15_application_documents.test.sql` — RLS 활성(테이블 생성과 같은 마이그레이션), `set local role authenticated`로 "B는 A의 행을 update할 수 없다(보이지 않는다)"(:88) · 남의 행 delete(:98) · 남의 프로젝트 복합 FK 거부 `23503`(:77) · 저장 RPC가 남의 프로젝트에 `application_project_not_found`(:110). 전부 통과 |
| **`app_ai_writer` 제한** | **통과** | 실제 ACL 조회: `application_documents`는 `app_ai_writer SELECT` **한 줄뿐**(INSERT·UPDATE·DELETE 없음), `has_table_privilege('app_ai_writer','public.experiences','INSERT')` = `false`. `authenticated`는 select·insert·update·delete(R15-DB-1 선례대로), `service_role`은 select·delete만 |
| **R15-DB-5 `job_descriptions.source_url`** | **통과** | `app_ai_writer`의 `job_descriptions` 컬럼 grant에 **`source_url`이 없다**(`raw_text`만 보임). `authenticated`의 `job_descriptions` UPDATE 컬럼 grant는 **0건** |

## 파괴 마이그레이션 검증 (`20261113004700_r15_drop_drafts.sql`)

| 항목 | 결과 |
|------|------|
| 마지막 번호인가 | **예** — `20261113004700`이 `supabase/migrations/`의 최대값(004600이 직전) |
| 첫 줄 `-- DESTRUCTIVE:` | **예**. 저장소 전체에서 `DESTRUCTIVE` 표식이 붙은 파일은 R13·R14·R15 세 개뿐이고 모두 자기 파일 1개 |
| 가드가 실제로 멈추는가 | **예** — 마이그레이션 파일의 `do $$ … $$;` 블록을 **그대로 뽑아** 대역 테이블 위에서 실행했다(롤백 트랜잭션). 비어 있으면 통과, `drafts`에 1행을 넣으면 멈춘다:<br>`ERROR: r15_drop_drafts: old document rows still exist (drafts=1, draft_sections=0, draft_section_sources=0, evidence_links[draft_section]=0); nothing is migrated, so resolve them first` |
| 메시지에 행 수만 있는가 | **예** — 테이블별 개수 4개뿐, 값·id 없음 |
| 로컬 적용 상태 | 적용됨 — `public.drafts`·`draft_sections`·`draft_section_sources` **0개**, `evidence_links_owner_type_check` = `insight`·`chat_message`·`application_document` 3값 |
| 원격 | **올리지 않았다** |

## 폐기 완결성

| 항목 | 결과 |
|------|------|
| 서버(`src/server`·`src/app`)에서 `drafts`·`draft_sections`·`draft_section_sources`를 **읽거나 쓰는 코드** | **0건.** grep hit는 ① `errors.ts`의 고아 코드 2줄(QA-03) ② 픽스처 SQL 주석 1줄 ③ `jd/page.tsx:35`의 `from === "drafts"` 쿼리 파라미터 비교(테이블과 무관, UI 소유) |
| **코디네이터 질문 ② — `src/lib/data/`의 mock 분기** | **결함이 아니다 → UI 요청으로 분류.** 확인 결과 지적된 모든 줄이 **mock 전용 분기 안**에 있다:<br>· `deletion.ts:112`(`affectedSources`)·`:255`·`:262`는 `mockDeletionImpact`(205행, `previewOr`의 **첫 인자**)에서만 불린다<br>· `:314`·`:315`는 `mockDeleteCareerItem`(297행, 같은 방식)<br>· `:393`은 `getApplicationDeletionImpact`(387행 `previewOr`)의 mock 인자, 실제 분기는 서버 액션 호출<br>· `:423`~`:432`는 `deleteApplicationProject`의 `if (!(await isPreviewRequest())) { …실제 액션…; return }` **뒤**<br>· `:456`·`:467`~`:470`(`getDraftDeletionImpact`·`deleteDraft`)는 둘 다 `previewOr`이고 실제 분기가 `{sections:0}`·`{}`<br>· `evidence.ts:175`(`resolve()`의 `user_note` 분기)는 **넘겨받은 `db` 객체**를 읽는다. 실제 경로의 그 객체는 `evidence-real.ts:56`이 **리터럴 `draft_sections: []`** 로 채운다 — **쿼리가 아니다**(`evidence-real.ts:35-44`의 `select()` 목록에 폐기 테이블이 없다). `.find()`가 `undefined`를 돌려 라벨 폴백으로 간다.<br>→ **파괴 마이그레이션이 원격에 적용된 뒤에도 실제 경로가 없는 테이블을 쿼리하는 자리는 없다.** 런타임 오류 위험 없음. 이 줄들은 `?state=` 미리 보기로만 사는 S-17·S-19와 함께 UI 세션이 지울 몫이다(api 노트 ④-1·④-5와 같은 결론) |
| AI-03·AI-11 흔적 | **파이프라인·프롬프트·스키마 0건.** `pipelines/AI-03.ts`·`AI-11.ts`·`schemas/`·`prompts/`·`summary-pack.ts`·`storage/drafts.ts` 모두 사라졌다. 남은 hit는 **주석·픽스처 이름·"이름 재사용 금지" 단정**(`prompts/prompt-versions.test.ts:106`)뿐 — 실행 코드가 아니다. UI 주석 2건(`applications/_lib/actions.ts:132`, `drafts/page.tsx:19`)은 폐기 예정 화면의 주석이다 |
| `career_description_in_progress` | 코드에서 0건(마이그레이션 주석 1줄만) |
| `ai_jobs_career_description_in_flight_key` 인덱스 | 없음(0개) |
| `writing_chats.project_id` | `is_nullable = YES` |
| CF-A3 보존 값 | `ai_jobs_job_type_check`·`ai_usage_records_job_type_check` 9값에 `career_description`·`draft_source_ranking` 유지, `AI_JOB_TARGET_TYPES`에 `draft`·`draft_section` 유지 |

## `[가정]`·결정 전제 대조

- **CF-S1**: `_workspace/backend/decisions.md`의 결정 기록을 정본으로 보고 대조했다. `sources[]` 상한 5(`DOCUMENT_SOURCE_LIMIT = 5`·DB `wc_doc_sources`) · `role` 2값 · 키 없음 = 유지 / 빈 배열 = 삭제(`if v_draft_obj ? 'sources'`) · `primary` 먼저 · `role` 미저장 · 슬롯 근거 행의 `source_field`·`source_locator` null · 적용 제안 없는 슬롯 유지 — **구현 3층(ai·db·계약)이 전부 일치**한다. `docs/planning/`에 CF-S1·R15-DB-8이 없는 것은 **PR #68 미머지** 때문이며 결함으로 올리지 않았다.
- **리더 판정(블록 `review` 강제 제거)**: `20261113004600`이 `private.wc_document_block`에서 강제를 뺐고, 지금 DB는 패치로 온 `review`·`review_reason`을 그대로 저장한다. 출처 3종 중 `source_fact_ids`만·`source_body_quotes`만인 블록이 `ok`로 남는 것을 pgTAP가 단정한다. **DB가 `evidence[]`만 보고 강제하는 자리는 없다.** 유지돼야 할 V-8 마지막 안전망(`job_competency`의 `project.learnings` 거부)은 저장 RPC에 남아 있다. 판정대로다.
  - 참고: ai 노트 §(3-c) 끝의 "불일치로 남겨 리더에게 보고하는 것 1건"은 이 판정으로 **해소됐다.** 노트가 갱신되지 않았을 뿐이고 코드는 판정과 맞다 — 결함으로 올리지 않았다.
- **R15-L1 프롬프트 v6 / schema_version 4**: `prompt-versions.test.ts`가 고정하고 통과한다.
- **R15-L2 SSE 새 이름 0개**: 확인했다(Q6).

## 스펙 차이 (spec-gaps.md로 넘긴 항목)

**없다.** 이 라운드에서 찾은 것은 전부 구현 결함이거나 노트·테스트 위생 문제다. 기존 `R15-DB-1~9`·`R15-AI-1~3`·`R15-API-1~6`은 다시 읽고 구현과 일치함을 확인했으며(특히 DB-3·DB-5·DB-8·DB-9·API-2·API-6을 코드로 대조했다) 새로 더할 것이 없다.

## 내가 고친 테스트

저장소의 테스트는 **고치지 않았다**(기존 Vitest·pgTAP 전부 통과했다). 대신 QA용 임시 테스트 2개를 만들어 돌린 뒤 저장소에서 지웠다 — 담당자가 QA-01 회귀 테스트로 쓰면 좋다:

- `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-cover-letter-backend-ef4d68/cdfbb6b0-f08f-43f1-a316-88fd59d80f25/scratchpad/qa-r15-smoke.integration.test.ts`
  (원래 위치 `src/server/services/writing-chat/qa-r15-smoke.integration.test.ts`. `describe` 2개 — 서류 저장·대화 시작·서류 턴 / 미리 보기·생성 적용)
- `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-cover-letter-backend-ef4d68/cdfbb6b0-f08f-43f1-a316-88fd59d80f25/scratchpad/qa-r15-ssrf-real.test.ts`
  (원래 위치 `src/server/services/job-description/qa-r15-ssrf-real.test.ts`. 실제 resolver로 14주소 차단 + 로그 키 검사)

**제안**: 서류 대화에는 통합 테스트가 없어 QA-01이 단위 테스트를 전부 통과했다. 첫 번째 파일을 `document-chat.integration.test.ts`로 정식 편입하는 것을 권한다(산출물 대화의 `deliverable-chat.integration.test.ts`와 같은 자리).

## 다음 라운드에서 재검사할 것

1. QA-01 수정 — 새 비파괴 마이그레이션 번호가 `20261113004700`보다 **작은지**, `begin_assistant_message` 외에 `job_type`을 보는 RPC가 더 없는지, 서류 **초안 턴**(compose)까지 실제 의존으로 도는지.
2. QA-02 수정 — 세 턴 이벤트 집합의 `error` 이벤트가 계약을 통과하는지, 캐스팅이 지워졌는지.
3. QA-03·QA-04 수정 확인.
4. QA-01 수정 뒤 `run-checks.sh` 전체 재실행.

---

# 라운드 2 — 재검사 (2026-11-09, 마지막 라운드)

담당자 보고를 그대로 믿지 않고 **코드·로컬 DB·실제 실행**으로 확인했다. 코드는 고치지 않았다(내 임시 QA 테스트만 만들고 지웠다).

## 2-A. 검사 실행 결과

| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | **통과** | |
| lint | **통과** | 경고 0 |
| Vitest | **통과** | **149파일 2,418건**(1라운드 147/2,398 → +2파일 +20건) |
| pgTAP — **`db reset` 없이, 다른 사용자의 잔여 행을 심어 둔 상태** | **실패 3단정** | 64파일 2,613 단정 중 3개. **QA-04가 완전히 닫히지 않았다**(2-B) |
| pgTAP — 깨끗한 DB | **통과** | **64파일 2,613 단정 전부** |
| 로컬 스모크 ① 서류 저장·대화 시작·**질문 턴** | **통과** | 1라운드 Critical이 막았던 자리 |
| 로컬 스모크 ② **초안 턴 compose** | **통과** | 1라운드 미도달 자리 — 2-D |
| 로컬 스모크 ③ 미리 보기·생성 적용·`preview_mismatch` | **통과** | 1라운드와 동일 |
| 마이그레이션 번호·파괴 위치 | **통과** | 2-C ④ |
| **건너뛴 검사** | — | ① 로그인 세션을 붙인 HTTP 라우트 호출(1라운드와 같은 이유) ② `pnpm build`(연결 단계 아님) ③ 원격 `list_migrations` |

### QA-04 검증 방법 (재현 가능)

로컬 DB를 비운 뒤 **다른 사용자**로 잔여 행을 심고(`application_documents` 1 · `writing_chats` 1 · `application_projects` 1 · `jd_requirements` 1 · `evidence_links[application_document]` 1 · `ai_jobs` 1(`queued`, 하트비트 없음) · `ai_usage_records` 1) `run-checks.sh`를 돌렸다. 그 행을 지우자 pgTAP이 전부 통과했다 → 실패는 전역 단정 때문이지 코드 때문이 아니다.

## 2-B. 1라운드 6건 + R15-API-7 재검사

| 이슈 | 심각도 | 상태 | 내가 확인한 근거 |
|------|--------|------|-----------------|
| **QA-01** | Critical | **수정됨 (확인 완료)** | 아래 ① |
| **QA-02** | Major | **수정됨 (확인 완료)** | 아래 ② |
| **QA-03** | Minor | **수정됨 (확인 완료)** | 아래 ③ |
| **QA-04** | Minor | **부분 수정 — 미해결** | 아래 ④ |
| **QA-05** | Minor | **수정됨 (확인 완료)** | `02_db-engineer_notes.md:323`이 `20261113004700_r15_drop_drafts.sql`을 가리킨다. 남은 `004500` 2건(35행·289행)은 재번호 이력을 서술한 문장이라 정상 |
| **QA-06** | Minor | **수정됨 (확인 완료)** | api 노트 끝의 `EOF` / `wc -l` 2줄이 사라졌다(끝이 정상 산문) |
| **R15-API-7** | Major | **수정됨 (확인 완료)** | 아래 ⑤ |

### ① QA-01 — 닫힘

- 새 파일 `supabase/migrations/20261113004650_r15_begin_assistant_message_document_turn.sql` 존재. 로컬 DB의 **살아 있는 함수 본문**이 `and j.job_type in ('writing_chat_turn', 'cover_letter')`로 바뀌었다(37행).
- **"여기 하나뿐"을 내가 전수 재확인했다.** `prosrc like '%job_type%'`인 public·private 함수 11개를 하나씩 열어 보았다:
  `ai_jobs_release_insight`(`= 'insight'`) · `ai_jobs_release_jd_extraction`(`= 'jd_extraction'`) · `insight_job_matches`(`= 'insight'`) · `jd_extraction_job_matches`(`= 'jd_extraction'`) · `retry_ai_job`(`<> 'insight'` → **의도된 설계**, 서류 턴은 같은 행 재시도 대상이 아니다) · `update_failed_jd_raw_text`(`= 'jd_extraction'`) · `purge_unused_jd_preview_outputs`(`= 'jd_extraction'`) · `cancel_document_jobs`(`= 'cover_letter'`) · `writing_chats_cancel_jobs`(**`in ('writing_chat_turn','cover_letter')`**) · `create_application_project` · `begin_assistant_message`. → **`cover_letter`를 더해야 하는 곳은 더 없다.**
- pgTAP 보강 확인: `r15_document_writing_chat.test.sql:161-163` 긍정 단정(`cover_letter` 턴 작업을 받는다) + `:178` 부정 단정 + `:294-300` 초안 경로 한 바퀴(`mark_writing_chat_extracted` → `finish_assistant_message` → `complete_ai_job`).
- **실행 확인**: 내 스모크 ①이 임시 우회 없이 통과한다(1라운드에서는 여기서 `invalid_ai_job`으로 죽었다).

### ② QA-02 — 닫힘 (정정 단락 포함 확인)

- `src/lib/contracts/ai.ts:329-355` `aiErrorEvent(code, times)`가 `ErrorEvent`의 8키를 **전부** 채운다(`internal_error`는 `category:"system"`·`failureCause:null` 분기). `turn.ts:1343-1345` `turnErrorEvent`와 `turns/route.ts:58`이 **둘 다** 그것을 쓴다. `insight/read.ts`·`server/sse.ts`도 같은 함수를 쓴다 → 코드 → C-11 매핑이 한 자리다.
- **`as` 캐스팅 제거 확인**: `turn.ts`·`turns/route.ts`에 `as AnyWritingChatTurnEvent`·`as SseEvent`·`as DocumentTurnEvent` 계열이 **0건**. 남은 캐스팅은 `src/server/sse.ts:27·39·167·169` 4건뿐이고, 이는 이벤트를 `{type, ...data}`로 분해해 쓰는 **제네릭 SSE 작성기**의 구조적 캐스팅이다(특정 턴 계약을 우회하는 자리가 아니다). 회귀 ③ 통과.
- **별개 결함(camelCase)도 닫혔다 — 내가 직접 확인했다**: `turn.ts:1312-1331` `toDocumentSseEvent()`가 `sources_selected`의 `SelectedSourceView`를 `sortOrder`·`experienceId`·`educationId`·`projectId`·`reuseReason`·`requirementIds`로 바꾼다. compose 이벤트를 내보내는 자리는 **`turn.ts:1002` 한 곳**이고 거기서 이 변환을 탄다. 나머지 compose 이벤트(`draft_started`·`draft_block`·`adjusting_length`)는 파이프라인이 이미 camelCase로 주며, `draft_block.block`만 계약이 `CoverLetterBlockSchema`(저장 모양 = snake_case)를 쓰므로 **의도대로 일치**한다.
- 스모크 ②가 와이어 모양을 단정한다: `sources[0]`의 키에 **`_`가 들어간 키가 0개**, `sortOrder`·`reuseReason` 존재, 직렬화 문자열에 `sort_order`·`reuse_reason` **없음**. 그대로 나갔으면 S-46 근거 칩이 하나도 파싱되지 않았을 자리다.
- 정정 내용(와이어는 `normalizeErrorEvent`가 재조립해 이미 정상이었고 실제 결함은 in-process 소비자 + 타입 검사 우회)도 코드에서 확인했다 — `sse.ts:27`이 `normalizeErrorEvent(event)`를 통과시킨다. Major 유지에 동의한다.

### ③ QA-03 — 닫힘

- 고아 16개가 `src/server/db/errors.ts`에서 **전부 사라졌다**(16개 각각 `grep -c` = 0).
- 남긴 6개는 `errors.ts`에 있고 **살아 있는 함수가 쓴다**: `invalid_source`(6) · `invalid_value`(5) · `field_already_applied`(3) · `invalid_review_transition`(3) · `protected_field`(1) · `field_not_patchable`(1).
- 매핑 누락 재검사: 살아 있는 raise 코드 전체 중 매핑 없는 것은 `invalid_payload`·`invalid_reason`·`not_authorized` 3개뿐이고 모두 **R15 범위 밖의 선행 코드**(`save_profile_basics`·`delete_account_data`·`compute_total_experience_months`) — 1라운드와 같다.
- 회귀 ②: typecheck·lint·Vitest 전부 통과 → 삭제로 깨진 자리 없음.

### ④ QA-04 — 부분 수정, **미해결로 남긴다**

수정된 부분은 확인했다(1라운드에 깨졌던 `r15_application_documents.test.sql`의 두 단정은 이제 `where application_project_id = …` / `where … and user_id = …`로 좁혀져 있다 — `:328`·`:331`). 그런데 **아직 전역 `count(*)`인 단정 3개가 남아 잔여 행에 깨진다**:

| 파일:행 | 단정 | 왜 깨지나 |
|---------|------|-----------|
| `supabase/tests/r15_document_writing_chat.test.sql:358` | `select is((select count(*)::int from public.writing_chats where application_project_id is not null), 0, 'application project deletion cascades to its document chats')` | **R15 파일.** 다른 사용자의 서류 대화 1개만 있어도 `have: 1 / want: 0` |
| `supabase/tests/jd_extraction.test.sql:349` | `select is(public.sweep_stalled_ai_jobs(now() - interval '1 minute'), 1, 'sweep closes the stalled extraction job')` | `sweep_stalled_ai_jobs`는 **DB 전체**를 쓸어 그 수를 돌려준다. 하트비트 없는 `queued` 작업이 남아 있으면 `have: 2 / want: 1`. `where` 절로는 좁힐 수 없다 — 픽스처 외 후보를 먼저 지우거나 `>= 1`로 바꿔야 한다 |
| `supabase/tests/ai_usage_cost_backfill.test.sql:108-110` | `select is((select count(*)::int from public.ai_usage_records where input_cost_usd = 0 and output_cost_usd = 0), 36, '…')` | 사용량 행 1개만 남아도 `have: 37 / want: 36` |

- 담당자가 함께 좁혔다고 한 `jd_extraction.test.sql`은 **1개는 고쳐졌고**(1라운드에 깨졌던 #95 "account deletion cascades through all S5 tables") **#81은 남았다**.
- 영향은 1라운드와 같다(개발자가 로컬에서 수동 스모크를 한 뒤 `supabase test db`를 돌리면 코드와 무관한 FAIL). 1라운드 7단정 → 2라운드 3단정으로 줄었다.
- 담당: **db-engineer**. 상태: **미해결**(마지막 라운드이므로 열린 상태로 넘긴다).

### ⑤ R15-API-7 — 닫힘

- 새 파일 `supabase/migrations/20261113004660_r15_document_draft_count_per_turn.sql` 존재. 리더 판정 근거(AI 명세 C-14·7.4, DM §2.5.0b, 화면의 "6 − `draft_count`")가 파일 머리에 적혀 있다.
- 로컬 DB의 `private.wc_patch_document`에서 `draft_count` 증가가 **연산 루프 밖**으로 나갔고 `if v_draft_turn then … + 1` 한 번만 돈다(334-335행). 사전 검사(`>= c_draft_limit` → `writing_chat_draft_limit_reached`)는 루프 안 96행에 그대로다.
- **회귀 ① 확인**: `private.wc_patch_deliverable`의 `draft_count` 증가는 **여전히 연산 루프 안**(147행)이다 → 산출물 대화는 연산당 그대로. STAR 분기(`wc_patch_star`)에는 `draft_count`가 없다(초안 개념이 없다). **미변경 확인.**
- **실행 확인**: 스모크 ②가 `replace_draft` 1개 + 사전/사후를 거친 초안 턴 1회 뒤 저장된 `structured_draft.draft_count === 1`을 단정한다.

## 2-C. 회귀 확인

| # | 항목 | 결과 |
|---|------|------|
| ① | 산출물·STAR 대화의 `draft_count`가 여전히 연산당인가 | **그렇다** — `wc_patch_deliverable:147`이 루프 안, STAR에는 해당 없음 |
| ② | 고아 코드 16개 삭제로 깨진 자리 | **없다** — typecheck·lint·Vitest 전부 통과, 남긴 6개는 살아 있는 함수가 쓴다 |
| ③ | `as` 캐스팅이 다른 자리에 남았는가 | **턴·라우트에는 0건.** `src/server/sse.ts` 4건은 제네릭 SSE 작성기의 구조적 캐스팅(계약 우회 아님) |
| ④ | `004650`·`004660` < `004700`이고 파괴가 마지막인가 | **그렇다** — 파일 목록 끝이 `…004600` → `…004650` → `…004660` → **`…004700_r15_drop_drafts`**. 로컬 `schema_migrations`의 적용 순서도 같고 `DESTRUCTIVE` 표식이 붙은 파일은 R13·R14·R15 셋뿐 |

## 2-D. 초안 턴(compose) 독립 스모크 — 통과

1라운드에서 QA-01에 막혀 도달하지 못한 자리를 **내 스모크로 독립 확인**했다. 실제 로컬 Supabase + 운영 팩토리(`createDocumentPipelines` 등), 공급자만 스크립트.

구성: 커리어 프로젝트 1개(설명을 채워 `status='complete'` → 팩 별칭 `PRJ-1`) → 지원 프로젝트 + 서류 정본(문항 1개, `char_limit` 900, `job_competency`) → 서류 대화 시작 → `requestedAction: "compose_draft"` 턴.

확인한 것:

| 항목 | 결과 |
|------|------|
| 이벤트 순서·이름 | `turn_started` → `draft_patch`/`draft_flags` → **`sources_selected`** → `draft_started` → `draft_block` → `draft_done` → `reply_done` → `turn_done`. **새 이름 0개** |
| 모든 이벤트가 `DocumentTurnEventSchema`를 통과 | **그렇다**(실패 이벤트 0건) |
| **`sources_selected` camelCase 변환** | **통과** — `sources[0]`의 키에 `_` 포함 0개, `sortOrder`·`reuseReason` 존재, 직렬화에 `sort_order`·`reuse_reason` 없음 |
| **저장된 블록의 근거 유지** | **통과** — `structured_draft.document.questions[q_1].draft.blocks[0].evidence`가 비어 있지 않다(V-1이 별칭 `PRJ-1`을 실제 프로젝트 uuid로 풀었다) |
| **CF-S1 슬롯 근거 저장** | **통과** — 같은 초안의 `draft.sources`가 비어 있지 않다 |
| `answer_title` | **통과** — 검증을 통과한 제목이 `draft_done`과 저장된 초안(`draft.answer_title`)에 같은 값으로 들어간다 |
| DB가 `value`를 블록으로 재조립(R5-DB-5) | **통과** — AI는 `value`를 보내지 않는데 저장된 `draft.value`에 문단 본문이 들어 있다 |
| `draft_count` | **통과** — 턴 1회 뒤 **1**(R15-API-7) |
| 로그 비밀 | **통과** — 가짜 키·문단 본문이 로그에 0건 |

부수적으로 확인된 정상 동작(결함 아님): 별칭이 팩에 없으면 V-1이 출처를 **버린다**(`sources_dropped_unknown_ref`·`evidence_removed_v1_ref` 보고 카운터로 드러났다), 근거 없는 숫자는 V-5가 치환하고 그 숫자가 제목에 있으면 **제목만 버린다**(`answer_title_dropped`). 내 첫 픽스처가 그 두 가드에 걸렸고, 픽스처를 고쳐 통과시켰다 — **가드가 실제로 돈다는 증거**다.

## 2-E. 2라운드에서 새로 찾은 결함

**QA-04의 잔여분 외에는 없다.** 수정 7건이 다른 경계를 깨뜨린 자리를 찾지 못했다.

## 2-F. 내가 만든 테스트 (2라운드)

저장소의 테스트는 고치지 않았다. 스모크 파일을 1라운드판에 **초안 턴 describe 1개를 더해** 돌린 뒤 저장소에서 지우고 보관했다(작업 트리에 내 파일 0개):

- `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-cover-letter-backend-ef4d68/cdfbb6b0-f08f-43f1-a316-88fd59d80f25/scratchpad/qa-r15-smoke.integration.test.ts`
  (`describe` 3개 — ① 서류 저장·대화 시작·질문 턴 ② 미리 보기·생성 적용 ③ **초안 턴 compose**. 3건 전부 통과)
- `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-cover-letter-backend-ef4d68/cdfbb6b0-f08f-43f1-a316-88fd59d80f25/scratchpad/qa-r15-ssrf-real.test.ts`
  (api가 같은 범위를 정식 편입했으므로 참고용)

**제안**: ③의 초안 턴 케이스는 api가 편입한 `document-chat.integration.test.ts`와 겹치는 부분이 있지만, **`sources_selected`의 와이어 키에 `_`가 없다**는 단정(QA-02 정정분의 회귀 방어)은 따로 둘 가치가 있다.

---

# 후속 라운드 — 쓰기 가드 · 첫 복사 RPC · 읽기 4건 (2026-11-09)

대상: 새 마이그레이션 `20261113004670_r15_document_write_guard_and_copy.sql` + api 후속(`application-document/read.ts`·`save.ts`·`chat.ts`·계약·`types/db.ts`). 판정 기록은 `decisions.md` "R15 후속", 담당 노트는 db "R15 후속" 절·api ⑩절.
**코드는 고치지 않았다.** 검증 스크립트는 저장소 밖에 두고 돌린 뒤 지웠다. 원격은 **읽기 전용 조회만** 했다(`list_projects`·`list_migrations`·`list_extensions`).

## F-0. 결과 요약

| 영역 | 판정 | 새 결함 |
|------|------|---------|
| A. 쓰기 가드 | **통과** — 실공격 15가지 전부 차단, 플래그 누수 없음 | 0 |
| B. 첫 복사 RPC | **통과** — 1회 기록 · `null` 2경우 · `updated_at` 불변 · 내용 저장은 여전히 올림 | 0 |
| C. 읽기 4건 | **통과** — 오류가 `null`로 접히는 서버 자리 없음 · 보드는 `body`를 읽지 않음 · 교차 사용자 격리 | 0 |
| D. 전체 회귀 | **통과** — 잔여 행 상태에서 reset 없이 4검사 통과 · 순서·원격 상태 정상 | 0 |

## F-A. 쓰기 가드 — 우회 경로를 직접 찾았다

로그인한 사용자 세션 클라이언트(supabase-js, 실제 PostgREST)로 공격했다. 근거: 스크래치패드 `guard-attack.out`.

| # | 시도 | 결과 |
|---|------|------|
| 1 | REST `insert` — 6문항(`too_many_questions`를 건너뛸 모양) + `filled_slot_count: 99` | **`P0001 direct_write_not_allowed`**, 행 안 생김 |
| 2 | REST `update` — `body` / `filled_slot_count` / `first_copied_at` / `meta` / **`updated_at`만** / **`user_id`를 B로 바꾸기** | **6개 전부 `direct_write_not_allowed`**, 행 바이트 단위 불변 |
| 2b | REST `update` — 생성 컬럼 `slot_count` | Postgres가 먼저 거부(`428C9 … can only be updated to DEFAULT`) |
| 3 | REST `upsert` — `onConflict`(= `ON CONFLICT DO UPDATE`) / `ignoreDuplicates`(= `DO NOTHING`) | **둘 다 `direct_write_not_allowed`** (BEFORE INSERT가 먼저 돈다), 행 불변·새 행 없음 |
| 4 | **`.rpc("set_config", {…'on'…})`로 플래그 켜기** | **`PGRST202` 함수 없음** — `set_config`는 `pg_catalog`에 있고 PostgREST는 `public`·`graphql_public`만 노출(`supabase/config.toml:13`) |
| 4b | `.schema("pg_catalog").rpc("set_config")` | **`PGRST106 Invalid schema`** |
| 4c | `.rpc("current_setting")` | `PGRST202` |
| 5 | GraphQL 변경(`/graphql/v1`) | 로컬: `pg_graphql` 미설치. **원격도 `installed_version: null`**(읽기 조회) → 운영에 두 번째 쓰기 진입점이 없다. 설치되더라도 행 트리거는 진입점과 무관하게 돈다 |
| 8 | B가 A의 행 select / update / delete | 0행(RLS), A의 행 그대로 |
| 9 | **A가 자기 행 REST delete** | **허용**(DM §2.7.3 "delete 본인") |

**플래그 누수 — 한 트랜잭션 안에서 `authenticated`로 확인(psql, `request.jwt.claims` 설정):**
- 저장 RPC 성공 직후 `current_setting('app.application_document_write')` = **`off`**, 같은 트랜잭션의 직접 update → **거부**.
- **플래그 창 안에서 RPC가 raise**(`stale_write`)하고 호출자가 savepoint로 잡은 뒤 → **`off`**(서브트랜잭션 롤백이 GUC를 되돌린다), 직접 update → **거부**.
- 복사 RPC 직후 → **`off`**, 직접 update → **거부**.
- 저장 RPC의 플래그 창(`004670` 465~486행)에 **조기 `return`이 없다** — 경로는 insert / stale raise / update뿐.

**우회 가능한 다른 자리 전수 조사(로컬 DB `pg_proc`):**
- 플래그를 만지는 함수는 **3개뿐** — `guard_write`(트리거) · `save_application_document` · `mark_application_document_copied`(둘 다 invoker).
- `authenticated`가 실행할 수 있는 public·private 함수 중 **`set_config`를 리터럴이 아닌 이름으로 부르는 것 0개**.
- `application_documents`를 쓰는 **definer 함수는 `private.reset_application_document_slots` 1개**. 가드를 건너뛰지만(설계대로 — 소유자로 돈다) ① `private`은 PostgREST에 노출되지 않고 ② 모든 조회·쓰기가 `user_id = auth.uid()`로 묶여 **자기 행의 지정 슬롯을 비우는 일만** 하며 ③ `filled_slot_count`를 다시 센다. 호출자는 invoker `delete_career_item` 하나. 결함 아님.
- **쓰기 권한을 가진 역할**: `authenticated`(가드 목록 안) · 소유자 `postgres`뿐. `service_role`은 select·delete, `app_ai_writer`는 select. 컬럼 단위 쓰기 grant 없음.
- 트리거 순서: `application_documents_guard_write`가 `…_set_updated_at`보다 **먼저**(둘 다 BEFORE, 이름순).

**delete 경로 정상**: REST delete(본인) 허용 · 지원 프로젝트 cascade와 `delete_career_item` definer 경로는 pgTAP `r15_document_write_guard.test.sql`가 단정하고 통과.

**배포 순서 위험 없음**: `src/` 어디에도 `from("application_documents")` 뒤 `insert`/`update`/`upsert`가 **0건**(테스트 포함) → `004670`을 코드보다 먼저 원격에 올려도 배포된 코드가 깨지지 않는다.

**`save_application_document` 회귀 없음**: `003700`(유일한 이전 정의)과 `004670`의 함수 본문을 공백 무시로 diff — **차이는 `set_config` 2줄 + 주석 2줄뿐**. 로컬 DB의 살아 있는 본문은 `004670` 파일과 같다.

## F-B. 첫 복사 RPC `mark_application_document_copied`

| 확인 | 결과 |
|------|------|
| 두 번 부르면 같은 값 · 저장된 값 = 반환값 | **그렇다** |
| 행 없는 프로젝트 | **`null`** |
| B가 A의 프로젝트로 호출 | **`null`**, A의 `first_copied_at` **불변** |
| `p_document_kind` 밖 값 | `invalid_fields` |
| **복사가 `updated_at`을 올리지 않는다** | **그렇다** |
| **핵심 회귀 — 복사 뒤, 복사 전 기대 버전으로 내용 저장** | **성공**(`stale_write` 아님) → `updated_at`이 **오른다** → `first_copied_at` 유지 → 그 옛 버전은 **이제 `stale_write`** |
| 내용이 같은 저장(저장된 `body`를 그대로 되보냄) | `updated_at` **유지** (R5-DB-11) |
| `meta`만 바꾼 저장 | `updated_at` **오른다** |
| 키 순서만 다른 같은 `body` | `updated_at` **유지**(jsonb 의미 비교) |
| api 반환 타입 | `save.ts:109-110` — `data as string \| null`, 빈 문자열도 `null`, **`error`는 `mapDbError`로 던진다**(접지 않는다). 생성 타입 `Returns: string`과의 함정을 처리했다 |

> 처음 돌린 내 시나리오에서 "변경 없는 저장인데 `updated_at`이 올랐다"가 나왔지만 **내 테스트 오류**였다 — `question_id` 없이 보내 서버가 새 uuid를 만들어 본문이 실제로 바뀌었다. 저장된 `body`를 그대로 되보내 다시 확인했고 위 표가 그 결과다.

## F-C. 읽기 4건 — 데이터 손실 방지

- **오류가 `null`로 접히는 서버 자리 없음**: `getApplicationDocument`·`listDocumentSlotCounts` 모두 `if (error) throw mapDbError(error)`이고 `null`은 **`!data`(행 없음)일 때만**이다. 액션 래퍼 `runAction`(`src/lib/contracts/errors.ts:128-134`)은 예외를 **`{ error }`**로 돌려주며 `{ data: null }`과 구분된다. `.maybeSingle()`은 `unique (application_project_id, document_kind)`로 다중 행 오류가 날 수 없다.
- **보드는 `body`를 읽지 않는다**: select = `application_project_id, slot_count, filled_slot_count`(`read.ts`). 두 값은 생성 컬럼·저장 RPC 값 그대로.
- **`getWritingChat` 서류 분기**: `chat.ts:259-262` — 산출물 → **서류** → STAR 순. 대상 배타 CHECK 때문에 세 대상이 겹치지 않아 순서가 안전하다. **STAR 목록 `listProjectWritingChats`는 `project_id = ?`(서류 대화는 `project_id` null)라 서류 대화가 섞이지 않는다.** 산출물·STAR 읽기 회귀는 기존 통합 테스트(`deliverable-chat`·`writing-chat`)가 통과로 보인다.
- **교차 사용자**: `document-chat.integration.test.ts:507-521`이 두 번째 사용자에게 정본 `null`·보드 키 없음·근거 `{}`·대화 목록 `[]`·상세 `not_found`·복사 `null`(원래 행 불변)을 단정하고 통과. 내 REST 공격(#8)도 같은 결과.
- **키 케이스**: `DocumentWritingChatDto.structuredDraft`는 `CoverLetterDraftSchema`(저장 모양 snake_case — AI·저장과 **같은 스키마**)로 고정, DTO 자기 필드는 camelCase. SSE `sources_selected`(camelCase 표시 카드)와는 **다른 payload**라 어긋나지 않는다. **QA-02 정정분 회귀 단정이 정식 편입됐다** — `document-chat.integration.test.ts:353·357`이 `sources_selected` 키에 `_`가 0개임을 단정(2라운드 제안 반영).

**관찰(결함 아님)**: `CoverLetterDraftSchema`의 `sources`는 `.default([])`라 저장된 초안에 `sources` 키가 **없을 때**도 DTO에는 `[]`로 보인다. CF-S1에서 "키 없음 = 기존 행 유지 / 빈 배열 = 삭제"는 다른 뜻이지만, 이 파싱(`parseCoverLetterDraft`)은 **읽기 경로에서만**(DTO 매퍼·패치 결과 되읽기·AI 컨텍스트) 쓰이고, 쓰기는 파이프라인 결과로 따로 조립되며 저장 RPC는 `sources`를 DB에서 직접 읽는다(`private.doc_proposal_sources`). **저장 의미는 보존된다.** 초안 턴은 블록이 남은 문항마다 키를 항상 싣기 때문에 실제로는 거의 생기지 않는다. 표시만의 모호함이라 이슈로 올리지 않았다.

## F-D. 전체 회귀

| 검사 | 결과 |
|------|------|
| `run-checks.sh` — **잔여 행 상태, reset 없이** | **typecheck · lint · Vitest(150/2,429) · pgTAP(65/2,649) 전부 통과** |
| 심은 잔여 행 | 다른 사용자 3명 — `application_documents` 1(`first_copied_at` 채움) · `writing_chats` 1 · `ai_jobs` 1(queued, 하트비트 없음) · `ai_usage_records` 1 · `jd_requirements` 1 · `evidence_links[application_document]` 1 |
| **QA-04 닫힘 확인** | 2라운드에 남긴 3단정이 전부 좁혀졌다: `r15_document_writing_chat.test.sql:360-362`(`where application_project_id = <픽스처>`) · `ai_usage_cost_backfill.test.sql:110-113`(`and user_id = <픽스처>`) · `jd_extraction.test.sql:352-353`(`>= 1` — sweep은 DB 전체를 세므로 `where`로 못 좁힌다. **바로 다음 단정이 픽스처 JD의 `extraction_status`로 우리 작업이 실제로 닫혔는지 확인**하므로 약해진 만큼 보완된다) |
| 파일 순서 | `…004650` → `…004660` → **`…004670`** → **`…004700_r15_drop_drafts`**(파괴, 마지막). `004670`에 `DESTRUCTIVE` 표식 없음 |
| **원격 적용분 무변경** | `git diff HEAD -- supabase/migrations/` = **0**(추적 파일 diff 없음). 새 파일은 `004670` 하나(미추적) |
| **원격 상태(읽기 전용)** | 원격 마지막 적용 = **`20261113004660`**, R15 비파괴 17개 적용됨, **`004670`·`004700` 없음** → `004670`이 원격 마지막 번호보다 뒤라 `db push`가 받는다 |
| 생성 타입 | `gen types --local`이 `database.types.ts`와 **동일** |

## F-E. 범위 밖 관찰 (리더 판단 대상 — R15 결함 아님)

- **`profile_job_interests`도 같은 구조의 직접 쓰기 우회가 가능해 보인다**(db 노트가 이미 올린 건). 구조로 확인한 것: `authenticated`에 INSERT·DELETE grant, 가드 트리거 없음(트리거는 값 검사 `validate_profile_options` 하나), 제약은 `unique (user_id, job_family, job_role)`과 `sort_order` 1~2 CHECK뿐이고 **`(user_id, sort_order)` 유일성이 없다** → 서로 다른 쌍을 2개 넘게 넣어 상한을 건너뛸 수 있는 모양이다. **실제 공격으로는 재현하지 않았다**(R15 밖). 같은 패턴(트랜잭션 로컬 플래그 + 가드 트리거)으로 막을 수 있다.
- **UI 요청(UI 세션)**: ① `src/lib/data/cover-letters.ts`(이 워크트리에 없다)의 `getCoverLetterDocument`가 액션의 **`{ error }`를 `null`로 접지 않을 것** — 접으면 서버를 고친 의미가 사라지고 문항 설정 상태로 열려 덮어쓰기가 되살아난다. ② S-46이 연 정본의 **`updated_at`을 다음 저장의 `expectedUpdatedAt`으로** 보낼 것(api 노트 ⑩ "열린 것"과 같다).

## F-F. 정리

- 내가 만든 사용자 3명(`qa-guard-*`·`qa-leftover-*`·`qa-ver-*`)과 그 행을 전부 지웠다. 끝 상태: 사용자 0 · `application_documents` 0 · `writing_chats` 0 · `ai_jobs` 0 · `ai_usage_records` 0 · `evidence_links` 0. 내 것이 아닌 사용자는 없었다.
- 작업 트리에 내 파일 0개. `db reset`은 쓰지 않았다.
- 검증 스크립트·출력: `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-cover-letter-backend-ef4d68/cdfbb6b0-f08f-43f1-a316-88fd59d80f25/scratchpad/guard-attack.mjs` · `…/guard-attack.out` · `…/run-checks-fu.log`

---

# 후속 라운드 2 — CF-S7 · 슬롯 재사용 금지 · `draft_done.draft` (2026-11-09)

대상: 새 마이그레이션 `20261113004690_r15_document_save_null_expected.sql`(서류 저장 RPC 재정의 + `slot_high_water` 컬럼 + `updated_at` 트리거 교체) + api `draft_done.draft`·`slotHighWater`. 근거 문서: `decisions.md` "CF-S7"·"R15 후속 3 리더 판정 2건", db "R15 후속 3" 절·api ⑪절.
**코드는 고치지 않았다.** 검증은 사용자 세션 REST(supabase-js), `app_ai_writer` 역할의 실제 패치 RPC, 실제 의존 Vitest 스모크로 했다. 원격에는 아무것도 하지 않았다.

## G-0. 결과 요약

| 영역 | 판정 | 새 결함 |
|------|------|---------|
| A. CF-S7 덮어쓰기 방지 | **통과** — 행 있음 + null → `stale_write`, 아무것도 안 바뀜 · 우회 0 · **동시 첫 저장 25/25 정상** | 0 |
| B. 슬롯 재사용 금지 | **부분 통과** — 순차 경로는 설계대로. **같은 요청 안의 교체는 뚫린다** | **QA-07 (Major)** · **QA-08 (Minor)** |
| C. `draft_done.draft` | **통과** — 보정 뒤 저장본과 의미 필드 전부 일치, 보정 전 `draft_block`과 다름 | 0 (관찰 1) |
| D. 전체 회귀 | **통과** — 잔여 행 상태에서 reset 없이 4검사 통과 · 순서·커밋 파일 무변경 | 0 |

## G-A. CF-S7 — 덮어쓰기가 정말 막혔는가

사용자 세션 REST로 재현했다. 근거: 스크래치패드 `cfs7.out`.

| # | 시도 | 결과 |
|---|------|------|
| A1 | 첫 저장(행 없음 + null) | **성공**, 반환 **11키**(`slot_high_water` 포함) |
| A2 | **행 있음 + null** — 3문항으로 바꾼 `body` + `p_meta` + `p_application_values`(이름·마감일) + `p_applied_proposals` 함께 | **`stale_write`**, detail = 현재 `updated_at`(정확히 일치) |
| A2c | 그 뒤 상태 | **전부 그대로** — `body`·`meta`·`filled_slot_count`·`slot_high_water`·`updated_at`·근거 행 수·**지원 프로젝트 이름·마감일** |
| A3 | 기대 버전 우회: 먼 미래(`9999-…`) / 먼 과거(`1970-…`) / 다른 오프셋의 epoch / `infinity` / `-infinity` | **모두 `stale_write`** |
| A3 | 잘못된 형식(`not-a-date`·빈 문자열) | `22007` 형변환 거부 — RPC에 들어가지 못한다(쓰기 없음). api는 zod `z.iso.datetime`이 먼저 막는다 |
| A3 | 마이크로초를 ms로 자른 값 | **`stale_write`** — 정밀도까지 엄격(우회 아님. api는 문자열을 그대로 왕복한다) |
| A3 | null + `p_client_id`(서류는 무시) | **`stale_write`** |
| A3z | 모든 우회 시도 뒤 | **그대로** |
| A4 | 같은 순간을 `+09:00` 오프셋으로 | **성공** — 거짓 충돌이 없다 |
| A5 | 행 있음 + null + **6문항**(400 모양) / 오래된 버전 + 잘못된 슬롯 | **둘 다 `stale_write`** — 검사 위치 이동으로 **409가 400보다 먼저** 나온다(설계대로) |
| **A6** | **동시 첫 저장** — 같은 사용자의 독립 클라이언트 2개(두 탭), 같은 지원 건, 둘 다 null, 행 없음, `Promise.all` | **25회 반복 25/25: 정확히 하나 성공 + 하나 `stale_write`.** 500 **0건**, `ok+ok` **0건**. **25/25 모두 정본이 성공한 쪽 내용**(문항 수·문구 태그로 확인) |
| A7 | 다른 저장 RPC 3종은 null로 여전히 덮어쓰는가 | `save_project_deliverable` null 두 번 → **둘 다 성공** · `save_profile_basics` null 두 번 → **둘 다 성공**. `save_project_page`는 내 픽스처(독립 프로젝트)가 대상이 아니라(`project_not_affiliated`) 실행으로는 못 봤고, **소스로 확인**: 세 함수 모두 `p_expected_updated_at is not null and …`이고 **`004690`은 세 함수를 재정의하지 않는다**(재정의는 `save_application_document`·`application_documents_set_updated_at` 둘뿐) |

**동시 첫 저장이 맞는 이유(코드 확인)**: 두 번째 트랜잭션은 `application_projects … for update`에서 첫 번째가 커밋할 때까지 기다리고, READ COMMITTED에서 **다음 문장(`application_documents … for update`)이 새 스냅숏**을 잡아 첫 번째의 행을 본다 → `found` + null → `stale_write`. 2차 방어 `exception when unique_violation`(439행)은 이 경로에서 실행되지 않았다(첫 방어가 25/25 막았다).

**검사 위치 이동의 회귀 없음**: 기대 버전 검사가 행 잠금 직후(207~217행)로 올라가, 문항 검사·근거 쓰기·반영됨 기록보다 먼저다. A2가 `p_applied_proposals`를 함께 보냈는데 **반영됨 기록도 쓰이지 않았다**(2.5.1 "아무것도 쓰지 않는다").

## G-B. 슬롯 재사용 금지

근거: 스크래치패드 `slot.out`. 대화 제안은 **실제 패치 RPC**(`app_ai_writer`, `apply_structured_draft_patch` `replace_draft`)로 만들었다 — 저장된 제안은 `rev: 1`과 옛 `q_3`의 `question_id`를 갖는다.

**양성 대조**(별도 픽스처): 같은 질문에 그 제안을 적용 → **`applied`**. 즉 아래의 `skipped`·`applied`는 제안이 잘못 만들어져서가 아니다.

### 순차 경로 — 설계대로 동작

| # | 단계 | 결과 |
|---|------|------|
| B1 | `q_3` 지우고 저장 | 성공, `slot_high_water` 3 유지 |
| B2 | `q_3`를 새 문항으로 다시 넣기 | **`invalid_slot [q_3]`**, **아무것도 안 바뀜** |
| B3 | `q_4` 추가 | 성공, `slot_high_water` 4(반환값도 4) |
| B4 | 옛 제안을 `q_4`로 적용 시도(`{chat, slot: q_4, rev: 1}`) | **`skipped: not_found`** — 옛 제안이 새 문항에 붙지 않는다 |
| B7 | REST로 `slot_high_water`를 0으로 직접 낮추기 | **`direct_write_not_allowed`**(쓰기 가드), 값 4 그대로 |
| — | `slot_high_water`만 바뀐 update(소유자 SQL) | **`updated_at` 그대로**(트리거 제외 목록에 들어갔다). 내용이 바뀌는 저장은 여전히 올린다(G-C의 [반영] 저장에서 확인) |

### QA-07 [Major] 같은 요청 안의 교체가 슬롯 재사용 금지를 뚫는다

- 담당: **db-engineer**
- 판정 근거: 서버는 **슬롯 이름만** 본다. `004690:233-237`
  ```sql
  if not (v_reuse = any (v_stored_slots)) and substr(v_reuse, 3)::integer <= v_high then
    raise exception using errcode = 'P0001', message = 'invalid_slot', detail = v_reuse;
  ```
  `v_stored_slots`는 저장된 본문의 **슬롯 이름 목록**이다. 보낸 `q_3`의 `question_id`가 저장된 `q_3`와 달라도 "기존 슬롯"으로 통과한다.
- 재현(실제 REST + 실제 제안):

  | 변형 | 한 요청의 내용 | 결과 |
  |------|----------------|------|
  | S-swap | 저장된 `q_3` 대신 **다른 `question_id`**·다른 문구의 `q_3` + 옛 제안 `{chat, q_3, rev 1}` | **성공 · `applied`** · 저장된 `q_3`는 **새 `question_id`·새 문구**인데 본문은 **옛 질문용 AI 제안 문장** |
  | S-swapnull | 같은 교체, **`question_id` 생략** | **성공 · `applied`** · 서버가 **기존 슬롯에 새 uuid를 발급**했다 |

  두 경우 모두 대화에 남은 옛 제안의 `question_id`는 **옛 값**이다 — 서버가 비교할 정보를 갖고 있다.
- 왜 문제인가: `004690` 머리 주석이 밝힌 이 규칙의 목적이 정확히 "the chat's OLD q_3 proposal would attach to the new question"을 막는 것이다(DM §2.5.0b "번호는 그 서류에서 한 번 쓰면 재사용하지 않는다"). 순차 경로(B2)는 막지만 **한 요청 안에서는 그대로 일어난다**. 부수 효과: `question_id`를 생략하면 **기존 문항의 정체가 저장마다 바뀐다** → `user_note` 근거의 `source_id`(= `question_id`)가 옛 값을 가리키게 된다.
- 도달 가능성: **올바른 화면에서는 생기지 않는다** — api 계약(`application-document.ts:137`)이 새 문항 번호를 `slot_high_water + 1`로 매기라고 하고, 화면이 `getApplicationDocument`의 `question_id`를 왕복하면 같은 슬롯에 다른 질문이 들어갈 일이 없다. **`question_id`를 왕복하지 않는 클라이언트·옛 탭·화면 버그 하나면** 조용히 일어나고, 사용자에게는 아무 오류도 보이지 않는다. 남의 데이터 침해는 아니다. 리더가 Minor로 낮출 수 있는 경계에 있다.
- 수정 제안(택1): ① **저장된 슬롯의 `question_id`와 보낸 `question_id`가 다르면 새 문항으로 보고** 같은 `invalid_slot`을 낸다. ② `question_id`가 생략된 **기존 슬롯은 저장된 `question_id`를 이어받는다**(새 uuid는 새 슬롯에만). ③ 최소한 반영됨 판정에서 **제안의 `question_id` ≠ 본문의 `question_id`이면 `skipped: proposal_changed`**. ①+② 조합을 권한다.
- 상태: **열림**

### QA-08 [Minor] 본문에 없는 슬롯의 제안이 `applied`로 기록된다

- 담당: **db-engineer**
- 재현: 저장된 `q_1·q_2·q_3` + `q_3` 제안(근거 `sources` 1개 포함). 한 저장에서 `q_3`를 지우면서 `p_applied_proposals: [{chat, q_3, rev 1}]`를 보냄 → **`applied`**. 대화의 `q_3` 제안에 `applied_at`·`applied_rev = 1`이 찍힌다(B5·B5').
- 영향: **근거 행은 쓰이지 않았다**(`evidence_links` 0행 — 보내지 않은 슬롯 삭제 규칙이 이긴다). 지원 프로젝트 삭제 영향 수도 정상. **틀리는 것은 대화의 "반영됨" 표시뿐**이다(이제 없는 문항에 반영됐다고 보인다). 화면 흐름: [반영]을 눌러 놓고 저장 전에 그 문항을 지우면 생긴다.
- 범위: **`004690`이 만든 것이 아니다**(반영됨 판정은 `003700`부터 같다). 슬롯 삭제가 가능한 서류에만 있는 경우다.
- 수정 제안: 반영됨 판정에서 **슬롯이 이번에 저장되는 본문에 없으면 `skipped: not_found`**.
- 상태: **열림**

## G-C. `draft_done.draft` — 보정 뒤에도 저장본을 싣는가

실제 의존 스모크(로컬 스택 + `createDocumentPipelines` + 실제 패치 RPC): 문항 `char_limit 100`(공백 포함), 첫 초안 문단 약 40자(범위 밖) → 보정 호출이 약 100자 문단을 돌려준다.

| 확인 | 결과 |
|------|------|
| 보정이 실제로 일어났나 | **예** — `adjusting_length` 이벤트 · `draft_done.correctionApplied = true` |
| `draft_done.draft` = DB 저장본 | **의미 필드 전부 일치** — `value`·`rev`·`base_body_hash`·`answer_title`·`sources`·`char_count`·`char_adjust_needed`·`correction_applied`·블록(`block_id`·`type`·`text`·`basis`·`review`·`evidence`) |
| 보정 전 `draft_block`과 다른가 | **다르다** — `draft_block.block.text` = 보정 전 짧은 문장, `draft_done.draft.blocks[0].text` = 보정 뒤 문장. `draft.value`도 보정 뒤 문장 |
| `draft_done.rev === draft.rev` | **같다** |
| 키 케이스 | 바깥 필드 `_` 포함 키 **0개**(camelCase), `draft` 안은 저장 모양(`char_count`·`blocks`·`value`·`rev`) |
| QA-02 회귀 단정(`sources_selected` 키에 `_` 없음) | **통과** |
| 새로 고침 경로 | `getWritingChat` DTO의 같은 슬롯 `draft`가 `draft_done.draft`와 **완전히 같다** |
| **[반영] 끝까지** | `draft_done.draft.value`로 본문을 채우고 `{chat, q_1, rev}`로 저장 → **`applied`**, 저장된 본문 = **보정 뒤 문장**(보정 전 문장 아님), `updated_at` 오름 |

**관찰(결함 아님)**: 바이트 단위로는 블록 키 2개가 다르다 — `draft_done.draft`에는 `requirement_ids: []`가 있고 DB 저장본에는 없으며, DB 저장본에는 `source_project_fields: []`가 있고 `draft_done.draft`에는 없다. 원인은 패치 RPC 응답을 `parseCoverLetterDraft`(TS `CoverLetterBlockSchema`)로 한 번 거르기 때문이고, **새로 고침 DTO(`mappers.ts:102`)도 똑같이 거른다** — 화면은 실시간·새로 고침 양쪽에서 **같은 모양**을 본다. 두 키 모두 서류 블록에서는 늘 빈 배열이고 [반영]이 쓰지 않는다. 계약 주석(`writing-chat.ts:781-786`)의 "exactly as … holds it"은 "TS 스키마로 정규화한 저장본"이 정확한 표현이다. 이슈로 올리지 않았다.

## G-D. 전체 회귀

| 검사 | 결과 |
|------|------|
| `run-checks.sh` — **잔여 행 상태, reset 없이** | **typecheck · lint · Vitest(150/2,432) · pgTAP(66/2,688) 전부 통과** |
| 심은 잔여 행 | 사용자 3명 — `application_documents` 32 · `writing_chats` 6 · `ai_jobs` 1(queued) · `ai_usage_records` 1 · `jd_requirements` 1 |
| 파일 순서 | `…004680` → **`…004690`** → **`…004700_r15_drop_drafts`**(파괴, 마지막). `004690`에 `DESTRUCTIVE` 표식 없음 |
| 커밋된 마이그레이션 무변경 | `git diff --stat HEAD -- supabase/migrations/` **비어 있음**. 미추적 새 파일은 **`004690` 하나** |
| 생성 타입 | `gen types --local`이 `database.types.ts`와 **동일**(`slot_high_water` 반영) |
| api 계약 | 저장 결과 zod가 **11키**(`slot_high_water`) — 실제 서비스 경유 저장이 스모크에서 성공했다. `stale_write` → 409 + `details.current_updated_at` |

## G-E. 정리

- 내가 만든 사용자 3명(`qa-cfs7-*`·`qa-slot-*`·`qa-leftover-*`)과 그 행을 전부 지웠다(스모크 사용자는 테스트가 스스로 지웠다). 끝 상태: 사용자 0 · 정본 0 · 대화 0 · 작업 0 · 사용량 0 · 근거 0 · 요건 0 · 지원 프로젝트 0 · 프로젝트 0. 내 것이 아닌 사용자는 없었다.
- 작업 트리에 내 파일 0개. `db reset`은 쓰지 않았다.
- 스크립트·출력(스크래치패드 `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-cover-letter-backend-ef4d68/cdfbb6b0-f08f-43f1-a316-88fd59d80f25/scratchpad/`): `cfs7.mjs`·`cfs7.out`(A) · `slot-common.mjs`·`slot.out`(B) · `qa-r15-smoke.integration.test.ts`(C 포함 4 describe) · `run-checks-fu2.log`(D)
- **제안**: QA-07 수정 때 스크래치패드 `slot.out`의 S-swap·S-swapnull 두 경우를 pgTAP로 옮기면 회귀 방어가 된다(지금 `r15_document_save_versions.test.sql`은 순차 경로만 본다).

## G-R. 재확인 — QA-07·QA-08 수정 (2026-11-09)

db가 `004690`을 직접 고쳤다(미커밋 파일). 로컬 DB를 **마이그레이션 파일로 다시 만든 뒤**(`supabase db reset` — 살아 있는 함수 = 파일임을 보장) 후속 라운드 2의 **같은 시나리오**를 다시 돌렸다. 시나리오는 이번에 파일로 남겼다(스크래치패드 `slot-step1.mjs`·`slot-plant.sh`·`slot-step2.mjs`, 출력 `slot-r3.out`). 제안은 이번에도 **실제 패치 RPC**(`app_ai_writer`)로 만들었다.

### G-R1. 같은 재현의 전후 비교

| 시나리오 | 후속 라운드 2 (수정 전) | 재확인 (수정 후) | 판정 |
|----------|------------------------|-----------------|------|
| **양성 대조** — 같은 질문에 그 제안 적용 | `applied` | **`applied`** | 정상 제안을 막지 않는다 |
| B1 `q_3` 삭제 | 성공, high 3 | 성공, high 3 | 변화 없음 |
| B2 `q_3` 새 문항으로 재추가 | `invalid_slot`, 불변 | **`invalid_slot`, 불변** | 변화 없음 |
| B3 `q_4` 추가 | 성공, high 4 | 성공, high 4 | 변화 없음 |
| B4 옛 제안을 `q_4`로 | `skipped: not_found` | **`skipped: not_found`** | 변화 없음 |
| **B5 (QA-08)** 본문에 `q_3` 없이 `q_3` 제안 청구 | **`applied`**, `applied_rev = 1` | **`skipped: not_found`**, **`applied_at`·`applied_rev` 없음** | **닫힘** |
| B7 REST로 `slot_high_water` 낮추기 | `direct_write_not_allowed` | **`direct_write_not_allowed`** | 변화 없음 |
| **S-swap (QA-07)** 같은 번호 + **다른 `question_id`** + 옛 제안 청구 | 성공·**`applied`**, 새 질문에 옛 문장 | **`invalid_slot [q_3]`**, **행 그대로**, 옛 제안 **적용 안 됨** | **닫힘** (규칙 1) |
| **S-swapnull (QA-07)** 같은 번호 + **`question_id` 생략** | 성공·`applied`, **새 uuid 발급** | 성공·`applied`, **저장된 `question_id`를 물려받음**(새 uuid 없음) | **닫힘** (규칙 2) — 아래 해석 |

**S-swapnull의 해석**: 수정 뒤 `question_id`를 생략한 기존 슬롯은 **"같은 질문, 문구만 고침"**으로 읽힌다(저장된 id를 물려받는다). 그 질문 자신의 제안(제안의 `question_id` = 물려받은 id)을 적용하는 것은 정상 흐름이다 — 사용자가 문항 문구를 다듬고 그 문항의 AI 초안을 반영하는 경우와 같다. 수정 전의 문제는 ① **기존 문항에 새 uuid가 발급돼 정체가 바뀌는 것**(`user_note` 근거가 옛 id를 가리킴)과 ② 다른 질문을 같은 번호에 넣을 수 있는 것이었는데, ①은 규칙 2가, ②는 규칙 1(다른 `question_id` → `invalid_slot`)이 막는다. "다른 질문"을 같은 번호에 넣는 길은 이제 없다.

### G-R2. 새 definer 헬퍼 `private.doc_proposal_question_id` — 우회 경로가 아니다

| 확인 | 결과 |
|------|------|
| 정의 | `security definer` · `search_path = ''` · 인자 `(p_writing_chat_id, p_application_project_id, p_document_kind, p_slot)` → `uuid` |
| 소유자 검사 | 함수 안 `where w.id = ? and w.user_id = auth.uid() and w.application_project_id = ? and w.document_kind = ?` — `auth.uid()`가 null이면 `not_authenticated` |
| **남의 대화 읽기** | 같은 트랜잭션에서 소유자 A는 자기 제안의 `question_id`를 받고, **사용자 B로 바꿔 같은 인자를 넣으면 `null`** |
| REST 노출 | `.rpc("doc_proposal_question_id")` → **`PGRST202`**(public에 없다) · `.schema("private").rpc(...)` → **`PGRST106 Invalid schema`** |
| execute 권한 | `authenticated`만(invoker 저장 RPC가 부르기 때문 — R15-DB-2와 같은 모양). `anon`·`app_ai_writer`·`app_key_reader`·`service_role` 없음 |
| 돌려주는 것 | uuid 하나뿐(형식 검사 통과한 것만) — 제안 본문·근거는 내보내지 않는다 |

### G-R3. 범위 밖 수정(6번) `wc_patch_document`의 회귀 — 없음

- `004690`이 정의하는 함수는 **4개뿐**: `application_documents_set_updated_at` · `doc_proposal_question_id` · `save_application_document` · `wc_patch_document`. **`wc_patch_deliverable`·`wc_patch_star`·`apply_structured_draft_patch_impl`·`apply_structured_draft_patch`는 재정의하지 않는다**(0건) → 산출물·STAR 패치는 바뀌지 않았다.
- `wc_patch_document`를 직전 정의(`004660`)와 공백 무시로 diff — **차이는 한 덩어리(190행)뿐**: `replace_draft`가 유효한 `question_id`를 실으면 그 슬롯의 저장 `question_id`를 따라 바꾼다. 그 밖은 같다.
- **R15-API-7 유지**: 서류 `draft_count`는 여전히 루프 **밖에서 한 번**(`if v_draft_turn then … + 1`, 340행). 산출물은 여전히 루프 **안**(연산당, `wc_patch_deliverable:147`).
- 산출물·STAR 대화의 기존 테스트(Vitest `deliverable-chat`·`writing-chat`·`turn`, pgTAP `writing_chats`·`r5_*`)가 전부 통과.

### G-R4. 알려진 한계 판정 — **실제로는 생기지 않는다** (막을 필요 없음)

질문: 미저장 슬롯(폼 스냅숏에만 있는 문항)의 초안 턴이 `replace_draft`에 `question_id`를 싣지 않아 규칙 4의 비교가 건너뛰어지는가.

- **미저장 슬롯은 초안 컨텍스트에 아예 들어가지 않는다.** `mergeQuestions`(`src/server/ai/context-pack/cover-letter-chat.ts:213-234`)는 **저장된 정본 행만** 순회한다(`rows.slice(0, MAX_QUESTIONS).map(...)`). 스냅숏은 **같은 슬롯의 값을 덮어쓸 뿐** 새 문항을 추가하지 않는다. 그래서 모델이 그 슬롯의 초안을 쓸 일이 없고, 제안도 생기지 않는다.
- **저장된 행은 늘 `question_id`를 갖는다**: 로더 `documentQuestionRows`가 `question_id`가 문자열이 아닌 행을 건너뛴다(`src/server/services/writing-chat/pipelines.ts:418`). 컨텍스트 타입의 `questionId`도 필수(`string`, `cover-letter-chat.ts:144`).
- 실행 확인: 저장 행 `q_1·q_2` + 스냅숏 `q_2`(수정)·`q_4`(미저장)로 `mergeQuestions`를 돌린 임시 단위 테스트 → 결과 슬롯 **`["q_1","q_2"]`**(스냅숏 전용 `q_4`는 빠짐), 모든 행에 36자 `question_id`, `q_2` 문구는 스냅숏 값으로 덮임. (테스트는 확인 뒤 지웠다.)
- 결론: `cover-letter-patch.ts:148`의 조건부(`questionId`가 있을 때만)는 **실제로는 늘 참**이다. 규칙 4는 비교를 건너뛰지 않는다. 저장된 슬롯은 규칙 1·2가 지킨다. **막을 필요가 없다.**
- 참고(결함 아님, 제품 판단): 저장 전 새 문항은 AI 초안 대상이 아니라는 뜻이기도 하다. 그것이 의도한 UX인지는 UX 몫이다 — 이번 수정과는 무관하다.

### G-R5. 전체 회귀

| 검사 | 결과 |
|------|------|
| `run-checks.sh` — **잔여 행 상태, reset 없이** | **typecheck · lint · Vitest(150/2,432) · pgTAP(66/2,708) 전부 통과** |
| 심은 잔여 행 | 다른 사용자 2명 — `application_documents` 5 · `writing_chats` 5 · `ai_jobs` 1(queued) · `ai_usage_records` 1 · `jd_requirements` 1 |
| pgTAP 증가분 | +20 단정 — `r15_document_save_versions.test.sql:229-353`에 **S-swap·S-swapnull·QA-08·규칙 4**가 들어갔다(후속 라운드 2 제안 반영) |
| 파일 순서 | `…004680` → `…004690` → **`…004700_r15_drop_drafts`**(파괴, 마지막) |
| 커밋된 마이그레이션 무변경 | `git diff --stat HEAD -- supabase/migrations/` **비어 있음**, 미추적 새 파일은 `004690` 하나 |
| 생성 타입 | `gen types --local`과 **동일** |

### G-R6. 정리

- 내 사용자 2명(`qa-slot-a-*`·`qa-slot-b-*`)과 그 행을 전부 지웠다. 끝 상태: 사용자 0 · 정본 0 · 대화 0 · 작업 0 · 사용량 0 · 요건 0 · 지원 프로젝트 0. 내 것이 아닌 사용자는 없었다.
- `db reset`은 재확인 시작 때 **한 번** 썼다(수정된 `004690`을 파일에서 다시 적용하려고 — 공유 로컬 스택, UI 세션 허락 범위). "reset 없이 통과" 검사는 그 뒤에 잔여 행을 심고 따로 돌렸다.
- 작업 트리에 내 파일 0개. 원격 쓰기 0건.
