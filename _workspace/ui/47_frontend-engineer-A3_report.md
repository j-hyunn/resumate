# 47 런 A3 보고 — 자기소개서 관리 화면 본체 (S-13 · S-14 · S-46)

- 날짜: 2026-11-09 · 담당: frontend-engineer (A3) · 작업 디렉터리: worktree `cover-letter-ui-469976`
- 기준 판: PRD v4.17 · 플로우 **v5.20** · AI v4.15 · 데이터 모델 **v4.15** · 디자인 시스템 **v5.15**
  + 기획 PR #68 **CF-S1·CF-S2·CF-S3·P-30** + 브리프 "백엔드 R15 계약 정본"(2026-11-09)
- 범위: decisions 4.23 **UI 1·2·3**. UI 4(폐기 주소)는 A0이, UI 5(S-39)는 A4가 끝냈다 — 손대지 않았다.
- **커밋하지 않았다** (리더가 한다). **real 분기로 바꾸지 않았다** — mock + `?state=`로 완성했다.

---

## 1. S-13 자기소개서 목록 재작성 (UI 1)

`/applications` — `src/app/(dashboard)/(gated)/applications/page.tsx`(재작성) ·
`src/components/applications/application-list.tsx`(재작성) · `add-application-launcher.tsx`(신설)

| 자리 | 구현 |
|---|---|
| 머리 | `PageHeader` 제목 "자기소개서 관리" + 주 버튼 **[자기소개서 작성]**(→ `?new=1`, 모달) |
| 정렬 표기 | 머리 아래 한 줄 **"최근 작성 순"** — `ApplicationSortNote`, `Select`가 아니라 바꿀 수 없는 글자 |
| 행 (넓은 화면) | `Table` 4열 **이름 / 포지션 / 만든 날 / 마감** + 행 메뉴 열. 이름 = `application_projects.name` **그대로**, 포지션 = `job_descriptions.position_title`, 만든 날 = `created_at` KST `yyyy.mm.dd`(`formatDate`), 마감 = 공통 `DDay` **값이 있을 때만** |
| 빈 셀 | 포지션·D-day가 없으면 **셀을 비운다**("—" 안 씀, G-82) |
| 이름 열 | 추출 대기 이름은 `text-muted-foreground`, `name_source = 'ai'`면 옆 `Badge variant="ai"` "AI 추출" |
| 좁은 화면 | 두 줄 카드 — 1행 이름, 2행 "포지션 · 만든 날 · D-day"(빈 조각은 구분점째 뺀다) |
| 행 클릭 | → `routes.coverLetter(id)` (S-46. 정본 행이 없으면 문항 설정 상태) |
| 행 ⋯ | **"자기소개서 삭제"(C-05) 한 항목뿐**. 클릭 전파를 막는다 |
| 빈 상태 | ST-EMPTY(`Briefcase`) + 명세 문구 + 주 버튼 하나 |
| 정렬 | `listCoverLetters()`가 `created_at desc` |

**뺀 것(되살리지 않음)**: 전형 단계 칩·전형 결과 배지·단계 이동(C-12)·기능 진행 칸(인사이트·서류 수·면접 수)·
정렬 `Select`·전형 단계 거르기·"보드로 보기". `StageCardMenu`·`useStageMove`·`AiFeatureStatus`·`JobInline`을
S-13에서 더 쓰지 않는다. 이름 모양이 섞여 보이는 것(옛 "회사명 – 포지션명" ↔ 새 "{기업 명} 자기소개서")은
**정상**으로 두었다 — 화면이 이름을 다시 만들지 않는다.

---

## 2. S-14 → 2단계 모달 (UI 2)

`src/components/applications/add-application-dialog.tsx`(신설, `AddApplicationDialog`) +
`add-application-launcher.tsx`(주 버튼 ↔ `?new=1` 주소 상태). **`application-new-form.tsx`는 삭제**했다.

- `Dialog sm:max-w-2xl max-h-[85dvh]`, 좁은 화면은 전체 화면(`max-sm:h-dvh max-sm:max-w-none max-sm:rounded-none`).
  머리 "자기소개서 작성" + **2단 `StepIndicator`**(지난 단계는 눌러서 돌아갈 수 있다 = [이전]).
- **①**: 공고 URL(`Input type="url"`, 형식 오류 "공고 주소를 확인해 주세요" + [다음] 비활성) · "또는" 구분 ·
  직접 입력 `Textarea min-h-56`. **둘 중 하나**(한쪽에 쓰면 다른 쪽 `disabled` + "URL과 직접 입력은 하나만 쓸 수 있어요").
  길이 경고 200자 미만 / 24,000자 초과(막지 않음). 키가 있으면 [다음] 옆 **C-19**, 없으면 **C-18 인라인**(막지 않음).
- **[다음]**: 버튼 안 글자가 "공고를 가져오는 중" → "공고 내용을 정리하는 중"으로 바뀐다(C-03 막대 없음).
  URL이면 `fetchJobPostingAction` → 본문이 있고 키가 있으면 `extractJdPreviewAction`(행 없는 AI-01).
- **Q53-1 게이트는 ①의 [다음]에서** 판정한다: `consent_required` → C-21(`useAiConsentGate`, 동의 뒤 그 [다음]을
  이어서 보낸다) / `key_status = 'invalid'` → 요청을 보내지 않고 버튼 아래 **C-20 `key_invalid`** / `needs_check`는 막지 않는다.
  서버가 경로 ⑥로 거부해도 같은 길로 처리하고 입력을 그대로 둔다. **"AI 없이 계속" 버튼은 만들지 않았다(CF-U1).**
