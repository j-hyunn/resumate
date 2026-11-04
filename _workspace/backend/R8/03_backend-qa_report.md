# R8 백엔드 QA 리포트 (라운드 1)

- 날짜: 2026-11-04 · 대상: R8 미커밋 작업 트리(R7 위). 계획서 `01_plan.md`, 노트 `02_db-engineer_notes.md`·`02_ai-pipeline-engineer_notes.md`·`02_frontend-engineer_notes.md`, spec-gaps R8-AI-1~3, 명세 AI v4.9·DM v4.9·UX v5.11·PRD v4.11·decisions 3.16
- 코드·문서·마이그레이션은 고치지 않았다. 민감정보·V-9e 탐침은 `src/server/ai/validation/__qa_tmp__/`에 임시 테스트로 돌린 뒤 지웠다. RPC 탐침은 로컬 DB에서 `begin … rollback`으로 돌렸다.

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck | 통과 | `run-checks.sh --build` |
| lint | 통과 | |
| vitest | 통과 | 130 files / 2,091 tests |
| build (`pnpm build`) | 통과 | |
| pgTAP | 통과 | 56 files / 2,708 tests, 로컬 DB에 `20261113000300` 적용 확인(`wc_patch_star` 본문에 R8 분기 있음) |
| 로컬 통합(실제 DB·RPC) | 통과 | `writing-chat.integration.test.ts`·`deliverable-chat.integration.test.ts` 12 tests (로컬 스택, 가짜 공급자) — 턴 1회 + AI 패치 RPC 적용 + 카드 편집·반영 저장 경로 |
| 로컬 스모크(HTTP, `pnpm dev`) | SKIP | R8은 요청·잡 경로·deps 팩토리를 바꾸지 않음(프롬프트·검증기·RPC 본문·화면 함수만). 실제 공급자 키가 없어 합친 제안의 모델 품질은 확인 불가 — 위 통합 테스트로 실제 RPC 경로를 대신 확인 |

## 경계면 검사
| # | 경계 | 결과 | 이슈 |
|---|------|------|------|
| Q1 | DM ↔ 마이그레이션 | 이슈(명세) | R8-QA-3 (사용자 편집 op 예외가 DM에 없음) |
| Q2 | 마이그레이션 ↔ 타입 ↔ 쿼리 | 통과 | 시그니처 변경 없음, 타입 재생성 불필요 |
| Q3 | RPC ↔ 호출부 | **이슈** | QA-01 (append가 합친 set 위에 오면 op가 append로 바뀜) |
| Q4 | RPC 오류 코드 ↔ 매핑 | 통과 | 새 코드 없음 |
| Q5 | 계약 ↔ 화면 | 이슈(Minor) | QA-05 |
| Q6 | SSE | 해당 없음 | 변경 없음 |
| Q7 | AI 출력 ↔ 저장 | 통과 | V-9가 보낸 출처(이월 포함)를 RPC가 그대로 저장(`wc_sources`·`wc_quotes`, 20개 상한은 `toDraftPatch`에서 자름 — QA-06) |
| Q8 | enum DB ↔ TS | 통과 | `op` enum `set`/`append` 그대로 |
| Q9 | 잡 종료·사용량 | 해당 없음 | 변경 없음 |
| Q10 | 보안·로그 | 통과 | V9Report 새 키 `merged`·`preservation_review`는 숫자만 로그 |
| Q11 | UI ↔ 백엔드 | 이슈 | QA-01(화면 중복), QA-05 |
| Q12 | 실제 의존성 연결 | 통과 | deps 팩토리 변경 없음, 통합 테스트 통과 |
| Q13 | 출시 준비 | 통과 | `20261113000300` > `20261113000200`(최신), 비파괴, 새 환경 변수 없음. UI와 같은 머지 + db push 먼저(계획서 그대로) |
| V-규칙 | V-9h·V-9j·V-9c~e·V-9g·V-10e·V-10f 테스트 | 이슈 | QA-02·QA-03·QA-04 |

