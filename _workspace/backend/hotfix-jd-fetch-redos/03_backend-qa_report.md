# 핫픽스 QA — 공고 가져오기 정규식 폭주(QA-R16-02) · 독립 확인

- 날짜: 2026-11-12 · 브랜치 `claude/hotfix-jd-fetch-redos` · 커밋 **`1a4dcda`** (기준 main `e9ea714` = 운영 코드)
- 대상: `fetch.ts`(정규식 → 스캐너 교체, NUL 제거) · 신규 `html-scan.ts` · 신규 테스트 `fetch.redos.test.ts` · 신규 테스트 전용 `fetch.r15-reference.ts`
- **코드는 고치지 않았다.** 원격 쓰기·커밋·실제 외부 사이트 요청 0건(가짜 `lookup`·`fetchImpl`). 측정용 임시 파일은 저장소에서 지웠고, 작업 트리는 `1a4dcda`와 같다.

## 결론 — **배포해도 된다**

| 심각도 | 건수 |
|--------|------|
| Critical | **0** |
| Major | **0** |
| Minor | **1** (HF-01 — 배포를 막지 않는다) |

근거 요약:
1. **폭주가 닫혔다.**
   - R16 보고서의 R15 8곳 입력(15초 이상 막힘, O(n³) 두 곳은 추정 수 주)이 **2 MB 전체 경로에서 102~327 ms**다.
   - 내 병적 입력 **47종 전부 2 MB 전체 경로 1초 안**이다(최악: 일반 경로 327 ms, 프레임 경로 558 ms).
   - 스캐너 9종은 **250K→4M 두 배 사다리에서 모두 선형**이다(4M 최악 93 ms).
2. **스캐너 자체의 새 폭주는 없다.** 코드를 읽어 중첩 루프·되감기·호출부 재구축 여부를 확인했고, 그 약점을 노린 입력 13종을 직접 만들어 쟀다. 모두 1초 안이었다.
3. **정상 출력이 바뀌지 않았다.** **main의 실제 `fetch.ts`**와 비교했다. 무작위 HTML **96,000건**(함수 3종 + 종단 경로 성공 3,340건 포함)에서 **차이 0**이다. 테스트 안 참조 구현은 main 파일 + 머리 주석 6줄과 같다.
4. **NUL**: 로컬 DB에서 확인했다. 핫픽스는 가져오기 → **생성 → 미리 보기 모두 성공**한다. 같은 페이지를 **운영 코드에 넣으면 생성이 `internal_error`로 실패**한다. 핫픽스가 이 운영 버그도 함께 닫는다.
5. SSRF·10초·2 MB·리다이렉트 재검사·로그 코드는 **0줄** 바뀌었다. 기존 `fetch.test.ts`는 수정 없이 통과한다. 전체 검사 4종이 통과한다.

---

## 검사 실행 결과

| 검사 | 결과 |
|------|------|
| typecheck | **통과** |
| lint | **통과** |
| Vitest | **통과** — 159파일 **2,614건**(`fetch.redos.test.ts` 64건, 4.5초 포함) |
| pgTAP | **통과** — 66파일 2,708 단정(DB 변경 없음) |

---

## 1. 내 공격 도구로 다시 쟀다

방법은 R16 때와 같다. **사례마다 별도 프로세스를 띄우고 바깥에서 프로세스 그룹을 강제 종료**(15초)했다. 입력은 2 MB 바이트 상한 바로 아래(1,990,000자)다. 남은 프로세스는 0이다.

### R15의 8곳 — 전체 경로 `fetchJobDescription`, 2 MB

| 입력 | 핫픽스 이전(R16 QA 실측, 운영 코드) | **핫픽스** |
|------|-------------------------------------|-----------|
| `<` 반복 (stripTags) | 15초 강제 종료 · 추정 약 20분 | **327 ms** |
| `<div ` 반복 (BLOCK_TAGS) | 15초 강제 종료 | **211 ms** |
| `<div class="x" ` 반복 (보일러플레이트, **O(n³)**) | 15초 강제 종료 · 추정 수 주 | **159 ms** |
| `<!--` 반복 | 15초 강제 종료 | **179 ms** |
| `<img ` 반복 | 15초 강제 종료 | **236 ms** |
| 닫히지 않은 `<script type=ld+json>` 반복 | 15초 강제 종료 | **102 ms** |
| `<script ` 반복 | 15초 강제 종료 | **113 ms** |
| `<iframe src="` 반복 (**O(n³)**) | 15초 강제 종료 · 추정 수 주 | **111 ms** |

