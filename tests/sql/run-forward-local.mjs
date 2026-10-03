// Isolated PostgreSQL (PGlite) check before deployment. Uses the real chat
// table/RLS/history migrations; Auth bootstrap replaces only hosted Auth setup.
// NEXUS_PGLITE_MODULE points to a separately installed @electric-sql/pglite.
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const { PGlite }=await import(pathToFileURL(process.env.NEXUS_PGLITE_MODULE).href);
const db=new PGlite();
const read=name=>readFile(new URL('../../supabase/migrations/'+name,import.meta.url),'utf8');
const before=(text,marker)=>text.slice(0,text.indexOf(marker));
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    GRANT USAGE ON SCHEMA public,auth,private TO anon,authenticated,service_role;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text,email_confirmed_at timestamptz,raw_user_meta_data jsonb);
    CREATE TABLE auth.sessions(id uuid PRIMARY KEY,user_id uuid REFERENCES auth.users(id),created_at timestamptz,updated_at timestamptz,not_after timestamptz);
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claims',true),'')::jsonb$$;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT (auth.jwt()->>'sub')::uuid$$;
    CREATE TABLE public.profiles(id uuid PRIMARY KEY REFERENCES auth.users(id),full_name text,username text,avatar_url text);
  `);
  await db.exec(before(await read('0005_direct_messages.sql'),'CREATE OR REPLACE FUNCTION public.open_direct_conversation'));
  await db.exec(`ALTER TABLE public.direct_messages ADD COLUMN reply_to_message_id uuid REFERENCES public.direct_messages(id), ADD COLUMN edited_at timestamptz, ADD COLUMN deleted_at timestamptz;`);
  await db.exec(before(await read('0011_group_chats_foundation.sql'),'CREATE OR REPLACE FUNCTION public.create_group_chat'));
  await db.exec(`REVOKE ALL ON public.group_conversations,public.group_members,public.group_messages,public.group_reads FROM anon,authenticated; GRANT SELECT ON public.group_conversations,public.group_members,public.group_messages,public.group_reads TO authenticated;`);
  await db.exec(before(await read('0007_chat_attachments.sql'),'CREATE INDEX IF NOT EXISTS direct_message_attachments_message_idx'));
  await db.exec(before(await read('0013_group_chat_attachments.sql'),'CREATE INDEX IF NOT EXISTS group_message_attachments_message_idx'));
  await db.exec(await read('20260915182541_phase_three_seven_message_history_search.sql'));
  const guard=await read('20260922171611_project_templates.sql');
  await db.exec(guard.slice(guard.indexOf('CREATE FUNCTION private.project_template_user()'),guard.indexOf('CREATE POLICY project_templates_read')));
  await db.exec(await read('20261002211151_message_forwarding.sql'));
  const results=await db.exec(await readFile(new URL('message-forwarding-rls.sql',import.meta.url),'utf8'));
  console.log(results.flatMap(r=>r.rows??[]).filter(row=>String(row.result??'').startsWith('PASS:')));
}catch(error){console.error(error.message,error.detail??'',error.where??'');process.exitCode=1;}
finally{await db.close();}
