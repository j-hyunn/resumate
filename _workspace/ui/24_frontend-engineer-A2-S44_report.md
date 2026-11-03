# A2 (E2) 구현 보고 — S-43 산출물 섹션 · S-44 산출물 상세 · C-23 범위 축소

- 작성: frontend-engineer (A2 · E2) / 2026-11-03
- 기준: 플로우 v5.6 S-43 · S-44 · FL-22 · C-05 · C-15 · C-22 · C-23, AI v4.6 AI-13, DM v4.5 2.5.0 · 2.5.1 · 3.3, 디자인 시스템 v4 3.23 · 3.25 · 6장 A2, 파운데이션 보고 22(QA 1라운드 수정 포함), D-UX-28 (a)
- E1 파일(S-10, `projects/new/**`, `projects/[id]/page.tsx`, `star-proposal-card.tsx`, `(dashboard)/…/projects/**`, `writing-chats/**`)과 파운데이션 파일은 건드리지 않았다. 파운데이션 변경은 리더에게 요청해 반영받았다(아래).

## 완료 화면

| 화면 ID | 라우트 | 지원 ?state= | 비고 |
|---|---|---|---|
| S-43 산출물 섹션 | `/career?item=project:{id}` | `deliverable-limit`(50개 비활성 + 이유 줄), `empty`(목록 없음), 그 밖 S-08 값 | 행 = `FileText` + 제목 + `ChevronRight`, `sort_order` 순 → S-44. "+ 산출물 추가" → S-44 새 산출물. 빈 상태 문구. 독립 프로젝트 삭제는 C-05 `scope: "standalone"`(산출물·산출물 대화 연쇄 문구 = 파운데이션) |
| S-08 프로젝트 추가 | 같은 화면 | — | 경력·교육 "+ 프로젝트 추가" → `routes.projectPageNew({experience|education})`(다이얼로그 없음, 행 없음). 프로젝트 카드 → `routes.projectPage(id)` |
| C-23 | (다이얼로그) | — | ① C-22 "프로젝트" → "새 독립 프로젝트"(이름만, 100자, "만들기" 비면 비활성, 실패 "프로젝트를 만들지 못했어요 · 다시 시도", 입력 유지) → draft 행 → S-43 선택 + 프로젝트 정보 수정 모달 자동 열림(= "프로젝트 정보 편집 중"). ② `mode="choose"`: "어디에 프로젝트를 추가할까요?", 경력/교육 묶음 라디오 + "소속 없음(독립 프로젝트)"(+ 독립 안내 줄 + 이름 칸), 경력·교육 → "계속" = 행 없이 S-10 새 페이지 |
| S-44 기존 | `/career/deliverables/{id}` (`?chat=`) | `dirty`, `saving`, `save-failed`, `stale`, `skipped`, `ai-locked`, `chat-closed`, `chat-closed-other-tab`, `invalid-form-snapshot`, `ai-stream`, `draft-streaming`, `draft-failed`, `draft-ready`, `draft-limit`, `needs-review`, `empty`, `not-found`, `affiliated-parent`(→ S-10 + 토스트), `ai-failed*`, `loading` | 파운데이션 `pagePreviewHints` 값 그대로 |
| S-44 새 | `/career/projects/{project_id}/deliverables/new` | 위 + `new`, `first-save-failed`, `start-failed`, `deliverable-limit`(첫 메시지 막힘 · 저장 거부 문구) | 소속 프로젝트 id면 S-10으로 보내고 "산출물은 독립 프로젝트에만 쓸 수 있어요" |

