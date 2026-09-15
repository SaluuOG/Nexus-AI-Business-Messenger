import { CheckCheck, FileSearch, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatScanError, dispatchChatScanStateChanged, loadChatScanResult, loadChatScanStatus, loadChatScanWorkflow, scanChat, setChatScanDone,
  type ChatScanFinding, type ChatScanKind, type ChatScanResult, type ChatScanSource, type ChatScanStatus, type ChatScanWorkflowState } from '../features/ai/chatScan';

type Props = { currentUserId?: string; kind: ChatScanKind; chatId: string; chatName: string; historyVersion?: string };
type ScanState =
  | { phase: 'checking' | 'ready' | 'unavailable' | 'scanning' | 'done' | 'paused' }
  | { phase: 'complete'; result: ChatScanResult; historyVersion?: string; revision: string }
  | { phase: 'error'; error: ChatScanError; action: 'status' | 'scan' };
type WorkflowLoad = { data: ChatScanWorkflowState | null; historyVersion?: string; error: ChatScanError | null };
const statusLabels = { open: 'Offen', updated: 'Neue Nachrichten', processed: 'Ausgewertet', done: 'Fertig' };

export function ChatScanAction(props: Props) {
  // A new account or conversation gets fresh state, controllers and dialog scope.
  return <ScopedChatScanAction key={`${props.currentUserId ?? ''}:${props.kind}:${props.chatId}`} {...props} />;
}

