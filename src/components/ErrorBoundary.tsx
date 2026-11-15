import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      message: error?.message || 'Ocorreu um erro inesperado na interface.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('UI ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let parsedMsg = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          parsedMsg = `Erro de permissão/conexão (${parsed.operationType || 'operação'}): ${parsed.error}`;
        }
      } catch {
        // Keep raw message
      }

      return (
        <div className="min-h-screen w-full bg-obsidian text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-md w-full glass-panel rounded-3xl p-7 text-center border border-red-500/20 shadow-2xl">
            <div className="w-14 h-14 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-7 h-7" />
            </div>
            <h2 className="font-display text-xl font-bold text-white mb-2">
              Proteção de Sistema Ativada
            </h2>
            <p className="text-sm text-slate-400 mb-6 break-words">{parsedMsg}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 px-5 py-3 rounded-2xl bg-emeraldVip text-slate-950 font-bold text-sm hover:brightness-110 transition-all"
            >
              <RefreshCw className="w-4 h-4" />
              Recarregar Aplicativo
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
