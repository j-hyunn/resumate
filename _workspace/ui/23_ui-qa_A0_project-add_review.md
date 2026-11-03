# UI QA — A0 파운데이션 (프로젝트 상세·산출물 상세 준비분, 라운드 1)

- 작성: ui-qa / 2026-11-03
- 범위: L-02 셸(`shell/page-shell.tsx`, `shell/doc-body.tsx`, `(page)` 라우트 그룹 + 동의 게이트), 문서형 입력(`doc-inputs.tsx`), 칩(`button` `chip`/`chip-dashed`, `SelectTrigger variant="chip"`), `SourceChip`, `types/db.ts` v4.5 추가분, 데이터 계층 `career-v45*.ts`·`writing-chat-turn-v45.ts`, mock(`lib/mock/career-v45.ts`·`writing-chat-turn-v45.ts`), `quickChips`, AI 패널 코어(`components/career/ai-panel/`), `?state=` 미리보기, 키보드·접근성, 토큰
- 기준: 플로우 v5.6(1.3a L-02, C-15, S-10·S-44 패널 행), AI v4.6(AI-12·AI-13 칩 표·응답 모드·종류별 슬롯), DM v4.5(2.5, 2.5.0, 2.5.1, 3.3, 7장), 디자인 시스템 v4(5.8~5.10, A-3·A-13·A-14), 엔지니어 보고 `22_frontend-engineer-A0_project-add_report.md`
- 방법: 코드 정독 + 명세 대조. 개발 서버(`/dev/page-shell`)에서 `?state=` 20개 조합 SSR 확인(모두 200, 대표 문구 존재 확인). **브라우저 상호작용(클릭·키보드·포커스 이동)은 이 세션에 브라우저 도구를 쓰지 않아 코드 경로로 판단했다** — 포커스·키보드 관련 판정(UQ-PA-4·5·14)은 실제 브라우저에서 한 번 더 확인 권장.

## 요약

**Critical 1 / Major 7 / Minor 11** — 기계 검사: lint 통과 · typecheck 통과 · 새 테스트(`quick-chips` 15, `mock-isolation`·`source.production` 14) 통과 · build 성공(임시 공개 env 2개).

- 데이터 손실: 입력 보존(UX-7)이 페이지를 다시 연 직후 0.5초 안에 저장소에서 지워진다(UQ-PA-1, Critical). 훅 계약과 A2가 그대로 옮길 참고 배선(데모) 둘 다의 문제.
- 경계면: AI-13 슬롯 키 2개(`limits`, `reaction`)가 타입·라벨에서 빠졌고 `outcome`으로 잘못 매핑됨(UQ-PA-2). 엔지니어 보고의 "슬롯 키가 명세에 없다"는 사실과 다르다 — AI v4.6 AI-13 출력 스키마 줄(`facts[].slot` 목록)에 19개 키가 있다.
- 실제 경로 저장 브리지가 만들기를 두 번 호출로 나눠, 두 번째가 실패하면 행이 남고 화면은 "아무것도 안 만들어짐"으로 알아 다시 누르면 중복 프로젝트가 생긴다(UQ-PA-3).
- 접근성: 변경 충돌 다이얼로그의 첫 포커스가 "새로 불러오기"(편집 버림)이고(UQ-PA-4), 목록 줄에서 Tab/Shift+Tab이 늘 가로채져 키보드 함정이 생긴다(UQ-PA-5).
- 첫 AI 메시지 ② 확인에서 막히면 아무 안내 없이 멈춘다(UQ-PA-6). `(page)` 그룹에 오류 경계가 없다(UQ-PA-7). `?state=` 미리보기에 명세 상태 여러 개가 없다(UQ-PA-8).
- 칩(`quickChips`)은 AI-12·AI-13 표와 문구·`requested_slot`·`requested_action`·`style`·숨김 규칙이 일치한다(주석 하나만 코드와 다름, UQ-PA-13). 첫 메시지 순서 ①→②→③→④→⑤는 구현돼 있으나 동의 창이 ①보다 먼저 뜬다(UQ-PA-9).

## 화면별 점검표

| 화면 ID | Q1 | Q2 | Q3–4 | Q5 | Q6 | Q7 | Q8 | Q9 | Q10 |
|---------|----|----|------|----|----|----|----|----|-----|
| L-02 셸 (PageShell·ShellBar·SaveButton·CrumbRow·LeaveGuard·입력 보존·StaleWriteDialog) | ✅ | ✅ | — | ⚠️ (UQ-PA-7·17) | ⚠️ (UQ-PA-8) | — | ✅ | ❌ (UQ-PA-4) | ✅ |
| 입력 보존 (`useInputPreservation` + 참고 배선) | ⚠️ | ✅ | — | — | — | — | — | — | — |
| ↳ (데이터 손실) | ❌ (UQ-PA-1·18) | | | | | | | | |
| 문서형 입력 (DocTitleInput·DocTextarea·FieldRows·ChipSelect·CompetencyChips·ResizeHandle·MonthField sm) | ✅ | ✅ | — | — | — | — | ✅ | ❌ (UQ-PA-5) | ✅ |
| DocBody 2단·좁은 화면 시트 | ✅ | ✅ | — | — | — | — | ✅ | ⚠️ (UQ-PA-14) | ⚠️ (UQ-PA-15) |
| SourceChip (C-15 4종) | ✅ | ✅ | ✅ | — | — | — | ✅ | ✅ | — |
| `types/db.ts` v4.5 | — | — | ❌ (UQ-PA-2) | — | — | — | — | — | — |
| 데이터 계층 `career-v45*` · mock | — | ✅ | ⚠️ (UQ-PA-3·11·12) | — | ⚠️ (UQ-PA-8) | ✅ | — | — | — |
| 턴 스트림 `writing-chat-turn-v45` | — | — | ✅ | — | ⚠️ (UQ-PA-10) | ✅ | — | — | — |
| `quickChips` (AI-12·AI-13 표) | ✅ | ✅ | ✅ | — | ✅ | — | — | — | — |
| AI 패널 코어 (`useAiPanel`·`AiPanel`·`PanelInputArea`) | ✅ | ✅ | ✅ | — | ⚠️ (UQ-PA-6·9) | ✅ | ✅ | ⚠️ (UQ-PA-16) | ✅ |
| `(page)` 라우트 그룹 · 동의 게이트 | — | — | — | ⚠️ (UQ-PA-7) | — | — | — | — | — |
| `/dev/page-shell` 데모 (참고 배선) | ⚠️ (UQ-PA-1·18) | ✅ | — | — | ✅ | ✅ | ✅ | — | — |

