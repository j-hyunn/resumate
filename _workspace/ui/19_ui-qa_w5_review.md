# UI QA — 실제 백엔드 연결 뒤 (W5, 라운드 1)

> 2026-11-02. 기준: `02-user-flows.md`, `04-data-model.md` v4.3b, W2·W3·W4·W5 노트, `17_ui-qa_q53_review.md`.
> 코드를 고치지 않았고 커밋하지 않았다. `screen-status.md`도 건드리지 않았다. `supabase db reset`, `pnpm build`, 실제 공급자 호출은 하지 않았다.

## 요약

**Critical 0 / Major 2 / Minor 6. lint·typecheck 통과.**

**이번에도 브라우저 확인은 없다.** `list_connected_browsers`가 빈 목록을 돌려줬다(Chrome 연결 없음). 그래서 Critical 0은 "클릭해 보니 문제없다"는 뜻이 아니다. 클릭·렌더·애니메이션·포커스는 여전히 아무도 보지 않았다. 12개 화면을 통과로 올릴 근거가 이 리뷰에는 없다.

대신 브라우저 없이 갈 수 있는 데까지 갔다. 실제 매직 링크로 가입하고, 실제 Server Action으로 행을 만들고, HTML을 읽었다. 자동 저장 훅(`useAutosave`, `useRowAutosave`)은 실제 코드를 작은 훅 런타임에 올려 실제 서버와 돌렸다. 아래 "확인 방법"에 이 네 가지를 나눠 적었다.

| ID | 심각도 | 한 줄 |
|----|--------|-------|
| UQ-700 | Major | S-13·S-39의 면접 수가 질문 0개인 그만둔 세션까지 센다. 같은 공고가 S-31에서 8, S-13·S-39에서 9 |
| UQ-701 | Major | 실패한 경력기술서를 다시 열면 C-20도 다시 시도도 없다. 실제 실패 행에는 섹션이 남아 `sections.length === 0` 판정이 틀린다 |

첫 사용 경로의 빈 상태, 희소한 실제 행, 세션 판정표, 링크 전수 검사에서는 크래시나 `undefined`·`null`·`[object Object]`·빈 라벨을 찾지 못했다.

## 확인 방법 구분

### A. 브라우저로 확인: 없음
Chrome 미연결. Playwright 캐시에는 드라이버만 있고 브라우저가 없었다. Arc는 사용자가 쓰는 브라우저라 띄우지 않았고, 브라우저 내려받기도 하지 않았다. 아래 "확인하지 못한 것" 전부가 여기 해당한다.

### B. HTTP·HTML로 확인 (`next start` 3817, 실제 세션 쿠키, 실제 로컬 Supabase)
- **가입 경로**: S-02 `sendMagicLinkAction` → Mailpit의 링크 → `/auth/callback` → `/consent?next=/career` → `recordConsentsAction` → `/career`. 시험 계정 4개를 이 경로로 만들었다.
- **동의 전 게이트**: `/career`가 스트림 안 `NEXT_REDIRECT;replace;/consent?next=%2Fcareer`로 간다.
- **빈 데이터 20개 경로**: S-01~S-03, S-04, S-08, S-09~S-12, S-34, S-36, S-13, S-14, S-37, S-39, S-24, S-25, S-30, S-40~S-42.
- **희소한 실제 행**(실제 Action으로 생성): 회사명만 있는 경력, 빈 회사명, 시작 월 없는 교육, 이름 없는 프로젝트, 제목 없는 상세 내용, 빈 정량 성과, 설명만 있는 성과.
- **링크 전수**: 두 사용자 화면을 `href` 따라 129페이지 순회. 죽은 링크 0, 스트림 404 0, 오류 digest 0.
- **서버 쪽 판단**: S-14 거부, S-15 수정 조건, S-22 다시 채점 거부, L-01 배지, 보드 이동, S-37 삭제.

DB에 직접 넣은 행은 다음과 같다. 실제 AI 실행 결과가 아니다.
- 면접 세션 11종: AI-06·07 저장 형태에 맞춘 `result`. 처음에는 `evaluation_failed` 세션의 `score_status`를 null로 넣었다가, RPC가 `not_scored`를 쓰는 것을 보고 고쳐 다시 봤다.
- JD 추출 상태(실패, 요건 0개 성공, 요건 있음), `jd_requirements`, `ai_jobs`.
- `ai_provider_keys`: 복호화가 안 되는 가짜 값. 공급자에 닿기 전에 실패한다. 이 때문에 추출과 S-19가 `stalled`로 끝난다. 실제 공급자 오류의 문구는 이 경로로 볼 수 없다.

