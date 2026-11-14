# jd-raw-text — 데이터 모델(DM v4.16) 요청 회신

- 작성: data-architect / 2026-11-14 / 기준: `docs/planning/04-data-model.md` **v4.16** (짝 판 PRD v4.18 · UX v5.21 · AI v4.16)
- 입력: `_workspace/jd-raw-text/{prd,ux,ai}_requests.md`(AI DM-2a 포함), 리더 판단(1a 식별 → 1b 판정, `MT-n`, `match_key`/`match_keys`, `raw_text_hash`)
- **리더 이름은 모두 그대로 확정**했다. 데이터 쪽에서 바꾼 것은 `raw_text_hash`의 **값 정의** 하나다(AI DM-3) — 이름은 같다.

## 1. product-planner (PRD v4.18)

| ID | 회신 | 본문 |
|----|------|------|
| DM-1 | 반영. `jd_requirements`·JD 추출 컬럼 7개(`extraction_status`·`extraction`·`extraction_job_id`·`extraction_provider`·`extraction_model`·`tech_keywords`·`requirements_hash`) + `detected_language`·추출 RPC 3개·`extract-preview`·`jd-extraction` 라우트·`jd_preview` 새 행·`p_preview_job_id`·`preview_*` 반환·정리 크론 규칙 제거. `insights.requirements_hash`는 `raw_text_hash`로 이름 바꿈 | 2.6·2.6.2·2.7.0·11.11 |
| DM-2 | 반영. JR-Q3 (a) 변환 후 drop — 인사이트 결과·`match_stage_result`를 2판으로, `jd_requirement` 근거·대화 제안 출처를 요건 첫 문장의 `jd_sentence`로 바꾼다. 행 수 기록 = push 전 읽기 전용 집계 9항목을 `_workspace/backend/R16/release-counts.md`에 + 마이그레이션 `raise notice`, 끝에 멈추는 단언. **손실 예외 2가지**(대부분 0 예상): 사용자가 지운 요건을 가리키던 판정 원소·근거 행은 가리킬 문장이 없어 지운다(수는 notice). F-P2-05 "근거 손실 없음" 전제는 이 예외만 빼고 성립 | 11.11 (4) |
| DM-3 | RPC 이름 **`update_jd_raw_text`** 확정(`update_failed_jd_raw_text` drop, 별칭 없음). 조건: 진행 중 작업 0 · `insights.status = 'ready'` 0 · `jd_sentence` 근거 0 · **서류 대화 제안(`structured_draft`) 안의 `jd_sentence` 출처 0(신설)** · 내용 변경 · 문장 1개 이상. PRD 본문에 "결과" 정의로 "저장하지 않은 자소서 제안의 공고 근거"를 포함해 달라 | 2.6.1 |
| DM-4 | 반영. `jd_extraction`(job_type·feature)·`target_type = 'jd_preview'`·`not_a_jd`는 CHECK에 남기고 새 행 없음(경로가 모두 지워져 DB 가드는 두지 않음, CF-A3 선례). 진행 중 작업 종료 값 = **`status = 'canceled'`, `error_code = 'canceled'`**(기존 값, OD-P10 사용자 중단과 같음 — 종료 상태라 재시도되지 않는다) | 2.9.1 |
| DM-5 | 확인. 생성 RPC는 기업명·포지션명·마감일을 **사용자 입력으로만** 받는다(`JobPosting`·AI 경로 없음, URL 가져오기 응답도 `{rawText}`만). 추가로 **Q53-1 생성 게이트(`key_invalid`·`ai_consent_required`)를 삭제**했다 — 생성이 AI를 부르지 않는다. PRD에 Q53-1 폐기를 적어 달라. `detected_language`: 원천 확인 결과 AI-01(`apply_jd_extraction`)만 썼고 소비자가 없어 **drop** | 2.6·2.6.2·2.11.7 |

## 2. ux-planner (UX v5.21)