### 점검 1 — op 계약 끝에서 끝까지
- AI-12 extract v6: "항상 op set, append 금지"(`prompts/AI-12/index.ts:81`). 그러나 출력 스키마는 여전히 `append` 허용(`schemas/AI-12.ts:38` `z.enum(STAR_OPS)`) → V-9 호환 경로(`v9.ts:635~648`)로 들어감.
- V-9 → `toDraftPatch`(`schemas/structured-draft.ts:191~220`) → RPC: 합친 `set`은 op `set`으로 저장(`20261113000300…sql:146`), 미반영 제안은 교체. 합친 set의 출처 이월(R8-AI-3, `v9.ts:676~686`)은 RPC가 V-9가 보낸 그대로 저장함을 확인 — RPC 자체는 합치지 않는다(pgTAP `r8_star_merged_proposal.test.sql` "replacement keeps only the new sources"와 일치). `source_message_ids`·`source_quotes` 20개 초과분은 `clampSources`가 새 출처 먼저 남기고 자름.
- 화면 `planFill`(`star-proposal-fill.ts:124~125`): `set` = 교체(prev 보관), `append` = 이어 붙임. 카드 `mergedMode`(`star-proposal-card.tsx:336`).
- 사용자 편집: 미반영 `set` 제안 편집은 op `set` 유지(`…sql:210`) → 화면 교체 → 중복 없음(db-engineer 예외 확인, pgTAP 있음).
- **중복 경로 1개 발견 — QA-01.**

### 점검 2 — V-9h/V-9j/V-9c~e
- V-9h: 값 있는 필드 `set` 허용, 기간 규칙 그대로. V-9c·d·e 출처 = 인용 + 기존 텍스트(`v9.ts:473~478`), `append`는 인용만(`v9.ts:722`). V-9j `preservesExisting`(`v9.ts:491`) 숫자·이름 역방향 검사 → `needs_review`. 무변경: 명세는 "같으면", 구현은 "일부이면"(R8-QA-2). 길이: 교체 값 ≤ 2,000(`v9.ts:658`), `mergedStarLength` set=제안 길이. 명세 AI-12 v4.9(03-ai-features.md:678·801·802)와 동작 일치(무변경 범위만 차이).

### 점검 3 — -음 체
- 프롬프트: AI-12 extract(`:93`, 경계 사례 `:110` -음 체), AI-13 extract(`:72`), compose(`:232` 제목 제외·code 블록 제외) 확인. 값 예시에 "~했다" 없음.
- `KOREAN_SUFFIXES`(`v9-lexicon.ts:84~140`): 하였음·했었음·되었음 → 했음·됐음·었음·였음·았음 → 함·됨·음·임 순서. 긴 항목이 자기를 끝으로 갖는 짧은 항목보다 앞 — 문제 없음. V-10e도 같은 `uncoveredRatio`를 씀(`v10.ts:197·371`).
- "-함/-됨/-음" ↔ "-했어요"는 0% 미확인(설계함·줄었음·개선됨·정리하였음·안정됨 모두 0.00). **ㅁ 명사형(만듦·맡음·높임·줄임·바꿈·이끎)은 못 맞춤 — QA-04.**

### 점검 4 — 민감정보 탐침 (`detectSensitive`)
요청 문장은 모두 기대대로:

| 기대 CLEAN | 결과 | 기대 FLAGGED | 결과 |
|---|---|---|---|
| 보안 진단을 받았음 / 외부 감사에서 진단을 받아 개선함 / 서비스 장애로 치료가 필요한 데이터를 복구함 / 고객이 병원에 입원했을 때 알림을 보냄 / 육아휴직 신청 기능을 만듦 / 교회 출석 관리 앱을 만듦 / 파업 공지 배너를 띄움 / 마케팅 팀장님과 협업함 / 연구원 분들과 실험함 | 전부 `[]` | 제가 우울증 진단을 받아 휴직함 / 우울증 진단을 받아 휴직함 / 김민수 팀장님과 진행함 / 010-1234-5678 | health / health / third_party_name / contact |

