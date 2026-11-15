import { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';

export function QuotaBanner() {
  const [quotaHit, setQuotaHit] = useState(() => Boolean(window.__GMP_QUOTA_EXCEEDED));

  useEffect(() => {
    const handler = () => setQuotaHit(true);
    window.addEventListener('gmp-quota-exceeded', handler);
    return () => window.removeEventListener('gmp-quota-exceeded', handler);
  }, []);

  if (!quotaHit) return null;

  return (
    <div
      role="alert"
      className="fixed top-0 left-0 right-0 z-[500] bg-amber-950/95 border-b border-amber-500/40 px-4 py-2.5 text-xs text-amber-100 flex items-center justify-center gap-3 backdrop-blur-md shadow-lg"
    >
      <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
      <span className="truncate sm:whitespace-normal">
        Limite diário da chave de demonstração do Google Maps atingido. As rotas continuam funcionando com cálculo inteligente.{' '}
        <a
          href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
          target="_blank"
          rel="noopener noreferrer"
          className="underline font-semibold text-amber-300 hover:text-amber-200 ml-1"
        >
          Saiba como ampliar a cota
        </a>
      </span>
    </div>
  );
}
