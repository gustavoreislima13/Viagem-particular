import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/useOnlineStatus.ts';

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-3 left-1/2 -translate-x-1/2 z-[460] px-4 py-2 rounded-2xl bg-amber-950/95 border border-amber-500/40 text-amber-100 text-xs font-medium shadow-xl flex items-center gap-2 backdrop-blur-md max-w-[92vw]"
    >
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <span>Sem conexão no momento — modo offline ativo para consulta de rotas salvas.</span>
    </div>
  );
}
