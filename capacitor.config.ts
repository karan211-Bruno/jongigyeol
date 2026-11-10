import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.jongigyeol.note',
  appName: '종이결',
  webDir: 'dist',
  backgroundColor: '#efede6',
  ios: {
    contentInset: 'never',
    backgroundColor: '#efede6',
    preferredContentMode: 'mobile',
  },
  android: {
    backgroundColor: '#efede6',
    allowMixedContent: false,
    captureInput: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 500,
      launchAutoHide: true,
      backgroundColor: '#efede6',
      showSpinner: false,
      androidScaleType: 'CENTER_CROP',
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#efede6',
    },
  },
};

export default config;
