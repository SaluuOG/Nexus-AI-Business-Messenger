import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app/App';
import { AuthProvider } from './features/auth/AuthProvider';
import './styles.css';
import './auth.css';
import './settings-data.css';
import './contacts-data.css';
import './chat-data.css';
import './group-chat.css';
import './chat-layout-fixed.css';

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

const nativeScrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = function scrollIntoViewInsideNexus(arg?: boolean | ScrollIntoViewOptions) {
  const messageScroller = this.closest?.('.real-chat-layout .messages') as HTMLElement | null;
  if (messageScroller) {
    const behavior = typeof arg === 'object' && arg?.behavior ? arg.behavior : 'auto';
    messageScroller.scrollTo({ top: messageScroller.scrollHeight, behavior });
    return;
  }
  (nativeScrollIntoView as (arg?: boolean | ScrollIntoViewOptions) => void).call(this, arg);
};

window.addEventListener('scroll', () => {
  if (document.querySelector('.real-chat-layout') && (window.scrollX !== 0 || window.scrollY !== 0)) {
    window.scrollTo(0, 0);
  }
}, { passive: true });

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </HashRouter>
  </React.StrictMode>,
);
