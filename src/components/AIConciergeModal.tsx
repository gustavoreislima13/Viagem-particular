import { useEffect, useRef, useState } from 'react';
import {
  Bot,
  ExternalLink,
  Globe,
  Loader2,
  MapPin,
  Send,
  Sparkles,
  TrendingUp,
  User,
  X,
  Zap,
} from 'lucide-react';
import { api } from '../services/api.ts';
import { AiMode, AiSpeed, ChatMessage, GroundingSource } from '../types.ts';

interface AIConciergeModalProps {
  isOpen: boolean;
  isAdmin: boolean;
  initialMode?: AiMode;
  currentLat: number;
  currentLng: number;
  onClose: () => void;
}

const SUGGESTIONS_BY_MODE: Record<AiMode, string[]> = {
  concierge: [
    'Quanto custa um Bate & Volta para Guarulhos e como funciona o desconto?',
    'Quais vantagens do nível Ouro e Black no Clube VIP?',
  ],
  maps: [
    'Quais os melhores restaurantes executivos perto da Av. Paulista e Faria Lima?',
    'Hotéis 5 estrelas próximos ao Aeroporto de Congonhas com fácil embarque',
  ],
  search: [
    'Como está a previsão do tempo e o trânsito hoje em São Paulo?',
    'Principais eventos corporativos hoje na região da Vila Olímpia e Berrini',
  ],
  finance: [
    'Faça uma auditoria completa do meu lucro líquido, gastos e margem atual.',
    'Como aumentar o ticket médio mantendo a tarifa mínima de R$ 3,00/km?',
  ],
};

