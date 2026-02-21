import { registerSW } from 'virtual:pwa-register';

if (typeof window !== 'undefined') {
  registerSW({
    immediate: true,
    onRegisterError(error) {
      console.error('[PWA] Service worker registration failed:', error);
    }
  });
}
