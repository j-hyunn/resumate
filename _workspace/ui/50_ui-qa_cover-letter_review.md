# UI QA — 자기소개서 관리 흐름 재설계 통합 (45 런, 라운드 1)

- 날짜: 2026-11-09 · 담당: ui-qa · 워크트리 `cover-letter-ui-469976` · HEAD `5c7ed23`(작업 트리 깨끗함)
- 기준: PRD v4.17 · 플로우 v5.20 + 기획 PR #68(`origin/claude/focused-mclaren-1a7881`, CF-S1~CF-S5) · DM v4.15 · 디자인 시스템 v5.15 · decisions 4.23 UI 표 · 브리프 45(2026-11-09 "연결 대기 4건" 절 포함)
- 대상: S-13 · S-14(`AddApplicationDialog`) · S-46(문항 설정 / 작성, 탭 3개, 패널, `QuestionProposalCard`) · S-39 카드 · 폐기 화면 정리 · 공용 변경
- 이슈 번호: UQ-740부터(직전 최대 UQ-739)

## 요약

- **Critical 1 / Major 2 / Minor 9 / 기획 확인 3**
- 기계 검사: lint 0 · typecheck 통과 · test **149파일 2,433건 통과** · **build 통과** (리더 수치와 같다)
- 파괴 마이그레이션 전 확인: **실제 경로에서 옛 `drafts`·`draft_sections`·`draft_section_sources`를 읽거나 쓰는 코드 0건.** `retryJdExtraction`·`runJdExtraction` 보존(실제 분기 `realRetryJdExtraction`).
- 정본 덮어쓰기 판정: **지금 코드는 읽기 실패를 `null`로 접지 않는다 → 이 경로의 화면 쪽 Critical 없음.** 다만 (1) 알려진 연결 대기 ①의 실제 증상은 "늘 문항 설정 상태"가 아니라 **"S-46이 늘 오류 화면"**이다(정정), (2) 저장 RPC가 `p_expected_updated_at = null`이면 기존 행을 그대로 덮어써서 **서버가 마지막 방어선이 되지 못한다**(UQ-741, 백엔드).
- 새로 찾은 Critical: **저장 때 문항 `slot`을 순서대로 다시 매긴다**(UQ-740) — DM 2.5.1 "안정 키, 재사용 금지" 위반. 작성 상태에서 문항을 지우거나 옮기고 저장하면 근거(`evidence_links`)와 AI 제안이 **다른 문항에 붙거나 지워진다.**
- 브라우저: **미확인.** Claude in Chrome 확장이 연결되지 않았다(`tabs_context_mcp` → not connected). 로컬 로그인 우회·테스트 계정 경로는 저장소에서 찾지 못했다(백엔드 기록 W5·R10도 "브라우저 확인 없음"). 리다이렉트만 `curl`로 확인했다(브라우저 확인이 아니다).

## 화면별 점검표

| 화면 | Q1 행 | Q2 문구 | Q3–4 타입 | Q5 경로 | Q6 상태 | Q7 AI 방식 | Q8 디자인 | Q9 접근성 | Q10 좁은 화면 | Q11 데이터 계층 | Q12 브라우저 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| S-13 | ✅ | ⚠️ UQ-744 | ✅ | ✅ | ✅ | — | ✅ | ✅ | ✅ | ✅ | 미확인 |
| S-14 모달 | ✅ | ✅ | ✅ | ⚠️ UQ-742 | ✅ | ✅ | ✅ | ⚠️ UQ-746 | ⚠️ UQ-745 | ⚠️ UQ-751 | 미확인 |
| S-46 문항 설정 | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ UQ-750 | ✅ | ⚠️ UQ-741 | 미확인 |
| S-46 작성 + 탭 | ❌ UQ-740 | ⚠️ UQ-747·748 | ✅ | ✅ | ✅ | ✅ | ✅ | ⚠️ UQ-749 | ✅ | ❌ UQ-740 | 미확인 |
| S-46 패널·제안 카드 | ✅ | ⚠️ UQ-747·748 | ✅ | — | ✅ | ✅ | ✅ | ✅(코드) | 미확인 | ✅ | 미확인 |
| S-39 카드 | ✅ | ✅ | ✅ | ⚠️ UQ-742 | ✅ | — | ✅ | ✅ | ✅ | ✅(연결 대기 ②) | 미확인 |
| 폐기 화면·리다이렉트 | ✅ | — | — | ✅ | — | — | — | — | — | ✅ | curl만 |
| 공용 변경 | ✅ | ✅ | ✅ | — | — | — | ✅ | ⚠️ UQ-750 | — | ⚠️ UQ-752 | 미확인 |