- **②**: 지원 기업·지원 포지션(각 200자, `grid sm:grid-cols-2`, **출처 배지 없음** — CF-A6) · 공고 내용
  `Textarea min-h-72`(필수) · 미리 정리 표시("공고에서 요건 {n}개를 미리 정리해 두었어요", 고치면
  "공고 내용을 고쳐서 요건은 만든 뒤 다시 정리해요") · 가져오기 실패 `Alert variant="warning"` + `CloudAlert` +
  **CF-10 확정 문구 하나**(실패 6종을 나누지 않는다) · 원문 고정 안내 · AI-01 실패는 ② 머리 C-20 축약.
  **마감일 칸은 없다(CF-2).**
- 채움 순서 **AI-01 추출값 → `JobPosting` 값 → 빈 칸**(CF-A6)을 `goNext()`가 그대로 구현한다.
- **[자기소개서 작성]**: `createApplicationAction`에 `source_url`·`preview_job_id`(+ mock용 `preview_deadline`)를
  함께 보낸다. `invalid_source_url`(400)이면 ② 맨 위 거부 한 줄 + **"주소 없이 만들기"**(주소만 빼고 다시 보냄, 입력 유지).
  생성 실패는 "만들지 못했어요. 다시 시도해 주세요"(입력 유지).
- **보드에서 왔을 때**(`from=board`): ② 주 버튼 라벨 **"추가하기"**, 생성 뒤 보드에 남고 "열기" 토스트
  (`setNavOrigin("board", id)` → S-46 이동 줄 첫 마디가 "지원 현황"). A4가 걸어 둔
  `routes.applicationNew({ from: "board" })` = `/applications?new=1&from=board`가 그대로 맞는다 — **보드 파일은 건드리지 않았다.**
- **닫기 확인**: 입력이 하나라도 있으면 `AlertDialog` "입력한 내용과 정리한 결과가 사라져요" ·
  `닫기`(`destructive-ghost`) / `계속 작성`(default). 아무것도 입력하지 않았으면 확인 없이 닫는다.
- **입력 보존**: `form-draft.ts`의 `keepsFormDraftOnLeave()` 규칙 그대로 — **C-21·키 교체 왕복만** 세션에 남기고
  그 밖의 길은 버린다. 주소에는 `?new=1`·`from`만 있고 입력 내용은 넣지 않는다.

**재사용한 자리**: `form-draft.ts`(이탈 보존 규칙·테스트) · `jd-raw-text.ts`(길이 경고 상수·문구) ·
`useAiConsentGate` · `AiErrorNotice` · `AiLock` · `ProviderBadge` · `CharCount` · `usePreviewWriteGuard` ·
`setNavOrigin`. **재작성한 자리**: 폼 틀 전체(전체 페이지 → 2단계 모달), 게이트 판정 위치(만들기 → ①의 [다음]),
이름 입력·마감일 칸 제거, 회사명·포지션명 접기 제거.

---

## 3. S-46 자기소개서 작성 (UI 3)

`src/app/(dashboard)/(gated)/applications/[id]/cover-letter/page.tsx`(신설) +
`src/components/applications/cover-letter/` (신설 8파일)

| 파일 | 몫 |
|---|---|
| `cover-letter-screen.tsx` | L-02 셸 · 이동 줄 · 머리 · **두 상태 판정** · 저장 경로 · 이탈 확인 · 탭 3개 · 패널 자리 |
| `question-setup.tsx` | **문항 설정 상태**(옛 S-18) + [자기소개서 작성 시작] + 요건 선행 추출 |
| `answer-tab.tsx` | **작성 상태 "자소서" 탭** — 문항 블록·제목·내용·글자 수·⋯ 메뉴·문항 편집·복사·빈 상태 |
| `question-fields.tsx` | 문항 칸 묶음(문항 문장·글자 수 제한·기준·메모) — 두 상태가 같은 모양을 쓴다 |
| `question-form.ts`(+`.test.ts`) | 폼 모델·검증·셈·복사 글 (순수, 9건 단위 테스트) |
| `delete-question-dialog.tsx` | 문항 삭제 확인(C-05 계열) |
| `sources-used.tsx` | **C-11** 재작성(CF-S2) |
| `jd-tab.tsx` · `insight-tab.tsx` | S-15 · S-16 규칙을 탭 안으로 |
| `panel-pending.tsx` | **Resumate AI 패널 자리 — 연결 대기**(아래 7절) |

### 3.1 머리 (두 상태 공통)

- 제목 `DocTitleInput`(자리 표시 "자기소개서 이름", 100자, 초과는 A-10 오류) + 오른쪽 `⋯` **"자기소개서 삭제"**
  하나(C-05, `unsavedChanges`를 넘겨 "저장하지 않은 수정도 함께 사라져요" 한 줄을 켠다). **단계 칩 없음(CF-3).**
- `InlineFields`: **작성 상태만** ① 지원 직무(읽기 전용, 비면 "포지션 없음") ② **JD 상세** —
  `source_url`이 있으면 `target="_blank" rel="noopener noreferrer"` + `ArrowUpRight` + `sr-only "새 창에서 열림"`,
  없으면 **"채용 공고" 탭으로 옮긴다**(CF-A16). ③ **마감일** = `Input type="date" w-[11rem]`(**일 단위**, CF-4) +
  값이 있을 때만 `X` "마감일 비우기".
- 요약 한 줄(작성 상태): "문항 {n}개 · 답변 {m}개 · 마지막 수정 {상대 시각}".
- 이동 줄 "← 자기소개서 관리 › {이름}"(보드에서 왔으면 첫 마디 "지원 현황", "←"도 S-39). 셋째 마디 없음(CF-A11).

