# R7 요약 — AI 작성 대화 질문 품질 (AI-12·AI-13 reply)

- 날짜: 2026-11-04 · 상태: done
- 사용자 결정: RQ-1 본인 말 인용 허용, RQ-2 항목당 꼬리 질문 최대 2회, RQ-3 기획 문서 + 코드. 리더 판단 R7-QA-1: 인용은 사용자 발화와 폼 값(AI-12 STAR·기간, AI-13 현재 본문·프로젝트)만, 정리 제안·facts는 인용하지 않음.

## 바뀐 것
- AI-12 reply가 `<project_state>`(폼의 STAR·기간 값 + 아직 폼에 없는 제안 + 되묻기)를 받는다. 이전에는 "값 있음/비어 있음"만 받았다.
- AI-12·AI-13 reply 질문 규칙: 질문 1개 기본, 첫 문장은 사용자 말 받아 주기, 본인 말 인용, 구체 요소 하나를 겨냥, 범주 예시, 항목별 구체 요소 목록, 꼬리 질문 최대 2번(순서: 요청 항목·되묻기 → 꼬리 질문 → focus_slots).
- AI-12·AI-13 extract: 구체 요소(수치·방법·순서·이유·규모·대안·도구) 보존 한 줄.
- 버전: ai-12.reply.v5, ai-12.extract.v5, ai-13.reply.v2, ai-13.extract.v2 (compose v1 그대로). 대화 턴은 input_hash 재사용을 쓰지 않아 무효화되는 결과 없음.
- 기획: 03-ai-features.md v4.8, decisions.md 3.15·4.9, README.

## 파일
- src/server/ai/context-pack/writing-chat.ts (+test), src/server/ai/prompts/AI-12/index.ts, src/server/ai/prompts/AI-13/index.ts, pipelines/AI-12.test.ts, AI-12.gate.test.ts, AI-13.test.ts
- docs/planning/03-ai-features.md, decisions.md, README.md, _workspace/backend/spec-gaps.md

## 검사
- run-checks.sh: typecheck·lint·vitest(2,022)·pgTAP 통과. QA-09 수정 후 vitest src/server/ai 969 통과, typecheck 통과.
- 로컬 스모크 SKIP(요청·잡 경로 변경 없음). 실제 공급자로 대화 품질을 확인하지 않았다.

## 남은 것
- 열린 이슈 없음. 꼬리 질문 횟수는 모델이 대화 기록으로 센다 `[가정]` — 효과가 부족하면 extract에 depth_gaps를 더해 서버가 센다.
- 출시 영향: 마이그레이션·환경 변수 없음. main 머지 = 운영 반영.