## 브라우저 확인

- **못 했다.** Claude in Chrome 확장 미연결. 실제 Google 계정 로그인은 하지 않았다. 저장소에 로컬 개발용 로그인 우회·테스트 계정 경로가 없다(`src/server/auth`·`src/proxy.ts`·`.env.example`·`supabase/seed.sql`·`_workspace/backend/` 검색).
- 참고(브라우저 확인 아님): `?state=` 미리보기 주소는 게이트 없이 200을 준다(`/applications?state=default`, `/applications/{id}/cover-letter?state=questions`) — 확장이 연결되면 게이트 밖에서 미리보기 패스를 할 수 있다.
- `curl`로 본 옛 주소 9개 — 모두 308, 도착지 브리프·A0 보고 3절과 같다: `/applications/new`→`?new=1` · `/{id}/jd`→`cover-letter?tab=jd` · `/{id}/insight`→`?tab=insight` · `/{id}/drafts/…`·`/career-description`·`/interview/…`·`/cover-letter/questions`·`/{id}` → `/{id}/cover-letter` · `/interviews/…` → `/applications`.
- → screen-status에는 **`QA 통과 (mock·브라우저 미확인)`** 이하로만 적을 수 있다(Critical 해결 뒤).

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|---|---|---|---|---|---|---|---|
| UQ-740 | **Critical** | A3 | S-46 작성 | DM v4.15 2.5.1 "슬롯 키 `slot` (확정)"(04-data-model.md:559) — "짧은 안정 키 `q_{n}` … 번호는 그 서류에서 한 번 쓰면 **재사용하지 않는다**(지워진 슬롯의 근거 행과 섞이지 않게)". `evidence_links.item_key`·`p_applied_proposals`가 이 키를 쓴다 | `src/components/applications/cover-letter/question-form.ts:92-96`(`toCoverLetterBody`가 `slot: q_${i + 1}`로 다시 매김, 주석 "서버도 같은 규칙"은 사실이 아님 — RPC는 받은 `slot`을 그대로 검사·사용, `20261113003700…sql` `c_slot_re`·`v_slots`) · `question-form.ts:61`(새 문항 `slot: ""`) · mock `src/lib/data/cover-letters.ts:268-270`(같은 재번호) · `cover-letter-screen.tsx:275-283`(저장 뒤 폼의 `slot`을 갱신하지 않음) | 문항의 `slot`은 처음 받은 값을 유지하고, 새 문항은 그 서류에서 쓴 적 없는 다음 번호를 받는다. 저장·삭제·순서 변경이 근거·제안과 문항의 짝을 바꾸지 않는다 | 3문항 중 1번을 지우고 저장 → 옛 2·3번이 `q_1`·`q_2`로 저장된다. RPC `doc_replace_slot_evidence`는 "보내지 않은 슬롯" `q_3`의 근거 행을 **지우고**, `q_1`·`q_2`에는 **옛 1·2번 문항의 근거가 남는다** → C-11이 엉뚱한 근거를 보이고 실제 근거는 사라진다. "위로/아래로 이동"은 근거를 서로 맞바꾼다. 대화 `structured_draft`의 제안도 `slot`으로 묶여 있어 [반영]·`applied_proposals`가 다른 문항을 가리킨다. 데이터가 조용히 틀어진다 |
| UQ-741 | Major | 백엔드 (A3 협의) | S-46 문항 설정 | 브리프 45 "연결 대기 4건" ①·"⚠ UI 규칙" / DM 2.5.1 기대 버전 | `supabase/migrations/20261113003700_r15_application_document_rpcs.sql:905-915` — 행이 있으면 `p_expected_updated_at is not null`일 때만 `stale_write` 검사, null이면 그대로 update. 화면의 첫 저장([자기소개서 작성 시작])은 `expected_updated_at: null`(`cover-letter-screen.tsx:238`, `updatedAt` 초기값 null) | 문항 설정 상태에서 보낸 "첫 저장"은 행이 이미 있으면 거부돼야 한다(덮어쓰기는 사용자가 "내 내용으로 저장"을 고른 때만) | 읽기가 연결된 뒤에도 **두 탭/오래 열어 둔 탭**(둘 다 행 없음으로 열림)에서 각각 [작성 시작]을 누르면 뒤쪽이 앞쪽 정본을 빈 기본 문항으로 조용히 덮는다. 제안: RPC에 "만들기 전용" 의미를 두거나(예: 행이 있고 기대 버전이 null이면 `stale_write`), 화면의 "내 내용으로 저장"이 `stale_write` detail의 현재 `updated_at`을 기대 버전으로 다시 보내게 한다. 계약 변경이라 백엔드 결정 |
| UQ-742 | Major | A4 (A3 협의) | S-39 → S-14 | UX v5.20 S-14 "이탈: … 닫기(×)·Esc → **출발 화면 그대로**" · "보드에서 왔을 때: 생성 뒤 **S-39로 돌아가** '지원 전' 열 맨 위에 카드 + '열기' 토스트" · 디자인 시스템 5.5·5.6.2 | `src/components/board/kanban-board.tsx:314`·`:392`(`routes.applicationNew({from:"board"})` = S-13으로 이동) · `src/components/applications/add-application-dialog.tsx:286-298`(fromBoard면 토스트 + `router.refresh()`만) · `add-application-launcher.tsx:25-35`(닫으면 `/applications`로 replace) · 주석 `add-application-launcher.tsx:10-11` "생성 뒤 보드로 돌아간다"는 사실과 다름 | 보드 위에서 모달이 열리고, 닫거나 만든 뒤에도 S-39에 남는다 | 보드 "+"를 누르면 S-13으로 이동한 뒤 모달이 열린다. 닫으면 S-13에 남고, 만들어도 S-13에 남아 "열기" 토스트만 뜬다 — 사용자가 보드로 돌아가지 못한다. 고치는 길: 보드가 `<AddApplicationDialog fromBoard />`를 직접 렌더(A3 보고 6절이 이미 제안) |
| UQ-743 | — (기록) | 백엔드(연결 대기 ①) | S-46 실제 경로 | 브리프 45 "연결 대기 4건" ① | `src/lib/data/cover-letters.ts:184-193`(real = `notWired` → `AppError wiring_pending` 503) · `src/app/(dashboard)/(gated)/applications/[id]/cover-letter/page.tsx:57`(`Promise.all`, catch 없음) → `src/app/(dashboard)/error.tsx` | (정정 기록, 새 결함 아님) | 보고서 49·브리프의 "실제 환경에서 S-46이 늘 **문항 설정 상태**"는 코드와 다르다. 실제로는 **S-46 전체가 오류 화면(S-28)**이고, 따라서 S-13 행 클릭·보드 카드 클릭도 실제 환경에서는 오류로 끝난다. 덮어쓰기는 이 때문에 지금 일어나지 않는다. 읽기 연결 때 이 throw를 `null`로 바꾸지 말 것(아래 판정) |
| UQ-744 | Minor | A3 | S-13 빈 상태 | UX v5.20 S-13 상태: "지원하려는 공고를 **넣어** 첫 자기소개서를 **만들어** 보세요. 커리어 정리 전에도 **만들** 수 있어요" (v5.20 — "붙여넣어"를 "넣어"로) | `src/app/(dashboard)/(gated)/applications/page.tsx:56` | 명세 문구 그대로 | "지원하려는 공고를 붙여넣어 첫 자기소개서를 추가해 보세요. 커리어 정리 전에도 추가할 수 있어요" — v5.20이 바꾼 낱말이 반영되지 않았다 |
| UQ-745 | Minor | A3 | S-14 좁은 화면 | UX S-14 "좁은 화면: 모달 대신 **전체 화면 시트**" · 디자인 시스템 5.6.2 | `src/components/applications/add-application-dialog.tsx:319` — `max-h-[85dvh]`가 중단점 없이 걸려 `max-sm:h-dvh`를 85dvh로 자른다 | 640px 미만에서 화면 높이 전체 | 위아래 7.5%씩 빈 띠가 남는 큰 모달이 된다. `sm:max-h-[85dvh]`로 좁히면 된다 |
| UQ-746 | Minor | A3 | S-14 ①→② | 디자인 시스템 7장 다이얼로그 포커스 · L-02/UX 포커스 규칙(단계 이동 뒤 포커스 위치) | `add-application-dialog.tsx:234`(`setStep(1)`, 이후 포커스 지정 없음) · 단계 표시 `onGo`(이전 단계로) 동일 | ②로 넘어가면 ② 첫 칸(지원 기업) 또는 단계 제목에 포커스, 돌아가면 ① 입력에 포커스 | 눌렀던 [다음] 버튼이 사라져 포커스가 다이얼로그 컨테이너로 떨어진다(Radix가 컨테이너로 되돌림). 화면 낭독기 사용자는 ②가 열린 것을 알기 어렵다 |
| UQ-747 | Minor | A3 | S-46 제안 카드 | UX v5.20 S-46 반영 규칙: "`base_body_hash`가 다르면 '초안을 만든 뒤 답변이 바뀌었어요. 바꾸면 바뀐 내용도 사라져요'" | `question-proposal-card.tsx:332-337`(문구 2개뿐) · `use-cover-letter-panel.ts:227`(`base_body_hash: null` 고정) | 초안 뒤 답변이 바뀐 문항은 그 문구로 확인 | 해시 비교와 그 문구가 없다 — 초안 뒤 손으로 고친 답변도 일반 확인 문구로만 덮인다 |
| UQ-748 | Minor | A3 | S-46 패널 | UX v5.20 S-46 "첫 턴 제안": 초안 턴이 끝나면 "다음 문항도 이어서 써 볼까요?" `[가정]` | `src/lib/data/cover-letter-chat-types.ts`·`use-cover-letter-panel.ts`(해당 문구 없음, `grep` 0건) | 4~5문항 첫 초안 턴 뒤 그 안내 | 칩 "남은 4~5번 문항 초안 만들기"만 붙고 안내 문장은 없다 |
| UQ-749 | Minor | A3 | S-46 "AI 제안 있음" | UX v5.20 S-46 "AI 초안 있음": 누르면 패널을 열고 마지막 AI 턴 아래 확인 줄의 **[자세히]를 그 문항 자리로 펼친다**(UP-4) | `src/components/applications/cover-letter/answer-tab.tsx:63-64`·`cover-letter-screen.tsx:519-522`(`onOpenPanel` = 패널 열기 + 입력창 포커스) | 그 문항의 제안 자리로 이동 | 입력창으로 간다 — "AI와 초안 쓰기"와 같은 동작. 4.23 정본 범위 안이지만 명세 동작과 다르다 |
| UQ-750 | Minor | A0 | S-46 문항 설정 상단 바 | UX v5.20 S-46 상단 바(CF-S3·CF-S5): 문항 설정 상태에서 ⌘S 꺼짐 | `src/components/common/shell/page-shell.tsx:310`(`aria-keyshortcuts`가 `hideTooltip`과 무관하게 늘 붙음) | 꺼진 단축키를 알리지 않는다 | 비활성 버튼이 화면 낭독기에 "Meta+S"를 계속 알린다(이유 안내는 아니라 CF-S5 위반은 아님 — 동작하지 않는 단축키 안내). `hideTooltip`(또는 비활성)일 때 속성을 빼면 된다. ⌘S 무동작·툴팁 없음·`aria-describedby` 없음은 ✅ |
| UQ-751 | Minor | A3 | S-14 ① [다음] | UX S-14 Q53-1 표: 키 없음(`active_provider = null`)은 막지 않고 AI-01 없이 ②로 | `add-application-dialog.tsx:211-217` — `isAiRejected(r)`이고 `key_invalid`가 아니면 **모두** `consent.open(...)` | 서버가 `ai_not_connected`·`key_missing`으로 거부하면(다른 탭에서 키 삭제 등) 미리 보기 없이 ②로 | 동의 다이얼로그가 엉뚱하게 뜬다. `ai_consent_required`만 C-21로 보내고 나머지는 `extractFailed`처럼 ②로 넘기면 된다 |
| UQ-752 | Minor | 백엔드 | 공용(근거 저장) | DM v4.15 A.14 owner_type CHECK(파괴 단계 뒤 `insight`·`chat_message`·`application_document`) · `src/lib/contracts/enums.ts:245-249`(이미 3값) | `src/server/ai/storage/evidence-links.ts:23-28`(`draft_section` 남음, `application_document` 없음) | 계약 목록과 같은 3값 | 타입 목록만 낡았다 — 쓰는 곳이 없어(`grep` 결과 정의뿐) **런타임 영향 없음**, 파괴 push 판정에서 제외. 정리 대상 |