| ID | 회신 | 본문 |
|----|------|------|
| DM-1 | `sentences` 원소 = **`{sid, text, start, end}`**(`sid` = `"S{n}"`, 1부터 배열 순서, `start`·`end` = 정규화된 `raw_text`의 JS UTF-16 오프셋). 화면은 **`raw_text`를 그대로 그리고** 오프셋으로 강조해 달라 — 줄바꿈·불릿은 `raw_text`에 있고, `sentences`를 이어 그리면 문장 사이 공백·줄바꿈이 빠진다. **UX S-15 "원소를 배열 순서대로 이어 그린다"를 고쳐 달라** | 2.6 |
| DM-2 | ①~④ 모두 조건이다(③ 진행 중 작업 0 남김 — 유형 무관). 추가로 ⑤ 서류 대화 제안의 `jd_sentence` 출처 0(DM-3 답). 판정 원천: JD 조회에 **`rawTextEditable`**(boolean) + **`rawTextLockedReason`** = `job_in_progress` \| `has_results` \| null. 거부 코드: `jd_job_in_progress`·`jd_has_results`·`jd_raw_text_unchanged` **유지**, `jd_no_sentences` 신설, `jd_raw_text_locked`·`jd_failure_not_input` 폐기. 실패 인사이트·`canceled` 작업은 막지 않음(같음) | 2.6.1 |
| DM-3 | **조건에 넣었다**(위 ⑤) — 같은 sid가 다른 문장을 가리키는 경우를 화면·저장 RPC·트리거 어느 쪽도 알아챌 수 없어서다. 제안이 공고 근거를 하나라도 들고 있으면 `has_results`로 막힌다. "고칠 수 없을 때" 문구의 "자소서 근거"에 **"자소서 대화의 제안"**도 포함되게 다듬어 달라. "가리키던 문장을 찾지 못했어요" 한 줄은 방어용으로 남겨도 된다 | 2.6.1 |
| DM-4 | `item_key` = **`requirement_matches.MT-n`**. 가리키는 키: 모델 출력은 `requirement_refs`, **저장 키는 `match_keys`**(리더 이름) — UX C-01·S-16에 "`requirement_refs`(값 `M-n`)"으로 쓴 것을 **저장 키 `match_keys`(값 `MT-n`)**로 고쳐 달라. 접두사도 `M-n` → **`MT-n`**(LEAD-3대로 그 자리만) | 2.7.0·3.10 |
| DM-5 | 맞다. 새 행은 `user`(이름 또는 기업명 입력)·`default`(빈 칸)뿐, `ai`·null은 과거 행만(CHECK 3값 그대로). 기존 `name is null` 행은 마이그레이션이 기본 이름(`default`)으로 채운다. 제목 비움 규칙(`application_reset_name`, "{회사명} 자기소개서") 그대로 | 2.6 |
| DM-6 | 거부한다. 코드 **`jd_no_sentences`**(400, 생성·`update_jd_raw_text` 인자 검사 — 행 없음) `[가정: 이름]`. 과거 0문장 JD는 `begin_insight`가 같은 코드로 409 | 2.6 |
| DM-7 | 맞다. `p_deadline`을 그대로 넘기면 된다(CF-A5 AI 경로 삭제 확인), `p_preview_job_id` 제거. 반환은 `{application_project_id, job_description_id, created, name, name_source}`(`extraction_status`·`ai_run_allowed`·`preview_*` 제거) | 2.6.2 |
| DM-8 | 그대로 온다. `get_ai_usage_summary`는 변경 없음 — 과거 `jd_extraction` 행이 `providers[].features[]`에 나온다 | 2.9.2 |
| DM-9 | 빠질 것이 없다 — `get_deletion_impact('application_project')`의 `cascade`는 원래 `{insights, documents, document_chats, stage_events}`이고 요건 수가 없다(구현 `20261113004300`). 화면 줄 "공고, 인사이트 {N}, …" 그대로 | 7장 |

## 3. ai-feature-designer (AI v4.16)

