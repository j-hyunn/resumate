# R8 AI 파이프라인 구현 노트 (STAR 합친 제안·-음 체·민감정보 판정)

- 날짜: 2026-11-04
- 기준: `_workspace/backend/R8/01_plan.md` 계획서 A(AI-12 extract·V-9·reply·렌더러), B(-음 체·KOREAN_SUFFIXES), C(민감정보 판정). R7 변경(미커밋)은 그대로 두고 그 위에 작업했다.
- 범위: `src/server/ai/`만 수정. `src/server/services/writing-chat/`는 손대지 않음(호출부 변경 불필요 — `V9Flags` 모양 그대로). 커밋하지 않음.

## 기능별 모델 등급·prompt_version

| 호출 | 등급 | 이전 | 이후 |
|------|------|------|------|
| AI-12 extract | light | `ai-12.extract.v5+common.v2` | `ai-12.extract.v6+common.v2` |
| AI-12 reply | default | `ai-12.reply.v5+common.v2` | `ai-12.reply.v6+common.v2` |
| AI-13 extract | light | `ai-13.extract.v2+common.v2` | `ai-13.extract.v3+common.v2` |
| AI-13 compose | default | `ai-13.compose.v1+common.v2` | `ai-13.compose.v2+common.v2` |
| AI-13 reply | default | `ai-13.reply.v2+common.v2` | 그대로 (검토 결과 -음 체·합친 제안과 충돌하는 문구 없음. "덧붙이는 초안"은 AI-13 본문 new_only 모드 이야기라 유지) |

input_hash: 대화 턴은 R7과 같이 input_hash 재사용을 쓰지 않으므로 무효화될 캐시 없음.

## 바꾼 파일

| 파일 | 변경 |
|------|------|
| `validation/v9-lexicon.ts` | `KOREAN_SUFFIXES`에 -음 체 12개(하였음·했었음·되었음 / 했음·됐음·었음·였음·았음 / 함·됨·음·임), 각자 자기가 끝나는 더 짧은 항목보다 앞. `SENSITIVE_PATTERNS` 삭제 → `CONTACT_PATTERN`(그대로), `PERSONAL_MARKER_PATTERN`(1인칭·가족 표지), `THIRD_PARTY_NOUNS`, `PERSONAL_PHRASES`(범주별 strong/weak), `detectPersonalCategories()`, `NOT_A_NAME_ENDINGS`("자부사팀실소단국과처"), `NOT_A_NAME`에 원으로 끝나는 직무 명사 추가 |
| `validation/v9.ts` | `detectSensitive` 새 판정. `checkClaim(…, existing)`: V-9g는 값만, V-9c·d·e 출처 = 인용 + 기존 텍스트. `preservesExisting()`(V-9j), `existingStarTexts()`, `mergedStarLength`(미반영 `set` 제안 = 교체 길이). `putStar`: V-9h `set` 거부 삭제, 합친 값 무변경 판정, V-9j, 출처 합치기. 보고서 `merged`·`preservation_review` |
| `validation/v10.ts` | 사실(facts) V-9g를 사실 문장에만(인용 제외). 블록 V-10f는 원래 블록 문장만 검사 — 주석만 |
| `context-pack/writing-chat.ts` | extract `<project_state>` star 머리말 "값이 있는 필드는 기존 텍스트와 새 내용을 합친 전체 문장으로 set". reply proposals 라벨 "덧붙임/새로 채움" → "합친 제안/새로 채움"(op append 또는 폼에 값이 있으면 합친 제안). `sensitiveNotice`는 `detectSensitive`를 그대로 써서 새 판정이 자동 적용 |
| `pipelines/AI-12.ts` | `emptyV9Report`·`flattenReport`에 `merged`·`preservation_review` |
| `prompts/AI-12/index.ts` | v6 — 아래 |
| `prompts/AI-13/index.ts` | extract v3·compose v2 — 아래 |
| `schemas/structured-draft.ts` | `op` 의미 주석만(set = 필드 전체 값, append = 호환) |
| `__fixtures__/AI-12/conversations.ts` | 시나리오 7을 합친 `set`으로(-음 체), `legacyOutput`(append) 추가 |
| 테스트 | `v9.test.ts`, `v9.snapshot.test.ts`, `v10.test.ts`, `writing-chat.test.ts`, `deliverable-chat.test.ts`, `AI-12.test.ts`, `AI-12.gate.test.ts`, `AI-13.test.ts` |

