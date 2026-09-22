import { useEffect, useId, useRef, useState } from 'react';
import { Download, Image as ImageIcon, Paperclip, Upload, X } from 'lucide-react';
import type { WorkspaceRole } from '../features/data/nexusData';
import { downloadTaskAttachment, removeTaskAttachment, taskFileAccept, uploadTaskAttachment, validateTaskFile, type TaskAttachment } from '../features/data/taskAttachments';

type Props = { workspaceId: string; taskId: string; commentId?: string; userId: string; role: WorkspaceRole; files: TaskAttachment[]; canUpload: boolean; refresh: () => Promise<void> };
const message = (error: unknown) => error instanceof Error ? error.message : 'Bitte prüfe die Verbindung und versuche es erneut.';
const sizeLabel = (bytes: number) => bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toLocaleString('de-DE', { maximumFractionDigits: 1 })} MB`;

export function TaskAttachments({ workspaceId, taskId, commentId, userId, role, files, canUpload, refresh }: Props) {
  const [expanded, setExpanded] = useState(false);
  return <div className="task-files">
    {files.length > 0 && <ul className="task-file-list" aria-label={commentId ? 'Anhänge zum Kommentar' : 'Dateien zur Aufgabe'}>
      {files.map(file => <FileRow key={file.id} file={file} canRemove={['owner', 'admin'].includes(role) || role === 'member' && file.uploader_id === userId} refresh={refresh} />)}
    </ul>}
    {!commentId && !files.length && <p className="collaboration-empty">Noch keine Dateien. Teile zum Beispiel einen Entwurf, ein Foto oder ein PDF.</p>}
    {canUpload && (!commentId || expanded ? <FileUpload workspaceId={workspaceId} taskId={taskId} commentId={commentId ?? null} refresh={refresh} />
      : <button type="button" className="task-file-add" onClick={() => setExpanded(true)}><Paperclip size={14} /> Datei zum Kommentar hinzufügen</button>)}
  </div>;
}

function FileUpload({ workspaceId, taskId, commentId, refresh }: { workspaceId: string; taskId: string; commentId: string | null; refresh: () => Promise<void> }) {
  const [selection, setSelection] = useState<{ file: File; id: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(false);
  const busy = useRef(false);
  const field = useId();
  const hint = useId();
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const clear = () => { setSelection(null); if (input.current) input.current.value = ''; };
  const run = async (cancel: boolean) => {
    if (!selection || busy.current) return;
    busy.current = true; setSaving(true); setError(null); setFeedback(null);
    try {
      if (cancel) await removeTaskAttachment(selection.id);
      else await uploadTaskAttachment({ ...selection, workspaceId, taskId, commentId, active: () => alive.current });
      if (!alive.current) return;
      clear(); setFeedback(cancel ? 'Upload abgebrochen.' : 'Datei gespeichert.');
      await refresh();
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { busy.current = false; if (alive.current) setSaving(false); }
  };
  return <form className="task-file-upload" onSubmit={event => { event.preventDefault(); void run(false); }}>
    <label htmlFor={field}>{commentId ? 'Datei zum Kommentar' : 'Datei zur Aufgabe'}</label>
    <input ref={input} id={field} type="file" accept={taskFileAccept} disabled={saving || Boolean(selection)} aria-describedby={hint} onChange={event => {
      const file = event.target.files?.[0]; setError(null); setFeedback(null);
      if (!file) { clear(); return; }
      const validation = validateTaskFile(file);
      if (validation.error) { setError(validation.error); event.target.value = ''; return; }
      setSelection({ file, id: crypto.randomUUID() });
    }} />
    <small id={hint}>Bilder, PDF, DOCX, XLSX, PPTX, TXT, CSV oder ZIP · maximal 25 MB je Datei</small>
    {selection && <div className="task-file-upload-actions"><span>{selection.file.name} · {sizeLabel(selection.file.size)}</span>
      <button className="secondary" disabled={saving}><Upload size={14} /> {saving ? 'Bitte warten…' : error ? 'Erneut hochladen' : 'Hochladen'}</button>
      <button type="button" className="task-file-add" disabled={saving} onClick={() => void run(true)}>Abbrechen</button>
    </div>}
    {error && <p className="data-alert" role="alert">{error}</p>}
    {feedback && <p className="contact-feedback" role="status">{feedback}</p>}
  </form>;
}

function FileRow({ file, canRemove, refresh }: { file: TaskAttachment; canRemove: boolean; refresh: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const alive = useRef(false);
  const pending = useRef(false);
  const request = useRef<AbortController | null>(null);
  const urls = useRef(new Set<string>());
  const closePreview = () => setPreview(null);
  useEffect(() => {
    alive.current = true;
    const ownedUrls = urls.current;
    return () => { alive.current = false; request.current?.abort(); for (const url of ownedUrls) URL.revokeObjectURL(url); ownedUrls.clear(); };
  }, []);
  useEffect(() => { if (preview) return () => { URL.revokeObjectURL(preview); urls.current.delete(preview); }; }, [preview]);
  const load = async (show: boolean) => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError(null);
    request.current = new AbortController();
    try {
      const blob = await downloadTaskAttachment(file, request.current.signal);
      if (!alive.current) return;
      const url = URL.createObjectURL(blob); urls.current.add(url);
      if (show) setPreview(url);
      else {
        const link = document.createElement('a'); link.href = url; link.download = file.file_name;
        document.body.append(link); link.click(); link.remove();
        window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url); }, 1000);
      }
    } catch (e) { if (alive.current) setError(message(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const remove = async () => {
    if (pending.current || !canRemove || !window.confirm(`„${file.file_name}“ dauerhaft entfernen?`)) return;
    pending.current = true; setBusy(true); setError(null);
    try { await removeTaskAttachment(file.id); if (alive.current) { closePreview(); await refresh(); } }
    catch (e) { if (alive.current) setError(message(e)); }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  return <li>
    <div className="task-file-name"><Paperclip size={16} /><div><b>{file.file_name}</b><small>{sizeLabel(file.file_size)}</small></div></div>
    <div className="task-file-buttons">
      {file.mime_type.startsWith('image/') && <button type="button" disabled={busy} onClick={() => void load(true)} aria-label={`Vorschau: ${file.file_name}`}><ImageIcon size={15} /> Vorschau</button>}
      <button type="button" disabled={busy} onClick={() => void load(false)} aria-label={`Herunterladen: ${file.file_name}`}><Download size={15} /> Laden</button>
      {canRemove && <button type="button" disabled={busy} onClick={() => void remove()} aria-label={`Datei entfernen: ${file.file_name}`}><X size={15} /> Entfernen</button>}
    </div>
    {busy && <small role="status">Datei wird verarbeitet…</small>}
    {error && <p className="data-alert" role="alert">{error}</p>}
    {preview && <ImagePreview url={preview} name={file.file_name} close={closePreview} />}
  </li>;
}

function ImagePreview({ url, name, close }: { url: string; name: string; close: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeRef = useRef(close);
  const heading = useId();
  const [failed, setFailed] = useState(false);
  useEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => {
    dialog.current?.showModal();
    const hide = () => { if (document.hidden) closeRef.current(); };
    const offline = () => closeRef.current();
    document.addEventListener('visibilitychange', hide); window.addEventListener('offline', offline);
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('offline', offline); };
  }, []);
  return <dialog ref={dialog} className="task-image-preview" aria-labelledby={heading} onCancel={event => { event.preventDefault(); close(); }}>
    <div><h4 id={heading}>{name}</h4><button type="button" onClick={close} autoFocus aria-label="Bildvorschau schließen"><X size={20} /></button></div>
    {failed ? <p>Dieses Bildformat kann dein Browser nicht anzeigen. Du kannst die Datei herunterladen.</p> : <img src={url} alt={name} onError={() => setFailed(true)} />}
  </dialog>;
}