직함 추가 탐침 13개(성장팀 팀장님·전략기획 팀장님·운영지원 팀장님·데이터 분석가 선배·사업개발 매니저 …) 오탐 0, 실명(이지은 매니저님·박서준 선배) 걸림. 그 밖의 오탐·누락은 QA-02·QA-03.

### 점검 5 — 명세 ↔ 코드 (R8-AI-1~3)
명세 본문에 없음 → spec-gaps **R8-QA-1**(ai-feature-designer). 추가로 R8-QA-2(무변경 범위), R8-QA-3(사용자 편집 op 예외, DM), R8-QA-4(V-9j 안내 근거 필드)를 spec-gaps.md에 남겼다.

## 이슈

### QA-01 [Major] 합친 set 제안 위에 모델이 append를 내면 [반영] 때 기존 내용이 중복된다
- 담당: db-engineer (보조: ai-pipeline-engineer)
- 근거:
  - 스키마가 append 허용 `src/server/ai/schemas/AI-12.ts:38` → V-9 호환 경로가 받음 `src/server/ai/validation/v9.ts:635~648` (프롬프트 금지만으로는 막히지 않음 — 구버전·재시도·모델 불복종)
  - RPC `supabase/migrations/20261113000300_r8_star_merged_proposal.sql:146~157`: 미반영 `set`(합친 제안 P, 이미 폼 값 A를 담음) 위에 append X가 오면 값 `P\nX`로 이어 붙이고 op는 `v_filled → 'append'`로 바뀜
  - 화면 `src/components/career/star-proposal-fill.ts:125`: op append → `A\nP\nX` → A가 두 번 들어감
  - 로컬 탐침(rollback): action 컬럼 "캐시 규칙을 설계함" + AI set "캐시 규칙을 설계함. 빌드 캐시도 붙임" → op set. 이어서 AI append "빌드 캐시 적중률을 모니터링함" → `value = "캐시 규칙을 설계함. 빌드 캐시도 붙임\n빌드 캐시 적중률을 모니터링함"`, **op = append**. db-engineer 노트 "남겨 둔 호환 동작"도 같은 경로를 적었고, pgTAP에는 이 경우 테스트가 없음
- 수정 제안: RPC에서 미반영 객체 op가 `set`이면 append로 이어 붙여도 op `set` 유지(`v_star_op`에 `when v_kind = 'append' and v_live and not v_new_obj and v_cur ->> 'op' = 'set' and nullif(btrim(v_cur ->> 'value'), '') is not null then 'set'` 추가 — 이어 붙인 값은 P가 A를 담고 있으므로 교체가 맞음) + pgTAP. V-9 쪽에서도 값 있는 필드의 `append`를 같은 의미로 다루거나 거부하는 테스트 추가 권장.
- 상태: 열림

### QA-02 [Major] 민감정보 오탐 — 질환명·주어 없는 동사형이 들어간 업무 문장이 health/union/politics로 걸림
- 담당: ai-pipeline-engineer (기준은 ai-feature-designer, R8-AI-1)
- 근거: `src/server/ai/validation/v9-lexicon.ts:240`(DISEASES), `:258~269`(strong), `:326`(다른 사람 명사가 없으면 본인으로 봄). 탐침 오탐 19건:
  - 질환명 도메인: "암 진단 AI 모델을 개발함", "저는 암 진단 모델 서빙을 맡았음", "당뇨 치료 앱의 혈당 기록 기능을 개발함", "항암 치료 일정 관리 화면을 만듦", "ADHD 증상 자가진단 앱을 만듦", "번아웃 증상을 줄이는 사내 캠페인을 기획함", "우울증 치료 콘텐츠 추천 알고리즘을 설계함", "정신과 진료 예약 플랫폼을 개발함", "심리 상담을 받을 수 있는 챗봇을 만듦"
  - 주어 없는 동사형 도메인: "수술을 받는 날짜를 예약하는 기능을 만듦", "입원하고 퇴원하는 흐름을 자동화함", "임신 중 주의사항 콘텐츠를 제작함", "치료받을 수 있는 병원 검색 기능을 만듦", "휴직 중 급여 계산 로직을 구현함", "출산했을 때 받을 수 있는 지원금 안내 페이지를 만듦", "몸이 안 좋은 날 쓰는 재택 신청 기능을 만듦" (health), "노조에 가입한 인원 통계를 집계함" (union), "정당을 지지하는 비율을 시각화함" (politics)
