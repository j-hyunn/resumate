# R17 원격 push 전 읽기 전용 집계 (DM v4.16 11.11 (4) 0단계)

- 작성: db-engineer, 2026-11-16
- 대상 마이그레이션: `20261113004800_r17_jd_raw_text_cleanup.sql`(A, DESTRUCTIVE) → `20261113004810_r17_jd_raw_text_rpcs.sql`(B, public RPC drop) → `20261113004820_r17_drop_jd_extraction.sql`(C, DESTRUCTIVE + 최종 단언)
- **사용 방법**: `db push` **직전에** 사용자가 운영 DB(SQL Editor 등)에서 아래 SQL을 **읽기 전용으로** 실행하고 결과를 "운영 값" 칸에 적는다. 쓰기 문장은 하나도 없다. 마이그레이션 A도 같은 10항목을 `raise notice`(`r17 cleanup ①~⑩`)로 남기고, 바뀐 행 수를 `r17 cleanup result: {...}`로 남긴다.
- DM은 파일 이름 예시를 `R16/`·`…_r16_…`로 적었지만, 이 브랜치의 슬라이스 이름(R17)을 따랐다 `[가정 R17b-db-12]`.
- 되돌릴 수 없다(변환·백업 테이블 없음, JR-Q3 (b)). push 전에 운영 프로젝트의 백업 시점(PITR 또는 일일 백업)을 확인한다.

## 한 번에 돌리는 SQL

```sql
-- 읽기 전용. 결과 10행.
select '① jd_requirements 행' as item, count(*)::text as value from public.jd_requirements
union all
select '② job_descriptions extraction_status별',
       coalesce(string_agg(s || '=' || c, ', ' order by s), '-')
  from (select extraction_status s, count(*) c from public.job_descriptions group by 1) t
union all
select '③ insights schema_version/status별',
       coalesce(string_agg(coalesce(sv::text, 'null') || '/' || st || '=' || c, ', ' order by sv, st), '-')
  from (select schema_version sv, status st, count(*) c from public.insights group by 1, 2) t
union all
select '④ jd_requirement 근거 owner_type별',
       coalesce(string_agg(o || '=' || c, ', ' order by o), '-')
  from (select owner_type o, count(*) c from public.evidence_links where source_type = 'jd_requirement' group by 1) t
union all
select '⑤ application_document 소유 jd_sentence 근거', count(*)::text
  from public.evidence_links where owner_type = 'application_document' and source_type = 'jd_sentence'
union all
select '⑥ structured_draft에 JD 출처가 있는 서류 대화', count(*)::text
  from public.writing_chats w
 where w.document_kind is not null
   and jsonb_path_exists(w.structured_draft,
         'strict $.** ? (@.source_type == "jd_requirement" || @.source_type == "jd_sentence")')
union all
select '⑦ queued/running jd_extraction 작업', count(*)::text
  from public.ai_jobs where job_type = 'jd_extraction' and status in ('queued', 'running')
union all
select '⑧ output이 남은 jd_preview 작업', count(*)::text
  from public.ai_jobs where target_type = 'jd_preview' and (output is not null or step_outputs <> '{}'::jsonb)
union all
select '⑨ name is null 지원 프로젝트', count(*)::text from public.application_projects where name is null
union all
select '⑩ sentences 0개 JD', count(*)::text from public.job_descriptions where jsonb_array_length(sentences) = 0;
```

## 항목별 (같은 SQL을 나눠 둔 것)