### 3.2 두 상태 판정 · 저장 경로 (CF-A11 · **CF-S3**)

- 판정은 **정본 행 유무 하나**다: 서버 페이지가 `getCoverLetterDocument(id)`를 읽고 `null`이면 문항 설정 상태.
  R15가 "행 유무가 맞다"고 확인해 준 그대로이고, 대화 시작·턴·요건 추출은 행을 만들지 않는다.
- **문항 설정 상태의 저장 경로는 [자기소개서 작성 시작] 하나다**:
  `useRequirementsFirst(...).run(onStart)` → (키 있음 + 요건 없음이면) **AI-01 요건 추출** →
  **성공 뒤** `saveCoverLetterDocumentAction`(정본 행 생성) → `setDoc(...)` + `setTab("cover_letter")`로 작성 상태.
  순서를 **추출 → 저장**으로 두었다(v5.20 정정, DM-3). 추출 실패는 넘어가지 않고 같은 자리에 C-20
  (입력 원인이면 "공고 원문 고치기" → 채용 공고 탭 수정 상태), 저장 실패는 ST-SAVE-FAILED(입력 유지, 상태 그대로).
- **CF-S3 구현**: 문항 설정 상태에서 `SaveButton`에 넘기는 상태를 **늘 `idle`**로 고정했다
  (`const saveUi = state === "questions" ? "idle" : uiState`). `SaveButton`은 `idle`에서 `disabled`이고
  **⌘S·Ctrl+S 핸들러도 `enabled`일 때만 동작**하므로 이 상태에서는 아무 일도 하지 않는다. 표식 점도 안 뜬다.
  `onSave`도 `state === "writing"`일 때만 `runSave()`를 부른다 — **정본 행을 만드는 길이 하나뿐이다.**
- **이탈 확인**: 문항 설정 상태에는 "저장하고 나가기"를 둘 수 없으므로(저장 경로가 하나다) 셸의 기본
  `LeaveGuardDialog`를 띄우지 않고(`{...guard, pending: null}`을 `PageShell`에 넘긴다) 같은 컨트롤러로
  **`나가기`(`muted-ghost`) / `계속 작성`(default)** 2버튼 확인을 화면이 직접 그린다. 손대지 않은 기본 3문항만
  있으면 `isUntouchedSeed()`로 "변경 없음"이라 확인을 띄우지 않는다.
- **작성 상태 저장** = `save_application_document` **한 번**(본문 + 머리 제목·마감일). `application_values`는
  **바뀐 키만** 보내고, 반환 **9키**로 머리를 다시 그린다(다시 읽지 않는다). 거부 처리:
  `stale_write` → 변경 충돌 확인("내 내용으로 저장" / "새로 불러오기") · `too_many_questions` → 머리 아래
  "문항은 5개까지 추가할 수 있어요" · `invalid_fields` → "글자 수 제한을 확인해 주세요" · `not_found` → 토스트.
- **입력 보존**(1.3a): 키 `resumate:l02:cover_letter:{apId}`(명세의 "지원 프로젝트 ID + `cover_letter`").
  머리 제목·마감일도 보존 대상이고, 복사본을 쓴 뒤 다른 곳에서 저장됐으면 버린다(U40-2).

### 3.3 문항 설정 상태

안내 1줄(`Alert variant="info"`) → 문항 목록(`ol.space-y-3`, 문항마다 `rounded-lg border p-4`) →
**[+ 문항 추가 {n}/5]**(`outline` 점선 전체 폭, 5개면 비활성 + "문항은 5개까지 추가할 수 있어요") →
바닥 **[자기소개서 작성 시작]** `size="lg"` + C-19.

- 기본 3문항은 `template_key` `motivation`/`job_competency`/`future_plan`, 문구는 OD-D1 K-28 그대로.
- **글자 수 제한 기본값 800**(CF-U2 — 시안의 600을 쓰지 않는다). 기본 3문항과 "+ 문항 추가"로 만든 문항 모두.
- 기준 `Select size="sm"`(공백 포함 / 제외, 기본 공백 포함) · **메모는 접어 둔다**("메모 추가"로 펼침, CF-A10,
  포부 문항은 힌트 "배운 점이 있으면 AI가 참고해요") · A12 안내는 글자 수 칸 아래 줄.
- 검증(UX S-46): 빈 문항 "문항을 입력해 주세요" / 1,000자 초과 / 빈 글자 수 "글자 수를 입력해 주세요" /
  1~10,000 밖 "1~10,000자 사이로 입력해 주세요". 저장을 막고 **첫 오류 칸에 포커스**(L-02 규칙).
- 문항 삭제: 제목·답변이 없으면 확인 없이, 하나라도 있으면 확인 다이얼로그(본문에 "제목" 포함, CF-6). 최소 1개.
- 이 상태는 **왼쪽 탭도 AI 패널도 그리지 않고 C-18·C-19도 없다**(CL-8) — 예외가 [자기소개서 작성 시작] 옆 C-19뿐이다.
  본문은 한 열 `max-w-prose-edit`.

### 3.4 작성 상태 — "자소서" 탭

안내 1줄 + G-2 → "전체 복사" → (답변이 하나도 없으면) 빈 상태 상자 → 문항 목록(`ol.space-y-8`) → "+ 문항 추가 {n}/5".

