// Isolated browser transport. SQL acceptance independently verifies access rules.
export function createRemindersService(state,getUser){
 state.reminderRows=JSON.parse(sessionStorage.getItem('nexusTest.reminders')||'[]');state.reminderCalls=[];
 const fail=(code='42501')=>({data:null,error:{code,message:'Reminder denied'}});
 const source=(kind,id)=>{
  const message=(kind==='direct'?state.directMessages:state.groupMessages).find(m=>m.message_id===id&&!m.deleted_at);
  if(!message||state.reminderDenied)return null;
  const chatId=kind==='direct'?(message.conversation_id||'c1'):message.group_id;
  const chat=(kind==='direct'?state.conversations:state.groupChats).find(c=>(c.conversation_id||c.group_id)===chatId);
  return chat?{message,chat,chatId}:null;
 };
 const clean=r=>r?{id:r.id,version:r.version,due_at:r.due_at}:null;
 return async(name,args)=>{
  const user=getUser().id;if(args.p_user_id!==user)return fail();
  const old=state.reminderRows.find(r=>r.user_id===user&&r.kind===args.p_kind&&r.message_id===args.p_message_id);
  if(name==='change_message_reminder'){
   state.reminderCalls.push(structuredClone(args));
   if(state.reminderWriteDelay)await new Promise(resolve=>setTimeout(resolve,state.reminderWriteDelay));
   if(user!==getUser().id||state.reminderWriteFailure)return fail();
   if(old?.version===args.p_request_id)return old.due_at===args.p_due_at?{data:clean(old),error:null}:fail('22023');
   if((old?.version??null)!==args.p_expected_version)return fail('40001');
   if(args.p_due_at&&!source(args.p_kind,args.p_message_id))return fail();
   if(args.p_due_at&&Date.parse(args.p_due_at)<=Date.now())return fail('22023');
   if(!old&&!args.p_due_at)return fail();
   const row=old||{id:crypto.randomUUID(),user_id:user,kind:args.p_kind,message_id:args.p_message_id};
   row.version=args.p_request_id;row.due_at=args.p_due_at;if(!old)state.reminderRows.push(row);
   sessionStorage.setItem('nexusTest.reminders',JSON.stringify(state.reminderRows));
   if(state.loseReminderResponse){state.loseReminderResponse=false;throw Error('Lost reminder response');}
   return{data:clean(row),error:null};
  }
  const now=new Date().toISOString();
  let result;
  if(name==='get_message_reminder')result=source(args.p_kind,args.p_message_id)?{data:clean(old),error:null}:fail();
  else{
   const all=state.reminderRows.filter(r=>r.user_id===user&&r.due_at&&source(r.kind,r.message_id)).map(r=>{
    const {message:m,chat,chatId}=source(r.kind,r.message_id);
    return {...clean(r),kind:r.kind,message_id:r.message_id,chat_id:chatId,chat_name:chat.name||chat.full_name||'Test Kontakt',sender_name:m.sender_full_name||'Test Kontakt',preview:m.body.slice(0,500),attachment_name:m.attachments?.[0]?.file_name||null,created_at:m.created_at};
   }).sort((a,b)=>a.due_at.localeCompare(b.due_at)||a.id.localeCompare(b.id));
   const due_count=all.filter(r=>Date.parse(r.due_at)<=Date.parse(now)).length;
   const filtered=all.filter(r=>(args.p_mode==='all'||Date.parse(r.due_at)<=Date.parse(now))&&(!args.p_after_due_at||r.due_at>args.p_after_due_at||(r.due_at===args.p_after_due_at&&r.id>args.p_after_id)));
   const items=filtered.slice(0,args.p_limit),last=items.at(-1),has_more=filtered.length>args.p_limit;
   result={data:{items,server_now:now,due_count,has_more,next_cursor:has_more?{id:last.id,due_at:last.due_at}:null},error:null};
  }
  const snapshot=structuredClone(result);
  if(state.reminderReadDelay)await new Promise(resolve=>setTimeout(resolve,state.reminderReadDelay));
  return state.reminderReadFailure?fail():snapshot;
 };
}