| ID | 회신 | 본문 |
|----|------|------|
| DM-1 | 반영. 원소 `{match_key, requirement_text, sids, status, rationale, missing_aspect, item_key}`, `match_key` = **`MT-n`**(리더 판단, 서버가 붙임, UUID로 바꾸지 않음 — C-3 예외 동의), 저장 참조 키 **`match_keys`**(권고대로), `schema_version` 1 → 2. `requirement_id`·`requirement_ids` 삭제. **AI 명세 DM-1 예시의 `"M-1"`과 AI-02 입력 표 "키 `M-n`"을 `MT-n`으로** 맞춰 달라 | 2.7.0 |
| DM-2 | 반영 + 리더 판단의 1a/1b 구조로 확장: `match_stage_result` = `{identify: {prompt_version, items: [{match_key, requirement_text, sids}]}, match: {prompt_version, batches: [{n, match_keys}], items: [{match_key, requirement_text, sids, status, model_status, rationale, missing_aspect}]}}`(근거 제외). **배치 정보는 1b에서 되살아난다.** 세부 필드는 AI-02가 정본, DB는 jsonb 타입만 검사. 변환된 과거 행은 `identify: null` | 2.7.0 |
| DM-2a | 반영. `progress.stage`에 `identify` 추가(jsonb 앱 상수 — DB CHECK 없음). `call_key` `insight.identify` + `insight.match.{n}` + `insight.synthesize`, `feature`는 모두 `insight`(새 CHECK 값 없음). 혼합 등급: **`insights.model`·`model_tier`와 `ai_jobs.model_tier`는 1b·종합(기본 등급) 값**, 1a의 모델·등급은 그 호출의 `ai_usage_records` 행에만(호출 1행 규칙 그대로라 컬럼 변경 없음). `prompt_version`은 세 호출 값을 이어 붙임. 1a 결과는 `step_outputs`에 둔다(동의) | 2.7.0 |
| DM-3 | 이름 **`raw_text_hash`** 확정, 저장은 **인사이트 행에만**(JD에는 원래 같은 이름의 원문 해시가 있다). **값 정의는 바꿨다**: 문장 목록 해시가 아니라 **`prepare`가 읽은 `job_descriptions.raw_text_hash`를 복사**한다. 이유 — ① 같은 이름의 JD 컬럼과 뜻이 갈라지면 혼동 ② 분할은 저장 때 한 번 하고 기존 행을 다시 나누지 않아 한 JD 행 안에서 해시 ↔ `sentences`가 1:1(R16류 규칙 변경이 기존 `sid`를 바꾸지 않는다) ③ staleness·경합 검사가 컬럼 비교로 끝난다. 규칙: 기존 JD의 `sentences`를 다시 만드는 마이그레이션을 하면 그 행 `raw_text_hash`도 바꾼다. 과거 행은 JD 현재 해시로 채운다. **AI 명세 C-2(464행 근처)·C-6(603행)·0장 표(26행)의 "문장 목록(`sid`·`text`)의 해시" 정의를 이 정의로 고쳐 달라** | 2.7.0 |
| DM-4 | 전제대로다 — JR-Q3 (a)로 변환해 `jd_requirement` 행을 0으로 만들고 CHECK에서 뺀다("남기고 새 행만 거부" 안 씀). JR-Q3가 (b)·(c)로 확정되면 다시 알린다 | 2.8·11.11 |
| DM-5 | 반영. 종료 값 `status = 'canceled'`·`error_code = 'canceled'`. `not_a_jd`는 `ai_jobs`·`ai_usage_records` `error_code` CHECK와 `error_category` generated 식에 **남긴다**(빼면 식 재작성 + 과거 행 위반). 새 작업 `job_type` 목록 동의 | 2.9.1 |
| DM-6 | 전부 지운다(11.11 (1)). `raw_text`·`sentences`·`company_name`·`position_title`은 남는다. `detected_language`는 drop(소비자 없음 확인) | 2.6 |
| DM-7 | 권고 둘 다 반영: 조건에 "진행 중 작업 0"(유형 무관)을 남기고, 틈은 **`complete_insight`가 `raw_text_hash`를 현재 JD 값과 비교해 다르면 `stale_run`**(작업 `canceled`, 새 `error_code` 없음)으로 막는다. 자소서 턴은 턴 작업 `running` 동안 조건이 막고, **제안 단계 근거는 새 조건(서류 대화 `structured_draft`의 `jd_sentence` 출처 0)**으로 막는다 | 2.6.1 |
| DM-8 | 받았다 — 생성·원문 수정이 `sentences` ≥ 1을 요구(`jd_no_sentences` 400), 과거 0문장 행은 `begin_insight`가 409. **AI-02 실패 유형의 단계 1 원소 0개 → `schema_invalid` 줄을 "저장 단계에서 막힘 — 방어용"으로** 고쳐 달라 | 2.6 |
| DM-9 | `get_data_readiness()`·D-01 게이트는 요건 수를 보지 않는다(문서·구현 모두) — **변경 없음**. JD 선행 조건은 "문장 ≥ 1"이 대신한다 | 6장 |
| DM-10 | 맞다 — `structured_draft` 자소서 모양에 `requirement_refs`는 없다. `schema_version` 1 그대로. 단 제안 안의 `jd_requirement` 출처는 마이그레이션이 `jd_sentence`로 바꾼다 | 11.11 6단계 |
| DM-11 | 된다. `app_ai_writer`는 `writing_chats`·`application_projects`(컬럼 grant)·`job_descriptions`(컬럼 grant: `sentences`·`position_title` 포함, `source_url` 제외)를 읽을 수 있어 `return_target.application_project_id` → JD 경로에 grant 변경이 필요 없다 | 5장 |

