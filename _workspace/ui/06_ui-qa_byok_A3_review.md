# UI QA — A3 기업 JD 관리 BYOK 반영 (라운드 1)

- 검수일: 2026-10-28
- 기준:
  - 기획: 플로우 v5.2 · AI v4.2 · 데이터 모델 v4.1a · PRD v4.2
  - 디자인 시스템 v2 (3.18~3.22, A3 메모)
  - `05_brief_byok.md`, `03_frontend-engineer-A3_report.md` "BYOK 반영 (2026-10-28)", `02_frontend-engineer-A0_report.md` "BYOK 파운데이션"
- 범위: S-13, S-14, S-31, S-15, S-16, S-17, S-18, S-19 (A3 파일만)
- 제외: 파운데이션 리뷰(`06_ui-qa_byok_foundation_review.md` UQ-200~211)의 알려진 항목은 다시 적지 않았다. 특히 AiRunButton 로딩 전 미잠금(UQ-207)과 C-18·AiRunButton 글자 크기(UQ-206)가 여기에 해당한다.
- 이슈 ID는 UQ-230부터 쓴다.

## 요약 — Critical 0 / Major 1 / Minor 12

**기계 검사**: `pnpm typecheck`, 전체 `pnpm lint`, `pnpm build`(39 페이지)가 모두 통과했다. 브리프가 알려 준 A1 lint 오류 2건은 이번 실행 시점에 이미 해소돼 있었다.

**dev 스모크**: `next dev -p 3963`으로 확인하고 종료했다. A3 경로 25개(`?state=` 포함)가 모두 200이었고, 개발 로그 `Error`/`⨯`는 0건이다. HTML에서 확인한 것:
- S-14 `ai-locked`: C-18 한 줄과 회사명·포지션명 입력란이 펼쳐져 보임. 키가 있을 때는 "회사명·포지션명 직접 입력" 링크로 접혀 있음
- S-31 `ai-locked`: "새로 만들려면 AI 연결" 표식
- S-15 `ai-locked`: 요건 영역만 C-18 영역형이고 "공고 원문"은 그대로
- S-15 `ai-failed-daily-quota`: "무료 한도". `ai-failed-input`: "채용 공고가 아닌 텍스트로 보여요"
- S-16 `ai-locked`: 결과 + 결과 배지 "…만든 결과"가 보이고, "다시 생성" 자리만 잠금
- S-16 C-20 원인별: rate-limited / billing / model / provider / input-rejected 문구가 02 C-20과 같음
- S-16 `key-invalid` "키를 확인해 주세요", `key-check` "확인 필요", `key-missing` "키가 삭제되어"
- S-16 `insufficient-key-invalid`·`insufficient-chat-failed`: "직접 입력하기"
- S-17 `ai-locked`: "AI에게 맡기기 (AI 연결 후)"
- S-19: 결과 배지, `ai-failed-rate-limited` "요청이 몰려"
- S-18·S-19(자기소개서) `ai-locked`: C-18 인라인

연결 상태로 바뀌는 클라이언트 표시는 HTML로 확인하지 못했고, 코드 경로로 판단했다:
- C-19 연결 배지(첫 렌더 null)
- S-16 `ai-waiting` 대기 초 수
- S-19 자기소개서의 스트림 실패 미리보기

브라우저 조작(FL-19 복귀 링·토스트, 카운트다운, 키 없이 만든 JD → 요건 정리하기)도 하지 않았다.

**통과한 부분**:
- A3 사용자 코드에 "차감·회 남음·남은 횟수·/10회·한도(·사용량은" 문구가 0건이다. `UsageHint`·`LimitNotice`·`monthly_limit`도 없다. "한도"는 C-03 대기 줄 주석에만 남았다.
- 모든 AI 실행 진입점이 C-18(D-UX-15)을 쓰고, 결과가 있으면 실행 버튼에만 잠금이 걸린다:
  - S-15 요건: 영역형
  - S-16: 결과 없음 = 영역형 / 결과 있음 = "다시 생성" 인라인
  - S-17 초안 생성, S-18 "전체 문항 생성", S-19 "이 문항만 생성"·"다시 생성"·"변경 사항으로 다시 생성": 인라인
  - S-16 보완점 "AI와 대화하며 추가": AiRunButton
