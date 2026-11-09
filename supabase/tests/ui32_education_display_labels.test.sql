-- UI32-2: education display name (trimmed program_name, else trimmed institution_name, else null).
-- R15 (CL-3·CF-1): the label builders (private.draft_source_label / draft_source_parent_name), the
-- draft_section_sources delete triggers and private.backfill_education_display_labels were dropped with the
-- drafts tables, so only the surviving helper (private.education_display_name / trim_js_whitespace) is
-- asserted here. The education evidence labels are covered by evidence_links.test.sql.
-- the education / project delete triggers, and the stored-label backfill.
begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ── helper ──
select is(private.education_display_name('  데이터 분석 과정 ', '한빛대'), '데이터 분석 과정', 'helper: trimmed program first');
select is(private.education_display_name('   ', ' 한빛대 '), '한빛대', 'helper: blank program -> trimmed institution');
select is(private.education_display_name(null, '한빛대'), '한빛대', 'helper: null program -> institution');
select is(private.education_display_name(' ', ''), null, 'helper: both blank -> null');
select is(private.education_display_name(null, null), null, 'helper: both null -> null');
-- QA-01: same whitespace set as JS String.prototype.trim(), not just U+0020.
select is(private.education_display_name(E'\t', '한빛대'), '한빛대', 'helper: tab-only program -> institution (JS trim)');
select is(private.education_display_name(E'　데이터　', '한빛대'), '데이터', 'helper: full-width spaces trimmed (U+3000)');
select is(private.education_display_name(E'　', E' 한빛대\n'), '한빛대', 'helper: U+3000-only program -> NBSP/newline-trimmed institution');
select is(private.education_display_name(E'\t\r\n', E'﻿ '), null, 'helper: tab/newline/BOM/em-space only -> null');
select is(private.trim_js_whitespace(E'\u0085a b\u0085'), E'\u0085a b\u0085', 'trim: U+0085 kept, inner space kept (as JS)');


select * from finish();
rollback;
