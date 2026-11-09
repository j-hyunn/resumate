# R15 요약 — 자기소개서 관리 영역 백엔드 (cover-letter-chat 11.8 + cover-letter-flow 11.10)

- 날짜: 2026-11-09
- 상태: **구현 완료 · QA 2라운드 통과 — Critical 0 · Major 0 · Minor 0** (열린 결함 없음). 커밋·원격 반영 전.
- 기준 판: DM v4.15 · AI v4.15 · UX v5.20 · PRD v4.17 / decisions 4.23 · DM 11.8 + 11.10
- 계획: `01_plan.md` · 담당 노트: `02_db-engineer_notes.md`·`02_api-engineer_notes.md`·`02_ai-pipeline-engineer_notes.md` · QA: `03_backend-qa_report.md`
- **원격 미반영.** 커밋 없음(이 요약을 쓴 시점).

## 무엇을 만들었나

### DB — 마이그레이션 18개 (`20261113003100` ~ `20261113004700`)
비파괴 17개 + **파괴 1개(마지막)**. 로컬 적용 완료, 타입 재생성 완료.

- `application_documents` 신설(`slot_count` 생성 컬럼, `document_kind` CHECK **`cover_letter` 1값**, `unique (application_project_id, document_kind)`, 복합 FK cascade, RLS, `app_ai_writer` **select만**). **`migration_note` 없음**(CF-M1).
- `writing_chats` 서류 대상 확장(`application_project_id`·`document_kind`, **`project_id` not null 해제**, 대상 배타 CHECK 교체).
- `ai_jobs` CHECK 2건 완화(서류 턴 `job_type`별 분기, `target_type = 'jd_preview'`), `career_description` in-flight 인덱스 삭제.
- `job_descriptions.source_url`(http(s)·≤ 2,048자), `application_projects (user_id, created_at desc)` 인덱스.
- RPC 신설: `save_application_document`(invoker, 반환 키 9개), `start_document_writing_chat`(definer), `private.doc_replace_slot_evidence`, `private.application_reset_name`.
- RPC 교체: `apply_structured_draft_patch`(서류 분기), `create_application_project`(**10인자 재생성, 옛 8인자 drop**), `apply_jd_extraction`(`deadline`), `private.application_compose_name`/`application_fallback_name`("{회사명} 자기소개서"), `start_writing_chat`(복귀 대상에서 `career_description` 제거), 삭제·탈퇴 4종, `evidence_links` 허용 출처 트리거.
- 미리 보기 정리 크론 규칙(미연결 `jd_preview`의 `output`·`step_outputs`를 24시간 뒤 비움).
- **파괴 `20261113004700_r15_drop_drafts.sql`**: 가드(네 대상 행 수, 하나라도 0이 아니면 `raise exception` — 메시지에 행 수만) → 옛 서류 RPC·트리거·헬퍼 drop → 테이블 3개 drop(자식→부모, `cascade` 없이) → `evidence_links_owner_type_check`에서 `draft_section` 제거 → 타입 재생성.

### API·서비스
- 신설 `POST /api/job-descriptions/fetch`(SSRF 차단·10초·2MB·리다이렉트 3회 홉마다 재검사·200자, `JobPosting` + 사이트별 처리·EUC-KR, 실패 코드 6종, **DB 쓰기·사용량 기록 0건**, 로그는 `host`·`code`·`bytes`·`elapsedMs`·`event` 5키만).
- 신설 `POST /api/job-descriptions/extract-preview`(행 없는 AI-01, `jd_preview` 작업 + 사용량 1행, **Q53-1 게이트 409면 작업 행 0건**).
- `normalizeJdRawText` 한 지점(생성·원문 수정·미리 보기가 같은 함수로 분할·해시·저장 원문).
- 서류 저장·대화 시작 액션, 턴 라우트 서류 분기(**새 SSE 이벤트 이름 0개** + `slot`·`questionNo`), 정리 크론 단계, `enums.ts` DB CHECK 1:1 대조.
- 폐기: `services/drafts/**`, 라우트 3개, `drafts-real.ts`, `jobs/drafts.ts`, `actions/draft.ts`, `drafts-sse.ts`, 거부 코드 `career_description_in_progress`, 고아 거부 코드 16개.