- 문항 머리: "문항 {n}" + 문항 문장(읽기 전용) + "AI 제안 있음" 자리 + 접기 + **⋯ 메뉴 5항목**
  (문항 편집 · 이 문항 복사 · 구분선 · 위로 이동 / 아래로 이동 · 구분선 · 문항 삭제). **드래그는 두지 않았다** —
  순서 변경은 메뉴로만(키보드와 같은 길).
- **제목** = 테두리 없는 문서형 입력(`answer_title`, 100자, 자리 표시 "답변 제목"). **글자 수 제한에 미포함**(CF-6).
- **내용** = `DocTextarea grow`(칸 안에서 스크롤하지 않고 내용만큼 자란다, 탭 내용 영역이 스크롤).
- **글자 수 표시**: "현재 {n}자 / 제한 {limit}자({기준})" — **내용만 센다**. 제한 초과면 경고색 + `TriangleAlert`,
  아래 줄에 110% 이내면 명세 문구("AI 보정 범위(최대 10% 초과) 안이라 그대로 두었어요…"), 넘으면 수만 알린다 `[UI-가정]`.
- **문항 편집** = 그 블록을 **제자리 편집 모드**로 바꾼다(모달 아님): 문항 문장·글자 수 제한·기준·메모가 문항
  설정 상태와 같은 모양으로 열리고 `[확인]`(`secondary sm`)으로 닫는다. 값은 폼에만 남고 저장은 상단 바 "저장하기".
  **P-30 그대로 — 머리 ⋯에 "문항 설정" 항목을 두지 않았다.** "+ 문항 추가 {n}/5"도 작성 상태에 있다.
- **빈 상태**: 문항 3개 이하 "…대화하면 **바로 초안을** 제안해 드려요" / 4~5개 "…**먼저 1~3번 문항부터**…"(R-CF-8).
  키 있음이면 [AI와 초안 쓰기], 없으면 C-18 인라인.
- **복사**: 머리 "전체 복사"(문항 + 제목 + 답변 순서대로, 문항 사이 `---`) · ⋯의 "이 문항 복사". 키 없이 된다.
  자리 표시가 남아 있으면 토스트에 C-08 경고 한 줄을 붙인다 `[UI-가정]`. 성공 때 `markCoverLetterCopiedAction`
  (`first_copied_at`)을 부른다.
- **근거 구간 강조**: `?slot=&range=`로 오면 그 문항의 `DocTextarea`에 `highlightRange`를 걸고, 본문을 고치면 지운다.
- 메모는 접힘("메모" 버튼으로 펼침, CF-A10).

### 3.5 탭 3개 (CF-7 · CF-A12)

- `Tabs orientation="vertical"` + `TabsList variant="pill"` 세로 목록(`w-40` + `border-r`), 좁은 화면(<lg)은
  **가운데 위 가로 탭**으로 바뀐다. 탭 이름 **"자소서" / "채용 공고" / "인사이트"**(CF-U3).
- **탭 전환은 클라이언트 상태이고 주소는 `history.replaceState`로만 맞춘다.** 주소 이동으로 바꾸면 서버가
  다시 렌더되어 저장하지 않은 제목·본문이 사라지기 때문이다 — 그래서 서버 페이지가 **세 탭의 데이터를 한 번에**
  읽어 `jdTab`·`insightTab`을 RSC prop으로 넘기고, 세 `TabsContent`를 `forceMount` + `hidden`으로 함께 띄워 둔다.
  탭을 옮겨도 폼·패널 열림/너비가 유지된다. **탭 머리에 변경 표식을 두지 않았다**(CF-A12).
- **"채용 공고" 탭**(`jd-tab.tsx`) = **S-15 규칙 그대로**. A0이 남긴 `jd-view.tsx`·`jd-raw-edit.tsx`를
  탭 안으로 옮겨 썼고, 폐기된 `/applications/{id}/jd` 페이지의 판정(요건 없음/추출 중/실패/Q53-2 수정 가능 조건/
  Q53-11 요건 0개/Q53-9 요건이 있는 공고/원인 불명 실패)을 그대로 가져왔다. 바꾼 것 셋:
  ① 화면 머리·이동 경로를 그리지 않는다(S-46 머리가 하나뿐) ② 공고 원문 패널 머리에 **"원래 공고 열기"**
  (`source_url`, 새 창 — `JdView`에 `sourceUrl` prop을 더했다, CF-A16) ③ **"돌아가기"가 {인사이트 / 자소서}
  탭으로** 간다(`?from=insight|cover_letter`). 공고 원문 수정의 "저장"/"취소"는 **탭 안 버튼**이고 상단 바
  "저장하기"와 섞지 않는다. **S-20 돌아가기는 없다(R-CF-13).**
- **"인사이트" 탭**(`insight-tab.tsx`) = **S-16 규칙 그대로**. `insight-view.tsx`·`insight-parse.ts`를 그대로 쓰고
  폐기된 페이지의 데이터 조립(요건 표·근거·부분 결과·`projectNames`·readiness 게이트·`lateFailure`·미리 보기)을 옮겼다.
- AI 패널은 탭과 관계없이 오른쪽에 그대로 있다.

---

## 4. CF-S1 · CF-S2 준수 방식

- **CF-S1**: 저장 입력(`SaveCoverLetterInput`)에 근거가 없다. `toCoverLetterBody()`가 만드는
  `p_body.questions[]`에 **`sources` 키가 없고**(단위 테스트가 단정한다), 화면은
  `applied_proposals: [{writing_chat_id, slot, rev}]`만 보낸다 — 서버가 그 제안의 `draft.sources[]`로
  `evidence_links`를 만든다. 패널이 아직 없어 지금은 빈 배열이고, 패널이 붙으면 반영한 제안만 여기로 간다.
  **적용 제안이 없는 문항(손편집만)은 기존 근거 행이 유지**되므로 C-11이 갑자기 비지 않는다 — 그 전제로 그렸고
  "저장 전" 표시도 두지 않았다.
