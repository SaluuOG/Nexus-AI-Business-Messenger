import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.saluuog.nexus',
  appName: 'Nexus',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    iosScheme: 'capacitor',
  },
};

export default config;