동의 게이트 동등성: `(page)/(gated)/layout.tsx`는 `(dashboard)/(gated)`와 같은 `ConsentGate` + Suspense(폴백만 `PageShellSkeleton`)라서 일치 ✅. `(page)/layout.tsx`의 제공자(`AiConnectionProvider`·`AiJobWatcher`·`PreviewStateSwitcher`·`DeletionIncompleteGuard`)도 일치. 빠진 것: `error.tsx`(UQ-PA-7), `AiOutageSlot`(UQ-PA-17). `CareerReturnSlot`(C-10)은 L-02에서 페이지가 `ShellBanners`에 직접 그리게 돼 있어 의도된 차이(A2 확인 필요).

토큰: 새 파일 전체에서 hex·`rgb()`·`oklch()`·팔레트 클래스·임의 px 0건. `--shell`·`--panel`(+foreground) 라이트·다크·`@theme` 매핑이 디자인 시스템 1.1.2 표와 같은 값. `rounded-2xl/3xl` 덮어쓰기 없음. 포커스 링은 A-3 `ring-2 ring-ring` 사용.

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-PA-1 | **Critical** | foundation | L-02 입력 보존 | 02 1.3a "입력 보존": "다시 열면 '저장하지 않은 수정이 있어요 · 이어서 편집 / 버리기'. 저장에 성공하거나 '저장하지 않고 나가기'를 고르면 지운다" · UX-7 | `src/components/common/shell/page-shell.tsx:588-602` (`write(null)` = 삭제) · `src/components/common/dev-page-shell-demo.tsx:84-86`, `:318-320` (마운트 직후 `write(dirty ? … : null)`) | 다시 연 페이지에서 사용자가 "이어서 편집 / 버리기"를 고르기 전에는 보존본이 저장소에 남는다 | 마운트 첫 렌더에서 `dirty = false` → `preserved.write(null)`가 500ms 뒤 `localStorage.removeItem(key)`. 배너는 메모리 `stored`로만 보이고, 고르지 않고 탭을 닫으면(변경 없음 상태라 `beforeunload` 확인도 없음) 보존본이 영구히 사라진다. 배너가 떠 있는 동안 아무 칸이나 고쳐도 옛 보존본을 덮어쓴다. 또 언마운트 때 대기 중 타이머를 지워 마지막 0.5초 입력이 보존되지 않는다(`:604-606`). → 훅이 "배너 응답 전에는 쓰기·지우기 보류"를 스스로 지키거나(`stored`가 있고 dismiss/clear 전이면 `write` 무시), `write(null)` 대신 명시적 `clear`만 지우게 계약을 바꾸고, 언마운트 때는 대기 값을 즉시 쓴다. 데모도 같이 고친다(A2가 그대로 옮김) |
| UQ-PA-2 | Major | foundation | S-44 · AI-13 | 03 AI-13 출력 스키마 "`facts[].slot` = 종류별 슬롯 키(`background`, `goal`, `contribution`, `scope`, `outcome`, `requirements`, `structure`, `decisions`, `limits`, `went_well`, `went_wrong`, `learnings`, `audience`, `message`, `outline`, `reaction`, `what`, `purpose`, `content`)" + 종류별 슬롯 표(설계 문서 슬롯 5 "결과·한계", 발표 슬롯 5 "반응·결과") · DM 2.5.0 "`slot`(AI 명세 슬롯 키)" | `src/types/db.ts:587-604` (`DeliverableSlot`), `src/lib/data/labels.ts:509`, `:523` | `DeliverableSlot`에 19개 키 전부, `design_doc` 슬롯 5 = `limits`, `presentation` 슬롯 5 = `reaction` | `limits`·`reaction` 없음. 두 자리를 `outcome`으로 매핑 → 서버가 `missing_slots: ["limits"]`를 보내면 `deliverableSlotLabel`이 키 그대로 "limits"를 화면에 보이고, `firstEmptyDeliverableSlot`은 서버와 다른 키(`outcome`)를 `requested_slot`으로 보낸다. 엔지니어 보고 "기획 확인 필요 — 슬롯 영문 키가 명세에 없다"는 사실과 다름(`contribution`·`went_well`·`went_wrong` 외 키도 명세에 있음). `[UI-가정]` 주석(`db.ts:585`)도 고칠 것 |
| UQ-PA-3 | Major | foundation | S-10 저장 (실제 경로) | 02 S-10 "서버 거부 코드(모두 아무것도 쓰지 않음, DM v4.5)", "프로젝트 생성이 실패하면(③) 아무것도 만들지 않고" · DM 2.5.1 "만들기와 고치기를 같은 RPC로", 거부 시 "아무것도 쓰지 않음" | `src/lib/data/career-v45.ts:410-455` (`createProject` → `saveProjectSection` 두 번 호출) | 만들기 실패 = 행 없음. 실패 응답 뒤 다시 누르면 같은 페이지가 한 행만 만든다 | `createProject`로 행이 생긴 뒤 `saveProjectSection`이 실패하면(`field_too_long`·`invalid_period`·네트워크 등) `{ok:false}`를 돌려줘 화면은 `project_id = null` 그대로 → 다시 "저장하기"·첫 AI 메시지 다시 시도마다 **새 `draft` 프로젝트가 또 생긴다**(소속 카드 그리드에 이름만 있는 중복 행). → 두 번째 단계 실패 시 만든 id를 오류와 함께 돌려줘 화면이 `project_id`를 잡게 하거나(부분 성공 응답), 실패하면 방금 만든 행을 지우고 실패로 돌려준다. `// 연결 대기` 표시와 무관하게 지금 실제 경로에서 일어난다 |
| UQ-PA-4 | Major | foundation | L-02 변경 충돌 확인 | 02 S-10 "새로 불러오기 = 저장하지 않은 변경과 [반영] 기억을 버리고 다시 읽는다" · 디자인 시스템 5.8 "버튼 `새로 불러오기`(outline) · `내 내용으로 저장`(default). Esc·바깥 누름은 닫기만" | `src/components/common/shell/page-shell.tsx:358-360` (`AlertDialogCancel` = 새로 불러오기) | 다이얼로그 첫 포커스가 편집을 버리지 않는 쪽 | Radix `AlertDialog`는 열릴 때 `AlertDialogCancel`에 포커스를 준다 → 첫 포커스가 "새로 불러오기"(편집 버림). 키보드 사용자가 Enter 한 번으로 저장 안 한 편집을 잃는다. → "새로 불러오기"를 일반 `Button variant="outline"`으로 바꾸고 `onOpenAutoFocus`로 "내 내용으로 저장"(또는 다이얼로그 본문)에 첫 포커스 |
| UQ-PA-5 | Major | foundation (+ ui-designer 규칙 보강) | S-10 STAR · S-44 본문 | 디자인 시스템 5.9 `DocTextarea` "목록 줄에서 Tab / Shift+Tab은 2칸 들여쓰기 / 내어쓰기 … 목록이 아닌 줄의 Tab은 기본(포커스 이동)으로 둔다(키보드 함정 방지)" · UX-8 · 스킬 Q9 | `src/components/common/doc-inputs.tsx:82-94`, `:122` | 키보드만으로 칸을 빠져나갈 수 있다 | 캐럿이 목록 줄에 있으면 Tab·Shift+Tab을 늘 가로챈다. 내어쓸 공백이 없을 때도 `indentList`가 `{value, caret}`를 돌려줘 `preventDefault`(`:90`) → Shift+Tab으로 뒤로 나갈 수 없다. 본문이 전부 목록이면(산출물에서 흔함) Tab·Shift+Tab 어느 쪽으로도 칸을 떠날 수 없는 키보드 함정(WCAG 2.1.2). → 최소: 내어쓸 게 없으면 `null`을 돌려 기본 동작으로. 그리고 Esc 뒤 Tab은 포커스 이동(또는 들여쓰기를 Ctrl+]/[ 등으로) 같은 탈출 규칙을 디자인 시스템에 추가(ui-designer) |
| UQ-PA-6 | Major | foundation | S-10·S-44 패널 첫 메시지 ② | 02 S-10 "키 없음·동의 필요·키 무효는 저장보다 먼저 판정한다(C-18·C-21·C-20). 막히면 프로젝트도 만들지 않는다" · DM 7장 "② AI 사용 가능 확인(`get_data_readiness().ai_connection` — 키 없음·무효·동의 필요면 여기서 멈추고 행도 만들지 않음)" | `src/components/career/ai-panel/use-ai-panel.ts:544-553` | ②에서 막히면 해당 C-18 / C-21 / C-20 안내가 보이고, 동의 필요도 ②에서 판정 | ① `fresh.active_provider`가 없거나 조회가 실패하면(`.catch(() => null)`) `setPhase("idle"); return` — 안내 없이 멈춤(입력은 남지만 패널은 잠기지 않고, 연결 컨텍스트도 갱신 안 됨). ② 새로 읽은 `consent_required`를 보지 않는다 — 페이지를 연 뒤 공급자가 바뀌어 동의가 필요해진 경우 ③ 저장으로 행을 만든 다음 턴이 `ai_consent_required`로 거부돼 "막히면 행도 안 만듦"을 어긴다. → 막힌 원인별 블록(C-18 인라인 / C-21 열기 / C-20)과 조회 실패 안내("연결 상태를 확인하지 못했어요 · 다시 시도" `[UI-가정]`), 연결 컨텍스트 새로 고침 |
| UQ-PA-7 | Major | foundation | L-02 (S-28 동등성) | 02 S-28 일반 오류 · ui-context "foundation: S-28 error" · `(dashboard)/error.tsx` "S-28 general error inside the shell" | `src/app/(page)/` (`error.tsx` 없음, 루트 `src/app/`에도 `error.tsx`·`global-error.tsx` 없음) | L-02 화면에서 렌더 오류가 나면 S-28 `ErrorState`(다시 시도) | `(page)` 그룹에 오류 경계가 없어 S-10·S-44 서버/클라이언트 예외가 Next 기본 오류 화면으로 간다. → `(page)/error.tsx`(`ErrorState kind="error" inShell={false}` + reset). 필요하면 `(page)/not-found.tsx`도(지금은 루트 not-found로 감 — S-10은 ST-NOTFOUND → S-08이 명세라 A2 처리와 함께 확인) |
| UQ-PA-8 | Major | foundation | `?state=` (S-10·S-44 페이지·패널) | ui-context "every ST-xx state can be rendered" · 02 S-10 상태(페이지) "검증 오류 / 저장됨 + 반영 기록 일부 건너뜀(`skipped`) / 독립 프로젝트 ID(→ S-43)" · 상태(패널) · S-44 상태(패널) "초안 실패(이전 초안 유지 + 다시 시도) / 초안 상한 도달(6회)" · S-44 "산출물 50개 상한" · S-10 "프로젝트 생성이 실패하면 … '저장하지 못해 대화를 시작하지 못했어요'", "대화 시작이 실패하면" · `invalid_form_snapshot` | `src/lib/data/career-v45.ts:60-85` (`PAGE_PREVIEW_STATES`, `pagePreviewHints`) | 명세 상태마다 미리보기 값 하나 | 없는 값: `skipped`(저장 응답 건너뜀 줄 — mock이 판정은 하지만 바로 볼 길 없음), `draft-limit`(6회: 칩 교체 + 안내 + [새 대화]), `draft-failed`(초안 턴 중 실패·이전 초안 유지), `deliverable-limit`(새 산출물 50개), `first-save-failed`·`start-failed`(첫 메시지 ③·④ 실패), `invalid-form-snapshot`, `chat-closed-other-tab`(409 `writing_chat_closed` — 지금 `chat-closed`는 40개 상한 모양만), `standalone`(독립 프로젝트 id → S-43)·`affiliated-parent`(산출물 부모가 소속 → S-10). mock 턴 생성기는 `draft_limit`·`writing_chat_closed`·`invalid_form_snapshot`을 지원하는데(`lib/mock/writing-chat-turn-v45.ts:100-102`) 이를 켜는 `?state=`가 없다. A2가 실제 화면에서 같은 힌트를 쓰므로 지금 넣어야 한다 |
| UQ-PA-9 | Minor | foundation | 패널 첫 메시지 순서 | DM 7장 "① 이름·제목이 비면 보내지 않음 → ② AI 사용 가능 확인(… 동의 필요면 여기서 멈춤)" (순서 확정) | `src/components/career/ai-panel/use-ai-panel.ts:590-596` (잠금·키 무효·C-21) vs `:533` (①) | ① 이름 확인이 동의 창보다 먼저 | `send`가 `consent.guard`(C-21)를 먼저 열고, 동의 후 `sendInner`에서 ①을 본다 → 이름이 빈 새 페이지에서 동의 창을 거친 뒤에야 "프로젝트명을 먼저 입력해 주세요"가 나온다. 키 무효도 ①보다 먼저 막는다. 저장보다 먼저라는 핵심 규칙은 지켜지므로 Minor |
| UQ-PA-10 | Minor | foundation | 패널 전송 막힘 | 엔지니어 보고 "실제 경로에 v4.5 백엔드가 없는 호출 = '아직 연결 준비 중인 기능이에요…'" · 02 S-10 "전송이 막힐 때" | `src/lib/data/writing-chat-turn-v45.ts:187-189` | `backend_pending` 거부는 패널 블록 "아직 연결 준비 중인 기능이에요…" | `refused` 요청의 `backend_pending`·`failed`를 `schema_invalid`로 바꿔 내보내 `blockOf`가 못 잡고, 실패한 턴 C-20("다시 보내기")로 그린다. `backend_pending`은 그대로 통과시키고 `blockOf`에서 블록으로 |
| UQ-PA-11 | Minor | foundation (`연결 대기`) | S-10·S-44 저장 (실제 경로) | 02 C-15 상태 ⑤ "'저장하기' 성공 뒤 저장 응답 `applied`에 든 섹션에 '반영됨'" · DM 2.5.1 반영됨 기록 | `src/lib/data/career-v45.ts:451`, `:496` | 실제로 기록된 것만 `applied` | v4.4 브리지는 반영 기록을 남기지 않는데 전부 `applied`로 돌려준다 → 저장 직후 "반영됨"이 보이다가 새로 고치면 같은 제안이 다시 "제안" 상태로 나와 [반영]을 또 누르면 같은 문장이 STAR에 두 번 붙는다. 표시는 문서화돼 있으나 사용자에게 보이는 위험이라 기록함. 대안: 실제 경로는 `applied: []` + `skipped: mark_failed`("일부 반영 기록을 남기지 못했어요. 저장한 내용은 그대로예요")로 정직하게 돌려주기 — 리더 판단 |
| UQ-PA-12 | Minor | foundation | S-10·S-44 저장 거부 코드 | 02 S-10 거부 코드 표(`project_name_required`, `invalid_classification`, …) · S-44 `deliverable_title_required` | `src/lib/data/career-v45.ts:148-166` (`saveErrorOf`) | 서버 거부 코드가 그 칸 문구로 | `project_name_required`·`invalid_classification`·`deliverable_title_required`·`invalid_fields`·`project_affiliation_required`·`project_not_affiliated`가 `save_failed`로 뭉개져 칸 문구 대신 "저장하지 못했어요"가 된다(v4.4 서비스가 같은 이름을 쓰면 그대로 넘기기). `field`도 v4.4 이름(camelCase일 수 있음)이면 v4.5 키로 바꿔야 칸에 붙는다 — 확인 필요 |
| UQ-PA-13 | Minor | foundation | AI-13 칩 | 03 AI-13 칩 표 "초안 불가 … '무엇을 쓰면 좋을지 알려 줘'(다음 슬롯 안내)" | `src/lib/data/quick-chips.ts:138-139` | 주석과 코드가 같은 규칙 | 주석 `[UI-가정]`은 "'다음 슬롯 안내'·'부모 description 기반 질문'은 `requested_slot` 없음(서버가 고름)"인데 코드는 `whatToWrite`에 `missing`(첫 빈 슬롯)을 단다(보고서도 "첫 빈 슬롯"). 어느 쪽인지 정해 주석·코드·보고를 맞춘다. 그 밖의 칩 문구·`requested_slot`·`requested_action`·`style`·행 판정·36개 숨김·`closed` 숨김은 표와 일치 |
| UQ-PA-14 | Minor | foundation | L-02 좁은 화면 시트 | 디자인 시스템 A-14 "좁은 화면 시트는 shadcn `Sheet`의 포커스 가둠" · 스킬 Q9 "dialog focus trap/restore" | `src/components/common/shell/doc-body.tsx:100-111` | 시트를 닫으면 여는 버튼으로 포커스가 돌아온다 | 떠 있는 "Resumate AI" 버튼을 시트가 열린 동안 렌더하지 않아(`!placement.sheetOpen`) Radix가 돌려줄 대상이 사라짐 → 닫으면 포커스가 `body`로. 버튼을 숨김(`invisible`/`aria-hidden`)으로 두거나 `onCloseAutoFocus`로 버튼에 포커스(코드 정독 판단, 브라우저 확인 권장) |
| UQ-PA-15 | Minor | foundation | L-02 좁은 화면 | 디자인 시스템 5.8 좁은 화면(떠 있는 버튼 `fixed bottom-4 right-4`) · UX-9 | `src/components/common/shell/doc-body.tsx:85`, `src/components/career/ai-panel/use-ai-panel.ts:241` | 마지막 칸·글자 수가 떠 있는 버튼에 가리지 않고, 좁은 화면 첫 렌더가 한 단 | 왼쪽 영역 아래 여백이 `py-6`뿐이라 맨 아래 STAR "배운 점"·S-44 "n / 20,000"이 버튼(h-11)에 가릴 수 있다(좁은 화면에서 `pb-20` 등). 또 `mode` 기본값이 `"wide"`라 SSR·첫 페인트는 휴대폰에서도 2단(패널 포함)으로 그렸다가 측정 뒤 한 단으로 바뀐다 |
| UQ-PA-16 | Minor | foundation | 패널 메시지 | 02 S-10 메시지 목록 "사용자 발화 클릭 → 제안 카드 강조" · 민감정보 안내 "대화 삭제(C-05) 바로가기" | `src/components/career/ai-panel/ai-panel.tsx:290-300`, `:317` | 누를 일이 있을 때만 버튼, 바로가기는 C-05를 연다 | `onUserMessageClick`이 없어도 말풍선이 `<button>`이라 탭 순서에 아무 일도 안 하는 버튼이 생긴다. 민감정보 "대화 삭제"는 `document.querySelector("[aria-label='대화 메뉴']").click()`으로 ⋯ 메뉴만 연다(C-05 직접 열기 아님, 화면에 패널이 둘이면 엉뚱한 것을 누름) → `setDeleting(chat.id)`을 직접 호출 |
| UQ-PA-17 | Minor | foundation (기획 확인 겸) | L-02 셸 | `(dashboard)/layout.tsx` `AiOutageSlot`(S-28 "활성 공급자 장애" 배너) · 02 1.3a 표(배너 자리 = C-10만 언급) | `src/app/(page)/layout.tsx:12-25` | 활성 공급자 장애 안내가 L-02에서도 보인다(또는 의도적으로 뺀다는 결정) | L-02에는 장애 배너 자리가 없다. 패널 턴 실패 C-20이 알려 주긴 하지만 보내기 전에는 모른다. 1.3a가 언급하지 않으므로 리더 판단으로 넣을지 정할 것 |
| UQ-PA-18 | Minor | foundation | L-02 변경 충돌 "새로 불러오기" | 02 S-10 "'새로 불러오기' = 저장하지 않은 변경과 [반영] 기억을 버리고 다시 읽는다(버린다고 함께 알림)" | `src/components/common/dev-page-shell-demo.tsx:264`, `:463` (`window.location.reload()`) · `page-shell.tsx` (도우미 없음) | 확인 없이 버리고 다시 읽는다, 다시 열어도 보존 배너가 없다 | 참고 배선이 `location.reload()`라 ① dirty라서 브라우저 `beforeunload` 확인이 한 번 더 뜨고 ② 입력 보존을 지우지 않아 새로 읽은 페이지에 "저장하지 않은 수정이 있어요" 배너가 다시 뜬다. `useLeaveGuard`에 우회(bypass) + `preserved.clear()` + `router.refresh()`를 묶은 도우미를 두고 데모도 그걸 쓰게 |
| UQ-PA-19 | Minor | foundation | 기계 검사 — 새 코드 테스트 | 스킬 "tests for new code" (리더 지시) | `src/lib/data/quick-chips.test.ts`만 새로 있음 | 순수 로직에 단위 테스트 | `continueList`/`indentList`(UQ-PA-5), `saveErrorOf`·저장 브리지(UQ-PA-3·12), `blocksToMarkdown`·`bodyHash`, mock `skipped` 판정, `useInputPreservation`(UQ-PA-1)에 테스트가 없다. 특히 UQ-PA-1·3·5는 테스트가 있었으면 잡혔을 회귀다 |

