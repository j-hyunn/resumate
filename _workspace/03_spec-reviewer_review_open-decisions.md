# Resumate 기획 정합성 리뷰 — 결정 사이클 open-decisions (라운드 1)

## 요약
- 검토 문서: PRD v4.13 · UX v5.13 · AI v4.11 · DM v4.11 (`git diff main -- docs/planning`, `(v{N}, OD-xx)` 표시 문장 중심), 결정 파일 `_workspace/00_input/planning-decisions-open-decisions.md`
- 범위: 이번 사이클이 건드린 경계만 (OD-I1·I2·I6, OD-P2·P5·P6·P10·P11, OD-C1·C2·C6, OD-L1·L2, 버전·변경 이력)
- 이슈: Critical 2 / Major 6 / Minor 7, 해결 0 / 미해결 15
- 새 `[결정 필요]`: 없음. 이미 열려 있는 1건(Anthropic 추론 지역 `global`)만 참조 — R-OD-6·R-OD-7은 그 결정에 묶인 문장 정리

## 경계별 결과
| 경계 | 결과 | 이슈 ID |
|------|------|---------|
| OD 행 ↔ "영향 문서" 반영 (권고와 다른 11행 포함) | 11행 모두 해당 문서에 사용자 선택대로 반영됨. decisions.md·README·`docs/legal`는 아직(리더 Phase 5) | R-OD-14 |
| OD-I1 점수 산식 PRD↔UX↔AI↔DM | 가중치·등급 점수·`not_applicable` 재분배·반올림·미응답 0점·채점 실패 제외·`d14.v1`·백필은 네 문서가 같음. **모두 미응답 세션 처리가 리더 규칙과 다름**(AI·DM·UX 모두 `not_scored`), 질문 `rationale` 저장 불일치 | R-OD-1, R-OD-2, R-OD-3, R-OD-4, R-OD-11 |
| OD-I2 항목 등급 표시 조건 | PRD F-P3-06 ↔ UX C-17/S-22 ↔ AI 일치 | — |
| OD-I6 DM 2.7.2 ↔ UX C-05/S-37/S-22/S-33 ↔ PRD F-AP-05 | FK `set null`·복사 컬럼·`BEFORE DELETE` 트리거·kept = `completed`만·근거 처리·`get_deletion_impact` cascade/kept·`interview_session_read_only` 모두 일치. 커리어 삭제의 `detached_interview_sessions`가 UX에 없음, S-37 필터 문장 어긋남 | R-OD-5, R-OD-12 |
| OD-P2 되돌리기 삭제 (UX S-10/S-44/D-UX-29, AI-12/13, PRD F-P1-13·F-P1-18) | 모두 반영. DM 한 곳에 옛 문장 잔존, S-44 교체 확인 문구가 오해 소지 | R-OD-10, R-OD-13 |
| OD-P5 해시 규칙 AI↔DM↔UX | 4단계 정규화·`sha256:` 접두·공통 함수, 세 문서 같음 | — |
| OD-P6 칩 값 AI↔UX | 고정 3개 문구·`ask_from_project`·"새 대화 시작"(메시지 없음) 같음 | — |
| OD-P10·P11 턴 계약 UX↔AI↔DM | 라우트 확장(`retryTarget` ②, `nothing_to_retry` 조건) 세 문서 같음. 중단된 턴의 표시·메시지 수 셈이 UX와 AI 사이에서 어긋남 | R-OD-8 |
| OD-C6 `p_client_id` (첫 AI 메시지 경로 포함) | DM 2.5.1·UX S-10·S-44 같음. DM 7장 첫 AI 메시지 행에 빠짐 | R-OD-9 |
| OD-C1·C2 모달 규칙·C-24 폐기 PRD↔UX | F-P1-06·용어집·9장·UX-4·UX-7·S-08·C-24·C-06 일치 | — |
| OD-L1 KMS 문구 PRD↔DM | NFR-KEY-02·07·D-DM-10 ↔ DM-16·2.11.2·5장 같음(출시 시 한계 명시 포함) | — |
| OD-L2 고지 사실 AI C-7.1 ↔ DM 2.11.6 ↔ UX C-21 | `v2026-11-05`·6행·"작성 중인 내용 포함"·본문 모듈 이동은 같음. 재동의 판정이 열린 결정과 어긋나게 단정, 무료 등급 문장이 OpenAI·Anthropic 무료 행 사실과 충돌 | R-OD-6, R-OD-7, R-OD-15 |
| 버전 참조·변경 이력 | 네 문서 머리·변경 이력이 서로 PRD v4.13 / UX v5.13 / AI v4.11 / DM v4.11을 가리킴. DM 부록 절 번호 참조 어긋남 | R-OD-11 |

