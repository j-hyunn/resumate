# R15 릴리스 체크리스트 — 자기소개서 관리 백엔드

- 작성: 2026-11-09 (리더)
- 대상: 슬라이스 **R15**, 커밋 `dba1bff`, PR **#69** (`claude/cover-letter-backend-ef4d68` → `main`)
- 원격 Supabase: `resumate` (ref `rxtnguarpotkcgdazkbw`, ap-northeast-2, Free, **운영 겸용 단일 프로젝트**)
- Vercel: `resumate` (팀 jhyunn) — **main 병합 = 운영 배포**
- 요약: `04_summary.md` · QA: `03_backend-qa_report.md` · 결정: `_workspace/backend/decisions.md` 2026-11-09 항목

> **이 문서는 준비물이다. 원격 쓰기(`supabase db push`)와 main 병합은 사용자가 실행한다.**

## 0. 원격 대조 결과 (읽기 전용, 2026-11-09)

Supabase MCP `list_migrations`로 확인했다.

| 항목 | 값 |
|------|-----|
| 원격 적용 마이그레이션 | **143개**, 마지막 `20261113003000_r14_remove_mock_interview` |
| 로컬 파일 | **161개** |
| 원격에 없는 것 | **18개 — 전부 R15** (`20261113003100` ~ `20261113004700`) |
| 번호 순서 | **문제 없음.** R15 18개가 모두 원격 마지막(`20261113003000`)보다 **뒤 번호**다. 재번호·`--include-all` 불필요 |
| 파괴 파일 위치 | `20261113004700_r15_drop_drafts.sql` — **R15 안에서도 마지막 번호**(의도된 배치) |

번호 참고: `004500`이 비어 있다. 처음 파괴 파일이 `004500`이었는데 QA 수정 2건(`004650`·`004660`)이 그보다 뒤에 와야 해서 파괴를 `004700`으로 옮겼다. 빈 번호는 문제가 되지 않는다.

## 1. push 순서 — **두 단계로 나눈다**

### 1단계: 비파괴 17개 (지금 올려도 된다)

`20261113003100` ~ `20261113004660`. 아래 순서는 파일 번호 순이고 `db push`가 그대로 따른다.

| # | 파일 | 내용 | 파괴 |
|---|------|------|------|
| 1 | `003100_r15_application_documents` | `application_documents` 신설(+`slot_count` 생성 컬럼·RLS·grant) | 아니다 |
| 2 | `003200_r15_writing_chats_document_target` | `writing_chats` 서류 대상 확장, **`project_id` not null 해제**, CHECK·트리거 교체 | 아니다 (단 2.의 되돌림 주의) |
| 3 | `003300_r15_ai_jobs_checks` | `ai_jobs` CHECK 완화(서류 턴 `job_type` 분기, `jd_preview`), `career_description` in-flight 인덱스 삭제 | 아니다 (단 2.의 되돌림 주의) |
| 4 | `003400_r15_job_descriptions_source_url` | `source_url` 컬럼 추가(기존 행 null) | 아니다 |
| 5 | `003500_r15_application_projects_created_at_index` | `(user_id, created_at desc)` 인덱스 | 아니다 |
| 6 | `003600_r15_evidence_links_application_document` | `owner_type`에 `application_document` 추가, 허용 출처 함수 일원화 | 아니다 |
| 7 | `003700_r15_application_document_rpcs` | `save_application_document`·`start_document_writing_chat` + 헬퍼 2개 | 아니다 |
| 8 | `003800_r15_structured_draft_patch_document` | 패치 RPC 서류 분기 | 아니다 |
| 9 | `003900_r15_application_name_rules` | 이름 조립 "{회사명} 자기소개서" | 아니다 |
| 10 | `004000_r15_jd_extraction_deadline` | `apply_jd_extraction`의 `deadline` + 내부 함수 분리 | 아니다 |
| 11 | `004100_r15_create_application_project_preview` | 생성 RPC **10인자 재생성**(옛 8인자 drop) | 아니다 (함수 교체) |
| 12 | `004200_r15_start_writing_chat_return_target` | 복귀 대상에서 `career_description` 제거 | 아니다 |
| 13 | `004300_r15_deletion_rpcs_documents` | 삭제·탈퇴 4종 교체 | 아니다 |
| 14 | `004400_r15_purge_unused_jd_previews` | 미리 보기 정리 크론 규칙 | 아니다 |
| 15 | `004600_r15_document_block_review` | 블록 `review` 강제 제거(리더 판정) | 아니다 |
| 16 | `004650_r15_begin_assistant_message_document_turn` | QA-01 수정 — 서류 턴 `job_type` 허용 | 아니다 |
| 17 | `004660_r15_document_draft_count_per_turn` | `draft_count` 초안 턴당 1 | 아니다 |

