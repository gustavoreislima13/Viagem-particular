import { useEffect, useRef } from 'react';
import {
  APILoadingStatus,
  AdvancedMarker,
  Map as GoogleMap,
  MapMouseEvent,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { AlertCircle, Crosshair, Flag, MapPin, Navigation } from 'lucide-react';
import {
  GOOGLE_MAPS_MISSING_KEY_REASON,
  reportGoogleMapsError,
  useGoogleMapsError,
} from '../lib/googleMaps.ts';
import { GeoPlace, RouteMetrics } from '../types.ts';

interface MapCanvasProps {
  apiKey: string;
  origin: GeoPlace;
  destination: GeoPlace | null;
  route: RouteMetrics | null;
  showTraffic: boolean;
  pinDropMode: 'origin' | 'destination' | null;
  centerTrigger: number;
  onMapClickPin: (lat: number, lng: number) => void;
}

function GoogleMapsStatusWatcher() {
  const status = useApiLoadingStatus();

  useEffect(() => {
    if (status === APILoadingStatus.AUTH_FAILURE) {
      reportGoogleMapsError(
        'Erro de autenticação na chave Google Maps (verifique restrições HTTP referrer e faturamento)'
      );
    } else if (status === APILoadingStatus.FAILED) {
      reportGoogleMapsError(
        'Falha ao carregar o script da Google Maps JavaScript API'
      );
    }
  }, [status]);

  return null;
}

function TrafficLayerOverlay({ enabled }: { enabled: boolean }) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const layerRef = useRef<{ setMap: (m: any) => void } | null>(null);

  useEffect(() => {
    if (!map || !mapsLib) return;

    const TrafficLayerCtor = (mapsLib as any).TrafficLayer;
    if (!TrafficLayerCtor) return;

    if (enabled) {
      if (!layerRef.current) {
        layerRef.current = new TrafficLayerCtor();
      }
      layerRef.current?.setMap(map);
    } else if (layerRef.current) {
      layerRef.current.setMap(null);
    }

    return () => {
      if (layerRef.current) {
        layerRef.current.setMap(null);
      }
    };
  }, [map, mapsLib, enabled]);

  return null;
}

function RoutePolylineAndBounds({
  origin,
  destination,
  route,
  centerTrigger,
}: {
  origin: GeoPlace;
  destination: GeoPlace | null;
  route: RouteMetrics | null;
  centerTrigger: number;
}) {
  const map = useMap();
  const mapsLib = useMapsLibrary('maps');
  const coreLib = useMapsLibrary('core');
  const geometryLib = useMapsLibrary('geometry');
  const polyRef = useRef<{ setMap: (m: any) => void } | null>(null);

  useEffect(() => {
    if (!map || !mapsLib || !coreLib) return;

    if (polyRef.current) {
      polyRef.current.setMap(null);
      polyRef.current = null;
    }

    const PolylineCtor = (mapsLib as any).Polyline;
    const LatLngBoundsCtor = (coreLib as any).LatLngBounds;

    let pathPoints: google.maps.LatLngLiteral[] = [];
    if (route?.coords && route.coords.length >= 2) {
      pathPoints = route.coords.map(([lat, lng]) => ({ lat, lng }));
    } else if (route?.encodedPolyline && geometryLib?.encoding?.decodePath) {
      pathPoints = geometryLib.encoding
        .decodePath(route.encodedPolyline)
        .map((pt: google.maps.LatLng) => ({ lat: pt.lat(), lng: pt.lng() }));
    }

    if (pathPoints.length >= 2 && PolylineCtor) {
      polyRef.current = new PolylineCtor({
        path: pathPoints,
        geodesic: true,
        strokeColor: '#10B981',
        strokeOpacity: 0.94,
        strokeWeight: 5,
      });
      polyRef.current?.setMap(map);

      if (LatLngBoundsCtor) {
        const bounds = new LatLngBoundsCtor();
        for (const pt of pathPoints) {
          bounds.extend(pt);
        }
        bounds.extend({ lat: origin.lat, lng: origin.lng });
        if (destination) bounds.extend({ lat: destination.lat, lng: destination.lng });
        map.fitBounds(bounds, { top: 96, right: 32, bottom: 260, left: 32 });
      }
    } else if (destination && LatLngBoundsCtor) {
      const bounds = new LatLngBoundsCtor();
      bounds.extend({ lat: origin.lat, lng: origin.lng });
      bounds.extend({ lat: destination.lat, lng: destination.lng });
      map.fitBounds(bounds, { top: 96, right: 32, bottom: 260, left: 32 });
    } else {
      map.panTo({ lat: origin.lat, lng: origin.lng });
      map.setZoom(14);
    }

    return () => {
      if (polyRef.current) {
        polyRef.current.setMap(null);
        polyRef.current = null;
      }
    };
  }, [map, mapsLib, coreLib, geometryLib, origin, destination, route, centerTrigger]);

  return null;
}

