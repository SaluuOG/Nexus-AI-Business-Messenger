import { CheckCheck, FileSearch, LoaderCircle, Sparkles, X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChatScanError, loadChatScanStatus, scanChat, type ChatScanFinding, type ChatScanKind, type ChatScanResult, type ChatScanSource, type ChatScanStatus } from '../features/ai/chatScan';

type Props = { currentUserId?: string; kind: ChatScanKind; chatId: string; chatName: string; historyVersion?: string };
type ScanState =
  | { phase: 'checking' | 'ready' | 'unavailable' | 'scanning' }
  | { phase: 'complete'; result: ChatScanResult; historyVersion?: string }
  | { phase: 'error'; error: ChatScanError; action: 'status' | 'scan' };

export function ChatScanAction(props: Props) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [openScope, setOpenScope] = useState<string | null>(null);
  const scope = `${props.currentUserId ?? ''}:${props.kind}:${props.chatId}`;
  const close = () => { setOpenScope(null); trigger.current?.focus(); };
  return <div className="chat-scan-toolbar">
    <button ref={trigger} type="button" className="chat-scan-action" aria-label="Chat mit KI auswerten" title="Gesamten Chat mit KI auswerten" disabled={!props.currentUserId || !props.chatId} onClick={() => setOpenScope(scope)}>
      <Sparkles size={15} aria-hidden="true" /><span>Chat auswerten</span>
    </button>
    {openScope === scope && props.currentUserId ? <ChatScanDialog key={scope} {...props} onClose={close} /> : null}
  </div>;
}