### 그 밖의 병적 입력 — 전체 경로, 2 MB (모두 1초 안)

| 묶음 | 입력 | 시간 |
|------|------|------|
| R16 보고서 입력 | 닫지 않은 `<b>`·`<strong>`·`<i>`·`<b>x`·`<h1>`·`<h1>x`·`<h1>x</h2>`, `*`, 공백, `&nbsp;`, 열린·닫힌 중첩 표, `<li>`·`<ul>` 열기만, 중첩 목록, `<td>`만, `<tr>`만, 큰 colspan, `>` 없는 긴 속성, `_`·` _a`·`| `·`|` 긴 줄, `&#x`, 긴 이름 엔티티, 실제 모양 650 KB | **102~288 ms** |
| **스캐너를 노린 새 입력**(아래 2절) | 보일러플레이트 깊은 중첩(닫힘 있음)·미닫힘·끝에만 `>`, iframe 끝에만 `>`, JSON-LD 끝에만 닫힘·유효한 JSON-LD 3만 개, 버리는 태그 14종 전부 섞기, `</scrip` 반쪽 닫힘, `<div>` 깊은 중첩 | **91~248 ms** |
| **프레임 경로**(사람인 랜딩 + 프레임 문서 둘 다 2 MB 공격) | `<`, `<div class="x" `, 보일러플레이트 중첩, 실제 모양 | **162~558 ms** |

메모리: 프로세스 RSS 159~276 MB(vitest 자체 포함). 스캐너는 2 MB 입력에 표를 한 번 만들 때 약 32 MB를 잠깐 쓴다(Int32Array 4개 × n+1). 문제없는 수준이다.

### 스캐너별 두 배 사다리 — 250K / 500K / 1M / 2M / 4M 자 (ms)

`html-scan.ts` 함수를 직접 불렀다. 문자열 전체를 끝까지 훑게 만드는 입력과, 각 스캐너가 노린 원래 공격 입력을 함께 넣었다.

| 스캐너 (입력) | 250K | 500K | 1M | 2M | 4M |
|---------------|------|------|----|----|----|
| `replaceAnyTag` (`<a>x` 반복 — 전부 매치) | 2 | 4 | 9 | 29 | 54 |
| `replaceAnyTag` (`<` 반복) | 0 | 0 | 0 | 0 | 0 ← 설계대로 즉시 중단 |
| `replaceComments` (`<!---->x` 반복) | 2 | 3 | 7 | 11 | 31 |
| `replaceNamedTags` (`<div>x` 반복) | 4 | 8 | 21 | 33 | 68 |
| `replaceNamedTags` (`<div ` 반복) | 0 | 0 | 0 | 0 | 0 ← 즉시 중단 |
| `removeElements` (`<script>x</script>` 반복) | 2 | 4 | 7 | 14 | 23 |
| `removeElements` (`</scrip` 반쪽 닫힘) | 1 | 3 | 4 | 8 | 15 |
| `boilerplateOpenTags` (`<div class="nav">x</div>` 반복) | 8 | 14 | 36 | 53 | 93 |
| `boilerplateOpenTags` (보일러 + 본문 섞기) | 10 | 15 | 26 | 57 | 90 |
| `boilerplateOpenTags` (`<div class="x" ` 반복 — 옛 O(n³)) | 7 | 15 | 22 | 37 | 71 |
| `boilerplateOpenTags` (끝에만 `>`) | 8 | 11 | 19 | 38 | 75 |
| `frameSrcValues` (`<iframe src="a">` 반복) | 10 | 18 | 26 | 57 | 82 |
| `frameSrcValues` (`<iframe src="` 반복 — 옛 O(n³)) | 7 | 9 | 17 | 27 | 53 |
| `ldJsonBodies` (유효 JSON-LD 반복) | 6 | 11 | 19 | 38 | 68 |
| `ldJsonBodies` (닫히지 않은 ld+json 반복) | 5 | 14 | 15 | 29 | 54 |
| `closeTagFinder` (`<div class="menu">` 깊은 중첩 + 질의) | 4 | 6 | 9 | 16 | 27 |

→ **모두 크기가 두 배면 시간도 약 두 배(선형)**다.

---