function TacticalFallbackMap({
  origin,
  destination,
  route,
  pinDropMode,
  showTraffic,
  noticeReason,
  onMapClickPin,
}: {
  origin: GeoPlace;
  destination: GeoPlace | null;
  route: RouteMetrics | null;
  pinDropMode: 'origin' | 'destination' | null;
  showTraffic: boolean;
  noticeReason: string;
  onMapClickPin: (lat: number, lng: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  const handleFallbackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pinDropMode || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const rx = (e.clientX - rect.left) / rect.width;
    const ry = (e.clientY - rect.top) / rect.height;
    // Map viewport box centered on São Paulo (-23.56, -46.65)
    const lng = -46.78 + rx * 0.34;
    const lat = -23.40 - ry * 0.28;
    onMapClickPin(Number(lat.toFixed(6)), Number(lng.toFixed(6)));
  };

  const toPercent = (lat: number, lng: number) => {
    const x = Math.min(88, Math.max(12, ((lng + 46.78) / 0.34) * 100));
    const y = Math.min(72, Math.max(18, ((-23.40 - lat) / 0.28) * 100));
    return { x, y };
  };

  const oPos = toPercent(origin.lat, origin.lng);
  const dPos = destination ? toPercent(destination.lat, destination.lng) : null;

  return (
    <div
      ref={containerRef}
      onClick={handleFallbackClick}
      className={`relative w-full h-full bg-[#090D16] overflow-hidden select-none ${
        pinDropMode ? 'cursor-crosshair' : ''
      }`}
    >
      {/* Subtle dark street grid */}
      <div
        className="absolute inset-0 opacity-25"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(148,163,184,0.14) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.14) 1px, transparent 1px)',
          backgroundSize: '48px 48px',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 42%, rgba(16, 185, 129, 0.14), rgba(9, 13, 22, 0.92) 70%)',
        }}
      />

      {/* Simulated Traffic arteries if showTraffic */}
      {showTraffic && (
        <svg
          className="absolute inset-0 w-full h-full opacity-35 pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path
            d="M 10 38 Q 48 44 88 32"
            stroke="#F59E0B"
            strokeWidth="0.45"
            fill="none"
            strokeDasharray="1.5 1"
          />
          <path d="M 22 18 Q 52 55 78 68" stroke="#10B981" strokeWidth="0.45" fill="none" />
          <path
            d="M 15 62 Q 46 50 85 56"
            stroke="#EF4444"
            strokeWidth="0.35"
            fill="none"
            strokeDasharray="1 1"
          />
        </svg>
      )}

      {/* Route Line SVG */}
      {dPos && (
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          <path
            d={`M ${oPos.x} ${oPos.y} Q ${(oPos.x + dPos.x) / 2} ${Math.min(oPos.y, dPos.y) - 9} ${dPos.x} ${dPos.y}`}
            stroke="#10B981"
            strokeWidth="0.7"
            strokeDasharray="1.4 0.8"
            fill="none"
          />
        </svg>
      )}

      {/* Origin Pin */}
      <div
        className="absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center"
        style={{ left: `${oPos.x}%`, top: `${oPos.y}%` }}
      >
        <div className="px-2.5 py-1 rounded-lg bg-slate-900/95 border border-emeraldVip/50 text-[11px] font-semibold text-white whitespace-nowrap mb-1 shadow-lg">
          {origin.name}
        </div>
        <div className="w-8 h-8 rounded-full bg-emeraldVip text-slate-950 flex items-center justify-center shadow-[0_0_24px_rgba(16,185,129,0.55)] border-2 border-white">
          <Navigation className="w-4 h-4 fill-current" />
        </div>
      </div>

      {/* Destination Pin */}
      {destination && dPos && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2 z-10 flex flex-col items-center"
          style={{ left: `${dPos.x}%`, top: `${dPos.y}%` }}
        >
          <div className="px-2.5 py-1 rounded-lg bg-slate-900/95 border border-goldVip/50 text-[11px] font-semibold text-white whitespace-nowrap mb-1 shadow-lg">
            {destination.name}
          </div>
          <div className="w-8 h-8 rounded-full bg-goldVip text-slate-950 flex items-center justify-center shadow-[0_0_24px_rgba(245,158,11,0.55)] border-2 border-white">
            <Flag className="w-4 h-4 fill-current" />
          </div>
        </div>
      )}

      {/* Discreet status & route summary overlays */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 z-20 flex flex-col items-center gap-1.5 pointer-events-none w-[90vw] max-w-md">
        <div
          role="status"
          className="px-3 py-1.5 rounded-xl bg-slate-900/85 backdrop-blur-md border border-amber-500/30 text-[11px] leading-snug text-amber-200/90 flex items-center gap-1.5 shadow-lg text-center"
        >
          <AlertCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
          <span>Mapa visual indisponível: {noticeReason}</span>
        </div>

        {route && Number.isFinite(Number(route.distanceKm)) && (
          <div className="px-3 py-1 rounded-lg bg-slate-900/85 border border-white/10 text-[11px] text-slate-300 tabular-nums">
            {Number(route.distanceKm).toFixed(1)} km · {Number(route.durationInTrafficMin || 15)} min estimados
          </div>
        )}
      </div>
    </div>
  );
}

