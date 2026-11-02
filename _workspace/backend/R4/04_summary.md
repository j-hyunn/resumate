# R4 커리어 재설계 반영 (CR-1~CR-24) — 요약

- 기준 기획: ccf3b26 (PRD v4.5 / 플로우 v5.5 / AI v4.5 / DM v4.4), 작업 목록 = DM 11장
- 상태: done (2026-11-02) · 커밋 안 함 · 원격 Supabase 적용 안 함

## 만든 것
- **DB**: 새 마이그레이션 17개 `supabase/migrations/20261109100100_r4_*` ~ `20261109101700_r4_qa1_fixes`
  - 커리어 하위·대화 데이터 비우기(DM 11.2 권고, `[가정]` R4-DB-1)
  - `project_details`·`achievements` 삭제, `projects` v4.4(STAR 5컬럼·분류 3종·`is_current`·`description`·`link_url`·`content_updated_at`), `project_deliverables` 신설, `project_skills` 독립 한정
  - `evidence_links` v4.4, 결과 RPC 근거 유형, `writing_chats` v4.4·메시지 RPC, `apply_structured_draft_patch` v3, `apply_writing_chat_proposal` 신설
  - `get_data_readiness` v4.4, 삭제 RPC(`delete_projects`만), 서류 근거·탈퇴 집계, 기본 이름 "새 자기소개서"
  - 폐기: `save_writing_chat`·`hand_off_writing_chat`·`set_writing_chat_affiliation`·`purge_unlinked_writing_chats`·`reorder_project_details`·3인자 `start_writing_chat`
  - 이름 정렬: 처음 20261107로 만들었다가 w1(20261108) 뒤로 오도록 리더가 20261109로 바꿈
- **AI** (`src/server/ai/**`): Career Context Pack(STAR → `PRJ-n`, `DLV-n` 산출물, `DET-n`·`ACH-n` 제거), V-1~V-9 개정, AI-12 structured draft v3(분류 추천 CR-20, `is_current` 제안 없음, 빠른 칩), 모든 기능 `prompt_version` 올림(`common.v2`) → 기존 결과 재사용 안 됨(의도)
- **API**: 커리어 서비스·액션·계약 v4.4, 산출물 CRUD·정렬, 이름만으로 프로젝트 만들기(CR-6), 프로젝트에 묶인 대화·반영 RPC, 턴 SSE, 오류 매핑, 보관 크론 정리
- **배선**: `src/lib/data`·`src/types/db.ts` v4.4. UI 파일은 손대지 않았고, UI가 쓰는 옛 함수·타입은 `@deprecated` 호환 껍데기(목록: `02_api_notes.md` "배선" 표). 새 화면용 `career-v44.ts`·`writing-chats-v44.ts` 등은 **연결 대기**

## 검사
| 검사 | 결과 |
|---|---|
| typecheck | 0 errors |
| lint | 0 |
| Vitest | 111 files, 1,772 pass |
| pgTAP | 51 files, 2,387 pass |
| `pnpm build` | 로컬 스택 env를 인라인으로 주면 통과(작업 트리에 `.env.local` 없음, R4-API-9) |

## QA (2라운드)
- Critical 0 / Major 0. Minor 4건(QA-R4-01~04) 수정·재확인.
- 남은 Minor 2건:
  - QA-R4-05 (db-engineer): `project_deliverables.sort_order` 기본값 없음 → insert 타입 우회 `as never`(`save.ts:237`)
  - QA-R4-06 (api-engineer): 서버 메시지 18곳의 "기업 JD" 문구 → "자기소개서"(CR-23). UI 재작업과 함께 처리 가능

## 사용자 확인 필요
- R4-DB-1: R4 첫 마이그레이션은 프로젝트·대화·관련 근거 데이터를 **이관하지 않고 지운다**. 원격 DB에 적용하면 그곳 데이터도 지워진다.
- spec-gaps R4-DB-*, R4-AI-1~3, R4-API-1~9 — 기획 문구 갱신 대상(QA 판정은 `03_backend-qa_report.md`).

## 다음
- UI: `resumate-ui`로 S-08(2단)·S-10(STAR + AI 패널)·S-43·S-44 재작업, S-09·S-34·S-35·S-11·S-36 폐기, 호환 껍데기 삭제, 새 데이터 함수 연결
