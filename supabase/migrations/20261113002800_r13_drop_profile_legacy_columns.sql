-- DESTRUCTIVE: profiles.total_years_of_experience / desired_job_title / interested_industries 값 영구 삭제
--
-- R13 ⑭ (DM v4.12 §2.1.1 ④; SD-2·SD-A17·SD-A4). The three columns are gone from the screen, from the AI input
-- (SD-6) and from the readiness response (§6-A), and no document asks for them to be kept. The values are not
-- recoverable.
--
-- 원격(운영) 반영 순서 — DM §11.7 "원격 반영 순서 주의":
--   이 파일은 ⑧(get_data_readiness 교체)·⑬(권한 정리)과 **읽는 코드 제거 배포**가 끝난 뒤에만 올린다.
--   get_data_readiness나 컨텍스트 팩이 아직 옛 컬럼을 읽는 상태에서 drop하면 AI 실행과 커리어 화면이 함께 멈춘다.
--   (로컬 db reset은 같은 실행에 포함한다.)
--
-- interested_industries → interested_industry 백필은 ⑤에서 이미 끝났다.
-- evidence_links의 source_field CHECK는 이 세 이름을 **문자열로만** 담고 있어(컬럼 의존 없음) 건드리지 않는다.

alter table public.profiles
  drop column total_years_of_experience,
  drop column desired_job_title,
  drop column interested_industries;