## 2. 스캐너 자체의 새 폭주 — 코드 검토 + 공격

**검토한 위험 지점과 판정** (`html-scan.ts`):

| 지점 | 위험 | 판정 |
|------|------|------|
| `replaceAnyTag`·`replaceComments`·`replaceNamedTags`(82–139) | 닫는 쪽이 없을 때 한 글자 넘기고 다시 앞으로 찾으면 O(n²) | **닫는 쪽이 없으면 즉시 중단**(`gt === -1`/`end === -1` → `break`). "이 `<` 뒤에 `>`가 없으면 뒤의 어떤 `<`에도 없다"는 근거가 옳고, 정규식 결과와도 같다. 이름이 맞지 않으면 그 `<`만 건너뛴다 → 선형 |
| `removeElements` + `findCloseElement`(142–182) | 여는 태그마다 닫는 태그를 끝까지 찾으면 O(n²) | 닫는 쪽을 찾으면 **그 뒤에서 다시 시작**(되감지 않음), 못 찾으면 **즉시 중단** → 각 구간을 한 번만 훑는다. 선형 |
| `buildTables`·`lastValidTable`(202–239) | 태그마다 표를 다시 만들면 O(n²) | 생성기 진입 때 **한 번만** 만든다(O(n)). 태그마다 하는 일은 표 조회 O(1) |
| `openTagsWithAttr` 탐욕 선택(249–300) | 옛 O(n³)의 원인(뒤 속성 위치를 모두 다시 시도) | "첫 `>` 앞에서 유효한 가장 큰 k"를 `last[g]` 한 번으로 찾는다. X가 고정된 k에서 결정적이라 정규식 결과와 같다. 따옴표 안 `>`도 바르게 다룬다 |
| `stripBoilerplateBlocks` 호출부(`fetch.ts:227-258`) | 블록을 지울 때마다 문자열을 다시 만들고 스캐너를 새로 돌리면 O(n²) | **원본 `html` 위에서 생성기 하나**를 돌리고 `resume`으로 앞으로만 간다. 닫는 태그 찾기는 **태그별로 한 번 만들어 기억**(최대 6개)한다. 출력은 커서 슬라이스로 만든다 → 선형 |
| `closeTagFinder`(322–372) | 깊이 세기를 질의마다 다시 하면 O(n²) | 누적합 + 단조 스택("다음 더 낮은 깊이") 한 번 O(n), 질의는 이분 탐색 O(log n). 깊이 0이 되는 첫 지점 계산이 맞다 |
| `ldJsonBodies`(375–416) | 닫는 `</script>` 재탐색 | 표 한 번, 일치마다 닫는 쪽을 한 번 찾고 그 뒤에서 재개, 없으면 중단 → 선형 |
| `fetch.ts`에 남은 정규식 | — | `decodeEntities`(길이 상한 `{1,31}`), `normalizeText` 단순 클래스, NUL 제거, `/\]\]>\s*$/`(`]]>`에서만 시작하고 `\s*`는 바로 뒤 공백 덩어리만 훑는다), `<meta charset>`(앞 2 KB만) → 모두 선형 |

**검토에서 나온 약점을 겨냥한 공격 입력 13종을 직접 만들었다** — 결과는 1절 표 "스캐너를 노린 새 입력"·"프레임 경로". **모두 1초 안. 새 폭주는 찾지 못했다.**

---

## 3. 정상 출력 무변경 — main의 **진짜 파일**과 비교

- 비교 대상: `git show e9ea714:src/server/services/job-description/fetch.ts`(운영 코드)를 임시 모듈로 올렸다. **테스트 안 참조 구현을 쓰지 않았다.**
- **참조 구현이 원본과 같은가**: `diff`로 보면 `fetch.r15-reference.ts` = main 파일 + 머리 주석 6줄이다. 그 밖의 차이는 없다.
- 무작위 생성기(시드 고정)는 의미 경계를 노린 토큰을 섞는다:
  - 단어 경계(`<divx>`, `<scripts>`, `xsrc=`, `_src=`, `xclass=`, `data-class=`, `xtype=`), 대소문자 변형
  - **따옴표 안 `<`·`>`**(`class="a<b"`, `title="x>y"` — 리더가 `[^<>]*`를 거부한 이유)
  - 따옴표 없는 속성·빈 속성, 닫는 태그 안 공백·줄바꿈
  - 보일러플레이트 class·id 여러 종, 버리는 요소 14종
  - JSON-LD 단일·배열·`@graph`·CDATA·깨진 JSON·닫힘 없음
  - 사람인·잡코리아 프레임 URL 변형, 닫히지 않은 주석, 엔티티(`&#0;` 포함), CRLF·NBSP·zero-width

