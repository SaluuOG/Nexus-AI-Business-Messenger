import { supabase } from '../../lib/supabase';
export const taskFileBucket='nexus-task-attachments';
export const taskFileLimit=25*1024*1024;
const types:Record<string,string>={jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif',pdf:'application/pdf',txt:'text/plain',csv:'text/csv',zip:'application/zip',
 docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',pptx:'application/vnd.openxmlformats-officedocument.presentationml.presentation'};
export const taskFileAccept=Object.keys(types).map(ext=>'.'+ext).join(',');
export type TaskAttachment={id:string;workspace_id:string;task_id:string;comment_id:string|null;uploader_id:string|null;storage_path:string;file_name:string;mime_type:string;file_size:number;state:'pending'|'ready';created_at:string};
export function validateTaskFile(file:Pick<File,'name'|'size'|'type'>){
 const name=file.name.trim(); const mime=types[name.split('.').pop()?.toLowerCase()??''];
 if(!name||name.length>180||/[\u0000-\u001f\u007f/\\]/.test(name))return {error:'Bitte wähle einen kürzeren Dateinamen ohne Sonder-Steuerzeichen.',mime:''};
 if(!Number.isInteger(file.size)||file.size<1||file.size>taskFileLimit)return {error:'Die Datei ist leer oder größer als 25 MB.',mime:''};
 if(!mime||file.type&&file.type!=='application/octet-stream'&&file.type!==mime&&!(mime==='application/zip'&&file.type==='application/x-zip-compressed'))return {error:'Dieser Dateityp wird nicht unterstützt. Bitte wähle ein Bild, PDF, Office-Dokument, TXT, CSV oder ZIP.',mime:''};
 return {error:null,mime};
}
function readyClient(){if(!supabase)throw new Error('Supabase ist nicht konfiguriert.');return supabase;}
function fileError(error:{code?:string;message?:string}|null){
 if(error?.code==='42501'||error?.code==='23503')return 'Aufgabe oder Kommentar ist nicht mehr verfügbar oder deine Berechtigung fehlt.';
 if(error?.code==='23514')return error.message||'Bitte wähle die Datei erneut aus.';
 return 'Die Datei konnte nicht gespeichert werden. Bitte erneut versuchen oder den Upload abbrechen.';
}
export async function uploadTaskAttachment(args:{id:string;workspaceId:string;taskId:string;commentId:string|null;file:File;active:()=>boolean}){
 const validation=validateTaskFile(args.file);if(validation.error)throw new Error(validation.error);
 const client=readyClient();
 const ensureActive=()=>{if(!args.active())throw new Error('Die Aufgabe oder das Konto wurde gewechselt.');};
 ensureActive();
 const reserved=await client.rpc('begin_task_attachment',{p_id:args.id,p_workspace:args.workspaceId,p_task:args.taskId,p_comment:args.commentId,p_name:args.file.name.trim(),p_mime:validation.mime,p_size:args.file.size});
 if(reserved.error||!reserved.data)throw new Error(fileError(reserved.error));
 ensureActive();
 const descriptor=reserved.data as TaskAttachment;
 if(descriptor.id!==args.id||descriptor.workspace_id!==args.workspaceId||descriptor.task_id!==args.taskId||descriptor.comment_id!==args.commentId)throw new Error('Ungültige Upload-Zuordnung.');
 if(descriptor.state==='ready')return;
 // Never overwrite. If an upload response was lost, finalization checks the
 // already stored object, making the same user intent safely retryable.
 try{await client.storage.from(taskFileBucket).upload(descriptor.storage_path,args.file,{contentType:validation.mime,cacheControl:'0',upsert:false});}catch{ /* Finalize can still recover a committed upload. */ }
 ensureActive();
 const result=await client.rpc('finish_task_attachment',{p_id:args.id});
 if(result.error||result.data?.state!=='ready')throw new Error(fileError(result.error));
 ensureActive();
}
export async function removeTaskAttachment(id:string){
 const {error}=await readyClient().rpc('remove_task_attachment',{p_id:id});if(error)throw new Error(fileError(error));
}
export async function downloadTaskAttachment(file:TaskAttachment,signal?:AbortSignal){
 const client=readyClient();
 // Authenticated, uncached fetch; no public or signed sharing URLs are created.
 const {data,error}=await client.storage.from(taskFileBucket).download(file.storage_path,{}, {cache:'no-store',signal});
 if(error||!data)throw new Error('Die Datei konnte nicht geladen werden. Prüfe deine Verbindung und deinen Zugriff.');
 if(data.size!==file.file_size)throw new Error('Die Datei ist unvollständig. Bitte erneut versuchen.');
 return data;
}
export async function listTaskAttachments(workspaceId:string,taskId:string,signal?:AbortSignal){
 let query=readyClient().from('task_attachments').select('id,workspace_id,task_id,comment_id,uploader_id,storage_path,file_name,mime_type,file_size,state,created_at')
 .eq('workspace_id',workspaceId).eq('task_id',taskId).eq('state','ready').order('created_at',{ascending:false}).order('id').limit(100);
 if(signal)query=query.abortSignal(signal);
 const {data,error}=await query;if(error)throw new Error('Dateien konnten nicht geladen werden. Bitte erneut versuchen.');
 return (data??[]) as TaskAttachment[];
}
