-- R13 ① profile_options (DM v4.12 §2.1.1 DM-22, §5; PRD 9.7, SD-A2·SD-A4·SD-Q2 확정 2026-11-05).
-- Reference table for the settings dialog "내 정보" selects. No user_id: rows are operator data.
-- Codes are stable snake_case keys made here from the confirmed PRD 9.7 labels (D-DM-13 확정). A label may
-- change later with an update; the code never changes. A retired value becomes is_active = false, never a delete.
--
-- 라벨 → 코드 매핑 (PRD 9.7, 2026-11-05 확정 라벨 기준. 이 표가 코드 키의 원천이다)
--
-- (1) job_search_status (7)
--   재직 중 — 이직 고려 중                        -> employed_considering
--   재직 중 — 적극적으로 이직 준비                -> employed_actively_looking
--   재직 중 — 이직 계획 없음(커리어 정리만)        -> employed_not_looking
--   퇴사 후 구직 중                               -> unemployed_job_seeking
--   휴직·휴식 중                                  -> on_leave_or_break
--   프리랜서·계약직 — 다음 일 찾는 중              -> freelancer_seeking_next
--   창업·사업 중                                  -> founder_or_self_employed
--
-- (2) company_type (9)
--   대기업                                        -> large_enterprise
--   중견기업                                      -> mid_sized_enterprise
--   중소기업                                      -> small_business
--   스타트업(시드~시리즈 A)                        -> startup_seed_series_a
--   스타트업(시리즈 B 이상·유니콘)                 -> startup_series_b_plus
--   외국계 기업                                   -> foreign_company
--   금융권                                        -> financial_institution
--   공공기관·공기업                                -> public_sector
--   에이전시·컨설팅펌                              -> agency_consulting
--
-- (3) industry (11)
--   IT·소프트웨어·플랫폼                           -> it_software_platform
--   B2B SaaS·기업 솔루션                           -> b2b_saas
--   이커머스·리테일                                -> ecommerce_retail
--   금융·보험·핀테크                               -> finance_insurance_fintech
--   게임                                          -> game
--   콘텐츠·미디어·엔터테인먼트                      -> content_media_entertainment
--   교육·에듀테크                                  -> education_edutech
--   헬스케어·바이오                                -> healthcare_bio
--   제조·하드웨어·모빌리티                          -> manufacturing_hardware_mobility
--   물류·유통                                      -> logistics_distribution
--   광고·마케팅                                    -> advertising_marketing
--
-- (4) job_family (8)
--   개발·엔지니어링                                -> engineering
--   데이터·AI                                      -> data_ai
--   기획·PM                                        -> product_planning
--   디자인                                        -> design
--   마케팅                                        -> marketing
--   영업·사업개발                                  -> sales_bd
--   운영·CX                                        -> operations_cx
--   경영지원                                      -> corporate_support
--
-- (5) job_role (52, parent_code = 상위 job_family 코드)
--   engineering:        백엔드 backend / 프론트엔드 frontend / 풀스택 fullstack /
--                       모바일(iOS·Android) mobile / DevOps·인프라 devops_infra / QA·테스트 qa_test /
--                       정보보안 security / 임베디드·펌웨어 embedded_firmware                        (8)
--   data_ai:            데이터 분석 data_analysis / 데이터 사이언스 data_science /
--                       데이터 엔지니어링 data_engineering / 머신러닝·AI 엔지니어링 ml_ai_engineering /
--                       BI·데이터 시각화 bi_visualization / MLOps mlops                              (6)
--   product_planning:   서비스 기획 service_planning / 프로덕트 매니저(PM) product_manager /
--                       프로덕트 오너(PO) product_owner / 프로젝트 매니저 project_manager /
--                       사업기획·전략 business_planning_strategy / 비즈니스 분석(BA) business_analysis /
--                       그로스 growth                                                                (7)
--   design:             UX·UI 디자인 ux_ui_design / 프로덕트 디자인 product_design /
--                       BX·브랜드 디자인 bx_brand_design / 그래픽 디자인 graphic_design /
--                       영상·모션 디자인 video_motion_design / UX 리서치 ux_research                 (6)
--   marketing:          퍼포먼스 마케팅 performance_marketing / 브랜드 마케팅 brand_marketing /
--                       콘텐츠 마케팅 content_marketing / 그로스 마케팅 growth_marketing /
--                       CRM·마케팅 자동화 crm_marketing_automation / 마케팅 기획 marketing_planning /
--                       홍보·PR pr                                                                   (7)
--   sales_bd:           B2B 영업 b2b_sales / 사업개발(BD) business_development /
--                       파트너십·제휴 partnership / 세일즈 기획·운영 sales_planning_ops /
--                       고객 성공(CSM) customer_success / 해외 영업 global_sales                     (6)
--   operations_cx:      서비스 운영 service_operations / 고객 지원(CX) customer_support /
--                       커뮤니티 운영 community_management / 물류·공급망 운영 logistics_scm_operations /
--                       운영 기획 operations_planning / 품질 관리 quality_management                 (6)
--   corporate_support:  인사(HR)·채용 hr_recruiting / 조직문화·HRD culture_hrd /
--                       재무·회계 finance_accounting / 법무·컴플라이언스 legal_compliance /
--                       전략기획 strategy_planning / 총무·IT 지원 ga_it_support                      (6)
--
-- (6) degree (8)
--   고등학교 졸업                                  -> high_school
--   전문학사(2·3년제)                              -> associate
--   학사                                          -> bachelor
--   석사                                          -> master
--   MBA                                           -> mba
--   박사                                          -> doctorate
--   비학위 과정(부트캠프·교육과정)                  -> non_degree_program
--   기타                                          -> other
--
-- (7) graduation_status (6)
--   졸업                                          -> graduated
--   졸업 예정                                      -> expected_graduation
--   재학 중                                        -> enrolled
--   휴학 중                                        -> on_leave
--   수료                                          -> completed_coursework
--   중퇴                                          -> dropped_out