### C. 훅 실행 (DOM 없음, 실제 서버)
저장소 코드를 그대로 트랜스파일해 작은 훅 런타임에서 돌렸다. 저장은 실제 `saveExperienceAction`·`saveProjectAction` HTTP 호출이다. **화면 렌더, 버튼 클릭, `pagehide`·`visibilitychange`, 언마운트 저장은 포함하지 않는다.** 스크립트는 저장소 밖 임시 위치에 있다.

| 시나리오 | 결과 |
|----------|------|
| 디바운스·입력 합치기: 200ms 간격 3타 | 마지막 입력 500ms 뒤 호출 0, 1,100ms 뒤 호출 1. 저장값은 마지막 입력 |
| 첫 저장 응답 유실 → 다시 시도 | `failed` → 같은 `client_id` → `saved`, 행 1개 |
| 수정 중 네트워크 실패 → 다시 시도 | `failed` → `saved`, DB 반영 |
| 두 탭 충돌 | 낡은 탭이 `blocked` + `problem: conflict`, `latest`에 다른 탭 값 |
| "내 입력으로 저장" | `saved`, 문제 해제. 내 값이 다른 탭 값을 덮는다(안내에 달라진 칸이 보이는 설계) |
| "최신 내용으로 바꾸기" | 상태 `idle`, 문제 해제, 쓰기 없음. 그 뒤 입력은 정상 저장 |
| 수정 응답 유실 → 다시 시도 (`already_saved`) | `saved`, 충돌 안내 없음 |
| 자식 저장으로 부모 `updated_at`만 오름 (`rebase`) | `saved`, 충돌 안내 없음. `updated_at`을 SQL로 올려 만들었다. 상세 내용 추가와 스킬 저장만으로는 이번 데이터에서 부모가 오르지 않았다 |
| 기간 역전 + 다른 칸 수정 | `saved`. 기간은 그대로, 다른 칸만 저장 |
| 행 삭제 뒤 저장 | `blocked` + `gone` |
| 재직 중 토글 + 응답 유실 | **거짓 충돌** (UQ-702) |

### D. 개발 모드 (HTTP)
`?state=` 확인을 위해 저장소를 임시 위치에 복사하고 `next dev --webpack`을 3818에서 띄웠다. 저장소 폴더에는 두 번째 개발 서버를 띄우지 않았고, 끝난 뒤 복사본을 지웠다. 포트 3000은 쓰지 않았다(`/sign-in`, `/career?state=empty`가 200인 것만 봤고 `[id]` 경로는 보지 않았다).

| 대상 | 결과 |
|------|------|
| `/dev/states` | 200 |
| 갤러리 링크 15개 | 전부 200, 오류 표식 0 |
| `stopping`, `finalizing`, `generation-canceled`, `multi-detail`, `save-conflict`, `save-failed`, `/career?state=empty`, `/interviews?state=empty`, `/applications?state=empty`, `/board?state=empty`, S-33·S-22 `ai-failed`, S-36 `ai-failed`, S-14 `consent-required` | 200, 지정한 문구가 있는 것은 일치 |
| `setMockControlsAction` 2회, `publishMockReconsentDisclosureAction` | `/dev/states` POST 200, 개발 로그에 실행 기록 |
| 운영 빌드 `/dev/states` | 404 |
| 운영 빌드 익명 `?state=save-conflict` | `/sign-in`으로 이동 |

**미확인**: 갤러리 버튼 클릭과 그 뒤 화면 반응(다음 다시 시도 409 등 컨트롤이 실제로 화면을 바꾸는지), `save-conflict`의 첫 입력 뒤 안내, 모든 미리보기의 하이드레이션 후 화면. 위 표는 SSR 문구와 Action 수락까지다.

### E. 소스 판독만
다크 모드 토큰, 좁은 화면 클래스, 접근성, S-36 강조 경로, S-19 중단 흐름, S-33 재시작 분기, S-18 빈 문항, S-08·S-14·S-37의 키 없음 잠금(클라이언트에서 연결 상태를 읽은 뒤 바뀌므로 SSR에는 버튼으로 나온다).

## 화면별 점검표

