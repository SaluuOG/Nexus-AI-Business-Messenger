import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Copy, X } from 'lucide-react';
import type { NexusProject } from '../features/data/businessData';
import { archiveProjectTemplate, loadProjectTemplates, projectFromTemplate, saveProjectTemplate, shiftTemplateDate, type ProjectTemplate, type TemplateDraft } from '../features/data/projectTemplates';
import '../project-templates.css';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Die Verbindung wurde unterbrochen. Bitte erneut versuchen.';

// Both components are mounted only inside an authorized, account/workspace-keyed
// BusinessPage. Unmount guards discard late replies after role or scope changes.
export function SaveProjectTemplate({ project, onClose, onSaved }: { project: NexusProject; onClose: () => void; onSaved: (name: string) => void }) {
  const [name, setName] = useState(project.title.slice(0, 120));
  const [start, setStart] = useState(project.created_at.slice(0, 10));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const intent = useRef<{ id: string; name: string; start: string } | null>(null);
  const active = useRef(true), saving = useRef(false);
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    active.current = true;
    const before = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    return () => { active.current = false; before?.focus(); };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    try { shiftTemplateDate(start, 0); } catch (reason) { setError(errorText(reason)); return; }
    const request = intent.current || { id: crypto.randomUUID(), name, start };
    intent.current = request;
    saving.current = true; setBusy(true); setError('');
    try {
      const result = await saveProjectTemplate(request.id, project.workspace_id, project.id, request.name, request.start);
      if (active.current) onSaved(result.name);
    } catch (reason) { if (active.current) setError(errorText(reason)); }
    finally { saving.current = false; if (active.current) setBusy(false); }
  }
  return <div className="business-modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={dialog} className="business-modal" role="dialog" aria-modal="true" aria-labelledby="save-template-title" onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) onClose(); }
      if (event.key === 'Tab') {
        const elements = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)');
        if (!elements?.length) return;
        const first = elements[0], last = elements[elements.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      }
    }}>
      <div className="business-modal-head"><div><small>PROJEKTVORLAGEN</small><h2 id="save-template-title">Als Vorlage speichern</h2></div><button type="button" aria-label="Vorlagendialog schließen" disabled={busy} onClick={onClose}><X size={19} /></button></div>
      <form onSubmit={event => void save(event)}>
        <p className="template-hint">Übernimmt Beschreibung, Priorität, Aufgaben und Checklisten aus „{project.title}“. Zuständigkeiten werden beim neuen Projekt verteilt.</p>
        <div className="business-form-grid">
          <label className="wide"><span>Name der Vorlage *</span><input required minLength={2} maxLength={120} value={name} disabled={busy || Boolean(intent.current)} onChange={event => setName(event.target.value)} /></label>
          <label className="wide"><span>Startdatum des Ausgangsprojekts *</span><input required type="date" min="1900-01-01" max="9999-12-31" value={start} disabled={busy || Boolean(intent.current)} onChange={event => setStart(event.target.value)} /></label>
        </div>
        <p className="template-hint">Aufgabenfristen und Projektdeadline werden als Abstand zu diesem Datum gespeichert. Prüfe das Startdatum, bevor du speicherst.</p>
        {error && <p className="data-alert" role="alert">{error}</p>}
        <div className="business-modal-actions"><button type="button" className="secondary" disabled={busy} onClick={onClose}>Abbrechen</button><button className="primary" disabled={busy}>{busy ? 'Speichert…' : intent.current ? 'Erneut versuchen' : 'Vorlage speichern'}</button></div>
      </form>
    </div>
  </div>;
}

