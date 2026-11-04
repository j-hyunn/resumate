# 34 런 브리프·결과 — Q53 후 남은 것 정리 (2026-11-04)

- 요청: `docs/ui/screen-status.md` "Q53 후 남은 것" 줄 닫기 (다른 세션이 맡긴 작업, 범위 = 면접 S-33/S-22/S-37 · S-17 + Q53 기록의 작은 잔여)
- 출처: `17_ui-qa_q53_review.md`, `18_frontend-engineer_q53_fixes.md`
- 기획 기준: PRD v4.10 / UX v5.10 / AI v4.7 / DM v4.8 (README 기준, 변경 없음)
- 백엔드 계약: `retry_ai_job` R-63 다시 열기 구현됨(R2 42f7611, W0 interview_grading), 다시 채점 = 새 작업 라우트
- 진행 방식: 리더 직접(파일 6개 수준의 작은 수정이라 에이전트 미호출). 브라우저 확인 없음(로컬 로그인은 Google 전용)

## 결과

| 항목 | 판단 | 처리 |
|------|------|------|
| R-63 혼합 세션 같은 행 다시 시도 (UQ-612) | 화면 경로는 명세와 같음: S-22는 같은 행을 쓰지 않음(UX 1026행, DM 2.7.1 Q53-5), S-33은 질문이 일부 저장됐으면 새 작업("남은 질문 다시 만들기"), 0개 전체 실패만 같은 행. 백엔드는 공급자가 바뀌면 그 작업의 평가 전부(입력 원인 포함)를 `pending`으로 엶(DM 2.9.1 "상태 조건 없음", spec-gaps W0 ⑨). mock만 입력 원인 평가를 남겨 미리보기가 실제와 달랐음 | `src/lib/mock/grading.ts` `keepsEvaluationOnRetry` + `ai-jobs.ts` 사용, `grading.test.ts` |
| S-17 "새 경력기술서" 대상 (QA B-1) | 기획 결정 아님 — FL-03 흐름도(JR 아니오 → 추출)와 Q53-4(사용자 확정 "요건 없는 JD에서 '새 경력기술서'를 누르면")가 정함. 요건 있는 JD에 버튼을 두면 03 AI-11 "진입 자동 1회"와 충돌 | 구현 그대로, `draft-entry.test.ts`로 규칙 고정 |
| S-14 입력 복원 시점 (QA B-6) | UX S-14 "키 교체로 떠날 때 저장 … 돌아오거나 만들기가 성공하면 지운다"와 달리 모든 이탈 뒤 복원 | `form-draft.ts` `keepsFormDraftOnLeave`, 언마운트 때 복귀 대상이 이 화면이 아니면 삭제, `form-draft.test.ts` |
| S-15 UQ-608 남은 경우 | 거부 뒤 "취소" → 버튼 없음 → 포커스 `body` | `jdRawFocusTarget` + `JdRawPanelTitle`(제목 `tabIndex=-1`), `jd-raw-edit-state.test.ts` |
| UQ-610 | Q53-11로 닫힘 | — |
| QA B-3 `tech_keywords` | 실제 경로 `?? []` | — |
| QA B-4, B-5 | 기획 확인 필요로 남김 | screen-status 기획 확인 필요 |
| UQ-606 | 중단 사용 기록 — 실제 스트림 경로 확인은 백엔드 쪽 | 범위 밖 |

## 검증

- `pnpm lint` 0, `pnpm typecheck` 0, `pnpm test` 134 파일 2257 통과
- 브라우저 확인 없음: S-14 키 교체 왕복 복원, S-15 거부 뒤 취소 포커스, S-33 다시 시도는 사람이 한 번 눌러 봐야 함
- 알려진 한계: S-41로 갔다가 연결·취소 없이 다른 곳으로 빠지면 복귀 대상이 남아 S-14 입력이 한 번 더 남을 수 있음(복귀 대상은 S-41 연결·취소 때 지워짐)