### 확인한 것 중 문제없음 (참고)

- **L-02 셸**: 상단 바 순서(로고 · [Resumate AI](넓은 화면·패널 닫힘만) · C-06 · 저장하기 · 계정), 계정 메뉴 5항목·순서, 로고 = S-08 + 이탈 확인(문서 캡처 클릭), 이동 경로 "회사명 › 프로젝트명 › 프로젝트 상세" + 빈 이름 자리표시, 좁은 화면 "← {상위}"·저장하기 늘 보임, `aria-current="page"`. SaveButton 7상태가 1.3a·5.8 표와 일치(표식 점 + `sr-only`, 저장 중 비활성, 실패 활성 + "저장하지 못했어요 · 다시 시도", 좁은 화면 토스트), Ctrl/⌘+S가 브라우저 저장 창을 막고 활성일 때만 저장. 이탈 확인 3버튼·문구, 첫 포커스 "계속 편집"(안전), "저장하고 나가기" 실패 시 머묾, `beforeunload`. 충돌 다이얼로그 문구, Esc는 닫기만. 토스트 왼쪽 아래.
- **ResizeHandle**: `role=separator` + `aria-valuenow/min/max/valuetext`, ←/→ 16·Shift 64·Home·End·Enter 420, 폭 기억 try/catch, 카드 50%·왼쪽 448 보장(A-14·5.9 일치).
- **패널**: 머리(Sparkles·이름·C-19·기록·새 대화·⋯ "이 대화 삭제" C-05·× / 좁은 화면 "STAR 보기"·"본문 보기"), 기록 목록(제목/"새 대화"·상대 시각·n/40·"끝난 대화"·빈 목록), 시작 영역 + 고정 안내(S-10·S-44 문구 일치) + 무료 등급 줄, 입력창 문구·Enter/Shift+Enter·한글 조합, n/40, 40개 닫힌 대화 문구·[새 대화]·[모두 반영] 슬롯, `writing_chat_closed`·`draft_limit`·`invalid_form_snapshot`·50개 상한·첫 저장 실패 문구가 명세 그대로. 첫 메시지 ①→②→③→④→⑤와 토스트 "대화를 시작하려고 …을 저장했어요". 닫으면 [Resumate AI]로, 다시 열면 입력창으로 포커스. 스트리밍 완료 때만 낭독. 응답 방식(SSE, AI-12/AI-13 이벤트 순서, 초안 턴의 `draft_started`/`draft_block`/`draft_done` 임시 블록 → 확정 교체, 실패 시 이전 초안 유지) 일치.
- **타입**: `WritingChatV45.project_deliverable_id`, STAR 필드 객체 `op`·`rev`·`applied_at`, 분류 필드 객체(`reason`, `op`·`source_quotes` 없음), `DeliverableStructuredDraft` 키 전부(`schema_version 1`·`target`·`writing_kind`·`facts[]`·`deliverable.body`(`value`·`blocks`·`rev`·`generated_at`·`base_body_hash`·`replace_allowed`·`missing_slots`·`dropped_block_count`·`applied_at/mode/rev`)·`clarifications{kind,slot,note}`·`draft_count`), 블록 `type` 7종·`basis` 2종·`PRJ.*` 5종, `skipped.reason` 6종, 거부 코드 목록이 DM 2.5.0·2.5.1과 같은 이름. (UQ-PA-2만 예외)
- **SourceChip**: 4종 라벨, "프로젝트 내용에서" = `span tabIndex=0` + Tooltip(항목 이름 5종), 칩 모양 C-01 `CHIP_CLASS`(A-3 링).

