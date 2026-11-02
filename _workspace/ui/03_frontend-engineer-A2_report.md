# A2 커리어 구현 보고 (Phase 3, 2026-10-25)

기준: 플로우 v4.2b · 데이터 모델 v3.2a · AI v3.2a · 디자인 시스템 v1 · A0 보고(라운드 1 규칙). 커밋하지 않음.
편집 범위: `src/app/(dashboard)/career/**`, `src/components/career/**`만. 파운데이션 파일은 건드리지 않음.

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---------|--------|--------------|------|
| S-08 | `/career` | `empty`, `loading`, `error`, `unauth`, `not-found`, (셸) `return-banner` | 상단 요약(프로필·완료 개수 4종·규칙 안내 1줄 → 해당 항목 링크), 시작 버튼 4개, 작성 중인 AI 대화(대상·마지막 활동·n/40·"N일 뒤 자동 삭제"·이어서·대화 삭제 C-05), 연도 > 경력/교육 머리(접힌 머리 포함) > 프로젝트 행(역할·요약·기간·스킬 3·상세 수, "+ 상세 내용", "AI와 상세 내용 추가") > 상세 내용 행(STAR 채움 표시·정량 성과 수), 기타 프로젝트, 연도 미정, 작성 중 배지, 스킬 보기. 모든 단계 접기/펴기 + localStorage 기억. 빈 상태: 명세 문구 + "AI와 대화하며 첫 프로젝트 정리하기" / "직접 입력"(+ 경력 / + 교육) |
| S-04 | `/career/profile` | `loading`, `error`, `unauth`, `not-found`, `save-failed` | display_name, desired_job_title, total_years_of_experience, interested_industries(태그). 자동 저장 C-06 |
| S-09 | `/career/experiences/new`, `/career/experiences/[id]` | `loading`, `error`, `unauth`, `not-found`, `save-failed` | 필수 3개(회사명·시작/종료 또는 재직 중·직급/직책 중 하나) + 선택(부서·고용 형태·요약 G-2), 소속 프로젝트(→ S-10, + 추가), 경력 단위 성과(S-11), C-06 + DraftNotice, C-05 삭제. **UQ-4**: 복귀 대상이 있으면 저장 후 `recordGateExperience(id)` → `notifyCareerSaved()` → `useGateContinuation().recheck()`. 완료 상태면 "경력이 저장됐어요" 카드에 `returnHref`("{기능}으로 돌아가기") 또는 `continueHref`("AI와 대화하며 채우기") |
| S-34 | `/career/educations/new`, `/career/educations/[id]` | 위와 같음 | 기관명*, 구분*(카드형 라디오), 전공/과정명, 시작*/종료(enrolled면 종료 비활성), 상태 5종, 설명 G-2, 소속 프로젝트, C-06, C-05(소속 프로젝트 처리 포함 — C-05 공통) |
| S-10 | `/career/projects/new?experience_id=|education_id=`, `/career/projects/[id]` | 위와 같음 | 소속 셋 중 하나(Select 그룹), 이름*·역할*, 한 줄 요약 ≤200 + 글자 수, 기간, 팀 규모, 사용 기술 태그(`setProjectSkills`), 상세 내용 목록(STAR 표시·정량 성과 수·상태·"출처 대화 보기"·위/아래 순서 변경 + aria-live), 완료 조건 안내, 상세 내용 0개 안내, "AI와 대화하며 상세 내용 추가"(→ S-36 보강), AI 작성 대화 기록(mode·status·last_activity_at, 열기/이어서, **대화만 삭제** C-05 writing_chat), C-05 프로젝트 삭제 |
| S-35 | `/career/projects/[id]/details/new`, `/career/projects/[id]/details/[detailId]?focus=` | 위와 같음 | 소속 경로 "경력/교육 › 프로젝트명", C-06, 제목*·상황(S)*·과제(T)·행동(A)*(G-1)·결과(R)+정량 성과 목록(S-11, G-3 조건부)·회고 및 배운 점(명세 안내 문구, 같은 모양), G-2 전 필드, G-4(과제·결과·회고 비었을 때), 2,000자 글자 수, 완료 조건 문구, "+ 같은 프로젝트에 상세 내용 추가", C-05. `?focus=` 필드 포커스 + ring + field-flash |
| S-11 | (모달, S-09·S-35에서) | S-35/S-09의 `save-failed` 따라감 | 연결 대상 고정(project_detail_id 또는 experience_id), metric_name, value_before → value_after, unit, description(G-2), kind 표시(자동), 자동 저장 C-06, 삭제는 모달 닫고 C-05 |
| S-12 | `/career/skills` | `empty`, `loading`, `error`, `unauth`, `not-found` | skills.name, 연결 프로젝트 수, is_manual("직접 추가"), 직접 추가 입력 |
| S-36 | `/career/writing-chats/new?mode&project_id&experience_id&education_id&application_project_id&feature`, `/career/writing-chats/[id]` | new: `limit`, `insufficient`, `loading`, `error`, `unauth`, `not-found` / [id]: `ai-failed`, `ai-failed-input`, `ai-failed-timeout`, `save-failed`, `message-limit`(화면 전용), `limit`(보강 대화 안내 0회), `loading`, `error`, `unauth`, `not-found` | 아래 상세 |
| C-15 | `src/components/career/writing-chat/source-chip.tsx` | — | CHIP_CLASS 공유. "내 답변 #n"(사용자 메시지 재번호), 클릭 → 해당 발화 스크롤 + field-flash + `source_quotes` mark. 상태 ① 출처 있음 ② 직접 수정 ③ 검토 필요(명세 문구 + [수락]/[거절(비우기)]) → 수락함 ④ 아직 없음. 보조 배지 "본인 역할 확인 중"(+ 툴팁과 같은 문구를 필드 아래에도 표시, 클릭 → 마지막 AI 질문) |