## 기획 확인 필요

| ID | 내용 | 양쪽 인용 | 화면 영향 |
|---|---|---|---|
| UQ-753 | **PR #68 S-46 안에서 CF-S3와 어긋나는 행이 남아 있다** | ① PR #68 `02-user-flows.md:1674` 문항 설정 상태 표 행: `"저장하기" (상단 바) — 같은 검증 → 저장만 하고 이 상태에 남는다(이번 방문 동안) [가정]` (취소선 없음) ② 같은 파일 1650·1652·556: "(CF-S3) 문항 설정 상태에서는 '저장하기'가 비활성 … 첫 저장은 [자기소개서 작성 시작] 하나뿐". DM `04-data-model.md:667`도 "문항 설정 상태의 '저장하기'만 누른 경우는 행이 생기므로…"를 그대로 둔다 | 구현은 CF-S3(비활성)를 따랐다 — 맞다. 문서 정리만 필요(1674행 취소선, DM 667 문장) |
| UQ-754 | 약관·개인정보 처리방침·AI 데이터 이용 안내에 "경력기술서·자기소개서 초안"이 남아 있다(CF-1로 경력기술서 폐기) | `docs/legal/terms-of-service.md:20,40` · `privacy-policy.md:19` · `ai-data-use.md:13` ↔ 화면 `src/components/account/policy-content.ts:86,110,209,409` | 시행 중인 정책 글이라 UI가 고칠 수 없다(문구는 `docs/legal` 정본). 개정 여부·시점 결정 필요 |
| UQ-755 | S-25 탈퇴 요약의 "초안 {n}" 라벨 | 브리프 45 "건드리지 말 것": `applications.drafts`는 키 이름 유지, 셈법이 "**자소서가 작성된 지원 건 수**"로 바뀜(DM §4.3) ↔ `src/components/account/deletion-summary.tsx:29` `["초안", a.drafts]` | 라벨 "초안"이 새 셈법(지원 건 수)과 맞지 않는다. S-25 명세에 이 줄의 라벨이 없다 — 라벨 결정 필요(예: "작성한 자기소개서") |