✅ 일치 / ⚠️ Minor / ❌ Major / — 해당 없음 / 소스 = 소스 판독만 / 미확인 = 볼 방법 없었음. **어느 칸도 브라우저 확인이 아니다.**

W5 수정 12개 화면:

| 화면 | Q1 행 | Q2 문구 | Q3–4 필드·실제 행 | Q5 이동 | Q6 상태 | Q7 AI | Q8 토큰 | Q9 접근성 | Q10 좁은 화면 |
|------|------|------|------|------|------|------|------|------|------|
| S-08 | ✅ HTML | ✅ | ✅ null 행 | ✅ | ✅ 빈·연도 미정 | — | ✅ 소스 | 소스 | 소스 |
| S-09 | ✅ HTML | ✅ | ✅ | ✅ | ⚠️ UQ-702 | — | ✅ 소스 | ⚠️ UQ-706 | ⚠️ UQ-705 |
| S-34 | ✅ HTML | ✅ | ✅ | ✅ | 훅 공통 | — | ✅ 소스 | ⚠️ UQ-706 | ⚠️ UQ-705 |
| S-10 | ✅ HTML | ✅ | ✅ | ✅ | 훅 실행 | — | ✅ 소스 | ⚠️ UQ-706 | ⚠️ UQ-705 |
| S-35 | ✅ HTML | ✅ | ✅ 제목 없음 | ✅ | 훅 공통 | — | ✅ 소스 | ⚠️ UQ-706 | ⚠️ UQ-705 |
| S-11 | 미확인 (모달은 SSR에 없음) | 소스 | ✅ Action 생성·수정 | ✅ | 훅 공통 | — | ✅ 소스 | ⚠️ UQ-706 | ⚠️ UQ-705 |
| S-36 | ✅ HTML | ✅ | ✅ 빈 초안 | ✅ | 시작·그만두기·이어 하기 Action | 턴 미확인 | ✅ 소스 | 소스 | 소스 |
| S-18 | ✅ HTML | ✅ | ✅ | ✅ | ⚠️ UQ-703 | — | ✅ 소스 | 소스 | 소스 |
| S-19 | ✅ HTML | ⚠️ UQ-707 | ❌ UQ-701 | ✅ | ❌ UQ-701 | 스트림 끝까지 미확인 | ✅ 소스 | 소스 | 소스 |
| S-33 | ✅ HTML | ✅ | ✅ | ✅ | ✅ 중단·실패·그만둠·공고 고침 | 재시작 미확인 | ✅ 소스 | 소스 | 소스 |
| S-22 | ✅ HTML | ✅ | ✅ 메모·인용·삭제된 근거 칩 | ✅ | ✅ 판정표 행별 | 다시 채점 진행 미확인 | ✅ 소스 | 소스 | 소스 |
| S-37 | ✅ HTML | ✅ | ✅ | ✅ | ✅ 빈 2종, 그만둔 묶음 | — | ✅ 소스 | 소스 | 소스 |

그 밖에 경로에 걸린 화면:

| 화면 | 결과 |
|------|------|
| S-01·S-02·S-03 | ✅ HTTP. 가입 3화면, `next` 유지, 키 단계 없음, 고지 문구 일치. 로그인 상태의 처리는 "기획 확인" 1 |
| S-13 | ❌ UQ-700. 그 밖은 HTML 일치 |
| S-14 | ✅ 서버 판정(Q53-1). 키 없음 펼침과 안내는 소스 |
| S-15 | ✅ 실제 행 조건별. `jd_has_results` 안내 화면만 미재현 |
| S-16·S-17 | ✅ HTML. 실제 생성 미확인 |
| S-20·S-31 | ✅ HTML. S-31 면접 수는 정확(UQ-700의 비교 대상) |
| S-39 | ❌ UQ-700. 드래그·C-12·C-13·C-14는 미확인, 서버 이동은 ✅ |
| L-01 | ✅ 배지 Action. 첫 열람 뒤 숫자 감소 확인 |

