import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import '@fontsource/gowun-batang/400.css';
import '@fontsource/gowun-batang/700.css';
import App from './App';
import './styles.css';

createRoot(document.getElementById('root')!).render(<App />);

if (Capacitor.isNativePlatform()) {
  void (async () => {
    try {
      const { StatusBar, Style } = await import('@capacitor/status-bar');
      await StatusBar.setStyle({ style: Style.Light });
      if (Capacitor.getPlatform() === 'android') {
        await StatusBar.setBackgroundColor({ color: '#efede6' });
      }
    } catch {
      /* 상태 표시줄 설정은 선택 사항입니다. */
    }
  })();
} else if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* offline install is optional */
    });
  });
}
