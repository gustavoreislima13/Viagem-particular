import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

// Case A Google Maps Demo Key Quota Defense: register BEFORE React mounts
declare global {
  interface Window {
    gm_authFailure?: () => void;
    __GMP_QUOTA_EXCEEDED?: boolean;
  }
}

window.gm_authFailure = () => {
  window.__GMP_QUOTA_EXCEEDED = true;
  window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
};

const origErr = console.error;
console.error = (...args: unknown[]) => {
  if (
    args.some(
      (a) =>
        typeof a === 'string' &&
        (a.includes('OverQuotaMapError') || a.includes('QuotaExceededError'))
    )
  ) {
    window.__GMP_QUOTA_EXCEEDED = true;
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  origErr.apply(console, args);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>
);