## 기획 확인 필요

| 항목 | 내용 | 양쪽 인용 |
|------|------|-----------|
| (없음 — 엔지니어 보고 1번 정정) | 엔지니어 보고 "S-44 · AI-13 종류별 슬롯의 영문 키가 명세에 없다"는 **명세에 있다**. 기획 질문에서 빼고 UQ-PA-2로 구현을 맞춘다. 다만 회고 슬롯 1 "무엇을 했나(범위)"의 키가 목록상 따로 없어 `scope`(기획서 요약 슬롯 4와 같은 키)를 재사용하는 것으로 읽힌다 — 이 재사용이 맞는지만 확인 | 03 AI-13 "`facts[].slot` = 종류별 슬롯 키(`background`, `goal`, `contribution`, `scope`, `outcome`, `requirements`, `structure`, `decisions`, `limits`, …)" / 보고서 "`contribution`·`went_well`·`went_wrong` 외 키를 정해 달라" |
| L-02 장애 배너 | UQ-PA-17 — L-01에는 있고 1.3a에는 없다. 넣을지 리더 판단 | `(dashboard)/layout.tsx` `AiOutageSlot` / 02 1.3a 표 |
| 엔지니어 보고의 나머지 기획 확인 5건 | `base_body_hash` 정규화, 초안 6회 칩 구성, L-01 계정 메뉴 5항목, 이탈 확인 설명 문구 — 구현은 보수적 가정으로 돼 있고 QA가 보기에 명세 모순은 아님. 그대로 리더에게 전달 | 22 보고서 "기획 확인 필요" |

