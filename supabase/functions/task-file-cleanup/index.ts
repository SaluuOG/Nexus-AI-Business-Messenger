import { createClient } from 'npm:@supabase/supabase-js@2.116.0';
import { bucket, mimeTypes, cleanTaskFiles } from './core.mjs';
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async (request:Request)=>{
 if(request.method!=='POST')return reply({error:'Method not allowed'},405);
 const token=request.headers.get('x-nexus-cleanup-token');
 if(!token||!/^[a-f0-9]{64}$/.test(token))return reply({error:'Unauthorized'},401);
 const admin=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{
  auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(8000)})}});
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await admin.rpc(name,args);if(error)throw new Error('Database unavailable');return data;};
 try{
  if(!await rpc('consume_task_file_wake',{p_token:token}))return reply({error:'Unauthorized'},401);
  const body=await request.json();
  if(body.initialize===true){
   const existing=await admin.storage.getBucket(bucket);
   if(existing.error){
    if(String(existing.error.statusCode)!=='404')throw existing.error;
    const created=await admin.storage.createBucket(bucket,{public:false,fileSizeLimit:26214400,allowedMimeTypes:mimeTypes});
    if(created.error)throw created.error;
   }else if(existing.data.public||Number(existing.data.file_size_limit)!==26214400){throw new Error('Unexpected bucket configuration');}
  }
  const result=await cleanTaskFiles({rpc,remove:async(path:string)=>{
   const {error}=await admin.storage.from(bucket).remove([path]);
   return !error||String(error.statusCode)==='404';
  }});
  return reply(result);
 }catch{return reply({error:'Cleanup temporarily unavailable'},503);}
});