### AI 파이프라인
- AI-01: `schema_version` 1 → **2**, `deadline {value, source_sids}`, `ai-01.extract.v2`. 키 없는 옛 결과 통과.
- AI-04: `schema_version` 2 → **4**, `answer_title`(`draft_done`에만·글자 수·보정 제외·걸리면 제목만 버림), `ai-04.generate.v6`·`adjust.v6`. **v4.13 채팅형 전환이 미구현이어서 CL-* + CF-*를 동시 구현**(서류 턴 파이프라인 신설). 문항 ≤ 5 → 초안 턴 2회, 첫 턴 문구 2분기.
- **AI-03·AI-11 구현하지 않고 기존 코드 제거**(폐기).
- CL-Q1 제약 2개 준수: 팩 조립 한 지점(`buildCareerPack` 한 호출, 우회 조립 제거), 출처 별칭 유지.

## 검사 결과 (최종, QA 2라운드 뒤)
- typecheck **통과** · lint **통과**(경고 0) · Vitest **149파일 2,418건 통과** · pgTAP **64파일 2,613 단정 통과**
- 생성 타입 최신(`gen types --local` 바이트 동일) · **새 환경 변수 0건**
- 파괴 마이그레이션 가드 재현 성공(빈 상태 통과 / 1행에서 행 수만 담은 메시지로 중단) · 번호 마지막 확인
- **건너뜀**: 로그인 세션 붙인 HTTP 라우트 호출(서비스 계층을 실제 의존으로 대신 검증, 라우트는 401·404만), `pnpm build`(연결 단계 아님), 원격 `list_migrations`(미반영), **브라우저 미확인**

## QA
1라운드 **Critical 1 · Major 1 · Minor 4** → 전부 처리. 라운드 뒤 판정 1건 추가(`R15-API-7`) → 처리.
2라운드 재검사 **Critical 0 · Major 0 · Minor 1(QA-04 잔여)** → **리더가 수정해 닫았다**(아래). **최종 열린 결함 0건.**
- **QA-01 [Critical]** `begin_assistant_message`가 `job_type`을 `writing_chat_turn`으로 못 박아 **서류 대화 턴이 전부 500**이었다 → `004650`에서 `in ('writing_chat_turn','cover_letter')`로. `job_type`을 쓰는 함수 11개 전수 조사로 이 한 곳뿐임을 확인. **단위 테스트 2,398건이 가짜 `beginAssistant` 때문에 놓쳤다**(`332ec0c`와 같은 유형) → `document-chat.integration.test.ts` 신설로 재발 방지.
- **QA-02 [Major]** 턴이 만든 `error` 객체가 `ErrorEvent` 계약 미충족 + `as` 캐스팅 7곳이 타입 검사 우회 → 한 지점 재사용으로 전부 채우고 캐스팅 삭제. **와이어 모양은 `normalizeErrorEvent`가 재조립해 이미 정상이었다**(보고서 정정, 심각도 Major 유지). **캐스팅 제거가 별개 결함을 드러냈다**: AI-04 `sources_selected`가 snake_case인데 SSE 계약은 camelCase — 그대로면 **S-46 근거 칩이 하나도 파싱되지 않았다**.
- Minor 4: 고아 거부 코드 16개 삭제, R15 pgTAP 12쿼리를 픽스처 범위로, 노트 2건.
- **QA-04 (테스트 위생) — 리더가 마무리했다 (2026-11-09).** 2라운드에서 전역 `count(*)` 단정 3개가 남아, 다른 사용자의 잔여 행 하나에도 `run-checks.sh`가 깨지는 상태였다(공유 로컬 Supabase를 UI 세션과 함께 쓰므로 실제 비용이다). 셋 다 코드 결함이 아니라 테스트 위생 문제다:
  - `r15_document_writing_chat.test.sql` — 전역 `writing_chats where application_project_id is not null` → **픽스처 프로젝트 id로 좁혔다**.
  - `jd_extraction.test.sql` — `sweep_stalled_ai_jobs()`는 **DB 전체를 쓸고 그 수를 돌려주므로 `where`로 좁힐 수 없다** → `is(…, 1)` → **`ok(… >= 1)`**. 우리 작업이 실제로 닫혔는지는 바로 아래 `extraction_status` 단정이 확인한다.
  - `ai_usage_cost_backfill.test.sql` — 전역 `count(*) … where input_cost_usd = 0 and output_cost_usd = 0` → **픽스처 사용자로 좁혔다**.
  - **검증**: 다른 사용자(`auth.users` + `application_projects` + `writing_chats`(서류) + `ai_usage_records`)의 잔여 행을 실제로 심은 상태에서 `supabase test db` → **64파일 2,613 단정 통과**. 심은 행은 치웠다(로컬 DB 원상 복구 확인).
