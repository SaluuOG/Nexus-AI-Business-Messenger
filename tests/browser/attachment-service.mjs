import { supabase as base } from './supabase.mjs';
export * from './supabase.mjs';
const state=window.nexusTest;
const objects=new Map();
const testing=window.nexusAttachmentTest={failUpload:false,loseFinish:false,delayBegin:false,waiting:[],uploads:[],downloads:[],removed:[]};
const current=async()=> (await base.auth.getSession()).data.session.user.id;
const role=(workspace,user)=>state.revoked?undefined:state.memberships.find(m=>m.workspace_id===workspace&&m.user_id===user)?.role;
const ok=data=>({data:structuredClone(data),error:null});
const denied=()=>({data:null,error:{code:'42501'}});
const persist=()=>{state.persistCollaboration();state.emit('task_attachments','UPDATE');};
export const supabase={...base,
 async rpc(name,args){
  if(!['begin_task_attachment','finish_task_attachment','remove_task_attachment'].includes(name))return base.rpc(name,args);
  const user=await current();
  if(name==='begin_task_attachment'){
   if(!['owner','admin','member'].includes(role(args.p_workspace,user)))return denied();
   if(!state.tasks.some(t=>t.id===args.p_task&&t.workspace_id===args.p_workspace))return denied();
   if(args.p_comment&&!state.collaboration.task_comments.some(c=>c.id===args.p_comment&&c.task_id===args.p_task&&c.created_by===user))return denied();
   let row=state.collaboration.task_attachments.find(f=>f.id===args.p_id);
   if(!row){row={id:args.p_id,workspace_id:args.p_workspace,task_id:args.p_task,comment_id:args.p_comment,uploader_id:user,storage_path:args.p_workspace+'/'+args.p_task+'/'+user+'/'+args.p_id,file_name:args.p_name,mime_type:args.p_mime,file_size:args.p_size,state:'pending',created_at:new Date().toISOString()};state.collaboration.task_attachments.push(row);}
   const result=ok(row);if(testing.delayBegin)await new Promise(resolve=>testing.waiting.push(resolve));return result;
  }
  const row=state.collaboration.task_attachments.find(f=>f.id===args.p_id);
  if(name==='remove_task_attachment'){
   if(!row)return ok(null);
   if(!(row.uploader_id===user&&row.state==='pending'||['owner','admin'].includes(role(row.workspace_id,user))||row.uploader_id===user&&role(row.workspace_id,user)==='member'))return denied();
   state.collaboration.task_attachments=state.collaboration.task_attachments.filter(f=>f.id!==row.id);objects.delete(row.storage_path);testing.removed.push(row.id);persist();return ok(null);
  }
  if(!row||row.uploader_id!==user||!['owner','admin','member'].includes(role(row.workspace_id,user)))return denied();
  if(!objects.has(row.storage_path))return {data:null,error:{message:'Upload incomplete'}};
  row.state='ready';persist();
  if(testing.loseFinish){testing.loseFinish=false;return {data:null,error:{message:'Response lost'}};}
  return ok(row);
 },
 storage:{from(bucket){
  if(bucket!=='nexus-task-attachments')return base.storage.from(bucket);
  return {
   async upload(path,file,options){
    testing.uploads.push({path,name:file.name,...options});
    const user=await current();const row=state.collaboration.task_attachments.find(f=>f.storage_path===path);
    if(!row||row.uploader_id!==user||!['owner','admin','member'].includes(role(row.workspace_id,user)))return denied();
    if(testing.failUpload)return {data:null,error:{message:'Offline'}};
    if(objects.has(path))return {data:null,error:{message:'Already exists'}};
    objects.set(path,new Blob([await file.arrayBuffer()],{type:options.contentType}));return ok({path});
   },
   async download(path,transform,options){
    testing.downloads.push({path,cache:options.cache,hasSignal:!!options.signal});
    const user=await current();const row=state.collaboration.task_attachments.find(f=>f.storage_path===path&&f.state==='ready');
    if(!row||!role(row.workspace_id,user))return denied();
    return {data:objects.get(path),error:null};
   }
  };
 }}
};
