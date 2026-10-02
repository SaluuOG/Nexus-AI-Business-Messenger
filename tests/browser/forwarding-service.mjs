// Isolated synthetic transport. Database authorization is exercised separately
// by message-forwarding-rls.sql, rather than claimed from this UI fixture.
export function createForwardingService(state,getUser) {
  state.forwardCalls=[];state.forwardWrites=0;
  state.forwardReceipts=JSON.parse(sessionStorage.getItem('nexusTest.forwardReceipts')||'[]');
  for(const [kind,key] of [['direct','directMessages'],['group','groupMessages']])state[key].push(...JSON.parse(sessionStorage.getItem('nexusTest.forwardRows.'+kind)||'[]'));
  const denied=(message,code='42501')=>({data:null,error:{message,code}});
  return async(name,args)=>{
    if(name==='get_message_forward_targets') {
      const user=getUser().id;
      const items=[...state.conversations.map(c=>({kind:'direct',chat_id:c.conversation_id,name:c.full_name||c.username||'Nexus-Kontakt'})),...state.groupChats.map(g=>({kind:'group',chat_id:g.group_id,name:g.name}))]
        .filter(t=>t.name.toLowerCase().includes((args.p_query||'').toLowerCase()));
      if(state.forwardReadDelay)await new Promise(r=>setTimeout(r,state.forwardReadDelay));
      if(state.forwardReadFailure)return denied('Offline');
      return {data:{items:user==='me'?items.slice(0,50):[],has_more:items.length>50},error:null};
    }
    const user=getUser().id;
    state.forwardCalls.push(structuredClone(args));
    if(state.forwardDelay)await new Promise(r=>setTimeout(r,state.forwardDelay));
    if(user!==getUser().id||args.p_user_id!==user)return denied('Bitte melde dich erneut an.');
    if(state.forwardDenied)return denied('Zielchat nicht mehr verfügbar.');
    const old=state.forwardReceipts.find(r=>r.user===user&&r.args.p_request_id===args.p_request_id);
    if(old)return JSON.stringify(old.args)===JSON.stringify(args)?{data:old.id,error:null}:denied('Andere Anfrage.','22023');
    const source=(args.p_source_kind==='direct'?state.directMessages:state.groupMessages).find(m=>m.message_id===args.p_source_id);
    if(!source||source.deleted_at||state.sourceDenied)return denied('Ursprungsnachricht nicht mehr verfügbar.');
    if(source.body!==args.p_expected_body||source.attachments?.length)return denied('Die Nachricht wurde geändert. Schließe die Vorschau und öffne sie erneut.','22023');
    const id=crypto.randomUUID(),created_at=new Date().toISOString();
    const row={message_id:id,sender_id:user,body:source.body,is_forwarded:true,created_at,attachments:[],reply_to_message_id:null,
      ...(args.p_target_kind==='direct'?{conversation_id:args.p_target_id}:{group_id:args.p_target_id,sender_full_name:'Test Nutzer'})};
    const key=args.p_target_kind==='direct'?'directMessages':'groupMessages';state[key].push(row);state.forwardWrites++;
    state.forwardReceipts.push({user,id,args:structuredClone(args)});
    sessionStorage.setItem('nexusTest.forwardReceipts',JSON.stringify(state.forwardReceipts));
    sessionStorage.setItem('nexusTest.forwardRows.'+args.p_target_kind,JSON.stringify(state[key].filter(m=>m.is_forwarded)));
    state.emit(args.p_target_kind==='direct'?'direct_messages':'group_messages','INSERT',{new:{...row,id}});
    if(state.loseForwardResponse){state.loseForwardResponse=false;throw new Error('Lost forward response after commit');}
    return {data:id,error:null};
  };
}