| 비교 | 건수 | 차이 |
|------|------|------|
| `htmlToText` | 30,000 | **0** |
| `extractJobPosting` | 30,000 | **0** |
| `bodyFrameUrl` (사람인·잡코리아·일반 랜딩 URL) | 30,000 | **0** |
| `fetchJobDescription` 종단(랜딩 + 프레임 문서, 결과 객체 또는 오류 코드) | 6,000 — **성공 3,340건**, 포털 프레임 랜딩 2,668건 | **0** |

**비교가 비어 있지 않음을 확인했다**: JSON-LD 제목이 나온 페이지 47%, 프레임 URL이 나온 랜딩 11%, 보일러플레이트 제거가 걸린 페이지 87%, `<script>` 제거가 걸린 페이지 7%.
- (첫 실행의 종단 비교는 4,000건이 전부 `fetch_too_short`라 오류 코드만 비교했다. 그래서 본문 블록을 넣어 성공 경로를 다시 비교했다 — 위 표가 그 결과다.)
- 기존 사람인·잡코리아·`JobPosting`·일반 본문 픽스처는 `fetch.test.ts` 안에 있다. 그 **54건이 main과 같은 파일 그대로 통과**한다(`git diff e9ea714 -- fetch.test.ts` 비어 있음).

---

## 4. NUL — 생성·미리 보기까지 (로컬 DB 실측)

본문·제목(`<h2>`)·JSON-LD 제목/회사명에 NUL 바이트를 섞은 실제 공고 페이지(`KO_BACKEND`)를 썼다. 가져오기 → **실제 `createApplicationProject`**(사용자 세션, 로컬 DB) → **실제 `extractJdPreview`**(실제 작업·사용량 저장소, 공급자만 스크립트) 순서로 돌렸다.

| 단계 | **핫픽스** | main(운영) |
|------|-----------|-----------|
| 가져오기 | 성공, 263자, **NUL 없음**(본문·제목·회사명) | 성공, 315자, **NUL 있음**(본문·제목·회사명) |
| 생성 RPC | **성공**(`extraction_status=pending`) | **실패 — `internal_error`**(Postgres `null character not permitted`) |
| 미리 보기 | **성공**(작업 `succeeded`/`jd_preview`) | 성공(문장 텍스트를 jsonb에 쓰지 않아 통과) |

- 무작위 HTML 10,000건에 NUL을 섞어 보아도 `htmlToText(x) === main.htmlToText(x에서 NUL 제거)`, 차이 0이다. 어느 출력에도 NUL이 남지 않는다(`extractJobPosting` 포함).
- **의도된 출력 변화는 NUL 하나뿐이다** — 노트의 주장과 같다.
- 263자와 315자의 차이 52자 = 섞어 넣은 NUL 개수다.

---

## 5. 참조 구현 파일의 위험

| 확인 | 결과 |
|------|------|
| 누가 import하나 | **`fetch.redos.test.ts` 하나뿐**이다 |
| 묶음(번들)에 들어가나 | 라우트·페이지에서 닿는 import 경로가 없다. 폴더를 묶는 `index.ts`, `import.meta.glob`·`require.context`도 없다 → 지금은 번들에 들어가지 않는다 |
| 위치 | `src/server/services/job-description/` — **운영 코드 바로 옆** |

### HF-01 [Minor] 취약한 참조 구현이 운영 파일 옆에, 같은 이름으로 있다

- 담당: **api-engineer**
- 근거: `fetch.r15-reference.ts`가 **`fetch.ts`와 같은 이름의 export 7개**(`htmlToText`·`extractJobPosting`·`fetchJobDescription`·`bodyFrameUrl`·`decodeEntities`·`decodeHtml`·`normalizeText`)를 **같은 폴더**에서 내보낸다. 막는 lint 규칙이 없다(`eslint.config.*`에 `no-restricted-imports` 없음).
- 위험: 에디터 자동 import가 이 파일을 고르면 **폭주가 조용히 되살아난다.** 파일 머리 주석만이 유일한 방어다.
- 권고(택1 이상):
  - 테스트 전용 위치로 옮긴다 — 예: `src/server/services/job-description/__tests__/fetch.r15-reference.ts` 또는 `src/test/reference/`.
  - `eslint.config`에 `no-restricted-imports`를 두어 `*.test.ts` 밖에서 import하면 실패하게 한다.
  - export 이름에 접두사를 붙인다(`r15HtmlToText` 등).