### S-36 구현 상세
- 시작 영역: 안내 + 보관 안내 문구 그대로, 소속 선택(경력/교육/없음/대화하면서 정할게요, 새 프로젝트 모드만; 기본값 = 쿼리 `experience_id`), "대화 시작(1회 사용, 이번 달 {N}/10회 남음)", 한도 시 ST-LIMIT(AI 작성 대화 덧붙임 문구) + 버튼 비활성, 한도 오류 응답도 같은 처리.
- **UQ-5**: 게이트 진입이면 `return_target = { application_project_id, feature, params: readCareerReturn()?.params ?? {} }`로 `startWritingChat`. 세션에 대상이 없으면(다른 탭 등) `markCareerReturn`으로 채움. 대화 화면 진입 시 DB `return_target`과 세션 대상을 맞춤(다른 기기 이어 하기).
- 게이트 배너: "{기능}을 위해 필요한 내용 · {기업 JD}" + C-09와 같은 부족 항목 문구, 충족 예상 시 "저장하면 충족돼요". `ready_to_return`이면 주 버튼 "저장하고 돌아가기"(저장 후 충족이면 `clearReturnTarget` + 원래 기능 화면으로 이동), 아니면 "저장" + "아직 필요: {항목}".
- 대화 영역: 진행 단계(기본 정보 › 상황 › 과제 › 행동 › 결과 › 회고 및 배운 점, 현재·채움 표시, 누르면 고정 문구 메시지 + requested_slot), 메시지 목록(AI 아바타·사용자 말풍선 "내 답변 #n", 사용자 발화 클릭 → 출처 필드 강조), AI 되묻기(본인 역할), 민감정보 안내 + 대화 삭제 바로가기, 입력창(빠른 응답 2개, G-2, n / 40, 36 이상 경고색, 상한 도달 시 비활성 + 명세 문구), 스트리밍(C-04 커서·중단), 실패한 턴 인라인 "답을 받지 못했어요 · 다시 보내기"(차감·메시지 수 없음).
- 정리 결과: 소속 칸(현재 소속, AI 제안 "'{이름}' 경력에 연결할까요? [연결][아니요]", 직접 고르기 → `set_writing_chat_affiliation`, 보강 모드 읽기 전용), 프로젝트 기본 정보(새 프로젝트: name/role/summary/start_month/end_month/team_size 필드 + 스킬, 보강: 기존 값 읽기 전용), 상세 내용 카드(새로/기존 — 기존 채워진 필드 "기존 내용" 잠금, 빈 필드만 편집), 필드 직접 수정(→ user_edit), 검토 필요 요약 버튼(첫 항목으로 이동), 자리 표시("아직 없음" + "AI에게 물어봐 줘" + "직접 입력"), 완료 조건 표시, 갱신 필드 field-flash, "정리 중" 표시.
- 저장 확인 다이얼로그: 명세 문구 구성(프로젝트 새로/기존 추가, 새 상세 N, 기존 '{제목}' 빈 칸 N개 채움, 정량 성과 N, 스킬 N(새 M), 작성 중 항목, 검토하지 않은 N개 저장 안 됨). 저장 실패 시 다이얼로그 유지 + "다시 저장".
- 폼으로 전환: 명세 확인 문구 → `hand_off_writing_chat` → S-10. 나가기 → S-08(자동 보존).
- 저장 완료 / 폼 전환 완료: 읽기 전용 + 완료 카드. **UQ-4**: `useGateContinuation()`의 `returnHref`("{기능}으로 돌아가기", 누르면 return_target 비움) / `continueHref`, "프로젝트 보기", "이 프로젝트에 상세 내용 더 추가하기"(+ 사용량 안내 1회).
- 1280px 미만: "대화 / 정리 결과 (검토 N)" 탭 + 새 내용 점(design-system P-5).

## 파일

- 라우트(전부 교체): `src/app/(dashboard)/career/{page, profile/page, skills/page, experiences/new/page, experiences/[id]/page, educations/new/page, educations/[id]/page, projects/new/page, projects/[id]/page, projects/[id]/details/new/page, projects/[id]/details/[detailId]/page, writing-chats/new/page, writing-chats/[id]/page}.tsx` — 모두 `ScreenSuspense` 패턴, 링크는 `routes.*`.
- 컴포넌트 `src/components/career/`: `actions.ts`(server actions), `form-parts.tsx`(섹션·필드·`useRowAutosave`·DangerZone), `fresh-key.tsx`(신규 폼 Activity 초기화, `bfcacheId`), `screen-state.tsx`(공통 ?state= 뷰), `career-tree.tsx`, `star-fill.tsx`, `profile-form.tsx`, `skill-add.tsx`, `experience-form.tsx`, `education-form.tsx`, `project-form.tsx`, `detail-form.tsx`, `achievement-dialog.tsx`(S-11), `achievement-list.tsx`
- `src/components/career/writing-chat/`: `chat-screen.tsx`, `chat-start.tsx`, `draft-preview.tsx`, `source-chip.tsx`(C-15), `gate.tsx`, `slots.ts`, `chat-view.ts`(뷰 모델), `mock-turn.ts`(**목 전용** AI 턴 계획기 — 파운데이션 요청 1)

## 미완료 / 부분 구현