## 중점 확인 7개 결과

1. **되살리면 안 되는 것 — 0건 ✅.** 화면 문구·코드 `grep`(`src/app`·`src/components`·`src/lib/data`·`src/lib/mock`·`routes.ts`, 주석 제외): "이관"(픽스처 프로젝트 이름 "레거시 결제 모듈 이관" 1건뿐) · "초안 보기" 0 · "6~10" 0 · "AI 없이 계속" 0(주석에서 "두지 않는다"로만) · "모의 면접" 0 · "보드로 보기" 0 · S-13 단계 칩·기능 진행·정렬 `Select` 0(`application-list.tsx`). "경력기술서"는 ① C-18 주석 ② `policy-content.ts`(UQ-754, 정책 글) ③ mock 전용 `drafts.ts:277`·`fixtures.ts:1050,1085`뿐 — 화면에 그려지는 자리 없음. "면접"은 인사이트 보완 방안 라벨 `GAP_ACTION_LABELS.prepare_answer = "면접 대비"`(`labels.ts:33`) 1건 — AI v4.14 RM-1 검토에서 **실제 전형 준비 조언이라 유지**로 정한 값(03-ai-features.md:88)이라 정상.
2. **수치·용어 ✅.** 문항 최대 `COVER_LETTER_MAX_QUESTIONS = 5` · 기본 `COVER_LETTER_DEFAULT_CHAR_LIMIT = 800`(`cover-letter-defaults.ts:10,13`, 기본 3문항·새 문항 모두 `question-form.ts:47,65`) · 글자 수 = `countAnswerChars(body, basis)` 내용만(`cover-letter-copy.ts:70`) — 제목 미포함 · 용어: 탭 "자소서"(`cover-letter-screen.tsx:587`), 머리·메뉴·모달·삭제는 "자기소개서", S-39 배지·C-05 영향 줄의 "자소서 …"는 명세 문구 그대로(UX 632·2601·2612). 600은 mock 전용 옛 `drafts.ts:292`에만.
3. **CF-S1·CF-S2 ✅.** 저장 입력 `toCoverLetterBody()`에 `sources` 키 없음(단위 테스트 단정) · 화면은 `applied_proposals [{writingChatId, slot, rev}]`만(`cover-letter-screen.tsx:240`) · 정본 C-11 `sources-used.tsx`는 경로 한 줄 + 삭제 원본 `Unlink`뿐, 배지·`rationale` 없음, `{slot}.sources.{n}` 숫자 순서(`answer-tab.tsx:375-381`) · 제안 쪽 `ProposalSources`는 이유 한 줄을 더 보인다(`question-proposal-card.tsx:364-380`) — 디자인 시스템 3.10·3.26대로 모양이 다른 것이 정상. **단, 근거가 묶이는 키(`slot`)가 저장 때 바뀐다 → UQ-740.**
4. **CF-S3·CF-S5 ✅(UQ-750 Minor 하나).** 문항 설정 상태: `saveUi`를 늘 `idle`로 고정(`cover-letter-screen.tsx:386`) → `SaveButton` `disabled`, ⌘S 핸들러는 `enabledRef`일 때만 동작(`page-shell.tsx:280-284`), `onSave`도 `state === "writing"`일 때만 · 툴팁 `hideTooltip`으로 없음(`page-shell.tsx:326`) · 안내 줄·`aria-describedby` 없음 · 정본 첫 저장은 `QuestionSetup onStart → runSave({createRow:true})` 하나뿐 · 이탈 확인: `hideLeaveSave`로 "나가기 / 계속 작성" 2버튼(`page-shell.tsx:206-215`), 손대지 않은 기본 3문항은 확인 없음(`isUntouchedSeed`).
5. **R15 계약 경계 ✅.** `realCoverLetterTurn`(`ai-stream-client.ts:265-280`)이 `sources_selected.sources[]`(camelCase)와 `draft_block.block`(snake_case)을 **변환 없이 통과**시키고, 카드는 `sortOrder`·`reuseReason` / `block_id`·`source_fact_ids`·`source_body_quotes`로 각각 읽는다 — 같은 규칙으로 처리하는 곳 없음(mock `cover-letter-turn.ts`도 같은 모양). 초안 상한 = 턴 기준 `COVER_LETTER_DRAFT_LIMIT = 6`, "초안 남은 횟수 {6 − draft_count} / 6"(`question-proposal-card.tsx:163`, `use-cover-letter-panel.ts:173`). 공고 가져오기 실패 6종: real은 `fetchJobDescription`이 `AppError`, 모달은 `.catch(() => null)` 하나로 받아 `JD_FETCH_FAILED_MESSAGE` "이 공고는 가져오지 못했어요. 내용을 직접 붙여넣어 주세요" 한 문구(`add-application-dialog.tsx:193-198,417`).
6. **파괴 마이그레이션 전 확인 — 아래 절. 결과: 실제 경로 0건 ✅, JD 추출 함수 보존 ✅.**
7. **좁은 화면·키보드·포커스·`?state=`.** 탭은 Radix `Tabs orientation="vertical"`(<lg 가로), 세 탭 `forceMount`로 폼 유지 · 문항 순서 변경은 메뉴(드래그 없음) · S-13 행 메뉴 `aria-label` "{이름} 메뉴" · 모달 2단계 포커스 UQ-746 · 좁은 화면 모달 UQ-745 · 패널 열고 닫기 포커스는 코드상 `focusInput`만 확인, 닫을 때 복귀는 **브라우저 미확인**. `?state=` 키: 보고서 46·47·49와 페이지 처리(`cover-letter/page.tsx:22-28`·`board/page.tsx`·`applications/page.tsx`)가 일치. 페이지 주석의 `writing` 키는 따로 처리되지 않지만 기본(픽스처 ap 1·2)과 같은 화면이라 문제 없음.