- 영향: 그 값이 V-9g/V-10f로 버려지고 턴에 "기록하지 않을게요" 안내가 뜸(RQ-6 "도메인 단어만으로는 걸지 않는다" 위반). 특히 폼 값에 이런 문장이 있으면 그 필드의 합친 제안이 **매 턴 V-9g로 거부**된다(합친 값이 기존 문장을 다시 담으므로) — 헬스케어·HR 도메인 사용자는 그 항목을 AI로 보강할 수 없음.
- 수정 제안: 질환명 + 진단/치료/증상 조합을 strong에서 빼거나 "받(았|아)/앓/겪/때문에 휴직·퇴사" 같은 경험 동사로 좁히기; 관형형("받는", "받을 수 있는", "하는", "했을 때", "중 … 로직")·명사 수식 뒤 도메인 명사(앱·기능·모델·플랫폼·화면·페이지·로직)가 오면 제외. 위 19문장을 회귀 픽스처에 추가.
- 상태: 열림

### QA-03 [Major] 민감정보 누락 — -음 체 값의 신상 서술 대부분을 못 잡음
- 담당: ai-pipeline-engineer
- 근거: V-9g·V-10f는 이제 **값에만** 적용되고 값은 -음 체인데, strong 패턴은 "-했/-해서/-하고" 형태 위주(`v9-lexicon.ts:261~266`, `:282`, `:296~301`). 탐침 누락 13건: "입원함", "병가를 냄", "출산함", "임신함", "육아휴직을 함", "출산 휴가를 씀", "가족 간병으로 휴직함", "아버지 간병 때문에 휴직함", "번아웃으로 퇴사함", "노조 활동을 함", "선거 운동을 함", "교회에 다님", "제가 조합원임", "저는 천주교 신자임" (걸린 것: "우울증 진단을 받아 휴직함", "수술을 받아 3개월 쉬었음", "건강 문제로 퇴사함", "개인적으로 우울증 치료를 받음"). R4 단어 판정은 이들을 잡았으므로, 저장 경로의 보호는 R8에서 약해졌다.
- 수정 제안: strong 동사 꼬리에 -음 체(함·됨·음·냄·씀·다님·임 …)를 추가(`휴직(?:했|하고|…|함)`, `입원(?:…|함)`, `병가를?\s?(?:…|냄|씀)`, `노조\s?활동을?\s?(?:…|함)`, `(?:교회|성당|절)에?\s?다님`, weak의 `조합원(?:…|임)`·`신자(?:…|임)`) + 간병·가족 사유 휴직. 위 13문장을 양성 픽스처로.
- 상태: 열림