- 키 없이도 되는 일이 막히지 않는다(D-36): 결과 열람·편집·복사, S-18 문항 편집, S-17 "문항 설정하기"·직접 고르기 트리, S-14 만들기, S-15 공고 원문.
- 자동 실행이 없다:
  - S-15 "요건 정리하기"는 누를 때만 실행된다(D-30).
  - 키를 연결해도 기존 JD를 일괄 추출하지 않는다.
  - FL-19 복귀 대상은 현재 URL이라, S-19의 `?generate=`는 진입할 때 바로 지워져 복귀 주소에 남지 않는다.
- FL-08 순서(키 → 데이터)를 지킨다. S-16~S-19 게이트는 키가 있을 때만 보인다.
- C-09의 새 분기(키 무효 / 대화 첫 턴 실패 → "직접 입력하기")가 A3 네 화면에 연결돼 있다(`chatFailure`, `?state=` 미리보기).
- C-19:
  - 결과 배지: S-16 결과 머리, S-19 상단(`drafts.provider/model_tier/model`), S-17 초안 목록 행
  - 연결 배지: 실행 버튼 옆(AiRunButton), S-14 만들기 옆
- C-20: S-15 요건 영역 block, S-16 결과 영역, S-19 경력기술서 block / 자기소개서 섹션 inline. `reduceTarget`("공고 원문" / "포함할 프로젝트" / "문항 메모")과 입력 이동 링크가 있다.
- C-03 무료 등급 순차 줄(`connectionTier`)이 들어갔다. `?state=ai-waiting`에서는 대기 줄 `Hourglass` + 초가 보인다.

## 화면별 점검표

| 화면 ID | Q1 스펙 행 | Q2 문구 | Q3–4 타입·필드 | Q5 라우트 | Q6 상태 | C-18 | C-19 | C-20 | 키 없이 열람·편집 | 자동 실행 없음 |
|---------|-----------|---------|----------------|-----------|---------|------|------|------|-------------------|----------------|
| S-13 | ✅ "요건 정리 전" 행 | ✅ | ✅ | ✅ | ✅ | — | — | — | ✅ | ✅ |
| S-14 | ✅ 키 없음 = 입력란 펼침 + 기본 이름 / 키 있음 = 접음 | ⚠️ UQ-233, UQ-234 | ✅ | ✅ | ✅ `ai-locked`·`key-*` | ⚠️ UQ-230 | ✅ | — | ✅ | ✅ |
| S-31 | ✅ 표식 2종, JD "요건 정리 전" | ✅ | ✅ | ✅ | ✅ | ✅ 표식(P-A3B-2) | — | — | ✅ | ✅ |
| S-15 | ✅ 요건 영역만 교체, 원문 유지 | ✅ | ✅ | ✅ | ✅ 7원인 + 시스템·입력 + `key-missing` | ✅ 영역형 | ✅ "요건 정리하기" 옆 | ✅ block | ✅ | ✅ (D-30) |
| S-16 | ✅ | ⚠️ UQ-237 | ✅ | ✅ | ✅ `ai-waiting`·`insufficient-*` 4종 | ✅ 영역 / 인라인 | ✅ 결과 배지 | ✅ | ✅ | ✅ |
| S-17 | ⚠️ UQ-236 | ⚠️ UQ-237 | ✅ | ✅ | ✅ | ✅ 인라인, AI-11 안 부름 | ✅ 목록 행 | — | ✅ | ⚠️ P-A3B-1 |
| S-18 | ⚠️ UQ-241 | ⚠️ UQ-237 | ✅ | ✅ | ✅ | ✅ 인라인 | ✅ | — | ✅ 문항 편집 | ⚠️ UQ-231 |
| S-19 | ⚠️ UQ-235 | ✅ | ✅ | ✅ | ✅ | ✅ / ⚠️ UQ-235 | ✅ 결과 배지 | ⚠️ UQ-239 | ✅ 편집·복사 | ⚠️ UQ-231 |
| 공통 (서버) | — | — | — | — | ⚠️ UQ-238 | — | — | — | — | ⚠️ UQ-232 |

## 이슈