create table public.profile_options (
  category text not null,
  code text not null,
  parent_code text,
  label text not null,
  sort_order integer not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profile_options_pkey primary key (category, code),
  -- Only the category list is fixed here; the values themselves are rows (DM §2.1.1).
  constraint profile_options_category_check check (category in (
    'job_search_status', 'company_type', 'industry', 'job_family', 'job_role',
    'degree', 'graduation_status')),
  constraint profile_options_code_check check (code ~ '^[a-z][a-z0-9_]{0,59}$'),
  constraint profile_options_label_check check (char_length(label) between 1 and 100),
  -- parent_code belongs to job_role only, and is required there (DM §2.1.1).
  constraint profile_options_parent_code_check check (
    (category = 'job_role' and parent_code is not null)
    or (category <> 'job_role' and parent_code is null))
  -- No FK on parent_code: it points at a *job_family* row, i.e. (category = 'job_family', code = parent_code),
  -- which a self FK on (category, code) cannot express. The pair check lives in the seed guard below and in
  -- private.validate_profile_options (④), which is what user rows are checked against.
);

create index profile_options_category_sort_order_idx
  on public.profile_options (category, sort_order);

create trigger profile_options_set_updated_at
  before update on public.profile_options
  for each row execute function private.set_updated_at();

alter table public.profile_options enable row level security;

-- DM §5: select for every authenticated user, writes operator only (no insert/update/delete policy).
-- app_ai_writer gets nothing (DM §2.1.5, SD-6).
create policy profile_options_select_all on public.profile_options
  for select to authenticated using (true);

grant select on table public.profile_options to authenticated;