- **`R15-API-7`** `draft_count`가 `replace_draft` 연산마다 올라 5문항 자소서가 한 바퀴에 6회 중 5회 소모 → **리더 판정 "초안 턴당 1"**(AI C-14 "제안 단위 = 최대 3문항") → `004660`. 산출물·STAR 분기 미변경(회귀 방지).

## 보안 판정 (QA 1라운드, 전부 통과)
실제 resolver로 14주소 차단 확인(`169.254.169.254`·`127.0.0.1`·`localhost`·`LOCALHOST.`·`[::1]`·`[::]`·`0.0.0.0`·`2130706433`·`0177.0.0.1`·`[::ffff:127.0.0.1]` 등), `file:`/`gopher:`/자격증명 URL 거부, 파싱 실패 fail closed, **홉마다 재검사**, 쉬운 우회 경로 없음 · 로그 키 5개·경로·쿼리 없음 · 생성 RPC가 보낸 해시를 쓰지 않고 `extensions.digest`로 재계산(위조 차단) · RLS 교차 사용자 격리, `app_ai_writer`는 select만, `source_url` 컬럼 grant 제외.

**남는 제약 2건** (문서화됨, 결함 아님):
- `R15-API-5` URL 가져오기 요청 제한이 프로세스 안 슬라이딩 윈도(10회/60초)라 **Vercel에서 람다마다 따로 센다** — 실질 상한이 아니다. 기획이 수치를 `[가정: 수치]`로 비워 둔 자리(2.9.4). 진짜 상한은 엣지 미들웨어나 DB/KV 카운터가 필요하다.
- `R15-API-6` `fetch`가 소켓 주소 훅을 주지 않아 **DNS 리바인딩 창이 남는다**(`ssrf.ts` 주석에 명시). 현실적 경로인 `Location:` 우회는 홉마다 재검사가 막는다.

## 기획 결정·정정 (이 슬라이스에서 올린 것)
사용자 결정 대기로 **0건**이 남았다. 올린 3건 모두 닫혔다.
- **CF-S1** (사용자, 2026-11-09) — 슬롯 근거 저장 원천 누락(`R15-AI-2`). `replace_draft`에 `sources[]`를 실어 저장, 적용 제안 있는 슬롯만 교체, `role` 미저장, 화면은 `sources` 미전송. 구현·pgTAP 16건·Vitest 8건 반영.
- **R15-DB-8** (문장 정정) — DM §2.6.1 조건 5가 폐기될 `draft_sections.ai_content`를 읽고 있었다 → 절 삭제. 자소서만 쓴 JD는 공고 원문 수정 허용(JD 근거가 있으면 세 번째 절이 막는다). `[가정]` 해제.
- **CF-S3** (문장 정정) — DM 2.5.1의 "저장하기만 누른 경우" 문장이 CF-S3와 어긋남을 지적 → 취소선 + CF-S3 문장으로 교체. **RPC 그대로 두는 판단이 정본이 됐다.**

