import { Search, Send, Sparkles } from 'lucide-react';
import { Header } from '../components/Header';
import { chats } from '../data/mockData';
import type { ChatMessage } from '../types';

type ChatsPageProps = {
  selected: number;
  setSelected: (index: number) => void;
  messages: ChatMessage[];
  msg: string;
  setMsg: (value: string) => void;
  send: () => void;
};

export function ChatsPage({
  selected,
  setSelected,
  messages,
  msg,
  setMsg,
  send,
}: ChatsPageProps) {
  const currentChat = chats[selected];

  return (
    <div className="chat-layout">
      <section className="chat-list">
        <Header
          kicker="MESSENGER"
          title="Chats"
          sub="Privat, Team und Kunden an einem Ort."
        />
        <div className="search">
          <Search size={16} />
          <input placeholder="Chats durchsuchen" />
        </div>

        {chats.map((chat, index) => (
          <button
            className={`chat${selected === index ? ' active' : ''}`}
            onClick={() => setSelected(index)}
            key={chat.name}
          >
            <div className="avatar">
              {chat.name
                .split(' ')
                .map((value) => value[0])
                .join('')
                .slice(0, 2)}
            </div>
            <span>
              <b>{chat.name}</b>
              <small>{chat.company}</small>
              <p>{chat.text}</p>
            </span>
            <em>
              {chat.time}
              {chat.badge && <i>{chat.badge}</i>}
            </em>
          </button>
        ))}
      </section>

      <section className="conversation">
        <div className="chat-head">
          <div>
            <b>{currentChat.name}</b>
            <small>{currentChat.company}</small>
          </div>
          <div className="project-pill">In Arbeit · 2.400 € · Montag</div>
        </div>

        <div className="messages">
          {messages.map((message, index) => (
            <div key={index} className={message.me ? 'bubble me' : 'bubble'}>
              {message.text}
            </div>
          ))}
          <div className="detected">
            <Sparkles size={16} />
            <div>
              <b>Neue Aufgabe erkannt</b>
              <span>Leasing-Seite ergänzen · Deadline Montag</span>
            </div>
            <button>Übernehmen</button>
          </div>
        </div>

        <div className="composer">
          <input
            value={msg}
            onChange={(event) => setMsg(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && send()}
            placeholder="Nachricht schreiben…"
          />
          <button onClick={send}>
            <Send size={18} />
          </button>
        </div>
      </section>
    </div>
  );
}
