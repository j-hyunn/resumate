-- R13 ⑩ get_ai_usage_summary: response replaced by the provider × feature cross aggregate
-- (DM v4.12 §2.9.5; SD-A10·SD-A11, D-UX-30). Signature, security (invoker) and grants are unchanged.
--   providers[]                  only providers with records in that month; ordered by ai_providers.display_order
--   providers[].connection_tiers tiers seen in that month's records (["free"], ["paid"], or both)
--   providers[].by_feature       the stored feature values as they are — the screen's 7-row grouping
--                                (career_description + cover_letter) is NOT done here (SD-4·SD-A12, AI C-13.1)
--   providers[].price_table_versions  versions used by that provider; the top-level one keeps the whole month
--   cost columns                 input_cost_usd / output_cost_usd summed straight from the stored columns (⑨);
--                                estimated_cost_usd comes back as the total
--   totals                       kept (period line, failed calls, include_previous basis)
--   include_previous             kept (v4.1 UB-2 (b))
--   REMOVED                      top-level by_feature and by_provider
create or replace function public.get_ai_usage_summary(
  p_period_month date default null,
  p_include_previous boolean default false
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', coalesce(p_period_month, private.current_usage_period()))::date;
  v_prev date := (date_trunc('month', coalesce(p_period_month, private.current_usage_period()))
                  - interval '1 month')::date;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception using errcode = '42501', message = 'not_authenticated';
  end if;

  select jsonb_build_object(
    'period_month', to_char(v_month, 'YYYY-MM-DD'),
    'as_of', now(),
    'totals', (
      select jsonb_build_object(
        'input_tokens', coalesce(sum(r.input_tokens), 0),
        'cached_input_tokens', coalesce(sum(r.cached_input_tokens), 0),
        'cache_write_tokens', coalesce(sum(r.cache_write_tokens), 0),
        'output_tokens', coalesce(sum(r.output_tokens), 0),
        'input_cost_usd', coalesce(sum(r.input_cost_usd), 0),
        'output_cost_usd', coalesce(sum(r.output_cost_usd), 0),
        'estimated_cost_usd', coalesce(sum(r.estimated_cost_usd), 0),
        'calls', count(*),
        'failed_calls', count(*) filter (where r.outcome = 'failed'))
        from public.ai_usage_records r
       where r.user_id = v_uid and r.period_month = v_month),
    'providers', coalesce((
      select jsonb_agg(
               jsonb_build_object(
                 'provider', p.provider,
                 'connection_tiers', p.connection_tiers,
                 'totals', jsonb_build_object(
                   'input_tokens', p.input_tokens,
                   'cached_input_tokens', p.cached_input_tokens,
                   'cache_write_tokens', p.cache_write_tokens,
                   'output_tokens', p.output_tokens,
                   'input_cost_usd', p.input_cost_usd,
                   'output_cost_usd', p.output_cost_usd,
                   'estimated_cost_usd', p.estimated_cost_usd,
                   'calls', p.calls,
                   'failed_calls', p.failed_calls),
                 'by_feature', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'feature', f.feature,
                            'input_tokens', f.input_tokens,
                            'cached_input_tokens', f.cached_input_tokens,
                            'cache_write_tokens', f.cache_write_tokens,
                            'output_tokens', f.output_tokens,
                            'input_cost_usd', f.input_cost_usd,
                            'output_cost_usd', f.output_cost_usd,
                            'estimated_cost_usd', f.estimated_cost_usd,
                            'calls', f.calls,
                            'failed_calls', f.failed_calls) order by f.feature), '[]'::jsonb)
                     from (select r.feature,
                                  sum(r.input_tokens) as input_tokens,
                                  sum(r.cached_input_tokens) as cached_input_tokens,
                                  sum(r.cache_write_tokens) as cache_write_tokens,
                                  sum(r.output_tokens) as output_tokens,
                                  sum(r.input_cost_usd) as input_cost_usd,
                                  sum(r.output_cost_usd) as output_cost_usd,
                                  sum(r.estimated_cost_usd) as estimated_cost_usd,
                                  count(*) as calls,
                                  count(*) filter (where r.outcome = 'failed') as failed_calls
                             from public.ai_usage_records r
                            where r.user_id = v_uid and r.period_month = v_month
                              and r.provider = p.provider
                            group by r.feature) f),
                 'price_table_versions', (
                   select coalesce(jsonb_agg(jsonb_build_object(
                            'version', v.version,
                            'source_checked_at', to_char(v.source_checked_at, 'YYYY-MM-DD'))
                            order by v.version), '[]'::jsonb)
                     from (select u.version, max(t.source_checked_at) as source_checked_at
                             from (select distinct r.price_table_version as version
                                     from public.ai_usage_records r
                                    where r.user_id = v_uid and r.period_month = v_month
                                      and r.provider = p.provider) u
                             left join public.ai_price_tables t on t.version = u.version
                            group by u.version) v))
               order by p.display_order, p.provider)
        from (select r.provider,
                     coalesce((select min(ap.display_order) from public.ai_providers ap
                                where ap.provider = r.provider), 2147483647) as display_order,
                     jsonb_agg(distinct r.connection_tier order by r.connection_tier) as connection_tiers,
                     sum(r.input_tokens) as input_tokens,
                     sum(r.cached_input_tokens) as cached_input_tokens,
                     sum(r.cache_write_tokens) as cache_write_tokens,
                     sum(r.output_tokens) as output_tokens,
                     sum(r.input_cost_usd) as input_cost_usd,
                     sum(r.output_cost_usd) as output_cost_usd,
                     sum(r.estimated_cost_usd) as estimated_cost_usd,
                     count(*) as calls,
                     count(*) filter (where r.outcome = 'failed') as failed_calls
                from public.ai_usage_records r
               where r.user_id = v_uid and r.period_month = v_month
               group by r.provider) p), '[]'::jsonb),
    'price_table_versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'version', v.version,
               'source_checked_at', to_char(v.source_checked_at, 'YYYY-MM-DD')) order by v.version)
        from (select u.version, max(t.source_checked_at) as source_checked_at
                from (select distinct r.price_table_version as version
                        from public.ai_usage_records r
                       where r.user_id = v_uid and r.period_month = v_month) u
                left join public.ai_price_tables t on t.version = u.version
               group by u.version) v), '[]'::jsonb)
  ) into v_result;

  if coalesce(p_include_previous, false) then
    v_result := v_result || jsonb_build_object('previous_month', (
      select jsonb_build_object(
        'period_month', to_char(v_prev, 'YYYY-MM-DD'),
        'estimated_cost_usd', coalesce(sum(r.estimated_cost_usd), 0),
        'input_tokens', coalesce(sum(r.input_tokens), 0),
        'output_tokens', coalesce(sum(r.output_tokens), 0))
        from public.ai_usage_records r
       where r.user_id = v_uid and r.period_month = v_prev));
  end if;

  return v_result;
end;
$$;

revoke all on function public.get_ai_usage_summary(date, boolean) from public, anon, app_ai_writer;
grant execute on function public.get_ai_usage_summary(date, boolean) to authenticated;
