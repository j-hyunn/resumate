# W2 API 구현 노트 (커리어·AI 작성 대화 연결)

커밋, 원격 적용, 배포, 실제 공급자 호출 없음. `supabase db reset`도 하지 않았다. 로컬 스택에 내가 만든 시험 계정만 썼고 끝나고 지웠다.

## 연결한 함수
| 파일 | 함수 | 경유 |
|------|------|------|
| `lib/data/career.ts` | `getProfile`, `updateProfile`, `listExperiences`, `listEducations`, `getExperience`, `getEducation`, `getProject`, `getProjectDetail`, `listSkills`, `getCareerTree`, `saveExperience`, `saveEducation`, `saveProject`, `setProjectSkills`, `saveProjectDetail`, `reorderProjectDetails`, `saveAchievement`, `addManualSkill` | `services/career`, `services/profile`, 새 `services/career/rows.ts` |
| `lib/data/writing-chats.ts` | `listActiveWritingChats`, `listAbandonedWritingChats`, `getWritingChat`, `startWritingChat`, `applyStructuredDraftPatch`, `setWritingChatAffiliation`, `getWritingChatSaveSummary`, `saveWritingChat`, `handOffWritingChat`, `clearReturnTarget`, `abandonWritingChat`, `resumeWritingChat`, `sendWritingChatTurn`, `retryWritingChatTurn`, `completeWritingChatTurn`, `markWritingChatSlotAsked` | `services/writing-chat/chat`, SSE 라우트 |
| `lib/data/writing-chat-view.ts` | `buildChatView` | 실제 행 + `getDataReadiness` |
| `lib/data/deletion.ts` | `getDeletionImpact`, `deleteCareerItem` (W2 몫만) | `services/career` |

미리보기(`?state=`, `/dev/`)는 전부 `previewOr`의 mock 분기다.

## 함수 호출 방식 (W1과 다른 점 1개)
W1은 Server Action을 부르라고 했지만, 여기서는 서비스를 바로 부른다. 화면 타입이 DTO가 아니라 테이블 행이라 저장 뒤 행을 다시 읽어야 하는데, Action을 끼우면 자동 저장 1번에 인증·계정·동의 확인이 두 번 돈다. 데이터 함수 안에서 `requireConsentedUser()` 1번, 계약의 zod로 검사, 서비스 호출 순서로, Action과 같은 일을 한다.

## 연결 방식에서 판단한 것
- **읽기**: `loadCareerRows`로 표 8개를 한 번 읽고 mock과 같은 조인 코드를 쓴다(DM §2.4: 사용자당 수십 행). `getCareerTree`만 서비스의 `groupCareerByYear`를 쓴다.
- **자동 저장**: 서비스는 새 행에 클라이언트 id, 수정에 `expectedUpdatedAt`을 요구하는데 시그니처에 없다. id가 없으면 서버가 만들고, 수정은 직전에 읽은 `updated_at`을 쓴다. 없는 id는 `not_found`로, 지운 행을 되살리지 않는다. `WriteOptions`에 선택 값 `client_id`, `expected_updated_at`을 더했다(시그니처 호환). 폼은 아직 보내지 않는다.
- **대화 턴**: 컴포넌트를 고치지 않고 연결했다. `sendWritingChatTurn`·`retryWritingChatTurn`이 실제 경로에서 `{ endpoint, body }`를 함께 돌려주고, `chat-screen`의 `turn.start({ ...spec })`에 그대로 펼쳐져 `isRealStreamRequest`가 라우트로 보낸다. 미리보기에서는 이 키가 없어 mock 스트림이다. `usePreviewState` 분기가 필요 없었다.
- **거부**: 라우트의 잠금은 스트림 안의 `error` 하나라 화면에 메시지가 먼저 뜬다. 그래서 전송 전에 `readChatConnection`을 확인해 `withAiGuard` → `{ rejected }`로 돌려준다(저장 없음, 입력 유지). 라우트도 다시 확인한다.
- **턴 완료**: `completeWritingChatTurn`은 라우트가 이미 저장했으므로 할 일이 없다. 실패·중단일 때만 답변 행이 `streaming`을 벗어나기를 최대 1.5초 기다린다(중단 요청이 라우트에 늦게 닿는 경우).
- **중단**: `canceled` 작업은 `turnFailures`에서 뺀다. mock도 실패 행을 남기지 않아 다시 읽으면 중립 문구다.
- **미리보기 카드 경로**: 화면의 `details.0.fields.x`를 RPC 주소(`detail_key`, `existing_detail_id`, `achievement_key`)로 바꾼다. 첫 카드가 없는 수정은 `new_detail` + `set`, 보강 모드는 첫 작성 중 상세 내용을 대상으로 한다.
- `requestedSlot`: 이름·역할·제목 → `basic_info`, 나머지는 그대로. 계약에 맞춘 변환이다.