## 프롬프트 핵심

### AI-12 extract v6
- star_patches는 항상 `op "set"`, `"append"` 금지.
- 기존 텍스트(폼 값, `<draft>`에서 "(폼에 채워짐)"이 아닌 제안)가 있는 필드: 기존 텍스트 + 새 내용을 합쳐 다시 쓴 **전체 문장**. 사용자 문장도 다시 써도 되지만 수치·고유명사·기술 이름·행동은 하나도 빠뜨리지 않음. 폼 값과 제안이 겹치면 한 번만. 새 내용이 이미 있으면 패치 없음.
- source_message_ids·source_quotes = 이번에 새로 들어간 내용의 출처만. 합친 값 ≤ 2,000자.
- 문체: STAR 값 끝은 -음/-함/-됨/-임, 합칠 때 기존 문장도 -음 체로. 경계 사례 1~3 -음 체로 고침, 사례 4(합친 제안) 추가.
- 민감정보 규칙에 "본인·가족" 한정과 도메인 단어·직함만 있는 사람은 민감정보가 아님을 명시.
- "구체 요소 보존" 줄 유지.

### AI-12 reply v6
- proposals 읽는 법에 "합친 제안"(폼 기존 값 + 새 내용의 전체 문장)/"새로 채움" 설명.
- "이미 있는 글을 다시 써 달라고 하면" → 새로 말해 준 내용과 기존 글을 합쳐 다시 정리한 제안을 드릴 수 있고(기존 사실 유지), 카드에서 기존 내용과 비교 후 반영 가능. 말하지 않은 내용으로 다시 쓰지 않음.
- 인용 예시를 사용자 발화 그대로("'캐시 무효화 규칙을 설계했어요'라고 하셨는데")로. 질문·안내는 존댓말(-음 체를 따라 하지 않음) 한 줄.

### AI-13 extract v3 / compose v2
- extract: 사실 text는 -음 체, "~했다" 지시 삭제, 경계 사례 3개 -음 체로, 민감정보 규칙 RQ-6 문구.
- compose: 제목이 아닌 블록(문단·목록 항목·표 셀·인용)은 -음 체, 제목은 명사형 그대로, code 블록은 문체 변경 없음, current_body 재정리 블록도 -음 체. 예시 5개 -음 체로. team 사실 "팀이 …함". 민감정보 문구 RQ-6.

## 검증 규칙 적용 범위 (V-9 변경분)

| 규칙 | v4.9 동작 |
|------|-----------|
| V-9h | 값 있는 STAR 필드의 `set` 허용(= 합친 제안). `append`는 호환으로 계속 받음(append onto nothing = set, 중복 문장 무변경 등 기존 로직 그대로). 기간 규칙 그대로 |
| 기존 텍스트 | `existingStarTexts` = 폼 값 + 폼에 채워지지 않은 미반영 제안 값 + 같은 턴 앞선 패치 값 |
| V-9c·V-9d·V-9e | `set`일 때만 출처 = 인용(+V-9d는 인용 발화 원문) + 기존 텍스트. `append`는 인용만(기존 동작) |
| V-9a·V-9b | 그대로 — 출처는 user 발화, 인용은 발화의 연속 구간 |
| V-9j (신규) | 합친 `set`에서 기존 텍스트의 모든 숫자(단위 포함, V-9c 매칭 역방향)와 V-9d 이름(영문 토큰·스킬 사전·회사명)이 합친 값에 있어야 함. 없으면 `needs_review` + `report.preservation_review++`. 거부 아님 |
| 무변경 | 합친 값이 기존 텍스트(어느 한 부분 또는 전체)에 정규화 기준으로 포함되면 `unchanged` |
| 길이 | `set` = 값 자체 길이 ≤ 2,000(교체). `append` = 현재 + 1 + 값(기존). `mergedStarLength`: 미반영 제안이 `set`이면 그 길이, `append`면 현재 + 1 + 제안 |
| 출처 합치기 | 합친 `set`은 교체되는 미반영 제안(폼에 채워지지 않음, new_object 아님)과 같은 턴 앞선 패치의 출처를 합침(새 출처 먼저) — spec-gaps R8-AI-3 |
| V-9g | 값에만(인용 제외). V-10 사실도 사실 문장에만. V-10f 블록은 원래 블록 문장만 |

