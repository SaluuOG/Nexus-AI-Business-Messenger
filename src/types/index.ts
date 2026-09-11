export type Tab = 'briefing' | 'chats' | 'contacts' | 'business' | 'ai' | 'settings';
export type Workspace = 'WebWorkBalance' | 'Privat';
export type IdentityMode = 'business' | 'private';

export type Contact = {
  name: string;
  username: string;
  type: 'Kunde' | 'Team' | 'Privat';
  online?: boolean;
};

export type Chat = {
  name: string;
  company: string;
  text: string;
  time: string;
  badge?: number;
};

export type ChatMessage = {
  me: boolean;
  text: string;
};