### Major

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-230 | Major | A3 | S-14 | 02 S-14 v5 "키가 없을 때 … C-18 인라인, 막지는 않음", FL-19 "연결 성공 → 원래 화면으로 복귀 · 설정 복원" | `components/applications/application-new-form.tsx:143-146` (`AiLock size="inline"`, 복귀 대상 = 현재 URL), 입력값은 컴포넌트 상태에만 있음(`:37-46`) | 키 없이 S-14에서 "AI 연결하기"를 눌러 S-41로 갔다 돌아와도, 붙여넣은 공고 원문·회사명·포지션명·마감일이 남아 있다(세션 저장 후 복원). 또는 떠나기 전에 경고한다 | 링크를 누르면 바로 페이지를 떠나고, 돌아오면 빈 폼이다. 대량 붙여넣기 입력이 확인 없이 사라진다. S-14는 키 없이도 완결되는 흐름(J-2)이라, 안내 한 줄의 링크가 입력 유실 경로가 된다 |

### Minor

| ID | 심각도 | 담당 | 화면 | 스펙 위치 | 코드 위치 | 기대 | 실제 |
|----|--------|------|------|-----------|-----------|------|------|
| UQ-231 | Minor | A3 | S-18 → S-19 | 02 FL-11/FL-03 "요건이 없으면 생성 전에 요건 추출을 먼저 한다"(D-30), ST-WAIT-JD | `cover-letter-questions.tsx:157` (`onRun={() => void ensureRequirementsAction(apId)}` — 기다리지 않고 링크 이동), `draft-editor.tsx` 자동 시작 effect(`?generate=` 처리, `readiness.features.draft.ready`만 확인) | 요건 추출을 시작하고(또는 끝난 뒤) 생성으로 넘어간다. S-19 자동 시작은 `waitJd`·`extractFirst`일 때 대기 안내를 따른다 | 추출 호출과 페이지 이동이 동시에 일어나고, S-19는 JD가 `running`이어도 `?generate=all` 큐를 바로 시작한다. 그래서 요건 없이 문항 생성이 돌 수 있다 |
| UQ-232 | Minor | foundation | S-16~S-19 (서버) | D-30, FL-11 "요건 추출 먼저 AI-01 → AI-02" | `app/(dashboard)/applications/_lib/actions.ts:59-80` (`ensureRequirements`가 추출 작업만 만들고 바로 `startInsight`), `lib/data/drafts.ts` prepare* | 요건 추출과 본 작업이 한 작업으로 순서대로 실행된다(실제 백엔드는 같은 job 안에서 체인) | 목에서는 순서가 보장되지 않아, 키 없이 만든 JD의 첫 인사이트·초안이 요건 0개로 실행된다. A3 보고서 "파운데이션 요청 2"와 같은 건. 이슈로 남겨 백엔드 이관 목록에 넣는다 |
| UQ-233 | Minor | A3 | S-14 | 02 S-14 v5 키 없음 "만들기 후 요건 추출은 하지 않는다(D-30)" | `application-new-form.tsx:96` "주요 업무·자격요건·우대사항을 AI가 정리해요", `app/(dashboard)/applications/new/page.tsx:34` "공고를 붙여넣으면 요건을 정리하고, …" | 키가 없으면 "AI를 연결하면 정리해 드려요"처럼 조건을 붙이거나 숨긴다 | 키가 없어도 AI가 요건을 정리한다고 안내한다. 바로 아래 C-18 한 줄("AI를 연결하면 …")과 서로 어긋난다 |
| UQ-234 | Minor | A3 | S-14 / S-13·S-31 표시 | 02 S-14 "기본 이름 '새 기업 JD (날짜)'", 시각은 KST 기준(C-20·C-06 관례) | `application-new-form.tsx:201` (`new Date().toISOString().slice(0, 10)`), 표시 `lib/data/labels.ts` `applicationDisplayName`(`createdAt.slice(0, 10)`) | 날짜를 KST로 계산한다 | UTC 날짜라 KST 00~09시에 만들면 도움말과 기본 이름이 전날 날짜로 나온다. 표시 함수는 파운데이션 파일이라 함께 맞춰야 한다 |
| UQ-235 | Minor | A3 | S-19 | 02 "실행 버튼 공통 규칙 (v5)": 모든 다시 생성 버튼 = C-19 배지, 키 없으면 C-18 인라인, "다시 하면 공급자 토큰을 다시 써요" | `components/applications/draft-editor.tsx:486` (경력기술서 일부 실패 "다시 생성"), `:759` (자기소개서 문항 일부 실패 "다시 생성") — `AiFailedInline onRetry` | 이 두 "다시 생성"도 `AiRunButton`(rerun) | 일반 버튼이라 배지·다시 하기 주석이 없다. 키를 지운 뒤(키 없음)에도 C-18 대신 버튼이 보이고, 누르면 서버 거절 토스트만 뜬다 |
| UQ-236 | Minor | A3 | S-17 | 02 S-17 출처 표시(C-11), A3 UQ-76(라운드 1) | `components/applications/drafts-view.tsx:180-205` | 같은 화면에서 연결 상태가 바뀌어도(설정 다이얼로그 "AI 연결" 섹션에서 연결) 사용자가 고른 선택은 그대로 둔다 | 키 없음 기본값(`mode = user`, 전체 선택)이 걸린 뒤 다이얼로그에서 키를 연결하면 `locked`가 false가 되면서 AI-11 effect가 돈다. 그러면 결과가 `selection`을 덮어써, 라디오는 "직접 고르기"인데 체크는 AI 선택이 된다(`restored` 가드만 있음) |
| UQ-237 | Minor | A3 | S-16·S-17·S-18 | 디자인 3.22 실행 버튼 아래 안내 = `meta`(`text-sm`) | `insight-view.tsx:145`, `drafts-view.tsx:323`, `cover-letter-questions.tsx:160` (`EXTRACT_FIRST_NOTE`를 `text-xs`로) | `text-sm leading-5 text-muted-foreground` | 12px caption 크기. 파운데이션 UQ-206과 같은 종류지만 A3가 직접 쓴 footer다 |
| UQ-238 | Minor | A3 | S-19 (서버 거절) | 02 FL-08 "키 확인 → 데이터 준비" 순서 | `app/(dashboard)/applications/_lib/actions.ts:127-133` (`refusal()`: readiness 먼저) | 키가 없고 데이터도 부족하면 "AI 연결" 안내가 먼저 나온다 | "서류 초안을 만들려면 커리어가 조금 더 필요해요" 토스트가 먼저 나온다. 버튼이 잠겨 있어 보통은 생기지 않고, URL `?generate=`나 다른 탭에서 키를 지운 경우에 생긴다 |
| UQ-239 | Minor | foundation | S-19 (C-20) | 02 C-20 `rate_limited` "다시 시도(`retry_after`까지 비활성)", `daily_quota_exhausted` 초기화 시각 = `quota_resets_at`, 공급자 = 실행 공급자 | `draft-editor.tsx:470`, `:482`, `:748` (`AiErrorNotice code=…`만 넘김). 원인: 스트림 오류 이벤트가 `{error_code}`만 가짐(`useAiStream().error`) | 스트림 실패에도 `retry_after`·`quota_resets_at`·`provider`가 C-20에 들어간다 | 다시 시도가 카운트다운 없이 바로 눌린다. 초기화 시각은 계산값(다음 KST 16:00)이고 공급자는 현재 활성 공급자로 대신한다. 스트림 `error` 이벤트에 이 세 값을 실어 주는 것은 파운데이션 몫 |
| UQ-240 | Minor | ui-designer | S-14 (디자인 문서) | 02 S-14 v5 "키가 있을 때 … 입력란은 접어 두고" | `docs/ui/design-system.md:1249` "(v2) 이름 입력란은 항상 보이고, 비워 두면 기본 이름을 쓴다" | 디자인 메모가 명세(키 없음 = 펼침 / 키 있음 = 접음, 회사명·포지션명 두 칸)와 같다 | 디자인 메모가 명세와 다르다. 구현은 명세를 따랐다. 문서만 고치면 된다 |
| UQ-241 | Minor | A3 | S-18 | 02 S-18 v5 "생성 버튼('전체 문항 생성' / '이 문항만 생성')만 키 필요(C-18 인라인 / C-19 배지)" | `cover-letter-questions.tsx:154-167` ("전체 문항 생성" AiRunButton + 일반 링크 "문항별로 생성하기") | 문항 카드마다 "이 문항만 생성"(AiRunButton, 키 없으면 C-18 인라인) — 또는 S-19로 보내는 지금 방식을 명세에 맞춰 이름을 정리 | S-18에는 문항별 생성 버튼이 없고, 이름이 다른 링크 하나만 있다(S-19의 버튼 이름은 "이 문항만 생성"으로 맞춤). 키가 없어도 이 링크는 잠금 표시 없이 S-19로 간다(S-19에서 잠금이 보여 실행되지는 않음) |