| 화면 | 내용 | 이유 |
|------|------|------|
| S-10 | S-16 보완점에서 열 때 "관련 요건: {요건 content}" 참고 문구 | `routes.project(id)`에 요건 전달 파라미터가 없음 → 파운데이션 요청 3 |
| S-11 | C-02 "원본으로 이동"으로 특정 정량 성과 모달 자동 열기 | evidence href가 S-35 결과 필드까지만 감. `AchievementList`는 `openId`를 지원해 두었음 → 파운데이션 요청 4 |
| S-36 | 미리보기에서 정량 성과·스킬 직접 수정 | 표시·출처 칩만. 필드 텍스트 직접 수정은 지원 |
| S-36 | 실제 AI 턴(정리 패치) | 목 계획기(`mock-turn.ts`)가 규칙으로 흉내: 질문 순서, 긴 답 → needs_review, "우리/팀"만 → actor_ambiguous, 민감 단어 → 미반영, 회사명 언급 → 소속 제안, 기술명 → 스킬, "A에서 B로" → 정량 성과 |
| 전체 | 브라우저 상호작용 검수 | `next dev`에서 13개 라우트 서버 렌더·픽스처 내용 확인만 함. 대화 턴·저장·폼 전환·자동 저장 등 클라이언트 동작은 QA 브라우저 확인 필요 |

## [UI-가정]

| 화면 ID | 파일:줄 | 내용 |
|---------|---------|------|
| S-35 | `detail-form.tsx:22` | 필드별 2,000자 상한 |
| S-35 | `detail-form.tsx:26` | G-4 필드별 예시 문구 |
| S-09 | `experience-form.tsx:259` | 게이트 경로 저장 완료 카드 문구("경력이 저장됐어요" 등) |
| S-11 | `achievement-dialog.tsx:198` | `achievements.kind` 값 목록 미정 → 값 그대로/"자동으로 정해져요" |
| S-12 | `skills/page.tsx:38` | 빈 상태 문구(v3 명세 없음) |
| S-08 | `career-tree.tsx` RowMenu | 프로젝트 행에도 삭제 메뉴 |
| S-08 | `career-tree.tsx` | 접힘 상태 localStorage 기억(명세 [가정]), 규칙 안내 2종 |
| S-36 | `slots.ts:29` | "기본 정보" 단계 = 이름·역할(+ 상세 내용 제목). 상세 내용 제목을 묻는 위치 |
| S-36 | `slots.ts:86` | "물어봐 줘" 고정 문구 메시지 내용 |
| S-36 | `chat-screen.tsx` showFailed | 실패한 턴은 마지막 메시지일 때만 표시, 다시 보내 성공하면 숨김 |
| S-36 | `chat-screen.tsx:170` | 중단한 턴은 실패한 턴처럼 "다시 보내기"로 이어 감 |
| S-36 | `chat-screen.tsx` 민감정보 | 안내는 마지막 AI 메시지 아래 한 번(카운트가 늘 때마다 새로 붙이지 않음) |
| S-36 | `chat-start.tsx` | "없음"과 "대화하면서 정할게요" 모두 소속 null로 시작 |
| S-36 | `draft-preview.tsx` | 정량 성과·스킬은 표시만 |
| S-36 | `mock-turn.ts:8` | AI 패치를 목 저장소에 직접 씀(임시) |

## 기획 확인 필요

| 화면 ID | 질문 | 스펙 위치 |
|---------|------|-----------|
| S-36 | 진행 단계 "기본 정보"에 상세 내용 제목이 포함되는지(제목은 필수인데 단계 목록에 없음) | 02 S-36 대화 영역 · F-P1-13 (2) |
| S-36 | 소속 "없음"과 "대화하면서 정할게요"를 저장상 구분해야 하는지(둘 다 null) | 02 S-36 시작 영역 |
| S-36 | 실패한 턴을 다시 보내 성공한 뒤 실패 메시지를 기록에 남길지 | 02 S-36 실패한 턴 |
| S-36 | 사용자가 응답 스트림을 "중단"했을 때 처리(실패로 볼지, 부분 응답 저장 여부) | 02 C-04, S-36 |
| S-08 | 프로젝트 행 삭제 메뉴 허용 여부(명세는 경력·교육 머리만 "메뉴: 삭제") | 02 S-08 |
| S-35 | G-4 예시 문구, 2,000자 상한 확정 | 02 C-07, S-35 |
| S-09 | 게이트 경로에서 경력 저장 완료 시 보여 줄 문구 | 02 C-09 경력이 없을 때 |
| S-12 | 빈 상태·직접 추가 동작(v3 명세 부재) | 02 S-12 "v3와 같음" |

## 파운데이션 요청