`V9Check` 목록은 그대로(V-9j는 거부가 아니라 검토 필요). `V9Report`에 `merged`(합친 set 적용 수), `preservation_review`(V-9j 수) 추가, C-7 로그 stats에도 숫자로만 나감.

## 민감정보 판정 (C)

`detectSensitive(text)` 순서: contact → health → religion → union → politics → third_party_name. 문장 단위(문장부호·줄바꿈으로 나눔).

- 연락처: 그대로.
- 1인칭·가족 표지: 제가·저는·저도·저의·저를·제게·저한테·제(+공백)·내가·나는·나도·본인·개인적으로·가족·아내·남편·와이프·배우자·부모님·아버지·어머니·아빠·엄마·아이·아들·딸·형·누나·언니·오빠·동생(+조사, "아이디"는 제외).
- strong(동사형 신상 서술): 질환명(우울증·공황·불안 장애·번아웃·당뇨 …) + 진단/치료/앓/겪/때문/휴직 …, 암 진단·투병·항암, 입원했/해서, 수술을 받, 병가를 냈/썼, 치료를 받, 임신했·출산했, 출산 휴가를 썼, 육아휴직을 했/썼, 휴직했, 유산했, 장애 판정을 받, 심리 상담을 받, 정신과 치료/진료, 몸이 안 좋/건강이 나빠 / 교회·성당·절에 다니/가요, 다니는 교회, 세례를 받, 예배·미사를 드리, ~을 믿 / 노조 활동을 했, 노조 가입, 파업에 참여 / 선거 운동을 했/도왔, 집회에 나갔, 정당·후보를 지지했. → 표지가 있거나 문장에 다른 사람 명사(환자·고객·사용자·회원·직원·근로자 …)가 없으면 걸림. 다른 사람 명사가 바로 앞 주어("환자가 입원했을 때")면 안 걸림. (spec-gaps R8-AI-1)
- weak(명사형): 신앙이/생활, ○○교 신자·불교도, 신자예요, 종교가 있/없, 조합원이에요, 노조 위원장을 맡, 지지 정당은, 당원이에요, 정치 성향은. → 같은 문장에 표지가 있을 때만.
- 제3자 실명: 성씨+2자(+복성) + 직함 유지. 끝 글자 자·부·사·팀·실·소·단·국·과·처면 제외("기획자 선배", "사업부 부장님", "고객사 팀장", "연구소 실장"). "원"은 끝 글자 규칙에서 빼고 직무 명사 목록으로(spec-gaps R8-AI-2).
- 턴 안내(`sensitiveNotice`, AI-12·AI-13)는 발화에 새 판정 적용 — 코드 변경 없이 같은 함수.

## 테스트·픽스처

