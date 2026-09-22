export const bucket = 'nexus-task-attachments';
export const mimeTypes = ['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif','application/pdf','text/plain','text/csv','application/zip',
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation'];
export function validTaskFilePath(path) { return typeof path === 'string' && /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(path); }
export async function cleanTaskFiles({rpc,remove}) {
 const jobs=await rpc('claim_task_file_cleanup',{}); const result={removed:0,retry:0};
 for(let i=0;i<jobs.length;i+=5) await Promise.all(jobs.slice(i,i+5).map(async job=>{
  let success=false;
  try { if(validTaskFilePath(job.storage_path)) success=await remove(job.storage_path); } catch { /* Retry transient transport/storage failures. */ }
  await rpc('finish_task_file_cleanup',{p_id:job.id,p_lease:job.lease_token,p_success:success});
  result[success?'removed':'retry']++;
 }));
 return result;
}