- **CF-S2**: `sources-used.tsx`의 행은 **경로 한 줄뿐**이다 — `sourcePathLine()`이 `EvidenceView.path`에서 연도를
  떼고 앞 두 마디("회사명 또는 교육 표시 이름 › 프로젝트명")만 쓴다. **역할·출처 배지도 `rationale` 줄도 없다.**
  순서는 `{slot}.sources.{n}`의 **n 순서 그대로**(주 근거 먼저) — `sourcesOf()`가 숫자 꼬리로만 정렬하고 화면이
  다시 정렬하지 않는다. 행 전체가 C-02를 여는 버튼이고, 0개면 트리거를 그리지 않는다. 고르는 장치(체크 트리·
  "변경 사항으로 다시 생성"·프로젝트 8개 상한)는 되살리지 않았다. C-02 패널은 이 컴포넌트가 직접 들고 있어
  화면에 `EvidenceProvider`가 없어도 된다(공용 파일을 고치지 않으려고).

---

## 5. 데이터 계층 — R15 계약 정본에 맞춘 것

**real 분기는 새로 만들지 않았다**(연결 대기 그대로). mock 모양만 R15에 맞췄다.

| 자리 | 맞춘 내용 |
|---|---|
| `cover-letters.ts` `fetchJobPosting` | 실패 **6종**(`invalid_source_url`·`fetch_blocked`·`fetch_timeout`·`fetch_too_large`·`fetch_too_short`·`fetch_failed`)을 주소 글자로 고르게 하고, 화면은 **한 문구**(`JD_FETCH_FAILED_MESSAGE`)로 받는다. `companyName`·`positionTitle`은 null 허용 |
| `cover-letters.ts` `extractJdPreview` | Q53-1 게이트 409 유지. `previewJobId`를 만들 때 **그 원문을 기억**한다(`rememberJdPreview`) |
| **신설** `jd-preview-store.ts` | 서버가 하는 **원문 sha256 재계산 대조**를 흉내 낸 mock 저장소 + `PreviewSkipReason` 3값. `cover-letters.ts`(쓰기)·`applications.ts`(읽기)의 순환 import를 피해 별도 모듈 |
| `applications.ts` `createApplicationProject` | 반환을 `CreateApplicationResult`(= `ApplicationProject` + optional `preview_applied`·`preview_skip_reason`)로 넓혔다 — real 분기는 아직 이 키를 안 주므로 optional이다. 미리 보기가 적용되면 **`deadline`이 비어 있을 때만** 채운다(CF-2·CF-A5) |
| `createApplicationAction` | `source_url`·`preview_job_id`(+ mock용 `preview_deadline`)를 받고 `{id, preview_applied, preview_skip_reason}`을 돌려준다. 모달은 미리 보기가 버려지면 **조용히 삼키지 않고** 토스트로 알린다 `[UI-가정]` |
| `cover-letters.ts` `saveCoverLetterDocument` | `too_many_questions` = **400 + `details {limit: 5, current: 저장돼 있던 문항 수}`**, 5 초과이고 **저장 수보다 많을 때만** 거부. `char_limit` **필수** → `invalid_fields`, 경로 `questions.q_n.char_limit`. 반환 **9키** 그대로. `client_id`에 `@deprecated`(무시된다) |
| **신설** `cover-letter-copy.ts` | 순수 헬퍼·문구·뷰 타입을 **`server-only`가 아닌 파일로 옮겼다**(아래 6절) |
| `deletion.ts` | 삭제 영향 미리보기가 옛 `drafts` 대신 **`application_documents`**를 센다(0 또는 1). 자소서 정본 근거(`owner_type = "application_document"`)도 영향 집계에 넣고, 삭제 때 `db.application_documents` 행도 지운다 |
| `evidence.ts` `user_note` | `source_id`가 정본 `body.questions[].question_id`라 조인이 안 되는 자리 — **화면 쪽에서 문항 번호를 조립**해 라벨 "문항 {n} 메모" · 경로 ["자소서", "문항 {n}"]을 만든다(백엔드가 못 하는 자리라고 알려 온 그대로). 폐기된 `draft_sections`는 더 보지 않는다 |
| `fixtures.ts` | `application_document` 근거 6행 추가(`q_n.sources.n` / `q_n.blocks.b1`) — C-11이 그려지고, 손편집만 한 `q_3`는 근거 행이 없다 |

**삭제한 죽은 코드**: `application-new-form.tsx`(2단계 모달이 대체) · `cover-letter-questions.tsx`(폐기된
`draft_sections` 행 단위 자동 저장 — 쓰는 화면이 없어졌다) · `_lib/actions.ts`의 `saveQuestionAction`·
`addQuestionAction`·`deleteQuestionAction`. **`retryJdExtraction`·`runJdExtraction`은 보존**했다(JD 요건 추출, S-15·D-30).

---

## 6. 리더가 넘긴 두 건

1. **보드에서 S-14 모달을 띄우는 경로** — A4가 걸어 둔 `/applications?new=1&from=board`가 그대로 맞는다.
   모달 쪽에서 `from`을 읽어 ② 라벨 "추가하기" · 생성 뒤 보드 복귀 + "열기" 토스트 · 세션 입력 보존 키 분리
   (`…add-application.board` / `.list`)를 처리했다. **보드 파일은 건드리지 않았다.**
   남은 선택: 보드가 화면 이동 없이 보드 위에서 바로 띄우고 싶으면 `<AddApplicationDialog fromBoard />`를
   직접 쓰면 된다(컴포넌트가 그 모양으로 열리게 돼 있다) — **A4 후속으로 정리 가능**.