## 연결하지 않은 함수와 이유
| 함수 | 이유 |
|------|------|
| `appendWritingChatMessage`, `completeMockAssistantTurn` | mock 분기 전용. 실제는 라우트가 저장한다 |
| `isExperienceComplete` 등 판정 함수 | 순수 함수. 실제 status는 DB가 계산한다. 저장 요약과 `projectedReady`에서만 쓴다 |
| `lib/data/evidence.ts` | 커리어 항목을 읽지만 호출처가 W3 화면이다. 이 파일은 내 담당으로 배정되지 않아 건드리지 않았다. **W3가 연결했는지 리더 확인 필요** |

서비스에 있지만 화면 함수가 없어 안 쓰는 것: `updateSkill`, `removeProjectSkill`의 직접 호출(태그 교체 안에서만), `listProjectWritingChats`(S-10은 `getProject`의 `writing_chats`로 읽는다), `deleteWritingChat`(`deleteCareerItem`과 같다).

`src/components/`, 페이지, `src/lib/mock/`, `src/types/db.ts`, `source.ts`, `ai-*.ts`는 고치지 않았다.

## 무엇을 어떻게 확인했나
### 실제 행 + 실제 HTTP (`next start` 3210, 실제 세션 쿠키, Server Action 직접 호출): 42개 통과
- S-09·S-34·S-10·S-35·S-11·S-12·S-04 생성·수정, 같은 값 반복 저장 후 경력 1행.
- 페이지 GET에 실제 값이 보임: `/career`, 경력·교육·프로젝트·상세 내용 편집, `/career/skills`, `/career/profile`, S-36. `/career`에 fixture 없음. 없는 프로젝트 id는 500이 아님.
- C-05 영향 수치, 프로젝트·대화 삭제.
- S-36 시작, 키 없는 전송 `{ rejected: key_missing }`, **실제 SSE 라우트** 키 없음 → `error` 이벤트 1개·저장 없음, 미리보기 수정, 저장 요약, 저장 → 프로젝트 + readiness, 폼 전환, 그만두기, 다시 이어 하기.
- 서버 로그에 오류 없음. 시험 뒤 익명 `/career`는 이동.

이 경로로 AI 턴이 도는 것은 **확인하지 못했다**. 공급자를 가짜로 바꿀 방법이 없고 실제 호출은 금지다.

