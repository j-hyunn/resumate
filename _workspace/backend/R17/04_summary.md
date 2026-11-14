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