### QA-04 [Minor] V-9e/V-10e — ㅁ 명사형 -음 체 어미를 원문 동사와 맞추지 못함
- 담당: ai-pipeline-engineer
- 근거: `stripKoreanSuffix`(`v9.ts:338`)는 남는 줄기 ≥ 2자일 때만 자르고, `uncoveredRatio`(`v9.ts:397`)는 2자 토큰을 그대로 찾음. 탐침(값 ← 인용): "관리자 대시보드를 만듦" ← "…만들었어요" 0.33, "백엔드 API 개발을 맡음" 0.25, "전환율을 높임" 0.50, "처리 시간을 줄임" 0.33, "배포 파이프라인을 바꿈" 0.33, "프로젝트를 이끎" 0.50. 짧은 값은 임계 0.4를 넘겨 `needs_review`. "-함/-됨/-음(었음)" 형태는 0.00으로 문제 없음. V-10e에는 -음 체 블록 ↔ "-했어요" 인용 비율 테스트가 없음(공유 함수라 V-9e 테스트로만 간접 확인).
- 수정 제안: 마지막 음절이 받침 ㅁ인 2자 토큰은 받침을 뺀 어간(만들/맡/높이/줄이/바꾸/이끌)으로도 찾기, 또는 프롬프트 예시에 "만들었음"처럼 -었음 형을 권장. V-10e -음 체 테스트 1개 추가.
- 상태: 열림

### QA-05 [Minor] 카드 — V-9j 안내 없음, 비교 버튼 이름 차이
- 담당: frontend-engineer (V-9j 구분 근거는 spec-gaps R8-QA-4)
- 근거: UX v5.11 S-10(`docs/planning/02-user-flows.md:1422`)은 V-9j 섹션에 "기존 내용 일부가 빠졌을 수 있어요"와 **[기존 내용과 비교]**를 둠. 코드에는 해당 문구가 없고(`grep "빠졌을" src/` 0건), 버튼은 "기존 내용 보기"(`src/components/career/star-proposal-card.tsx:428`). `structured_draft`에 V-9e/V-9j 구분 값이 없어 화면이 구분할 수도 없음. 2,000자 문구(`tooLongCopy` set 분기)도 UX `:1446` 문구와 다름([UI-가정]으로 노트에 있음).
- 수정 제안: 버튼 이름을 명세대로 맞추고, R8-QA-4 결정 후 안내 문구 추가.
- 상태: 열림

### QA-06 [Minor] 주석이 실제 상한 처리 위치와 다름
- 담당: ai-pipeline-engineer
- 근거: `src/server/ai/validation/v9.ts:681` "the RPC keeps the first 20" — RPC `private.wc_sources`/`wc_quotes`(`20261030000400_s4_structured_draft_patch.sql:72~107`)는 20개를 넘으면 자르지 않고 null(= `invalid_source` 거부)을 낸다. 실제로 자르는 곳은 `toDraftPatch`의 `clampSources`(`src/server/ai/schemas/structured-draft.ts:191~197`)라 동작은 맞음. 이 자르기에 기대는 출처 이월(합친 set이 20개 넘는 경우) 테스트가 없음.
- 수정 제안: 주석 수정 + 출처 21개 이상 이월 시 RPC 거부가 없는 테스트 1개.
- 상태: 열림

## 참고 (이슈 아님)
- 빈 칸일 때 받은 `set` 제안을 반영하기 전에 사용자가 폼에 직접 쓰면, 그 제안(합치지 않은 값)이 "기존 내용과 합친 제안"으로 보이고 [반영]이 사용자가 쓴 글을 교체한다. 명세(AI v4.9 :810 `[가정]`, UX :1437·:1440)가 비교·되돌리기로 받아들인 동작이고, 다음 턴에 AI가 다시 합친다.
- 합친 제안을 [거절(비우기)]한 뒤 같은 칸을 직접 고치면 op는 컬럼 기준(`append`)으로 돌아간다(`…sql:210` 조건이 값 null이면 거짓). 사용자가 새로 쓴 글이 폼 뒤에 붙는 R5 동작과 같음.

## 스펙 차이 (spec-gaps.md로 넘긴 항목)
- R8-QA-1: R8-AI-1(주어 없는 동사형도 본인 서술), R8-AI-2(끝 글자 "원" 제외), R8-AI-3(합친 set 출처 이월)이 AI v4.9 본문(03-ai-features.md:380·381·866)에 없음 → ai-feature-designer
- R8-QA-2: 무변경 판정 "같으면"(명세 :801) vs 구현 "일부이면" → ai-feature-designer
- R8-QA-3: 사용자 편집 op 예외(`set` 유지)가 DM v4.9 2.5에 없음 → data-architect
- R8-QA-4: V-9j 안내를 위한 사유 필드 없음 → data-architect·ux-planner