## 이슈

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-700 | Major | 백엔드 api | S-13, S-39 | 02 S-13 "기능 진행" 비고, S-39 카드 행("질문 0개인 그만둔 세션 제외"), S-31 면접 카드 | `src/server/services/interview/progress.ts:17-22`, 전달 `src/lib/data/applications-real.ts:75`, 표시 `src/components/applications/application-list.tsx:304`, `src/components/board/kanban-board.tsx:499` | 세 화면이 같은 수 | 아래 재현. mock(`lib/data/applications.ts:210`)은 `countsAsInterview`로 뺐는데 실제 경로는 모든 행을 센다 |
| UQ-701 | Major | frontend A3 | S-19 | 02 S-19 실패 처리 (A4) "편집기 본문 대신 C-20 + '생성에 실패했어요. 다시 시도하면 새 초안으로 처음부터 만들어요' + [다시 시도]" | `src/app/(dashboard)/(gated)/applications/[id]/drafts/[draftId]/page.tsx:64`, `:102`, `:106`, `src/components/applications/draft-editor.tsx:125` | 다시 열어도 C-20과 다시 시도 | 아래 재현. 판정이 mock 모양(`sections.length === 0`)에 묶여 있다 |
| UQ-702 | Minor | frontend A2 | S-09 | 02 UX-7, W5 노트 "거짓 충돌" | `src/components/career/experience-form.tsx:59-71`(`toValues`), `src/lib/data/row-save.ts` `decideConflict` | 응답만 잃은 저장은 충돌이 아님 | 종료 월이 있는 경력에서 "재직 중"을 켜고 응답이 유실된 뒤 다시 시도. 폼 값에는 옛 `end_month`가 남아 있고 서버 행은 null이라 `already_saved`가 안 된다. 충돌 안내가 뜨고, `conflictFields`가 양쪽 모두 "재직 중"으로 보여 **달라진 칸이 없는 안내**가 된다. 훅 실행으로 재현 |
| UQ-703 | Minor | frontend A3 | S-18 | 02 S-18 문항 필수, W3-9 | `src/components/applications/cover-letter-questions.tsx:148`, `:257-258`, 전체 생성 판정 `anyEmpty` | 칸이 빈 동안 생성 버튼 비활성 또는 안내 | 칸을 비우면 저장을 건너뛰어 옛 문구가 DB에 남는다. "이 문항만 생성"과 전체 생성 판정은 화면 입력을 보지 않아, 빈 칸을 보면서 누르면 옛 문구로 생성된다. **소스 판독** (Action은 빈 문구를 500으로 거부, 저장값 유지를 HTTP로 확인) |
| UQ-704 | Minor | 백엔드 api | S-08 (동의 전) | F-COM-02 게이트, 로그 위생 | 스택 `src/lib/data/career.ts`, 게이트 `src/server/auth/consent-gate.tsx`. 어느 호출인지는 추적하지 않았다 | 동의 전 요청은 조용히 이동 | 동의 전 `/career` GET 1회에 서버 로그 `⨯ Error [AppError] consent_required` 1건(시험 2회 요청에 2건). 화면 동작은 맞다. 신규 가입자마다 운영 로그에 오류로 남을 수 있다 |
| UQ-705 | Minor | frontend A2 | S-09·S-34·S-10·S-35·S-11 | 02 UX-9, T-8, design-system `button` `sm`(h-8) | `src/components/career/form-parts.tsx:363`, `:366` | 좁은 화면 터치 대상 44px (다른 화면은 `max-md:min-h-11`) | 충돌 안내의 두 버튼이 `size="sm"`만 쓴다. **소스 판독** |
| UQ-706 | Minor | frontend A2 | S-09·S-34·S-10·S-35·S-11 | ui-qa-review Q9, UX-8 | `form-parts.tsx:345-371` | 선택 뒤 포커스가 다음 요소로 | 고르면 안내가 통째로 사라져 포커스가 `body`로 떨어진다(UQ-608과 같은 유형). 결과 알림도 없다. **소스 판독** |
| UQ-707 | Minor | frontend A3 | S-19 | W3-4 "중단 후 최대 12초" | `src/components/common/streaming.tsx:285` | 안내와 실제 대기 일치 | "최대 10초쯤"인데 W3-4는 12초다. 소스 판독, 실측 없음 |

### UQ-700 재현
같은 사용자, 같은 공고. 세션 9개 중 1개가 질문 0개인 그만둔 세션이다(`status=abandoned`, 질문 행 0).

1. `GET /applications/{id}`: "모의 면접 **8**"
2. `GET /applications`: "면접 세션 **9**"
3. `GET /board`: "**9** 면접 9회"


### UQ-701 재현
복호화가 안 되는 키로 실행했다(공급자 호출 없음).

