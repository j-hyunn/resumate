# R16 api-engineer 노트 — 공고 URL 가져오기를 마크다운으로 (A절)

- 날짜: 2026-11-12 · 브랜치 `claude/jd-fetch-markdown`(main `e9ea714`에서) · **DB 변경 없음**
- 검증: `pnpm typecheck` 통과 · `pnpm lint` 경고 0 · `pnpm test` **159파일 2,590건 전부 통과**. ai-pipeline-engineer의 `jd.ts`(B절) 변경이 같은 트리에 있는 상태에서 돌렸다.
- **새 의존성 없음.** 정규식 기반이다. 기존 `stripDroppedElements`·`stripBoilerplateBlocks`·`decodeEntities`는 그대로 쓴다.
- 손대지 않음: `src/server/ai/context-pack/jd.ts`(B절), `supabase/`, `docs/`, UI 경로. 커밋·원격 쓰기 없음.

## 바꾼 파일

| 파일 | 변경 |
|------|------|
| `src/server/services/job-description/fetch.ts` | `htmlToText` → **`htmlToMarkdown`**(이름 바꿈, 호출부 3곳 함께), **`markdownTextLength`** 신설, `truncate` 줄 경계 자르기(export) |
| `src/server/services/job-description/fetch.test.ts` | import·describe 이름만 `htmlToMarkdown`으로. 기존 단정 54건은 **전부 그대로 통과**(로그 단정 포함) |
| `src/server/services/job-description/fetch.markdown.test.ts` | **신설 23건** |

## UI에 넘길 것

- `POST /api/job-descriptions/fetch`의 `rawText`는 이제 **마크다운**이다. 모양은 그대로다(`{rawText, companyName, positionTitle}`).
- 쓰는 문법: `#`~`######` 제목 · `- ` / `1. ` 목록 · `**굵게**` · `_기울임_` · 블록 사이 **빈 줄** · `<br>` = 줄바꿈 하나 · **GFM 표**(머리 행 + `| --- |`) · 링크는 글자만.
- 문자열은 **이미 `normalizeJdRawText`의 정규형**이다(NFC·LF·앞뒤 trim). 편집기가 고치지 않고 그대로 보내면 미리 보기·생성이 화면이 받은 바이트와 **같은 해시**를 만든다.

## 변환 규칙 (계획 A절 + 표 변경 2026-11-12)

| HTML | 마크다운 |
|------|---------|
| `h1`~`h6` | `#`~`######` + 공백, 앞뒤 빈 줄. 안쪽 태그는 펼친다(제목 안 굵게 없음) |
| `ul > li` / `ol > li` | `- ` / `1. `. 안쪽 목록을 먼저 바꾸고, 중첩은 평평해진다(허용). 항목 안의 `<p>`·`<div>`·`<br>`는 그 줄로 접는다(기호가 혼자 남지 않게) |
| `strong`·`b` / `em`·`i` | `**…**` / `_…_`(`*` 안 씀). 앞뒤 공백은 기호 **밖으로** 뺀다(`** 주요 **`는 굵게가 아니다). 빈 강조(`<b> </b>`)는 지운다. 강조 안에 블록이 있으면 강조만 버린다 |
| `br` | 줄바꿈 하나 |
| `p`·`div`·`section`·`blockquote` 등 | **빈 줄로 구분**. 중첩 `div`가 몇 겹이든 `normalizeText`가 빈 줄을 **정확히 하나** 남긴다(기존 필터가 연속 빈 줄 중 첫 하나를 남긴다 — 테스트로 확인) |
| `table` | **GFM 표**(UI 확인 2026-11-12 — `DocTextarea`의 `TableKit`). 아래 |
| `a` | **글자만**(주소·추적 토큰을 원문에 남기지 않는다, CF-A16) |
| `img`·`script`·`style` | 지운다 |