function ScopedChatScanAction({ currentUserId, kind, chatId, chatName, historyVersion }: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const latestHistory = useRef(historyVersion);
  latestHistory.current = historyVersion;
  const stateRequest = useRef<AbortController | null>(null);
  const mutationRequest = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const [loaded, setLoaded] = useState<WorkflowLoad>({ data: null, error: null, historyVersion });
  const [mutating, setMutating] = useState(false);
  const [mutationError, setMutationError] = useState<ChatScanError | null>(null);
  const [open, setOpen] = useState(false);
  const workflow = loaded.historyVersion === historyVersion && !loaded.error ? loaded.data : null;
  const currentWorkflow = useRef(workflow);
  currentWorkflow.current = workflow;

  const refresh = useCallback(async (): Promise<ChatScanWorkflowState | null> => {
    if (!currentUserId || !chatId || mutationRequest.current) return null;
    stateRequest.current?.abort();
    const controller = new AbortController();
    stateRequest.current = controller;
    const version = ++requestVersion.current;
    const ownHistory = latestHistory.current;
    try {
      const data = await loadChatScanWorkflow({ kind, chatId }, controller.signal);
      if (!mounted.current || controller.signal.aborted || version !== requestVersion.current || ownHistory !== latestHistory.current) return null;
      setLoaded({ data, error: null, historyVersion: ownHistory });
      return data;
    } catch (error) {
      if (mounted.current && !controller.signal.aborted && version === requestVersion.current && ownHistory === latestHistory.current) {
        setLoaded({ data: null, error: asScanError(error), historyVersion: ownHistory });
      }
      return null;
    } finally { if (version === requestVersion.current) stateRequest.current = null; }
  }, [currentUserId, kind, chatId]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; requestVersion.current += 1; stateRequest.current?.abort(); mutationRequest.current?.abort(); };
  }, []);
  useEffect(() => { void refresh(); }, [refresh, historyVersion]);
  useEffect(() => {
    const visibleRefresh = () => { if (document.visibilityState !== 'hidden') void refresh(); };
    const changed = (event: Event) => {
      const detail: unknown = (event as CustomEvent).detail;
      if (typeof detail === 'object' && detail !== null && 'kind' in detail && 'chatId' in detail && detail.kind === kind && detail.chatId === chatId) void refresh();
    };
    const offline = () => {
      requestVersion.current += 1; stateRequest.current?.abort(); mutationRequest.current?.abort();
      setLoaded({ data: null, error: new ChatScanError('connection_error'), historyVersion: latestHistory.current });
    };
    const timer = window.setInterval(visibleRefresh, 30_000);
    window.addEventListener('focus', visibleRefresh);
    window.addEventListener('online', visibleRefresh);
    window.addEventListener('offline', offline);
    window.addEventListener('nexus:chat-scan-state-changed', changed);
    document.addEventListener('visibilitychange', visibleRefresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', visibleRefresh);
      window.removeEventListener('online', visibleRefresh);
      window.removeEventListener('offline', offline);
      window.removeEventListener('nexus:chat-scan-state-changed', changed);
      document.removeEventListener('visibilitychange', visibleRefresh);
    };
  }, [refresh, kind, chatId]);

  const toggleDone = async () => {
    const before = currentWorkflow.current;
    if (!before || mutationRequest.current) return;
    stateRequest.current?.abort(); requestVersion.current += 1;
    const controller = new AbortController(); mutationRequest.current = controller;
    const ownHistory = latestHistory.current;
    setMutating(true); setMutationError(null);
    try {
      const data = await setChatScanDone({ kind, chatId }, before.status !== 'done', before.revision, controller.signal);
      if (!mounted.current || controller.signal.aborted) return;
      if (ownHistory === latestHistory.current) setLoaded({ data, error: null, historyVersion: ownHistory });
      dispatchChatScanStateChanged({ kind, chatId });
    } catch (error) {
      if (mounted.current && !controller.signal.aborted) setMutationError(asScanError(error));
    } finally {
      if (mutationRequest.current === controller) mutationRequest.current = null;
      if (mounted.current) { setMutating(false); void refresh(); }
    }
  };
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const controlsDisabled = !currentUserId || !chatId || !workflow || mutating;
  return <div className="chat-scan-toolbar">
    <div className="chat-scan-workflow" aria-live="polite"><span>Dein Chatstatus</span><b className={`chat-scan-badge ${workflow?.status ?? 'loading'}`}>{workflow ? statusLabels[workflow.status] : loaded.error ? 'Nicht verfügbar' : 'Wird geladen…'}</b></div>
    <div className="chat-scan-controls">
      <button type="button" className="chat-scan-toggle" disabled={controlsDisabled} onClick={() => void toggleDone()}>{mutating ? <LoaderCircle className="chat-scan-spinner" size={14} aria-hidden="true" /> : workflow?.status === 'done' ? <RotateCcw size={14} aria-hidden="true" /> : <CheckCheck size={14} aria-hidden="true" />}<span>{workflow?.status === 'done' ? 'Wieder öffnen' : 'Als fertig markieren'}</span></button>
      <button ref={trigger} type="button" className="chat-scan-action" aria-label="Chat mit KI auswerten" title={workflow?.status === 'done' ? 'Öffne diesen Chat wieder, um ihn auszuwerten.' : workflow?.status === 'processed' ? 'Gespeicherte Auswertung ohne neuen KI-Aufruf ansehen' : 'Gesamten Chat mit KI auswerten'} disabled={controlsDisabled || workflow?.status === 'done'} onClick={() => setOpen(true)}>
        <Sparkles size={15} aria-hidden="true" /><span>{workflow?.status === 'processed' ? 'Auswertung ansehen' : 'Chat auswerten'}</span>
      </button>
    </div>
    {workflow?.status === 'done' ? <p className="chat-scan-workflow-note">Für dich abgeschlossen. Neue Nachrichten öffnen den Chat nicht automatisch wieder.</p> : null}
    {loaded.error ? <p className="chat-scan-workflow-error" role="alert">{loaded.error.code === 'no_access' ? loaded.error.message : 'Dein Chatstatus konnte nicht geladen werden.'}{loaded.error.code !== 'no_access' ? <button type="button" onClick={() => void refresh()}>Chatstatus erneut laden</button> : null}</p> : null}
    {mutationError ? <p className="chat-scan-workflow-error" role="alert">{mutationError.message}</p> : null}
    {open && currentUserId ? <ChatScanDialog kind={kind} chatId={chatId} chatName={chatName} historyVersion={historyVersion} workflow={workflow} onRefresh={refresh} onClose={close} /> : null}
  </div>;
}

