# 핫픽스 QA-R16-02 — api-engineer 노트 (2026-11-12)

브랜치 `claude/hotfix-jd-fetch-redos`, 기준 main `e9ea714`(= 운영 R15 코드). DB 변경 없음. 마크다운 기능 없음.

## 바뀐 파일
| 파일 | 내용 |
|------|------|
| `src/server/services/job-description/html-scan.ts` (신규) | 순수 함수. R15 정규식과 **같은 결과**를 내는 선형 스캐너 |
| `src/server/services/job-description/fetch.ts` | 정규식 호출을 스캐너로 교체, NUL 제거 |
| `src/server/services/job-description/fetch.redos.test.ts` (신규) | 차분 퍼즈·코퍼스·시간 사다리 테스트 64건 |
| `src/server/services/job-description/fetch.r15-reference.ts` (신규, 테스트 전용) | R15 `fetch.ts`를 그대로 복사(머리 주석 6줄만 추가). 앱 코드에서 import 금지, 큰 입력 금지 |
| `src/server/services/job-description/fetch.test.ts` | **수정 안 함** (54건 그대로 통과) |

손대지 않은 것: SSRF 검사, 10초 deadline, 2 MB 상한, 리다이렉트 재검사, 로그 규칙, 요청 한도, `<meta charset>` 정규식.

## 접근 — 계획의 `[^>]*` → `[^<>]*` 대신 "같은 의미의 선형 스캐너"
- `[^<>]*`로 바꾸면 속성값 안에 `<`가 든 태그(`title="a<b"`, `data-x="<b>"`)의 처리 결과가 달라진다. 실제 공고 페이지에 있을 수 있는 형태라 "정상 출력 무변경"을 보장할 수 없다.
- 그래서 정규식의 의미(전역 매치 위치, 탐욕/게으른 선택, `\b`, `\s`, 비유니코드 `/i`)를 그대로 재현하는 스캐너를 썼다. 동일성은 R15 정규식·R15 참조 구현과의 차분 퍼즈로 증명한다.
- 선형이 되는 핵심 관찰
  - `<[^>]*>` 류: 닫히지 않은 `<` 뒤에 `>`가 더 없으면 그 뒤로는 어떤 매치도 없다 → 즉시 중단. 매치는 `>` 바로 뒤 위치를 가로지를 수 없다.
  - 탐욕 `[^>]*` + 속성 패턴(O(n³) 두 곳): 각 `>` 위치까지 "유효한 마지막 속성 시작 k" 접두 표를 한 번 만들어 탐욕 선택을 O(1)로 찾는다(`nextGt`/`nextNonSpace`/`nextQuote` 배열).
  - 게으른 `[\s\S]*?` 다음 닫는 문자열: `indexOf`, 없으면 중단.
  - 보일러플레이트 블록의 짝 닫는 태그(`findCloseTag` 깊이 세기): 누적합 + 단조 스택 "다음 더 낮은 깊이" + 이분 탐색으로 질의당 O(log n).

## 정규식 → 스캐너 대응
| R15 정규식 (fetch.ts) | 이전 증가 | 대체 |
|------|------|------|
| `<[^>]*>` (남은 태그) | O(n²) | `replaceAnyTag` |
| `<!--[\s\S]*?-->` | O(n²) | `replaceComments` |
| `<\/?(BLOCK_TAGS)\b[^>]*>` gi, `<\/?(td\|th)\b[^>]*>` gi | O(n²) | `replaceNamedTags` (`BLOCK_TAGS`는 이제 이름 Set, h1–h6 나열) |
| `<tag\b[^>]*>[\s\S]*?<\/tag\s*>` gi + 남은 `<tag…>` (script/style/noscript/svg/img…) | O(n²) | `removeElements` + `replaceNamedTags` |
| `<(div\|section\|ul\|ol\|dl\|table)\b[^>]*(?:class\|id)\s*=\s*["']([^"']*)["'][^>]*>` gi | **O(n³)** | `boilerplateOpenTags` |
| `findCloseTag` 내부 반복 정규식 | O(n²) | `closeTagFinder` |
| `<(?:iframe\|frame)\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>` gi | **O(n³)** | `frameSrcValues` |
| JSON-LD `<script …ld+json…>([\s\S]*?)</script>` | O(n²) | `ldJsonBodies` |
| `^\s*(?:\/\/)?\s*<!\[CDATA\[` | O(k²) | `stripCdataOpen` |
| `<meta … charset …>` | — | **그대로 둠**: 앞 2048바이트에만 적용, 최악 측정 ≤2 ms |