**GFM 표**:
- 머리 행 = `<th>`가 있는 첫 행, 없으면 첫 행. 그 뒤에 `| --- |`를 넣는다.
- 셀 안 `|` → `\|`.
- 셀 안 `<br>`·`<p>` 등 → 공백 하나(`<br>`를 남기지 않는다).
- colspan → 뒤에 빈 셀을 붙인다. **rowspan → 아래 행의 그 열을 빈 셀로 비운다.** 행마다 셀 수가 다르면 가장 긴 행에 맞춰 채운다.
- 셀 안 굵게·링크는 다른 곳과 같은 규칙이다.
- 앞뒤는 빈 줄로 구분한다. 중첩 표는 바깥 셀 안에서 글자로 펼친다.
- **구현**: 완성된 표는 자리 표시 토큰으로 바꿔 두었다가 마지막에 되돌린다. 그래서 뒤의 엔티티 디코드·공백 정규화가 이미 이스케이프된 셀 글자를 다시 건드리지 않는다(`&amp;lt;` 이중 디코드, `&#124;`가 이스케이프 뒤 `|`로 되살아나는 것 방지 — 테스트 있음).

**이스케이프하지 않는다** `[가정]`: 본문의 `*`·`_`·`#`는 그대로 둔다(테스트 있음). 예외는 표 셀의 `|` 하나다.

## 판정·자르기

- **`markdownTextLength`**(새 함수): `fetch_too_short`(200자)와 "JSON-LD 본문 vs 페이지 본문 중 긴 쪽", 사람인·잡코리아 프레임 채택 판정이 모두 이것으로 센다. 빼는 것:
  - 줄 첫머리 `#…`·`- `·`1. `
  - `**`, `_…_`
  - 표 문법(`|`·구분 줄)
  - **빈 줄**
  - 이스케이프한 `\|`는 내용 1자로 센다. `snake_case`의 `_`는 강조가 아니므로 센다.
- **빈 줄을 빼는 이유**: 마크다운은 블록마다 빈 줄을 넣어 옛 "블록당 한 줄" 텍스트보다 줄바꿈이 두 배다. 그대로 세면 서식만으로 200자를 넘을 수 있다. 남은 줄바꿈은 1자로 세어 **옛 판정과 같은 의미**를 유지했다.
- **50,000자 자르기**(`truncate`): 마크다운 문자열 길이 기준이다. **상한 안의 마지막 줄바꿈에서 자른다**(굵게 짝·표 행이 반쯤 잘리지 않게). 한 줄이 상한보다 길면 그대로 자르되, 짝이 안 맞는 끝 `**`는 버린다. 기존 6만 자 한 줄 테스트는 그대로 50,000자로 통과한다.

## 구현 중 고친 결함 (테스트가 드러냄)

1. **빈 `<li>`가 `-`만 있는 줄을 남겼다** → 글자 없는 항목은 내보내지 않는다.
2. **글자 없는 표(레이아웃용)가 `|  |`·`| --- |`를 남겼다** → 내보내지 않는다.
3. **블록 사이 빈 줄이 200자 판정에 들어갔다** → 위 "빈 줄을 빼는 이유".

## CF-A17 — 같은 문자열에서 해시가 맞는가

- 가져온 문자열은 **`normalizeJdRawText`의 고정점**이다. `htmlToMarkdown`이 줄 trim·LF를 이미 하고, 끝에 **NFC**를 더했다(NFD 한글을 내보내는 사이트 대비). 그래서 그 정규화를 다시 거쳐도 그대로다. `normalizeJdRawText`는 안쪽 공백·빈 줄을 줄이지 않으므로 마크다운 줄 구조를 깨지 않는다.
- 테스트(서버 경계, 두 겹): NFD 한글·CRLF·앞뒤 공백이 섞인 페이지를 가져온다. 단정:
  - `normalizeJdRawText(rawText) === rawText`이고 NFC다.
  - 그 문자열로 `createApplicationProject`를 부르면 `p_raw_text === rawText`, `p_raw_text_hash === sha256(normalizeJdRawText(rawText)) === sha256(rawText)`(미리 보기 `preview.ts`가 쓰는 값과 같다), `p_sentences`가 같은 분할이고 모든 문장의 `raw.slice(start, end) === text`다.