1. **목 AI 턴 쓰기 함수** (`src/lib/mock` / `writing-chats.ts`): AI 출처(`origin = 'ai'`) 필드를 `structured_draft`에 쓰는 함수가 없어 `src/components/career/writing-chat/mock-turn.ts`가 목 저장소를 직접 수정함. `completeMockAssistantTurn(chatId, content, failed, draftPatch)` 같은 형태로 옮겨 주시면 A2 파일은 그 함수를 부르도록 바꾸고 mock-turn.ts의 저장 부분을 지우겠습니다. (user_edit/accepted 미덮어쓰기, clarifications, sensitive_flags_count, affiliation_suggestion, skills, achievements 포함)
2. **UQ-24 — `return-banner.tsx`**: S-36 안에서는 C-10 배너가 "AI와 대화하며 채우기"(새 S-36 대화)를 띄우면 안 됨(이미 대화 중). `ReturnBanner`/`CareerReturnSlot`에 `/career/writing-chats/*` 경로에서 continue 버튼을 숨기는 조건(또는 `hideContinue` prop)을 요청. 가능하면 S-36에서는 C-10을 S-36 게이트 배너와 겹치지 않게 축약형(돌아가기 링크만)으로.
3. **`routes.project(id, { requirement_id })`**: S-16 보완점 → S-10 "관련 요건: {요건 content}" 참고 문구용 쿼리(ID만). A3(S-16)와 함께 필요.
4. **정량 성과 근거 이동**: `evidence.ts`의 achievement href에 `?achievement={id}`(S-35/S-09) 추가 요청 — A2 쪽 `AchievementList openId`는 준비됨(페이지에서 쿼리 연결만 하면 됨).
5. (참고) `WRITING_CHAT_MESSAGE_LIMIT`·`daysUntilAutoDelete`는 `writing-chats.ts`가 서버 전용 모듈이라 클라이언트에서 import 못 해 A2에 같은 값(40, 90일)을 상수로 둠. 클라이언트 안전한 `labels.ts` 등으로 옮겨 주시면 교체하겠습니다.

## 검사 결과

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과(작업 중간에 A3/A4 파일의 `ErrorKind` 타입 오류가 보였으나 최종 실행에서는 0건)
- `pnpm build` — 통과(다른 영역 빌드와 겹쳐 대기 후 실행). 36개 페이지, 커리어 13개 라우트 Partial Prerender
- `next dev -p 3412` 확인: 위 13개 라우트(+ `?state=empty/loading/limit`, 없는 대화 ID) 모두 200, 픽스처 내용(트리 프로젝트명, 작성 중 대화, S-36 검토 필요·본인 역할 확인 중·게이트 배너, not-found 화면) 렌더 확인, 개발 로그 오류 0건. 클라이언트 상호작용은 미확인(QA 필요)

---

## 라운드 1 수정 (QA `03_ui-qa_A2_review.md` 반영, 2026-10-25)

A2 폴더만 수정. `lib/`, `components/common/`, `components/ui/`는 건드리지 않음. 커밋하지 않음.

### 이슈별 처리