export function ProjectTemplatePicker({ workspaceId, disabled, hasDraft, onApply }: { workspaceId: string; disabled: boolean; hasDraft: boolean; onApply: (draft: TemplateDraft) => void }) {
  const [templates, setTemplates] = useState<ProjectTemplate[]>([]);
  const [selected, setSelected] = useState('');
  const [start, setStart] = useState(today);
  const [loading, setLoading] = useState(true), [removing, setRemoving] = useState(false);
  const [error, setError] = useState(''), [feedback, setFeedback] = useState('');
  const [confirm, setConfirm] = useState<'apply' | 'remove' | null>(null);
  const [reload, setReload] = useState(0);
  const active = useRef(true), busy = useRef(false);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    let current = true;
    setLoading(true); setError(''); setConfirm(null);
    void loadProjectTemplates(workspaceId).then(rows => {
      if (current) { setTemplates(rows); setSelected(id => rows.some(row => row.id === id) ? id : ''); }
    }).catch(reason => { if (current) { setTemplates([]); setSelected(''); setError(errorText(reason)); } })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [workspaceId, reload]);
  const template = templates.find(row => row.id === selected);
  const locked = disabled || loading || removing;
  function apply() {
    if (!template || locked) return;
    try {
      const draft = projectFromTemplate(template, start);
      onApply(draft); setConfirm(null); setError('');
      setFeedback('Vorlage übernommen. Prüfe jetzt Titel, Zuständigkeiten und Termine im Formular.');
    } catch (reason) { setError(errorText(reason)); }
  }
  async function remove() {
    if (!template || locked || busy.current) return;
    busy.current = true; setRemoving(true); setError('');
    try {
      await archiveProjectTemplate(template.id, workspaceId);
      if (active.current) { setTemplates(rows => rows.filter(row => row.id !== template.id)); setSelected(''); setConfirm(null); setFeedback('Vorlage entfernt. Bereits angelegte Projekte bleiben erhalten.'); }
    } catch (reason) { if (active.current) setError(errorText(reason)); }
    finally { busy.current = false; if (active.current) setRemoving(false); }
  }
  return <section className="project-template-picker" aria-label="Projektvorlagen">
    <h3><Copy size={16} /> Mit Vorlage starten</h3>
    <div className="business-form-grid">
      <label className="wide"><span>Projektvorlage</span><select value={selected} disabled={locked} onChange={event => { setSelected(event.target.value); setConfirm(null); setFeedback(''); }}>
        <option value="">{loading ? 'Vorlagen werden geladen…' : 'Ohne Vorlage starten'}</option>
        {templates.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}
      </select></label>
      {template && <label className="wide"><span>Startdatum für die Vorlage</span><input type="date" min="1900-01-01" max="9999-12-31" value={start} disabled={locked} onChange={event => { setStart(event.target.value); setConfirm(null); setFeedback(''); }} /></label>}
    </div>
    {template ? <>
      <p className="template-hint">{template.tasks.length} Aufgaben · {template.tasks.reduce((sum, task) => sum + task.checklist.length, 0)} Checklistenpunkte. Beim Übernehmen werden Fristen zum Startdatum berechnet und alle Aufgaben offen angelegt.</p>
      <div className="template-actions"><button type="button" className="secondary" disabled={locked || !start} onClick={() => hasDraft ? setConfirm('apply') : apply()}>Vorlage übernehmen</button><button type="button" className="secondary" disabled={locked} onClick={() => setConfirm('remove')}>Vorlage entfernen</button></div>
    </> : !loading && !error && !templates.length ? <p className="template-hint">Noch keine Vorlagen. Wähle bei einem bestehenden Projekt „Als Vorlage speichern“.</p> : null}
    {confirm && <div className="template-confirm" role="group" aria-label="Vorlagenaktion bestätigen">
      <p>{confirm === 'apply' ? 'Titel, Beschreibung, Priorität, Deadline und Aufgaben dieses Entwurfs durch die Vorlage ersetzen? Kunde und Auftragswert bleiben erhalten.' : 'Diese Vorlage für den Workspace entfernen? Bereits angelegte Projekte bleiben erhalten.'}</p>
      <div className="template-actions"><button type="button" className="secondary" disabled={locked} onClick={() => setConfirm(null)}>Zurück</button><button type="button" className="primary" disabled={locked} onClick={() => confirm === 'apply' ? apply() : void remove()}>{confirm === 'apply' ? 'Entwurf ersetzen' : 'Entfernen bestätigen'}</button></div>
    </div>}
    {error && <p role="alert" className="data-alert">{error}</p>}
    {feedback && <p role="status" className="template-hint">{feedback}</p>}
    <button type="button" className="template-refresh" disabled={locked} onClick={() => setReload(value => value + 1)}>Vorlagen aktualisieren</button>
  </section>;
}
