# S9 계정·보관 요약

- 상태: done (2026-11-04). QA 2라운드를 거쳤고, Critical·Major는 없다. Minor 1건(QA-S9-07, 테스트 보강)이 열려 있다.
- 연결: UI 없음 → A1 settings·deletion "연결 대기"
- 마지막 슬라이스라서 S1~S9 전체 점검을 함께 했다(아래).

## 만든 것
- **DB** (마이그레이션 `20261104000100`~`0300`)
  - `account_deletion_logs`: 서버 비밀값으로 만든 HMAC만 남긴다. 사용자 id·이메일·FK는 없고, 사용자 역할에는 권한이 없다.
  - `get_account_deletion_summary()`: 커리어, 기업 JD, AI 연결의 개수와 키 보유 여부를 돌려준다.
  - `delete_account(p_subject_hash)`
    - 사용자 데이터가 있는 테이블 28개와 `profiles`를 명시적으로 삭제한다. 키는 즉시 hard delete한다.
    - 다시 호출해도 결과가 같고, 로그는 1행만 남는다.
    - 잠금 순서: 지원 프로젝트 → 결과, 대화 → 메시지. S4~S8과 같은 방향이다.
  - 정리 RPC 4개(service_role 전용, 호출당 행 수 상한, 잠긴 행은 건너뜀)
    - 연결 안 된 대화: 90일
    - 끝난 작업: 90일
    - 사용 기록: KST 13개월
    - 파기 기록: 3년
  - 테스트
    - 카탈로그 기반 탈퇴 누락 검사
    - `ai_jobs`를 가리키는 FK 9개의 set null 검사
    - 전체 RLS 검사, `authenticated` 실행 함수 허용 목록(33개), service_role 전용 함수 검사(6개)
- **API**
  - `getAccountDeletionSummary`: 키가 있으면 공급자 쪽 폐기 권장 플래그를 함께 준다(NFR-KEY-09).
  - `deleteAccount`
    - 순서: 사전 확인(해시 비밀값, service role) → 진행 중 작업 취소 요청 → RPC(교착이 나면 1회 재시도) → auth 사용자 삭제 → 로그아웃
    - 실패 코드
      - `account_deletion_busy`(503): 아무것도 지우지 않은 상태다.
      - `account_deletion_incomplete`(500): auth 삭제만 실패했고, 재시도할 수 있다.
  - `GET /api/cron/retention`: 정리 RPC를 부르고 개수만 로그에 남긴다. 남은 행은 다음 실행으로 넘긴다.
  - `vercel.json`: 크론 2개를 등록했다(ai-jobs 02:00 KST, retention 03:00 KST). 배포는 하지 않았다.
  - 새 환경 변수 `ACCOUNT_DELETION_HASH_SECRET`(32자 이상)
  - 작업 유형 11개는 모두 실행기 등록 또는 요청 범위 둘 중 하나다(테스트로 강제).

## 검사
| 검사 | 결과 |
|------|------|
| typecheck | 통과 |
| lint | 통과 |
| Vitest | 통과 (88파일, 1363개, 통합 테스트 포함) |
| build | 통과 |
| pgTAP | 통과 (43파일, 2035개) |

## 전체 점검 (S1~S9)
- RLS가 꺼진 public 테이블이 없다.
- anon이나 PUBLIC이 실행할 수 있는 함수가 없다.
- definer 함수는 모두 `search_path`를 고정한다.
- `app_ai_writer`는 커리어 테이블에 쓰기 권한이 없다. 결과 쓰기는 소유 검사와 실행 세대 검사를 하는 definer RPC로만 한다.
- 결과 소유자 유형마다 근거(`evidence_links`)가 함께 삭제된다. 삭제 영향은 인사이트, 초안, 초안 섹션, 면접 세션을 모두 센다.
- `src/server` 로그에 프롬프트, 답변, JD 원문, 키가 없다.

## 열린 이슈
- QA-S9-07 [Minor, db]: 탈퇴 후 키 조회 거부 테스트는 탈퇴 전에도 이미 통과한다(실행 중 작업에 heartbeat가 없음). 실제 동작은 맞고 테스트만 약하다.
  - 고칠 방법: 탈퇴 전에 키가 조회되는지 단언을 추가한다.

## 사용자 확인이 필요한 `[가정]`
1. 사용 기록 13개월은 이번 KST 월과 그 전 12개월이다.
2. 보관 크론은 매일 KST 03:00에 돈다. Hobby 플랜에서는 ai-jobs 크론도 하루 1회라서 안전망 역할만 한다(Pro 플랜에서는 5분마다).
3. 탈퇴 확인은 체크 플래그(`confirm: true`)로 한다. S-25에 입력 문구가 없어서다.
4. 탈퇴 후 화면은 `/`로 간다.
5. 파기 기록은 HMAC만 남긴다. 재가입 추적에는 쓰지 않는다.

## 기획 확인이 필요한 것
- S-25 문구: `account_deletion_busy`("지운 것은 없어요, 잠시 후 다시")와 `account_deletion_incomplete`를 구분해야 한다.
- 탈퇴가 끝나지 않은 사용자가 화면을 벗어나면 동의 게이트에 막힌다. S-25로 돌아오는 경로가 필요하다.
- `app_ai_writer`의 `evidence_links` 직접 INSERT 권한은 쓰는 코드가 없다. 데이터 모델에서 빼는 것을 제안한다.
- DM 6.1의 "auth.users 삭제 + 전체 cascade"는 실제로는 RPC의 명시적 삭제이고, cascade는 안전망이다.

상세: `02_*_notes.md`, `03_backend-qa_report.md`, `spec-gaps.md` 2026-11-04 S9 (db/api/QA).
