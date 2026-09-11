const normalize = (value?: string) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
};

export const supabaseConfig = {
  url: normalize(import.meta.env.VITE_SUPABASE_URL),
  publishableKey: normalize(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY),
} as const;

export const backendConfigured = Boolean(
  supabaseConfig.url && supabaseConfig.publishableKey,
);