- 편집기가 고치기 전에는 다시 내보내지 않는다는 것은 UI 소스 기준이고 TipTap 왕복 테스트는 없다. 그 대신 서버 쪽은 두 경로가 같은 정규화를 거치고, 가져온 값이 이미 그 정규형이라 **화면 값 = 저장 값**이다.

## 그대로 둔 것

SSRF(DNS 해석 뒤 검사·홉마다 재검사·3회)·10초·2MB·로그 규칙(호스트·코드·바이트·시간만, 본문·URL 경로·쿼리 금지)은 바꾸지 않았다. 기존 로그 단정이 그대로 통과한다.

## `[가정]`

- 문법 문자는 이스케이프하지 않는다(표 셀 `|` 제외).
- 중첩 목록은 평평해진다.
- 표 머리 행은 `<th>` 있는 첫 행, 없으면 첫 행이다.
- rowspan은 아래 행의 그 열을 빈 셀로 비운다(계획서는 colspan만 적었다).
- `fetch_too_short`는 빈 줄을 세지 않고, 남은 줄바꿈은 1자로 센다.
- 한 줄이 50,000자를 넘으면 그 줄 안에서 자르고 짝 없는 `**`를 버린다.
- 표 셀 수는 최대 50 span으로 막았다(비정상 colspan 값 방어).

---

## 핫픽스 병합 뒤 (2026-11-12, 라운드 2)

### 병합
- 이 브랜치(`df106bc`) 위에 핫픽스 `claude/hotfix-jd-fetch-redos`(`8984472`)를 **merge**했다(rebase 아님, 핫픽스 커밋 해시 유지).
- 충돌은 `fetch.ts` 한 곳이었다. 결과는 **핫픽스의 선형 스캐너 위에 R16 마크다운 변환**이다.
  - 핫픽스의 `htmlToText`·R15용 `BLOCK_TAGS`·`CELL_TAGS`는 버렸다. R16에서는 `htmlToMarkdown`이 대신한다.
  - `stripDroppedElements`·`stripBoilerplateBlocks`·JSON-LD·iframe·NUL 제거는 핫픽스 판을 그대로 쓴다.
- 핫픽스의 R15 참조 구현(`__tests__/fetch.r15-reference.ts`)은 이 브랜치에서 지웠다. 대신 **R16 참조 구현** `__tests__/fetch.r16-reference.ts`를 두었다. `df106bc`의 `fetch.ts`를 그대로 복사했고, 바꾼 것은 `../ssrf` 경로와 머리 주석뿐이다. 테스트 전용이다.

### QA-R16-01 [Critical] — 마크다운 변환 정규식 → 선형 스캐너
`html-scan.ts`에 R16용 스캐너를 더했다. 원리는 핫픽스와 같다. 매치 의미를 정규식과 똑같이 재현해 **정상 출력이 바이트 단위로 같고**, 시간은 O(n log n) 이하다.
- 후보 시작 위치: 리터럴 정규식(`<b`, `</h2` 등 — 이 정규식 자체는 선형이다)을 `test`·`lastIndex`로 훑는다. 매치마다 할당이 없고, 원래와 같은 `/i` 접기를 쓴다.
- 여는 태그의 끝: 이름 뒤 첫 `>`다. `indexOf` 결과를 캐시하고, 후보가 오른쪽으로만 가므로 전체가 상각 선형이다.
- 게으른 본문의 끝: 같은 이름의 닫는 태그 중 그 뒤 첫 번째를 이분 탐색으로 찾는다.

