-- Grove Phase 2 — paste this whole file into the Supabase SQL editor and Run.
-- Prereq: Authentication → Sign In / Up → enable "Anonymous sign-ins".

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 40),
  invite_code text not null unique,
  created_by uuid not null,
  created_at timestamptz not null default now()
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid not null references public.circles(id) on delete cascade,
  user_id uuid not null,
  name text not null check (char_length(name) between 1 and 30),
  avatar_id text not null,
  accent_id text not null,
  joined_at timestamptz not null default now(),
  unique (circle_id, user_id)
);

create table public.events (
  id bigint generated always as identity primary key,
  circle_id uuid not null references public.circles(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  client_key uuid not null,
  type text not null check (type in
    ('step','bloom','struggle','recover','cheer','join','leave')),
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (circle_id, client_key)
);
create index events_circle_cursor on public.events (circle_id, id);

alter table public.circles enable row level security;
alter table public.members enable row level security;
alter table public.events  enable row level security;

-- security definer so RLS policies can consult membership without recursion
create or replace function public.is_circle_member(cid uuid)
returns boolean language sql security definer set search_path = public stable as
$$ select exists (select 1 from public.members
                  where circle_id = cid and user_id = auth.uid()); $$;

create policy circles_select on public.circles for select to authenticated
  using (public.is_circle_member(id));
create policy members_select on public.members for select to authenticated
  using (public.is_circle_member(circle_id));
create policy members_delete on public.members for delete to authenticated
  using (user_id = auth.uid());
create policy events_select on public.events for select to authenticated
  using (public.is_circle_member(circle_id));
create policy events_insert on public.events for insert to authenticated
  with check (
    public.is_circle_member(circle_id)
    and exists (select 1 from public.members m
                where m.id = events.member_id
                  and m.user_id = auth.uid()
                  and m.circle_id = events.circle_id));

create or replace function public.gen_invite_code() returns text
language plpgsql volatile as $$
declare
  alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  code text := '';
begin
  for i in 1..6 loop
    code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return code;
end $$;

create or replace function public.create_circle(
  circle_name text, member_name text, avatar text, accent text)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.circles; m public.members; tries int := 0;
begin
  if auth.uid() is null then raise exception 'not-authenticated'; end if;
  loop
    begin
      insert into public.circles (name, invite_code, created_by)
        values (circle_name, public.gen_invite_code(), auth.uid())
        returning * into c;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
  insert into public.members (circle_id, user_id, name, avatar_id, accent_id)
    values (c.id, auth.uid(), member_name, avatar, accent) returning * into m;
  insert into public.events (circle_id, member_id, client_key, type, payload)
    values (c.id, m.id, gen_random_uuid(), 'join',
            jsonb_build_object('name', member_name));
  return json_build_object(
    'circle', json_build_object('id', c.id, 'name', c.name,
                                'invite_code', c.invite_code),
    'member_id', m.id);
end $$;

create or replace function public.join_circle(
  code text, member_name text, avatar text, accent text)
returns json language plpgsql security definer set search_path = public as $$
declare
  c public.circles; m public.members; n int;
begin
  if auth.uid() is null then raise exception 'not-authenticated'; end if;
  select * into c from public.circles
    where invite_code = upper(trim(code));
  if not found then raise exception 'not-found'; end if;
  select * into m from public.members
    where circle_id = c.id and user_id = auth.uid();
  if not found then
    select count(*) into n from public.members where circle_id = c.id;
    if n >= 5 then raise exception 'full'; end if;
    insert into public.members (circle_id, user_id, name, avatar_id, accent_id)
      values (c.id, auth.uid(), member_name, avatar, accent) returning * into m;
    insert into public.events (circle_id, member_id, client_key, type, payload)
      values (c.id, m.id, gen_random_uuid(), 'join',
              jsonb_build_object('name', member_name));
  end if;
  return json_build_object(
    'circle', json_build_object('id', c.id, 'name', c.name,
                                'invite_code', c.invite_code),
    'member_id', m.id,
    'members', (select coalesce(json_agg(json_build_object(
        'id', x.id, 'name', x.name, 'avatar_id', x.avatar_id,
        'accent_id', x.accent_id, 'joined_at', x.joined_at)
        order by x.joined_at), '[]'::json)
      from public.members x where x.circle_id = c.id));
end $$;

revoke execute on function public.create_circle(text,text,text,text) from public, anon;
revoke execute on function public.join_circle(text,text,text,text)   from public, anon;
revoke execute on function public.is_circle_member(uuid)             from public, anon;
grant  execute on function public.create_circle(text,text,text,text) to authenticated;
grant  execute on function public.join_circle(text,text,text,text)   to authenticated;
grant  execute on function public.is_circle_member(uuid)             to authenticated;