| # | 항목 | SQL | 마이그레이션에서 일어나는 일 | 운영 값 |
|---|------|-----|------------------------------|---------|
| ① | `jd_requirements` 행 | `select count(*) from public.jd_requirements;` | C가 테이블째 drop | |
| ② | `job_descriptions` `extraction_status`별 | `select extraction_status, count(*) from public.job_descriptions group by 1;` | C가 컬럼 drop(값 없어짐). 행은 남음 | |
| ③ | `insights` `schema_version`·`status`별 | `select schema_version, status, count(*) from public.insights group by 1, 2;` | 남음(`schema_version = 1`은 화면에서 "다시 만들어야 해요"). A가 `raw_text_hash`를 JD 현재 해시로 채움 | |
| ④ | `jd_requirement` 근거 (`owner_type`별) | `select owner_type, count(*) from public.evidence_links where source_type = 'jd_requirement' group by 1;` | A가 **전부 삭제** | |
| ⑤ | `application_document` 소유 `jd_sentence` 근거 | `select count(*) from public.evidence_links where owner_type = 'application_document' and source_type = 'jd_sentence';` | A가 **전부 삭제** | |
| ⑥ | JD 출처가 든 서류 대화 | 위 통합 SQL의 ⑥ | A가 그 출처 원소만 제거(제안 자체는 남음) | |
| ⑦ | `queued`/`running` `jd_extraction` 작업 | `select count(*) from public.ai_jobs where job_type = 'jd_extraction' and status in ('queued','running');` | A가 `canceled`/`canceled`로 닫음 | |
| ⑧ | `output`이 남은 `jd_preview` 작업 | 위 통합 SQL의 ⑧ | A가 `output = null`, `step_outputs = '{}'` | |
| ⑨ | `name is null` 지원 프로젝트 | `select count(*) from public.application_projects where name is null;` | A가 "새 자기소개서 (생성일 KST)"(`default`)로 채움 | |
| ⑩ | 문장 0개 JD | `select count(*) from public.job_descriptions where jsonb_array_length(sentences) = 0;` | 남음. 인사이트 시작은 `jd_no_sentences`로 거부, 원문 수정으로 고칠 수 있음 | |

## push 뒤 확인 (읽기 전용)

C의 최종 단언(`private.r17_jd_raw_text_assert()`)이 아래 5개 중 하나라도 0이 아니면 예외로 C 전체를 롤백한다. push가 성공했으면 모두 0이다.

```sql
select (select count(*) from public.evidence_links where source_type::text = 'jd_requirement') as jd_requirement_evidence,
       (select count(*) from public.evidence_links
         where owner_type = 'application_document' and source_type = 'jd_sentence') as document_jd_sentence_evidence,
       (select count(*) from public.writing_chats w where w.document_kind is not null
           and jsonb_path_exists(w.structured_draft,
                 'strict $.** ? (@.source_type == "jd_requirement" || @.source_type == "jd_sentence")')) as document_chats_with_jd,
       (select count(*) from public.application_projects where name is null) as null_names,
       (select count(*) from public.ai_jobs where job_type = 'jd_extraction'
           and status in ('queued', 'running')) as inflight_jd_extraction;
```

## 주의

- A·B·C는 파일마다 한 트랜잭션이다. A가 끝나고 B가 적용되기 전 몇 초 동안 옛 `complete_insight`(`requirements_hash`를 쓰는 판)는 실패한다 — 같은 `db push` 안에서 이어서 적용되므로 그 사이 인사이트 완료가 겹칠 확률은 낮다. push 직후 같은 PR의 앱 코드를 바로 배포한다(옛 코드는 10인자 생성 RPC·추출 RPC·`update_failed_jd_raw_text`를 불러 실패한다).
- C가 단언으로 멈추면 A·B는 이미 적용된 상태다. 원인 행을 확인하고(위 SQL), 사용자 확인을 받아 처리한 뒤 C만 다시 push한다.

## 운영 실행 기록 (2026-11-20)

| # | 항목 | 운영 값 (push 전) |
|---|------|-------------------|
| ① | `jd_requirements` 행 | 18 |
| ② | `extraction_status`별 | succeeded=1 |
| ③ | `insights` `schema_version`/`status`별 | 1/ready=1 |
| ④ | `jd_requirement` 근거 | 0 |
| ⑤ | 자소서 `jd_sentence` 근거 | 0 |
| ⑥ | JD 출처가 든 서류 대화 | 0 |
| ⑦ | 진행 중 `jd_extraction` 작업 | 0 |
| ⑧ | 출력이 남은 `jd_preview` 작업 | 0 |
| ⑨ | `name is null` 지원 프로젝트 | 0 |
| ⑩ | 문장 0개 JD | 0 |

- 백업: push 직전 `supabase db dump --linked`로 스키마·데이터 덤프(저장소 밖 로컬 보관).
- push: `20261113004790` → `004800` → `004810` → `004820` 4개 적용 성공, C 최종 단언 통과.
- push 뒤 확인: 위 "push 뒤 확인" 5개 모두 0, `jd_requirements` 테이블·추출 컬럼 없음, `insights.raw_text_hash`·`update_jd_raw_text` 존재, 2026-11-20 약관 3행.
- 코드: PR #78 merge commit `b5310eb`, push 직후 머지, Vercel 운영 배포 성공.