## 재확인 결과

첫 라운드(이전 `UQ-PA-*` 없음). 다음 라운드에서 UQ-PA-1~19를 해결 / 미해결 / 재발로 표시한다.

## 기계 검사 출력

| 검사 | 결과 | 메모 |
|------|------|------|
| `pnpm lint` | 통과 (exit 0) | 경고·오류 0 |
| `pnpm typecheck` | 통과 (exit 0) | `next typegen` 후 `tsc --noEmit` |
| `pnpm vitest run src/lib/data/quick-chips.test.ts` | 15/15 통과 | |
| `pnpm vitest run src/lib/data/mock-isolation.test.ts src/lib/data/source.production.test.ts` | 14/14 통과 | v4.5 mock이 미리보기 분기 밖으로 새지 않음 |
| 전체 `pnpm test` | 실행 안 함 | 엔지니어 보고의 실패 3건은 로컬 Supabase 통합 테스트(`PGRST202`)로, 이번 범위 밖 |
| `pnpm build` | 성공 (exit 0) | 워크트리에 `.env.local` 없음 → `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder`로 실행. 정적 페이지 44/44, `○ /dev/page-shell` 포함 |
| 개발 서버 `/dev/page-shell` SSR | 20개 조합 모두 200 | 기본·`new`·`dirty`·`save-failed`·`stale`·`ai-locked`("AI 연결하기")·`key-invalid`·`consent-required`·`chat-closed`("이 대화가 길어졌어요")·`ai-stream`·`ai-failed`·`empty`·`not-found`(루트 not-found 렌더)·`loading`·산출물 기본·`draft-ready`·`needs-review`·`draft-streaming`·새 산출물·산출물 `empty`. 상호작용은 미확인(브라우저 도구 미사용) |