export function AIConciergeModal({
  isOpen,
  isAdmin,
  initialMode = 'concierge',
  currentLat,
  currentLng,
  onClose,
}: AIConciergeModalProps) {
  const [mode, setMode] = useState<AiMode>(initialMode);
  const [speed, setSpeed] = useState<AiSpeed>('deep');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome-ai',
      role: 'assistant',
      text: 'Olá! Sou o Assistente Executivo da plataforma Gustavo Reis. Posso simular cotações VIP, buscar lugares reais com Google Maps Grounding, checar informações ao vivo na Web ou analisar métricas financeiras no modo Admin.',
      modelUsed: 'gemini-4-hydrogen',
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    },
  ]);

  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending]);

  if (!isOpen) return null;

  const sendMessage = async (textOverride?: string) => {
    const queryText = (textOverride ?? input).trim();
    if (!queryText || sending) return;

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      text: queryText,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    if (!textOverride) setInput('');
    setSending(true);

    try {
      let resp: { text: string; modelUsed: string; sources: GroundingSource[] };
      if (mode === 'maps') {
        resp = await api.aiMapsGrounding(queryText, currentLat, currentLng);
      } else if (mode === 'search') {
        resp = await api.aiSearchGrounding(queryText);
      } else {
        resp = await api.aiChat({
          message: queryText,
          history: nextHistory.filter((m) => m.id !== 'welcome-ai'),
          mode,
          speed,
        });
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          text: resp.text,
          modelUsed: resp.modelUsed,
          sources: resp.sources || [],
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } catch (err: any) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          text: err?.message || 'Não foi possível consultar o assistente Gemini neste momento.',
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[230] flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-2xl h-[86vh] rounded-3xl overflow-hidden shadow-2xl border border-emeraldVip/25 flex flex-col">
        {/* Header */}
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-emeraldVip/15 border border-emeraldVip/30 text-emeraldVip flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h3 className="font-display font-bold text-base sm:text-lg text-white truncate">
                Concierge & Inteligência VIP
              </h3>
              <p className="text-[11px] text-slate-400 truncate">
                Chat multi-turno · Google Maps Grounding · Google Search Grounding
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar assistente IA"
            className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Mode & Speed Toolbar */}
        <div className="px-4 py-2.5 border-b border-white/10 bg-slate-900/60 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            <button
              type="button"
              onClick={() => setMode('concierge')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                mode === 'concierge'
                  ? 'bg-emeraldVip text-slate-950'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Bot className="w-3.5 h-3.5" />
              Concierge VIP
            </button>
            <button
              type="button"
              onClick={() => setMode('maps')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                mode === 'maps'
                  ? 'bg-emeraldVip text-slate-950'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <MapPin className="w-3.5 h-3.5" />
              Locais · Maps
            </button>
            <button
              type="button"
              onClick={() => setMode('search')}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                mode === 'search'
                  ? 'bg-emeraldVip text-slate-950'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Busca Web
            </button>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setMode('finance')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap inline-flex items-center gap-1.5 transition-colors ${
                  mode === 'finance'
                    ? 'bg-goldVip text-slate-950'
                    : 'bg-slate-800/80 text-goldVip hover:bg-slate-800'
                }`}
              >
                <TrendingUp className="w-3.5 h-3.5" />
                Analista Admin
              </button>
            )}
          </div>

          {(mode === 'concierge' || mode === 'finance') && (
            <div className="flex items-center gap-1 bg-slate-950/70 p-1 rounded-lg border border-white/10">
              <button
                type="button"
                onClick={() => setSpeed('deep')}
                className={`px-2 py-1 rounded text-[11px] font-semibold transition-colors ${
                  speed === 'deep' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Avançado
              </button>
              <button
                type="button"
                onClick={() => setSpeed('fast')}
                className={`px-2 py-1 rounded text-[11px] font-semibold inline-flex items-center gap-1 transition-colors ${
                  speed === 'fast' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3 h-3 text-goldVip" />
                Rápido
              </button>
            </div>
          )}
        </div>

        {/* Scrollable Conversation Thread */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-xl bg-emeraldVip/15 border border-emeraldVip/30 text-emeraldVip flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className="w-4 h-4" />
                </div>
              )}

              <div
                className={`max-w-[85%] rounded-2xl px-4 py-3 text-xs sm:text-sm leading-relaxed space-y-2.5 ${
                  msg.role === 'user'
                    ? 'bg-emeraldVip text-slate-950 font-medium'
                    : 'bg-slate-900/90 border border-white/10 text-slate-200'
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{msg.text}</p>

                {/* Grounding Citations (Maps + Web) */}
                {msg.sources && msg.sources.length > 0 && (
                  <div className="pt-2 border-t border-white/10 space-y-1.5">
                    <p className="text-[11px] font-semibold text-slate-400">
                      Fontes verificadas ({msg.sources.length})
                    </p>
                    <div className="grid gap-1.5">
                      {msg.sources.map((src, idx) => (
                        <a
                          key={`${src.uri}-${idx}`}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="p-2 rounded-xl bg-slate-950/70 hover:bg-slate-800 border border-white/10 flex items-start justify-between gap-2 transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-emeraldVip truncate flex items-center gap-1.5">
                              {src.type === 'maps' ? (
                                <MapPin className="w-3.5 h-3.5 shrink-0" />
                              ) : (
                                <Globe className="w-3.5 h-3.5 shrink-0" />
                              )}
                              {src.title}
                            </p>
                            {src.snippet && (
                              <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                                {src.snippet}
                              </p>
                            )}
                          </div>
                          <ExternalLink className="w-3.5 h-3.5 text-slate-400 shrink-0 mt-0.5" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div
                  className={`text-[10px] flex items-center gap-2 ${
                    msg.role === 'user' ? 'text-slate-900/70 justify-end' : 'text-slate-500'
                  }`}
                >
                  <span>{msg.timestamp}</span>
                  {msg.modelUsed && <span>· {msg.modelUsed}</span>}
                </div>
              </div>

              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-xl bg-slate-800 border border-white/10 text-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}

          {sending && (
            <div className="flex items-center gap-2.5 text-xs text-slate-400 px-1">
              <Loader2 className="w-4 h-4 text-emeraldVip animate-spin" />
              <span>Consultando {mode === 'maps' ? 'Google Maps' : mode === 'search' ? 'Pesquisa Google' : 'Gemini AI'}...</span>
            </div>
          )}
        </div>

        {/* Suggestions & Input */}
        <div className="p-4 border-t border-white/10 bg-slate-900/75 space-y-2.5 shrink-0">
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
            {SUGGESTIONS_BY_MODE[mode].map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={sending}
                onClick={() => sendMessage(suggestion)}
                className="px-3 py-1.5 rounded-xl bg-slate-800/90 hover:bg-slate-700 border border-white/10 text-[11px] text-slate-300 whitespace-nowrap shrink-0 transition-colors"
              >
                {suggestion}
              </button>
            ))}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={
                mode === 'maps'
                  ? 'Buscar restaurantes, hotéis ou rotas em SP via Maps...'
                  : mode === 'search'
                    ? 'Perguntar trânsito, voos ou eventos ao vivo...'
                    : mode === 'finance'
                      ? 'Pergunte sobre receitas, gastos ou lucro líquido...'
                      : 'Converse com o Concierge VIP Gustavo Reis...'
              }
              className="flex-1 bg-slate-950/90 border border-white/10 focus:border-emeraldVip/60 rounded-2xl px-4 py-3 text-sm text-white placeholder-slate-500 outline-none"
            />
            <button
              type="submit"
              disabled={sending || !input.trim()}
              aria-label="Enviar mensagem"
              className="w-11 h-11 rounded-2xl bg-emeraldVip text-slate-950 flex items-center justify-center hover:brightness-110 disabled:opacity-40 transition-all shrink-0"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
