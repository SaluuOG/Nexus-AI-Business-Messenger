export const routes = {
  briefing: '/app/briefing',
  chats: '/app/chats',
  contacts: '/app/contacts',
  business: '/app/business',
  ai: '/app/ai',
  settings: '/app/settings',
} as const;

export type RouteKey = keyof typeof routes;
