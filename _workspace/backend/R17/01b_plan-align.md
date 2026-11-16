# R17 정렬 계획 — 기획 PR #77(jd-raw-text 사이클) 확정 결정에 맞추기

- 날짜: 2026-11-16 · 요청: 상위 세션(사용자 승인 2026-11-16 "네, 맞추게 해줘")
- **기준 문서**(이 PR에서 고치지 않는다 — 읽기만): 브랜치 `origin/claude/jd-raw-text-planning-6b673b`
  - `docs/planning/decisions.md` **3.29**(JR-1~JR-7, JR-Q1~Q5)·**4.24 표**(백엔드 #1~#17, AI #18~#21, UI 1~9)
  - `docs/planning/04-data-model.md` **v4.16 11.11**(순서·마이그레이션 A·B·C·집계·단언) + 본문 2.6·2.6.1·2.6.2·2.7.0·2.8·2.9
  - `docs/planning/03-ai-features.md` **v4.16 0.v416**(프롬프트 버전 표) + AI-02·AI-04·AI-12 본문, C-2·C-6
  - 로컬 사본: `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-jd-raw-text-backend-610f7b/6d5f8784-60d9-4d4a-87a3-ddab28b9934f/scratchpad/planning77/docs/planning/` (같은 내용, `git show`로 뽑음)
- 기존 R17 구현(커밋 `63d0745`·`8542ae6`)에서 출발한다. `01_plan.md`의 `[가정]` 중 4.24와 다른 것은 **4.24가 이긴다**.

## 1. 기존 R17 대비 달라지는 것 (요약 — 상세는 4.24 행)

| 4.24 | 기존 R17 | 정렬 후 |
|------|---------|---------|
| #1·#2·#5 | `jd_requirements`·추출 컬럼 보존, CHECK 유지 | **마이그레이션 C에서 drop**, `evidence_links_source_type_check`에서 `jd_requirement` 제거 |
| #3 | 추출 RPC drop(`update_failed_jd_raw_text` 유지) | `update_failed_jd_raw_text`·`jd_sids_exist`·`jd_sids_valid`(다른 사용처 없으면)도 drop |
| #4 | 근거 행 보존 | **마이그레이션 A에서 삭제**: `jd_requirement` 근거 전부, `application_document` 소유 `jd_sentence` 근거 전부, 서류 대화 `structured_draft` 안의 JD 출처 원소 |
| #8 | 과거 값 CHECK 유지 | 같음 + 옛 인사이트(`schema_version = 1`)와 그 나머지 근거는 남김(본문 안 보임) |
| #9 | 9인자, 반환 6키(`ai_run_allowed` 포함), 게이트 제거 | 반환 `{application_project_id, job_description_id, created, name, name_source}`, 문장 0개 → `jd_no_sentences`, `p_name` 비면 늘 `application_fallback_name`(기업명 compose 경로 확인 — DM 2.7.1/CF-A7 문장대로) |
| #10 | 없음 | **생성 Server Action 뒤 인사이트 자동 시작**, 응답 `insightJobId`·`insightSkipReason` |
| #11 | 원문 수정 RPC 그대로(새 공고 잠김) | **신설 `update_jd_raw_text`**, JD 조회 `rawTextEditable`·`rawTextLockedReason`, `job_descriptions_guard` 교체 |
| #12 | 허용 목록 그대로 | `insight` = 커리어 5종 + `jd_sentence`, `application_document` = 커리어 5종 + `user_note` (저장·패치 함수 전부) |
| #13 | `insights.jd_text_hash` 추가 | **`requirements_hash` → `raw_text_hash` rename**(A), `jd_text_hash`는 만들지 않음(아직 원격 미반영이라 004800을 고쳐 씀), `stale_run`, `jd_no_sentences`, 조회 `schemaVersion`·`staleReasons.{career, rawText}` |
| #14 | AI-12 게이트 요건 블록만 제거 | `start_writing_chat` `return_target.params.insight_id`·`insight_item_key`, 인사 3종, `delete_account_data`의 `jd_requirements` 줄 삭제 |
| #15 | fetch 그대로 | 응답 `{rawText}`만 |
| #18 | AI-02 `M{n}`, `requirement`, ≤ 20, 200자 | **`MT-n`·`match_key`·`match_keys`, `requirement_text` ≤ 120자·`sids`, 최대 15**, `match_stage_result {prompt_version, items}`, `call_key` `insight.match.1`·`insight.synthesize`, 재사용은 schema 2만, 단계 1 지연 실측 기록 |
| #19 | AI-04 = 원문 문장 전체 | **AI-04는 원문을 읽지 않는다** — 최신 ready 인사이트(schema 2) 블록 + 커리어 + 문항·메모, 인사이트 없으면 안내 줄, 근거에서 `jd_sentence` 거부. AI-12 게이트 = 그 보완점 항목. 프롬프트 버전은 AI 0.v416 표 그대로 |
| #20·#21 | — | 자동 시작도 사용량 기록 · 평가 세트 AI-01 항목 삭제(코드에 있으면) |

## 2. 마이그레이션 구성 — 판단

`20261113004800_r17_jd_raw_text.sql`은 **원격에 올라간 적이 없다**(원격 마지막 `…004700`). 그래서 이 파일을 지우고 기획 11.11의 A·B·C 세 파일로 **다시 쓴다**:

- `20261113004800_r17_jd_raw_text_cleanup.sql` — **A, DESTRUCTIVE**: 집계 `raise notice` → 진행 중 `jd_extraction` 작업 `canceled` → `jd_preview` 출력 비우기·`name is null` 백필 → #4 행 삭제 → #13 rename
- `20261113004810_r17_jd_raw_text_rpcs.sql` — **B**(public RPC drop 포함, 되돌릴 수 없음): #3·#9·#11~#14 함수
- `20261113004820_r17_drop_jd_extraction.sql` — **C, DESTRUCTIVE**: #1·#2·#5 + 최종 단언(하나라도 거짓이면 예외로 롤백)

이유: (1) 기획이 A → B → C 순서와 단계별 책임(데이터 정리 → 함수 → drop + 단언)을 정해 두었다. (2) 004800이 미반영이라 고쳐 써도 안전하고, `jd_text_hash`를 추가했다가 바로 지우는 왕복을 없앤다. (3) 한 파일로 합치면 B(함수 교체)만 다시 적용하거나 C 전에 멈춰 확인하는 선택지가 사라진다. 기존 2단 초안 `phase2-destructive-draft.sql`은 A·C로 흡수되므로 삭제한다.

push 전 읽기 전용 집계 10항목: `_workspace/backend/R17/release-counts.md`(DM 11.11 목록, SQL 포함). 원격 push는 하지 않는다(로컬 적용·pgTAP까지).

## 3. 순서·담당

1. db-engineer(A·B·C, pgTAP, 타입, release-counts) ∥ ai-pipeline-engineer(#18·#19·#21, 인터페이스를 notes 맨 위 "정렬 인터페이스"에 먼저)
2. api-engineer(#6·#7·#10·#11 조회·#13 조회·#14 호출·#15, 생성 자동 시작, 데이터 계층·UI 최소 수정)
3. backend-qa 재검증(전체 검사 + build + 4.24 항목별 대조 표)
4. 리더: `spec-gaps-R17.md` 해소/잔여 표시, 하네스 `slice-catalog.md` S5 행 정리, PR 본문 릴리스 주의 갱신
