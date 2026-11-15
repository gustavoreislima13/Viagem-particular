import { auth } from '../lib/firebase.ts';
import {
  AdminClientWallet,
  AiMode,
  AiSpeed,
  AppSettings,
  ChatMessage,
  DashboardSummary,
  Expense,
  GeoPlace,
  PartnerRaffle,
  RecurrenceFrequency,
  Ride,
  RideCategory,
  RidePriceAlert,
  RideStatus,
  RoundTripMode,
  RouteMetrics,
  ScheduleAvailabilityResponse,
  ScheduleBlock,
  SecondaryPaymentMethod,
  UserProfile,
  VipPreferences,
  VipRequest,
  VipTier,
  Voucher,
  WalletTopupRequest,
  WalletTransaction,
  WhatsAppDispatchResult,
} from '../types.ts';
import {
  DEFAULT_DRIVER_WHATSAPP,
  formatRideConfirmationMessage,
} from '../utils/schedule.ts';

export const MIN_KM_RATE = 3.0;
export const VIP_MONTHLY_PRICE = 12.9;
export const OFFICIAL_PIX_KEY = 'cc67fed7-c665-4bb9-aeb5-f7a2dc7ac84e';
export const VIP_CHECKOUT_URL = 'https://mpago.la/2YbggDq';
export const LATE_CANCEL_PENALTY = 15.0;

export function isLateCancelWindow(
  scheduledDate: string,
  scheduledTime: string,
  currentStatus?: RideStatus
): boolean {
  if (currentStatus === 'Em Andamento') return true;
  if (!scheduledDate || !scheduledTime) return false;
  const hhmm = scheduledTime.slice(0, 5);
  const scheduledMs = Date.parse(`${scheduledDate}T${hhmm}:00-03:00`);
  if (!Number.isFinite(scheduledMs)) return false;
  return scheduledMs - Date.now() <= 30 * 60 * 1000;
}

export const CURATED_SP_HUBS: GeoPlace[] = [
  {
    name: 'Av. Paulista, 1578 (MASP)',
    address: 'Bela Vista, São Paulo - SP',
    lat: -23.5614,
    lng: -46.6559,
  },
  {
    name: 'Pinheiros (Estação Faria Lima)',
    address: 'Pinheiros, São Paulo - SP',
    lat: -23.5672,
    lng: -46.6939,
  },
  {
    name: 'Aeroporto de Guarulhos (GRU)',
    address: 'Rod. Hélio Smidt, Guarulhos - SP',
    lat: -23.4356,
    lng: -46.4731,
  },
  {
    name: 'Aeroporto de Congonhas (CGH)',
    address: 'Av. Washington Luís, Vila Congonhas - SP',
    lat: -23.6261,
    lng: -46.6564,
  },
  {
    name: 'Itaim Bibi / Faria Lima 3477',
    address: 'Av. Brig. Faria Lima, Itaim Bibi - SP',
    lat: -23.5869,
    lng: -46.6822,
  },
  {
    name: 'Parque Ibirapuera (Portão 3)',
    address: 'Av. Pedro Álvares Cabral, Moema - SP',
    lat: -23.5874,
    lng: -46.6576,
  },
];