export function MapCanvas({
  apiKey,
  origin,
  destination,
  route,
  showTraffic,
  pinDropMode,
  centerTrigger,
  onMapClickPin,
}: MapCanvasProps) {
  const mapsError = useGoogleMapsError();
  const canUseGoogleMaps = Boolean(apiKey) && !mapsError;
  const fallbackReason = mapsError || GOOGLE_MAPS_MISSING_KEY_REASON;

  const handleGoogleMapClick = (event: MapMouseEvent) => {
    if (!pinDropMode || !event.detail?.latLng) return;
    onMapClickPin(event.detail.latLng.lat, event.detail.latLng.lng);
  };

  if (!canUseGoogleMaps) {
    return (
      <div className="absolute inset-0 z-0">
        <TacticalFallbackMap
          origin={origin}
          destination={destination}
          route={route}
          pinDropMode={pinDropMode}
          showTraffic={showTraffic}
          noticeReason={fallbackReason}
          onMapClickPin={onMapClickPin}
        />
        {pinDropMode && (
          <div className="absolute top-36 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-emeraldVip text-slate-950 font-bold text-xs shadow-xl flex items-center gap-2 pointer-events-none">
            <Crosshair className="w-4 h-4" />
            Toque no mapa para definir {pinDropMode === 'origin' ? 'o Embarque' : 'o Destino'}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={`absolute inset-0 z-0 ${pinDropMode ? 'cursor-crosshair' : ''}`}>
      <GoogleMapsStatusWatcher />
      <GoogleMap
        defaultCenter={{ lat: origin.lat, lng: origin.lng }}
        defaultZoom={13}
        mapId="DEMO_MAP_ID"
        colorScheme="DARK"
        disableDefaultUI
        gestureHandling="greedy"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        onClick={handleGoogleMapClick}
        className="w-full h-full"
      >
        <TrafficLayerOverlay enabled={showTraffic} />
        <RoutePolylineAndBounds
          origin={origin}
          destination={destination}
          route={route}
          centerTrigger={centerTrigger}
        />

        <AdvancedMarker position={{ lat: origin.lat, lng: origin.lng }} title={origin.name}>
          <div className="flex flex-col items-center">
            <div className="px-2 py-0.5 rounded-md bg-slate-950/90 border border-emeraldVip/50 text-[10px] font-semibold text-white mb-1 whitespace-nowrap shadow-md">
              Embarque
            </div>
            <div className="w-8 h-8 rounded-full bg-emeraldVip text-slate-950 flex items-center justify-center border-2 border-white shadow-[0_0_20px_rgba(16,185,129,0.7)]">
              <MapPin className="w-4 h-4 fill-current" />
            </div>
          </div>
        </AdvancedMarker>

        {destination && (
          <AdvancedMarker
            position={{ lat: destination.lat, lng: destination.lng }}
            title={destination.name}
          >
            <div className="flex flex-col items-center">
              <div className="px-2 py-0.5 rounded-md bg-slate-950/90 border border-goldVip/50 text-[10px] font-semibold text-white mb-1 whitespace-nowrap shadow-md">
                Destino
              </div>
              <div className="w-8 h-8 rounded-full bg-goldVip text-slate-950 flex items-center justify-center border-2 border-white shadow-[0_0_20px_rgba(245,158,11,0.7)]">
                <Flag className="w-4 h-4 fill-current" />
              </div>
            </div>
          </AdvancedMarker>
        )}
      </GoogleMap>

      {pinDropMode && (
        <div className="absolute top-24 left-1/2 -translate-x-1/2 z-20 px-4 py-2 rounded-xl bg-emeraldVip text-slate-950 font-bold text-xs shadow-xl flex items-center gap-2 pointer-events-none">
          <Crosshair className="w-4 h-4" />
          Toque no mapa para marcar {pinDropMode === 'origin' ? 'o Embarque' : 'o Destino'}
        </div>
      )}
    </div>
  );
}