- 회귀(진단) 13문장 — 모두 `[]`: 병원 예약 시스템을 개발했어요 / 입원 환자 조회 화면을 만들었어요 / 수술 일정 관리 기능을 맡았어요 / 출산 휴가 신청 기능을 개발했어요 / 병가 처리 HR 기능을 만들었어요 / 교회 출석 앱 외주를 했어요 / 파업 대응 공지 시스템을 만들었어요 / 선거 결과 시각화 대시보드를 만들었어요 / 기획자 선배가 코드 리뷰를 해 줬어요 / 사업부 부장님께 보고했어요 / 제가 병원 예약 시스템의 결제 모듈을 맡았어요 / 저는 환자가 입원했을 때 보호자에게 알림을 보내는 기능을 만들었어요 / 고객사 팀장님과 일정을 조율했어요. 계획서 진단에 적힌 문장은 9개라, 1인칭 표지가 섞인 도메인 문장·직함 문장 4개를 더해 13개로 맞췄다. 이어 붙인 한 발화, -음 체 형태도 `[]`.
- 추가 음성: 보안 진단을 받았어요, 디스크 때문에 서버가 멈췄어요, 직원이 병가를 냈을 때 …, 제가 육아휴직 신청 화면을 개발했어요, 연구소 실장님이 승인했어요, 지지 정당 얘기가 나왔어요(R4에선 politics → 이제 `[]`), 다른 문장의 표지는 안 섞임.
- 양성: "제가 우울증 진단을 받아서 휴직했어요" health, "김민수 팀장님과 했어요" third_party_name, 전화번호·메일 contact, "저는 노조 활동을 했어요" union, "우울증 진단을 받아 휴직함"(-음 체 값) health, 아내 출산·육아휴직, 교회에 가요, 제 신앙생활, 제 지지 정당은, 선거 운동을 도왔어요.
- V-9: 합친 set 허용 + 레거시 append 허용, 기존 텍스트가 V-9c·V-9d 출처가 됨(빈 필드에선 같은 값이 V-9c/V-9d 거부), append는 기존 텍스트 출처 아님, V-9j 숫자·이름 누락 → needs_review(표 6개: 30%, 30%→30명, 1,200명, 2년 6개월, Kafka↔카프카), 무변경(정규화 같음·부분), 폼 값 + 미반영 제안 둘 다 출처·보존 대상이며 출처 합쳐짐, 교체 길이(기존 1,000자+ + 합친 값이 옛 계산으론 2,000 초과지만 통과, 2,000 초과 값은 length), `mergedStarLength` set/append, 값만 V-9g(인용에만 민감정보면 통과), 도메인 값 유지.
- -음 체: `stripKoreanSuffix` 표(설계함→설계, 줄었음→줄었, 정리하였음→정리, 도입되었음→도입, 포함·처음은 그대로 …), 목록 순서 검사, V-9e 0% 표("캐시 무효화 규칙을 설계함" vs "캐시 무효화 규칙을 설계했어요" 등 4개), 끝까지 review ok.
- V-10: 사실 인용에만 민감정보면 통과, 도메인 사실 유지, -음 체 블록 유지.
- 스냅숏(v4.6): 폼에만 있는 값에 합친 set(폼 텍스트가 APM 출처), 폼에 채워진 제안 뒤 합친 set은 `new_object` 그대로 RPC op `set`, 레거시 append도 new_object.
- 프롬프트 문구 검사: AI-12 extract "append는 쓰지 않습니다"·보존 문장·-음 체 예시·`"…했다"` 값 예시 없음·민감정보 문구, reply "합쳐서 다시 정리한 제안"·"덧붙이는 것만" 없음·존댓말, AI-13 extract/compose -음 체·예시에 "~했다/었다" 없음.

결과:
- `pnpm vitest run src/server`: 1,808 tests 통과
- `pnpm typecheck`: 통과
- `pnpm lint`: 경고·오류 없음

## 이벤트·진행 단계·오류 코드

변경 없음. RPC op 계약: AI는 합친 제안에 `"set"`을 내고, `"append"`는 입력으로 계속 유효(V-9·RPC·화면 모두). `toDraftPatch` 모양 그대로(`new_object` 포함). db-engineer 마이그레이션 `20261113000300_r8_star_merged_proposal.sql`(작업 중 확인)이 AI `set`을 값 있는 필드에서도 `set`으로 저장 — 이 구현과 맞음.