## 기획 확인 필요

엔지니어 보고서의 "기획 확인 필요 (BYOK)" 5건은 실제 공백·모순이 맞아 그대로 유지한다:
- S-14 입력값을 JD 컬럼에도 저장하는지
- S-31 표식 vs 디자인 영역형
- S-17 키 없음 시 AI-11 막기 / 인사이트 우선순위 사용
- "요건 추출 먼저"를 어떻게 보일지
- S-15 추출 결과 배지

QA가 덧붙이는 것:

| # | 대상 | 양쪽 인용 |
|---|------|-----------|
| P-A3B-1 | S-17 AI-11 자동 호출 vs 자동 실행 금지 | 03 AI-11 트리거 "경력기술서 화면에 들어갈 때 … **자동 1회**(경량 등급 호출 1회)" ↔ PRD NFR-AI-08 "사용자가 요청하지 않은 호출은 하지 않는다", D-UX-16 "연결 후 원래 화면 복귀 시 자동 실행 없음". FL-19로 S-17에 돌아오면(또는 그냥 들어오면) 사용자가 누르지 않았는데 공급자 호출이 1회 일어난다. 지금 구현은 AI 명세를 따랐다(`drafts-view.tsx:189-205`). 키가 사용자 비용인 BYOK에서 이 호출을 "AI에게 맡기기"를 고를 때로 미룰지 확인 필요 |
| P-A3B-2 | S-31 키 없음 인사이트 카드 | 02 S-31 v5 "카드에 'AI 연결 필요' 표식" ↔ 디자인 3.18 "S-31 인사이트 카드 본문 영역형". 구현은 명세의 표식을 따랐다. 엔지니어 질문과 같은 건으로, 디자이너·기획 중 한쪽 문서를 고쳐야 함 |