## 이슈

### R-OD-1 [Critical] 모든 질문이 미응답인 세션이 `not_scored` — 리더 규칙(0점)과 다름 (DM)
- 경계: OD-I1 ↔ DM 저장 규칙
- 근거: `04-data-model.md` A.12 점수 산식 표 "점수 없음" 행 "응답 0개 제출(채점 작업 없음)과 `evaluation_failed`는 지금처럼 `not_scored`(세션 점수 없음) `[가정]` — 응답 0개를 "0점"으로 보이지 않는다" ↔ 결정 파일 OD-I1 "세션 점수 = 모든 질문의 평균, 미응답 질문은 0점으로 포함" + 리더 규칙(모두 미응답 = 0점, 채점 실패로 채점된 답이 없음 = `not_scored`)
- 담당: data-architect
- 수정 제안: "점수 없음" 행을 둘로 나눈다. (a) 응답 0개 제출 → `score_status = 'scored'`, `score_value = 0`, `score_max = 100`, `score_counted_count = 0`, `unanswered_count = question_count`, `score_method_version = 'd14.v1'`. 채점 작업이 없는 경로이므로 **제출 RPC(또는 `complete_interview_evaluation`을 거치지 않는 완료 경로)가 세션 점수를 쓴다**는 문장과 11.6 #7에 그 경로를 추가. (b) 응답 답변이 1개 이상인데 `scored`가 0개(모두 채점 실패)·`evaluation_failed` → `not_scored`. 4.3과 같은 분모 식(`score_counted_count + unanswered_count`)이 (a)에서 0/N = 0으로 자연히 맞는다는 점도 적는다. 백필 대상에 "응답 0개 + `pending_method`" 세션 포함 여부 명시
- 상태: open

### R-OD-2 [Critical] AI 4.3·AI-07이 "`scored` 0개면 `not_scored`(모두 미응답 포함)" (AI)
- 경계: OD-I1 ↔ AI 산식 원천
- 근거: `03-ai-features.md` 4.3 세션 점수 "**`scored` 질문이 하나도 없으면**(모두 미응답이거나 모두 채점 실패) 세션 점수는 `not_scored`(값 없음)이다 `[가정]`", AI-07 "서버가 4.3 규칙(미응답 0점 포함, 채점 실패 제외, `scored` 0개면 `not_scored`)으로 덮어쓴다", 변경 이력 v4.11 "`scored` 0개면 `not_scored` `[가정]`" ↔ 리더 규칙(모두 미응답 = 0점)
- 담당: ai-feature-designer
- 수정 제안: 4.3을 "응답 답변이 없으면(모두 미응답) 세션 점수 0점 — `scored`, `rationale` "질문 N개 모두 미응답, 0점". 응답 답변이 있는데 채점된 질문이 0개(모두 채점 실패)면 `not_scored`"로 고치고 AI-07(1942행)·변경 이력의 같은 구절을 맞춘다. "답변이 없어 평가할 내용이 없습니다" 문구를 0점과 함께 쓰는지 여부는 UX에 넘긴다. 필드 표의 `not_scored` 설명("세션은 `scored` 질문 0개일 때도")도 "응답 답변이 있는데 0개일 때"로
- 상태: open

### R-OD-3 [Major] UX C-17 `not_scored` 행이 응답 0개 세션을 "평가할 내용이 없어요"로 처리 (UX)
- 경계: OD-I1 ↔ 화면 표시
- 근거: `02-user-flows.md` C-17 표 `not_scored` 행 "단 `unanswered_count = question_count`(응답 0개)이면 **"답변이 없어 평가할 내용이 없어요"** + "새 면접 시작하기"" ↔ 리더 규칙(응답 0개 = 세션 0점, `scored`)
- 담당: ux-planner
- 수정 제안: 응답 0개 분기를 `not_scored` 행에서 빼서 `scored` 표시로 옮긴다 — 세션 점수 "0점" + "미응답 {N}개" + (원하면) "답변이 없어 0점이에요" 안내와 "새 면접 시작하기". `not_scored`는 "응답했지만 채점하지 못함"만. 산식 단락(1705행)에 "모두 미응답이면 0점" 한 줄 추가
- 상태: open