2. **`server-only` 순수 헬퍼 이동** — **신설 `src/lib/data/cover-letter-copy.ts`**(server-only 아님)로 옮겼다:
   `coverLetterProgressLabel` · `filledSlotCount` · `countAnswerChars` · `coverLetterScreenState` ·
   `seedCoverLetterQuestions` · `newCoverLetterQuestion` + 뷰 타입(`CoverLetterListRow`·`CoverLetterSlotCounts`) +
   문구 상수. `cover-letters.ts`는 `export * from "./cover-letter-copy"`로 **기존 import 경로를 그대로 유지**하므로
   보드의 import는 손대지 않아도 동작한다. 데이터 접근 함수는 `server-only`에 그대로 남겼다.
   → **보드 쪽 import를 새 경로로 바꾸는 정리는 A4 후속으로 가능**(지금 우회도 그대로 동작한다).

---

## 7. 백엔드 요청 / 파운데이션 요청

### 백엔드 요청 (연결 대기)

1. **S-46 Resumate AI 패널을 만들 수 없었다 — 가장 큰 미완이다.** 막힌 자리가 UI가 아니라 계약·데이터 계층이다:
   - `useAiPanel`의 `AiPanelTarget`이 `"project" | "deliverable"` 두 값뿐이다(자소서 대화는 세 번째 대상).
   - **`src/lib/contracts/writing-chat.ts`**(백엔드 소유, 내 쓰기 금지)에 자소서 대화의 DTO·SSE·
     `structured_draft`(`document.questions[]`)·대화 시작 RPC `start_document_writing_chat(
     p_application_project_id, p_document_kind, p_form_snapshot)`가 없다.
   - 자소서 대화의 **mock 계층도 없다**(A0 산출물에 `writing_chats where application_project_id + document_kind`와
     초안 턴 시뮬레이션이 없다).
   → `panel-pending.tsx`를 `// 연결 대기`로 두었다. 왼쪽 본문 입력·문항 편집·저장하기·복사는 패널 없이 그대로
   동작해(CL-8) 화면이 막다른 길이 되지 않는다. **R15 머지 뒤 별도 작업으로 패널 + 3.26 `QuestionProposalCard`를
   만들어야 한다.** 그때 쓸 제약을 리더가 알려 준 대로 적어 둔다:
   - SSE **새 이벤트 이름은 없다** — 기존 `sources_selected`·`draft_started`·`draft_block`·`adjusting_length`·
     `draft_done`에 `slot`·`questionNo`가 붙었을 뿐이다.
   - **`sources_selected`의 `sources[]`는 camelCase**(`sortOrder`·`experienceId`·`projectId`·`reuseReason`),
     **`draft_block.block`만 snake_case**다. 둘을 같은 규칙으로 파싱하면 깨진다.
   - 초안 상한은 **"초안 턴" 6회**(문항당이 아니다) — "남은 횟수 = 6 − `draft_count`"가 그대로 성립하고,
     5문항은 한 바퀴에 2회를 써서 세 바퀴가 가능하다. 칩·안내 문구를 턴 기준으로 쓸 것.
2. `get_deletion_impact('application_project')` 반환 키가 `cascade.documents`로 바뀌었는데 이 워크트리의
   `src/lib/contracts/career.ts`는 아직 `drafts`·`draft_sections`를 필수로 본다(R15 미머지). **real 분기
   (`deletion.ts` `getApplicationDeletionImpact`)는 `r.cascade.drafts`를 그대로 두었다** — 머지 때 한 줄 바꾸면 된다.
3. `job_descriptions.source_url` · `application_documents` 생성 타입이 아직 없어 `src/types/db.ts`의 손으로 적은
   타입을 쓰고 있다(A0 요청 ①②와 같다).
4. `markCoverLetterCopied`(`first_copied_at`) · `getCoverLetterDocument` · `saveCoverLetterDocument` ·
   `fetchJobPosting` · `extractJdPreview` · `listCoverLetterSlotCounts`는 real 분기가 `wiring_pending`(503)이다.
5. 폐기 잔재(머지 때 함께 걷을 것): `src/lib/data/drafts.ts`의 AI-03·AI-11 자리 · `drafts-real.ts` ·
   픽스처 `drafts`/`draft_sections`/`draft_section_sources` · `src/app/api/application-projects/[id]/
   career-descriptions/route.ts` · `.../draft-source-ranking/route.ts`. **`retryJdExtraction`·`runJdExtraction`은 보존.**

### 파운데이션 요청 (A0 / 리더)

1. **`SaveButton` 비활성 툴팁**: design-system 5.12가 문항 설정 상태의 비활성 툴팁을
   "문항을 정한 뒤 '자기소개서 작성 시작'을 누르면 저장돼요"로 바꾸라고 적었는데, 툴팁 글자가
   `page-shell.tsx`에 고정돼 있다(공용 파일이라 고치지 않았다). `SaveButton`에 `disabledHint?: string` prop을 더해 주면 맞춘다.
2. **`LeaveGuardDialog`에 "저장하고 나가기"를 숨기는 옵션**: 지금은 `PageShell`에 `{...guard, pending: null}`을
   넘겨 셸의 다이얼로그를 끄고 화면이 2버튼 확인을 **다시 그렸다**. `LeaveGuardDialog`에 `hideSave`(또는
   `actions`)를 더해 주면 중복이 사라진다.
