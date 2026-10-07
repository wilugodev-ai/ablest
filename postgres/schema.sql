-- Ablests hosted database. Run only against its separate Neon project.
-- Repeated application is safe; local SQLite is not read or copied.
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('ablest-schema'));
CREATE TABLE IF NOT EXISTS ablest_users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 email text NOT NULL UNIQUE CHECK(email=lower(email)),
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 company text NOT NULL DEFAULT '', phone text NOT NULL DEFAULT '',
 role text NOT NULL CHECK(role IN ('admin','client')), salt text NOT NULL, hash text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ablest_single_admin ON ablest_users(role) WHERE role='admin';
CREATE TABLE IF NOT EXISTS ablest_sessions (
 hash text PRIMARY KEY, expires bigint NOT NULL,
 user_id uuid NOT NULL REFERENCES ablest_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS ablest_sessions_expiry ON ablest_sessions(expires);
CREATE TABLE IF NOT EXISTS ablest_attempts (key text PRIMARY KEY,count integer NOT NULL,start bigint NOT NULL);
CREATE TABLE IF NOT EXISTS ablest_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text NOT NULL, subtitle text NOT NULL,
 category text NOT NULL, description text NOT NULL, features jsonb NOT NULL DEFAULT '[]',
 status text NOT NULL CHECK(status IN ('In development','Available','Coming soon')),
 url text NOT NULL DEFAULT '', published boolean NOT NULL DEFAULT false,
 position integer NOT NULL DEFAULT 0, CHECK(jsonb_typeof(features)='array')
);
CREATE TABLE IF NOT EXISTS ablest_images (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES ablest_projects(id) ON DELETE CASCADE,
 alt text NOT NULL CHECK(length(alt) BETWEEN 1 AND 300),
 data bytea NOT NULL CHECK(octet_length(data)<=2097152), position integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ablest_images_order ON ablest_images(project_id,position,id);
CREATE TABLE IF NOT EXISTS ablest_meta (key text PRIMARY KEY,value text NOT NULL);
REVOKE ALL ON ablest_users,ablest_sessions,ablest_attempts,ablest_projects,ablest_images,ablest_meta FROM PUBLIC;

CREATE OR REPLACE FUNCTION ablest_throttle(attempt_key text) RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE now_ms bigint := floor(extract(epoch FROM clock_timestamp())*1000); attempts integer;
BEGIN
 DELETE FROM ablest_attempts WHERE start < now_ms-900000;
 INSERT INTO ablest_attempts(key,count,start) VALUES(attempt_key,1,now_ms)
 ON CONFLICT(key) DO UPDATE SET count=ablest_attempts.count+1 RETURNING count INTO attempts;
 RETURN attempts<=10;
END;$$;

CREATE OR REPLACE FUNCTION ablest_issue_session(token_hash text,target_user uuid,previous_hash text)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE now_ms bigint := floor(extract(epoch FROM clock_timestamp())*1000);
BEGIN
 DELETE FROM ablest_sessions WHERE expires<now_ms OR hash=previous_hash;
 INSERT INTO ablest_sessions(hash,expires,user_id) VALUES(token_hash,now_ms+28800000,target_user);
 RETURN true;
END;$$;

CREATE OR REPLACE FUNCTION ablest_create_project(project_id uuid,project_title text,project_subtitle text,project_category text,project_description text,project_features jsonb,project_status text,project_url text,project_published boolean)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE item ablest_projects;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('ablest-project-order'));
 IF (SELECT count(*) FROM ablest_projects)>=100 THEN RAISE EXCEPTION 'project_limit';END IF;
 INSERT INTO ablest_projects(id,title,subtitle,category,description,features,status,url,published,position)
 VALUES(project_id,project_title,project_subtitle,project_category,project_description,project_features,project_status,project_url,project_published,(SELECT coalesce(max(position),-1)+1 FROM ablest_projects))
 RETURNING * INTO item;RETURN to_jsonb(item);
END;$$;

CREATE OR REPLACE FUNCTION ablest_add_image(image_id uuid,target_project uuid,image_alt text,image_data bytea)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE item ablest_images;
BEGIN
 PERFORM 1 FROM ablest_projects WHERE id=target_project FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'project_missing';END IF;
 IF (SELECT count(*) FROM ablest_images WHERE project_id=target_project)>=12 THEN RAISE EXCEPTION 'image_limit';END IF;
 INSERT INTO ablest_images(id,project_id,alt,data,position)
 VALUES(image_id,target_project,image_alt,image_data,(SELECT coalesce(max(position),-1)+1 FROM ablest_images WHERE project_id=target_project)) RETURNING * INTO item;
 RETURN jsonb_build_object('id',item.id,'alt',item.alt,'position',item.position);
END;$$;

CREATE OR REPLACE FUNCTION ablest_edit_image(image_id uuid,image_alt text,make_cover boolean)
RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE target_project uuid;cover_position integer;
BEGIN
 SELECT project_id INTO target_project FROM ablest_images WHERE id=image_id;
 IF NOT FOUND THEN RETURN false;END IF;
 PERFORM 1 FROM ablest_projects WHERE id=target_project FOR UPDATE;
 IF make_cover THEN SELECT coalesce(min(position),0)-1 INTO cover_position FROM ablest_images WHERE project_id=target_project;END IF;
 UPDATE ablest_images SET alt=image_alt,position=CASE WHEN make_cover THEN cover_position ELSE position END WHERE id=image_id;
 RETURN FOUND;
END;$$;
REVOKE ALL ON FUNCTION ablest_throttle(text),ablest_issue_session(text,uuid,text),ablest_create_project(uuid,text,text,text,text,jsonb,text,text,boolean),ablest_add_image(uuid,uuid,text,bytea),ablest_edit_image(uuid,text,boolean) FROM PUBLIC;

DO $$BEGIN
 IF NOT EXISTS(SELECT 1 FROM ablest_meta WHERE key='seeded') THEN
  INSERT INTO ablest_projects(title,subtitle,category,description,features,status,url,published,position) VALUES
  ('InTouch','CRM','Business & relationships','Keep customers, conversations, and the next step in focus. A CRM for independent businesses to manage relationships and daily operations in one workspace.','["Contacts, deals, and follow-ups","Quotes, appointments, and support tickets","Team workspaces and business reports"]','In development','',true,0),
  ('IterateView','Review. Learn. Improve.','Trading & personal review','Turn trading history into a useful review habit. Bring trades, decision notes, and performance summaries together so you can understand your process and plan your next improvement.','["Trading journal and detailed trade review","CSV import and execution history","Performance summaries and review filters"]','In development','',true,1);
  INSERT INTO ablest_meta VALUES('seeded','1');
 END IF;
END;$$;
INSERT INTO ablest_meta(key,value) VALUES('schema_version','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value;
COMMIT;