| ID | 심각도 | 처리 | 내용 (파일) |
|----|--------|------|-------------|
| UQ-60 | Major | 수정 | 실패한 턴 자리에 "답을 받지 못했어요 · 다시 보내기" + 다음 줄에 `error_category`별 문구(`AI_FAILED_TITLES`: transient/input/timeout) + "사용량은 차감되지 않았습니다"(ShieldCheck). 스트림 `error` 이벤트의 `error_category`를 기억해 씀. 새로 고친 뒤처럼 분류를 모를 때는 transient 문구 [UI-가정] (`writing-chat/chat-screen.tsx` `FailedTurn`) |
| UQ-61 | Major | 수정 | 미리보기 정량 성과를 필드 단위로 그림(`details.0.achievements.{i}.metric_name / value_before / value_after / unit`). 각 필드가 C-15 네 상태를 보이고, 검토 필요면 [수락]/[거절(비우기)], 직접 수정 가능. `data-needs-review`가 붙어 "검토가 필요한 항목 N개"를 누르면 그 항목으로 이동. 저장 확인 다이얼로그의 "검토하지 않은 항목 N개는 저장되지 않아요"에 정량 성과도 포함(목 요약 함수가 이미 셈). **남은 빈틈(파운데이션)**: 목 `persistChat`(`lib/data/writing-chats.ts`)이 정량 성과·스킬을 커리어 테이블에 쓰지 않아, 저장 요약에는 "정량 성과 N건"으로 나오지만 실제로는 저장되지 않음 → 파운데이션 요청 6 (`writing-chat/draft-preview.tsx`) |
| UQ-62 | Major | 수정 | S-11: "완료"·Esc·바깥 클릭·닫기 버튼이 모두 같은 절차를 탐 — 대기 중 입력을 저장하고, 저장이 실패했으면 닫지 않고 "저장하지 못한 내용이 있어요" 경고 + [다시 시도] / [계속 편집] / [그래도 닫기]를 보임. 실패한 값은 폼에 그대로 남음 (`achievement-dialog.tsx`) |
| UQ-64 | Minor | 수정 (기획 질문 유지) | 사용자가 중단한 턴은 실패 문구 대신 "중단했어요 · 다시 보내기"(muted, 실패 아님). 처리 방식 자체는 기획 확인 필요로 유지 [UI-가정] (`chat-screen.tsx`) |
| UQ-65 | Minor | 수정 | DB `return_target` → 세션 복귀 대상 동기화를 `status = 'active'` 대화에서만 함. 끝난 대화를 열어도 복귀 배너가 다시 생기지 않음 (`chat-screen.tsx`) |
| UQ-66 | Minor | 수정 | 세션 대상의 `application_project_id`와 `feature`가 둘 다 같을 때만 params를 넘김 (`chat-start.tsx`) |
| UQ-67 | Minor | 수정 | S-35 STAR 필드 `maxLength=2000`, 제목 `maxLength=100` + 글자 수 표시, 저장 값도 상한에서 자름(붙여 넣기 대비) (`form-parts.tsx` LongTextField, `detail-form.tsx`) |
| UQ-68 | Minor | 수정 | G-3 "+ 정량 성과"가 S-11 모달을 바로 엶(`AchievementList`에 `controlRef.openNew`) (`achievement-list.tsx`, `detail-form.tsx`) |
| UQ-69 | Minor | 수정 | 미리보기 직접 수정 입력에 `aria-label={필드 이름}`. 수락·거절 버튼 이름을 "{필드} 수락" / "{필드} 거절(비우기)"로 (`draft-preview.tsx`, `source-chip.tsx` `fieldLabel`) |
| UQ-70 | Minor | 수정 | 1280px 미만 전환을 shadcn `Tabs`(tablist/tab/tabpanel, aria-controls, 화살표 키)로 바꿈. 두 열은 `forceMount` TabsContent라 1280 이상에서는 둘 다 보임. 탭 목록 `sticky top-0`. 새 내용 점은 `aria-hidden` + sr-only "새 내용 있음" (`chat-screen.tsx`) |
| UQ-71 | Minor | 수정 | "정리 중"을 `AiProgressInline label="정리 중"`(C-03 축약형)으로 (`chat-screen.tsx`) |
| UQ-72 | Minor | 수정 | A2의 아이콘 버튼(접기/펴기, 행 메뉴, 대화 메뉴, 순서 변경, 정량 성과 편집, 직접 수정, 태그 빼기)을 좁은 화면 `size-11`(44px), `lg` 이상은 원래 크기로 (`career-tree.tsx`, `project-form.tsx`, `achievement-list.tsx`, `draft-preview.tsx`, `profile-form.tsx`, `chat-screen.tsx`) |
| UQ-73 | Minor | 수정 | 총 경력: 숫자만, 0~50으로 자름, 정수만 저장(범위 밖·소수는 null) + 도움말 "0~50 사이 정수" (`profile-form.tsx`) |
| UQ-74 | Minor | 수정 | 보강 모드 읽기 전용 값에 기간·팀 규모·기존 사용 기술 추가. 이번 대화의 스킬은 "이번 대화에서 나온 사용 기술"로 따로 표시 (`draft-preview.tsx`) |
| UQ-75 | Minor | 수정 | 폼 전환 실패 시 다이얼로그 유지 + "옮기지 못했어요. 정리 결과는 그대로 있어요. 다시 시도해 주세요" + 버튼 "다시 시도" (`chat-screen.tsx`) |
| UQ-76 | Minor | 수정 | 직급/직책 오류 문구에 `CircleAlert` + `id`, 두 입력의 `aria-describedby`가 그 문구를 가리킴(`TextField`에 `describedBy` 추가) (`experience-form.tsx`, `form-parts.tsx`) |
| UQ-80 | Minor | 수정 | 게이트 배너: 이미 충족(`f.ready`)이면 "필요한 내용이 모두 채워졌어요"만, "저장하면 충족돼요" 배지는 미충족 + 충족 예상일 때만. `featureHref`가 params를 받아 `cover_letter` + `params.draft_id`면 S-18로 감 [UI-가정: params 키 이름 `draft_id`는 A3와 맞춰야 함] (`writing-chat/gate.tsx`, `chat-screen.tsx`, `chat-start.tsx`) |
| UQ-81 | Minor | 수정 | 복귀 대상이 있는 동안 S-08 연도 머리를 sticky에서 static으로 바꿔 C-10 배너에 가리지 않게 함(배너 높이가 줄바꿈에 따라 달라 고정 오프셋 대신) [UI-가정] (`career-tree.tsx`) |
| UQ-24 · UQ-63 · UQ-77 · UQ-78 · UQ-79 | — | 파운데이션 몫, 대기 | 파운데이션 배치가 끝나면 새 API로 바꿀 예정. UQ-79는 라우트·근거 href가 생기면 A2가 `routes.project(..., requirement)` / `AchievementList openId` 연결 |
| UQ-82 | 기획 | 유지 | 화면 표시는 그대로(02 기준), 기획 확인 필요 |

### 추가 파운데이션 요청

6. **목 `persistChat`의 정량 성과·스킬 저장** (`lib/data/writing-chats.ts`): `save_writing_chat` / `hand_off_writing_chat` 목이 `projects`·`project_details`만 쓰고 `achievements`·`skills`·`project_skills`는 쓰지 않음(검토 필요가 아닌 정량 성과도 빠짐). 저장 확인 요약 문구와 실제 결과가 다름. UQ-61의 "소리 없이 빠지는 값" 중 남은 부분.
7. (UQ-80 관련, A3와 조율) 자기소개서 게이트의 `return_target.params`에 문항 설정 화면 draft ID를 어떤 키로 넣는지 — A2는 `draft_id`로 가정.

### 새 [UI-가정]

| 화면 ID | 파일 | 내용 |
|---------|------|------|
| S-36 | `chat-screen.tsx` `FailedTurn` | 새로 고침 뒤처럼 실패 분류를 모르면 transient 문구 |
| S-36 | `chat-screen.tsx` `FailedTurn` | 중단한 턴 문구 "중단했어요 · 다시 보내기" |
| S-36 | `gate.tsx` | 자기소개서 복귀 params 키 `draft_id` |
| S-08 | `career-tree.tsx` | 복귀 배너가 있을 때 연도 머리 sticky 해제 |
| S-04 | `profile-form.tsx` | 총 경력 도움말 "0~50 사이 정수" |
| S-11 | `achievement-dialog.tsx` | 닫기 확인 문구·버튼 3개 |

### 검사 결과 (라운드 1)

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — **A2 파일 오류 0**. 실패 2건은 A3 파일: `src/components/applications/draft-editor.tsx(196,39)`, `(197,20)` "TS2554: Expected 3 arguments, but got 2."(실행 중간에는 `src/app/(dashboard)/applications/_lib/actions.ts(112,10)`, `(120,10)`의 같은 오류도 보였음. A3 작업 중으로 보임, 손대지 않음)
- `pnpm build` — `✓ Compiled successfully` 후 위 A3 타입 오류로 "Failed to type check." A3가 고치면 다시 돌려야 함
- 브라우저 상호작용(모달 닫기 확인, 탭 키보드, 실패한 턴 문구, 정량 성과 수락/거절)은 확인하지 않음 — QA 브라우저 확인 필요