## 파괴 마이그레이션 전 확인 (실제 경로 `drafts` 계열 참조)

판정 기준: 브리프 45 "QA 판정 기준" — 실제 경로(`*-real.ts`·서버 호출·Server Action·Route Handler)만. mock 분기는 제외.

**실제 경로 참조 0건.** 확인 방법과 결과:

- `.from("drafts" | "draft_sections" | "draft_section_sources")` — `src/` 전체 **0건**. `Tables<…>`/`Row<…>`로 세 테이블을 쓰는 곳 0건(생성 타입 파일 제외).
- `.rpc(…)` 중 옛 서류 RPC(`begin_cover_letter_section`·`create_cover_letter_draft`·`set_section_sources` 등 `004700`이 drop하는 42개) 호출 **0건**(서류 관련 `rpc`는 `apply_structured_draft_patch`뿐 — 자소서 대화용).
- 옛 라우트 `src/app/api/application-projects/[id]/career-descriptions`·`draft-source-ranking` **없음**, `src/server/services/drafts/` **없음**, `src/lib/data/drafts-real.ts` **없음**.
- 이름이 걸리는 실제 경로 파일과 판정:

| 파일 | 내용 | 판정 |
|---|---|---|
| `src/server/services/application/read.ts:88-92` | `drafts` = `loadDocumentCounts()` 결과 변수 이름(`application_documents` 조회, `application-document/progress.ts`) | 안전 |
| `src/server/services/account/index.ts:53` · `src/lib/data/account.ts:310` · `src/lib/contracts/account.ts:24` | `get_account_deletion_summary` 반환 키 `drafts`(키 유지가 정본, DM §4.3). RPC 본문은 `004700`의 `delete_account_data` 재정의로 옛 테이블을 떠남 | 안전(브리프 "건드리지 말 것") |
| `src/lib/data/applications-real.ts:57` · `src/lib/data/evidence-real.ts:56` | 공용 헬퍼에 넘기는 가짜 `MockDb` 모양의 빈 배열 `drafts: []`·`draft_sections: []` | 안전(DB 접근 없음) |
| `src/server/ai/storage/evidence-links.ts:23-28` | `EVIDENCE_OWNER_TYPES`에 `draft_section` 문자열(타입 목록, 사용처 없음) | 런타임 영향 없음 — UQ-752 정리 |
| `src/app/(dashboard)/(gated)/applications/_lib/actions.ts:22` | `import { retryJdExtraction } from "@/lib/data/drafts"` | JD 요건 추출 — 보존 대상 |

