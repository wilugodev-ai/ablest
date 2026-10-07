-- Apply to a NEW Ablests Supabase project, not InTouch or IterateView.
-- Account authentication remains in NestJS. These tables and functions are
-- backend-only: browser/anon/authenticated roles receive no direct access.
create table if not exists public.ablest_users (
 id uuid primary key default gen_random_uuid(), email text not null unique,
 name text not null, company text not null default '', phone text not null default '',
 role text not null check(role in ('admin','client')), salt text not null, hash text not null,
 check(email=lower(email)), check(length(name) between 1 and 100)
);
create unique index if not exists ablest_single_admin on public.ablest_users(role) where role='admin';
create table if not exists public.ablest_sessions (
 hash text primary key, expires bigint not null,
 user_id uuid not null references public.ablest_users(id) on delete cascade
);
create table if not exists public.ablest_attempts (key text primary key,count integer not null,start bigint not null);
create table if not exists public.ablest_projects (
 id uuid primary key default gen_random_uuid(), title text not null, subtitle text not null,
 category text not null, description text not null, features jsonb not null default '[]',
 status text not null check(status in ('In development','Available','Coming soon')),
 url text not null default '', published boolean not null default false,
 position integer not null default 0, check(jsonb_typeof(features)='array')
);
create table if not exists public.ablest_images (
 id uuid primary key default gen_random_uuid(), project_id uuid not null references public.ablest_projects(id) on delete cascade,
 alt text not null, path text not null unique, position integer not null default 0,
 check(length(alt) between 1 and 300)
);
create table if not exists public.ablest_meta (key text primary key,value text not null);

alter table public.ablest_users enable row level security;
alter table public.ablest_sessions enable row level security;
alter table public.ablest_attempts enable row level security;
alter table public.ablest_projects enable row level security;
alter table public.ablest_images enable row level security;
alter table public.ablest_meta enable row level security;
revoke all on table public.ablest_users,public.ablest_sessions,public.ablest_attempts,public.ablest_projects,public.ablest_images,public.ablest_meta from public,anon,authenticated;
grant all on table public.ablest_users,public.ablest_sessions,public.ablest_attempts,public.ablest_projects,public.ablest_images,public.ablest_meta to service_role;

-- Database-clock, atomic throttling: survives instance sleep/restarts.
create or replace function public.ablest_throttle(attempt_key text)
returns boolean language plpgsql set search_path='' as $$
declare now_ms bigint := floor(extract(epoch from clock_timestamp())*1000); attempts integer;
begin
 delete from public.ablest_attempts where start < now_ms-900000;
 insert into public.ablest_attempts(key,count,start) values(attempt_key,1,now_ms)
 on conflict(key) do update set count=public.ablest_attempts.count+1 returning count into attempts;
 return attempts<=10;
end;$$;

-- Serialize upload registration per project so concurrent requests cannot
-- exceed the image limit or register an image for a deleted project.
create or replace function public.ablest_add_image(image_id uuid,target_project uuid,image_alt text,image_path text)
returns jsonb language plpgsql set search_path='' as $$
declare item public.ablest_images;
begin
 perform 1 from public.ablest_projects where id=target_project for update;
 if not found then raise exception 'project_missing';end if;
 if (select count(*) from public.ablest_images where project_id=target_project)>=12 then raise exception 'image_limit';end if;
 insert into public.ablest_images(id,project_id,alt,path,position)
 values(image_id,target_project,image_alt,image_path,(select coalesce(max(position),-1)+1 from public.ablest_images where project_id=target_project))
 returning * into item;return to_jsonb(item);
end;$$;
revoke all on function public.ablest_throttle(text),public.ablest_add_image(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.ablest_throttle(text),public.ablest_add_image(uuid,uuid,text,text) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('ablest-project-images','ablest-project-images',false,8388608,array['image/webp'])
on conflict(id) do nothing;
-- No storage object policies for browser roles. Only the server secret reads,
-- uploads, and removes objects. Visitors use the checked NestJS image route.

do $$begin
 if not exists(select 1 from public.ablest_meta where key='seeded') then
  insert into public.ablest_projects(title,subtitle,category,description,features,status,url,published,position) values
  ('InTouch','CRM','Business & relationships','Keep customers, conversations, and the next step in focus. A CRM for independent businesses to manage relationships and daily operations in one workspace.','["Contacts, deals, and follow-ups","Quotes, appointments, and support tickets","Team workspaces and business reports"]','In development','',true,0),
  ('IterateView','Review. Learn. Improve.','Trading & personal review','Turn trading history into a useful review habit. Bring trades, decision notes, and performance summaries together so you can understand your process and plan your next improvement.','["Trading journal and detailed trade review","CSV import and execution history","Performance summaries and review filters"]','In development','',true,1);
  insert into public.ablest_meta values('seeded','1');
 end if;
end;$$;
