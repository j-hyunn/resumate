# R17 요약 — 채용 공고 AI 처리 제거 (JD 원문 그대로)

- 날짜: 2026-11-14 · 브랜치 `claude/jd-raw-text-backend-610f7b`
- 상태: done (QA 2라운드 Critical 0 · Major 0 · Minor 0). 원격 미반영.

## 만든 것
- **AI-01 폐기**: 파이프라인·프롬프트·스키마·검증·저장·픽스처, 잡 러너 `jd_extraction` 분기, `extract-preview`·`application-projects/[id]/jd-extraction` 라우트, `jd-preview-store`, 미리 보기 정리 크론, 비용 표 항목, `not_a_jd`, 생성 RPC의 `p_preview_job_id` 삭제.
- **생성**: `create_application_project` 9인자. 사용자 입력(기업명·포지션명·마감일·URL) + 원문만 저장. 키·동의 게이트 없음.
- **AI-02 v2**: 원문 문장 전체(S-n) 입력, 1단계 단일 호출에서 요건 식별+판정(`M1…Mn`, ≤ 20), 결과 `schema_version` 2(키 이름 유지), 인용 문장 = `jd_sentence` 근거, 해시 `{jd_text_hash, career_snapshot_hash, input_hash}`, `INPUT_HASH_VERSION` 3. v1 과거 인사이트는 보존된 `jd_requirements`로 계속 읽음.
- **AI-04**: 원문 문장 전체, `requirement_refs`·`no_requirements` 제거, `requirement_ids` 항상 `[]`.
- **AI-12**: `<gate_requirements>` 제거.
- **DB** `20261113004800_r17_jd_raw_text.sql`(비파괴): 9인자 생성 RPC, 추출 RPC·트리거 삭제, `begin_insight` → `job_description_not_found`, `insights.jd_text_hash` 추가·ready_check 완화, `start_document_writing_chat` 인사말 조건. 2단 파괴 초안 `phase2-destructive-draft.sql`(미적용).
- prompt_version: common v4→v5, AI-02 v5→v6, AI-04 generate/adjust v6→v7·extract/reply v1→v2, AI-12 v7→v8.

## 검사
typecheck 0 · lint 0 · Vitest 157 파일 / 2,624 통과(통합 포함) · pgTAP 66 파일 / 2,613 통과 · build 통과. 브라우저 미확인.

## `[가정]`
R17-1~10(계획), R17-db1, R17-AI-1~6, R17-api1~8 — 기획과 어긋날 수 있는 지점은 `spec-gaps-R17.md` G1~G15.

## UI 요청 (resumate-ui 후속) — 상세 `02_api_notes.md` "UI 요청"
1. S-14 추가 모달 ②의 미리 정리 흔적(요건 n개 줄, extracting 단계, 폼 임시 저장 키, 키 무효 안내) 정리
2. S-15 채용 공고 탭의 요건 목록 영역 걷어내기 / 원문 전용 레이아웃
3. 원문 수정 버튼(R17-6, 기획 결정 후)
4. 요건 선행 추출 흔적(`useRequirementsFirst`, 문구 "공고 요건 정리 중" 등)
5. S-16 인사이트: 인용 문장 보기, "공고 원문이 바뀌었어요" 사유 문구, `not_a_jd` 경로 정리
6. `not_a_jd` 오류 안내(과거 행 표시용으로 남김 — 삭제 여부)
7. dev 갤러리 견본·mock 컨트롤
8. mock 인사이트 v2
9. 사용량 표 "채용 공고 분석(이전)" 행 표시 규칙
10. `ai-progress.tsx` 예상 시간 표 정리

## 릴리스 영향
- 마이그레이션 1개(비파괴, 함수 삭제 포함) → **`db push` 직후 바로 머지**(그 사이 옛 코드의 공고 추가 실패). 원격 마지막 `20261113004700` → 순서 OK.
- 배포 전 원격 읽기 전용 확인: 대기·실행 중 `jd_extraction` 잡 수.
- 새 env 없음. UI 최소 수정이 같은 PR.

## 범위 밖 후속
- ~~QA-05(R17 이전 버그)~~ **해결 2026-11-14**: `insightSignalOf`가 `strategy.positioning`을 읽도록 수정(최상위 `positioning`은 폴백), 테스트 `writing-chat/pipelines.test.ts`.
- 2단 파괴 마이그레이션(기획 확정 후).

---

# 정렬 (2026-11-16) — 기획 PR #77 확정 결정(3.29·4.24)에 맞춤

계획 `01b_plan-align.md`. QA 정렬 2라운드 Critical 0 · Major 0 · Minor 0 (1라운드 Minor 4건 QA-06~09 해결).

