# W5 UI 노트 (W2~W4가 남긴 UI 요청 처리)

커밋, 원격 적용, 배포, 실제 공급자 호출 없음. `supabase db reset`은 하지 않았다. 로컬 스택에 시험 계정 1개를 만들어 쓰고 지웠다(`auth.users`에 `w5-%` 0행 확인).

**브라우저로 본 화면은 하나도 없다.** 아래 "확인" 표에 없는 것은 확인하지 않았다.

## 한 일
| 요청 | 처리 | 파일 |
|------|------|------|
| S-19 패치 (W3-1, W3-7) | 적용. 타입 오류는 없었다. 검토에서 필터 1곳을 좁혔다: 패치는 `validated`가 오면 다른 문항의 임시 블록까지 지운다. 지금 흐름은 문항을 차례로 확정하므로 실제로 드러나지는 않는 잠재 문제다. `replaceSectionBlocks`로 빼서 단위 시험을 붙였다 | `_lib/actions.ts`, `draft-editor.tsx`, `streaming.tsx`, `ai-stream-client.ts` |
| 첫 저장 재시도 (W2-①) | 폼이 첫 저장 때 id를 만들어 모든 시도에 `client_id`로 보낸다 | `form-parts.tsx`, `row-save.ts` |
| 탭 사이 충돌 (W2-②) | 폼이 본 행의 `updated_at`을 `expected_updated_at`으로 보낸다. 충돌이면 달라진 칸의 최신 값과 내 입력을 나란히 보여 주고 사용자가 고른다 | `form-parts.tsx`, `save-status.tsx`, 폼 5개, `actions.ts` |
| 기간 역전 (W2-③) | 저장 전에 칸 아래 안내. 기간만 저장에서 빼고 다른 칸은 계속 저장한다 | `row-save.ts` `periodPatch`, 경력·교육·프로젝트 폼 |
| 시작 월 없는 경력·교육 (W2-④) | `CareerTree.undated_entries` 추가, "연도 미정"에 표시 | `career.ts`, `career-tree.tsx` |
| 취소한 질문 생성 (㉚) | 공급자 오류 문구 대신 중립 안내, `startRemainingQuestionsAction` 호출 | `answer-sheet.tsx` |
| 없는 세션 삭제 (㉛) | Action이 `{ gone: true }`를 돌려주고 안내 후 목록을 다시 읽는다 | `interviews/actions.ts`, `session-list.tsx` |
| 빈 문항 (W3-9) | 빈 동안 `question_text`만 빼고 저장, 칸 아래 안내 | `cover-letter-questions.tsx` |
| 턴 뒤 강조 (W2-⑧) | `draft_patch`의 경로 객체를 그 이벤트의 초안으로 화면 경로로 바꾼다. `chat-screen`이 그 값으로 강조한다. `[object Object]` 없어짐 | `writing-chat-slots.ts` `previewPathsOf`, `ai-stream-client.ts`, `chat-screen.tsx` |
| 카드 여러 개 (W2-⑨) | 모든 카드 표시, 완료 조건과 `readyToReturn`은 "어느 카드든" | `draft-preview.tsx`, `writing-chat-view.ts` |
| 일관성 메모 (㉘) | 타입을 `{ text, answer_quotes }[]`로, 인용과 근거 칩 표시 | `types/db.ts`, `interview-rows.ts`, `result-view.tsx` |
| 중단 대기 (W3-4) | "중단하는 중…" + 버튼 잠금 | `streaming.tsx`, `draft-editor.tsx` |

## 지시에 없던 판단
1. **Action이 값을 돌려준다.** 운영 빌드의 Server Action은 던진 오류의 코드를 지운다. 그래서 `conflict`를 던지면 폼이 구분할 수 없다. 저장 Action의 반환형을 `RowSaveResult`로 바꿨다(`guardRowSave`). data 함수는 그대로 던진다(기존 시험 유지).
2. **거짓 충돌 2종을 걸렀다**(`decideConflict`). 이 판단을 안 하면 충돌 화면이 자주 잘못 뜬다.
   - 상세 내용 저장이 부모 프로젝트의 `updated_at`을 올린다(실제 행으로 확인). 폼에 보이는 칸이 그대로면 새 버전으로 다시 보낸다.
   - 응답만 잃은 저장: 행의 값이 보낸 값과 같으면 저장된 것으로 친다.