### — 여기서 **코드 배포**(PR #69 머지) —

**비파괴 17개가 원격에 들어간 뒤에 머지해야 한다.** 먼저 머지하면 코드가 없는 테이블·RPC(`application_documents`, `save_application_document` 등)를 불러 서류 저장·대화·미리 보기가 운영에서 404/500이 된다.

### 2단계: 파괴 1개 (**코드 배포가 끝난 뒤**)

`20261113004700_r15_drop_drafts.sql` — **별도로 push한다.** 먼저 가면 아직 살아 있는 옛 코드가 없는 테이블·RPC를 부른다(R14와 같은 이유).

## 2. 파괴 마이그레이션 — 사용자 확인이 필요한 내용

**파일**: `20261113004700_r15_drop_drafts.sql` (첫 줄 `-- DESTRUCTIVE:`, 한 트랜잭션)

**무엇이 사라지나**
1. 테이블 **3개 drop**: `drafts` → `draft_sections` → `draft_section_sources`(자식 → 부모 순, `cascade`는 쓰지 않는다 — 예상 밖 의존이 있으면 멈추는 편이 안전). 그 RLS 정책·grant·트리거·인덱스가 함께 사라진다.
2. 옛 서류 결과·문항 **RPC·트리거·헬퍼 drop**(`begin`/`complete`/`fail_career_description`, `begin`/`complete`/`fail_cover_letter`, 자소서 문항 사용자 RPC 일괄, `ai_jobs_release_drafts`, `draft_sources_mark_*`, `draft_source_label`, `draft_source_parent_name`, `backfill_education_display_labels`). **`private.education_display_name`·`trim_js_whitespace`는 남긴다.**
3. `evidence_links_owner_type_check`를 drop → add로 다시 걸어 **`draft_section`을 뺀다**(최종 `insight`·`chat_message`·`application_document`).

**지우는 사용자 데이터: 0행.**
- 근거: 2026-11-08 운영 DB **읽기 전용** 확인 — `drafts`·`draft_sections`·`draft_section_sources` **0행**, `evidence_links`(`owner_type = 'draft_section'`) **0행**(사용자 1명, 지원 프로젝트 0건). 이것이 **CF-M1**(이관 없이 정리) 확정의 근거다(`docs/planning/decisions.md` 1장).
- **마이그레이션 안의 가드가 push 시점에 다시 센다.** 네 대상 중 하나라도 0이 아니면 `raise exception`으로 **멈춘다**(아무것도 지우지 않는다). 메시지에는 **테이블별 행 수만** 담기고 값·id는 남기지 않는다.
- 가드 동작을 로컬에서 재현해 확인했다: 빈 상태 통과 / `drafts` 1행에서
  `ERROR: r15_drop_drafts: old document rows still exist (drafts=1, draft_sections=0, draft_section_sources=0, evidence_links[draft_section]=0)`.

**되돌릴 수 있나**: **스키마는 되돌릴 수 없다**(복구하려면 옛 마이그레이션 정의로 빈 테이블·함수를 다시 만들어야 한다). **데이터 손실은 없다**(0행).

**가드가 멈추면**: 1단계와 코드는 그대로 둔다(옛 테이블은 쓰이지 않을 뿐 남는다). 그 행으로 이관을 **다시 계획**한다 — 기준은 CLA-Q3 (a)(확정 2026-11-08, 사용자: 고르지 않은 나머지 초안 행은 보관, 블록 없는 문항 메타는 정본 슬롯으로 이관), 출발점은 DM 2.7.4 대응표와 v4.13a 이관 설계. **이 판에서는 실행하지 않는다.**

