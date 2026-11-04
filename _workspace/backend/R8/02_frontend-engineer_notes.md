# R8 — frontend-engineer 노트 (RQ-5 합친 제안 화면 반영)

## 변경 파일
- `src/components/career/star-proposal-fill.ts` — STAR 필드 `planFill`: op `"set"`이면 폼 값이 있어도 **교체**(next = 제안 값, prev = 현재 폼 값 → 되돌리기). op `"append"`(과거 초안)만 `${current}\n${add}`. op 누락은 `"set"`으로 본다. 2,000자 검사는 결과 값 길이(교체면 제안 길이).
- `src/components/career/star-proposal-fill.test.ts` — set 교체·prev 보관, 2,000자(교체는 들어감 / append는 넘침 / 제안 자체 2,001자) 케이스 추가. 기존 too_long 케이스는 append 초안으로 바꿈.
- `src/components/career/star-proposal-card.tsx`
  - 값 있는 칸 + op set: 라벨 "기존 내용과 합친 제안", 제안 전문 + 접이식 [기존 내용 보기](현재 폼 값, "[반영]하면 아래 내용이 위 제안으로 바뀌어요"). `Collapsible` + ghost xs 버튼 패턴(S-44 이전 초안 보기와 동일), `bg-muted` 토큰.
  - op append(과거 초안): 기존 "현재 내용 뒤에 붙어요" 표시 유지.
  - `tooLongCopy(field, op)`: set이면 "제안이 2,000자를 넘어 … 제안을 직접 고쳐 줄인 뒤 다시 [반영]", append는 기존 문구.
- `src/lib/mock/writing-chat-turn-v45.ts` — 프로젝트 턴 mock: 항상 op `"set"`, 값 있는 칸은 기존 텍스트(미반영 제안 우선, 없으면 폼 값) + 새 내용을 합친 문장. 간단한 -음 체 어미 변환(`toEumStyle`, mock 전용).
- `src/lib/mock/career-v45.ts` — 프로젝트 채팅 fixture: `action`을 합친 set 제안("…Redis 캐시를 도입함. 캐시 무효화 규칙을 직접 설계함")으로, result·learnings를 -음 체로, 안내 메시지 문구 갱신.

## [UI-가정]
- set 제안이 2,000자를 넘으면 칸을 줄여도 해결되지 않으므로 "제안을 직접 고쳐" 안내로 바꿈(기획 문구 없음).
- 비교 UI는 접이식 원문 표시만(diff 하이라이트 없음).

## 검증
- `pnpm lint` 통과, `pnpm typecheck` 통과, `pnpm test` 130 files / 2024 tests 통과, `pnpm build` 성공.
- 브라우저 확인은 하지 않음.

## QA 1라운드 수정 (QA-05)
- `src/components/career/star-proposal-card.tsx`
  - 토글 이름 "기존 내용 보기" → **"기존 내용과 비교"**(UX v5.11 S-10). 펼치면 "지금 폼 값" | "제안"을 나란히(sm 이상 2열, 좁은 화면 세로). 토큰 `bg-muted` / `bg-ai-subtle`.
  - 검토 필요 안내: `review_reason === "existing_missing"`이면 **"기존 내용 일부가 빠졌을 수 있어요"**(V-9j), `content_unverified`·null·키 없음이면 기존 문구 유지.
  - 2,000자 문구를 UX 문구로 맞춤: "'{섹션}'에 채우면 2,000자를 넘어 채우지 못했어요. 칸을 줄인 뒤 다시 [반영]해 주세요"(set/append 공통). 앞의 [UI-가정](set 전용 문구)은 철회.
- `src/types/db.ts` — `DraftStarFieldObject.review_reason?: StarReviewReason | null` 추가(선택 키, 과거 초안 호환), `StarReviewReason = "existing_missing" | "content_unverified"`. db-engineer·ai-pipeline-engineer 쪽 키 이름·값과 같아야 함.
- `src/lib/mock/career-v45.ts` — `?state=needs-review`: result = `content_unverified`(기존 문구), action(합친 제안) = `existing_missing`(V-9j 문구 + 비교 토글).
- 검증: `pnpm lint`·`pnpm typecheck` 통과, vitest `src/components/career` + `src/lib` 25 files / 267 tests 통과, `pnpm build` 성공. 브라우저 확인 안 함.
