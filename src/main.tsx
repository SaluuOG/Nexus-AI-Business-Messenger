import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './app/App';
import { AuthProvider } from './features/auth/AuthProvider';
import './styles.css';
import './auth.css';
import './password.css';
import './settings-data.css';
import './contacts-data.css';
import './business-data.css';
import './project-tasks.css';
import './briefing.css';
import './message-tasks.css';
import './settings-categories.css';
import './notifications.css';
import './chat-data.css';
import './group-chat.css';
import './group-management.css';
import './chat-layout-fixed.css';
import './chat-scan.css';

if ('scrollRestoration' in window.history) {
  window.history.scrollRestoration = 'manual';
}

const desktopPointer = window.matchMedia('(hover: hover) and (pointer: fine)');

const syncVisibleViewport = () => {
  const viewport = window.visualViewport;
  const visualHeight = Math.round(viewport?.height ?? window.innerHeight);
  const layoutHeight = Math.round(window.innerHeight);
  const isDesktop = desktopPointer.matches;

  // Desktop Safari already reports the page area below its toolbar/tab bar via innerHeight.
  // visualViewport.offsetTop can jump when Safari changes its chrome, which previously shifted
  // the whole Nexus shell downward and clipped the profile area at the bottom.
  const height = Math.max(320, isDesktop ? Math.min(layoutHeight, visualHeight) : visualHeight);
  const top = isDesktop ? 0 : Math.max(0, Math.round(viewport?.offsetTop ?? 0));

  document.documentElement.style.setProperty('--nexus-visual-height', `${height}px`);
  document.documentElement.style.setProperty('--nexus-visual-top', `${top}px`);
};

syncVisibleViewport();
window.addEventListener('resize', syncVisibleViewport, { passive: true });
window.addEventListener('orientationchange', syncVisibleViewport, { passive: true });
window.addEventListener('pageshow', syncVisibleViewport, { passive: true });
window.visualViewport?.addEventListener('resize', syncVisibleViewport, { passive: true });
window.visualViewport?.addEventListener('scroll', syncVisibleViewport, { passive: true });
desktopPointer.addEventListener?.('change', syncVisibleViewport);

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