---

# 라운드 2 (최종, 2026-11-03)

- 범위: UQ-PA-1~19 재확인 + 수정된 파운데이션 파일의 회귀만(`components/common/**`, `components/career/ai-panel/**`, `lib/data/*v45*`, `lib/data/quick-chips*`, `lib/mock/*v45*`, `types/db.ts`, `app/(page)/layout.tsx`·`error.tsx`). S-10·S-44 영역 작업 중 파일(`app/(page)/(gated)/career/**`, `components/career/**` 중 ai-panel 외)은 보지 않았다.
- 리더 판정 반영: UQ-PA-17 장애 배너 넣기, UQ-PA-11 실제 경로 `applied: []` + `skipped: mark_failed` 채택, 디자인 시스템 5.9에 Tab/Esc 규칙 추가.
- 방법: 코드 정독(브라우저 상호작용은 이번에도 미확인 — UQ-PA-4·5·14 포커스 판정은 코드 경로 기준).

## 요약

**19건 중 19건 해결** (부분 해결·재발 0). 남은 **Critical / Major 0**. 수정 파일에서 새 Minor 2건(UQ-PA-20·21)과 사소한 정리 1건. 기계 검사 lint·typecheck·파운데이션 테스트 7파일 60개·build 모두 통과.

## 재확인 결과

