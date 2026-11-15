import { useEffect, useState } from 'react';
import { Crosshair, Loader2, MapPin, Navigation, Search, X } from 'lucide-react';
import { CURATED_SP_HUBS, api } from '../services/api.ts';
import { GeoPlace } from '../types.ts';

interface LocationSearchModalProps {
  isOpen: boolean;
  target: 'origin' | 'destination';
  biasLat: number;
  biasLng: number;
  onClose: () => void;
  onSelectPlace: (place: GeoPlace) => void;
  onEnableMapPin: () => void;
}

export function LocationSearchModal({
  isOpen,
  target,
  biasLat,
  biasLng,
  onClose,
  onSelectPlace,
  onEnableMapPin,
}: LocationSearchModalProps) {
  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) {
      setQueryText('');
      setResults([]);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || queryText.trim().length < 2) {
      setResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await api.searchPlaces(queryText.trim(), biasLat, biasLng);
        setResults(res.places || []);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 380);

    return () => clearTimeout(timer);
  }, [queryText, isOpen, biasLat, biasLng]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/75 backdrop-blur-md">
      <div className="glass-panel w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-white/10">
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <div>
            <p className="text-[11px] font-semibold text-emeraldVip uppercase tracking-wider">
              {target === 'origin' ? 'Ponto de Embarque' : 'Destino da Viagem'}
            </p>
            <h3 className="font-display font-bold text-lg text-white">
              Selecionar Endereço ou Hub
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar busca"
            className="w-10 h-10 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={queryText}
              onChange={(e) => setQueryText(e.target.value)}
              placeholder="Digite rua, bairro, aeroporto ou empresa em SP..."
              autoFocus
              className="w-full bg-slate-900/90 border border-white/10 focus:border-emeraldVip/60 rounded-2xl pl-10 pr-10 py-3 text-sm text-white placeholder-slate-500 outline-none transition-colors"
            />
            {loading && (
              <Loader2 className="w-4 h-4 text-emeraldVip animate-spin absolute right-3.5 top-1/2 -translate-y-1/2" />
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              onEnableMapPin();
              onClose();
            }}
            className="w-full py-2.5 px-4 rounded-xl bg-emeraldVip/10 hover:bg-emeraldVip/20 border border-emeraldVip/25 text-emeraldVip text-xs font-semibold flex items-center justify-center gap-2 transition-colors"
          >
            <Crosshair className="w-4 h-4" />
            Marcar ponto exato clicando no mapa
          </button>

          <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
            {results.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[11px] font-semibold text-slate-400 px-1">
                  Resultados encontrados
                </p>
                {results.map((place, idx) => (
                  <button
                    key={`${place.name}-${idx}`}
                    type="button"
                    onClick={() => {
                      onSelectPlace(place);
                      onClose();
                    }}
                    className="w-full text-left p-3 rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-white/5 hover:border-emeraldVip/30 flex items-start gap-3 transition-all"
                  >
                    <MapPin className="w-4 h-4 text-emeraldVip shrink-0 mt-0.5" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-white truncate">{place.name}</p>
                      <p className="text-xs text-slate-400 truncate">{place.address}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}

            <div className="space-y-1.5">
              <p className="text-[11px] font-semibold text-slate-400 px-1">
                Principais Hubs de São Paulo
              </p>
              {CURATED_SP_HUBS.map((hub) => (
                <button
                  key={hub.name}
                  type="button"
                  onClick={() => {
                    onSelectPlace(hub);
                    onClose();
                  }}
                  className="w-full text-left p-3 rounded-2xl bg-slate-900/70 hover:bg-slate-800/80 border border-white/5 hover:border-emeraldVip/30 flex items-center gap-3 transition-all"
                >
                  <div className="w-8 h-8 rounded-xl bg-emeraldVip/10 text-emeraldVip flex items-center justify-center shrink-0">
                    <Navigation className="w-4 h-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-white truncate">{hub.name}</p>
                    <p className="text-xs text-slate-400 truncate">{hub.address}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