1. `createCareerDescriptionAction` → `prepareCareerDescriptionAction` → 실제 라우트 POST: `generation_started` 뒤 `error`(`stalled`).
2. `finalizeCareerDescriptionAction` → `null`.
3. DB: `drafts.status = failed`, **`draft_sections` 1행 남음** (`heading = 회사명`, `status = failed`, `ai_content` null).
4. `GET` S-19: "경력기술서 / 생성 실패 · 문단을 눌러 고칠 수 있어요. 근거 칩을 누르면 원본을 볼 수 있어요", 회사명 제목 하나, 패널. **C-20 문구도 "다시 시도"도 없다.**

원인: `page.tsx:102-106`의 `storedFailure`가 `sections.length === 0`일 때만 만들어져 `cdFailed` 초기값이 null이다. mock 실패 초안에는 섹션이 없었다. 생성 직후에는 메모리의 `cdFailed`로 C-20이 나오므로 새로고침이나 뒤로 가기에서 드러난다. 이 상태로는 S-19에서 나갈 곳이 S-17뿐이다. S-17의 실패 행 "다시 시도"·"삭제"는 HTML로 확인했다.

고칠 때는 판정을 섹션 수가 아니라 블록 유무로 바꾸거나, 서버가 실패한 빈 섹션을 치우는 쪽 중 하나다. 공급자 실패도 같은 `begin` 뒤에 일어나므로 같을 것으로 보지만 **실행하지 않은 추정이다.**

## 요청 항목별 결과

### 1. 첫 사용 경로 (S-01 → S-02 → S-03 → S-08)
HTTP로 끝까지 통과. 3화면, 키 단계 없음. 빈 상태 문구는 S-08·S-13·S-37·S-39·S-12 모두 명세와 같고 깨진 값이 없다. 키 없는 AI 잠금(S-08 "AI 연결하기")은 클라이언트에서 그려져 HTML에는 버튼으로만 나온다. **소스 판독.**

### 2. 실제 행과 mock의 모양 차이
| 항목 | 결과 |
|------|------|
| `undefined`·`null`·`[object Object]`·`NaN`·`Invalid Date` 검사 | 빈 데이터, 희소한 행, 세션 11종, 링크 순회 129페이지에서 0건 |
| 빈 라벨 | 대체 문구 있음: "회사명 없음", "이름 없는 프로젝트", "제목 없음", "내용 없음", "새 경력" |
| `tech_keywords` | 추출 전 null, 성공 `[]` 모두 정상. "요건 1개 · 기술 키워드 0개" |
| `drafts.title` | 실제 값 "자기소개서 (2026-11-02)". S-17에 "자기소개서 · 자기소개서 (2026-11-02)"로 보인다. W3-8에 올라가 있는 건이라 새 이슈로 올리지 않았다 |
| `interview_questions.intent` | 제출 뒤 RPC로 공개. S-33에는 없음. S-22 정상 |
| `consistency_notes` | 메모, 인용, 삭제된 근거 칩("지운 상세 · 원본 삭제됨") 표시 |
| 실패 초안의 섹션 | **UQ-701** |
| 세션 수 | **UQ-700** |

없는 행과 잘못된 id: 200 + 스트림 404 표식까지 봤다. 화면에 뜨는 not-found는 브라우저가 그리므로 미확인.

### 3. 미확인이던 동작
| 동작 | 결과 | 방법 |
|------|------|------|
| 충돌 안내의 판정·두 버튼 동작 | 통과, UQ-702 1건 | C 훅 실행. 렌더는 미확인 |
| 자동 저장 타이머·재시도 | 통과 | C 훅 실행 |
| 기간 안내 | 저장 동작 통과. 안내 표시는 소스 | C + E |
| 빈 문항 안내 | Action 거부 확인. 안내 표시는 소스. UQ-703 | B + E |
| S-19 생성 | prepare → 라우트 → `error`까지. **블록 스트림은 한 번도 못 돌렸다** | B |
| S-19 중단 | 소스만. UQ-707 | E |
| S-33 재시작 | 취소 세션 HTML 일치. Action 호출은 W5 결과를 그대로 둠, 이번에 부르지 않음 | B + E |
| S-36 강조 | 소스상 경로 형식이 맞음(`project.x`, `details.i.fields.x`, `details.i.achievements.j.x`). 애니메이션 미확인 | E |