## 4. 다른 문서가 고쳐야 할 이름 (요약)

- **UX**: 저장 참조 키 `requirement_refs` → **`match_keys`**(C-01·S-16), 원소 키 `M-n` → **`MT-n`**, S-15 문장 그리기("이어 그린다" → `raw_text` + 오프셋), 수정 불가 문구에 "자소서 대화의 제안" 포함, 조회 값 `rawTextEditable`·`rawTextLockedReason`, 코드 `jd_no_sentences`.
- **AI**: `raw_text_hash` 정의(JD 해시 복사), `M-n` 잔여 → `MT-n`, AI-02 원소 0개 실패 줄(방어용), 서류 대화 시작 인사 3종(요건 추출 전 삭제 — AI 회신 12 자리).
- **PRD**: 원문 수정 RPC `update_jd_raw_text`, "결과"에 대화 제안의 공고 근거 포함, Q53-1 생성 게이트 폐기.

## 5. 백엔드 후속 (decisions.md 4장으로 옮길 목록)

★ = 이미 만든 코드·마이그레이션이 바뀐다. 상세·순서는 DM v4.16 11.11.

**지울 것**
- ★ 테이블 `jd_requirements`(트리거 `jd_requirements_set_updated_at`·`jd_requirements_evidence_source_deleted`, 정책, `authenticated`·`app_ai_writer` grant 포함).
- ★ 컬럼 `job_descriptions.extraction_status`·`extraction`·`extraction_job_id`·`extraction_provider`·`extraction_model`·`tech_keywords`·`requirements_hash`·`detected_language` + CHECK 7개(`_extraction_status_check`·`_extraction_check`·`_extraction_provider_check`·`_tech_keywords_check`·`_requirements_hash_check`·`_succeeded_check`·`_detected_language_check`)·FK `job_descriptions_extraction_job_fkey`·인덱스 `job_descriptions_extraction_job_id_idx`.
- ★ public RPC `begin_jd_extraction`·`apply_jd_extraction`·`fail_jd_extraction`·`update_failed_jd_raw_text`·`purge_unused_jd_preview_outputs`.
- ★ private `jd_apply_extraction_result`·`jd_extraction_job_matches`·`jd_extraction_result_valid`·`jd_sids_exist`·`jd_extraction_mark_failed`·`ai_jobs_release_jd_extraction`(+ 같은 이름 트리거 on `ai_jobs`)·`jd_sids_valid`(다른 사용처가 없으면).
- ★ CHECK 값: `evidence_links_source_type_check`의 `jd_requirement`(변환 뒤).
- ★ API `POST /api/job-descriptions/extract-preview`, `POST /api/application-projects/{id}/jd-extraction`.
- ★ 크론: `src/server/jobs/cron.ts`의 `purge_unused_jd_preview_outputs` 호출.
- ★ 코드: AI-01 파이프라인·스키마·프롬프트·검증·저장·픽스처(`src/server/ai/**/AI-01*`, `jd-extraction*`, `src/server/jobs/jd-extraction`), 컨텍스트 빌더 `REQ-n` 별칭(`context-pack/jd.ts`·`gate-requirements.ts`), 근거 허용 목록·칩의 `jd_requirement`, 오류 매핑 `jd_raw_text_locked`·`jd_failure_not_input`·`jd_not_extracted`(`src/server/db/errors.ts`), 조회 계약의 `extraction*`·`detectedLanguage`·요건 목록.

**남기는 과거 값 (CHECK 그대로, 새 행 없음)**: `ai_jobs.job_type`·`ai_usage_records.job_type`·`feature`의 `jd_extraction`, `ai_jobs_jd_extraction_check`(두 분기 모두), `error_code` `not_a_jd`(+ `error_category` 식), `company_name_source`·`position_title_source`·`name_source`의 `ai`.