-- ── Seed (PRD 9.7, 확정 2026-11-05) ──
insert into public.profile_options (category, code, parent_code, label, sort_order) values
  ('job_search_status', 'employed_considering',      null, '재직 중 — 이직 고려 중', 1),
  ('job_search_status', 'employed_actively_looking', null, '재직 중 — 적극적으로 이직 준비', 2),
  ('job_search_status', 'employed_not_looking',      null, '재직 중 — 이직 계획 없음(커리어 정리만)', 3),
  ('job_search_status', 'unemployed_job_seeking',    null, '퇴사 후 구직 중', 4),
  ('job_search_status', 'on_leave_or_break',         null, '휴직·휴식 중', 5),
  ('job_search_status', 'freelancer_seeking_next',   null, '프리랜서·계약직 — 다음 일 찾는 중', 6),
  ('job_search_status', 'founder_or_self_employed',  null, '창업·사업 중', 7),

  ('company_type', 'large_enterprise',      null, '대기업', 1),
  ('company_type', 'mid_sized_enterprise',  null, '중견기업', 2),
  ('company_type', 'small_business',        null, '중소기업', 3),
  ('company_type', 'startup_seed_series_a', null, '스타트업(시드~시리즈 A)', 4),
  ('company_type', 'startup_series_b_plus', null, '스타트업(시리즈 B 이상·유니콘)', 5),
  ('company_type', 'foreign_company',       null, '외국계 기업', 6),
  ('company_type', 'financial_institution', null, '금융권', 7),
  ('company_type', 'public_sector',         null, '공공기관·공기업', 8),
  ('company_type', 'agency_consulting',     null, '에이전시·컨설팅펌', 9),

  ('industry', 'it_software_platform',            null, 'IT·소프트웨어·플랫폼', 1),
  ('industry', 'b2b_saas',                        null, 'B2B SaaS·기업 솔루션', 2),
  ('industry', 'ecommerce_retail',                null, '이커머스·리테일', 3),
  ('industry', 'finance_insurance_fintech',       null, '금융·보험·핀테크', 4),
  ('industry', 'game',                            null, '게임', 5),
  ('industry', 'content_media_entertainment',     null, '콘텐츠·미디어·엔터테인먼트', 6),
  ('industry', 'education_edutech',               null, '교육·에듀테크', 7),
  ('industry', 'healthcare_bio',                  null, '헬스케어·바이오', 8),
  ('industry', 'manufacturing_hardware_mobility', null, '제조·하드웨어·모빌리티', 9),
  ('industry', 'logistics_distribution',          null, '물류·유통', 10),
  ('industry', 'advertising_marketing',           null, '광고·마케팅', 11),

  ('job_family', 'engineering',        null, '개발·엔지니어링', 1),
  ('job_family', 'data_ai',            null, '데이터·AI', 2),
  ('job_family', 'product_planning',   null, '기획·PM', 3),
  ('job_family', 'design',             null, '디자인', 4),
  ('job_family', 'marketing',          null, '마케팅', 5),
  ('job_family', 'sales_bd',           null, '영업·사업개발', 6),
  ('job_family', 'operations_cx',      null, '운영·CX', 7),
  ('job_family', 'corporate_support',  null, '경영지원', 8),

  ('degree', 'high_school',        null, '고등학교 졸업', 1),
  ('degree', 'associate',          null, '전문학사(2·3년제)', 2),
  ('degree', 'bachelor',           null, '학사', 3),
  ('degree', 'master',             null, '석사', 4),
  ('degree', 'mba',                null, 'MBA', 5),
  ('degree', 'doctorate',          null, '박사', 6),
  ('degree', 'non_degree_program', null, '비학위 과정(부트캠프·교육과정)', 7),
  ('degree', 'other',              null, '기타', 8),

  ('graduation_status', 'graduated',            null, '졸업', 1),
  ('graduation_status', 'expected_graduation',  null, '졸업 예정', 2),
  ('graduation_status', 'enrolled',             null, '재학 중', 3),
  ('graduation_status', 'on_leave',             null, '휴학 중', 4),
  ('graduation_status', 'completed_coursework', null, '수료', 5),
  ('graduation_status', 'dropped_out',          null, '중퇴', 6);