### 4. 영역을 건너는 흐름
| 흐름 | 결과 |
|------|------|
| FL-09 | 통과 (1번) |
| FL-10 | 키 없음 생성, 이름 규칙, 공고 짧음 저장, S-13·S-39 표시 통과. 토스트와 이동은 소스 |
| FL-13 | `return_target` 저장, S-36 머리 "인사이트를 위해 필요한 내용 · {공고}", readiness 표시 통과. 저장 뒤 복귀 버튼은 미확인 |
| FL-15 | 서버 이동, 결과 기록, 종료에서 나갈 때 `outcome` 비움과 이력 `from_outcome` 보존 통과. 드래그 미확인 |
| FL-16 | `getInProgressSessionAction` 값 통과. C-14 표시 미확인 |
| FL-17 | S-37 빈 상태 2종, S-20 진입 통과. C-16 미확인 |
| 링크·이동 | 죽은 링크 0. `/applications/{id}/jd?edit=1&from=interview` 포함 |
| L-01 배지 | 새 결과 6 → 완료 첫 열람 5 → 입력 원인 첫 열람 4 → 다시 채점 가능 세션 열람 4(그대로) → 종합만 실패 열람 4(그대로). A9·Q53-10과 일치. 화면 effect 자체는 미확인, Action을 직접 불렀다 |
| S-37 | `{ gone: false }` → `{ gone: true }`. 그만둔 묶음 "2개" |

### 5. Q53
| 결정 | 결과 |
|------|------|
| Q53-1 S-14 | 동의 필요 `ai_consent_required`, 키 무효 `key_invalid`, 둘 다 행 0개. `needs_check`는 생성. 일치 |
| Q53-2·11 S-15 | 입력 원인 실패: 수정 버튼, C-20. 요건 0개 성공: `not_a_jd` 문구, 저장 전 "요건 정리하기" 없음. 같은 원문 `jd_raw_text_unchanged`, 요건 있음 `jd_raw_text_locked`. 저장 → `pending`, S-31 "요건 정리 전", S-16 "공고를 고쳤어요…". 요건 있는 공고 + `cause`: 안내와 "새 기업 JD 추가", "커리어 정리하기". 일치 |
| Q53-2 `jd_has_results` | **미재현.** 넣은 행(실패 인사이트, 작성 중 자소서)이 "결과"로 치지 않아 저장이 성공했다. 안내 화면은 못 봤다. RPC 쪽은 W3가 확인 |
| Q53-2 S-33 | 고친 뒤 끝난 실패: "공고를 고쳤어요. 이 면접은 질문을 만들지 못했어요" + "면접 준비로". S-20 "질문을 만들지 못한 면접이 있어요" + "그만두고 새로 시작". 일치 |
| Q53-3 S-22 | 안전 정책 문구, "이 기업 JD로 새 면접 시작", 버튼 없음. Action `interview_evaluation_input_only` + `cause`. 일치 |
| Q53-4 S-17 | 요건 없는 공고 + 키: "새 경력기술서" 단계와 안내. 일치. 동의 필요 진입의 클릭 흐름은 미확인 |
| Q53-5 재정리 | "종합 평가 다시 정리"(키 없음은 C-18), 거부 `key_missing`. 실제 재정리 실행은 안 함 |
| Q53-7 | 실패 행 UQ-701. 중단은 미확인 |
| Q53-9 S-33 | 입력 원인 → "공고 원문 고치기" `?edit=1&from=interview`. 일치 |
| Q53-10 | L-01 표 참고 |

DB로 만든 상태는 위 "B"에 적었다.

### 6. `?state=` 미리보기
"D" 참고. 미리보기 **동작**(클릭 뒤 전환)은 미확인이다.

### 7. 다크 모드·좁은 화면 (소스 판독만)
- 충돌 안내: `Alert variant="warning"` → `warning-subtle`, `warning-subtle-foreground`. 라이트·다크 모두 `globals.css`에 정의. 긴 값은 `break-words`, 버튼은 `flex-wrap`.
- 중단 표시: `text-ai`, `text-ai-subtle-foreground` 토큰. 긴 문구는 줄바꿈 가능, 버튼은 `ml-auto`.
- 연도 미정: 일반 연도와 같은 구조. `AffiliationBlock`, `ProjectBlock` 재사용.
- 팔레트 클래스·hex 검색 0건. 대상은 `form-parts`, `save-status`, `streaming`, `career-tree`, `answer-sheet`, `result-view`, `cover-letter-questions` 7개 파일이다.
- 좁은 화면 터치 대상만 UQ-705.

## 기획 확인 필요