- mock 전용(판정 제외): `src/lib/data/drafts.ts`(모든 서류 함수의 real 분기가 `notConnected()`·`null`·`[]`·no-op, 파일 머리 주석 40-46) · `src/lib/data/applications.ts:697-794`(`listDrafts`·`getDraft`·`saveDraftSection` real = `[]`/`null`) · `src/lib/data/deletion.ts:111,239-272,315-320,427-437,461-475`(mock 본문) · `src/lib/mock/fixtures.ts`.
- **`retryJdExtraction`·`runJdExtraction` 보존 ✅** — `src/lib/data/drafts.ts:1153-1158`, real 분기 `realRetryJdExtraction`(`src/lib/data/applications-real.ts:178`) 그대로. S-46 채용 공고 탭·`extract-first.tsx`가 쓴다.
- DB 쪽(참고, 백엔드 판정 영역): R15 비파괴 마이그레이션 중 옛 테이블을 직접 지우는 함수는 `20261113004300…sql:451-453`(`delete_account_data`)뿐이고 `004700`이 `:154`에서 다시 정의한다. `004700`은 행이 남아 있으면 멈추는 가드를 가진다.

## 정본 덮어쓰기 판정

질문: 실제 환경에서 정본을 못 읽는 동안, 정본이 이미 있는 지원 건에서 [자기소개서 작성 시작]으로 빈 기본 문항이 기존 정본을 덮을 수 있는가. 그리고(리더 추가 기준) 읽기 **실패**를 `null`(행 없음)로 접는 자리가 있는가.

