# S4 AI 작성 대화 (AI-12) 요약

## 만든 것
### DB (새 마이그레이션 6개)
- 테이블
  - `writing_chats`: 메시지 0~40, 정리 대기 표시 `last_extracted_sequence`, `structured_draft`는 어떤 역할도 직접 update할 수 없다
  - `writing_chat_messages`: assistant 행에 공급자 메타
- RPC (definer + 소유 검사)
  - `start_writing_chat`(고정 시작 인사)
  - `append_writing_chat_message`(사용자 메시지는 38개까지, 진행 중 턴이면 거부)
  - `begin_assistant_message` / `finish_assistant_message`(다시 보내기는 개수 불변)
  - `apply_structured_draft_patch`(행위자는 호출 역할로 판정하고 내부에서 다시 확인, V-9a·V-9h, 보호 필드)
  - `set_writing_chat_affiliation`, `mark_writing_chat_extracted`
  - `save_writing_chat` / `hand_off_writing_chat`(invoker: needs_review 건너뜀, 보강 모드는 빈 칸만, 소속은 컬럼에서, 스킬은 normalized_name으로 연결)
- `source_writing_chat_id` 복합 FK(set null). 대화만 삭제하면 커리어 행은 남는다.
- 삭제 RPC의 `writing_chat` 대상, 프로젝트 삭제 시 대화 cascade 개수

### AI
- 정리(extract): 경량 등급, 구조화 출력 → V-9a~h → DB 패치 형식
- 응답(reply): 기본 등급, 텍스트 스트림. 질문에 사실을 넣지 않도록 정리 값 없이 상태만 넘긴다.
- `focus_slots`(requested_slot 우선, 게이트 진입 필수 우선, `ready_to_return`) 순수 함수
- 픽스처 대화 6종과 한국어 변형 V-9 테스트

### API
- 턴 SSE `POST /api/writing-chats/[id]/turns`
  - 이벤트: `turn_started` → `reply_delta` → `reply_done` → `draft_patch` → `draft_flags` → `turn_done`(+ `error`)
  - 유료 등급은 병렬, 무료 등급은 응답 → 6초 → 정리
  - 정리 실패는 응답을 막지 않고, 다음 턴에 미처리 발화까지 함께 정리한다.
  - 성공한 호출은 다시 부르지 않는다.
  - 공급자 호출마다 사용 기록(`writing_chat.turn.{n}.*`)을 남긴다.
  - 실행 게이트를 메시지 추가보다 먼저 확인한다.
  - 최종 실패 시 `retry_after`는 C-11.3을 따른다.
- 다시 보내기, Server Actions(시작, 조회, 편집·수락·거절, 소속, 저장, 폼 전환, 그만두기, 삭제)
- 커리어 트리에 진행 중인 대화(남은 일수 포함)
- 로그에 대화 원문·키 없음. V-9는 개수만 로그에 남긴다.

## 검사
typecheck / lint / Vitest 910개 / build / pgTAP 1074개 모두 PASS

## QA
2라운드. Major 1건, Minor 6건을 모두 해결했고 열린 이슈는 없다. 사용자가 말하지 않은 값이 확인 없이 커리어 데이터에 닿는 경로는 찾지 못했다.

## 사용자 확인 필요 [가정]
1. 메시지 실제 최대가 39라서 화면 "n / 40"이 39에서 막힌다. 시작 인사를 40에 포함할지
2. 대화 턴은 분당 한도·장애에서 자동 재시도 0회, "다시 보내기"에 맡긴다
3. 무료 등급은 요청 안에서 최대 6초를 기다린다
4. 거절한 소속 제안을 저장할 곳이 없어 같은 제안이 다시 나올 수 있다(컬럼 추가는 기획 결정)
5. 그만둔 대화는 재개할 수 없다
6. 시작 인사 문구와 무료 등급 안내 문구

## 남은 일
- S5: 게이트 진입 대화의 지원 프로젝트 요건 목록(R-31)
- S9: 90일 자동 정리 크론
- UI 하네스: `patterns.md`의 AI-12 스트림 모양과 월 한도 문구를 갱신해야 한다
- 연결: S-36, S-08 화면이 없어 "연결 대기"