---

# R8 백엔드 QA 리포트 (2라운드)

- 날짜: 2026-11-04 · 기준: 각 `02_*_notes.md` "QA 1라운드 수정", 리더 결정 R8-QA-4(`review_reason`), 명세 AI v4.9 C-7·V-9h/V-9j, DM v4.9, UX v5.11
- 이번에도 코드·문서·마이그레이션은 고치지 않았다. 탐침 테스트는 임시 파일로 돌린 뒤 지웠고, RPC 탐침은 `begin … rollback`으로 돌렸다. DB 리셋은 하지 않았다.

## 검사 실행 결과
| 검사 | 결과 | 비고 |
|------|------|------|
| typecheck / lint | 통과 | `run-checks.sh --build` |
| vitest | 통과 | 130 files / 2,174 tests |
| build | 통과 | |
| pgTAP | 통과 | 56 files / 2,731 tests — 전체 실행에서 실패 0 |
| pgTAP 4개 파일 단독 실행 | 통과 | `career_description`·`drafts`·`evidence_links`·`jd_extraction` 각각 `not ok` 0 |
| 로컬 DB 함수 = 파일 | 확인 | `pg_proc.prosrc`(wc_patch_star)와 `20261113000300` 본문이 같음(빈 줄 차이만) |
| 로컬 스모크(HTTP) | SKIP | 1라운드와 같은 사유(요청·잡 경로 변경 없음) |

### db-engineer가 보고한 pgTAP 4개 실패
- 지금은 재현되지 않는다. 현재 로컬 DB `evidence_links`가 0행이라(db-engineer가 본 것은 +4행) 남아 있던 행은 이미 없어진 것으로 보인다.
- 실패 원인이 행 수 때문이라는 설명은 맞다. 이 파일들은 사용자를 가리지 않고 전체 행 수를 단언한다. 예: `evidence_links.test.sql:90`(`source_deleted_at is null` 전체 = 9), `career_description.test.sql:135·243`, `drafts.test.sql:255`, `jd_extraction.test.sql:182~185`. 그래서 다른 로컬 데이터가 남아 있으면 깨진다.
- 네 파일 모두 `structured_draft`·`apply_structured_draft_patch`·`wc_patch_star`를 쓰지 않는다 → R8과 무관하다.
- (참고) 로컬 DB를 함께 쓰면 이런 깨짐이 또 생길 수 있다. 전체 행 수 단언을 테스트 사용자 기준으로 좁히는 일은 R8 범위 밖이라 이슈로 올리지 않았다.