3. **`preservationKey(kind, …)`가 `"project" | "deliverable"`만 받는다** — S-46은 키 문자열
   (`resumate:l02:cover_letter:{apId}`)을 직접 만들었다. `"cover_letter"`를 더해 주면 공용 헬퍼를 쓴다.
4. **`evidence.tsx`의 패널 열기 훅이 비공개다**(`useEvidencePanel`). C-11이 자기 `EvidencePanel`을 들고 있는데,
   `useEvidencePanelOpen()`을 내보내 주면 화면당 패널 하나로 합칠 수 있다.

---

## 8. 쓴 `?state=` 키

A0이 `/dev/states?state=cover-letter`에 적어 둔 키를 기준으로 맞췄다.

- **S-13** `/applications`: `empty` · `loading` · `error` · `unauth` · `not-found`
- **S-14** 모달(`?new=1&state=`): `step1`(기본) · `fetching` · `fetch-failed` · `extracting` · `extract-failed` ·
  `step2` · `close-confirm` · `creating` · `create-failed` · `invalid-source-url`
  (+ 공통 `consent-required` · `key-invalid` · `key-missing` — 연결 컨텍스트가 처리한다)
- **S-46 문항 설정 상태**: `questions` · `questions-invalid`(문항 1개·글자 수 1개를 비워 검증 오류) ·
  `questions-max`(5문항, 추가 비활성) · `extracting` · `extract-failed` · `extract-failed-input` · `extract-failed-wait`
- **S-46 작성 상태**: (기본 = 픽스처 ap 1·2) · `empty-answers` · `save-failed` · `save-conflict` ·
  `too-many-questions` · `not-found` · `unauth` · `loading` · `error`
- **S-46 탭**: `?tab=jd` / `?tab=insight` + S-15·S-16의 기존 키 전부(`raw-editable` · `raw-edit` ·
  `raw-save-failed` · `raw-save-refused` · `raw-saved` · `raw-unknown-cause` · `raw-has-requirements` ·
  `raw-edited` · `ai-*` · `insufficient*` · `retry-*` · `wait-jd` …) + `?edit=1&from=&cause=` 진입
- **아직 못 쓰는 키**(패널 연결 대기): `draft-stream` · `draft-failed` · `draft-limit`.
  `ai-locked`는 패널 자리에 C-18로 그려진다.

---

## 9. `[UI-가정]` 목록 (순수 화면 세부)

| # | 가정 | 자리 |
|---|---|---|
| 1 | S-13 열 머리 글자 "이름 · 포지션 · 만든 날 · 마감", 빈 셀은 비운다, 좁은 화면 두 줄 카드의 구분점 처리 | `application-list.tsx` |
| 2 | 모달 닫기 확인의 설명 줄 "지금 닫으면 붙여넣은 공고와 미리 정리한 요건이 남지 않아요" | `add-application-dialog.tsx` |
| 3 | `invalid_source_url`은 AI 실패가 아니라 입력 거부라 C-20을 쓰지 않고 `text-destructive` 한 줄 + "주소 없이 만들기" | 같음 |
| 4 | 미리 보기가 버려졌을 때(`preview_skip_reason`) 토스트 "공고 내용이 달라져 미리 정리한 요건은 쓰지 않았어요. 만든 뒤 '채용 공고' 탭에서 다시 정리해요" | 같음 |
| 5 | 모달 복원 안내 "작성하던 내용을 불러왔어요", [다음] 진행 버튼 `min-w-[12rem]` | 같음 |
| 6 | 모달 ①·②의 mock 실패 재현 — 주소에 `blocked`·`timeout`·`toolarge`·`tooshort`·`fail`이 들어가면 그 코드로 실패 | `cover-letters.ts` |
| 7 | 문항 설정 상태 이탈 확인의 설명 줄 "지금 나가면 정한 문항이 남지 않아요. 저장은 '자기소개서 작성 시작'을 눌러야 돼요" | `cover-letter-screen.tsx` |
| 8 | 정본 행을 만든 뒤 토스트 "자기소개서를 만들었어요" | 같음 |
| 9 | 머리 `InlineField` 라벨 — "JD 상세" 링크의 묶음 라벨을 "공고"로 두었다(명세에 라벨 글자가 없다) | 같음 |
| 10 | 탭 전환을 `replaceState`로만 맞춘다(주소 이동이면 폼을 잃는다) · 세 탭을 `forceMount`로 함께 띄운다 | 같음 |
| 11 | C-11 행의 경로 두 마디는 `EvidenceView.path`에서 연도를 떼고 앞 두 마디를 쓴다 | `sources-used.tsx` |
| 12 | 글자 수 110% 초과 안내는 "제한보다 {n}자 많아요"만 | `answer-tab.tsx` |
| 13 | 복사 뒤 자리 표시 경고 토스트 문구, 복사 실패 토스트 "복사하지 못했어요. 직접 선택해 복사해 주세요" | 같음 |
| 14 | 문항 내용 자리 표시 "답변을 입력하거나 오른쪽 Resumate AI의 초안을 반영해 주세요" | 같음 |
| 15 | 작성 상태에서 "메모" 버튼으로 메모를 펼친다(편집 모드가 아니어도) | 같음 |
| 16 | 문항 설정 상태의 메모 안내 "강조하고 싶은 점이나 지원 이유를 남기면 AI가 초안에 반영해요" | `question-fields.tsx` |
| 17 | 패널 연결 대기 문구 "자소서 작성 대화는 아직 연결되지 않았어요. 왼쪽에서 직접 쓰고 저장할 수 있어요" | `panel-pending.tsx` |
| 18 | 패널 열림 상태 저장 키 `resumate:l02:cover_letter:panel`, 입력 보존 키 `resumate:l02:cover_letter:{apId}` | `cover-letter-screen.tsx` |
| 19 | `?state=questions-invalid`·`questions-max`·`empty-answers`·`too-many-questions`의 미리 보기 모양 | 같음 |
| 20 | mock `user_note` 근거 라벨 "문항 {n} 메모" · 경로 ["자소서", "문항 {n}"] | `evidence.ts` |