**바꿀 것 / 새로 만들 것**
- ★ `create_application_project`: `p_preview_job_id` 제거(옛 시그니처 drop 후 재생성), Q53-1 게이트 삭제, 이름 항상 결정(`user`/`default`), `jd_no_sentences`, 반환 `{application_project_id, job_description_id, created, name, name_source}`.
- ★ 신설 `update_jd_raw_text(p_application_project_id, p_raw_text, p_raw_text_hash, p_sentences)` → `{application_project_id, job_description_id, raw_text_edited_at}`, `authenticated`만, 조건 0~7(2.6.1), 판정 헬퍼 `private.jd_raw_text_lock_reason` `[가정]`. JD 조회에 `rawTextEditable`·`rawTextLockedReason`.
- ★ `private.job_descriptions_guard`: 원문 3컬럼 변경은 `raw_text_edited_at` 변경과 함께일 때만(컬럼 drop 전에 교체).
- ★ `private.evidence_allowed_sources`·`private.evidence_links_check_source`·서류 근거 허용 목록(`save_application_document`·`private.doc_*`·`private.wc_doc_*`): `jd_requirement` 제거.
- ★ `insights.requirements_hash` → `raw_text_hash`(rename + CHECK·ready CHECK 식), 값 = JD `raw_text_hash` 복사.
- ★ `private.insight_payload_valid`·`complete_insight`: `hashes.raw_text_hash`, 근거 목록 정리, JD 해시 불일치 → `stale_run`. `begin_insight`: `jd_not_extracted` 삭제, 0문장 → `jd_no_sentences` 409.
- ★ `private.writing_chat_document_greeting`·`start_document_writing_chat`: "요건 추출 전" 인사 분기·`extraction_status` 읽기 삭제(인사 3종).
- ★ `private.delete_account_data`: `jd_requirements` delete 줄 삭제.
- ★ 이름 헬퍼 `private.application_fallback_name`·`private.application_compose_name`: 본문·시그니처 그대로, **호출 방식만 정리** — 생성 RPC는 `p_name`이 비면 항상 `application_fallback_name` 하나로 이름을 정한다(직접 `compose_name` 분기·"추출 대기" null 분기 삭제), 추출 쪽 호출자는 drop, 남는 호출자 = 생성 RPC·`application_reset_name`(DM 11.11 (3) #10, 비파괴).
- ★ `POST /api/job-descriptions/fetch` 응답 `{rawText}`만(`companyName`·`positionTitle` 제거).
- ★ 인사이트 파이프라인: 1a 식별(`ai-02.identify.v1`, 경량) → 1b 판정(배치) → 종합, `progress.stage` `identify`, `call_key` `insight.identify`, `match_key` `MT-n`·`match_keys`, `stale.raw_text`, `input_hash`에 `raw_text_hash`. AI-04·AI-12 게이트는 원문 문장 전체 입력.
- 변경 없음 확인: `get_data_readiness`, `get_ai_usage_summary`, `get_deletion_impact`.

**마이그레이션 (JR-Q3 (a), 전부 `-- DESTRUCTIVE:`, 원격 push는 사용자)**
- A `…_r16_jd_raw_text_convert`: 0 변환 전 행 수 집계(push 전 읽기 전용 집계를 `_workspace/backend/R16/release-counts.md`에 + `raise notice`) → 1 트리거 `ai_jobs_release_jd_extraction` drop 후 진행 중 `jd_extraction` 작업 `canceled`/`canceled` → 2 `jd_preview` 작업 `output`·`step_outputs` 비우기 → 3 `name is null` 백필(`default`) → 4 인사이트 `result`·`match_stage_result` 2판 변환 + `requirement_matches.<uuid>` 근거 `item_key` → `MT-n` → 5 `jd_requirement` 근거 → `jd_sentence`(첫 문장, 문항 단위는 locator null, 중복·원본 없음은 삭제) → 6 서류 대화 `structured_draft` 출처 변환 → 7 `insights.requirements_hash` rename + JD 해시로 채움.
- B `…_r16_jd_raw_text_rpcs`: 위 RPC·트리거 함수 교체·신설, 옛 RPC·헬퍼 drop.
- C `…_r16_drop_jd_extraction`: `jd_requirements`·JD 컬럼 8개 drop, `evidence_links` CHECK에서 `jd_requirement` 제거, **최종 단언**(`jd_requirement` 근거 0 · 1판 인사이트 0 · null 이름 0 · 진행 중 추출 0 · 근거 수 보존식) — 하나라도 거짓이면 롤백.
- 배포: A·B·C push → 바로 코드 배포 `[가정]`. 되돌리기 불가 — 백업 시점 확인은 릴리스 체크리스트.
- 타입·pgTAP: `database.types.ts` 재생성, pgTAP 항목은 11.11 (3) #13.