### 실제 행 + 가짜 공급자 (`lib/data/career.integration.test.ts`, 17건 통과)
실제 동의 게이트, 실제 데이터 함수, 실제 라우트 핸들러, 실제 AI-12 파이프라인, 클라이언트 `realChatTurn`. 대본 어댑터만 가짜고 라우트는 fetch 스텁으로 직접 불렀다(HTTP 서버 없음).
- 동의 전 `consent_required`, `record_consents` 후 통과(⑲ 우회, 이 계정만).
- `client_id` 재시도 1행, 낡은 `expected_updated_at` → `conflict`, 지운 id → `not_found`, 기간 역전 → `invalid_input`.
- S-08 연도 트리: 소속 기간 밖 프로젝트, 기타, 연도 미정, 집계, 힌트.
- 미리보기 헤더: fixture 읽기, 쓰기가 실제 행에 안 감. **W1에서 못 했던 대조다.**
- 삭제: keep/delete_projects, 상위 프로젝트 상태 재계산.
- 턴: 전송 전 DB 저장 없음 → SSE 순서 → 메시지·초안 저장, 프로젝트 행 안 생김. 실패 원인이 `turnFailures`에 옴, `?retry=1`로 행 재사용·수 그대로. 중단 → 작업 `canceled`, 행 `failed`, 재전송 가능. 무효 키 `key_invalid`.
- 수락·거절, 성과 수정, 저장 결과 행(거절한 칸은 빈 값), 폼 전환, 복귀 대상, 대화만 삭제 시 프로젝트 유지, 보강 첫 수정.

### 확인하지 못한 것
- **브라우저 전부.** 클릭, 폼 자동 저장 타이머, 스트리밍 글자 표시, 중단 버튼, 저장 다이얼로그, 대역 메시지가 실제 행으로 바뀌는 화면을 눈으로 보지 못했다. Chrome 연결은 시도하지 않았다.
- 실제 공급자·실제 키 복호화를 거친 턴. 위 시험은 키 소스와 공급자 맥락이 정적 대역이다.
- 실제 `fetch` 중단: 시험은 Request.signal로 라우트에 전달만 확인했다. 브라우저의 AbortError 경로는 W1 단위 시험뿐이다.
- 개발 모드 `?state=`의 화면 렌더(데이터 함수 분기까지만).
- S-03 통과: ⑲ 그대로, 고치지 않았다.

## 시험 명령 결과
| 명령 | 결과 |
|------|------|
| `pnpm lint` | 오류·경고 0 |
| `pnpm typecheck` | 통과 |
| `pnpm build` | 성공(exit 0) |
| `pnpm test` | 98파일 중 97 통과. 1,595건 중 **3건 실패, 전부 `src/lib/data/w3.integration.test.ts`** (W3 진행 중 파일, 초안 상태 검사). 1번째 4건, 2번째 3건으로 같은 파일만 실패. 내 파일 아님, 고치지 않음 |
| `career.integration.test.ts` | 17/17 |

`pnpm db:test`는 돌리지 않았다(DB 변경 없음, 다른 엔지니어 행과 겹침).

## UI 요청
1. **`useRowAutosave`가 첫 저장 전에 id를 만들어 `client_id`로 보내기** (W2-①). 응답 유실 후 다시 시도할 때 중복 행을 막는다. `components/career/actions.ts`의 `Opts`에 필드 추가 포함. 가장 작고 효과가 크다.
2. 폼이 `row.updated_at`을 `expected_updated_at`으로 보내고 충돌 상태 표시 (W2-②).
3. 기간 역전 안내 문구 (W2-③). 지금은 이유 없는 "저장 실패"다.
4. S-08에 시작 월 없는 경력·교육 표시 (W2-④). `CareerTree`에 필드 추가가 필요하다.
5. 턴 뒤 강조를 `draft_patch` 이벤트에서 받기 (W2-⑧). `realChatTurn`의 `String()` 변환도 함께 고쳐야 한다(W1 파일).
6. 미리보기에 카드 여러 개 표시 (W2-⑨).
7. `clarifications`의 나머지 종류 표시 여부 결정 (W2-⑬).

기획 차이는 `spec-gaps.md`의 "W2" 절 W2-①~⑭에 적었다.

## W5에서 할 일
`components/career/actions.ts`의 `MockAiError`·`WritingChatLockedError` 분기는 실제 경로에서 죽은 코드다. 미리보기가 쓰므로 남겼다.