| ID | 심각도 | 판정 | 근거 (코드) |
|----|--------|------|-------------|
| UQ-PA-1 | Critical | 해결 | `shell/input-preservation.ts` — 이전 방문 보존본은 `pendingValue`가 있는 동안 `write`·`commit` 무시, `write(null)`은 `wroteThisVisit`일 때만 삭제, `clear()`만 항상 삭제, `dispose()`·`pagehide`에서 `commit`. 훅 `page-shell.tsx:591-627`이 store를 그대로 감싸고 `resolve()` 제공. 데모 `dev-page-shell-demo.tsx:166-173`·`:385-392`가 "이어서 편집 = 값 적용 + resolve / 버리기 = clear". 테스트 `input-preservation.test.ts` 통과 |
| UQ-PA-2 | Major | 해결 | `types/db.ts:596`·`:603`에 `limits`·`reaction`, `labels.ts:509` 설계 문서 슬롯 5 = `limits`, `:523` 발표 슬롯 5 = `reaction` |
| UQ-PA-3 | Major | 해결 | `career-v45-bridge.ts` — 새 페이지 `client_id`로 `createProject`(v4.4 `save.ts:165` 같은 id 재시도 시 손대지 않은 행 반환), 두 번째 호출 실패 시 `error.created` 반환, 데모 `:106-110`이 id를 잡아 다음 저장은 고치기. 산출물도 `client_id`. (보존 키 측면 잔여 → UQ-PA-21) |
| UQ-PA-4 | Major | 해결 | `page-shell.tsx` `StaleWriteDialog` — "새로 불러오기" = 일반 `Button variant="outline"`, `onOpenAutoFocus`로 `keepRef`("내 내용으로 저장")에 첫 포커스 |
| UQ-PA-5 | Major | 해결 | `doc-list-keys.ts` `indentList` — 내어쓸 공백 0 또는 깊이 6칸 초과면 `null`(기본 포커스 이동). `doc-inputs.tsx:85-107` Esc 뒤 Tab 미가로챔, 선택 영역 있으면 기본. 디자인 시스템 5.9(`design-system.md:1628`) 규칙과 일치 |
| UQ-PA-6 | Major | 해결 | `use-ai-panel.ts:558-591` — ② 조회 실패 → `connection_check_failed`("연결 상태를 확인하지 못했어요 · 다시 시도"), 공급자 없음 → C-18 인라인, 키 무효 → C-20, `consent_required` → C-21 후 ②부터 재개(행 없음), `refreshConnection()`. 턴 직전 `ai_consent_required` → C-21, `key_missing` → C-18(`blockOf`) |
| UQ-PA-7 | Major | 해결 | `app/(page)/error.tsx` = `ErrorState kind="error" inShell={false}` + `reset` |
| UQ-PA-8 | Major | 해결 | `career-v45.ts:60-84` `PAGE_PREVIEW_STATES`에 `skipped`·`first-save-failed`·`start-failed`·`invalid-form-snapshot`·`chat-closed-other-tab`·`draft-failed`·`draft-limit`·`deliverable-limit`·`standalone`·`affiliated-parent` 추가, `pagePreviewHints`로 턴 오류 연결(`:88-89`) |
| UQ-PA-9 | Minor | 해결 | `use-ai-panel.ts:618-634` `send`에서 ① `requireName()`이 키 무효·`consentGuard`보다 먼저 |
| UQ-PA-10 | Minor | 해결 | `writing-chat-turn-v45.ts:190-191` `backend_pending` 그대로 → `blockOf` → `panel-input.tsx:139` 안내 블록 |
| UQ-PA-11 | Minor | 해결 (리더 판정) | `career-v45-bridge.ts` 성공 응답 `applied: []`, 모든 반영 원소 `skipped: mark_failed` |
| UQ-PA-12 | Minor | 해결 | `saveErrorOf` — v4.5 이름 거부 코드 통과(`PASS_THROUGH`), camelCase `field` → v4.5 키, `invalid_input` + 월 칸 → `invalid_period`, `conflict` → `stale_write`. 테스트 있음 |
| UQ-PA-13 | Minor | 해결 | `quick-chips.ts:140` 코드 = 주석(첫 빈 슬롯, "프로젝트 내용을 바탕으로"만 슬롯 없음) |
| UQ-PA-14 | Minor | 해결 | `doc-body.tsx` 떠 있는 버튼이 시트 열린 동안 `invisible`·`aria-hidden`·`tabIndex -1`로 남고 `onCloseAutoFocus`로 복귀 |
| UQ-PA-15 | Minor | 해결 | `doc-body.tsx` 좁은 모드 `pb-24`, 패널·손잡이 래퍼 `max-lg:hidden`(첫 페인트 2단 방지), `lg:min-w-[28rem]` |
| UQ-PA-16 | Minor | 해결 | `ai-panel.tsx:291` `onUserMessageClick` 있을 때만 버튼, 민감정보 "대화 삭제" = `setDeleting(chat.id)` 직접(`:75`) |
| UQ-PA-17 | Minor | 해결 (리더 판정) | `(page)/layout.tsx` `PageShellOutageSlot`(서버, L-01 `AiOutageSlot`과 같은 판정) → `page-shell-outage.tsx` portal → `page-shell.tsx` ShellBar 아래 `registerOutageSlot` 자리(`empty:hidden`). `?state=ai-outage`는 `AiOutageBanner`가 처리 |
| UQ-PA-18 | Minor | 해결 | `useLeaveGuard().reloadDiscarding` = bypass + `onDiscard`(보존 지움) + reload, 데모 `:271`·`:471` |
| UQ-PA-19 | Minor | 해결 | 새 테스트 4파일(`doc-list-keys`, `input-preservation`, `career-v45-bridge`, `career-v45-shared`) 추가, 모두 통과 |

