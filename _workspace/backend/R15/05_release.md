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

## 7. push 뒤 확인 (리더가 읽기 전용으로 수행)

- [ ] Supabase MCP `list_migrations` — 마지막이 1단계 뒤 `20261113004660`, 2단계 뒤 `20261113004700`
- [ ] `get_advisors`(security·performance) — **새 항목만** 본다. 기존에 받아들인 것은 다시 보고하지 않는다: authenticated용 SECURITY DEFINER RPC WARN(설계), `account_deletion_logs` 정책 없음(service role 전용, 의도)
- [ ] Vercel 배포 상태와 런타임 오류(읽기 전용)
- [ ] `slices.md`의 R15 "원격" 열에 날짜 기록

## 8. 아직 하지 않은 것

- **원격 미반영**(이 문서 작성 시점)
- **브라우저 미확인** — 서류 작성 화면이 없으므로 UI 세션의 화면이 붙은 뒤에 가능하다
- **출시 전 법무 확인(사용자 몫)**: 사람인·잡코리아 이용약관의 자동 수집 제한(CF-10, PRD NFR-PRV-12)
- 남는 제약 2건(결함 아님, 코드 주석·`spec-gaps.md`): URL 가져오기 요청 제한이 프로세스 안 슬라이딩 윈도라 **Vercel에서 람다마다 따로 센다**(기획이 수치를 `[가정: 수치]`로 비워 둔 자리) · `fetch`가 소켓 주소 훅을 주지 않아 **DNS 리바인딩 창이 남는다**