-- job_role (52). sort_order runs inside each job family.
insert into public.profile_options (category, code, parent_code, label, sort_order) values
  ('job_role', 'backend',            'engineering', '백엔드', 1),
  ('job_role', 'frontend',           'engineering', '프론트엔드', 2),
  ('job_role', 'fullstack',          'engineering', '풀스택', 3),
  ('job_role', 'mobile',             'engineering', '모바일(iOS·Android)', 4),
  ('job_role', 'devops_infra',       'engineering', 'DevOps·인프라', 5),
  ('job_role', 'qa_test',            'engineering', 'QA·테스트', 6),
  ('job_role', 'security',           'engineering', '정보보안', 7),
  ('job_role', 'embedded_firmware',  'engineering', '임베디드·펌웨어', 8),

  ('job_role', 'data_analysis',      'data_ai', '데이터 분석', 1),
  ('job_role', 'data_science',       'data_ai', '데이터 사이언스', 2),
  ('job_role', 'data_engineering',   'data_ai', '데이터 엔지니어링', 3),
  ('job_role', 'ml_ai_engineering',  'data_ai', '머신러닝·AI 엔지니어링', 4),
  ('job_role', 'bi_visualization',   'data_ai', 'BI·데이터 시각화', 5),
  ('job_role', 'mlops',              'data_ai', 'MLOps', 6),

  ('job_role', 'service_planning',            'product_planning', '서비스 기획', 1),
  ('job_role', 'product_manager',             'product_planning', '프로덕트 매니저(PM)', 2),
  ('job_role', 'product_owner',               'product_planning', '프로덕트 오너(PO)', 3),
  ('job_role', 'project_manager',             'product_planning', '프로젝트 매니저', 4),
  ('job_role', 'business_planning_strategy',  'product_planning', '사업기획·전략', 5),
  ('job_role', 'business_analysis',           'product_planning', '비즈니스 분석(BA)', 6),
  ('job_role', 'growth',                      'product_planning', '그로스', 7),

  ('job_role', 'ux_ui_design',        'design', 'UX·UI 디자인', 1),
  ('job_role', 'product_design',      'design', '프로덕트 디자인', 2),
  ('job_role', 'bx_brand_design',     'design', 'BX·브랜드 디자인', 3),
  ('job_role', 'graphic_design',      'design', '그래픽 디자인', 4),
  ('job_role', 'video_motion_design', 'design', '영상·모션 디자인', 5),
  ('job_role', 'ux_research',         'design', 'UX 리서치', 6),

  ('job_role', 'performance_marketing',      'marketing', '퍼포먼스 마케팅', 1),
  ('job_role', 'brand_marketing',            'marketing', '브랜드 마케팅', 2),
  ('job_role', 'content_marketing',          'marketing', '콘텐츠 마케팅', 3),
  ('job_role', 'growth_marketing',           'marketing', '그로스 마케팅', 4),
  ('job_role', 'crm_marketing_automation',   'marketing', 'CRM·마케팅 자동화', 5),
  ('job_role', 'marketing_planning',         'marketing', '마케팅 기획', 6),
  ('job_role', 'pr',                         'marketing', '홍보·PR', 7),

  ('job_role', 'b2b_sales',            'sales_bd', 'B2B 영업', 1),
  ('job_role', 'business_development', 'sales_bd', '사업개발(BD)', 2),
  ('job_role', 'partnership',          'sales_bd', '파트너십·제휴', 3),
  ('job_role', 'sales_planning_ops',   'sales_bd', '세일즈 기획·운영', 4),
  ('job_role', 'customer_success',     'sales_bd', '고객 성공(CSM)', 5),
  ('job_role', 'global_sales',         'sales_bd', '해외 영업', 6),

  ('job_role', 'service_operations',        'operations_cx', '서비스 운영', 1),
  ('job_role', 'customer_support',          'operations_cx', '고객 지원(CX)', 2),
  ('job_role', 'community_management',      'operations_cx', '커뮤니티 운영', 3),
  ('job_role', 'logistics_scm_operations',  'operations_cx', '물류·공급망 운영', 4),
  ('job_role', 'operations_planning',       'operations_cx', '운영 기획', 5),
  ('job_role', 'quality_management',        'operations_cx', '품질 관리', 6),

  ('job_role', 'hr_recruiting',       'corporate_support', '인사(HR)·채용', 1),
  ('job_role', 'culture_hrd',         'corporate_support', '조직문화·HRD', 2),
  ('job_role', 'finance_accounting',  'corporate_support', '재무·회계', 3),
  ('job_role', 'legal_compliance',    'corporate_support', '법무·컴플라이언스', 4),
  ('job_role', 'strategy_planning',   'corporate_support', '전략기획', 5),
  ('job_role', 'ga_it_support',       'corporate_support', '총무·IT 지원', 6);

-- Seed counts (PRD 9.7): 7 / 9 / 11 / 8 / 52 / 8 / 6.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s=%s', category, n), ', ' order by category) into v_bad
    from (select category, count(*) as n from public.profile_options group by category) c
   where (category, n) not in (('job_search_status', 7), ('company_type', 9), ('industry', 11),
                               ('job_family', 8), ('job_role', 52), ('degree', 8), ('graduation_status', 6));
  if v_bad is not null then
    raise exception 'profile_options seed count mismatch: %', v_bad;
  end if;
  -- Every job_role parent must be a job_family code.
  if exists (select 1 from public.profile_options r
              where r.category = 'job_role'
                and not exists (select 1 from public.profile_options f
                                 where f.category = 'job_family' and f.code = r.parent_code)) then
    raise exception 'profile_options seed has a job_role with an unknown parent_code';
  end if;
end;
$$;