type DialogProps = Props & { workflow: ChatScanWorkflowState | null; onRefresh: () => Promise<ChatScanWorkflowState | null>; onClose: () => void };
function ChatScanDialog({ kind, chatId, chatName, historyVersion, workflow, onRefresh, onClose }: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const running = useRef<'status' | 'scan' | null>(null);
  const privacyPaused = useRef(false);
  const latestHistory = useRef(historyVersion);
  latestHistory.current = historyVersion;
  const previousHistory = useRef(historyVersion);
  const currentWorkflow = useRef(workflow);
  currentWorkflow.current = workflow;
  const [state, setState] = useState<ScanState>({ phase: 'checking' });
  const currentState = useRef(state);
  currentState.current = state;
  const [provider, setProvider] = useState<ChatScanStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const abort = useCallback(() => {
    requestVersion.current += 1;
    controller.current?.abort(); controller.current = null; running.current = null;
  }, []);
  const checkStatus = useCallback(async () => {
    abort();
    if (document.visibilityState === 'hidden') {
      privacyPaused.current = true;
      setState({ phase: 'paused' });
      setNotice('Die Auswertung wurde ausgeblendet. Öffne sie erneut, um den aktuellen Stand zu prüfen.');
      return;
    }
    const before = currentWorkflow.current;
    setProvider(null);
    if (!before) { setState({ phase: 'checking' }); return; }
    if (before.status === 'done') { setState({ phase: 'done' }); return; }
    const ownVersion = requestVersion.current;
    const ownHistory = latestHistory.current;
    const request = new AbortController(); controller.current = request; running.current = 'status';
    setState({ phase: 'checking' });
    const isCurrent = () => mounted.current && document.visibilityState !== 'hidden' && !request.signal.aborted && ownVersion === requestVersion.current &&
      ownHistory === latestHistory.current && currentWorkflow.current?.revision === before.revision;
    try {
      if (before.status === 'processed') {
        const result = await loadChatScanResult({ kind, chatId }, request.signal);
        if (!isCurrent()) return;
        if (!result) throw new ChatScanError('history_changed');
        setState({ phase: 'complete', result, historyVersion: ownHistory, revision: before.revision });
      } else {
        const status = await loadChatScanStatus({ kind, chatId }, request.signal);
        if (!isCurrent()) return;
        if (status.workflow && status.workflow.revision !== before.revision) {
          setNotice('Der Chatstatus hat sich inzwischen geändert. Bitte prüfe den aktuellen Stand.');
          await onRefresh();
          return;
        }
        setProvider(status); setState({ phase: status.available ? 'ready' : 'unavailable' });
      }
    } catch (error) {
      if (!isCurrent()) return;
      if (error instanceof ChatScanError && error.code === 'ai_not_configured') setState({ phase: 'unavailable' });
      else { setState({ phase: 'error', error: asScanError(error), action: 'status' }); if (error instanceof ChatScanError && error.code === 'history_changed') void onRefresh(); }
    } finally { if (ownVersion === requestVersion.current) { running.current = null; controller.current = null; } }
  }, [abort, kind, chatId, onRefresh]);

  useEffect(() => {
    mounted.current = true; dialog.current?.showModal();
    return () => { mounted.current = false; abort(); };
  }, [abort]);
  useEffect(() => {
    if (privacyPaused.current && workflow?.status !== 'done') { abort(); setState({ phase: 'paused' }); return; }
    void checkStatus();
  }, [abort, checkStatus, workflow?.revision, workflow?.status]);
  useEffect(() => {
    if (previousHistory.current === historyVersion) return;
    previousHistory.current = historyVersion;
    abort(); setState({ phase: privacyPaused.current ? 'paused' : 'checking' });
    setNotice('Der Verlauf hat sich geändert. Bitte erneut auswerten.');
  }, [abort, historyVersion]);
  useEffect(() => {
    const clearPrivateResult = () => {
      if (running.current === null && currentState.current.phase !== 'complete') return;
      privacyPaused.current = true; abort(); setState({ phase: 'paused' });
      setNotice('Die Auswertung wurde ausgeblendet. Öffne sie erneut, um den aktuellen Stand zu prüfen.');
    };
    const visibility = () => { if (document.visibilityState === 'hidden') clearPrivateResult(); };
    window.addEventListener('blur', clearPrivateResult);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('offline', clearPrivateResult);
    return () => {
      window.removeEventListener('blur', clearPrivateResult);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('offline', clearPrivateResult);
    };
  }, [abort]);

  const close = () => { abort(); dialog.current?.close(); onClose(); };
  const start = async () => {
    const before = currentWorkflow.current;
    if (!provider?.available || !before?.canScan || running.current) return;
    abort();
    const ownVersion = requestVersion.current;
    const ownHistory = latestHistory.current;
    const request = new AbortController(); controller.current = request; running.current = 'scan';
    setState({ phase: 'scanning' }); setNotice(null);
    try {
      await scanChat({ kind, chatId }, request.signal);
      if (!mounted.current || request.signal.aborted || ownVersion !== requestVersion.current || ownHistory !== latestHistory.current || currentWorkflow.current?.revision !== before.revision) return;
      // Only display the server's saved, access-checked result for its refreshed
      // revision. A concurrent completion, edit or done/reopen cannot restore it.
      await onRefresh();
      if (mounted.current) dispatchChatScanStateChanged({ kind, chatId });
    } catch (error) {
      if (!mounted.current || request.signal.aborted || ownVersion !== requestVersion.current || ownHistory !== latestHistory.current) return;
      if (error instanceof ChatScanError && error.code === 'ai_not_configured') { setProvider(null); setState({ phase: 'unavailable' }); }
      else {
        setState({ phase: 'error', error: asScanError(error), action: 'scan' });
        if (error instanceof ChatScanError && ['chat_done', 'already_processed', 'status_changed', 'history_changed'].includes(error.code)) void onRefresh();
      }
    } finally { if (ownVersion === requestVersion.current) { running.current = null; controller.current = null; } }
  };

  const result = state.phase === 'complete' && state.historyVersion === historyVersion && state.revision === workflow?.revision && workflow.status === 'processed' ? state.result : null;
  const canStart = provider?.available && workflow?.canScan && state.phase === 'ready';
  return createPortal(<dialog ref={dialog} className="chat-scan-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="chat-scan-head">
      <div><small><Sparkles size={14} aria-hidden="true" /> NEXUS KI</small><h2 id={titleId}>Chat auswerten</h2><p id={descriptionId}>{kind === 'group' ? 'Gruppenchat' : 'Chat'} „{chatName}“</p></div>
      <button type="button" className="chat-scan-close" aria-label="Chat-Auswertung schließen" onClick={close} autoFocus><X size={19} aria-hidden="true" /></button>
    </div>
    <div className="chat-scan-body">
      {notice ? <p className="chat-scan-notice" role="status">{notice}</p> : null}
      {state.phase === 'checking' ? <div className="chat-scan-state" role="status"><LoaderCircle className="chat-scan-spinner" size={26} aria-hidden="true" /><p>Aktueller Stand wird geprüft…</p>{!workflow ? <button type="button" className="secondary" onClick={() => void onRefresh()}>Chatstatus erneut laden</button> : null}</div> : null}
      {state.phase === 'done' ? <div className="chat-scan-state"><CheckCheck size={30} aria-hidden="true" /><h3>Für dich fertig</h3><p>Dieser Chat wird nicht erneut ausgewertet. Über „Wieder öffnen“ im Chat kannst du ihn wieder berücksichtigen.</p></div> : null}
      {state.phase === 'paused' ? <div className="chat-scan-state"><button type="button" className="secondary" disabled={!workflow} onClick={() => { privacyPaused.current = false; setNotice(null); void checkStatus(); }}>Aktuellen Stand prüfen</button></div> : null}
      {state.phase === 'unavailable' ? <div className="chat-scan-state"><Sparkles size={30} aria-hidden="true" /><h3>KI noch nicht eingerichtet</h3><p>Sobald ein KI-Anbieter verbunden ist, kannst du hier den gesamten Chat auswerten. Es wurde kein Gespräch an eine KI übertragen.</p><button type="button" className="secondary" onClick={() => void checkStatus()}>Verbindung erneut prüfen</button></div> : null}
      {canStart ? <>
        <div className="chat-scan-intro"><FileSearch size={30} aria-hidden="true" /><h3>Das Wichtigste aus eurem Gespräch</h3><p>Zusammenfassung, wichtige Informationen, Entscheidungen, Aufgaben und offene Fragen – mit passenden Textstellen zum Nachlesen.</p></div>
        {workflow.status === 'updated' ? <p className="chat-scan-notice">Seit deiner letzten Auswertung wurde der Verlauf ergänzt oder geändert. Für den Zusammenhang wird erneut der gesamte zugängliche Textverlauf berücksichtigt.</p> : null}
        <div className="chat-scan-disclosure"><p>Mit „Gesamten Chat auswerten“ wird der gesamte für dich zugängliche Textverlauf dieses Chats an <strong>{provider.providerLabel}</strong> zur KI-Auswertung übertragen.</p><p>Datei-, Bild- und Audioinhalte werden nicht ausgewertet. Die KI kann Fehler machen; prüfe wichtige Angaben anhand der Quellen.</p></div>
        <div className="chat-scan-footer"><button type="button" className="primary" onClick={() => void start()}><Sparkles size={16} aria-hidden="true" />Gesamten Chat auswerten</button></div>
      </> : null}
      {state.phase === 'scanning' ? <div className="chat-scan-state" role="status"><LoaderCircle className="chat-scan-spinner" size={30} aria-hidden="true" /><h3>Der gesamte Chat wird ausgewertet…</h3><p>Bei langen Gesprächen kann das einen Moment dauern.</p><button type="button" className="secondary" onClick={() => { privacyPaused.current = true; abort(); setState({ phase: 'paused' }); setNotice('Auswertung abgebrochen.'); void onRefresh(); }}>Abbrechen</button></div> : null}
      {state.phase === 'error' ? <div className="chat-scan-state chat-scan-error" role="alert"><h3>{state.error.code === 'empty_chat' ? 'Noch nichts auszuwerten' : state.error.code === 'no_access' ? 'Chat nicht mehr verfügbar' : 'Auswertung nicht verfügbar'}</h3><p>{state.error.message}</p>{state.error.code !== 'no_access' ? <button type="button" className="secondary" onClick={() => void (state.action === 'scan' && workflow?.canScan ? start() : checkStatus())}>Erneut versuchen</button> : null}</div> : null}
      {result ? <><div className="chat-scan-saved"><h3>Letzte Auswertung</h3>{workflow?.lastScannedAt ? <p>{formatDate(workflow.lastScannedAt)} · Gespeichertes Ergebnis ohne neuen KI-Aufruf.</p> : null}<p>Ausgewertet bedeutet nicht erledigt. Markiere den Chat erst als fertig, wenn für dich alles bearbeitet ist.</p></div><ScanResult result={result} /></> : null}
      {result ? <div className="chat-scan-footer"><button type="button" className="secondary" onClick={close}>Zurück zum Chat</button></div> : null}
    </div>
  </dialog>, document.body);
}