### S-44 구성 (명세 행 대조)
- L-02 `PageShell` + `SaveButton`(⌘/Ctrl+S) + 이동 줄 "← {프로젝트명} › {산출물 제목 / 새 산출물} › 산출물 상세"(프로젝트명 → S-08 `?item=project:`), C-10 `ReturnBanner`, 입력 보존 배너.
- 머리: 제목 = `DocTitleInput`(≤100, 새 페이지 자동 포커스, 자리 표시 "산출물 제목을 입력해 주세요"), ⋯ "산출물 삭제"(행 있을 때만) → C-05 `project_deliverable`(+ 저장 안 한 수정 줄 `unsavedChanges`) → S-08 `?item=project:`(S-43). G-2 안내 1줄.
- 본문: `DocTextarea`, 자리 표시, 비었고 키 있으면 "AI와 초안 쓰기"(패널 열기 + 입력 포커스), "n / 20,000", 20,000 초과는 칸 아래 "20,000자까지 쓸 수 있어요" + 저장 막음, "AI 초안 있음"(미반영 초안 → 패널 열고 카드로 스크롤).
- 저장: `saveProjectDeliverableAction` — 제목 필수(화면 검사 + `deliverable_title_required`), `field_too_long`(칸별), `deliverable_limit_reached`(머리 아래 줄, 입력 유지), `deliverable_requires_standalone_project`(토스트 + S-10), `not_found`, `stale_write`(StaleWriteDialog: 내 내용으로 저장 = 기대 버전 null / 새로 불러오기 = `guard.reloadDiscarding`), 그 밖 ST-SAVE-FAILED. 성공 → `updated_at` 다음 기대 버전, 반영 기록 `p_applied_proposals:[{writing_chat_id, rev, mode}]`, 응답 `applied` → 카드 "반영됨 · 교체/덧붙임"(`applied_at/mode/rev`) + `markApplied`, `skipped` → 카드 아래 한 줄(`PAGE_SAVE_SKIP_COPY`).
- 새 산출물: 첫 저장(또는 패널 ③)으로 행 생성 → `history.replaceState`로 기존 URL(`?state=`·`?chat=` 유지, 페이지 상태 유지). `client_id` 한 번 생성해 재시도마다 재사용. **UQ-PA-21**: 첫 저장 성공 시 키가 바뀌기 전에 `:new` 사본 `clear()` + 키가 바뀐 뒤 effect로 `:new` 키를 한 번 더 지움(이전 store의 dispose flush 대비).
- 패널: `useAiPanel({target:"deliverable", deliverableLimitReached, requireName, savePage, onChatChange, onTurnEvent})` + `<AiPanel renderProposal>`. 제목 비면 ① 막음 + "대화를 시작하려면 산출물 제목을 먼저 입력해 주세요". `onTurnEvent`로 초안 턴 실패(`draft_started` 뒤 `error`)를 잡아 카드에 알림.

### 본문 초안 제안 카드 (`deliverable-draft-card.tsx`)
- 블록 렌더링 7종(제목 2/3단·문단·목록·번호 목록·표·인용·코드), 길면 `max-h-[28rem]` + 덮개 + 펼치기/접기.
- `basis = new` → 왼쪽 선 + "새 내용" 배지, [뒤에 덧붙이기] hover/focus 미리보기(붙을 블록 강조 · 나머지 흐림, sr 설명).
- `needs_review` 블록: 경고 감싸개 + 안내 문구 + [수락](`rev` 그대로) / [빼기](`rev`+1) → `patchDraft({kind:"block_review"})`. 수락 후 "수락함".
- 출처 칩 3종: 사실("이 말에서 정리했어요 · #n 외 k" → 발화 스크롤·인용 강조), "지금 본문에서"(본문 칸 구간 선택, 못 찾으면 토스트), "프로젝트 내용에서"(툴팁).
- "확인이 필요한 내용 N개"(접힘, 사실 [수락]/[거절] — 채움·반영됨 상태에서도 가능), `missing_slots` `chip-dashed`(누르면 그 슬롯으로 "빠진 부분 물어봐 줘" 전송), `dropped_block_count`, 교체 불가 안내, 초안 남은 횟수 `6 − draft_count`(0이면 경고색 + 상한 안내 + [새 대화]).
- 반영 규칙(`deliverable/draft-fill.ts`, 테스트 11개): 채울 블록 = ok/accepted, 빈 제목 제외, 덧붙이기 = `new` + 바로 앞 제목만, 본문 비면 [본문에 넣기](mode replace) 하나, `replace_allowed=false`면 [본문 교체] 숨김, `new` 없으면 [뒤에 덧붙이기] 비활성 + 이유 줄, 모두 needs_review면 전부 비활성 + 이유 줄, "검토하지 않은 문장 N개는 넣지 않아요", 20,000자 초과면 채우지 않고 경고 줄.
- [본문 교체] 확인: `bodyHash(폼 본문)` ≠ `base_body_hash`면 "초안을 만든 뒤 본문이 바뀌었어요 · 그래도 바꾸기" 변형.
- 채운 뒤: 본문 flash + 스크롤, 토스트 "본문에 채웠어요 · 되돌리기"(8초, 다음 본문 입력 뒤에는 "이미 본문을 고쳐서 되돌릴 수 없어요"), 카드 "폼에 채움 · 저장하기를 눌러야 저장돼요" + 블록 버튼·반영 버튼 잠금. 반영됨은 기본 접힘, 버튼 없음.
- 초안 작성 중: 머리 "초안 작성 중"(무료 등급 한 줄), "이전 초안" 접힘, `draft_block` 임시 블록(왼쪽 ai 선 + 커서), 첫 블록 전 Skeleton + 15초 뒤 "긴 글이라 조금 더 걸려요". 초안 실패: "초안을 만들지 못했어요. 이전 초안은 그대로예요" + 원인 문구 + 다시 시도(`panel.retry`), 이전 초안 유지.