---

## BYOK 반영 (2026-10-28)

기준: 브리프 `05_brief_byok.md`, design-system v2(3.18 C-18 · 3.19 C-19 · 3.20 C-20 · 3.22 AiRunButton · C-03 순차·대기 줄 · 5.4 · A2 메모), 기획 PRD v4.2 · 플로우 v5.2 · AI v4.2 · 데이터 모델 v4.1a, A0 "BYOK 파운데이션" 보고. A2 폴더만 수정, 커밋하지 않음. 파운데이션이 먼저 고친 A2 파일(`actions.ts`, `chat-start.tsx`, `chat-screen.tsx`, S-36 페이지 2개, mock-turn → `lib/data` 이전)은 그대로 이어받아 다듬었다.

### 화면별 반영

| 화면 | 반영 내용 | 파일 |
|------|-----------|------|
| S-08 | 시작 버튼 줄을 키 없이 되는 "+ 경력 / + 교육 / + 프로젝트" 먼저, 그 아래 "AI와 대화하며 프로젝트 정리하기"는 `AiRunButton`(키 있음: C-19 배지, 키 없음: C-18 인라인 + 대안 "직접 입력" → S-10 신규). 빈 상태 기본 시작점을 **"직접 입력"(주 버튼, + 경력 / + 교육)**으로 바꾸고 AI 첫 프로젝트 정리는 보조 `AiRunButton`. 프로젝트 행 "AI와 상세 내용 추가"는 키 없음이면 잠금 아이콘 버튼 → AI 연결(FL-19 복귀 대상 기억). 작성 중인 AI 대화 목록은 키 없이도 그대로 보임(D-36) | `career-tree.tsx` |
| S-10 | "AI와 대화하며 상세 내용 추가" → `AiRunButton`(C-18 인라인 / C-19 배지, 대안 "직접 입력" → S-35 새 상세 내용) | `project-form.tsx` |
| S-35 | AI 진입점 없음(F-P1-08 필드 다듬기는 Should) — 변경 없음 | — |
| S-09 | C-09 "경력이 없을 때" 저장 완료 카드: 다음 단계를 `GateNextStep`으로 — 키 있음 + `next_action = writing_chat`이면 "AI와 대화하며 채우기", 키 없음·무효이면 폼 경로 **"직접 입력하기"**(이 경력 소속 새 프로젝트). 무효면 C-20 `key_invalid` 한 줄 + "키를 확인하면 AI와 대화로 채울 수 있어요 [AI 연결 확인]". AI 언급 문구 삭제 | `experience-form.tsx`, 새 `gate-next-step.tsx` |
| S-36 시작 | 키 없음 → **시작 영역 전체를 C-18 영역형**(기존 결과 없음, D-UX-15)으로 대체, 대안 "직접 입력"(새 프로젝트 / 보강이면 S-35 새 상세 내용). 키 있음 → "대화 시작" + C-19 배지, 무료 등급이면 "무료 등급은 응답이 조금 느릴 수 있어요". 횟수 표시 없음(D-34). 키 무효 → 버튼은 보이고 누르면 C-20 `key_invalid`(AiRunButton 기본 동작) | `writing-chat/chat-start.tsx` |
| S-36 대화 | ① 키 없음(`ai-locked`): 대화 기록·정리 결과는 그대로 열람·직접 수정·저장·폼 전환(D-36). 입력창 위에 C-18 인라인("새 메시지를 보내려면 AI 연결이 필요해요…", 대안 "폼으로 전환"), 보내기·빠른 응답·단계 버튼 비활성, **입력한 글자는 지우지 않음**. ② 키 무효(`key-invalid`): 보내기를 누르면 전송하지 않고 C-20 `key_invalid` inline, 입력 보존. ③ 실패한 턴 = C-20 inline(원인 7종 + 시스템·`key_missing`), "다시 보내기", `input_too_long`은 "답변을 줄여 주세요" + 입력으로 이동. 중단은 실패가 아닌 "중단했어요". ④ 게이트 대화의 첫 턴이 실패하면 그 아래 "AI 대화 대신 직접 입력으로 채울 수도 있어요 [직접 입력하기]"(C-09 v5 대화 실패 분기). ⑤ 무료 등급: "정리 중 · 무료 등급이라 하나씩 처리해요". ⑥ `ai-waiting`: 첫 글자 전 `Hourglass` "공급자 요청 한도로 잠시 기다리는 중 (N초)"(실패 아님). ⑦ 대화 상단 C-19 배지(파운데이션 반영 유지). ⑧ 메시지 상한 40: 명세 v5 문구 "대화가 길어져 정리 정확도가 떨어질 수 있어요. 지금까지 내용을 저장하거나 새 대화로 이어 가세요" + [저장] / [폼으로 전환] / [새 보강 대화]. ⑨ 저장 완료 카드: 다음 단계 `GateNextStep`(키 없음·무효 → 폼 경로), "이 프로젝트에 상세 내용 더 추가하기"는 `AiRunButton`(잠금·배지). 월 10회·사용량 안내 완전 삭제 | `writing-chat/chat-screen.tsx` |
| C-10 (A2 쪽) | S-09·S-36 완료 카드의 계속 버튼이 키 없음·무효면 폼 경로로(위). 배너 자체(`return-banner.tsx`)는 파운데이션 몫 | `gate-next-step.tsx` |
| 공통 | A2 안의 한도·사용량·차감 문구 0건(코드 주석 포함). `screen-state.tsx`·S-36 페이지 주석의 `?state=` 목록 갱신 | — |

