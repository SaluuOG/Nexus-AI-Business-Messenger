import { Bell, Check, CheckCheck, ChevronRight, Clock3, ListTodo, Mail, MessageCircle, RefreshCw, Settings2, UserPlus, UsersRound } from 'lucide-react';
import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Header } from '../components/Header';
import { routes } from '../app/routes';
import { notificationLabels, notificationTarget, type NexusNotification, type NotificationKind } from '../features/notifications/notifications';
import type { NotificationsModel } from '../features/notifications/useNotifications';

const icons = { direct_message: MessageCircle, group_message: UsersRound, contact_request: UserPlus, workspace_invitation: Mail, task_assigned: ListTodo, task_due: Clock3, task_overdue: Clock3 } satisfies Record<NotificationKind, typeof Bell>;
const dateLabel = (value: string) => new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

export function NotificationsPage({ model }: { model: NotificationsModel }) {
  const navigate = useNavigate();
  useEffect(() => {
    document.querySelector('.app > main')?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, []);
  const open = async (item: NexusNotification) => {
    const target = notificationTarget(item);
    if (target && (item.read_at || await model.markRead(item.id))) navigate(target);
  };
  return <section className="page notifications-page">
    <Header kicker="DEIN NEXUS" title="Benachrichtigungen" sub="Nachrichten, Team-Einladungen und deine Aufgaben an einem Ort." />
    <div className="notification-summary">
      <div className="notification-summary-icon"><Bell size={24} /></div>
      <div><b>{model.error ? 'Aktualisierung erforderlich' : model.loading && !model.items.length ? 'Wird geladen…' : model.unread_count ? model.unread_count + ' ungelesene Hinweise' : 'Alles im Blick'}</b><p>Aus allen deinen Workspaces und Chats. Nur für dich sichtbar.</p></div>
      <Link to={routes.settings + '?category=notifications'} className="notification-settings-link"><Settings2 size={16} /> Einstellungen</Link>
    </div>
    <div className="notification-toolbar">
      <div className="notification-filters" role="group" aria-label="Benachrichtigungen filtern">
        <button aria-pressed={!model.unreadOnly} onClick={() => model.setUnreadOnly(false)}>Alle</button>
        <button aria-pressed={model.unreadOnly} onClick={() => model.setUnreadOnly(true)}>Ungelesen</button>
      </div>
      <div className="notification-toolbar-actions">
        <button className="secondary" disabled={model.loading || model.busy} onClick={() => void model.refresh()} aria-label="Benachrichtigungen aktualisieren"><RefreshCw size={16} /></button>
        <button className="secondary" disabled={!model.unread_count || model.busy || model.loading || Boolean(model.error)} onClick={() => void model.markRead()}><CheckCheck size={16} /> Alle als gelesen markieren</button>
      </div>
    </div>
    {(model.error || model.actionError) && <div className="data-alert" role="alert">{model.error || model.actionError}{model.error && <button className="secondary" onClick={() => void model.refresh()}>Erneut versuchen</button>}</div>}
    {!model.error && !model.loading && !model.items.length && <div className="panel notification-empty"><CheckCheck size={32} /><h2>{model.unreadOnly ? 'Keine ungelesenen Hinweise' : 'Noch keine Benachrichtigungen'}</h2><p>{model.unreadOnly ? 'Du hast alle sichtbaren Hinweise gelesen.' : 'Hier erscheinen neue Nachrichten, Anfragen und Hinweise zu deinen Aufgaben. Deine Auswahl findest du in den Einstellungen.'}</p></div>}
    <ul className="notification-list" aria-label="Deine Benachrichtigungen" aria-busy={model.loading}>
      {model.items.map(item => { const Icon = icons[item.kind]; const target = notificationTarget(item); return <li key={item.id} className={'notification-item' + (item.read_at ? '' : ' unread')}>
        <span className={'notification-icon kind-' + item.kind}><Icon size={20} /></span>
        <button className="notification-open" disabled={!target || model.busy} onClick={() => void open(item)}>
          <span className="notification-meta"><span>{notificationLabels[item.kind]}</span><time dateTime={item.created_at}>{dateLabel(item.created_at)}</time></span>
          <b>{item.details.title}</b><span className="notification-detail">{item.details.detail}</span>
          {!target && <span>Dieser Inhalt ist nicht mehr verfügbar.</span>}
        </button>
        {!item.read_at ? <button className="notification-read" disabled={model.busy} aria-label={'Als gelesen markieren: ' + item.details.title} title="Als gelesen markieren" onClick={() => void model.markRead(item.id)}><Check size={18} /></button> : <ChevronRight size={17} className="notification-chevron" aria-hidden="true" />}
      </li>; })}
    </ul>
    {model.loading && <p className="notification-status" role="status">Benachrichtigungen werden aktualisiert…</p>}
    {model.has_more && !model.error && <button className="secondary notification-more" disabled={model.loading || model.busy} onClick={model.loadMore}>Weitere Hinweise laden</button>}
    <p className="notification-footer">Hinweise werden in der geöffneten App aktualisiert.{!model.connected && ' Die Verbindung wird wiederhergestellt; regelmäßige Aktualisierungen bleiben aktiv.'} „Als gelesen“ markiert den Hinweis. Chat-Lesebestätigungen entstehen beim Öffnen des Chats.</p>
  </section>;
}