## 스펙 차이·가정 (spec-gaps.md R8-AI-1~3)

- `[가정]` R8-AI-1: 주어 없는 문장의 동사형 신상 서술은 본인 서술로 본다(값은 -음 체라 주어가 없음). 다른 사람 명사가 문장에 있거나 바로 앞 주어면 제외.
- `[가정]` R8-AI-2: 직함 오탐 끝 글자에서 "원" 제외, 직무 명사 목록으로 대체.
- `[가정]` R8-AI-3: 합친 set은 교체되는 미반영 제안의 출처를 합쳐 둔다.
- `[가정]` V-9j는 숫자·이름만 본다(행동 서술 보존은 평가 세트 몫, 명세 V-9j 그대로).
- `[가정]` 합친 값이 기존 텍스트의 일부이기만 하면(새 내용 없음) 무변경으로 버린다.
- 남은 리스크: 사용자가 폼에 직접 쓴 문장에 민감정보가 있으면 그 필드의 합친 제안은 V-9g로 계속 거부된다(값 전체 검사). 드문 경우라 그대로 두었다.
- 화면(frontend-engineer)이 `set`을 교체로 처리해야 중복이 안 생긴다 — RPC·UI와 같은 머지로 나가야 함(계획서 출시 영향).

## QA 1라운드 수정 (2026-11-04, `03_backend-qa_report.md`)

프롬프트 문구는 바꾸지 않아 버전 그대로(`ai-12.*.v6`, `ai-13.extract.v3`·`compose.v2`). 검증기·사전·저장 페이로드만 변경.

