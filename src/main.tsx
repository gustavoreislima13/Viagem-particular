import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import './index.css';

import { mapGoogleMapsErrorMessage, reportGoogleMapsError } from './lib/googleMaps.ts';

window.gm_authFailure = () => {
  reportGoogleMapsError(
    'Erro de autenticação na chave Google Maps (gm_authFailure: verifique restrições de domínio/faturamento)'
  );
};

const GMP_ERROR_TOKENS = [
  'OverQuotaMapError',
  'QuotaExceededError',
  'InvalidKeyMapError',
  'RefererNotAllowedMapError',
  'ApiNotActivatedMapError',
  'BillingNotEnabledMapError',
  'ApiTargetBlockedMapError',
];

const origErr = console.error;
console.error = (...args: unknown[]) => {
  const joined = args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ');
  if (GMP_ERROR_TOKENS.some((tok) => joined.includes(tok))) {
    reportGoogleMapsError(mapGoogleMapsErrorMessage(joined));
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
