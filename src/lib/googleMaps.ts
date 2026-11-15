import { useEffect, useState } from 'react';

const rawEnvKey = String(import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '').trim();

const isPlaceholderKey =
  !rawEnvKey ||
  rawEnvKey === 'MY_GOOGLE_MAPS_API_KEY' ||
  rawEnvKey.toLowerCase().includes('secret value');

export const GOOGLE_MAPS_API_KEY = isPlaceholderKey ? '' : rawEnvKey;

export const GOOGLE_MAPS_MISSING_KEY_REASON =
  'Chave VITE_GOOGLE_MAPS_API_KEY não configurada';

declare global {
  interface Window {
    gm_authFailure?: () => void;
    __GMP_QUOTA_EXCEEDED?: boolean;
    __GMP_ERROR_MESSAGE?: string | null;
  }
}

export function mapGoogleMapsErrorMessage(raw: unknown): string {
  const msg =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : String(raw || '');

  if (msg.includes('RefererNotAllowedMapError')) {
    return 'RefererNotAllowedMapError: domínio atual não autorizado na chave Google Maps';
  }
  if (msg.includes('InvalidKeyMapError')) {
    return 'InvalidKeyMapError: chave VITE_GOOGLE_MAPS_API_KEY inválida';
  }
  if (msg.includes('ApiNotActivatedMapError')) {
    return 'ApiNotActivatedMapError: Maps JavaScript API não ativada no projeto Google Cloud';
  }
  if (msg.includes('BillingNotEnabledMapError')) {
    return 'BillingNotEnabledMapError: faturamento não habilitado no projeto Google Cloud';
  }
  if (msg.includes('ApiTargetBlockedMapError')) {
    return 'ApiTargetBlockedMapError: API bloqueada nas restrições da chave';
  }
  if (msg.includes('OverQuotaMapError') || msg.includes('QuotaExceededError')) {
    return 'OverQuotaMapError: cota da Google Maps API excedida';
  }
  if (msg.includes('LegacyApiNotActivatedMapError')) {
    return 'LegacyApiNotActivatedMapError: serviço legado bloqueado no projeto';
  }
  if (msg.trim()) {
    return msg.trim().slice(0, 180);
  }
  return 'Erro de autenticação ou bloqueio na chave Google Maps API';
}

export function reportGoogleMapsError(raw: unknown): string {
  const formatted = mapGoogleMapsErrorMessage(raw);
  if (typeof window !== 'undefined') {
    window.__GMP_ERROR_MESSAGE = formatted;
    window.dispatchEvent(new CustomEvent('gmp-map-error', { detail: formatted }));
    if (
      formatted.includes('OverQuotaMapError') ||
      formatted.includes('QuotaExceededError')
    ) {
      window.__GMP_QUOTA_EXCEEDED = true;
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }
  return formatted;
}

export function useGoogleMapsError(): string | null {
  const [mapsError, setMapsError] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    if (window.__GMP_ERROR_MESSAGE) return window.__GMP_ERROR_MESSAGE;
    if (window.__GMP_QUOTA_EXCEEDED) {
      return 'OverQuotaMapError: cota da Google Maps API excedida';
    }
    return null;
  });

  useEffect(() => {
    const onMapError = (ev: Event) => {
      const detail = (ev as CustomEvent<string>).detail;
      setMapsError(
        detail ||
          window.__GMP_ERROR_MESSAGE ||
          'Erro de autenticação ou bloqueio na chave Google Maps API'
      );
    };
    const onQuota = () => {
      setMapsError(
        window.__GMP_ERROR_MESSAGE || 'OverQuotaMapError: cota da Google Maps API excedida'
      );
    };
    window.addEventListener('gmp-map-error', onMapError);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    return () => {
      window.removeEventListener('gmp-map-error', onMapError);
      window.removeEventListener('gmp-quota-exceeded', onQuota);
    };
  }, []);

  return mapsError;
}
