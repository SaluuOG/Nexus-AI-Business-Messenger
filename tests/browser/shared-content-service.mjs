import {supabase as base} from './supabase.mjs';
export * from './supabase.mjs';
const state=window.nexusTest;
const testing=window.nexusSharedTest={calls:[],signs:[],failure:false,signFailure:false,defer:false,waiting:[],items:[]};
for(const kind of ['direct','group']){
  const messages=kind==='direct'?state.directMessages:state.groupMessages;
  const chatId=kind==='direct'?'c1':'g1';
  const common=(message,item_id,title)=>({item_id,message_id:message.message_id,created_at:message.created_at,kind,chat_id:chatId,title,url:null,storage_path:null,mime_type:null,file_size:null});
  const path=name=>(kind==='direct'?'c1/':'groups/g1/')+'me/'+name;
  for(let i=0;i<30;i++)testing.items.push({...common(messages[i],`a:image-${i}`,`Foto ${String(i).padStart(2,'0')}.png`),storage_path:path(`image-${i}.png`),mime_type:'image/png',file_size:1024});
  testing.items.push({...common(messages[8],'a:contract','Angebot 100%_fertig.pdf'),storage_path:path('contract.pdf'),mime_type:'application/pdf',file_size:4096});
  testing.items.push({...common(messages[10],'a:audio','Besprechung.m4a'),storage_path:path('audio.m4a'),mime_type:'audio/mp4',file_size:8192});
  for(const [i,url] of [[8,'https://example.com/Projektplan'],[12,'https://example.org/Team']])testing.items.push({...common(messages[i],`l:link-${i}`,url),url});
}
const ok=data=>({data:structuredClone(data),error:null});
export const supabase={...base,
  async rpc(name,args){
    if(name!=='get_chat_shared_content')return base.rpc(name,args);
    testing.calls.push(args);
    if(testing.failure||(await base.auth.getSession()).data.session.user.id!=='me')return {data:null,error:{code:'42501'}};
    const messages=args.p_kind==='direct'?state.directMessages:state.groupMessages;
    const ordered=testing.items.filter(item=>item.kind===args.p_kind&&item.chat_id===args.p_chat_id&&!messages.find(message=>message.message_id===item.message_id)?.deleted_at)
      .filter(item=>args.p_category==='links'?!!item.url:!item.url&&(args.p_category==='images')===item.mime_type.startsWith('image/'))
      .filter(item=>item.title.toLowerCase().includes(args.p_query.toLowerCase()))
      .sort((a,b)=>b.created_at.localeCompare(a.created_at)||b.message_id.localeCompare(a.message_id)||b.item_id.localeCompare(a.item_id));
    const offset=args.p_before_item_id?ordered.findIndex(item=>item.item_id===args.p_before_item_id&&item.message_id===args.p_before_message_id)+1:0;
    const items=ordered.slice(offset,offset+args.p_limit),last=items.at(-1);
    const result=ok({items,has_more:ordered.length>offset+items.length,next_cursor:last?{created_at:last.created_at,message_id:last.message_id,item_id:last.item_id}:null});
    if(testing.defer)await new Promise(resolve=>testing.waiting.push(resolve));
    return result;
  },
  storage:{from(bucket){return {...base.storage.from(bucket),async createSignedUrl(path,expiry){
    testing.signs.push({bucket,path,expiry});
    return testing.signFailure?{data:null,error:{code:'42501'}}:ok({signedUrl:location.origin+'/__shared-file/'+encodeURIComponent(path)});
  }};}}
};