| 이슈 | 수정 |
|------|------|
| QA-02 [Major] 오탐 19건 | `v9-lexicon.ts` 신상 판정을 리더 방향("화자에 대한 절의 **서술어**일 때만")으로 다시 씀. 구절마다 `kind`(verb = 매치가 서술어 단어 안에서 끝남, noun = 명사에서 끝나 뒤에 동사·계사 어미가 붙어야 함). 서술어 단어 꼴 `wordForm`: finite(-음 체 ㅁ/ㄻ 받침·-다·-요·-니다) / adnominal(-는·-던·ㄴ·ㄹ 받침: "받는", "가입한", "받을", "했을 때") / connective. **관형형이면 항상 제외**, 명사 + 명사("암 진단 AI 모델", "입원 환자", "출산 휴가 신청")·"중" + 명사("휴직 중 급여")면 제외, 연결형 뒤 두 단어 안에 업무 명사(`WORK_NOUNS`: 모델·앱·플랫폼·기능·시스템·서비스·통계·데이터·대시보드·예약·관리·로직·공지·배너·흐름·콘텐츠·챗봇 …)가 오면 제외("입원하고 퇴원하는 흐름"). 질환명 구절은 경험 동사(진단을 받·치료를 받·앓·겪·이 있·으로 휴직/퇴사·치료로/치료 중에/치료 뒤)로만. 일반 "진단을 받"·"정신과 진료"·"투병/항암" 단독은 뺌 |
| QA-03 [Major] 누락 13건 | strong(동사형): 서술어가 finite이거나 연결형(업무 명사 없음)이고, 표지가 있거나 문장에 다른 사람 명사가 없으면 걸림 — "입원함", "병가를 냄", "출산함", "임신함", "육아휴직을 함", "출산 휴가를 씀", "가족 간병으로 휴직함", "번아웃으로 퇴사함", "노조 활동을 함", "선거 운동을 함", "교회에 다님". 명사 어간(입원·휴직·임신·출산·유산·간병·투병)은 조사 뒤 서술어("육아휴직을 함")도 봄. weak(신자·조합원·당원·신앙·지지 정당·정치 성향): 표지가 있거나(조사만 와도 — "제 지지 정당은 …") 다른 사람 없이 finite 계사("천주교 신자임", "조합원임")일 때. 다른 사람 주어 바로 뒤("환자가 입원함")는 제외 유지 |
| 픽스처 | `__fixtures__/AI-12/sensitive-probes.ts`: `WORK_SENTENCES` 52개(진단 13 + QA-02 19 + 점검 4의 9 + 추가) 모두 `[]`, `PERSONAL_SENTENCES` 35개(QA-03 14 + 기존 양성·연락처·실명) 범주까지 일치. 한 발화로 이어 붙인 업무 문장 전체도 `[]`. `wordForm` 표 테스트 |
| QA-04 [Minor] ㅁ 명사형 | `nominalStems()`(한글 자모 계산): 3자 이하 한글 토큰의 끝 음절 받침이 ㅁ이면 받침 뺀 형("높임" → 높이)과 끝 음절 뺀 형(→ 높), ㄻ이면 ㄹ로 바꾼 형("만듦" → 만들, "이끎" → 이끌). `uncoveredRatio`(V-9e·V-10e 공통)가 이 어간으로도 찾음. 1음절 어간은 인용에서 단어 첫머리일 때만. 만듦·맡음·높임·줄임·바꿈·이끎 ↔ "-었어요" 모두 0%. V-10e 테스트 추가(`v10.test.ts` "V-10e -음 체") |
| R8-QA-4 (리더 결정) `review_reason` | `StarChange.review_reason`: V-9j → `existing_missing`(V-9e와 겹치면 V-9j 우선), V-9e → `content_unverified`, 그 외 null. `toDraftPatch`는 `review = needs_review`이고 이유가 있을 때만 `review` 옆에 `review_reason`을 넣음(db-engineer 노트 "QA 1라운드 수정" R8-QA-4 키·값과 일치: 키 없음/null 허용). `StarFieldSchema`에 선택 키 `review_reason`(모르는 값은 읽지 않음, `.catch`). 기간 패치엔 안 넣음(DB가 STAR만 저장). V-9f 상황 후보의 needs_review는 이유 null |
| QA-01 보조 | **스키마는 그대로**(`append` enum 제거는 과거 출력·재시도 파싱과 공급자 정본 스키마를 바꿈). 대신 V-9에서 **기존 텍스트가 있는 필드의 `append`를 합친 `set`으로 변환**: 값 = `filledStarText`(미반영 `set` 제안이면 그 값, `append` 제안이면 폼 + 줄바꿈 + 제안, 같은 턴 앞선 패치가 있으면 그 결과) + 줄바꿈 + 새 문장. 덧붙인 문장 자체는 기존처럼 인용만으로 V-9c·d·e 검사, 중복 문장은 무변경, 길이는 합친 길이, 출처는 합친 set 규칙대로 이월, V-9j 생략(기존 텍스트를 그대로 담음). `report.append_merged` 추가. 결과적으로 RPC는 AI 패치에서 값 있는 필드의 `append`를 받지 않는다(빈 필드 append는 원래대로 set). RPC 쪽 op 유지 수정(db-engineer)과 이중 방어 |
| QA-06 [Minor] | 주석 수정: "toDraftPatch keeps the first 20 (clampSources); the RPC rejects more". 테스트: 이월 출처 21개 → 변경은 21개, `toDraftPatch` 페이로드는 새 출처가 맨 앞인 20개(인용도 20개) |

재검사: `pnpm vitest run src/server` 1,891 tests 통과, `pnpm typecheck` 통과, `pnpm lint` 경고·오류 없음.

남은 가정: 관형형으로 쓴 본인 서술("제가 입원했을 때 프로젝트가 밀렸어요")은 걸지 않는다(리더 방향 — 업무 문장 정밀도 우선, 모델 `sensitive_flags`가 보조). 업무 명사 목록·"두 단어 안" 창은 `[가정]` 상수.
