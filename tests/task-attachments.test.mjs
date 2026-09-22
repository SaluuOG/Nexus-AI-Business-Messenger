import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { cleanTaskFiles, validTaskFilePath } from '../supabase/functions/task-file-cleanup/core.mjs';

test('Task attachment upload and download boundaries', async t => {
 const root=fileURLToPath(new URL('../',import.meta.url));
 const stubPath=fileURLToPath(new URL('./support/supabaseStub.mjs',import.meta.url));
 const server=await createServer({root,configFile:false,server:{middlewareMode:true,hmr:false},appType:'custom',plugins:[{name:'attachment-test',enforce:'pre',resolveId(source){if(source.endsWith('/lib/supabase'))return stubPath;}}]});
 try {
  const stub=await server.ssrLoadModule('/tests/support/supabaseStub.mjs');
  const api=await server.ssrLoadModule('/src/features/data/taskAttachments.ts');
  const file=new File(['hello'],'Entwurf.txt',{type:'text/plain'});
  const descriptor={id:'intent',workspace_id:'w1',task_id:'t1',comment_id:null,storage_path:'reserved/path',state:'pending',file_size:5};
  const args={id:'intent',workspaceId:'w1',taskId:'t1',commentId:null,file,active:()=>true};
  let uploadCalls=[];
  stub.supabase.storage={from(bucket){assert.equal(bucket,'nexus-task-attachments');return {upload:async(...args)=>{uploadCalls.push(args);return {error:null};},download:async()=>({data:new Blob(['hello']),error:null})};}};
  await t.test('File names, MIME, empty content and size are checked before reserving',()=>{
   assert.equal(api.validateTaskFile(file).error,null);
   assert.equal(api.validateTaskFile({name:'PHOTO.JPG',size:1,type:''}).mime,'image/jpeg');
   assert.equal(api.validateTaskFile({name:'data.zip',size:1,type:'application/x-zip-compressed'}).mime,'application/zip');
   for(const candidate of [{name:'x.svg',size:1,type:'image/svg+xml'},{name:'x.pdf',size:1,type:'text/html'},{name:'x.txt',size:0,type:'text/plain'},{name:'x.txt',size:26214401,type:''},{name:'../x.txt',size:1,type:''},{name:'x\\a.txt',size:1,type:''},{name:'x\u0000.txt',size:1,type:''}])assert.ok(api.validateTaskFile(candidate).error);
  });
  await t.test('A lost storage response finalizes the reserved object without overwrite; ready retries upload nothing',async()=>{
   stub.supabase.storage.from=()=>({upload:async(...args)=>{uploadCalls.push(args);throw new Error('Lost after commit');}});
   stub.setResponse(r=>({data:r.rpc==='begin_task_attachment'?descriptor:{...descriptor,state:'ready'},error:null}));
   await api.uploadTaskAttachment(args);
   assert.equal(uploadCalls.length,1);assert.deepEqual(uploadCalls[0][2],{contentType:'text/plain',cacheControl:'0',upsert:false});
   assert.equal(stub.requests[0].args.p_id,'intent');assert.equal(stub.requests[0].args.p_name,'Entwurf.txt');
   assert.deepEqual(stub.requests.map(r=>r.rpc),['begin_task_attachment','finish_task_attachment']);
   stub.setResponse(()=>({data:{...descriptor,state:'ready'},error:null}));
   await api.uploadTaskAttachment(args);assert.equal(uploadCalls.length,1);
  });
  await t.test('Context changes stop subsequent upload and finalization; mismatched reservations are rejected',async()=>{
   let active=true;
   stub.setResponse(()=>{active=false;return {data:descriptor,error:null};});
   await assert.rejects(api.uploadTaskAttachment({...args,active:()=>active}),/gewechselt/);
   assert.equal(uploadCalls.length,1);
   active=true;stub.supabase.storage.from=()=>({upload:async()=>{active=false;return {error:null};}});
   stub.setResponse(()=>({data:descriptor,error:null}));
   await assert.rejects(api.uploadTaskAttachment({...args,active:()=>active}),/gewechselt/);
   assert.equal(stub.requests.length,1);
   stub.setResponse(()=>({data:{...descriptor,comment_id:'foreign'},error:null}));
   await assert.rejects(api.uploadTaskAttachment(args),/Zuordnung/);
  });
  await t.test('Failed finalization retains the same intent; denial errors hide database internals',async()=>{
   stub.supabase.storage.from=()=>({upload:async()=>({error:{message:'storage unavailable'}})});
   stub.setResponse(r=>r.rpc==='begin_task_attachment'?{data:descriptor,error:null}:{data:null,error:{code:'42501',message:'internal sensitive detail'}});
   await assert.rejects(api.uploadTaskAttachment(args),/Berechtigung/);
   await assert.rejects(api.removeTaskAttachment('intent'),/Berechtigung/);
  });
  await t.test('Downloads are authenticated, uncached, abortable and reject incomplete content',async()=>{
   const controller=new AbortController();let request;
   stub.supabase.storage.from=bucket=>{assert.equal(bucket,api.taskFileBucket);return {download:async(...args)=>{request=args;return {data:new Blob(['hello']),error:null};}};};
   assert.equal(await (await api.downloadTaskAttachment(descriptor,controller.signal)).text(),'hello');
   assert.deepEqual(request,['reserved/path',{}, {cache:'no-store',signal:controller.signal}]);
   await assert.rejects(api.downloadTaskAttachment({...descriptor,file_size:6}),/unvollständig/);
  });
 } finally {await server.close();}
});

test('Cleanup uses fixed scoped paths, retries failures and passes the claimed lease',async()=>{
 const path=Array.from({length:4},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`).join('/');
 const jobs=[{id:'ok',storage_path:path,lease_token:'a'},{id:'retry',storage_path:path.replace(/[0-9]$/,'1'),lease_token:'b'},{id:'invalid',storage_path:'../../other-bucket/file',lease_token:'c'}];
 let calls=[],removed=[];
 const result=await cleanTaskFiles({rpc:async(name,args)=>{calls.push({name,args});if(name==='claim_task_file_cleanup')return jobs;},remove:async p=>{removed.push(p);if(p.endsWith('1'))throw new Error('temporarily offline');return true;}});
 assert.deepEqual(result,{removed:1,retry:2});assert.equal(removed.length,2);
 assert.equal(validTaskFilePath('../../other-bucket/file'),false);
 for(const job of jobs)assert.deepEqual(calls.find(c=>c.args.p_id===job.id)?.args,{p_id:job.id,p_lease:job.lease_token,p_success:job.id==='ok'});
});
