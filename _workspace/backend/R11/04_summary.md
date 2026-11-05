# R11 요약 — 열린 결정 일괄 확정(OD-*) 백엔드 후속

## 만든 것
| DM 11.6 | 내용 | 위치 |
|---------|------|------|
| #1~#3 OD-I6 | 세션·근거 `application_project_id` null 허용, FK `on delete set null`, 복사 컬럼 2개, CHECK 2개, BEFORE DELETE 트리거(복사 → 근거 분리 → 비완료 세션 삭제) | `20261113000500`, `000600` |
| #4 | `interview_session_read_only`(409): `begin_interview_evaluation`·`save_answer_evaluation`·`complete_interview_evaluation`, 서버 재채점·질문 재시도·제출·restart가 연결 게이트 전에 거부. 채점 판정 `none` | `000700`, `services/interview/start.ts` |
| #5 | `get_deletion_impact('application_project')` `{cascade, kept}`, 커리어 `detached_interview_sessions`, 서버 액션 `getApplicationProjectDeletionImpact` | `000800`, `services/career/rpc.ts`, `actions/application.ts` |
| #6 | 면접 읽기 left join·복사 이름("삭제된 자기소개서" 대체)·`readOnly`·`detached` 필터 | `services/interview/view.ts`·`read.ts` |
| #7·#8 OD-I1 | `d14.v1` 헬퍼, 세 저장 경로, 서버 문구, `backfill_interview_scores`(service_role, 실행 안 함) | `000900` |
| #9 OD-C6 | `p_client_id` 두 RPC + 동시 요청 경합 처리, 서비스 `clientId` | `001000`, `services/career/page-save.ts` |
| #10 OD-P5 | `src/lib/body-hash.ts` `normalizeBodyForHash`·`computeBodyHash`, 서버 적용 | |
| #11 OD-P11 | `retryTarget`이 답 없는 사용자 메시지에도 응답(RPC 변경 불필요) | `services/writing-chat/turn.ts` |
| #12 OD-L2·L2a | 고지 `v2026-11-05` 6행, `ai_disclosures_free_tier_ack_check` 삭제, 동의 가드가 고지 행의 `requires_free_tier_ack`일 때만 확인 요구(R11-DB-1 (a), R-OD-15), 계약 refine 삭제·서버 검사 `free_tier_acknowledgement_required` | `001100`, `001200`, `contracts/ai-connection.ts`, `services/ai-connection/consent.ts` |
| #13 OD-L1 | `EnvKms` 주석 | `server/keys/kms.ts` |
| #15 OD-P10 | 확인 — 중단 경로 명세대로. 상세 DTO에 `turnFailure` 추가 | `services/writing-chat/chat.ts`·`mappers.ts` |

## 검사
- typecheck·lint 통과, Vitest 141 파일 통과, pgTAP 58 파일 / 2,896 통과(`db reset` 뒤), 로컬 스모크 통과(QA 1라운드).
- QA 1라운드: Major 1(QA-01)·Minor 3 → 수정, 2라운드 재확인은 `03_backend-qa_report.md`.

## 릴리스
- 비파괴. push 전 확인: OD-I6 FK 동작 변경, `ai_disclosures_free_tier_ack_check`·`ai_data_use_consents_free_tier_acknowledged_check` 삭제(가드로 대체).
- UI와 같은 배포: 고지 본문 모듈(v2026-11-05는 적용 즉시 시행, Claude 사용자 재동의), 화면 해시 `computeBodyHash`(아니면 "기준 본문 바뀜" 오표시), S-37 분리 세션 링크.
- 배포 직후 `backfill_interview_scores`를 0이 될 때까지 실행(운영).

## 열린 것
- `[가정]` R11-DB-2~7(spec-gaps). DM 2.11.5 표(:1028) 동의 CHECK 서술 개정 필요(기획).
- UI 최소 수정 9개 파일(타입·null만) — `02_api_notes.md` "UI 최소 수정".