`stripDroppedElements`에 태그별 사전 검사(`lower.includes("<"+tag)`)를 넣었다. 출력은 같고(해당 태그가 없으면 두 단계 모두 무변경) `<`만 2 MB인 입력에서 595–750 ms → 약 310 ms로 줄었다.

## 의도된 출력 변화 — NUL 하나뿐
- `htmlToText` 첫 단계와 JSON-LD 문자열 값(`asText`)에서 `\u0000`을 제거한다.
- R15에서는 NUL이 `rawText`까지 통과해 Postgres가 `null character not permitted`로 거부했다 → 생성·미리 보기 실패. NUL이 없는 입력의 출력은 바이트 단위로 같다(테스트: `htmlToText(s) === r15.htmlToText(stripNul(s))`).

## 측정 (QA 방식: 케이스당 별도 프로세스, 밖에서 SIGKILL)
- 수정 전(QA 측정, R15): `lt_only`, `div_open_noclose`, `div_class_noclose`, `comment_unclosed`, `img_unclosed`, `ldjson_unclosed`, `script_attr_noclose`, `iframe_unclosed` 모두 15초에 강제 종료.
- 수정 후 2 MB: 파이프라인 전체 최악 약 311 ms(`lt_only`), JSON-LD·iframe 계열 21–27 ms.
- 규모 확장(`lt_only`): 250K 73 ms / 500K 105 ms / 1M 178 ms / 2M 310 ms / 4M 590 ms — 선형.

## 테스트 설계 (`fetch.redos.test.ts`, 64건, 약 4.5초)
1. **스캐너별 차분 퍼즈**: mulberry32 고정 시드(1–10), 각 스캐너 결과를 원래 정규식과 비교(위치·끝·이름·캡처까지). 토큰에 대소문자 변형, 속성값 안 `<`/`>`, 닫히지 않은 태그·주석, 단어 문자가 붙은 속성명(`xsrc`, `_src`, `myclass`, `xtype`)을 넣었다.
2. **코퍼스 바이트 동일성**: `htmlToText`/`extractJobPosting`/`bodyFrameUrl`를 R15 참조 구현과 비교 — 평문, 머리/꼬리 메뉴, 중첩·미닫힘 보일러플레이트, JSON-LD(단일·배열·@graph·CDATA), 사람인·잡코리아 랜딩, 표, 주석·엔티티, 대문자, 큰 실제형 페이지.
3. **종단 퍼즈**: 무작위 HTML에서 세 함수 모두 R15와 동일.
4. **NUL**: 본문·JSON-LD 제목/회사명에서 제거, 경로 전체에서 `rawText`에 NUL 없음.
5. **시간 사다리**: 공격 입력 15종을 8K→32K→128K(각 250 ms 미만)로 키운 뒤 2 MB(1초 미만). 회귀가 생기면 작은 단계에서 먼저 실패해 테스트 러너가 멈추지 않는다. 라우트 전체 2 MB(`<html><body>` 감싼 입력 → `fetch_too_short`)도 1초 미만.

## 변이 검사 (테스트가 실제로 잡는지)
| 변이 | 결과 |
|------|------|
| `findCloseElement`에서 `\s*` 건너뛰기 제거 | 잡힘 (`removeElements`, `ldJsonBodies` 실패) |
| `src` 앞 `\b` 검사 제거 | 처음엔 **안 잡힘** → 퍼즈 토큰에 `xsrc`·`_src` 등 추가 → 잡힘 (`frameSrcValues`, `bodyFrameUrl` 실패) |
| 탐욕 선택을 "첫 유효 k"로 바꿈 | 잡힘 (`boilerplateOpenTags` 실패) |
변이 후 `html-scan.ts`는 원본과 `cmp`로 일치를 확인하고 되돌렸다.

## 확인
- `pnpm typecheck` 통과, `pnpm lint` 경고·오류 0, `pnpm test` 159 파일 2614건 통과.

## [가정]
- R15 참조 파일은 동일성 증명용으로 저장소에 남긴다(테스트 전용). R16 재기반 때 R16 쪽은 마크다운 출력이 다르므로 참조 비교 대상을 R16 정의에 맞게 바꿔야 한다.
- R16 브랜치는 이 핫픽스 위로 다시 맞추며, R16의 `htmlToMarkdown`에 남은 정규식(QA-R16-01 등)은 그쪽에서 같은 스캐너로 옮긴다.