1. **로그인한 사용자의 S-01·S-02.** `/`와 `/sign-in`이 로그인 전 화면을 그대로 보인다("이미 계정이 있나요? 로그인"). L-01 "첫 화면"은 "로그인·가입 후"만 정하고 이미 로그인한 경우를 말하지 않는다. S-08로 보낼지 확인 필요.
2. **자동 저장 디바운스.** FL-05는 "디바운스 1~2초 `[가정]`", `ui-implementation/references/patterns.md`와 코드는 800ms. 훅 실행에서도 마지막 입력 500ms 뒤에는 호출이 없고 1,100ms 뒤에는 있었다. 동작 문제는 아니고 문서가 어긋난다.
3. **W5 노트의 기획 확인 3건은 그대로 열려 있다**: 충돌 때 고르게 하는 방식, 기간 역전 때 기간만 빼는 방식, `consistency_notes` 저장 형태. UX-7 관점에서 기간 역전은 새로고침하면 고치던 기간이 사라진다. 훅 실행으로 저장값이 옛 기간인 것을 확인했다.
4. **UQ-610은 실제 행에서 풀렸다.** 요건 0개 성공 공고가 실제로 수정 가능하고 저장된다. 막다른 길이 아니다. Q53-11 반영으로 보이며, 닫을지 리더 확인.

## 재확인 결과 (`17_ui-qa_q53_review.md`)

| ID | 상태 | 메모 |
|----|------|------|
| UQ-600 | 미확인 | 클릭 필요. `18` 보고서도 전이 함수까지다 |
| UQ-601 | 미확인 | 클릭 필요. 거부 코드는 실제 행에서 확인 |
| UQ-602 | 미확인 | mock 수정 건. 실제 경로는 추출 실패 뒤 질문 저장을 돌려 보지 못했다 |
| UQ-603~605, 607, 608, 611 | 미확인 | 클릭 필요 |
| UQ-606 | 미확인 | 실제 중단을 돌리지 못했다 |
| UQ-609 | 해당 없음 | 픽스처 건. 실제 행의 그만둔 세션(질문 있음·없음) S-33은 정상 |
| UQ-610 | 해결로 보임 | 위 "기획 확인" 4 |
| UQ-612, 613 | 미확인 | mock 수정 건. 실제 판정은 RPC 값이며 거부는 위 Q53-3대로 |

## 확인하지 못한 것

브라우저가 필요하거나 공급자가 필요한 항목이다. 12개 화면을 올리기 전에 볼 목록이기도 하다.

- 모든 클릭, 드래그, 키보드, 포커스, 다이얼로그, 토스트, 애니메이션(S-36 강조 포함)
- 충돌 안내·기간 안내·빈 문항 안내의 실제 렌더와 레이아웃
- `pagehide`, `visibilitychange`, 언마운트 저장, `beforeunload`
- `cacheComponents`의 라우트 상태 보존과 폼 초기 상태의 상호작용. 페이지에 `key={id-updated_at}`가 있어 대부분 다시 마운트되겠지만 뒤로 가기 때 낡은 행으로 폼이 열리는지는 못 봤다. 열리면 낡은 `updated_at`이 거짓 충돌 안내가 된다
- **S-19 블록 스트림 전체**: 임시 블록, `validated` 교체, 근거 칩, 중단 뒤 화면, 자소서 큐
- S-36 AI 턴 전체, S-33 질문 채워짐과 폴링, S-22 다시 채점 진행(C-03), S-16 생성 중 표시
- 실제 인사이트·초안 결과 행의 렌더(`normalizeInsightResult`는 소스만 읽었다)
- 다크 모드와 좁은 화면 전부, L-01 서랍, 보드 탭
- `/dev/states` 버튼 클릭과 미리보기 전환

## 기계 검사 출력

| 명령 | 결과 |
|------|------|
| `pnpm lint` | 오류·경고 0 |
| `pnpm typecheck` | 통과 |
| `pnpm build` | 지시대로 실행 안 함(기존 빌드 사용) |

## 뒷정리

- 시험 계정 4개(`uiqa-w5-*`) 삭제, `auth.users` 0행. 고아 `application_projects`, `interview_sessions`, `ai_provider_keys` 0행.
- 내가 띄운 3817, 3818 종료, 개발용 복사본과 세션 쿠키 파일 삭제.
- 포트 3000, 3457, 3467, 3999는 건드리지 않았다.
- Mailpit에 시험 메일이 남아 있다(로컬).