## 1라운드 이슈 재확인
| 이슈 | 결과 | 근거 |
|------|------|------|
| QA-01 [Major] | **수정됨(확인)** | 이중 방어. (1) RPC: 미반영 객체 op가 `set`이면 append해도 op `set` 유지 — rollback 탐침에서 같은 순서(set → append)로 `op=set`, `value=P\nX` 확인. (2) V-9: 기존 텍스트가 있는 필드의 `append`를 `filledStarText + "\n" + 새 문장`인 `set`으로 바꿈(`v9.ts:695~706`) → AI 경로에서 RPC가 값 있는 필드의 append를 받지 않음. 화면 교체 결과 = P\nX(폼 A는 P 안에 한 번) |
| QA-02 [Major] 오탐 | **수정됨(확인)** | 1라운드 오탐 19건 + 점검 4의 CLEAN 9건 모두 `[]`. 새 업무 문장 24개 중 23개 `[]`(병가 승인 워크플로·휴직 신청서 결재·입원 수속 간소화·수술 대기 시간 20%·임신 주수 계산기·노조 협상 캘린더·교회 헌금 정산·선거 개표 그래픽·우울증 자가진단 설문·투병 수기 공모전·"서버 장애로 입원 예약이 막혀 복구함"·"제가 병원 EMR 연동을 맡았음"·가족관계 증명서·아이 돌봄 매칭·엄마 손 반찬·직함 문장 3개 등). 남은 1건은 QA-08 |
| QA-03 [Major] 누락 | **대부분 수정, 일부 남음 → QA-07** | 1라운드 누락 13건 모두 걸림(입원함·병가를 냄·출산함·임신함·육아휴직을 함·출산 휴가를 씀·간병 휴직·번아웃으로 퇴사함·노조 활동을 함·선거 운동을 함·교회에 다님·조합원임·신자임) |
| QA-04 [Minor] | **수정됨(확인)** | 만듦·맡음·높임·줄임·바꿈·이끎·모음·꾸림·고침·옮김·붙임 ↔ "-었어요" 모두 0.00. 다른 동사는 그대로 걸림("도입함" ← "만들었어요" 0.33, "높임" ← "늘렸어요" 1.00). V-10e -음 체 테스트 추가됨 |
| QA-05 [Minor] | **수정됨(확인)** | 토글 "기존 내용과 비교"(`star-proposal-card.tsx:430`), `review_reason === "existing_missing"`일 때 "기존 내용 일부가 빠졌을 수 있어요"(`:97·:398`), 2,000자 문구를 UX 문구로 맞춤 |
| QA-06 [Minor] | **수정됨(확인)** | 주석 수정(`v9.ts` "toDraftPatch keeps the first 20 (clampSources); the RPC rejects more"), 출처 21개 이월 테스트 추가 |

## `review_reason` 계약 (R8-QA-4) 끝에서 끝까지
| 단계 | 확인 |
|------|------|
| V-9 | V-9e → `content_unverified`(`v9.ts:505`), V-9j → `existing_missing`(`:732`, 둘 다 해당하면 V-9j 우선), 바꾼 append는 V-9j 생략, review ok면 null |
| `toDraftPatch` | `review = needs_review`이고 이유가 있을 때만 키를 넣음(`structured-draft.ts:235`). 기간 패치에는 넣지 않음 |
| RPC | 값이 두 가지 밖이거나 문자열이 아니면 `invalid_patch`(탐침 `'oops'` → `throws_ok` 통과). needs_review일 때만 저장(탐침: `existing_missing` 저장, review ok + 이유 → 키 없음). accept 하면 키 제거(탐침: `accepted`, 키 없음). append 땐 기존 이유 유지 |
| 읽기 | `StarFieldSchema.review_reason` enum, nullable·optional, 모르는 값은 `.catch`로 무시(`structured-draft.ts:79`). `parseStructuredDraft` → mapper → `normalizeProjectDraft`(객체를 펼쳐 키 보존) |
| 화면 타입 | `src/types/db.ts:558·561` `StarReviewReason = "existing_missing" \| "content_unverified"` — TS 상수 `STAR_REVIEW_REASONS`·RPC 목록과 같음 |
| 카드 | `existing_missing`일 때만 V-9j 문구. 그 밖(키 없음·null·`content_unverified`)은 기존 문구 |

## 민감정보 탐침 (2라운드)
- 1라운드 세트(CLEAN 30 + FLAGGED 24): **오탐 0, 누락 0**.
- 새 세트: 업무 문장 24개 → 오탐 1(QA-08). 본인 문장 14개 → 걸림 5(암 투병 후 복귀함, 매주 교회에 나감, 정연우 대리님, 이메일, "번아웃이 와서 3개월 쉼"), 누락 9(QA-07).

## 2라운드 새 이슈

