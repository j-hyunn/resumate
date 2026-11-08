-- 처리방침 개정 + AI 데이터 처리 첫 시행판 (UI42-7·UI42-8, decisions 3.24·4.18 — 사용자 확인 2026-11-08).
-- 파괴적 아님: policy_versions는 버전 이력이라 기존 행을 고치지 않고 새 행만 넣는다.
--
-- privacy 2026-11-08 (원문 docs/legal/privacy-policy.md, 앱 본문 POLICY_DOCUMENTS.privacy):
--   R13(SD-2·SD-A2·SD-A4·SD-A17)로 1번 항목 표의 "기본 프로필(표시 이름·희망 직무·총 경력 연수·관심 산업)"이
--   "내 정보"(이름·구직 상태·관심 기업군·산업·직군·직무·최종 학력)로 바뀌었고, SD-6으로 "내 정보는 AI 공급자에
--   보내지 않는다"를 더했다. 학점은 **본문을 고치는 쪽으로 확정**(사용자 2026-11-08) — 기능은 그대로 두고
--   "이용자가 직접 적을 때만 보관, 성적 증명·과목별 성적은 받지 않음"으로 바꿨다. 2번 처리 목적·3번 보유 기간 표도 같은 이름으로.
--   requires_reconsent = false: 선택 항목의 이름·구성이 바뀐 개정이고 필수 동의 범위(계정)와 국외 이전 대상은
--   그대로다(초안 권고, 사용자 확인 2026-11-08). consents.consent_type은 건드리지 않아 가입 게이트에 영향이 없다.
--
-- ai_data_use 2026-11-08 (원문 docs/legal/ai-data-use.md 신설, 앱 본문 AI_DATA_USE_SECTIONS):
--   2026-11-05 행(20261113002500)은 본문 원문 없이 기존 화면 문구를 조합한 상태였다. 원문이 생겼으므로
--   그 행을 고치지 않고 새 버전 행을 넣는다(같은 파일의 주석 규칙). 재동의 없음 — 고지 문서이고 동의는
--   키 연결 때 공급자별로 받는다(ai_data_use_consents).
--   공급자별 사실은 여기서 다루지 않는다: ai_disclosures(공급자 × 등급 6행)가 그대로 원천이다.
--
-- 앱 본문과 같은 머지로 나가야 한다. 이 행만 먼저 올리면 화면이 옛 본문에 새 시행일을 보인다.

insert into public.policy_versions (policy_type, version, effective_at, requires_reconsent, document_path)
values
  ('privacy', '2026-11-08', '2026-11-08 00:00:00+09', false, '/policies/privacy/2026-11-08'),
  ('ai_data_use', '2026-11-08', '2026-11-08 00:00:00+09', false, '/policies/ai_data_use/2026-11-08')
on conflict (policy_type, version) do nothing;