## A3 라운드 1 수정 회귀 확인

| 항목 | 결과 | 메모 |
|------|------|------|
| UQ-60·68 자동 저장 (`pendingEdits` 스냅샷, `dropPendingEdits`, `dirty` 유지) | 유지 | `draft-editor.tsx:133`, `:176`, `:192` |
| UQ-61·62 생성 저장 계약 (prepare = 계획만, finalize = 성공일 때만 덮어씀) | 유지 | 거절 응답(`refused`)이 추가됐을 뿐 계약은 그대로 |
| UQ-63·87 복귀 대상 consume | 유지 | S-16·S-17(두 종류)·S-18·S-19. UQ-87(href를 보지 않는 consume)은 이전 라운드 Minor 그대로 |
| UQ-64 다시 생성 확인 문구 | 유지(문구 갱신) | "다시 하면 공급자 토큰을 다시 써요"로 바뀜(`sources-used.tsx:64-65`). 차감 문구 없음 |
| UQ-65 부분 판정 표 | 유지 | |
| UQ-67 문항 삭제 확인 | 유지 | `cover-letter-questions.tsx:206`, `:334` |
| UQ-80 트리 행 44px | 유지 | `source-tree.tsx:130`, `:153` |
| UQ-85 스트리밍 선택 카드 role/origin 배지 | 해결 | `draft-editor.tsx:709-721` |
| UQ-86 서버 거절 무안내 | 해결 | `notifyRefused`가 사유별 토스트를 띄움(`draft-editor.tsx:42-47`). 사유 순서는 UQ-238 |

## 기계 검사 출력

- `pnpm typecheck` (`tsc --noEmit`): exit 0
- `pnpm lint` (eslint, 전체): exit 0. A3 범위 `eslint src/app/(dashboard)/applications src/components/applications`도 exit 0
- `pnpm build`: exit 0, `Generating static pages … (39/39)`
- `pnpm exec next dev -p 3963` (확인 후 종료): A3 경로 25개 200, 개발 로그 `Error`/`⨯` 0건
