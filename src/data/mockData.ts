import type { Chat, ChatMessage, Contact } from '../types';

export const seedContacts: Contact[] = [
  { name: 'Max Mustermann', username: '@max.mueller', type: 'Kunde', online: true },
  { name: 'Lisa Bauer', username: '@lisa.bauer', type: 'Kunde' },
  { name: 'Sula', username: '@sula', type: 'Team', online: true },
  { name: 'Marco', username: '@marco', type: 'Privat' },
];

export const chats: Chat[] = [
  {
    name: 'Max Mustermann',
    company: 'Autohaus Müller',
    text: 'Kannst du die Leasing-Seite noch ergänzen?',
    time: '12:48',
    badge: 2,
  },
  {
    name: 'Lisa Bauer',
    company: 'Restaurant Bella',
    text: 'Die neue Galerie sieht super aus 🙌',
    time: '11:20',
  },
  {
    name: 'Team Web',
    company: 'WebWorkBalance',
    text: 'Sula: Header ist fertig.',
    time: '09:15',
    badge: 5,
  },
  {
    name: 'Marco',
    company: 'Privat',
    text: 'Samstag 20 Uhr passt.',
    time: 'Gestern',
  },
];

export const initialMessages: ChatMessage[] = [
  {
    me: false,
    text: 'Hi Samet, wir möchten auf der Startseite noch einen Button für Leasing ergänzen.',
  },
  {
    me: true,
    text: 'Klar, kann ich mit aufnehmen. Soll er direkt auf eine neue Leasing-Seite führen?',
  },
  { me: false, text: 'Ja genau. Bitte bis Montag fertigstellen.' },
];