- **배포를 막지 않는다** — 지금은 어떤 운영 경로에서도 닿지 않는다.
- 상태: **열림**

---

## 6. SSRF·10초·2 MB·리다이렉트·로그 회귀

| 확인 | 결과 |
|------|------|
| `fetch.ts` diff 중 `assertSafeUrl`·`readCapped`·`maxRedirects`·`redirect: "manual"`·`deadlineAt`·`timeoutMs`·`maxBytes`·`d.log(`·`jd_fetch.*`·`isRedirect`·`rateLimiter`·`JD_FETCH_MIN_CHARS`·`JD_FETCH_RAW_TEXT_MAX`를 건드린 줄 | **0줄** |
| diff가 닿는 함수 | 파싱 함수뿐 — `htmlToText`·`extractJobPosting`·`asText`·`stripDroppedElements`·`stripBoilerplateBlocks`·`findCloseTag`·`frameSources`·`BOILERPLATE_ATTR` 근처 |
| `fetch.test.ts`·`ssrf.ts`·`ssrf.test.ts`·`ssrf-real.test.ts`·라우트 | main과 **완전히 같다** |
| 참고 | 10초 deadline은 여전히 네트워크 단계에만 걸린다. 다만 CPU 단계가 2 MB 최악 0.56초로 줄어 실질 위험이 사라졌다 |

---

## 관찰 (결함 아님)

- **시간 단정의 여유**: `fetch.redos.test.ts`의 2 MB 단정은 1초 한도이고, 내 최악 측정은 327 ms(약 3배 여유)다. 지금 저장소에는 CI가 없다(`.github/workflows` 없음). 나중에 느린 CI 러너를 붙이면 이 단정이 흔들릴 수 있으니 지켜볼 것.
- **R16 브랜치에 남은 것**(이 핫픽스 범위 밖, R16 보고서 그대로):
  - QA-R16-01 — 마크다운 강조·제목 정규식 O(n²), R16 신규
  - QA-R16-03 — 50,000자 자르기 회귀
  - QA-R16-05 — 표 행 12만 5천 개 `RangeError`

  R16을 이 핫픽스 위로 다시 맞출 때 R16의 정규식도 같은 스캐너로 옮겨야 한다(노트 `[가정]`과 같다). QA-R16-02·QA-R16-04(NUL)는 이 핫픽스가 R15 경로에서 닫는다.

## 정리

- 측정용 임시 파일(하네스·main 비교 모듈·차분 테스트·NUL 종단 테스트·드라이버)을 저장소에서 모두 지웠다. 작업 트리는 `1a4dcda`와 같다(`git status` 비어 있음).
- 로컬 DB: 내 테스트 사용자는 모두 지웠다. **남아 있는 사용자 1명(`lab.jehyun@gmail.com`, 2026-11-10 생성)과 그 지원 프로젝트 1건은 내 것이 아니라서 손대지 않았다**(UI 세션 또는 사용자 계정).
- 남은 프로세스 0. 원격 쓰기·커밋·실제 외부 요청 0건.
- 재현 도구(스크래치패드 `/private/tmp/claude-501/-Users-jehyun-Resumate--claude-worktrees-cover-letter-backend-ef4d68/cdfbb6b0-f08f-43f1-a316-88fd59d80f25/scratchpad/`):
  - 공격 측정: `qa-redos-hotfix.harness.test.ts` + `qa-redos-driver.mjs` — 대상 `md`·`md15`·`pipeline`·`frame_pipeline`·`scan`(`QA_SCANNER=<함수 이름>`)
  - 차분 비교: `qa-hotfix-diff.test.ts`
  - NUL 종단: `qa-hotfix-nul-e2e.integration.test.ts`
  - 출력: `hotfix-pipeline1.out` · `hotfix-pipeline2.out` · `hotfix-adversarial.out` · `hotfix-ladder.out` · `hotfix-diff.out` · `hotfix-diff-coverage.out` · `hotfix-nul-e2e.out`