### R-OD-4 [Major] 질문 점수 `score_rationale` — AI는 서버 문구, DM은 null
- 경계: AI 출력 ↔ 저장
- 근거: `03-ai-features.md` 4.3 "`rationale`: 서버 문구. 질문 = 항목별 등급 표시명과 결과 점수(예: "구체성 보완 필요 · … → 66점"), 세션 = "질문 N개 중 채점 n개 평균, 미응답 m개는 0점으로 포함"" ↔ `04-data-model.md` A.12 질문 점수 행 "`score_rationale` = null `[가정]`(화면은 항목 등급을 따로 보인다)" (세션 `score_rationale` 값은 DM에 언급 없음)
- 담당: data-architect (저장 값의 기준 문서)
- 수정 제안: DM A.12에 AI 4.3 문구 규칙을 그대로 채택(질문·세션 둘 다 서버 문구, 헬퍼가 함께 생성)하거나, null로 둘 경우 AI 4.3 `rationale` 단락을 지우도록 ai-feature-designer와 합의. 어느 쪽이든 미응답 질문 행의 `score_rationale`도 정한다
- 상태: open

### R-OD-5 [Major] 커리어 항목 삭제 다이얼로그에 `detached_interview_sessions` 없음 (UX)
- 경계: OD-I6 DM ↔ UX C-05
- 근거: `04-data-model.md` 2.7.2 "커리어 삭제 영향과의 관계" — 남은 세션은 `by_application_project[]`에 잡히지 않으므로 **`affected_results.detached_interview_sessions`** 추가, "화면은 "삭제된 자기소개서의 면접 기록 {n}개"를 보인다 — 문구 UX" (4.2·11.6 #5도 같음) ↔ `02-user-flows.md` C-05 커리어 항목 행은 `affected_results.by_application_project[]`만 나열, 해당 문구 없음(검색 0건)
- 키의 타당성: 타당하다. 이 키는 세션을 "분리"하는 게 아니라 **이미 분리된(자기소개서 삭제 뒤 남은) 세션 중 삭제할 커리어 항목을 근거로 쓴 세션 수**다. `delete_results`면 이 세션도 지워지고 `keep_results`면 근거가 "원본 삭제됨"이 되므로 다이얼로그가 세야 한다. 이름이 오해를 부를 수 있으니 DM이 원하면 `kept_interview_sessions` 류로 바꿔도 되지만, 바꾸면 UX와 함께
- 담당: ux-planner
- 수정 제안: C-05 커리어 항목 행 표시 데이터에 `affected_results.detached_interview_sessions`를 더하고, n > 0일 때 "삭제된 자기소개서의 면접 기록 {n}개" 줄(결과 처리 ①의 `delete_results` 설명 "모의 면접은 세션 전체" 범위에 포함됨을 명시)을 넣는다
- 상태: open

### R-OD-6 [Major] DM 2.11.6·11.6 #12가 6행 모두 `requires_reconsent = false`로 단정 — AI의 열린 결정과 어긋남 (DM)
- 경계: OD-L2 AI C-7.1 ↔ DM 2.11.6
- 근거: `03-ai-features.md` C-7.1 "**Anthropic 2행 = 실질 변화 가능성 있음** `[결정 필요]` … (a) Anthropic 행만 `requires_reconsent = true` (권고)" ↔ `04-data-model.md` 2.11.6 "값: … **`requires_reconsent = false`** … 이번 버전은 … 표현 구체화이므로 `false`", 11.6 #12 "`v2026-11-05` 6행 insert(`requires_reconsent = false` …)", 4.5 표 "새 버전 6행 `v2026-11-05`(`requires_reconsent = false`…)". (2.11.6 끝에 "실질 변화가 확인되면 그 행만 `true`" 단서는 있음)
- 담당: data-architect
- 수정 제안: 이미 열린 Anthropic 지역 결정(새로 올리지 않음)에 묶어 "Gemini 4행·OpenAI 2행 = `false`, Anthropic 2행 = AI C-7.1 `[결정 필요]` 결과에 따름"으로 2.11.6 값·11.6 #12·4.5 행을 고친다. 백엔드가 지금 문장대로 6행 `false` 마이그레이션을 먼저 만들지 않게
- 상태: open

### R-OD-7 [Minor] UX C-21도 재동의 없음으로 단정 (UX)
- 경계: OD-L2 AI C-7.1 ↔ UX C-21
- 근거: `02-user-flows.md` C-21(1058행) "실질 처리 변화가 없어 `requires_reconsent = false`이므로 이미 동의한 사용자에게 다시 묻지 않는다" ↔ AI C-7.1 Anthropic 행 `[결정 필요]`
- 담당: ux-planner
- 수정 제안: "Anthropic 행은 AI 명세 C-7.1 결정에 따름(재동의면 기존 재동의 흐름 C-21·S-40 사용)"으로 단서를 단다. 처리 지역 문구("국외(미국)")도 그 결정 뒤 확정한다고 표시
- 상태: open

### R-OD-15 [Major] 무료 등급 고정 문장·`requires_free_tier_ack`가 OpenAI·Anthropic 무료 행 사실과 충돌
- 경계: OD-L2 AI C-7.1 ↔ UX S-10/S-44 시작 인사·C-21 ↔ DM 2.11.6
- 근거: `03-ai-features.md` C-7.1 — OpenAI·Anthropic "무료 / 유료 … 두 행 같은 사실", 학습·제품 개선 "**쓰지 않는다**" ↔ `02-user-flows.md` S-10 "+ 새 대화"(1452행) "활성 키가 무료 등급이면 … "무료 등급에서는 입력한 내용이 {공급자} 제품 개선에 쓰이고 사람이 검토할 수 있어요"" (공급자 변수, 무료 등급 전체에 적용, "(v5.13, OD-L2) 그대로 둔다"), AI C-7.1 "시작 인사의 무료 등급 문장 … 유지 — Gemini 무료 행 사실과 맞다"(Gemini만 맞음), `04-data-model.md` 2.11.6 `requires_free_tier_ack = (connection_tier = 'free')`(공급자 구분 없음 — OpenAI·Anthropic 무료도 "Gemini 무료 등급 강조 고지" 체크를 받게 됨)
- 담당: ux-planner (화면 조건), DM 2.11.6 `requires_free_tier_ack` 값은 data-architect가 맞춤
- 수정 제안: 문장은 사용자 결정대로 유지하되 표시 조건을 "활성 키가 무료 등급이고 C-7.1 학습 사용 = '쓰인다'인 공급자(지금은 Gemini 무료만)"로 좁힌다. DM은 새 버전 행의 `requires_free_tier_ack`를 `provider = 'gemini' and connection_tier = 'free'`로(또는 C-7.1 표 기준) 고친다. 리더가 이 좁힘을 "유지" 결정 안으로 보지 않으면 `[결정 필요]`로 올린다
- 상태: open

### R-OD-8 [Major] 중단된 턴의 표시·메시지 수 셈이 UX와 AI에서 다름
- 경계: OD-P10·P11 UX ↔ AI 턴 계약 ↔ DM 7장
- 근거: `03-ai-features.md` AI-12 OD-P10(896행) "AI 메시지 행은 … 지금 구현은 `failed` 상태로 닫아 … 지금 구현은 응답 자리(AI 행)를 시작할 때 한 번 세고, 다시 보내기가 그 행을 다시 쓰므로 …", OD-P11(897행) "마지막 메시지가 AI 응답이 없는(**또는 응답이 실패·중단으로 닫힌**) 사용자 메시지이고 … "답을 받지 못한 메시지예요 · 다시 보내기"" ↔ `02-user-flows.md` C-04(843행) "메시지 수(상한 40)에 세지 않는다", S-10 패널 "답을 받지 못한 메시지"(1464행) 조건은 "마지막 메시지가 AI 답이 없는 사용자 메시지"뿐이고 실패는 별도 상태 "실패한 턴"(C-20). DM 7장 다시 보내기 ①(실패 assistant 행 재사용) / ②(assistant 행 없음, 새 행)
- 문제: 실제 실패와 사용자 중단이 둘 다 `failed` 행이라 화면이 "실패한 턴(C-20)"과 "답을 받지 못한 메시지"(실패 표시 없음) 중 무엇을 보일지 정할 수 없고, 중단 뒤 다시 보내지 않으면 AI 행이 이미 세어져 UX의 "세지 않는다"와 다르다
- 담당: ai-feature-designer (턴 계약 원천)
- 수정 제안: AI-12에 (1) 중단 행과 실패 행을 구분하는 판정(예: 작업 `canceled` vs `failed`, 또는 메시지 상태)과 각각의 화면 상태(중단 = "답을 받지 못한 메시지", 실패 = "실패한 턴")를 명시, (2) 메시지 수는 "응답 자리를 시작할 때 1 — 중단 뒤 다시 보내기는 같은 자리를 다시 써 더 세지 않음"으로 정하고 UX C-04 문구("메시지 수를 더 늘리지 않는다")와 DM 7장 ①②의 셈을 그에 맞춰 달라고 UX·DM에 전달
- 상태: open

### R-OD-9 [Minor] DM 7장 "새 페이지의 첫 AI 메시지" 행 ③에 `p_client_id` 없음 (DM)
- 경계: OD-C6 DM 2.5.1·UX S-10/S-44 ↔ DM 7장
- 근거: `04-data-model.md` 7장(1498행) "③ **페이지 저장 RPC로 폼 전체 첫 저장**(행 생성, 실패 = 아무것도 안 생김)" ↔ 2.5.1 "첫 저장 성공까지 같은 값으로 보낸다", UX S-10(1468행) `save_project_page(p_project_id = null, …, p_client_id)`, S-44(1352행) "③은 `p_client_id`를 함께 보낸다(OD-C6)"
- 담당: data-architect
- 수정 제안: ③에 "(v4.11, OD-C6) `p_client_id` 포함 — ③ 응답 유실 뒤 다시 보내도 행 1개"를 더한다
- 상태: open

### R-OD-10 [Minor] DM 2.5 채우기 규칙에 되돌리기 문장 잔존 (DM)
- 경계: OD-P2 ↔ DM
- 근거: `04-data-model.md` 1099행 "`op = set`(합친 제안)은 항목 교체**(이전 값은 화면이 되돌리기용으로 보관)**" ↔ OD-P2 "되돌리기를 없앤다", AI-12 880행 "~~채우기 직전 값은 화면이 보관해 되돌리기 제공~~ (v4.11, OD-P2) 되돌리기 없음"
- 담당: data-architect
- 수정 제안: 괄호를 지우고 "(v4.11, OD-P2) 되돌리기 없음 — 저장 전이면 '저장하지 않고 나가기'"로
- 상태: open

### R-OD-11 [Minor] 점수 산식 위치 참조 "DM A.13" ↔ 실제 A.12
- 경계: 문서 간 참조
- 근거: 산식 표는 `04-data-model.md` "### A.12 interview_sessions" 아래(1816행)에 있다. 그런데 DM 머리 상태 줄 "백필 RPC `backfill_interview_scores`(A.13, OD-I1 ★)", `03-ai-features.md` 4.3 "`d14.v1`(DM A.13 `score_method_version`)"·"저장 모양은 DM A.13", `02-user-flows.md` C-17 산식 "AI 명세 4.3·DM A.13". DM 자신의 4.5 표(1282행)·변경 이력은 "A.12"
- 담당: data-architect(머리 상태 줄), ai-feature-designer·ux-planner(각 참조 1곳)
- 수정 제안: 세 곳을 "DM A.12 점수 산식"으로 통일(질문 행 컬럼만 가리킬 때는 A.13 유지 가능)
- 상태: open

### R-OD-12 [Minor] S-37 "삭제된 자기소개서" 필터 ↔ DM 7장 "필터 '전체'에만 나옴", 목록 이름 대체값 없음
- 경계: OD-I6 UX S-37 ↔ DM 7장
- 근거: `02-user-flows.md` S-37 "자기소개서 삭제됨" 행 "필터 "자기소개서"에는 "삭제된 자기소개서" 항목 하나로 묶는다 `[가정]`" ↔ `04-data-model.md` 7장 모의 면접 전체 세션 행 "이 세션은 `application_project_id` 필터로는 고를 수 없다(필터 "전체"에만 나옴, 별도 필터 값은 UX 결정)". 또 S-22 머리는 복사 컬럼이 둘 다 비면 "삭제된 자기소개서" `[가정]`인데 S-37 행·C-05가 쓰는 "{company_name_snapshot} – {position_title_snapshot}"에는 한쪽·양쪽 null 처리가 없다(DM: "JD가 없거나 값이 비면 null")
- 담당: data-architect (읽기 계약)
- 수정 제안: DM 7장 행에 "UX의 '삭제된 자기소개서' 필터 = `application_project_id is null`" 조건을 추가. UX는 S-37 행에 S-22와 같은 대체 규칙(한쪽만 있으면 그 값, 둘 다 비면 "삭제된 자기소개서")을 한 줄 더한다
- 상태: open

### R-OD-13 [Minor] S-44 교체 확인 문구 "저장하기 전에는 되돌릴 수 있어요" — 되돌리기 삭제 뒤 오해 소지 (UX)
- 경계: OD-P2 ↔ 화면 문구
- 근거: `02-user-flows.md` S-44 [본문 교체](1342행) 다이얼로그 "지금 본문을 AI 초안으로 바꿀까요? 저장하기 전에는 되돌릴 수 있어요"(괄호로 "되돌리기 버튼은 없다"고 설명). 화면에 되돌리기 수단이 없으므로 사용자는 버튼을 찾게 된다. 되돌리는 길("저장하지 않고 나가기")은 이 페이지의 다른 미저장 변경까지 버린다
- 담당: ux-planner
- 수정 제안: 예 "저장하지 않고 나가면 저장된 본문으로 돌아가요(이번에 고친 다른 내용도 사라져요)"처럼 실제 동작을 쓰고, 구현과 다르면 5.1i UI 후속 표에 올린다
- 상태: open

### R-OD-14 [Minor] 결정 파일이 지목한 문서 중 아직 바뀌지 않은 것 (리더 Phase 5)
- 경계: OD 행 "영향 문서" ↔ 실제 변경
- 근거: `git diff main`에서 `docs/planning/decisions.md`·`docs/planning/README.md`·`docs/legal/cross-border-transfer.md`·`docs/ui/design-system.md`가 변경 없음. 결정 파일 OD-L1·OD-L3 "decisions §1", OD-D7 "decisions §2", OD-L4 "README 남은 결정", OD-L2·OD-D9 "`docs/legal/cross-border-transfer.md`("정량 성과" 잔여 정리)". PRD 9.6(765행)은 후속을 "decisions.md 4장이 모은다"고 가리킴
- 담당: 리더(orchestrator)
- 수정 제안: Phase 5에서 decisions.md 3.x 사용자 확정·4.x 백엔드·UI 후속(★ OD-L2·I1·I6·C6·P5·P11, UI OD-I2·C3·P2·P6·B1 등), README 버전 표·남은 결정(OD-L4 출시 전 체크리스트, Anthropic 지역 결정), `docs/legal` "정량 성과" 정리를 반영. design-system P-15(OD-D4)는 UI 후속으로 넘긴 것이므로 그대로 둬도 됨
- 상태: open

## 확인만 하고 이슈 없음 (근거)
- 권고와 다른 11행(OD-L1·I1·I2·I6·C1·C4·P2·P5·P6·P11·D1): 사용자 선택이 각 영향 문서에 반영됨. 단 OD-I1은 R-OD-1~3 경계 사례만 어긋남
- OD-I6: DM 2.7.2(nullable FK `on delete set null (application_project_id)`, `company_name_snapshot`·`position_title_snapshot`, CHECK `interview_sessions_detached_check`, `BEFORE DELETE` 트리거 순서, `evidence_links` null 허용 + CHECK, `cascade.interview_sessions` = `status <> 'completed'`, `kept.interview_sessions`, `interview_session_read_only`, 탈퇴 전부 삭제) ↔ UX C-05 자기소개서 행({N} = cascade, {M} = kept, M = 0이면 줄 숨김)·S-37 행 메뉴 "삭제"만·S-22 읽기 전용 표·S-33 → S-22 ↔ PRD F-AP-05·F-P3-07·F-P3-15·F-COM-05·용어집 일치
- OD-P5: AI-13·DM 2.5.0·UX S-44의 4단계·`sha256:` 접두·공통 함수(`deliverable-chat.ts`·`career-v45-shared.ts`) 같음
- OD-P6: AI-13 칩 표 ↔ UX S-44 시작 영역·초안 남은 횟수 문구·값 같음
- OD-P11 라우트: AI 변경 표 "지금 라우트는 이 경우를 받지 않음" ↔ DM 7장 ② "`turn.ts` `retryTarget`은 ①만 받는다 ★"·③ `nothing_to_retry` ↔ DM 11.6 #11 같음
- OD-C1·C2, OD-L1: 위 경계 표대로 일치

## 결정 필요 통합 목록
| 항목 | 출처 | 비고 |
|------|------|------|
| Anthropic 추론 지역 기본값 `global` ↔ 이전 고지 "국외(미국)" — 재동의 여부·처리 지역 문구 | `03-ai-features.md` C-7.1 `[결정 필요]` (권고 (a) Anthropic 행만 재동의) | 이미 열린 질문 — 다시 올리지 않음. R-OD-6·R-OD-7은 이 결정에 묶인 문장 정리 |
| (조건부) 무료 등급 문장·강조 고지를 Gemini 무료로 좁히기 | R-OD-15 | 리더가 "유지" 결정 안의 수정으로 보면 owner 수정, 아니면 사용자에게 |

---

## 라운드 2 (2026-11-05 재검토)

- 입력: 담당자 수정(PRD v4.13 / UX v5.13 / AI v4.11 / DM v4.11, `R-OD-n` 표시 문장), 리더 갱신 `docs/planning/decisions.md`(머리, §1 0건, §2, 3.18, 4.8 닫음, 4.12)·`docs/planning/README.md`·`docs/legal/cross-border-transfer.md`(2026-11-05 개정안), 새 사용자 결정 OD-L2a(Claude 2행 `requires_reconsent = true`)
- 적용된 리더 판단: 모두 미응답 = 0점, 답했는데 하나도 채점 못 함 = `not_scored`(R-OD-1~3) / 무료 등급 문장·확인은 Gemini 무료만(R-OD-15) / R-OD-8은 코드 기준(중단 = 메시지 `failed` + 작업 `canceled`, 응답 자리 1회 셈, 상태 추가 없음)
- 결과: 라운드 1 이슈 15건 모두 **해결(확인)**. 새 이슈 Minor 2건(R-OD-16·17). Critical·Major 남음 0

### 라운드 1 이슈 상태
| ID | 심각도 | 상태 | 확인 근거 |
|----|--------|------|-----------|
| R-OD-1 | Critical | 해결(확인) | DM A.12 "점수 없음" 행을 "모두 미응답 = 세션 0점(`scored`, `score_counted_count = 0`, 제출 완료 경로가 같은 헬퍼로 기록)"과 "응답 ≥ 1·`scored` 0개 = `not_scored`"로 나눔. 백필 대상에 응답 0개 과거 세션 포함 |
| R-OD-2 | Critical | 해결(확인) | AI 4.3 세션 점수·필드 표·AI-07 트리거·AI-07 `session_score` 문장이 DM A.12와 같은 규칙. v4.11 이력 1행(2132)의 옛 문구는 이력이며 2133 행이 덮음 |
| R-OD-3 | Major | 해결(확인) | UX C-17 `scored` 행에 "모든 질문이 미응답 → 0점 / 100 + '답변이 없어 0점이에요'", `not_scored`는 "응답했는데 채점된 답이 없을 때만" |
| R-OD-4 | Major | 해결(확인) | DM A.12 질문·세션 `score_rationale` = 서버 문구(AI 4.3 규칙), 미응답 "미응답 · 0점" `[가정]`, 채점 실패 null |
| R-OD-5 | Major | 해결(확인) | UX C-05 커리어 항목 행에 `affected_results.detached_interview_sessions`와 "삭제된 자기소개서의 면접 기록 {n}개"(n > 0). decisions 4.12 UI 2와 같음 |
| R-OD-6 | Major | 해결(확인) | DM 2.11.6·4.5 표·11.6 #12: Anthropic 2행 `true`, Gemini·OpenAI 4행 `false`(OD-L2a). AI C-7.1 443행·decisions 4.12 백엔드 6과 같음 |
| R-OD-7 | Minor | 해결(확인) | UX C-21(1058행)·S-40 동의 필요 상태(1803행)에 Claude 재동의 반영. `docs/legal` Anthropic 행 "미국(저장), 추론은 여러 국가" = AI C-7.1 |
| R-OD-8 | Major | 해결(확인) | AI-12 897~900행 ↔ UX C-04(843행)·S-10/S-44 패널 상태 ↔ DM `writing_chat_messages.status`(377행)·11.6 #15: 중단 = 메시지 `failed` + 작업 `canceled` → "답을 받지 못한 메시지", 실패 = 작업 `failed` → C-20, 응답 자리는 시작 때 1회 셈·다시 보내기는 같은 행. CHECK 변경 없음 |
| R-OD-9 | Minor | 해결(확인) | DM 7장 첫 AI 메시지 ③에 `p_client_id` |
| R-OD-10 | Minor | 해결(확인) | DM 1099행 되돌리기 괄호 취소선 + OD-P2 문장 |
| R-OD-11 | Minor | 해결(확인) | DM 머리 "A.12 점수 산식", AI 4.3·UX C-17 "DM A.12 점수 산식"(질문 행 컬럼은 A.13) |
| R-OD-12 | Minor | 해결(확인) | DM 7장 "삭제된 자기소개서" 필터 = `application_project_id is null`, 이름 대체 규칙. UX S-37 행에 S-22와 같은 대체 규칙 |
| R-OD-13 | Minor | 해결(확인) | UX S-44 교체 확인에서 "저장하기 전에는 되돌릴 수 있어요" 삭제 |
| R-OD-14 | Minor | 해결(확인) | decisions.md §1 0건·3.18·4.12, README 2026-11-05 개정 줄, `docs/legal` 2026-11-05 개정(Anthropic 추론 지역, "정량 성과" 삭제) |
| R-OD-15 | Major | 해결(확인) | UX S-10 시작 인사(1452행)·C-19 무료 툴팁(1006행)·C-21 강조 고지(1065행) Gemini 무료만, AI C-7.1 440행 적용 범위, DM 11.6 #12·4.5 `requires_free_tier_ack = provider = 'gemini' and tier = 'free'`. 리더가 "유지" 결정의 범위 안으로 판단(decisions 3.18) — `[결정 필요]` 아님 |

### 경계 재확인 (이번 라운드에 바뀐 것)
| 경계 | 결과 |
|------|------|
| decisions 4.12 백엔드 1~6 ↔ DM 11.6 #1~#12 | 내용 일치(OD-I1 0점·`not_scored` 규칙, `score_rationale`, `p_client_id` 첫 AI 메시지 경로, OD-L2a 재동의·Gemini 무료 확인). 번호 범위만 어긋남 → R-OD-17 |
| decisions 4.12 UI 11 ↔ UX 5.1i | UX 5.1i의 구현과 다른 문구 = K-2·K-3·K-28·B-7·Q-15·Q-25 6건, decisions와 같음 |
| decisions 3.18 OD-I1·OD-L2a·R-OD-15 ↔ 네 문서 | 일치 |
| OD-L2a ↔ AI C-7.1 ↔ DM 2.11.6 ↔ UX C-21·S-40 ↔ `docs/legal` | 일치 |
| OD-P10·R-OD-8 ↔ AI 변경 표 | 표 한 칸에 옛 문구 → R-OD-16 |

### 새 이슈

#### R-OD-16 [Minor] AI 변경 요약 표에 "메시지 수 안 셈" 잔존 (AI)
- 경계: OD-P10·R-OD-8 ↔ AI 문서 안
- 근거: `03-ai-features.md` 머리 변경 표 "중단 (OD-P10)" 행(22행) "대화 턴 중단 = 부분 응답 버림·실패 아님·**메시지 수 안 셈**" ↔ 같은 문서 AI-12(898행) "응답 자리를 시작할 때 한 번 세고, 중단·실패로 닫혀도 빼지 않는다", UX C-04(843행) "시작할 때 메시지 수에 1개로 세고 중단해도 빼지 않는다"
- 담당: ai-feature-designer
- 수정 제안: "메시지 수를 더 늘리지 않음(응답 자리는 시작 때 1회 셈, R-OD-8)"으로
- 상태: open

#### R-OD-17 [Minor] decisions 4.12가 "DM 11.6(#1~#14)" — DM에는 #15까지 (리더)
- 경계: decisions 4.12 ↔ DM 11.6
- 근거: `decisions.md` 4.12 머리 "백엔드 상세는 04-data-model.md 11.6(#1~#14)" ↔ `04-data-model.md` 11.6 #15 "OD-P10 / R-OD-8 중단된 턴 — 코드 변경 없음, 확인만: 서버 읽기 DTO가 작업 상태를 함께 내림"
- 담당: 리더(orchestrator)
- 수정 제안: "#1~#15"로 고치고, #15의 "확인만" 항목(상세 DTO가 작업 상태를 내려 화면이 중단·실패를 가름)을 4.12 백엔드 목록이나 UI 7(OD-P11)에 한 줄 덧붙인다
- 상태: open

### 결정 필요 (라운드 2)
- 없음. Anthropic 추론 지역 질문은 OD-L2a로 닫힘(AI C-7.1 `true` 확정, `[결정 필요]` 태그 제거 확인).

## 리더 후속 (2026-11-05)

- R-OD-16: AI 0.v411 요약 표 22행을 "메시지 `failed` + 작업 `canceled`, 응답 자리는 시작 때 한 번 세고 빼지 않음"으로 고침 — 해결(리더, 리뷰어 재검토 없음, grep 확인)
- R-OD-17: decisions.md 4.12를 "11.6(#1~#15)"로 고치고 #15 확인 항목(대화 상세 DTO가 작업 상태를 함께 내림)을 백엔드 확인 줄로 추가 — 해결(리더, 리뷰어 재검토 없음)
- 남은 이슈: 0건