### `?state=` (A2, BYOK 추가분)

| 화면 | 값 |
|------|----|
| S-08 | `ai-locked`(AI 버튼·행 버튼 잠금), `key-invalid`, `key-check`(배지만) + 기존 `empty`/`loading`/`error`/`unauth`/`not-found` |
| S-10 | `ai-locked`, `key-invalid`, `key-check` + 기존 |
| S-09 (게이트 경로) | `ai-locked`/`key-invalid`이면 완료 카드가 폼 경로 |
| S-36 새 대화 | `ai-locked`(영역형), `key-invalid`, `key-check`, `insufficient`, `loading`/`error`/`unauth`/`not-found`. `limit` 삭제 |
| S-36 대화 | `ai-locked`, `key-invalid`, `key-check`, `key-missing`(ST-AI-KEY-MISSING 턴), `ai-waiting`, `ai-failed-rate-limited` · `-daily-quota` · `-billing` · `-key-invalid` · `-model` · `-provider` · `-input-rejected`, `ai-failed`(schema_invalid), `ai-failed-timeout`, `save-failed`, `message-limit` + 기존 |

### [UI-가정] (BYOK)

| 화면 | 파일 | 내용 |
|------|------|------|
| S-08 | `career-tree.tsx` `RowAiAugment` | 트리 행은 공간이 좁아 C-18 인라인 카드 대신 잠금 아이콘 버튼(→ AI 연결, 접근성 이름에 "AI 연결하면 사용할 수 있어요") |
| S-08 | `career-tree.tsx` | 시작 줄 순서: 직접 입력 버튼 3개 → AI 버튼(명세 표 순서). 빈 상태 AI 버튼은 outline 보조 |
| S-36 | `chat-screen.tsx` | 진행 중 대화의 잠금 설명 문구, 대안 = "폼으로 전환" |
| S-36 | `chat-screen.tsx` | 키 무효에서 보내기를 누르면 서버에 보내지 않고 C-20만 보임(입력 보존) |
| S-36 | `chat-screen.tsx` | `ai-waiting` 대기 줄은 화면에서 6초 흉내(목 스트림에 대기 이벤트 없음) |
| S-36 | `chat-screen.tsx` | 무료 등급 "정리 중" 문구 "정리 중 · 무료 등급이라 하나씩 처리해요" |
| S-36 | `chat-screen.tsx` | 게이트 대화 첫 턴 실패 시 폼 경로 안내 문구 "AI 대화 대신 직접 입력으로 채울 수도 있어요" |
| S-36 | `chat-screen.tsx` | 메시지 상한 [새 보강 대화]는 프로젝트가 정해진 대화에서만 |
| S-09·S-36 | `gate-next-step.tsx` | 폼 경로 목적지: 경력 소속 새 프로젝트 / 보강 대상 프로젝트의 새 상세 내용 |

### 기획 확인 필요 (BYOK)

| 화면 | 질문 | 스펙 위치 |
|------|------|-----------|
| S-36 | 키가 없을 때 진행 중 대화의 입력창 처리 — 잠금 + 입력 보존(지금)인지, 입력창을 숨기는지 | 02 S-36 상태, FL-14 "새 메시지를 보낼 때 C-20" |
| S-36 | 키 없음 상태에서 "새 메시지를 보낼 때 C-20(key_missing)"을 보일지 C-18을 보일지 — 지금은 미리 C-18 인라인, 실행 중 삭제(`key-missing`)는 C-20 | 02 C-18 / C-20 `key_missing` / ST-AI-KEY-MISSING |
| S-08 | 트리 행 "AI와 상세 내용 추가"에도 C-18 인라인형이 필요한지(행마다 카드) | 02 C-18 진입점 표 |
| S-36 | 메시지 상한의 [새 보강 대화]를 새 프로젝트 대화(아직 프로젝트 없음)에서는 어떻게 할지 | 02 S-36 메시지 상한 |

### 파운데이션 요청 (BYOK)

8. **목 대화 턴 스트림 대기 이벤트**: `mockChatTurn`/`useChatTurnStream`에 `rate_wait`(첫 토큰 전 자동 재시도 대기, 남은 초) 이벤트가 없어 S-36 `ai-waiting`을 화면에서 흉내 냄. 이벤트가 생기면 교체.
9. **S-36 실패한 턴의 `retry_after` / `quota_resets_at`**: 스트림 `error` 이벤트에 이 값이 없어 C-20이 기본값(다음 KST 16:00 등)으로 계산함. 이벤트(또는 실패 메시지의 `ai_job_id` 작업)에 실어 주면 연결.
10. **키 없음/무효 상태의 `sendWritingChatTurn` 거절**: 지금은 화면이 미리 막지만, 서버 쪽도 키 없음이면 메시지를 추가하지 않고 `key_missing`/`key_invalid`로 거절해야 함(현재 목은 그대로 추가).
11. (이전 요청 유지) UQ-24 S-36에서 C-10 "AI와 대화하며 채우기" 숨김, 6 `persistChat` 정량 성과·스킬 저장, 3·4 요건/정량 성과 쿼리.

### 검사 결과 (BYOK)