export function formatCurrency(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function getVipTier(points: number): VipTier {
  if (points >= 2500) return 'Black';
  if (points >= 1000) return 'Ouro';
  if (points >= 400) return 'Prata';
  return 'Bronze';
}

export function getTierDiscountPct(points: number): number {
  if (points >= 2500) return 0.15;
  if (points >= 1000) return 0.10;
  if (points >= 400) return 0.05;
  return 0;
}

export function calculateRideQuote(params: {
  distanceKm: number;
  category: RideCategory;
  settings: AppSettings;
  userPoints: number;
  vipActive?: boolean;
  pointsToRedeem?: number;
  voucher?: Voucher | null;
}) {
  const isRoundTrip = params.category === 'roundtrip';
  const rawRate = isRoundTrip ? params.settings.roundTripKm : params.settings.execKm;
  const safeRate = Math.max(MIN_KM_RATE, Number(rawRate) || MIN_KM_RATE);

  const effectiveKm = isRoundTrip ? params.distanceKm * 2 : params.distanceKm;
  const baseTotal = effectiveKm * safeRate;
  const roundTripDiscount = isRoundTrip ? baseTotal * 0.1 : 0;
  const afterTrip = baseTotal - roundTripDiscount;
  const tierDiscount = afterTrip * getTierDiscountPct(params.userPoints);
  const voucherDiscount = params.voucher && !params.voucher.used ? params.voucher.discountValue : 0;

  const minFare = params.settings.minFare || 25;
  const subtotalBeforePoints = Math.max(minFare, afterTrip - tierDiscount - voucherDiscount);

  let pointsRedeemed = 0;
  let pointsDiscount = 0;
  if (params.vipActive && (params.pointsToRedeem || 0) >= 100) {
    const blocks = Math.floor(Math.min(params.pointsToRedeem || 0, params.userPoints) / 100);
    const maxUsefulBlocks = Math.floor(Math.max(0, subtotalBeforePoints - minFare) / 5);
    const appliedBlocks = Math.min(blocks, maxUsefulBlocks);
    if (appliedBlocks > 0) {
      pointsRedeemed = appliedBlocks * 100;
      pointsDiscount = appliedBlocks * 5;
    }
  }

  const finalPrice = Number(Math.max(minFare, subtotalBeforePoints - pointsDiscount).toFixed(2));
  const pointsEarned = params.vipActive
    ? Math.max(30, Math.round(finalPrice * 2))
    : Math.max(20, Math.round(finalPrice));

  return {
    isRoundTrip,
    effectiveKm: Number(effectiveKm.toFixed(1)),
    safeRate,
    baseTotal: Number(baseTotal.toFixed(2)),
    roundTripDiscount: Number(roundTripDiscount.toFixed(2)),
    tierDiscount: Number(tierDiscount.toFixed(2)),
    voucherDiscount: Number(voucherDiscount.toFixed(2)),
    pointsRedeemed,
    pointsDiscount: Number(pointsDiscount.toFixed(2)),
    finalPrice,
    pointsEarned,
  };
}

function computeCalendarBounds(ride: Ride): { startDt: string; endDt: string } {
  if (ride.startTime && ride.endTime) {
    const startMs = Date.parse(String(ride.startTime));
    const endMs = Date.parse(String(ride.endTime));
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      const toLocalToken = (ms: number) => {
        const sp = new Date(ms - 3 * 60 * 60 * 1000);
        const y = sp.getUTCFullYear();
        const m = String(sp.getUTCMonth() + 1).padStart(2, '0');
        const d = String(sp.getUTCDate()).padStart(2, '0');
        const hh = String(sp.getUTCHours()).padStart(2, '0');
        const mm = String(sp.getUTCMinutes()).padStart(2, '0');
        return `${y}${m}${d}T${hh}${mm}00`;
      };
      return { startDt: toLocalToken(startMs), endDt: toLocalToken(endMs) };
    }
  }

  const datePart = ride.scheduledDate.replace(/-/g, '');
  const timeParts = (ride.scheduledTime || '09:00').split(':');
  const hh = String(timeParts[0] || '09').padStart(2, '0');
  const mm = String(timeParts[1] || '00').padStart(2, '0');
  const startDt = `${datePart}T${hh}${mm}00`;

  const endDate = new Date(`${ride.scheduledDate}T${hh}:${mm}:00-03:00`);
  const spanMin = Math.max(15, Number(ride.totalOccupiedMin || ride.durationMin || 40));
  const spEnd = new Date(endDate.getTime() + spanMin * 60 * 1000 - 3 * 60 * 60 * 1000);
  const endY = spEnd.getUTCFullYear();
  const endM = String(spEnd.getUTCMonth() + 1).padStart(2, '0');
  const endD = String(spEnd.getUTCDate()).padStart(2, '0');
  const endHh = String(spEnd.getUTCHours()).padStart(2, '0');
  const endMm = String(spEnd.getUTCMinutes()).padStart(2, '0');
  return { startDt, endDt: `${endY}${endM}${endD}T${endHh}${endMm}00` };
}

export function buildGoogleCalendarUrl(ride: Ride): string {
  const { startDt, endDt } = computeCalendarBounds(ride);
  const title = `Viagem VIP Gustavo Reis (${ride.rideCode})`;
  const details = `Embarque: ${ride.originName}\nDestino: ${ride.destinationName}\nValor: ${formatCurrency(
    ride.price
  )}\nPassageiro: ${ride.clientName}\nObs: ${ride.notes || 'Nenhuma'}`;

  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(
    title
  )}&dates=${startDt}/${endDt}&details=${encodeURIComponent(
    details
  )}&location=${encodeURIComponent(ride.originName)}`;
}

export function downloadRideIcs(ride: Ride): void {
  const { startDt, endDt } = computeCalendarBounds(ride);

  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gustavo Reis Mobilidade VIP//PT-BR',
    'BEGIN:VEVENT',
    `UID:${ride.rideCode}@gustavoreismobilidade`,
    `DTSTART:${startDt}`,
    `DTEND:${endDt}`,
    `SUMMARY:Viagem VIP Gustavo Reis (${ride.rideCode})`,
    `LOCATION:${ride.originName}`,
    `DESCRIPTION:Destino: ${ride.destinationName} | Valor: ${formatCurrency(ride.price)} | Passageiro: ${ride.clientName}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `viagem-${ride.rideCode}.ics`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function buildRideSummaryText(
  ride: Ride,
  settings?: Partial<AppSettings>,
  vipActive?: boolean
): string {
  return formatRideConfirmationMessage(
    ride,
    {
      pixKey: settings?.pixKey || OFFICIAL_PIX_KEY,
      whatsapp: settings?.whatsapp || DEFAULT_DRIVER_WHATSAPP,
    },
    { vipActive }
  );
}

