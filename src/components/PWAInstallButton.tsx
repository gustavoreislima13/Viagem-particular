import { useState } from 'react';
import { Download, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';

interface PWAInstallButtonProps {
  variant?: 'compact' | 'drawer';
}

export function PWAInstallButton({ variant = 'drawer' }: PWAInstallButtonProps) {
  const { canInstallNatively, isIOS, isInstalled, promptInstall } = usePWAInstall();
  const [showInstructions, setShowInstructions] = useState(false);

  if (isInstalled) return null;

  const handleClick = async () => {
    if (canInstallNatively) {
      await promptInstall();
      return;
    }
    setShowInstructions(true);
  };

  return (
    <>
      {variant === 'compact' ? (
        <button
          type="button"
          onClick={handleClick}
          aria-label="Instalar aplicativo no celular"
          className="glass-panel hover:bg-slate-800/90 px-2.5 sm:px-3 py-2.5 rounded-2xl text-xs font-semibold text-emeraldVip border border-emeraldVip/30 shadow-lg inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Instalar App</span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleClick}
          className="w-full px-3.5 py-3 rounded-xl bg-emeraldVip/10 hover:bg-emeraldVip/20 border border-emeraldVip/30 text-left text-sm font-semibold text-emeraldVip flex items-center gap-3 transition-colors"
        >
          <Smartphone className="w-4 h-4 shrink-0" />
          <span>Instalar App no Celular (PWA)</span>
        </button>
      )}

      {showInstructions && (
        <div
          className="fixed inset-0 z-[260] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
          onClick={() => setShowInstructions(false)}
        >
          <div
            className="glass-panel w-full max-w-sm rounded-3xl p-6 border border-emeraldVip/30 shadow-2xl space-y-4 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowInstructions(false)}
              aria-label="Fechar instruções"
              className="absolute right-4 top-4 w-8 h-8 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-2xl bg-emeraldVip/15 border border-emeraldVip/30 text-emeraldVip flex items-center justify-center">
              <Smartphone className="w-6 h-6" />
            </div>

            <div>
              <h3 className="font-display font-bold text-base text-white">
                Instalar Gustavo Reis VIP
              </h3>
              <p className="text-xs text-slate-400 mt-1">
                Tenha acesso rápido pela tela inicial do seu celular, em tela cheia e com carregamento instantâneo.
              </p>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-xs text-slate-200 bg-slate-900/80 border border-white/10 rounded-2xl p-4">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-emeraldVip">1.</span>
                  <span>
                    Toque no botão <Share className="w-3.5 h-3.5 inline text-sky-400 mx-0.5" />{' '}
                    <strong>Compartilhar</strong> na barra do Safari.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-emeraldVip">2.</span>
                  <span>
                    Role para baixo e toque em <strong>Adicionar à Tela de Início</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-emeraldVip">3.</span>
                  <span>
                    Confirme tocando em <strong>Adicionar</strong> no canto superior direito.
                  </span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-xs text-slate-200 bg-slate-900/80 border border-white/10 rounded-2xl p-4">
                <li className="flex items-start gap-2">
                  <span className="font-bold text-emeraldVip">1.</span>
                  <span>
                    Abra o menu do navegador (<strong>⋮</strong> no Chrome ou Edge).
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-emeraldVip">2.</span>
                  <span>
                    Selecione <strong>Instalar aplicativo</strong> ou{' '}
                    <strong>Adicionar à tela inicial</strong>.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="font-bold text-emeraldVip">3.</span>
                  <span>Confirme para criar o atalho exclusivo Gustavo Reis VIP.</span>
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowInstructions(false)}
              className="w-full py-3 rounded-2xl bg-emeraldVip text-slate-950 font-bold text-xs hover:brightness-110 transition-all"
            >
              Entendi
            </button>
          </div>
        </div>
      )}
    </>
  );
}
