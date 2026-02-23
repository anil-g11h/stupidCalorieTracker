begin;

do $$
declare
  table_name text;
begin
  for table_name in
    select c.relname
    from pg_catalog.pg_class c
    inner join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table public.%I add column if not exists updated_at timestamptz not null default timezone(''utc''::text, now());',
      table_name
    );
  end loop;
end
$$;

do $$
declare
  table_name text;
begin
  for table_name in
    select c.relname
    from pg_catalog.pg_class c
    inner join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and exists (
        select 1
        from information_schema.columns cols
        where cols.table_schema = 'public'
          and cols.table_name = c.relname
          and cols.column_name = 'created_at'
      )
      and exists (
        select 1
        from information_schema.columns cols
        where cols.table_schema = 'public'
          and cols.table_name = c.relname
          and cols.column_name = 'updated_at'
      )
  loop
    execute format(
      'update public.%I set updated_at = created_at where updated_at is distinct from created_at;',
      table_name
    );
  end loop;
end
$$;

create or replace function public.set_updated_at_column()
returns trigger
language plpgsql
as $$
declare
  created_at_value timestamptz;
begin
  if tg_op = 'INSERT' then
    if new.updated_at is null then
      if to_jsonb(new) ? 'created_at' then
        created_at_value := nullif(to_jsonb(new) ->> 'created_at', '')::timestamptz;
      end if;

      new.updated_at := coalesce(created_at_value, timezone('utc'::text, now()));
    end if;

    return new;
  end if;

  new.updated_at := timezone('utc'::text, now());
  return new;
end;
$$;

do $$
declare
  table_name text;
begin
  for table_name in
    select c.relname
    from pg_catalog.pg_class c
    inner join pg_catalog.pg_namespace n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and exists (
        select 1
        from information_schema.columns cols
        where cols.table_schema = 'public'
          and cols.table_name = c.relname
          and cols.column_name = 'updated_at'
      )
  loop
    execute format('drop trigger if exists set_updated_at_on_write on public.%I;', table_name);
    execute format(
      'create trigger set_updated_at_on_write before insert or update on public.%I for each row execute function public.set_updated_at_column();',
      table_name
    );
  end loop;
end
$$;

commit;