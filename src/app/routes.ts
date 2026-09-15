export const routes = {
  auth: '/auth',
  resetPassword: '/auth/reset-password',
  briefing: '/app/briefing',
  chats: '/app/chats',
  groups: '/app/groups',
  contacts: '/app/contacts',
  business: '/app/business',
  ai: '/app/ai',
  settings: '/app/settings',
  notifications: '/app/notifications',
} as const;

export type RouteKey = keyof typeof routes;
