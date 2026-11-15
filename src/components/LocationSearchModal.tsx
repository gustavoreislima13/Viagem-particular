import { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Crosshair, Loader2, MapPin, Navigation, Search, X } from 'lucide-react';
import { useGoogleMapsError } from '../lib/googleMaps.ts';
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

interface SearchResultItem {
  place: GeoPlace;
  prediction?: google.maps.places.PlacePrediction;
  source: 'google' | 'fallback';
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
  const placesLib = useMapsLibrary('places');
  const mapsError = useGoogleMapsError();
  const sessionTokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null);

  const [queryText, setQueryText] = useState('');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [resolvingKey, setResolvingKey] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setQueryText('');
      setResults([]);
      setResolvingKey(null);
      sessionTokenRef.current = null;
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || queryText.trim().length < 2) {
      setResults([]);
      return;
    }

    let cancelled = false;
    const trimmed = queryText.trim();

    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        if (placesLib && !mapsError && placesLib.AutocompleteSuggestion) {
          try {
            if (!sessionTokenRef.current && placesLib.AutocompleteSessionToken) {
              sessionTokenRef.current = new placesLib.AutocompleteSessionToken();
            }

            const { suggestions } =
              await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
                input: trimmed,
                sessionToken: sessionTokenRef.current ?? undefined,
                includedRegionCodes: ['br'],
                locationBias: {
                  center: { lat: biasLat, lng: biasLng },
                  radius: 50000,
                },
                language: 'pt-BR',
                region: 'BR',
                internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
              });

            const mapped: SearchResultItem[] = [];
            for (const s of suggestions || []) {
              const pred = s.placePrediction;
              if (!pred) continue;
              mapped.push({
                place: {
                  name: pred.mainText?.text || pred.text?.text || 'Endereço encontrado',
                  address: pred.secondaryText?.text || pred.text?.text || '',
                  lat: biasLat,
                  lng: biasLng,
                  placeId: pred.placeId,
                },
                prediction: pred,
                source: 'google',
              });
            }

            if (!cancelled && mapped.length > 0) {
              setResults(mapped);
              return;
            }
          } catch (placesErr) {
            console.warn('Google Places Autocomplete fallback triggered:', placesErr);
          }
        }

        const res = await api.searchPlaces(trimmed, biasLat, biasLng);
        if (!cancelled) {
          setResults(
            (res.places || []).map((place) => ({
              place,
              source: 'fallback',
            }))
          );
        }
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 320);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [queryText, isOpen, biasLat, biasLng, placesLib, mapsError]);

  const handleSelectItem = async (item: SearchResultItem, idx: number) => {
    const key = `${item.place.placeId || item.place.name}-${idx}`;
    if (!item.prediction) {
      onSelectPlace(item.place);
      onClose();
      return;
    }

    setResolvingKey(key);
    try {
      const gPlace = item.prediction.toPlace();
      await gPlace.fetchFields({
        fields: ['displayName', 'formattedAddress', 'location'],
      });
      sessionTokenRef.current = null;

      const loc = gPlace.location;
      const lat =
        loc && typeof loc.lat === 'function' ? loc.lat() : Number((loc as any)?.lat ?? biasLat);
      const lng =
        loc && typeof loc.lng === 'function' ? loc.lng() : Number((loc as any)?.lng ?? biasLng);

      onSelectPlace({
        name: gPlace.displayName || item.place.name,
        address: gPlace.formattedAddress || item.place.address,
        lat,
        lng,
        placeId: gPlace.id || item.place.placeId,
      });
      onClose();
    } catch (err) {
      console.warn('Place fetchFields fallback triggered:', err);
      // Fallback geocoding if fetchFields fails
      const res = await api.searchPlaces(
        `${item.place.name} ${item.place.address}`.trim(),
        biasLat,
        biasLng
      );
      if (res.places && res.places.length > 0) {
        onSelectPlace(res.places[0]);
        onClose();
      }
    } finally {
      setResolvingKey(null);
    }
  };

  if (!isOpen) return null;

  const activeSourceLabel = results.some((r) => r.source === 'google')
    ? 'Google Places'
    : 'Busca alternativa';

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
                <div className="flex items-center justify-between px-1">
                  <p className="text-[11px] font-semibold text-slate-400">
                    Resultados encontrados
                  </p>
                  <span className="text-[10px] font-medium text-emeraldVip/80">
                    {activeSourceLabel}
                  </span>
                </div>
                {results.map((item, idx) => {
                  const key = `${item.place.placeId || item.place.name}-${idx}`;
                  const isResolving = resolvingKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={Boolean(resolvingKey)}
                      onClick={() => handleSelectItem(item, idx)}
                      className="w-full text-left p-3 rounded-2xl bg-slate-800/60 hover:bg-slate-800 border border-white/5 hover:border-emeraldVip/30 flex items-start gap-3 transition-all disabled:opacity-60"
                    >
                      {isResolving ? (
                        <Loader2 className="w-4 h-4 text-emeraldVip animate-spin shrink-0 mt-0.5" />
                      ) : (
                        <MapPin className="w-4 h-4 text-emeraldVip shrink-0 mt-0.5" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">
                          {item.place.name}
                        </p>
                        <p className="text-xs text-slate-400 truncate">{item.place.address}</p>
                      </div>
                    </button>
                  );
                })}
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