### QA-07 [Major] -음 체 신상 서술 누락이 아직 남음 (QA-03 잔여)
- 담당: ai-pipeline-engineer
- 근거(`detectSensitive` → `[]`):
  - **표지가 있는데도 못 잡음**: "제가 육아휴직을 씀", "육아휴직을 씀", "아내 출산으로 육아휴직을 씀", "출산으로 육아휴직을 씀". "육아휴직을 함"과 "출산 휴가를 씀"은 걸리는데 "육아휴직을 씀"만 빠짐 → `육아\s?휴직` 쪽 서술어 목록에 씀/썼이 빠진 것으로 보임
  - 수술·질환 + 쉼: "허리 수술로 두 달 쉬었음"("디스크로 입원해서 쉬었음", "공황장애 때문에 쉬었음"은 걸림)
  - 업무 명사 창 때문에 빠짐: "디스크로 입원해서 일정이 밀렸음", "공황장애 때문에 프로젝트에서 빠짐"(연결형 뒤 두 단어 안에 일정·프로젝트)
  - 그 밖: "출산 후 복직함", "병가 중에도 리뷰를 함", "선거 캠프에서 일함"
  - 리더가 받아들인 가정: 관형형 "제가 입원했을 때 프로젝트가 밀렸음", 표지 없는 약형 "노조 위원장을 맡았음"
- 수정 제안: 육아휴직 서술어에 씀·썼·써서 추가(가장 시급). 1인칭·가족 표지가 있는 문장에서는 업무 명사 창 제외를 적용하지 않기. "수술로 … 쉬", "출산 후 복직", "병가 중"을 strong에 추가. 위 문장을 `PERSONAL_SENTENCES`에 넣기.
- 상태: 열림

### QA-08 [Minor] 직함 "프로" 오탐 — "○○○ 프로젝트"가 제3자 실명으로 걸림
- 담당: ai-pipeline-engineer
- 근거: "신사업 프로젝트에 참여함", "사이드 프로젝트로 진행함", "개인적으로 사이드 프로젝트로 진행함" → `third_party_name`. `THIRD_PARTY_NAME_PATTERN`(`v9-lexicon.ts` TITLES에 "프로")이 직함 뒤의 경계를 보지 않아 "사이드 프로|젝트"로 맞는다. R4부터 있던 규칙이지만 RQ-6의 직함 오탐 범위에 들어간다. "서비스·모바일 프로젝트"는 `NOT_A_NAME`이라 통과한다.
- 수정 제안: 직함 뒤에 한글이 오면 조사·님만 허용, 또는 "프로" 뒤에 젝트·세스·그램·모션·덕트·필이 오면 제외. 회귀 픽스처 추가.
- 상태: 열림

## 남은 항목
- 열림: QA-07(Major), QA-08(Minor). 리더 판단이 필요하다 — 2라운드 상한에 닿았으므로 미해결로 넘긴다.
- spec-gaps R8-QA-1~4: 명세 반영은 기획 쪽 확인 대상(코드와 리더 결정 `review_reason`은 일치함).

## 리더 후속 (2라운드 뒤, 2026-11-04)
- QA-08 수정: `TITLES`의 "프로" 뒤에 부정 전방탐색(젝트·그램·세스 …)을 넣음. "신사업 프로젝트", "사이드 프로젝트" 통과, "김민수 프로님" 계속 걸림.
- QA-07 일부 수정: `VERBISH_START`에 쓰다 활용(씀·썼·써·쓴·쓸) 추가. "제가 육아휴직을 씀", "아내 출산으로 육아휴직을 씀", "병가를 썼어요" 걸림.
- 픽스처 `sensitive-probes.ts`에 위 6문장 추가. vitest src/server/ai 1,125 통과, typecheck·lint 통과.
- QA-07 남은 누락(열린 Minor로 낮춤): "허리 수술로 두 달 쉬었음", "출산 후 복직함", "병가 중에도 리뷰를 함", "선거 캠프에서 일함", "디스크로 입원해서 일정이 밀렸음", "공황장애 때문에 프로젝트에서 빠짐". 정규식 보완은 오탐을 다시 늘릴 위험이 있어 이번 사이클에서 멈춤. 모델 `sensitive_flags`가 보조 안전망.