3. **`SaveState`에 `blocked` 추가.** 충돌·입력 거부는 "다시 시도"로 안 풀린다. W2-③이 지적한 막다른 길이다. 서버까지 간 입력 거부(`invalid`)도 안내를 띄운다.
4. **`not_found`는 "저장할 곳을 찾지 못했어요" 하나로 안내한다.** 행 삭제와 소속(부모) 삭제가 같은 코드다(`mapSaveError` 23503).
5. **미리보기 4개 추가**: `stopping`, `save-conflict`, `generation-canceled`, `multi-detail`. fixture는 첫 평가에 일관성 메모 1개와 근거 1개를 더했다.

## 확인
### 시험 명령
| 명령 | 결과 |
|------|------|
| `pnpm lint` | 오류·경고 0 |
| `pnpm typecheck` | 통과 |
| `pnpm test` | 99파일, 1,615건 전부 통과 (W2·W4 때 실패하던 `w3.integration.test.ts` 포함) |
| `pnpm build` | 성공 (exit 0) |

새 시험: `row-save.test.ts`, `ai-stream-client.test.ts`(경로 변환, 블록 교체, 근거 수), `career.integration.test.ts` 2건(실제 행). `pnpm db:test`는 돌리지 않았다(DB 변경 없음).

바꾼 시험 2곳: `interviews.integration.test.ts`. 예전 "모두 문자열" 검사는 **빈 배열이라 항상 참**이었다. 그 대본의 메모는 근거가 없어 AI-06이 버린다. `[]`를 명시하고 이유를 적었다.

### 실제 스택 + `next start` + 실제 세션 쿠키 + Server Action HTTP 호출: 15/16 통과
| 항목 | 결과 |
|------|------|
| 같은 `client_id`로 첫 저장 2회 → 1행 | 통과 |
| 낡은 `expected_updated_at` → 던진 오류가 아니라 `reason: conflict` + 최신 행, 쓰기 없음 | 통과 |
| 맞는 `expected_updated_at` → 저장 | 통과 |
| 기간 역전이 서버까지 감 → `reason: invalid` | 통과 |
| S-08 응답에서 "연도 미정" 뒤에 시작 월 없는 경력·교육 | 통과 (스크립트 데이터 포함 대조. 화면 위치까지 본 것은 아니다) |
| 없는 세션 삭제 → `{ gone: true }` | 통과 |
| S-33 취소 + 질문 0개: HTML에 중립 안내 | 통과 (행은 psql로 만듦) |
| 같은 상태에서 `startRemainingQuestionsAction`, 키 없음 → `key_missing`, `ai_job_not_retryable` 아님 | 통과 |
| S-22: 메모·인용이 HTML에, `consistency_notes.0` 근거가 화면 데이터에 | 통과 (행은 psql로 만듦. AI-06 실행 결과가 아니다) |
| S-19 prepare → `{ generation_id, request }`, S-19 화면 200 | 통과 |
| S-19 라우트: 위 계획의 body가 계약을 통과 | **판정 항목은 실패, 내용은 정상**. 내 검사가 `key_missing`을 기대했는데 라우트가 readiness를 먼저 봐서 `insufficient_data`(422)를 돌려줬다. 계약(400)은 통과했고 공급자 호출은 없었다. **그래서 AI-03 스트림까지 간 적은 없다** |

### 개발 서버, `?state=` HTTP: 14개 전부 200, 서버 로그 오류 0
`multi-detail`("상세 내용 2"), S-36 `ai-failed`, `stopping`, `finalizing`, `ai-stream`, `generation-canceled`, `ai-failed`(S-33), S-22 메모 제목, `save-conflict`, `save-failed`, `/career?state=empty`, `/interviews?state=empty`, S-18 `save-failed`, `/dev/states`. 문구까지 대조한 것은 앞의 `multi-detail`, `stopping`, `finalizing`, `generation-canceled`, S-22 메모 제목이다. 나머지는 응답과 렌더 성공만 봤다.