function ChatScanDialog({ kind, chatId, chatName, historyVersion, onClose }: Props & { onClose: () => void }) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const mounted = useRef(false);
  const running = useRef<'status' | 'scan' | null>(null);
  const latestHistory = useRef(historyVersion);
  latestHistory.current = historyVersion;
  const previousHistory = useRef(historyVersion);
  const [state, setState] = useState<ScanState>({ phase: 'checking' });
  const currentState = useRef(state);
  currentState.current = state;
  const [provider, setProvider] = useState<ChatScanStatus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const abort = useCallback(() => {
    requestVersion.current += 1;
    controller.current?.abort();
    controller.current = null;
    running.current = null;
  }, []);

  const checkStatus = useCallback(async () => {
    abort();
    const ownVersion = requestVersion.current;
    const request = new AbortController();
    controller.current = request; running.current = 'status';
    setState({ phase: 'checking' }); setProvider(null);
    try {
      const status = await loadChatScanStatus({ kind, chatId }, request.signal);
      if (!mounted.current || request.signal.aborted || ownVersion !== requestVersion.current) return;
      setProvider(status); setState({ phase: status.available ? 'ready' : 'unavailable' });
    } catch (error) {
      if (!mounted.current || request.signal.aborted || ownVersion !== requestVersion.current) return;
      if (error instanceof ChatScanError && error.code === 'ai_not_configured') setState({ phase: 'unavailable' });
      else setState({ phase: 'error', error: asScanError(error), action: 'status' });
    } finally {
      if (ownVersion === requestVersion.current) { running.current = null; controller.current = null; }
    }
  }, [abort, kind, chatId]);

  useEffect(() => {
    mounted.current = true;
    dialog.current?.showModal();
    void checkStatus();
    return () => { mounted.current = false; abort(); };
  }, [abort, checkStatus]);

  useEffect(() => {
    if (previousHistory.current === historyVersion) return;
    previousHistory.current = historyVersion;
    if (running.current !== 'scan' && currentState.current.phase !== 'complete') return;
    abort();
    setState({ phase: 'ready' });
    setNotice('Der Verlauf hat sich geändert. Bitte erneut auswerten.');
  }, [abort, historyVersion]);

  useEffect(() => {
    const clearPrivateResult = () => {
      if (running.current !== 'scan' && currentState.current.phase !== 'complete') return;
      abort();
      setState({ phase: 'ready' });
      setNotice('Die Auswertung wurde zurückgesetzt. Bitte werte den aktuellen Verlauf erneut aus.');
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
    if (!provider?.available || running.current) return;
    abort();
    const ownVersion = requestVersion.current;
    const ownHistory = latestHistory.current;
    const request = new AbortController();
    controller.current = request; running.current = 'scan';
    setState({ phase: 'scanning' }); setNotice(null);
    try {
      const result = await scanChat({ kind, chatId }, request.signal);
      if (!mounted.current || request.signal.aborted || ownVersion !== requestVersion.current || ownHistory !== latestHistory.current) return;
      setState({ phase: 'complete', result, historyVersion: ownHistory });
    } catch (error) {
      if (!mounted.current || request.signal.aborted || ownVersion !== requestVersion.current || ownHistory !== latestHistory.current) return;
      if (error instanceof ChatScanError && error.code === 'ai_not_configured') { setProvider(null); setState({ phase: 'unavailable' }); }
      else setState({ phase: 'error', error: asScanError(error), action: 'scan' });
    } finally {
      if (ownVersion === requestVersion.current) { running.current = null; controller.current = null; }
    }
  };

  // Do not render even one stale frame after a history change.
  const result = state.phase === 'complete' && state.historyVersion === historyVersion ? state.result : null;
  const canStart = provider?.available && state.phase === 'ready';

  return createPortal(<dialog ref={dialog} className="chat-scan-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event => { event.preventDefault(); close(); }}>
    <div className="chat-scan-head">
      <div><small><Sparkles size={14} aria-hidden="true" /> NEXUS KI</small><h2 id={titleId}>Chat auswerten</h2><p id={descriptionId}>{kind === 'group' ? 'Gruppenchat' : 'Chat'} „{chatName}“</p></div>
      <button type="button" className="chat-scan-close" aria-label="Chat-Auswertung schließen" onClick={close} autoFocus><X size={19} aria-hidden="true" /></button>
    </div>
    <div className="chat-scan-body">
      {notice ? <p className="chat-scan-notice" role="status">{notice}</p> : null}
      {state.phase === 'checking' ? <div className="chat-scan-state" role="status"><LoaderCircle className="chat-scan-spinner" size={26} aria-hidden="true" /><p>KI-Verbindung wird geprüft…</p></div> : null}
      {state.phase === 'unavailable' ? <div className="chat-scan-state"><Sparkles size={30} aria-hidden="true" /><h3>KI noch nicht eingerichtet</h3><p>Sobald ein KI-Anbieter verbunden ist, kannst du hier den gesamten Chat auswerten. Es wurde kein Gespräch an eine KI übertragen.</p><button type="button" className="secondary" onClick={() => void checkStatus()}>Verbindung erneut prüfen</button></div> : null}
      {canStart ? <>
        <div className="chat-scan-intro"><FileSearch size={30} aria-hidden="true" /><h3>Das Wichtigste aus eurem Gespräch</h3><p>Zusammenfassung, wichtige Informationen, Entscheidungen, Aufgaben und offene Fragen – mit passenden Textstellen zum Nachlesen.</p></div>
        <div className="chat-scan-disclosure"><p>Mit „Gesamten Chat auswerten“ wird der gesamte für dich zugängliche Textverlauf dieses Chats an <strong>{provider.providerLabel}</strong> zur KI-Auswertung übertragen.</p><p>Datei-, Bild- und Audioinhalte werden nicht ausgewertet. Die KI kann Fehler machen; prüfe wichtige Angaben anhand der Quellen.</p></div>
        <div className="chat-scan-footer"><button type="button" className="primary" onClick={() => void start()}><Sparkles size={16} aria-hidden="true" />Gesamten Chat auswerten</button></div>
      </> : null}
      {state.phase === 'scanning' ? <div className="chat-scan-state" role="status"><LoaderCircle className="chat-scan-spinner" size={30} aria-hidden="true" /><h3>Der gesamte Chat wird ausgewertet…</h3><p>Bei langen Gesprächen kann das einen Moment dauern.</p><button type="button" className="secondary" onClick={() => { abort(); setState({ phase: 'ready' }); setNotice('Auswertung abgebrochen.'); }}>Abbrechen</button></div> : null}
      {state.phase === 'error' ? <div className="chat-scan-state chat-scan-error" role="alert"><h3>{state.error.code === 'empty_chat' ? 'Noch nichts auszuwerten' : state.error.code === 'no_access' ? 'Chat nicht mehr verfügbar' : 'Auswertung nicht verfügbar'}</h3><p>{state.error.message}</p>{state.error.code !== 'no_access' ? <button type="button" className="secondary" onClick={() => void (state.action === 'status' ? checkStatus() : start())}>Erneut versuchen</button> : null}</div> : null}
      {result ? <ScanResult result={result} /> : null}
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
