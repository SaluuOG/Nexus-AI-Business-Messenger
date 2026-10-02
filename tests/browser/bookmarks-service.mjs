// UI transport only. Live SQL tests independently exercise real permissions.
export function createBookmarksService(state,getUser) {
  state.bookmarkRows=JSON.parse(sessionStorage.getItem('nexusTest.bookmarks')||'[]');
  state.bookmarkCalls=[];
  const fail=()=>({data:null,error:{message:'Bookmark request denied',code:'42501'}});
  const source=(kind,id)=>{
    const message=(kind==='direct'?state.directMessages:state.groupMessages).find(m=>m.message_id===id&&!m.deleted_at);
    if(!message||state.bookmarkDenied)return null;
    const chatId=kind==='direct'?(message.conversation_id||'c1'):message.group_id;
    const chat=(kind==='direct'?state.conversations:state.groupChats).find(c=>(c.conversation_id||c.group_id)===chatId);
    return chat?{message,chat,chatId}:null;
  };
  return async(name,args)=>{
    const user=getUser().id;
    if(args.p_user_id!==user)return fail();
    if(name==='set_message_bookmark'){
      state.bookmarkCalls.push(structuredClone(args));
      if(state.bookmarkWriteDelay)await new Promise(resolve=>setTimeout(resolve,state.bookmarkWriteDelay));
      if(user!==getUser().id||state.bookmarkWriteFailure)return fail();
      if(args.p_saved&&!source(args.p_kind,args.p_message_id))return fail();
      const old=state.bookmarkRows.find(b=>b.user_id===user&&b.kind===args.p_kind&&b.message_id===args.p_message_id);
      if(args.p_saved&&!old)state.bookmarkRows.push({id:crypto.randomUUID(),user_id:user,kind:args.p_kind,message_id:args.p_message_id,saved_at:new Date().toISOString()});
      else if(!args.p_saved&&old)state.bookmarkRows=state.bookmarkRows.filter(b=>b!==old);
      sessionStorage.setItem('nexusTest.bookmarks',JSON.stringify(state.bookmarkRows));
      if(state.loseBookmarkResponse){state.loseBookmarkResponse=false;throw Error('Lost bookmark response');}
      return {data:args.p_saved,error:null};
    }
    const own=state.bookmarkRows.filter(b=>b.user_id===user&&source(b.kind,b.message_id));
    const items=own.map(b=>{
      const {message:m,chat,chatId}=source(b.kind,b.message_id);
      return {id:b.id,saved_at:b.saved_at,kind:b.kind,message_id:b.message_id,chat_id:chatId,chat_name:chat.name||chat.full_name||chat.username||'Nexus-Kontakt',sender_name:m.sender_full_name||'Test Kontakt',preview:m.body.slice(0,500),attachment_name:m.attachments?.[0]?.file_name||null,created_at:m.created_at};
    }).filter(row=>[row.preview,row.chat_name,row.sender_name,row.attachment_name||''].join(' ').toLowerCase().includes((args.p_query||'').toLowerCase()))
      .sort((a,b)=>b.saved_at.localeCompare(a.saved_at)||b.id.localeCompare(a.id));
    const snapshot=structuredClone(items);
    if(state.bookmarkReadDelay)await new Promise(resolve=>setTimeout(resolve,state.bookmarkReadDelay));
    if(state.bookmarkReadFailure)return fail();
    if(name==='get_message_bookmark_status')return {data:snapshot.filter(b=>b.kind===args.p_kind&&b.chat_id===args.p_chat_id&&args.p_message_ids.includes(b.message_id)).map(b=>b.message_id),error:null};
    const filtered=snapshot.filter(b=>!args.p_before_saved_at||b.saved_at<args.p_before_saved_at||(b.saved_at===args.p_before_saved_at&&b.id<args.p_before_id));
    const page=filtered.slice(0,args.p_limit),has_more=filtered.length>args.p_limit,last=page.at(-1);
    return {data:{items:page,has_more,next_cursor:has_more?{id:last.id,saved_at:last.saved_at}:null},error:null};
  };
}