**⚠ 문서 반영은 PR #68(미머지)에 있다** — 이 워크트리 `docs/planning/`에는 CF-S1·CF-S2·CF-S3·R15-DB-8이 **없다**. `decisions.md`의 결정 기록이 구현의 정본이다. **PR #68 머지 뒤 DM 2.5.0b·2.5.1·2.6.1·2.8·AI-04·UX S-46을 구현과 대조할 것.**

## 리더 판정 (`decisions.md` 2026-11-09)
1. 옛 서류 코드 폐기와 UI 화면의 순서 충돌 — 백엔드 소유분만 폐기, `drafts.ts`를 mock 전용 `// 연결 대기`로, 화면 삭제는 UI 요청.
2. `R15-L1` AI-04 프롬프트 `v6`(기획은 v7로 적었으나 현행이 v5였다 — 4.23이 확인을 위임).
3. `R15-L2` 서류 턴 SSE는 새 이름 없이 기존 payload에 `slot`·`questionNo`.
4. 블록 `review` 강제는 DB 범위가 아니다 — DM §2.5.0b "DB의 V-10 방어 범위"·§2.5.0a R5-DB-6. 출처는 3종이고 `evidence[]`만 보면 **이어 쓰기 블록**이 전부 수락을 요구하게 된다. → `004600`에서 제거.
5. `R15-API-7` `draft_count`는 초안 턴당 1.
6. CF-S1 번호 판단 — 출력 `schema_version` 4·`ai-04.generate.v6` 유지(`sources[]`는 이미 스키마에 있던 값, 올리면 `input_hash` 재사용만 잃는다).

## 연결(Wiring) — 하지 않았다
UI(S-13·S-14 모달·S-46)가 아직 없으므로 `src/lib/data/`의 서류 함수는 **전부 `// 연결 대기`**다. 처리한 것: `drafts.ts` mock 전용 복귀(export 이름·시그니처 유지), `deletion.ts` 영향 키, `labels.ts`에서 "AI 근거 선택" 제거, `types/db.ts`에 `application_documents` 재수출.

### UI 소유 파일 수정 (Minimal UI edits)
`src/lib/data/drafts.ts`(mock 전용 복귀 — preview/mock 스위치), `deletion.ts`, `labels.ts`, `types/db.ts`.

리더가 커밋 전에 확인한 추가 2건(둘 다 계약 변경 때문에 **없으면 typecheck가 깨지는** 최소 변경, 문구·배치 변경 없음):
- `src/components/common/delete-confirm-dialog.tsx` — 삭제 영향 키 `d.drafts` → **`d.documents`**(2곳). 화면 문구("서류 {n}", "초안 {n}")는 **그대로** 두었다. 키 이름만 따라간 것이고 표시 바꾸기는 UI 요청으로 남는다.
- `src/lib/mock/fixtures.ts` — mock JD 행에 **`source_url: null` 한 줄** 추가(새 컬럼이 타입에 들어와서). mock은 UI 소유이고 이 한 줄 외에는 손대지 않았다.

### UI 요청 (resumate-ui)
- 옛 서류 화면·컴포넌트 삭제(S-17·S-19, `drafts-view`·`draft-editor`·`sources-used`·`source-tree`·`cover-letter-questions`)와 옛 주소 → S-46 리다이렉트.
- S-13·S-14 2단계 모달·S-46 신설 뒤 **연결 단계 1회** 필요.
- `src/lib/mock/`에 `application_documents` 없음(삭제 영향 미리 보기가 옛 mock으로 셈).
- `user_note` 근거 라벨은 `source_id`가 `body.questions[].question_id`라 조인 불가 → S-46에서 문항 문구 조립(`R15-API-4`).
- `drafts.ts`·픽스처는 drop 커밋과 같은 머지에서 걷되 **`retryJdExtraction`·`runJdExtraction`은 보존**(JD 추출, S-15·D-30).