## 새 이슈 (수정 파일의 회귀·잔여)

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-PA-20 | Minor | foundation | S-10·S-44 패널 첫 메시지 ②~④ 막힘의 "다시 시도" | 02 S-10 "프로젝트 생성이 실패하면 … '저장하지 못해 대화를 시작하지 못했어요'" (다시 시도) · UQ-PA-6 안내 | `src/components/career/ai-panel/panel-input.tsx:112`, `:122`, `:134` (`panel.send()` 인자 없음) · `use-ai-panel.ts:620` (`contentArg ?? input`) | "다시 시도"가 막혔던 그 메시지(칩이면 같은 `requested_slot`·`requested_action`·`style`)를 다시 보낸다 | 첫 메시지를 칩(`sendChip`)이나 빠른 답(`panel.send(q)`)으로 보냈다가 `connection_check_failed`·`first_save_failed`·`start_failed`에 막히면, "다시 시도"는 입력창 글자(대개 빈 값)로 `send()`를 불러 아무 일도 안 일어난다(조용한 실패). 칩이 아니어도 사용자가 입력창을 고친 뒤 누르면 다른 글이 간다. → 막힘 블록에 `{content, sendOpts}`를 담아 두고 "다시 시도"는 그것으로 `sendInner`를 다시 부른다(실패한 턴 C-20의 `failure.content` 방식과 같게) |
| UQ-PA-21 | Minor | foundation | L-02 입력 보존 (새 페이지 부분 성공) | 02 1.3a "입력 보존 … 키: 새 페이지 = 소속 ID + new … 저장에 성공하거나 '저장하지 않고 나가기'를 고르면 지운다" · UQ-PA-3 | `src/components/common/dev-page-shell-demo.tsx:83-88`, `:106-110` (A2 참고 배선) · `src/components/common/shell/page-shell.tsx:570-572` | 새 페이지에서 행이 만들어진 순간 `{소속}:new` 보존본이 행 ID 키로 옮겨지고 `new` 키는 비워진다 | `error.created`로 `projectId`가 바뀌면 보존 키가 `…:{parent}:new` → `…:{rowId}`로 바뀌어 새 store가 만들어지고, 옛 `new` 키 사본은 지워지지 않는다(옛 store는 `dispose`에서 대기 값을 오히려 한 번 더 쓴다). 다음에 같은 소속에서 "프로젝트 추가"로 새 페이지를 열면 이미 만들어진 프로젝트의 편집이 "저장하지 않은 수정이 있어요"로 뜨고, "이어서 편집 → 저장"이 같은 내용의 프로젝트를 하나 더 만든다. 실제 경로·두 번째 호출 실패에서만 일어나 Minor. → `error.created`를 받을 때 옛 키를 `clear()`하고(현재 값은 새 키가 다음 렌더에 씀), 같은 처리를 A2 배선 메모("A2 배선 변경점")에도 적는다. 산출물은 한 번 호출이라 해당 없음 |

사소한 정리 (이슈 번호 없음, foundation): `src/components/common/doc-list-keys.ts:9` 주석 "to be added to design-system 5.9"는 이제 반영됐으므로 "design-system 5.9"로 정정. `docs/ui/design-system.md:1628` 키보드 함정 줄의 들여쓰기가 3칸이라 형제 항목(2칸)과 목록 깊이가 어긋남(ui-designer).

## 기획 확인 필요 (라운드 2)

- 없음 추가. 라운드 1의 회고 슬롯 1 `scope` 재사용 확인과 엔지니어 보고 나머지 항목은 리더에게 그대로 남아 있음.

## 기계 검사 출력 (라운드 2)

| 검사 | 결과 | 메모 |
|------|------|------|
| `pnpm lint` | 통과 (exit 0) | 경고·오류 0 |
| `pnpm typecheck` | 통과 (exit 0) | `next typegen` + `tsc --noEmit` |
| `pnpm vitest run` 파운데이션 7파일 (`doc-list-keys`, `input-preservation`, `career-v45-bridge`, `career-v45-shared`, `quick-chips`, `mock-isolation`, `source.production`) | 60/60 통과 | |
| `pnpm build` | 성공 (exit 0) | `.env.local` 없음 → 공개 env 임시 값 2개. 정적 페이지 44/44, `/dev/page-shell` 포함. 이 시점의 영역 작업 파일 포함 상태로도 통과 |
| 브라우저 상호작용 | 미확인 | 포커스(UQ-PA-4·5·14) 판정은 코드 경로 기준 |