| R16 정규식 | 대체 |
|------|------|
| 굵게 `/<(strong\|b)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi`, 기울임 `em\|i` | `replacePairedElements(…, "attrs", false)` |
| 제목 `/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi` | `replacePairedElements(h1…h6, "boundary", false)` |
| 목록 `/<(ul\|ol)\b[^>]*>((?:(?!<(?:ul\|ol)\b)[\s\S])*?)<\/\1\s*>/gi`(50회) | `replacePairedElements(…, "boundary", true)` |
| 표 `/<table\b[^>]*>((?:(?!<table\b)[\s\S])*?)<\/table\s*>/gi`(50회) | 같음 |
| 표 행 `<tr\b[^>]*>([\s\S]*?)(?=<tr\b\|<\/table\|$)`, 셀 `<(td\|th)\b([^>]*)>…(?=<(?:td\|th)\b\|<\/tr\s*>\|$)` | `tableRows` · `tableCells` |
| 목록 항목 `split(/<li\b[^>]*>/i)` | `splitAtOpenTags` |
| `<img\b[^>]*>` · R16 `BLOCK_TAGS` · `<\/?(li\|tr\|td\|th\|table\|ul\|ol)\b[^>]*>` · 항목 안 `<\/?(p\|div\|span\|section)\b[^>]*>` · 고아 `<li\b[^>]*>` | `replaceNamedTags`(핫픽스) |
| `stripTags` `<[^>]*>` · 주석 | `replaceAnyTag` · `replaceComments`(핫픽스) |
| 강조 안쪽 `/\s*$/` — **새로 찾은 O(k²)**: `<b>a` + 공백 100만 + `b</b>` | `trailingSpaceLength`(`/^\s*/`도 `leadingSpaceLength`로) |
| `markdownTextLength`의 `/\s*\|\s*/g` — **새로 찾은 O(k²)**: `|` 없는 긴 공백 줄 | `collapsePipes` |

다시 본 뒤 그대로 둔 정규식은 모두 측정에서 선형으로 나왔다(100k에서 1 ms 미만).
- 대상: `<br\s*\/?>` · `<\/li\s*>` · `<\/(td\|th)\s*>` · `colspan\s*=…` · `BLOCKISH_INSIDE` · `decodeEntities` · `normalizeText` · 표 토큰 · `markdownTextLength`의 구분 줄 / `^#…` / `^(?:[-*+]\|\d+\.)` / `\*\*` / `_…_` · `truncate`의 `\*\*`.
- `\s*$`류 꼬리 정규식이 일반 문자열에 걸린 곳은 위 두 곳뿐이었다.
- `markdownTextLength`의 `\s*\|\s*`는 지금 `htmlToMarkdown` 출력에 한 줄 긴 공백이 없어서(`normalizeText`가 줄인다) 실제로는 닿지 않는다. 그래도 내보낸 함수라 고쳤다.

### QA-R16-03 [Major] — `truncate`
- 상한 안의 마지막 줄바꿈이 **상한의 90%(45,000) 이상**일 때만 거기서 자른다. 아니면 상한에서 바로 자른다.
- 반쯤 잘린 `**` 처리는 유지하되 두 가지를 바꿨다.
  - **잘린 줄 안에서만** 센다. 앞 줄의 홀수 `**` 때문에 멀리 되돌아가지 않게 하려는 것이다.
  - **표식 하나만** 지운다. 그 뒤 글자는 남긴다. R16은 그 `**`부터 끝까지 버렸는데, 그러면 `**`로 시작하는 6만 자 굵은 문단이 통째로 사라진다. `[가정]`
- 기존 truncate 테스트 3건은 그대로 통과한다. 새 테스트 5건을 더했다(`fetch.markdown.test.ts`).
  - 짧은 제목 + 6만 자 문단 → 50,000자
  - 300자 소개 + 6만 자 → 50,000자
  - 90% 경계 앞뒤
  - `**` 표식만 지움
  - 전체 경로: `fetch_too_short`가 아니다

### QA-R16-05 [Minor]
- `Math.max(...grid.map(…))`를 `grid.reduce(…)`로 바꿨다.
- 약 28만 행 표(2 MB)가 이제 변환된다(테스트 있음).

### QA-R16-04 (NUL)
- 핫픽스의 NUL 제거가 `htmlToMarkdown` 첫 단계에 있다.
- 날것 NUL로 쓴 표 토큰 `\0TABLE0\0`를 심어도 진짜 표가 한 번만 나온다(테스트 있음).