## 미완료 / 부분 구현
| 화면 | 내용 | 이유 |
|---|---|---|
| S-44 | C-02 근거 구간 강조(`source_locator {start,end}`로 진입 시 강조·스크롤) | `routes.deliverable`에 구간 인자가 없고 C-02가 S-44로 어떻게 넘기는지 정해진 값이 없다 → 파운데이션 요청 1 |
| C-23 ② | C-09 `create_project`·"직접 입력하기"·S-16 보완점 진입에 연결 | 진입점이 파운데이션(`common/data-gate.tsx`)·A3(`applications/insight-view.tsx`) 파일. 컴포넌트(`AddProjectDialog mode="choose"`)는 준비됨 → 요청 2 |
| S-44 | 좁은 화면 이동 줄 "← {프로젝트명}" | `CrumbRow` 기본 동작 그대로(back.label = 프로젝트명). 브라우저 확인은 못 함 |

## [UI-가정]
| 화면 ID | 파일 | 내용 |
|---|---|---|
| S-43 | `career-overview.tsx` DeliverablesSection | 50개 문구·빈 상태 문구(명세 `[가정]` 그대로) |
| C-22 | `career-overview.tsx` AddCareerMenu | 프로젝트 행 아래 안내 한 줄 "회사·학교 안 프로젝트는 경력·교육 상세의 “+ 프로젝트 추가”로 만들어요" |
| C-23 ① | `career-overview.tsx` | 만든 직후 "프로젝트 정보 편집 중" = 기존 피그마 1009:2 수정 모달을 자동으로 연다(C-24 인라인 편집이 아직 없음) |
| C-23 | `add-project-dialog.tsx` | 좁은 화면도 Dialog(시트 아님), 설명 줄 "이름을 넣고 만들면 …", 글자 수 표시 |
| S-44 | `deliverable-page.tsx` | 본문 자리 표시·글자 수·"AI 초안 있음"·"AI와 초안 쓰기"(명세 `[가정]`) |
| S-44 | `deliverable-page.tsx` | `deliverable_requires_standalone_project` → 토스트 후 S-10(저장 안 됨이라 이탈 확인 없이 이동) |
| S-44 | `deliverable-page.tsx` | URL 교체는 `history.replaceState`(라우트가 바뀌어도 페이지를 다시 그리지 않음) |
| S-44 | `deliverable-draft-card.tsx` | "마무리 중…"은 `draft_done` 전 임시 블록 아래에 늘 둔다(마지막 블록을 알 수 없음) |
| S-44 | `deliverable-draft-card.tsx` | 무료 등급 한 줄 "무료 등급에서는 조금 더 걸릴 수 있어요"(C-03 문구가 코드에 없음) |
| S-44 | `deliverable-draft-card.tsx` | `missing_slots` 칩 = "빠진 부분 물어봐 줘" + `requested_slot` |
| S-44 | `deliverable-draft-card.tsx` | 덧붙이기 미리보기 sr 문구, 반영됨 방식 글자 "교체/덧붙임" |
| S-44 | `deliverable/draft-fill.ts` | 덧붙이기에서 중첩 제목(##/###)은 가장 가까운 제목 하나만, 교체는 바깥 제목까지 |

## 기획 확인 필요
| 화면 ID | 질문 | 스펙 위치 |
|---|---|---|
| C-22 · C-23 ① | 이전 PR #8에서 사용자가 고른 피그마 1009:2 "개인 프로젝트 추가" 일괄 모달(이름·역할·기간·기술·링크·내용 한 번에)을 이번에 C-23 이름 다이얼로그 → 수정 모달 두 단계로 바꿨다(명세·D-UX-28 (a)대로). 일괄 모달을 유지하는 쪽이 사용자 의도라면 되돌려야 한다 — 리더 판단 요청 | UX C-23 ①, D-UX-28, screen-status S-08 |
| S-44 | C-02에서 S-44로 들어올 때 `source_locator` 구간을 URL로 넘길지(예: `?range=start-end`), 세션으로 넘길지 | S-44 "근거 구간 강조" |
| S-44 | "마무리 중"을 언제 보일지(서버가 마지막 블록 표시를 주지 않음) | S-44 AI 응답 방식, C-04 |

## 파운데이션 요청
| # | 요청 | 상태 |
|---|---|---|
| (완료) | `listProjectDeliverables(projectId, {previewState})` | 리더가 추가 → S-08 page가 사용 |
| (완료) | C-05 `project_deliverable` 대상·문구, `scope`·`unsavedChanges`, 삭제 경로 | 리더가 추가 → S-44 ⋯·S-43 삭제에 연결 |
| 1 | `routes.deliverable(id, { chat, range? })` 또는 C-02 → S-44 구간 전달 방식 | 기획 확인 뒤 |
| 2 | C-09(`data-gate.tsx`)의 `create_project`·"직접 입력하기"와 S-16 보완점(A3)에서 `AddProjectDialog mode="choose"`를 열도록 연결(소속 목록 + 최근 완료 경력 id 전달) | 대기 |
| 3 | 옛 링크 `routes.projectNew(...)`가 `experience-form.tsx`·`education-form.tsx`·`writing-chat/*`·`data-gate.tsx`·`insight-view.tsx`에 남아 있다(쿼리 이름 `experience_id` → 새 페이지는 `experience`). 폐기 화면 정리 때 `projectPageNew`로 | E1 / 정리 범위 |

## 검사 결과
- `pnpm lint`: 오류 0, 경고 1(`star-proposal-card.tsx` `isStarField` 미사용 — E1 파일)
- `pnpm typecheck`: 통과. 처음에는 `.next/dev/types/validator.ts`가 E1이 옮긴 `(dashboard)/…/projects/*` 옛 페이지를 가리켜 실패했다(이전 dev 서버가 남긴 생성물). 그 폴더를 치운 뒤 통과 — 소스 문제 아님
- `pnpm vitest run src/components/career src/lib/data/{quick-chips,mock-isolation,career-v45-shared}.test.ts`: 5개 파일 45개 통과(새 `draft-fill.test.ts` 11개 포함)
- `pnpm build`: `.env.local`이 없어 공개 값 2개 임시(`NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`, `NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder`)로 **성공**
- 개발 서버 SSR 스모크(포트 3417, 9개 URL 모두 200): S-44 `draft-ready`·`needs-review`·`draft-limit`(카드 렌더), `not-found`(ST-NOTFOUND), 새 산출물 `new`·`deliverable-limit`, 소속 프로젝트 새 산출물(→ AffiliatedRedirect), S-08 독립 프로젝트 산출물 2행·`deliverable-limit` 이유 줄. 브라우저 상호작용(채우기·되돌리기·교체 확인·저장·URL 교체·삭제)은 직접 눌러 보지 못했다 — QA 확인 필요

## QA 1라운드 수정 (`25_ui-qa_A2-S44_review.md`)

| ID | 심각도 | 상태 | 수정 내용 | 파일 |
|---|---|---|---|---|
| UQ-S44-2 | Major | 해결 | 기존 산출물 라우트가 `parseRangeParam(searchParams.range)`를 `DeliverablePage range`로 넘김 → 첫 렌더 뒤 한 번 `highlightRange(본문, range)`(선택 + 강조) + `scrollIntoView`. 구간이 맞지 않으면 토스트 "지금 본문에서 그 문장을 찾지 못했어요". 입력하면 선택이 풀린다 | `deliverable/deliverable-route.tsx`, `deliverable/deliverable-page.tsx` |
| UQ-S44-3 | Minor | 해결 | 대화가 바뀌면(`onChatChange`) 초안 실패 표시를 지우고, 카드는 `draftFailed && panel.failure`일 때만 실패 줄을 그림 | `deliverable-page.tsx`, `deliverable-draft-card.tsx` |
| UQ-S44-4 | Minor | 부분 해결 | 카드 실패 줄 = 명세 제목 문장 + C-20 `AiErrorNotice size="inline"`(원인 문구·"다시 시도"·대기 카운트다운). 직접 만든 경고 상자와 원인 표는 지웠다. 메시지 목록의 같은 턴 C-20("다시 보내기")을 숨기는 일은 패널 코어라 파운데이션 요청 4 | `deliverable-draft-card.tsx` |
| UQ-S44-5 | Minor | 해결 | 무료 등급 줄 = C-03 공유 함수 `freeTierLine("writing_chat_turn")`. "초안 작성 중"은 C-03에 `compose` 단계 문구 상수가 없어 그대로 둠 `[UI-가정]` | `deliverable-draft-card.tsx` |
| UQ-S44-6 | Minor | 파운데이션 | mock 초안 턴이 `base_body_hash`를 비워 둠 → 파운데이션 요청 5 | — |
| UQ-S44-8 | Minor | 해결 | `deliverable_limit_reached` → 저장 상태 `invalid`(다시 시도 권유 없음), 머리 아래 문구는 제목·본문 입력 때 지움 | `deliverable-page.tsx` |
| UQ-S44-9 | Minor | 해결 | 본문 오류 `id="dlv-body-error"`, 본문 칸 `aria-describedby="dlv-body-error dlv-body-count"` | `deliverable-page.tsx` |
| UQ-S44-10 | Minor | 해결 | 블록 [수락]/[빼기], 사실 [수락]/[거절]에 `aria-label` "‘{앞 24자}’ 수락" 등 | `deliverable-draft-card.tsx` |
| UQ-S44-11 | Minor | 해결 | 카드 key = `chat:applied`(rev 뺌) → [빼기] 뒤에도 펼침·스크롤 유지 | `deliverable-draft-card.tsx` |
| UQ-S44-12 | Minor | 해결 | 저장 성공 뒤 이번 요청에 실은 반영 기록만 지움(저장 중 채운 기록은 다음 저장으로) | `deliverable-page.tsx` |
| UQ-S44-13 | Minor | 해결 | `refresh()` 없는 `deleteDeliverableAction`(area 액션)을 새로 두고 삭제 뒤 클라이언트가 S-43으로 `replace` → S-44 ST-NOTFOUND 깜빡임 없음 | `actions.ts`, `deliverable-page.tsx` |
| UQ-S44-14 | Minor | 해결 `[UI-가정]` | `deliverable_requires_standalone_project`면 바로 떠나지 않고, 입력을 화면에 둔 채 머리 아래에 "이 프로젝트에는 산출물을 추가할 수 없어요" + "프로젝트로 가기" 링크(S-10). 리더가 다르게 판단하면 알려 달라 | `deliverable-page.tsx` |
| UQ-S44-15 | Minor | 해결 | C-22 안내 한 줄을 "프로젝트" 메뉴 항목 안으로 옮김(화살표·스크린 리더로 읽힘) | `career-overview.tsx` |
| P-3 | 리더 판정 | 해결 | "마무리 중" 단계를 없애고 `draft_done`까지 머리 "초안 작성 중" 유지 `[UI-가정]` | `deliverable-draft-card.tsx` |
| 요청 | 파운데이션 | 해결 | `AddProjectDialog`에 `requirementId?`. "계속"이 `projectPageNew({…, requirement_id})`로 넘김 | `add-project-dialog.tsx` |
| 범위 밖 | — | 설명 | S-43 "프로젝트 내용"의 `p.summary`는 R4 호환 타입 `Project`가 독립 프로젝트의 `description`을 `summary`에 담아 주는 것이다(`types/db.ts` 주석). 화면 값은 이미 description이다. 타입에 `description`이 없어 이름만 바꿀 수 없어 주석을 달았다 → 파운데이션 요청 6 | `career-overview.tsx` |
| UQ-S44-1·7·16·17 | — | 파운데이션 | 파운데이션 담당(1·17은 반영됨) | — |

### 파운데이션 요청 (추가)
| # | 요청 |
|---|---|
| 4 | 패널 메시지 목록의 실패 턴 C-20을, 초안 턴 실패이고 S-44 카드가 같은 실패를 보일 때 숨기는 옵션(예: `AiPanel hideFailureInList` 또는 `failure.draft_turn` 플래그) — 다시 시도가 한 곳만 남게 |
| 5 | mock 초안 턴(`writing-chat-turn-v45.ts` `mockDeliverableDraft` 호출)에 `bodyHash(formBody)`를 넣기 — 본문을 고친 뒤 [본문 교체]의 해시 불일치 확인을 미리보기에서 볼 수 있게 (UQ-S44-6) |
| 6 | R4 `Project` 호환 타입을 걷어낼 때 독립 프로젝트 `description`을 그대로 노출 — S-43 "프로젝트 내용"을 `p.description`으로 바꿀 수 있게 |
| 7 | C-03에 `compose` 단계 문구가 있으면 상수로 노출(지금은 "초안 작성 중"을 카드가 직접 씀) |

### 검사 결과 (QA 1라운드 수정 후)
- `pnpm lint`: 오류 0 · 경고 0
- `pnpm typecheck`: 통과. 중간 한 번은 E1의 `project-page/project-page.tsx(698)` 인자 개수 오류로 실패했지만, E1이 수정 중이던 파일이었고 다시 실행하자 통과했다
- `pnpm vitest run src/components/career src/lib/data/{quick-chips,mock-isolation}.test.ts`: 4개 파일 41개 통과(`draft-fill` 11개 포함)
- `pnpm build`(공개 env 임시 값 2개): 통과
- 브라우저 상호작용(구간 강조, 삭제 뒤 이동, 저장 중 채우기)은 직접 확인하지 못했다

### 파운데이션 후속 반영 (요청 4·6·7)
- UQ-S44-4 해결: S-44가 `<AiPanel hideDraftTurnFailure>`를 켬. 카드는 `panel.failure`가 있고 (초안 턴 중 실패 또는 `requested_action = compose_draft`)이면 제목 문장 + C-20 inline(`panel.retry`)을 그린다. 이제 다시 시도는 카드 한 곳뿐이다. 칩 없이 "초안 써 줘"처럼 입력한 초안 턴은 패널이 compose_draft로 알아보지 못해 목록 C-20도 함께 남을 수 있다 `[UI-가정]`(`deliverable-draft-card.tsx`, `deliverable-page.tsx`)
- 요청 6: S-43 "프로젝트 내용" 읽기 = `p.description`, 수정 모달 읽기 = `description ?? summary`, 쓰기 = `description`(`career-overview.tsx`, `add-career-dialog.tsx`)
- 요청 7: 카드 문구 "초안 작성 중"·"긴 글이라 조금 더 걸려요"·실패 문장·"이전 초안"과 15초 기준을 `DRAFT_STAGE_COPY` / `DRAFT_SLOW_AFTER_MS`로 바꿈
- 검사: lint 0 · typecheck 통과 · 관련 vitest 5개 파일 46개 통과 · build 통과(공개 env 임시 값)

### 통합 QA (`26_ui-qa_project-add_round2-integration.md`) — UQ-INT-2 해결
- 저장 응답의 `skipped[]`를 모두 기억한다(첫 원소만 기억하던 방식 폐기). 열린 대화의 건너뜀 → 카드 아래 줄. 다른 대화·삭제된 대화(`not_found`)의 건너뜀 → 머리 아래(G-2 안내 위) 페이지 줄. 같은 문구는 한 번만 보인다. 다음 저장 응답이 오면 바뀐다(`deliverable-page.tsx`). `actions.ts`는 건드리지 않았다.
- 검사: lint 0 · typecheck 통과 · vitest(`src/components/career`, `mock-isolation`) 26개 통과

### 통합 수정 반영 (UQ-INT-3 · UQ-S44-4 마무리)
- S-08이 `?edit=info|content`(`routes.careerItem(…, { edit })`)를 읽어, 기존 `pendingEdit`로 그 독립 프로젝트의 수정 모달을 한 번 연 뒤 URL에서 `edit`을 지운다(replace). 정보·내용 모두 같은 모달이다 — C-24 인라인 편집이 아직 없어서다 `[UI-가정]`(`career-overview.tsx`)
- S-44 `hideDraftTurnFailure={(f) => Boolean(f.draft_turn) || draftFailed}`. 카드도 같은 조건으로 실패 줄을 그려, 목록과 카드 중 한 곳에만 보인다(`deliverable-page.tsx`, `deliverable-draft-card.tsx`)
- 검사: lint 0 · typecheck 통과 · vitest 26개 통과 · build 통과(공개 env 임시 값)