코드 추적:
1. `getCoverLetterDocument` real 분기 = `notWired("자소서 정본 읽기")` → `AppError("wiring_pending", 503)` throw(`src/lib/data/cover-letters.ts:191-192`). `previewOr`는 실패를 바꾸지 않는다(`src/lib/data/source.ts:32-34`).
2. 유일한 호출자 `cover-letter/page.tsx:57` — `Promise.all([getJobDescription(id), getCoverLetterDocument(id)])`, **`try/catch`·`.catch` 없음** → 페이지 렌더가 실패해 `(dashboard)/error.tsx`(S-28)로 간다. `document`가 `null`이 되는 길은 미리보기 `questions*`·`extracting`·`extract-failed*`(mock 전용 줄 59)뿐.
3. 다른 호출자: `getCoverLetterDocumentAction`(`applications/_lib/actions.ts:160-161`)은 정의만 있고 화면에서 부르지 않는다(`grep` 0건). 화면 상태 판정은 `const state = doc ? "writing" : "questions"`(`cover-letter-screen.tsx:142`)이고 `doc` 초기값은 서버가 넘긴 `data.document`뿐이다.
4. 같은 페이지의 `.catch(() => null)`은 `getCoverLetterChat`(대화 열기, 줄 65)뿐 — 정본 판정과 무관.