## 3. 되돌릴 수 없는 지점 (사용자가 알고 넘어가야 할 것)

| # | 지점 | 되돌림 창 | 창이 닫히면 |
|---|------|-----------|-------------|
| 1 | `writing_chats.project_id` **not null 해제**(1단계 #2) | **코드 배포 전까지.** 그 전에는 not null + 옛 CHECK 3개를 원복하면 완전히 되돌아간다 | 서류 대화 행이 생기므로 not null 복구는 **그 행을 지워야만** 성립한다 = **사용자 데이터 삭제** |
| 2 | `ai_jobs` CHECK 완화(1단계 #3) | **코드 배포 전까지** | 서류 `job_type` + `target_type = 'writing_chat'` 작업 행이 생기고 `ai_jobs`는 **90일 보관**이라 최소 90일 되돌릴 수 없다 |
| 3 | 패치 RPC 교체(1단계 #8) 뒤 `structured_draft`에 써 넣은 **서류 모양 jsonb** | — | 함수를 되돌려도 그 jsonb는 남는다. 되돌림 계획에 그 처리를 함께 적어야 한다 |
| 4 | **2단계 drop** | — | 스키마는 되돌릴 수 없다. 지우는 행은 0이다(가드) |

## 4. 새 환경 변수

**없다.** 공고 URL 가져오기는 외부 키를 쓰지 않는다(AI를 호출하지 않는다 — CF-A16). Vercel 설정 변경 불필요.

## 5. UI와 함께 가야 하는가 — **그렇다**

- 옛 서류 화면 **S-17·S-19가 아직 코드에 남아 있다**(삭제는 UI 몫 — `04_summary.md` "UI 요청"). R15는 백엔드 소유분만 폐기하고 `src/lib/data/drafts.ts`를 mock 전용 `// 연결 대기`로 되돌려, 옛 화면이 `?state=` 미리 보기로만 컴파일되게 했다.
- **새 화면(S-13 목록·S-14 2단계 모달·S-46 작성 화면)이 없으면 서류 기능에 도달할 경로가 없다.** `src/lib/data/`의 서류 함수는 전부 `// 연결 대기`다.
- 자소서 UI 세션(`local_7e541d52-ee4e-4af3-80cf-76a09ca1a5e1`, worktree `cover-letter-ui-469976`)이 그 화면과 연결을 작업 중이다. **그쪽 PR과 함께 머지하는 편이 안전하다.**
- 기획 문서 반영(**CF-S1·CF-S2·CF-S3·R15-DB-8**)은 **PR #68(미머지)** 에 있다. 코드는 `decisions.md`의 결정 기록을 정본으로 구현했으므로, #68이 머지되면 DM 2.5.0b·2.5.1·2.6.1·2.8·AI-04·UX S-46을 구현과 대조해야 한다.

## 6. 사용자가 실행할 명령

### ⚠ 실행 위치 — **이 워크트리에서 해야 한다** (2026-11-09 확인)

| 위치 | 상태 |
|------|------|
| `/Users/jehyun/Resumate` (본 체크아웃) | 브랜치 `main`, **R15 마이그레이션 0개** — 여기서 push하면 **아무것도 올라가지 않는다** |
| `/Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68` | R15 18개가 여기 있다 → **여기서 push한다** |

**또는 PR #69를 먼저 머지한 뒤 본 체크아웃에서 push한다** — 다만 그러면 "비파괴 push → 코드 배포" 순서가 깨진다(머지 = 운영 배포). **그래서 이 워크트리에서 1단계를 먼저 올리는 쪽을 권한다.**

또 `supabase/.temp/project-ref`가 **어느 쪽에도 없다**(링크 상태 미저장) → `db push` 전에 링크가 필요하다.

```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && supabase link --project-ref rxtnguarpotkcgdazkbw
```

### 1단계 (비파괴 17개)

**먼저 파괴 파일을 잠시 빼낸다** — `db push`는 미적용 파일을 **전부** 올리므로, 빼내지 않으면 파괴 파일이 코드 배포 전에 함께 올라간다.

```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && mv supabase/migrations/20261113004700_r15_drop_drafts.sql /tmp/20261113004700_r15_drop_drafts.sql.hold
```

```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && supabase db push
```

DB 비밀번호를 직접 입력한다.

### — 코드 배포: PR #69 머지 (UI PR과 함께 — 5. 참조) —

### 2단계 (파괴 1개, **코드 배포 뒤 + 사용자 확인 뒤**)

빼냈던 파일을 되돌린다.

```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && mv /tmp/20261113004700_r15_drop_drafts.sql.hold supabase/migrations/20261113004700_r15_drop_drafts.sql
```

```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && supabase db push
```

> 머지 뒤라면 본 체크아웃(`/Users/jehyun/Resumate`, `main`)에도 R15 파일이 들어오므로 거기서 push해도 된다. 그 경우 위의 빼내기·되돌리기 대신 **본 체크아웃에서 파괴 파일만 남은 상태**가 되므로 바로 `supabase db push`면 된다(1단계가 이미 적용됐으므로 파괴 1개만 올라간다).

### 적용 확인

```bash
supabase migration list
```

## 7. 1단계 결과 — **적용 완료 2026-11-09**

사용자가 권한을 허용해 리더가 `supabase db push`를 실행했다(이 워크트리에서, 링크는 `supabase link --project-ref rxtnguarpotkcgdazkbw`로 먼저 걸었다 — 비밀번호를 묻지 않았다). **파괴 파일은 빼낸 상태로 올렸고 push 뒤 복원했다**(작업 트리 clean, 161개).

| 항목 | 결과 |
|------|------|
| 적용 | **비파괴 17개 전부 성공** (`20261113003100` ~ `20261113004660`). 오류·롤백 없음 |
| `list_migrations` (MCP, 읽기 전용) | 원격 **160개**, 마지막 **`20261113004660_r15_document_draft_count_per_turn`**. R15 17개가 모두 올라갔고 **`20261113004700`(파괴)만 미적용** — 의도한 상태 |
| `get_advisors` security | **WARN 18 + INFO 1.** 새 항목은 **`start_document_writing_chat` 1건**(authenticated가 부를 수 있는 SECURITY DEFINER — 다른 두 시작 RPC와 **같은 설계**이고 함수 안에서 소유자를 검사한다). `create_application_project`는 10인자로 바뀌어 같은 항목이 다시 잡혔다(기존 항목). `account_deletion_logs` 정책 없음(INFO)은 service role 전용으로 의도대로. **설계 밖 신규 지적 0건** |
| 그중 2단계가 없앨 것 | 18건 중 **5건이 옛 서류 RPC**(`add_cover_letter_question`·`create_cover_letter_draft`·`delete_cover_letter_question`·`reorder_cover_letter_questions`·`set_section_sources`)다 → 파괴 단계 뒤 **13건으로 줄어든다** |
| `get_advisors` performance | **INFO만**(unindexed FK 34 · unused index 34). WARN 이상 없음. R15가 더한 인덱스(`application_documents_user_id_idx`·`writing_chats_application_document_last_activity_idx`·`application_projects_user_id_created_at_idx`)가 "unused"로 잡히는 것은 **기능이 아직 화면에 붙지 않아 쿼리가 없기 때문**이고 정상이다 |
| Auth 쪽 WARN 2건 | `auth_leaked_password_protection`·`auth_insufficient_mfa_options` — **R15와 무관**하고, 로그인이 Google 단일(D-09)이라 비밀번호 인증 경로가 없어 이 앱 흐름에는 해당하지 않는다. 기록만 남긴다 |

## 8. 남은 확인 (2단계 뒤에 수행)

- [ ] 코드 배포(PR #69 머지, UI PR과 함께 — 5. 참조)
- [ ] 2단계 파괴 push — **사용자 확인 뒤.** 가드가 멈추면 2.의 "가드가 멈추면" 절차
- [ ] `list_migrations` — 마지막이 `20261113004700`
- [ ] `get_advisors` — SECURITY DEFINER WARN이 **18 → 13**으로 줄었는지(옛 서류 RPC 5건 drop 확인), 새 항목 없는지
- [ ] Vercel 배포 상태와 런타임 오류(읽기 전용)
- [ ] `slices.md`의 R15 "원격" 열에 2단계 날짜 기록

## 8. 아직 하지 않은 것

- **원격 미반영**(이 문서 작성 시점)
- **브라우저 미확인** — 서류 작성 화면이 없으므로 UI 세션의 화면이 붙은 뒤에 가능하다
- **출시 전 법무 확인(사용자 몫)**: 사람인·잡코리아 이용약관의 자동 수집 제한(CF-10, PRD NFR-PRV-12)
- 남는 제약 2건(결함 아님, 코드 주석·`spec-gaps.md`): URL 가져오기 요청 제한이 프로세스 안 슬라이딩 윈도라 **Vercel에서 람다마다 따로 센다**(기획이 수치를 `[가정: 수치]`로 비워 둔 자리) · `fetch`가 소켓 주소 훅을 주지 않아 **DNS 리바인딩 창이 남는다**

## 9. 갱신 (2026-11-09) — 1단계 뒤 생긴 비파괴 2개 + 결정 대기 1건

1단계(비파괴 17개)를 원격에 올린 뒤, UI 세션이 실제 경로를 연결하면서 서버 읽기 공백 4건을 찾았다. 그 4건을 고치면서 **원격에 아직 없는 비파괴 마이그레이션 2개**가 생겼다. 둘 다 **코드 배포 전에 push**해야 한다.

| # | 파일 | 내용 | 파괴 | 왜 코드보다 먼저인가 |
|---|------|------|------|---------------------|
| 18 | `20261113004670_r15_document_write_guard_and_copy` | ① **직접 쓰기 차단 트리거**(`application_documents`) ② 첫 복사 RPC `mark_application_document_copied` ③ `updated_at` 트리거 교체(복사만 한 update는 `updated_at` 불변) | 아니다 | 새 코드의 `markApplicationDocumentCopied`가 이 RPC를 부른다. 가드는 `src/`에 직접 쓰기 호출이 0건이라(QA 확인) 먼저 올라가도 기존 코드가 깨지지 않는다 |
| 19 | `20261113004680_r15_policy_versions_cf1` | 법무 3종(terms·privacy·ai_data_use) **2026-11-09판** 행, `requires_reconsent = false` (CF-S6) | 아니다 | UI 소유 `src/components/account/policy-content.ts`와 **같은 머지** — 아래 ⚠ 참조 |

**⚠ 화면이 잠깐 어긋나는 구간**: `004680`은 코드 배포 전에 올라가고 본문(`policy-content.ts`)은 머지 때 나간다. 그래서 **push부터 머지까지는 S-30 머리글이 새 시행일(2026-11-09)인데 본문은 옛 판**이다. R14와 같은 구간이다 → **push 직후 바로 머지한다.** 재동의는 생기지 않는다(세 행 모두 `requires_reconsent = false`, pgTAP로 확인 — 옛 판 동의자의 필수 `needs_consent` 0건).

**⏳ 결정 대기 — UQ-741**: 서류 저장 RPC가 기대 버전이 null이면 기존 정본을 덮어쓴다. DM §2.5.1 공통 규칙에 적힌 계약이라 백엔드가 바꾸지 않고 기획 세션에 넘겼다(권고 (a): 서류 RPC만 "행이 있는데 null이면 `stale_write`"). **확정되면 새 비파괴 마이그레이션 1개가 더 생긴다**(`004690` 자리, 파괴보다 앞). **두 PR 머지는 이 건이 정리된 뒤에 한다.**

### 갱신된 전체 순서

1. ~~1단계: 비파괴 17개~~ — **완료 2026-11-09**
2. **1.5단계: 비파괴 `004670`·`004680`** (+ UQ-741이 확정되면 그 파일) — 파괴 파일을 빼낸 상태로 `db push`
3. **코드 배포**: PR #69 + UI PR **함께 머지** (`004680` push 직후)
4. **2단계: 파괴 `004700`** — 코드 배포 뒤, **사용자 확인 뒤**

### 1.5단계 명령

링크는 이미 걸려 있다(2026-11-09, 이 워크트리). 1단계와 같은 절차다.

```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && mv supabase/migrations/20261113004700_r15_drop_drafts.sql /tmp/20261113004700_r15_drop_drafts.sql.hold
```

```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && supabase db push
```

```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && mv /tmp/20261113004700_r15_drop_drafts.sql.hold supabase/migrations/20261113004700_r15_drop_drafts.sql
```

### 1.5단계 뒤 확인 (읽기 전용)
- [ ] `list_migrations` 마지막이 `20261113004680`(UQ-741 파일이 들어가면 그 번호)
- [ ] `get_advisors` security — 새 RPC `mark_application_document_copied`는 **security invoker**라 SECURITY DEFINER WARN에 **새로 잡히지 않아야** 한다. 18건 그대로인지 본다
- [ ] 2단계 뒤에는 SECURITY DEFINER WARN이 18 → 13으로 준다(옛 서류 RPC 5건 drop)

### 후속 QA 결과 (2026-11-09)
Critical 0 · Major 0 · Minor 0 — **열린 항목 없음**. 쓰기 가드는 실제 PostgREST 경로로 15가지 공격을 막았고(직접 insert·update·upsert·`set_config` 호출·`pg_catalog` 경유·GraphQL 없음), 플래그가 RPC 밖으로 새지 않는다. pgTAP **65파일 2,658**, Vitest **150파일 2,429**, typecheck·lint 통과.

### 갱신 2 (2026-11-09) — 비파괴 1개 추가: `004690`

| # | 파일 | 내용 | 파괴 | 왜 코드보다 먼저인가 |
|---|------|------|------|---------------------|
| 20 | `20261113004690_r15_document_save_null_expected` | ① **CF-S7**(사용자 확정): 정본 행이 있는데 기대 버전 null이면 `stale_write` — 서류 RPC만 ② **슬롯 번호 재사용 금지**: 컬럼 `slot_high_water` + 슬롯 정체를 번호·`question_id`로 판정(QA-07) ③ 지운 슬롯 제안을 반영됨으로 기록하지 않음(QA-08) ④ 패치 RPC가 다음 초안에서 `question_id` 갱신 | 아니다(컬럼 추가 + 함수 교체, 기존 행 `slot_high_water` 백필 — 원격에 서류 행 0이라 실질 영향 없음) | 새 코드의 저장 반환이 `slot_high_water`(11키)를 기대한다. 옛 코드는 아직 서류를 저장하지 않으므로 먼저 올라가도 깨지는 것이 없다 |

**1.5단계 갱신**: 비파괴 **`004670`·`004680`·`004690`** 세 개를 파괴 파일을 빼낸 상태로 한 번에 push한다. 확인 기준도 바뀐다 — `list_migrations` 마지막이 **`20261113004690`**.

**후속 라운드 2 QA (2026-11-09)**: Critical 0 · Major 0 · Minor 0 — **R15 열린 항목 없음**. CF-S7 동시 첫 저장 25회 독립 재현(매번 성공 1·`stale_write` 1, 500 0건), 기대 버전 우회 시도 전부 실패, 슬롯 S-swap·S-swapnull 재현 후 닫힘, `draft_done.draft`가 보정 후 저장본과 일치. pgTAP **66파일 2,708**, Vitest **150파일 2,432**, typecheck·lint 통과(잔여 행 심은 상태, reset 없이).

## 10. 원격 반영 준비 완료 (2026-11-09) — 머지 당일 절차

### 지금 원격 상태 (읽기 전용 확인)
- `list_migrations` 마지막 **`20261113004660`** — 1단계 17개 적용 그대로, 변동 없음.
- **dry-run**(`supabase db push --dry-run`, 파괴 파일을 빼낸 상태): **정확히 3개**가 올라갈 예정이다.
  - `20261113004670_r15_document_write_guard_and_copy`
  - `20261113004680_r15_policy_versions_cf1`
  - `20261113004690_r15_document_save_null_expected`

  파괴 `004700`은 빠져 있다. dry-run 뒤 파일을 복원했고 작업 트리는 clean이다.

### 왜 지금 push하지 않고 머지 직전에 한 번에 하는가
1. **`004680`(법무 2026-11-09판) 때문이다.** 이 파일은 적용 즉시 현재 판이 된다(시행일 2026-11-09 00:00 KST가 이미 지났다). 그런데 본문(`policy-content.ts`)은 UI PR 머지 때 나간다. 지금 올리면 **UI PR이 준비될 때까지 S-30 머리글은 새 시행일인데 본문은 경력기술서가 남은 옛 판**이 된다.
2. **번호 순서상 나눠 올릴 수 없다.** `004670`·`004690`만 먼저 올리면, `004680`이 원격의 마지막 적용분(`004690`)보다 **앞 번호**가 된다. 그러면 `db push`가 거부하거나 `--include-all`이 필요하다(backend-context "Conventions"). 셋을 한 번에 올리는 게 가장 단순하다.
3. **세 파일 모두 옛 코드에 영향이 없다.** 그래서 머지 직전에 올려도 안전하다. 옛 코드는 `application_documents`를 쓰지 않는다(QA 확인: `src/`의 직접 쓰기 0건). 옛 서류 화면은 mock 전용이다.

### 머지 당일 순서 (UI PR이 준비된 뒤)
1. **비파괴 3개 push.** 이 워크트리에서 하고, 링크는 이미 걸려 있다.
   ```bash
   cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && mv supabase/migrations/20261113004700_r15_drop_drafts.sql /tmp/20261113004700_r15_drop_drafts.sql.hold
   ```
   ```bash
   cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && supabase db push
   ```
   ```bash
   cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && mv /tmp/20261113004700_r15_drop_drafts.sql.hold supabase/migrations/20261113004700_r15_drop_drafts.sql
   ```
2. **확인(읽기 전용, 리더).**
   - `list_migrations`의 마지막이 `20261113004690`인지 본다.
   - `get_advisors` security에서 SECURITY DEFINER WARN이 **18건 그대로**여야 한다. 새 RPC `mark_application_document_copied`는 invoker이고, 새 definer 헬퍼 `private.doc_proposal_question_id`는 노출되지 않는 `private` 스키마에 있다.
3. **곧바로 두 PR 머지**(#69 + UI PR) = 운영 배포. 이 순간 `writing_chats.project_id` not null 해제와 `ai_jobs` CHECK 완화의 **되돌림 창이 닫힌다**(3절).
4. Vercel 배포 상태와 런타임 오류를 확인한다(읽기 전용).
5. **파괴 `004700` push** — **사용자 확인 뒤.**
   - 가드가 지우는 행 수를 다시 센다. 지금은 0행이다.
   - push 뒤 SECURITY DEFINER WARN이 **18 → 13**으로 줄었는지 본다(옛 서류 RPC 5건 drop).

### 머지 전에 남은 것
- **UI PR 준비.** UI 세션이 실제 경로 연결·AI 패널·UI QA·브라우저 확인을 진행 중이다.
- **기획 회부 1건 — 저장하지 않은 새 문항의 AI 초안.** 머지 조건은 아니다. (a)·(c)로 정해지면 UI 변경뿐이고, (b)로 정해지면 별도 백엔드 슬라이스가 된다.

## 11. 1.5단계 원격 반영 — **비파괴 2개 완료 2026-11-10**

**승인**: 사용자가 이 세션에서 직접 승인했다. "권장대로" → 번호 이동과 2개 push, 첫 시도가 권한 분류기에 막힌 뒤 "권한 허용하고 다시". Head 세션이 전한 "올려"는 운영 쓰기의 근거로 쓰지 않았다(세션 간 메시지는 사용자 승인이 아니다).

**번호 이동 (`3896ca9`)**: 법무 판 `20261113004680_r15_policy_versions_cf1` → **`20261113004695`**.
- **이유 ①** `004680`은 적용 즉시 현재 판이 된다(시행일 2026-11-09 00:00 KST 경과). 지금 올리면 UI PR이 나올 때까지 S-30 머리글은 새 시행일인데 본문(`policy-content.ts`)은 경력기술서가 남은 옛 판이 된다 — "법무 본문과 같은 배포에 맞춘다"는 R14 규칙 위반.
- **이유 ②** 앞 번호로 남기면, 이미 적용된 `004690`보다 앞이 되어 나중에 `db push`가 거부한다.
- 파일 내용은 그대로이고 순서 주석만 고쳤다(운영에 올라간 적 없는 파일). 로컬 `db reset` + pgTAP 66파일 2,708 통과.

**적용**: 법무 판과 파괴 파일을 빼낸 상태로 `supabase db push`를 실행했다. dry-run에서 2개만 올라가는 것을 먼저 확인했다.

| 적용됨 | 내용 |
|--------|------|
| `20261113004670_r15_document_write_guard_and_copy` | 직접 쓰기 차단 트리거 · 첫 복사 RPC · `updated_at` 트리거 교체 |
| `20261113004690_r15_document_save_null_expected` | CF-S7 · `slot_high_water` · 슬롯 정체(번호 + `question_id`) · 패치 RPC `question_id` 갱신 |

**확인 (읽기 전용)**
- `list_migrations`(CLI): 마지막 **`20261113004690`**. `004695`(법무 판)와 `004700`(파괴)은 **미적용** — 의도대로다.
- **advisors security: 새 항목 없음.**
  - SECURITY DEFINER WARN은 **18건 그대로**이고 목록도 직전과 같다.
  - 새 definer 헬퍼 `private.doc_proposal_question_id`는 노출되지 않는 `private` 스키마라 잡히지 않는다.
  - 복사 RPC `mark_application_document_copied`는 invoker라 잡히지 않는다.
  - INFO `account_deletion_logs` 정책 없음(의도), Auth WARN 2건(R15 무관, Google 단일 로그인)은 기존 그대로다.
- advisors performance: **이번엔 다시 보지 않았다.** 두 파일은 인덱스·FK를 더하지 않는다(컬럼 1개·트리거·함수). 직전 확인은 INFO만이었다.
- **실질 데이터 영향: 0행.** `execute_sql` SELECT만으로 확인했다.
  - 운영 `application_documents` 0행, `slot_high_water > 0` 0행, 서류 대화 0건, 지원 프로젝트 0건 → `004690`의 `slot_high_water` 백필이 건드린 행은 없다.
  - 새 객체는 존재한다: `slot_high_water` 컬럼 1 · 가드 트리거 1 · 복사 RPC 1.
- **옛 코드 영향 없음.** 운영 코드(main)는 서류 경로를 쓰지 않는다. 직접 쓰기 호출 0건(QA 확인).

### 남은 순서 (갱신)
1. ~~1단계 비파괴 17개~~ — 완료 2026-11-09
2. ~~비파괴 `004670`·`004690`~~ — **완료 2026-11-10**
3. **법무 판 `004695`** — **UI PR 머지 직전에** push한다. 머리글과 본문이 어긋나는 시간을 짧게 둔다. 파괴 파일은 빼낸 상태로 올린다.
4. **두 PR 함께 머지**(#69 + UI PR) = 운영 배포. 이 순간 `writing_chats.project_id` not null 해제와 `ai_jobs` CHECK 완화의 되돌림 창이 닫힌다.
5. **파괴 `004700`** — 코드 배포 뒤, **사용자 승인 뒤**. 가드가 행 수를 다시 센다(현재 옛 초안 0행). push 뒤 SECURITY DEFINER WARN 18 → 13을 확인한다.

### 3단계 명령
```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && mv supabase/migrations/20261113004700_r15_drop_drafts.sql /tmp/
```
```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && supabase db push
```
```bash
cd /Users/jehyun/Resumate/.claude/worktrees/cover-letter-backend-ef4d68 && mv /tmp/20261113004700_r15_drop_drafts.sql supabase/migrations/
```