## 릴리스 영향
- **배포 순서**: 비파괴 17개 push → **코드 배포** → **파괴 `004700` push**(코드 배포 뒤여야 한다. 먼저 가면 옛 코드가 없는 테이블·RPC를 부른다).
- **비파괴가 원격에 가기 전에 코드만 머지하면** 서류 저장·대화·미리 보기가 원격에서 404/500이 된다.
- **UI와 같은 릴리스로 묶어야 한다** — 옛 서류 화면이 아직 남아 있고(UI 요청), 새 화면이 없으면 서류 기능에 도달할 경로가 없다.
- **되돌릴 수 없는 작업 2개(사용자 승인 대기)**: ① 테이블 3개 drop ② `writing_chats.project_id` not null 해제(코드 배포 뒤 복구는 사용자 데이터 삭제가 된다). `ai_jobs` CHECK 원복은 서류 작업 행 90일 보관 때문에 최소 90일 잠긴다.
- **새 환경 변수 없음.**
- **출시 전 법무 확인(사용자 몫)**: 사람인·잡코리아 이용약관의 자동 수집 제한(CF-10, PRD NFR-PRV-12).

## QA 2라운드 — 검증된 것 (`03_backend-qa_report.md` "라운드 2")
- 1라운드 6건 + `R15-API-7`이 **코드·DB·실행으로** 닫힌 것 확인. QA-01의 "여기 하나뿐"은 QA가 `prosrc like '%job_type%'`인 함수 11개를 다시 열어 **전수 재확인**했다.
- **회귀 4항목 통과**: 산출물 대화의 `draft_count`는 여전히 연산당(`wc_patch_deliverable`의 증가가 루프 안), STAR에는 그 값이 없다 / 고아 코드 삭제 부작용 없음 / 턴·라우트의 `as` 캐스팅 0건(`sse.ts`의 4건은 제네릭 작성기의 구조적 캐스팅으로 계약 우회가 아니다) / `004650` < `004660` < `004700`이고 파괴가 파일·적용 순서 양쪽에서 마지막.
- **초안 턴 독립 스모크 통과**(1라운드 미도달 자리): 이벤트 순서에 **새 이름 0개**, 전부 `DocumentTurnEventSchema` 통과, `sources_selected` camelCase 변환, 별칭 `PRJ-1`이 실제 uuid로 풀려 **근거가 비지 않음**, CF-S1 슬롯 근거 저장, `answer_title` 일치, **DB가 `value`를 블록으로 재조립**, `draft_count` 1, 로그에 키·본문 0건.
- 부수 확인(가드가 실제로 돈다는 증거): 팩에 없는 별칭은 V-1이 버리고, 근거 없는 숫자는 V-5가 치환하며 그 숫자가 제목에 있으면 **제목만 버린다**.
- **추가 회귀 단정 1건 반영**(QA 제안, 리더): `document-chat.integration.test.ts`에 `sources_selected` 와이어 **키**에 밑줄이 없음을 단정(값의 밑줄은 정상이므로 키만 본다).

## 열린 것
- **커밋 없음.** 다음 세션에서 커밋하고 **UI 세션(`local_7e541d52-ee4e-4af3-80cf-76a09ca1a5e1`)에 알릴 것** — 그쪽이 브랜치를 병합해 타입·계약을 받고 실제 경로로 전환한다. 그쪽 `pnpm test` 17건 실패는 공유 로컬 Supabase + 옛 계약 때문이고 머지로 해소된다.
- **PR 미제출**(사용자 확인 뒤).
- **원격 미반영**(파괴 단계는 사용자 승인 대기).
- **브라우저 미확인.**