- `pnpm lint` — 통과(오류·경고 0)
- `pnpm typecheck` — 통과
- `pnpm build` — 통과(39 페이지)
- `pnpm exec next dev -p 3417`(확인 후 종료): `/career`(기본·`empty`·`ai-locked`), S-10, S-36 새 대화(기본·`ai-locked` → C-18 영역형 렌더, "대화 시작" 없음), S-36 대화(기본·`ai-locked` → 기록 보이고 입력 위 C-18 인라인·`ai-failed-daily-quota`) 모두 200, 개발 로그 오류 0건. 대화 턴·실패 문구·대기 줄·폼 경로 버튼 같은 클라이언트 상호작용은 브라우저로 보지 않음(QA 필요)

---

## BYOK 라운드 1 수정 (QA `06_ui-qa_byok_A2_review.md` 반영, 2026-10-28)

A2 폴더만 수정, 커밋하지 않음.

| ID | 처리 | 내용 (파일) |
|----|------|-------------|
| UQ-290 | 수정 | S-36 대기 줄: "공급자 요청 한도로 잠시 기다리는 중"만 `role="status"`(한 번 낭독), 줄어드는 초는 `aria-hidden` 칸으로 뺌. 대기가 끝나면 sr-only live 줄에 "대기가 끝나 응답을 받고 있어요" 한 번 (`writing-chat/chat-screen.tsx`) |
| UQ-291 | 수정 | 아이콘+글자 children인 잠금 대상 버튼에 `chatLock(기능)` 헬퍼로 `actionName`·`featureLabel`·설명 "{기능} · 질문에 답하면 AI가 …"를 넘김 → 잠금 카드에 기능 이름이 보이고 접근성 이름 앞에 읽히며, FL-19 복귀 대상·토스트에도 그 이름이 들어감. 적용: S-08 시작 줄·빈 상태, S-10 AI로 보강, S-36 시작 "대화 시작", S-36 완료 카드 "이 프로젝트에 상세 내용 더 추가하기" (`gate-next-step.tsx` `chatLock`, `career-tree.tsx`, `project-form.tsx`, `chat-start.tsx`, `chat-screen.tsx`). S-36 대화 입력 잠금에도 `featureLabel="AI 작성 대화"` |
| UQ-292 | 수정 | S-36 시작의 폼 대안("직접 입력")이 게이트 소속(쿼리 `experience_id` / `education_id`)을 유지한 새 프로젝트로 감. 키 무효면 "대화 시작" 아래에 "키를 확인하는 동안 직접 입력으로 채울 수도 있어요 [직접 입력]" 상시 표시(누르면 C-20 `key_invalid`는 그대로) (`chat-start.tsx`) |
| UQ-293 | 수정 | 작성 중인 답변을 대화 ID별 sessionStorage(`resumate.chat-draft.{id}`)에 보관, 화면이 새로 만들어져도(AI 연결 다녀오기) 복원, 보내면 지움 (`chat-screen.tsx`) |
| UQ-294 | 수정 | 키 없음에서 미리보기 "AI에게 물어봐 줘", 실패 턴 "다시 보내기", 단계 버튼 외 보내기 경로가 모두 대화 탭으로 가서 입력창 위 C-18 카드로 스크롤 + "AI 연결하기"에 포커스 (`chat-screen.tsx` `showLock`) |
| UQ-295 | 수정 | `writing_chat_messages.provider`(+ `model_tier`/`model`)가 앞 AI 턴과 달라지는 메시지 위에 "이 답변부터 공급자가 바뀌었어요" + C-19 결과 배지(`ProviderResultTag`) (`chat-screen.tsx` `AiMessage`) |
| UQ-296 | 수정 (일부 파운데이션) | 실패 원인을 모르는 실패 턴(새로 고침 뒤 기록된 턴)은 공급자 장애로 단정하지 않고 "답을 받지 못했어요. 잠시 후 다시 시도해 주세요 · 다시 보내기". 실제 원인 표시는 파운데이션 요청 9(실패 턴의 작업 `error_code`/`retry_after`/`quota_resets_at` 노출) 후 연결 (`chat-screen.tsx` `FailedTurn`) |
| UQ-298 | 수정 | `GateNextStep`에 `loading`: 복귀 대상이 있고 readiness를 아직 못 불렀거나 AI 연결 상태가 로드 전이면 버튼 자리에 스켈레톤(+ sr-only "다음 단계를 확인하는 중")만 보임 → "직접 입력하기"가 먼저 번쩍이지 않음 (S-09·S-36 완료 카드) |
| UQ-297 | 기획 | 손대지 않음 |

### 새 [UI-가정]
- C-18 인라인 설명을 "{기능} · {기능 설명}" 형태로 보이게 함(`chatLock`).
- 공급자 변경 표시 문구 "이 답변부터 공급자가 바뀌었어요", 첫 AI 턴에는 표시하지 않음.
- 키 무효 시 S-36 시작의 폼 대안 문구 "키를 확인하는 동안 직접 입력으로 채울 수도 있어요".
- 대화 초안은 브라우저 세션(sessionStorage)에만 보관.

### 검사 결과
- `pnpm lint` 통과 · `pnpm typecheck` 통과 · `pnpm build` 통과(39 페이지)
- `pnpm exec next dev -p 3418`(확인 후 종료): `/career?state=ai-locked`(잠금 카드에 기능 이름), S-10 `ai-locked`(기능 이름), S-36 새 대화 게이트 소속 + `ai-locked`(대안 링크가 `projects/new?experience_id=…`), `key-invalid`(폼 대안 줄 렌더), S-36 대화 `ai-locked` 모두 200, 로그 오류 0. 대기 줄 낭독·초안 복원·잠금 포커스 이동·스켈레톤 전환은 브라우저 미확인(QA)