export function buildWhatsappUrl(
  ride: Ride,
  whatsappNumber: string,
  pixKey: string = OFFICIAL_PIX_KEY,
  vipActive?: boolean
): string {
  const digits = String(whatsappNumber || '').replace(/\D/g, '');
  const phone =
    digits.length === 10 || digits.length === 11
      ? `55${digits}`
      : digits.length >= 12
        ? digits
        : DEFAULT_DRIVER_WHATSAPP;
  const msg = buildRideSummaryText(ride, { pixKey, whatsapp: phone }, vipActive);
  return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
}

async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  const currentUser = auth.currentUser;
  if (currentUser) {
    const token = await currentUser.getIdToken();
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function apiRequest<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const resp = await fetch(url, {
    ...options,
    headers: {
      ...headers,
      ...(options.headers || {}),
    },
  });
  const contentType = resp.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    if (!resp.ok) {
      const err: any = new Error(`Erro HTTP ${resp.status}`);
      err.status = resp.status;
      throw err;
    }
    throw new Error('Resposta inesperada do servidor (JSON inválido).');
  }
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err: any = new Error(data?.error || `Erro HTTP ${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  return data as T;
}

export const api = {
  getPublicConfig: () =>
    apiRequest<{ settings: AppSettings; mapsBrowserKey: string; adminEmail: string }>(
      '/api/public/config'
    ),

  syncAuth: (phone?: string) =>
    apiRequest<{ user: UserProfile; vouchers: Voucher[] }>('/api/auth/sync', {
      method: 'POST',
      body: JSON.stringify({ phone }),
    }),

  updateProfile: (payload: {
    name: string;
    phone: string;
    address: string;
    cpf: string;
    vipPreferences?: VipPreferences;
  }) =>
    apiRequest<{ user: UserProfile }>('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  subscribeVip: (vipPreferences?: VipPreferences) =>
    apiRequest<{ user: UserProfile; monthlyPrice: number }>('/api/vip/subscribe', {
      method: 'POST',
      body: JSON.stringify({ vipPreferences }),
    }),

  requestVipActivation: (notes?: string) =>
    apiRequest<{ vipRequest: VipRequest }>('/api/vip/request', {
      method: 'POST',
      body: JSON.stringify({ notes }),
    }),

  updateVipPreferences: (vipPreferences: VipPreferences) =>
    apiRequest<{ user: UserProfile }>('/api/vip/preferences', {
      method: 'PUT',
      body: JSON.stringify({ vipPreferences }),
    }),

  cancelVip: () =>
    apiRequest<{ user: UserProfile }>('/api/vip/cancel', {
      method: 'POST',
      body: JSON.stringify({}),
    }),

  getWallet: () =>
    apiRequest<{
      walletBalance: number;
      pendingPenalty: number;
      pixKey: string;
      topups: WalletTopupRequest[];
      transactions: WalletTransaction[];
    }>('/api/wallet'),

  requestWalletTopup: (amount: number) =>
    apiRequest<{ topup: WalletTopupRequest }>('/api/wallet/topup', {
      method: 'POST',
      body: JSON.stringify({ amount }),
    }),

  getRaffles: () => apiRequest<{ raffles: PartnerRaffle[] }>('/api/raffles'),

  getScheduleAvailability: (params: {
    date: string;
    durationMin: number;
    category: RideCategory;
    roundTripMode?: RoundTripMode;
    waitTimeMin?: number;
    returnDate?: string;
    returnTime?: string;
    selectedTime?: string;
  }) => {
    const qs = new URLSearchParams({
      date: params.date,
      durationMin: String(Math.max(1, Math.round(params.durationMin || 20))),
      category: params.category,
    });
    if (params.roundTripMode) qs.set('roundTripMode', params.roundTripMode);
    if (params.waitTimeMin !== undefined) qs.set('waitTimeMin', String(params.waitTimeMin));
    if (params.returnDate) qs.set('returnDate', params.returnDate);
    if (params.returnTime) qs.set('returnTime', params.returnTime);
    if (params.selectedTime) qs.set('selectedTime', params.selectedTime);
    return apiRequest<ScheduleAvailabilityResponse>(`/api/schedule/availability?${qs.toString()}`);
  },

  getRides: () => apiRequest<{ rides: Ride[] }>('/api/rides'),

  createRide: (payload: {
    clientName: string;
    clientPhone: string;
    originName: string;
    originAddress: string;
    originLat: number;
    originLng: number;
    destinationName: string;
    destinationAddress: string;
    destinationLat: number;
    destinationLng: number;
    distanceKm: number;
    durationMin: number;
    category: RideCategory;
    isRoundTrip: boolean;
    roundTripMode?: RoundTripMode;
    waitTimeMin?: number;
    returnDate?: string;
    returnTime?: string;
    recurrenceFrequency?: RecurrenceFrequency;
    preferences?: string;
    scheduledDate: string;
    scheduledTime: string;
    notes: string;
    voucherCode?: string;
    pointsRedeemed?: number;
    useWalletBalance?: boolean;
    secondaryPaymentMethod?: SecondaryPaymentMethod;
  }) =>
    apiRequest<{
      ride: Ride;
      updatedUser?: UserProfile;
      updatedUserPoints?: number;
      pricingAudit: any;
      whatsappDispatch?: WhatsAppDispatchResult;
    }>('/api/rides', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  dispatchWhatsapp: (rideCode: string) =>
    apiRequest<{ whatsappDispatch: WhatsAppDispatchResult }>('/api/whatsapp/dispatch', {
      method: 'POST',
      body: JSON.stringify({ rideCode }),
    }),

  updateRideStatus: (rideCode: string, status: RideStatus) =>
    apiRequest<{
      ride: Ride;
      updatedUser?: UserProfile;
      updatedUserPoints?: number;
      penaltyCharged?: number;
      penaltyMode?: 'wallet' | 'pending' | null;
      lateCancelPenaltyAmount?: number;
    }>(`/api/rides/${encodeURIComponent(rideCode)}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  getVouchers: () => apiRequest<{ vouchers: Voucher[] }>('/api/vouchers'),

  redeemVoucher: (rewardId: 'desconto_15' | 'desconto_35' | 'upgrade_exec') =>
    apiRequest<{ voucher: Voucher; points: number; tier: VipTier }>('/api/vouchers/redeem', {
      method: 'POST',
      body: JSON.stringify({ rewardId }),
    }),

  getAdminDashboard: (period: 'all' | 'today' | 'month' = 'all') =>
    apiRequest<{
      summary: DashboardSummary;
      rides: Ride[];
      expenses: Expense[];
      scheduleBlocks?: ScheduleBlock[];
      priceAlerts: RidePriceAlert[];
      rideMargins?: Record<string, RidePriceAlert>;
      settings: AppSettings;
    }>(`/api/admin/dashboard?period=${period}`),

  getAdminScheduleBlocks: () =>
    apiRequest<{ scheduleBlocks: ScheduleBlock[] }>('/api/admin/schedule-blocks'),

  createAdminScheduleBlock: (payload: {
    blockDate: string;
    startHhmm: string;
    endHhmm: string;
    reason?: string;
  }) =>
    apiRequest<{ block: ScheduleBlock }>('/api/admin/schedule-blocks', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteAdminScheduleBlock: (id: number) =>
    apiRequest<{ deleted: ScheduleBlock }>(`/api/admin/schedule-blocks/${id}`, {
      method: 'DELETE',
    }),

  getAdminWallets: () =>
    apiRequest<{
      topups: WalletTopupRequest[];
      vipRequests: VipRequest[];
      clients: AdminClientWallet[];
    }>('/api/admin/wallets'),

  reviewWalletTopup: (id: number, approve: boolean, adminNotes?: string) =>
    apiRequest<{ topup: WalletTopupRequest; updatedWalletBalance?: number }>(
      `/api/admin/wallets/topups/${id}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ approve, adminNotes }),
      }
    ),

  adjustClientWallet: (uid: string, deltaAmount: number, reason: string) =>
    apiRequest<{ client: { uid: string; walletBalance: number; pendingPenalty: number } }>(
      '/api/admin/wallets/adjust',
      {
        method: 'POST',
        body: JSON.stringify({ uid, deltaAmount, reason }),
      }
    ),

  settleClientPenalty: (uid: string) =>
    apiRequest<{ client: { uid: string; walletBalance: number; pendingPenalty: number } }>(
      '/api/admin/wallets/settle-penalty',
      {
        method: 'POST',
        body: JSON.stringify({ uid }),
      }
    ),

  reviewVipRequest: (id: number, approve: boolean) =>
    apiRequest<{ vipRequest: VipRequest; user?: any }>(
      `/api/admin/vip-requests/${id}/review`,
      {
        method: 'POST',
        body: JSON.stringify({ approve }),
      }
    ),

  adminToggleUserVip: (uid: string, vipActive: boolean) =>
    apiRequest<{ client: { uid: string; vipActive: boolean; vipSubscribedAt?: string | null } }>(
      `/api/admin/users/${encodeURIComponent(uid)}/vip`,
      {
        method: 'PATCH',
        body: JSON.stringify({ vipActive }),
      }
    ),

  createExpense: (payload: {
    category: string;
    description: string;
    amount: number;
    expenseDate: string;
    odometerKm?: number | null;
  }) =>
    apiRequest<{ expense: Expense }>('/api/admin/expenses', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  deleteExpense: (id: number) =>
    apiRequest<{ deleted: Expense }>(`/api/admin/expenses/${id}`, {
      method: 'DELETE',
    }),

  updateSettings: (payload: AppSettings) =>
    apiRequest<{ settings: AppSettings }>('/api/admin/settings', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  getAdminRaffles: () => apiRequest<{ raffles: PartnerRaffle[] }>('/api/admin/raffles'),

  createAdminRaffle: (payload: {
    partnerName: string;
    partnerLogoUrl: string;
    prizeTitle: string;
    prizeDescription: string;
    drawDate: string;
  }) =>
    apiRequest<{ raffle: PartnerRaffle }>('/api/admin/raffles', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  toggleAdminRaffle: (id: number, active: boolean) =>
    apiRequest<{ raffle: PartnerRaffle }>(`/api/admin/raffles/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ active }),
    }),

  deleteAdminRaffle: (id: number) =>
    apiRequest<{ deleted: PartnerRaffle }>(`/api/admin/raffles/${id}`, {
      method: 'DELETE',
    }),

  computeRoute: async (
    originLat: number,
    originLng: number,
    destinationLat: number,
    destinationLng: number
  ): Promise<RouteMetrics> => {
    const raw = await apiRequest<Partial<RouteMetrics>>('/api/maps/route', {
      method: 'POST',
      body: JSON.stringify({ originLat, originLng, destinationLat, destinationLng }),
    });
    const dist = Number(raw?.distanceKm);
    const dur = Number(raw?.durationMin);
    const durTraffic = Number(raw?.durationInTrafficMin);
    return {
      distanceKm: Number.isFinite(dist) && dist > 0 ? dist : 1.5,
      durationMin: Number.isFinite(dur) && dur > 0 ? dur : 10,
      durationInTrafficMin: Number.isFinite(durTraffic) && durTraffic > 0 ? durTraffic : 10,
      trafficDeltaMin: Number.isFinite(Number(raw?.trafficDeltaMin))
        ? Math.max(0, Number(raw?.trafficDeltaMin))
        : 0,
      coords:
        Array.isArray(raw?.coords) && raw.coords.length >= 2
          ? raw.coords
          : [
              [originLat, originLng],
              [destinationLat, destinationLng],
            ],
      source: raw?.source || 'haversine-estimate',
      encodedPolyline: raw?.encodedPolyline,
    };
  },

  searchPlaces: (queryText: string, lat?: number, lng?: number) =>
    apiRequest<{ places: GeoPlace[]; source?: string }>('/api/maps/places', {
      method: 'POST',
      body: JSON.stringify({ query: queryText, lat, lng }),
    }),

  reverseGeocode: (lat: number, lng: number) =>
    apiRequest<GeoPlace>('/api/maps/geocode', {
      method: 'POST',
      body: JSON.stringify({ lat, lng }),
    }),

  aiChat: (params: {
    message: string;
    history: ChatMessage[];
    mode: AiMode;
    speed: AiSpeed;
  }) =>
    apiRequest<{ text: string; modelUsed: string; sources: any[] }>('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify(params),
    }),

  aiMapsGrounding: (queryText: string, lat?: number, lng?: number) =>
    apiRequest<{ text: string; modelUsed: string; sources: any[] }>('/api/ai/maps-grounding', {
      method: 'POST',
      body: JSON.stringify({ query: queryText, lat, lng }),
    }),

  aiSearchGrounding: (queryText: string) =>
    apiRequest<{ text: string; modelUsed: string; sources: any[] }>('/api/ai/search-grounding', {
      method: 'POST',
      body: JSON.stringify({ query: queryText }),
    }),
};