**포트 3000의 개발 서버는 깨져 있다.** 10월 30일에 뜬 프로세스(PID 94014)로, `[id]` 경로가 전부 500이다. 로그: "Jest worker encountered 2 child process exceptions". 코드 문제가 아니라 프로세스 문제로 판단했다. 임시 복사본을 `--webpack` 개발 서버로 띄우면 같은 경로가 200이다. W4가 본 500도 이것일 가능성이 있다. 내가 띄운 것이 아니라 끄지 않았다. **재시작이 필요하다.** 포트 3457, 3467의 `next start`도 내 `pnpm build`로 `.next`가 바뀌어 재시작이 필요할 수 있다.

## 확인하지 못한 것
- **클릭이 필요한 동작 전부**: 충돌 안내의 표시와 두 버튼, 자동 저장 타이머와 재시도, 기간 안내 표시, 빈 문항 안내, "중단하는 중…"이 실제 중단 뒤 뜨는지, 강조 애니메이션, 취소 화면의 버튼. 폼 쪽 로직은 순수 함수 단위 시험과 Action 응답까지다. `useRowAutosave` 훅 자체를 돌리는 시험은 없다(저장소에 컴포넌트 시험 환경이 없다).
- **S-19 실제 생성**: 패치 경로를 스트림 끝까지 돌리지 못했다. `realBlockStream` 단위 시험과 W3의 라우트 시험이 각각 있을 뿐, 편집기와 이어서 본 적이 없다.
- 실제 공급자로 만든 일관성 메모. 저장 형태는 AI-06 시험, 표시는 직접 넣은 행으로 확인했다.
- 실제 스택의 S-36 강조: 경로 변환은 단위 시험뿐이다.

## 남은 것
**지시로 미룸**
- S-19 새로고침 뒤 스트림 다시 잡기 (W3 요청 5)
- `done.draftId` 처리와 C-6 재사용 (W3-3)
- `clarifications`의 다른 종류 (W2-⑬)

**이번에 발견한 것**
- 프로필(S-04)은 여전히 나중 저장이 이긴다. 계약과 서비스에 `updated_at`이 없다. 백엔드 변경이 필요하다.
- 초안 편집, 문항 설정, 면접 답변 자동 저장에는 충돌 검사를 넣지 않았다. 범위는 커리어 폼이다.
- W3-4 그대로: S-19의 중단 후 대기는 최대 12초다. 표시만 넣었고 시간은 그대로다.
- `?state=save-conflict`는 저장된 행을 "최신"으로 쓴다. 첫 입력 뒤에 안내가 뜨고, 달라진 칸은 방금 입력한 칸뿐이다.
- 빈 문항 칸은 저장되지 않아서, 비운 채 새로고침하면 저장된 문구가 돌아온다. 안내 문구로만 알린다.
- `mapSaveError`가 부모 없음을 `not_found`로 합쳐, 소속을 지운 경우에도 안내가 뭉뚱그려진다. 구분하려면 코드가 필요하다.

## `[UI-가정]` 문구
| 화면 | 문구 |
|------|------|
| S-09·S-10·S-34·S-35·S-11 | 충돌 안내 전체, "저장할 곳을 찾지 못했어요", "입력한 값을 저장할 수 없어요", "저장되지 않았어요 — 안내를 확인해 주세요" |
| S-09·S-10·S-34 | "종료 월이 시작 월보다 앞서요. 고치기 전까지 기간은 저장되지 않아요" |
| S-18 | "문항을 입력하면 저장돼요" |
| S-19 | "중단하는 중… 최대 10초쯤 걸릴 수 있어요" |
| S-33 | "질문 만들기를 중단했어요", "질문 다시 만들기" 와 설명 줄 |
| S-36 | 카드 제목 "상세 내용 {n}" |
| S-37 | "이미 삭제된 면접 세션이에요" |

## 기획 확인 필요
1. 충돌 때 사용자에게 고르게 하는 방식이 맞는가. 스펙에 충돌 상태가 없어 지시대로 만들었다.
2. 기간 역전일 때 기간만 빼고 저장하는 방식이 맞는가. 그대로 나가면 고치던 기간은 사라진다(안내는 있음). UX-7 관점에서 확인이 필요하다.
3. `consistency_notes` 저장 형태는 여전히 `[가정]`이다(㉘). UI 타입을 이 형태에 맞췄으므로 바뀌면 같이 고쳐야 한다.