---

## 10. 기획 확인 필요

1. **S-46 머리 "JD 상세" 묶음의 라벨 글자** (UX v5.20 S-46 머리 표 · design-system 5.12 머리)
   - 문제: 머리 한 줄 묶음은 `InlineFields`(`dt` 라벨 + `dd` 값)인데 "JD 상세"는 **링크 자체가 값**이고 라벨 글자가
     명세에 없다. 지금은 `dt`를 **"공고"**로 두었다(`[UI-가정]` 9).
   - 선택지: (a) 라벨 없이 링크만 놓는다(= `InlineFields` 틀을 벗어난다) (b) "공고"(지금) (c) 다른 글자.
   - 화면 영향: 머리 한 줄의 읽히는 순서. 접근성(라벨 없는 `dd`는 `dl` 규칙에 어긋난다).
2. **문항 설정 상태에서 "저장하기"를 눌러 본 사용자에게 무엇을 알리는가** (UX v5.20 S-46 "두 상태" · CF-S3)
   - 문제: CF-S3는 버튼을 **비활성**으로 두라고만 정했다. 비활성 버튼은 눌리지 않으므로 사용자는 **왜** 저장할 수
     없는지 모른다. design-system 5.12는 툴팁 글자를 `[가정]`으로 제안했지만 그 툴팁은 공용
     `SaveButton`에 고정돼 있어(파운데이션 요청 1) 지금은 "저장하기 (⌘S)"가 그대로 보인다.
   - 선택지: (a) 공용 `SaveButton`에 `disabledHint`를 더해 5.12의 문구를 쓴다 (b) 문항 설정 상태 본문에 한 줄
     안내를 둔다 (c) 그대로 둔다(비활성만).
   - 화면 영향: 첫 사용자가 저장 경로를 못 찾을 위험. 공용 컴포넌트를 고치는지 여부.
3. **작성 상태에서 문항을 5개 넘게 만들 수 없는데, 이미 저장된 수가 5개면 "+ 문항 추가"가 영구히 비활성이다**
   (UX v5.20 S-46 "문항 편집" · R15 `too_many_questions` 조건)
   - 문제: R15는 "5 초과이고 **저장 수보다 많을 때만**" 거부한다 — 즉 저장된 6문항은 6으로 다시 저장할 수 있다.
     그런데 화면은 `forms.length >= 5`면 추가를 막으므로, (이관이 없어 생기지 않는다고 보지만) 5를 넘는 정본이
     존재하면 **문항을 지우기 전까지 아무것도 추가할 수 없다**. CF-M1로 6문항 정본이 생기지 않는다는 전제가
     깨지는 경로(예: 백엔드 수동 수정)가 있는지 확인이 필요하다.
   - 선택지: (a) 지금대로(5 고정) (b) `max(5, 저장된 수)`로 막는다.
   - 화면 영향: 추가 버튼의 비활성 조건과 안내 문구 하나.

> **`[UI-가정]`으로 덮지 않은 또 하나**: S-46의 **AI 패널**은 기획 공백이 아니라 **계약·데이터 계층 공백**이라
> 7절 "백엔드 요청 ①"에 올렸다.

---

## 11. 검증

| 명령 | 결과 |
|---|---|
| `pnpm lint` | **통과** (0 errors, 0 warnings) |
| `pnpm typecheck` | **통과** |
| `pnpm test` (내 범위) | `pnpm test src/lib src/components` **45 파일 383건 통과**(9 skip) — 신설 `question-form.test.ts` 9건 포함 |
| `pnpm test` (전체) | **17건 실패 — 전부 내 범위 밖**: `src/server/services/{account,application,insight}.integration.test.ts`. 정본 키가 `cascade.documents`이고 백엔드 워크트리에 이미 반영돼 있어 **R15 머지로 자동 해소된다** — 리더 지시대로 손대지 않았다 |
| `pnpm build` | **통과** (`/applications` · `/applications/[id]/cover-letter` 모두 라우트로 올라왔다) |
| 브라우저 | **대상 화면은 확인하지 못했다.** `(dashboard)/(gated)`는 `ConsentGate`(Google 로그인) 뒤라 `curl`·헤드리스로 들어갈 수 없다 — `/applications`는 `sign-in`으로 떨어진다. 확인한 것: **`/dev/states?state=cover-letter` 렌더 통과**(A0이 넣은 33줄 링크가 모두 그려진다). 로그인 세션이 있는 환경에서 QA의 브라우저 패스가 필요하다 |

### 전체 테스트 실패 원문 (요약)

```
FAIL src/server/services/application/application.integration.test.ts  (10건)
FAIL src/server/services/account/account.integration.test.ts          (4건)
FAIL src/server/services/insight/insight.integration.test.ts          (3건)
  → 원인: 공유 로컬 Supabase가 R15 마이그레이션으로 앞서 있고(이름 규칙 CF-A7, get_deletion_impact 키),
     이 워크트리의 zod 계약은 아직 옛 키(`drafts`·`draft_sections`)를 필수로 본다.
```
