-- Migration: 0019_queue_rpc_bootstrap.sql
-- Purpose: expose narrow pgmq RPC wrappers through the already-exposed
--          `sync` schema and create the queues consumed by workers.
-- Owner: @infra-platform

-- Supabase PostgREST exposes app/mem/sync/audit, not pgmq. Workers call
-- these SECURITY DEFINER wrappers with the service-role key instead of
-- exposing pgmq internals directly.

create or replace function sync.pgmq_send(
  queue_name text,
  message jsonb,
  sleep_seconds integer default 0
)
returns setof bigint
language sql
security definer
set search_path = pgmq, public
as $$
  select * from pgmq.send(queue_name, message, sleep_seconds);
$$;

create or replace function sync.pgmq_send_batch(
  queue_name text,
  messages jsonb,
  sleep_seconds integer default 0
)
returns setof bigint
language sql
security definer
set search_path = pgmq, public
as $$
  select *
  from pgmq.send_batch(
    queue_name,
    array(select value from jsonb_array_elements(messages)),
    sleep_seconds
  );
$$;

create or replace function sync.pgmq_read(
  queue_name text,
  sleep_seconds integer default 60,
  n integer default 1
)
returns setof pgmq.message_record
language sql
security definer
set search_path = pgmq, public
as $$
  select * from pgmq.read(queue_name, sleep_seconds, n);
$$;

create or replace function sync.pgmq_archive(queue_name text, msg_id bigint)
returns boolean
language sql
security definer
set search_path = pgmq, public
as $$
  select pgmq.archive(queue_name, msg_id);
$$;

create or replace function sync.pgmq_set_vt(
  queue_name text,
  msg_id bigint,
  vt_offset integer default 30
)
returns setof pgmq.message_record
language sql
security definer
set search_path = pgmq, public
as $$
  select * from pgmq.set_vt(queue_name, msg_id, vt_offset);
$$;

create or replace function sync.pgmq_metrics(queue_name text)
returns pgmq.metrics_result
language sql
security definer
set search_path = pgmq, public
as $$
  select pgmq.metrics(queue_name);
$$;

revoke all on function sync.pgmq_send(text, jsonb, integer) from public;
revoke all on function sync.pgmq_send_batch(text, jsonb, integer) from public;
revoke all on function sync.pgmq_read(text, integer, integer) from public;
revoke all on function sync.pgmq_archive(text, bigint) from public;
revoke all on function sync.pgmq_set_vt(text, bigint, integer) from public;
revoke all on function sync.pgmq_metrics(text) from public;

grant execute on function sync.pgmq_send(text, jsonb, integer) to service_role;
grant execute on function sync.pgmq_send_batch(text, jsonb, integer) to service_role;
grant execute on function sync.pgmq_read(text, integer, integer) to service_role;
grant execute on function sync.pgmq_archive(text, bigint) to service_role;
grant execute on function sync.pgmq_set_vt(text, bigint, integer) to service_role;
grant execute on function sync.pgmq_metrics(text) to service_role;

do $$
declare
  q text;
  queue_names text[] := array[
    'enrich_event',
    'enrich_email',
    'enrich_transaction',
    'enrich_meal',
    'enrich_conversation',
    'rollup_conversation',
    'node_regen',
    'embed_node',
    'reconcile_transaction',
    'pantry_diff',
    'generate_summary',
    'evaluate_alerts',
    'generate_suggestions',
    'execute_action',
    'evaluate_suggestion_approval',
    'household_export',
    'sync_full:gcal',
    'sync_delta:gcal',
    'sync_full:gmail',
    'sync_delta:gmail',
    'sync_full:ynab',
    'sync_delta:ynab',
    'sync_full:instacart',
    'sync_delta:instacart'
  ];
begin
  foreach q in array queue_names loop
    if not exists (
      select 1
      from pgmq.list_queues() as existing
      where existing.queue_name = q
    ) then
      perform pgmq.create(q);
    end if;
  end loop;
end
$$;