function asScanError(error: unknown): ChatScanError { return error instanceof ChatScanError ? error : new ChatScanError('connection_error'); }
const dateFormat = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
function formatDate(value: string) { return dateFormat.format(new Date(value)); }

function ScanResult({ result }: { result: ChatScanResult }) {
  const sources = new Map(result.sources.map(source => [source.id, source]));
  const coverage = result.coverage;
  return <div className="chat-scan-result">
    <div className="chat-scan-coverage" role="status"><CheckCheck size={19} aria-hidden="true" /><div><b>{coverage.messageCount} Nachrichten ausgewertet</b>{coverage.from && coverage.to ? <span>{formatDate(coverage.from)} bis {formatDate(coverage.to)}</span> : null}<span>Gesamter zugänglicher Textverlauf · {coverage.attachmentsExcluded} Anhänge nicht ausgewertet</span></div></div>
    <section className="chat-scan-section"><h3>Zusammenfassung</h3><p>{result.summary}</p></section>
    <Findings title="Wichtige Informationen" empty="Keine weiteren Informationen erkannt." items={result.facts} sources={sources} />
    <Findings title="Entscheidungen" empty="Keine eindeutigen Entscheidungen erkannt." items={result.decisions} sources={sources} />
    <Findings title="Aufgaben" empty="Keine konkreten Aufgaben erkannt." items={result.tasks} sources={sources} />
    <Findings title="Offene Fragen" empty="Keine offenen Fragen erkannt." items={result.questions} sources={sources} />
    <p className="chat-scan-note">KI-Ergebnis bitte anhand der Quellen prüfen. Diese Auswertung legt keine Aufgaben an und sendet keine Nachrichten.</p>
  </div>;
}

function Findings({ title, empty, items, sources }: { title: string; empty: string; items: ChatScanFinding[]; sources: Map<string, ChatScanSource> }) {
  return <section className="chat-scan-section"><h3>{title}</h3>{items.length ? <ul>{items.map((item, index) => <li key={index}><p>{item.text}</p><details className="chat-scan-sources"><summary>Quellen anzeigen ({item.sourceIds.length})</summary>{item.sourceIds.map(id => {
    const source = sources.get(id)!;
    return <figure key={id}><figcaption>{source.sender} · <time dateTime={source.createdAt}>{formatDate(source.createdAt)}</time></figcaption><blockquote>{source.excerpt}</blockquote></figure>;
  })}</details></li>)}</ul> : <p className="chat-scan-empty">{empty}</p>}</section>;
}