**판정: 화면 쪽 Critical 없음.** 읽기 실패를 "행 없음"으로 접는 자리가 없다. 지금 실제 환경의 증상은 "늘 문항 설정 상태"가 아니라 **"S-46이 늘 오류 화면"**이며(UQ-743 정정), 그래서 [작성 시작]에 닿을 수 없어 덮어쓰기도 일어나지 않는다. 이 판정은 읽기가 연결된 뒤에도 유효하다 — 조건: **연결 작업에서 page.tsx에 `catch → null`을 넣지 말 것, `notWired` 자리를 백엔드 액션의 `unwrap`(실패는 throw)으로만 바꿀 것.** 원하면 S-46 전용 오류 화면을 두되 문항 설정 상태로 떨어뜨리지 않는다.

남은 위험(화면 판정과 별개): 읽기가 연결돼도 **동시에 연 두 탭** 또는 **행이 생기기 전에 열어 둔 탭**은 둘 다 문항 설정 상태이고, 둘 다 `expected_updated_at = null`로 저장한다. 저장 RPC는 행이 있어도 기대 버전이 null이면 검사 없이 update하므로(`20261113003700…sql:913`) 뒤에 누른 쪽이 앞쪽 정본을 빈 문항으로 덮는다 → **UQ-741(Major, 백엔드)**. 막는 방법: RPC가 "행 있음 + 기대 버전 null"을 `stale_write`로 거부하고, 화면의 의도적 덮어쓰기("내 내용으로 저장", `cover-letter-screen.tsx:238` `opts.overwrite`)는 거부 detail의 현재 `updated_at`을 기대 버전으로 다시 보낸다. 화면은 `stale_write`를 이미 변경 충돌 확인으로 처리하므로(`:248-251`) 문항 설정 상태에서도 그 확인이 뜨게 하면 된다(A3 후속).

S-39 `listCoverLetterSlotCounts` 실패 → 배지만 접음(`board/page.tsx:55-68`)은 의도된 동작이라 이 규칙에서 제외했다.

## 재확인 결과

이전 라운드 없음(이번 런의 첫 ui-qa 리뷰). 담당 보고서의 주장 중 코드와 다른 것: ① 49 5절 ①·브리프 "늘 문항 설정 상태" → 실제는 오류 화면(UQ-743) ② `question-form.ts:92` 주석 "서버도 같은 규칙"(slot 재번호) → 서버는 재번호하지 않음(UQ-740) ③ `add-application-launcher.tsx:10-11` "생성 뒤 보드로 돌아간다" → 돌아가지 않음(UQ-742).

## 기계 검사 출력

| 명령 | 결과 |
|---|---|
| `pnpm lint` | `eslint` 종료 0 — 0 errors, 0 warnings |
| `pnpm typecheck` | `next typegen && tsc --noEmit` — "Types generated successfully", 종료 0 |
| `pnpm test` | `Test Files 149 passed (149)` · `Tests 2433 passed (2433)`, 종료 0 |
| `pnpm build` | 종료 0. `/applications`·`/applications/[id]/cover-letter`(◐ Partial Prerender)·`/board` 등 라우트 생성 |

(포트 3000의 `pnpm dev`는 건드리지 않았다.)