## 4.24 항목별
| # | 상태 | 비고 |
|---|------|------|
| 1·2·5 | 완료(로컬) | 마이그레이션 C: `jd_requirements`·추출 컬럼 8개 drop, `jd_requirement` CHECK 제거, 최종 단언 |
| 3 | 완료 | B: 추출 RPC·`update_failed_jd_raw_text`·헬퍼 drop |
| 4 | 완료(로컬) | A: `jd_requirement` 근거·자소서 `jd_sentence` 근거·대화 제안 JD 출처 삭제 |
| 6·7 | 완료 | 라우트·크론·코드 삭제. UI 소유 칩 분기 1곳은 UI 요청 U5 |
| 8 | 완료 | 과거 값 CHECK 유지, schema 1 인사이트 보존 |
| 9 | 완료 | 생성 RPC 반환 5키, `jd_no_sentences`, 게이트 없음 |
| 10 | 완료 | 생성 Server Action 뒤 인사이트 자동 시작, `insightJobId`·`insightSkipReason` |
| 11 | 완료 | `update_jd_raw_text`, `rawTextEditable`·`rawTextLockedReason`, 가드 교체 |
| 12 | 완료 | 허용 목록 insight = 커리어+`jd_sentence`, 자소서 = 커리어+`user_note` |
| 13 | 완료 | `raw_text_hash` rename, `stale_run`, `schemaVersion`, `staleReasons.rawText`(칩 포함) |
| 14 | 완료 | `start_writing_chat` `insight_id`·`insight_item_key`, 인사 3종, `delete_account_data` |
| 15 | 완료 | fetch `{rawText}` |
| 16 | 완료(로컬) | A·B·C, `release-counts.md`. **원격 push는 사용자** |
| 17 | 확인 | readiness·usage·deletion impact 변경 없음 |
| 18 | 완료 | `MT-n`·`match_keys`·≤ 120자·최대 15·`{prompt_version, items}`. 지연 측정 장치(`latencyMs`, `ai_stage_timing`)는 있음, **실제 공급자 실측값은 아직 없음** |
| 19 | 완료 | AI-04 = 최신 인사이트+커리어+문항·메모, `jd_sentence` 거부, AI-12 = 보완점, 프롬프트 버전 0.v416 표 |
| 20 | 완료 | 자동 시작도 사용량 기록 |
| 21 | 해당 없음 | 코드에 AI-01 평가 항목 없음 |

## 검사
typecheck 0 · lint 0 · Vitest 160 파일 / 2,666 통과(통합 포함) · pgTAP 65 파일 / 2,648 통과 · build 통과 · `db reset`으로 A→B→C 적용 확인, 과거 모양 데이터 씨앗 위 A→B→C 1회 실행(db-engineer). 브라우저 미확인.

## UI 요청 (4.24 UI 1~9 → `02_api_notes.md` "정렬" U1~U9)
U1 S-14 마감일 칸·자동 시작 안내 · U2 채용 공고 탭 요건 열 삭제·[공고 내용 수정] 상시 · U3 인사이트 탭 판정 표·schema 1 안내·변경 사유 · U4 자소서 "AI가 읽는 내용" · U5 `jd_requirement` 칩 분기 · U6 진행 문구·C-20 · U7 보완점 → S-10 "관련 요건" · U8 사용량 "(종료)" 행 · U9 mock 정리

## 남은 `[가정]`
`spec-gaps-R17.md` 하단 — G12(AI-02 지연, 재설계 사이클)·G16(인사 상태 줄 AI 명세 ↔ DM 2.5 불일치), 정렬 중 새 `[가정 R17b-db-1~12 · AI-1~9 · api-1~9]`(기획 확인 8건 표시).

## 릴리스 (원격 push 전)
1. 백업(되돌릴 수 없음 — A·C 파괴적)
2. `release-counts.md`의 읽기 전용 집계 10항목 실행·기록
3. `supabase db push`로 A(`…004800`)·B(`…004810`)·C(`…004820`) 함께 → **바로 코드 머지·배포**(옛 코드는 삭제된 RPC·컬럼을 부른다. A~B 사이 수 초 동안 옛 `complete_insight` 실패 가능)
4. C 단언이 멈추면 A·B는 적용된 상태 — 해당 행을 고친 뒤 C만 다시 push

---

# 후속 (2026-11-20) — UI 60 런 기획 확인 (decisions 3.30·4.25, 기획 PR #77 `ba9fc10`)

- **4.25 백엔드 #1 완료**: `20261113004790_r17_policy_versions_ui60e.sql`(비파괴) — `policy_versions`에 terms·privacy·ai_data_use **2026-11-20** 행, `requires_reconsent = false`(CF-S6 004695 패턴). 번호는 원격 마지막 `004700` 뒤, 파괴 A(`004800`)보다 앞(파괴가 마지막). pgTAP: 새 판 단언 2개 추가, "현재 판" 단언·동의 픽스처를 2026-11-20으로(`policy_versions`·`consents`·`account_deletion`·`r12_ui36_followups`·`r13_settings_dialog`). pgTAP 65/2,650 · Vitest 160/2,666 · typecheck 0.
- **UI #3과 같은 머지**: `src/components/account/policy-content.ts`(UI 소유, ui-u1-u9 세션)가 2026-11-20판 본문으로 바뀐 뒤 함께 나가야 한다. push ~ 머지 사이에는 화면이 옛 본문에 새 시행일을 보인다.
- **출시 전 법무 확인**: ai_data_use 2026-11-20판의 "자기소개서를 만들 때 인사이트 자동 시작" 문장과 재동의 생략(UI60-E `[가정]`).
- 4.25 백엔드 #2(인사이트 항목 읽기 함수 만들지 않음)·#3(G16 — 시작 인사 DB 3종, 상태 줄은 화면) — 변경 없음, 지금 구현이 정본. `spec-gaps-R17.md` G16 해소.