### 테스트 (`fetch.redos.test.ts`, 64 → 125건)
- **동일성 비교는 R16 출력 정의 기준으로 바꿨다.**
  - 스캐너마다 원래 R16 정규식과 차분 퍼즈한다(콜백 인자까지 비교).
  - 전체 경로(`htmlToMarkdown`·`markdownTextLength`·`extractJobPosting`·`bodyFrameUrl`)를 R16 참조 구현과 코퍼스·퍼즈로 바이트 비교한다.
  - 코퍼스에 표(colspan/rowspan/중첩/빈 표)·중첩 목록·강조·제목·대문자·본문 속 마크다운 문자를 더했다.
  - 퍼즈 토큰에 `b`·`strong`·`em`·`i`·`h1~6`·`img`·`colspan`·`|`·`*`·`_`·`#` 등을 더했다.
- **시간 사다리는 그대로 두고 공격을 15 → 38종으로 늘렸다.**
  - 새 공격: 닫히지 않은 `<b>`·`<strong>`·`<i>`·`<em>x`·`<b `, `<h1>`·`<h1>x`·`<h1>x</h2>`, 강조 안 긴 공백, `<ul><li>` 반복, `<ul `, 목록 안 `<li `·`<p `, 닫힌 목록 깊은 중첩, 닫히지 않은 표 중첩, `<table `, 표 안 `<tr `·`<td `, 닫힌 표 깊은 중첩, `<td>` 수십만 개, 행 28만 개, 큰 colspan, `|   ` 반복.
  - 각 공격이 3,000자에서 R16과 같은 출력을 내는지도 단정한다.
  - 전체 경로 2 MB도 두 가지를 잰다: `<` 반복 → `fetch_too_short`, 닫히지 않은 `<b>` 반복 → 정상. 둘 다 1초 미만이어야 한다.
- 기존 `fetch.markdown.test.ts` 23건, `fetch.test.ts` 54건, 분할기(`jd.test.ts`)와 AI-01은 그대로 통과한다. 분할기 `jd.ts`는 건드리지 않았다.

### 측정 (QA 도구 `qa-redos.harness.test.ts` + `qa-redos-driver.mjs`)
- 방식: 사례마다 별도 프로세스를 띄우고, 15초가 지나면 밖에서 강제 종료한다. 입력은 1,990,000자(2 MB 바로 아래)다.
- 범위: QA 보고서의 HTML 사례 34종 전부를 `md`(변환)와 `pipeline`(전체 가져오기 경로) 두 가지로 쟀다. 마크다운 사례 11종은 `mdlen`·`truncate`로, JSON-LD·iframe 3종은 `ldjson`·`frame`으로 쟀다.
- **강제 종료 0건.** 수정 전에는 QA-R16-01 7건이 20초에 강제 종료됐다.

| 대상 | 최악 | 사례 |
|------|------|------|
| `htmlToMarkdown` | 419 ms | `tr_only`(행 28만 개) |
| 전체 경로 `fetchJobDescription` | **597 ms** | `tr_only` |
| `markdownTextLength` | 171 ms | |
| `truncate` | 1 ms | |
| JSON-LD | 28 ms | |
| iframe | 36 ms | |

- 사례별 경로 전체 시간: 닫히지 않은 `<b>` 289 ms, `<h1>` 334 ms, `<ul><li>x` 429 ms, `<td>` 수십만 개 503 ms, 실제 모양 페이지 650 KB 161 ms.
- 표 경로는 처음에 867 ms였다. 줄인 방법은 두 가지다. 출력에는 영향이 없다.
  - 리터럴 정규식을 캐시한다. 셀마다 새로 만들고 있었다.
  - 태그가 없는 셀 문자열은 바로 돌려준다.
- 변이 검사 6종을 모두 잡았다.
  - 템퍼드 차단 제거
  - 닫는 태그 `\s*` 제거
  - `attrs` 규칙을 ASCII 공백만으로 축소
  - `collapsePipes` 앞 공백 무시
  - 꼬리 공백을 ASCII로만 셈
  - split이 겹치는 매치를 허용
- 각 변이 뒤 `cmp`로 원본 복원을 확인했다.

### 확인
- `pnpm typecheck` 통과, `pnpm lint` 0건, `pnpm test` 160 파일 2,720건 통과.
- 2,720건에는 2 MB 시간 단정이 들어 있다. 병렬 실행 부하에서도 통과했다.
