# 기획 결정 입력 — 처리방침·이용약관 확정과 장기 미접속 파기 (2026-11-04)

- 사이클 슬러그: `privacy-terms` / 결정 ID 접두어: `PT-`
- 출처: 사용자 대화(2026-11-04), 구현 PR j-hyunn/resumate#24(처리방침·약관, S-03 연령 확인, S-30 문서별 페이지), #25(1년 미접속 계정 파기)
- 법무 문서 원본: `docs/legal/privacy-policy.md`, `docs/legal/terms-of-service.md` (앱 본문 `src/components/account/policy-content.ts`)
- 기준 문서 버전: PRD v4.7, UX v5.7, DM v4.5, decisions 2026-11-04(3.11)
- 성격: 사용자가 이미 정했고 구현까지 끝난 결정을 기획에 반영하는 사이클. 새 사용자 질문 없음.

| ID | 결정 | 바뀌는 기존 결정 | 영향 |
|----|------|------------------|------|
| PT-1 | 개인정보 처리방침·이용약관 본문 확정, 시행일 2026-11-04. 운영자·대표자·개인정보 보호책임자 김제현, 문의 lab.jehyun@gmail.com, 사업자등록번호 없음. `policy_versions`에 `2026-11-04` 3행 추가(terms·privacy `requires_reconsent = true`, cross_border_transfer `false`) → 임시 버전 동의자는 다음 로그인 때 S-03 재동의 | D-10의 "정책 문서 버전·문구" 부분 해소(AI 고지 `ai_disclosures` 문구·무료 등급 문장은 계속 출시 전 확정) | PRD D-10·NFR-PRV-10, DM 4.5·A.2, decisions 1장 |
| PT-2 | 접속 기록(접속 일시·IP·브라우저 정보) 보관 최대 1년(인프라 로그 보관 기간을 따름, 리뷰 R-PT-6 뒤 수정) | 신규 | PRD NFR-PRV-06, DM 4.4 |
| PT-3 | **1년 미접속 계정 파기**: 마지막 접속(`coalesce(last_active_at, created_at)`) 후 1년 − 30일에 계정 이메일로 사전 안내, 안내 30일 뒤이고 마지막 접속 1년이 지나면 탈퇴와 같은 범위로 파기(`account_deletion_logs.reason = 'inactivity'`). 그 전에 로그인(활동)하면 안내 취소·계정 유지. 안내는 메일 서버가 받은 뒤에만 기록하므로 안내 없는 파기는 없다. `last_active_at`은 요청마다(브라우저·사용자별 6시간 제한) 갱신 | D-11("탈퇴 즉시 파기")에 장기 미접속 파기 추가. DM A.1 `last_active_at`·`inactivity_notice_sent_at` 컬럼의 용도 확정 | PRD NFR-PRV-06·D-11, DM 4.4·A.1·A.6, UX(화면 없음, 메일만) |
| PT-4 | 안내 메일은 **Gmail SMTP(운영자 Gmail)**로 보낸다. 처리방침 처리 위탁에 Google LLC(Gmail, 국외 처리)를 추가 | 신규 (이메일 발송 업체 없음 → Gmail) | PRD NFR-PRV-06, decisions |
| PT-5 | **만 14세 미만 가입 불가**. S-03에 필수 체크 "만 14세 이상이에요"(모두 동의에 포함, 빠지면 필수 항목 안내). 화면 확인만 하고 별도 동의 행은 저장하지 않는다(연령 조항은 이용약관 동의에 포함) | 신규 | PRD F-COM-02·NFR-PRV-01, UX S-03 |
| PT-6 | **S-30을 문서별 페이지로 분리**: `/policies/terms`, `/policies/privacy`, `/policies/cross_border_transfer`(이름 = `policy_type`. `document_path`는 기록용, 리뷰 R-PT-3). 페이지마다 제목·버전·시행일·본문 + 하단에 다른 두 문서 링크. 예전 `/policies?doc=…`는 해당 문서로, 그 밖의 `/policies`는 처리방침으로 308 리다이렉트. S-01 하단·S-02 약관 안내는 "이용약관 · 개인정보 처리방침" 두 링크. 계정 메뉴 "처리방침"은 개인정보 처리방침 페이지로 | S-30 "v3와 같음"(한 화면 탭) 대체 | UX S-01·S-02·S-30·L-01/L-02 계정 메뉴 |
| PT-7 | (리뷰 R-PT-5 뒤 사용자 결정) Gmail 보낸편지함에 남는 안내 메일 사본은 파기·탈퇴한 계정 것만 운영자가 매월 한 번 직접 삭제. 유지된 계정 것은 계정이 있는 동안 두고, 처리방침 문구를 이에 맞춘다(#25 브랜치) | #25 처리방침의 "계정 파기·재로그인 뒤 지체 없이 삭제" 대체 | PRD NFR-PRV-06, DM 4.6, decisions 4.6, 처리방침 국외 처리(Gmail) |
