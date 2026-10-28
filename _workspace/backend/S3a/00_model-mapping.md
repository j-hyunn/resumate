# S3a 모델 매핑안 (결정 B-3)

- 조사일: 2026-10-28. 공급자 공식 페이지에서 확인했다.
  - OpenAI: developers.openai.com/api/docs/pricing, /models
  - Gemini: ai.google.dev/gemini-api/docs/pricing (2026-10-27 갱신), /models, /rate-limits
  - Claude: platform.claude.com/docs/en/about-claude/pricing
- 기준: AI 명세 C-10.1. 등급별 용도는 다음과 같다.
  - 경량: 짧은 추출·분류·정렬(AI-01, AI-11, AI-08, AI-12 정리)
  - 기본: 인사이트·서류·면접·대화 응답
  - 고성능: MVP에서 배정하지 않는다. 평가 미달 기능만 승급할 때 쓴다.
- 조건: Gemini 경량·기본은 **무료 등급에서 쓸 수 있는 모델**이어야 한다(F-AI-05 기본 추천 경로).

## 1. 매핑안

| 등급 | OpenAI | Google Gemini | Anthropic Claude |
|------|--------|---------------|------------------|
| 경량 `light` | `gpt-6-luna` | `gemini-3.5-flash-lite` (무료 등급 있음, stable) | `claude-haiku-5-5` |
| 기본 `default` | `gpt-6.1-terra` | `gemini-3.8-flash` (무료 등급 있음, stable) | `claude-sonnet-5-5` |
| 고성능 `heavy` | `gpt-6.1-sol` | `gemini-4-argon` (stable, **무료 등급 없음**) | `claude-opus-5-5` |

### 선택 이유
- **OpenAI 기본 = `gpt-6.1-terra`**
  - 공식 설명이 "빠르고 효율적, 자연스러운 글쓰기"라서 자소서·경력기술서·대화 응답에 맞다.
  - 가격이 Claude Sonnet의 절반이다.
  - 평가 세트에서 미달하는 기능만 `gpt-6.1-sol`로 승급한다(C-10.1 규칙). OpenAI가 "균형"으로 권하는 모델이 sol이라 처음부터 sol을 기본으로 둘 수도 있다(비용 2배).
- **OpenAI 경량 = `gpt-6-luna`**: 공식 페이지가 저비용·대량 작업용으로 권하는 모델이다.
- **OpenAI 고성능 = `gpt-6.1-sol`**: 최상위 `gpt-6-astra`($10/$50)는 MVP에 과하다. sol은 astra에 가까운 성능을 더 낮은 가격에 낸다.
- **Gemini 고성능 = `gemini-4-argon`**
  - stable 플래그십 추론 모델이다.
  - `gemini-3.1-pro-preview`는 preview라 제외했다.
  - 무료 등급이 없어서, 무료 사용자의 기능을 고성능으로 승급하면 그 사용자는 "모델 불가"(F-AI-08 (5)) 안내를 받는다. 따라서 Gemini에서 기능을 승급해야 할 때는 고성능 승급보다 프롬프트 조정을 먼저 시도한다.
- **Claude**: 명세에 이미 있는 ID 그대로다.

## 2. 가격표 첫 버전 초안 (USD / 100만 토큰, 표준 처리)

| 공급자 | 모델 | 입력 | 캐시 읽기 | 캐시 쓰기 | 출력 | 장문 구간 |
|--------|------|------|-----------|-----------|------|-----------|
| openai | `gpt-6-luna` | 0.10 | 0.01 | — | 0.50 | >272K: 0.20 / 0.02 / 0.75 |
| openai | `gpt-6.1-terra` | 1.00 | 0.05 | — | 5.00 | >272K: 2.00 / 0.10 / 7.50 |
| openai | `gpt-6.1-sol` | 2.00 | 0.10 | — | 10.00 | >272K: 4.00 / 0.20 / 15.00 |
| gemini | `gemini-3.5-flash-lite` | 0.30 | 0.03 | — | 2.50 | 없음 |
| gemini | `gemini-3.8-flash` | 0.75 | 0.075 | — | 3.75 | 없음 |
| gemini | `gemini-4-argon` | 2.00 | 0.10 | — | 10.00 | 없음 |
| anthropic | `claude-haiku-5-5` | 0.10 | 0.01 | 0.125 | 0.50 | >100K: 0.50 / 0.05 / 0.625 / 2.50 |
| anthropic | `claude-sonnet-5-5` | 2.00 | 0.10 | 2.50 | 10.00 | 없음 |
| anthropic | `claude-opus-5-5` | 4.00 | 0.20 | 5.00 | 20.00 | 없음 |

- 캐시 쓰기는 Claude 5분 캐시 단가다. Gemini 명시적 캐시 저장료는 MVP에서 쓰지 않는다(C-10.3).
- 무료 등급 호출도 위 유료 단가로 환산한다(C-13).
- 출력에는 사고 토큰이 포함된다.

### 예정된 가격 변경 → 가격표 버전을 미리 나눠 넣는다
| 버전 (`effective_from`) | 바뀌는 행 |
|--------------------------|-----------|
| `v2026-10-28` | 위 표 전체 |
| `v2026-12-01` | `gemini-4-argon` 입력 4.00 / 캐시 읽기 0.20 / 출력 20.00 |
| `v2027-01-01` | `gemini-3.8-flash` 입력 1.50 / 캐시 읽기 0.15 / 출력 7.50 |

- OpenAI `gpt-5.6-sol`에 프로모션 가격이 있지만 매핑에 쓰지 않아 영향이 없다.

## 3. 명세와 달라지는 점 (spec-gaps에 기록)
- **Claude 캐시 읽기 단가**
  - 명세 C-13 초안은 Sonnet 0.20, Haiku는 단가 없음이었다.
  - 공식 페이지 기준으로는 Sonnet 0.10(입력의 0.05배), Haiku 0.01, Opus 0.20이다.
- **Haiku 5.5 장문 구간**: 프롬프트가 10만 토큰을 넘으면 단가가 5배다. 경력 팩(3천~1만 8천 토큰)으로는 닿지 않지만, 가격표에 구간을 넣는다.
- **Gemini 무료 등급 한도**: 모델별 분당·일일 요청 수가 공식 페이지에 공개되지 않고 AI Studio에서만 보인다.
  - 그래서 호출 간격 6초 `[가정]`(C-12)을 유지하고, 상수로 둔다.
  - 일일 한도는 태평양 시간 자정에 초기화된다. 공식 페이지에서 확인했고 명세 C-11.2와 같다.

## 4. 구현 전에 확인할 것
- OpenAI GPT-6 계열의 Responses API 구조화 출력(strict json_schema)과 스트리밍 사용량 보고 방식. 모델 페이지에는 적혀 있지 않아, 어댑터를 구현할 때 API 문서로 확인한다.
- Gemini `gemini-3.8-flash` / `gemini-3.5-flash-lite`의 `responseSchema` 지원 범위와 사고 토큰 보고 필드(`usageMetadata`).
- 가격은 위 페이지들을 요약해 옮긴 값이다. 가격표 마이그레이션에 넣기 전에 원문 페이지와 한 번 더 대조한다.
