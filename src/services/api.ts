import {
  addDoc,
  auth,
  collection,
  db,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from '../lib/firebase.ts';
import {
  AdminClientWallet,
  AiMode,
  AiSpeed,
  AppSettings,
  BusyTimeWindow,
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
  TimeSlotAvailability,
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
  DEFAULT_SAFETY_MARGIN_MIN,
  computeOccupancyWindows,
  formatRideConfirmationMessage,
  formatSpTime,
  intervalsOverlap,
  parseSpDateTime,
} from '../utils/schedule.ts';

export const MIN_KM_RATE = 3.0;
export const VIP_MONTHLY_PRICE = 12.9;
export const OFFICIAL_PIX_KEY = 'cc67fed7-c665-4bb9-aeb5-f7a2dc7ac84e';
export const VIP_CHECKOUT_URL = 'https://mpago.la/2YbggDq';
export const LATE_CANCEL_PENALTY = 15.0;
export const STRICT_ADMIN_EMAIL = 'reisanselmo7@gmail.com';

export const DEFAULT_APP_SETTINGS: AppSettings = {
  standardKm: 3.0,
  execKm: 3.6,
  roundTripKm: 3.0,
  minFare: 25.0,
  estimatedCostPerKm: 1.35,
  minMarginPct: 40,
  maxMarginPct: 80,
  safetyMarginMin: DEFAULT_SAFETY_MARGIN_MIN,
  pixKey: OFFICIAL_PIX_KEY,
  whatsapp: DEFAULT_DRIVER_WHATSAPP,
};

function isStrictAdminUser(): boolean {
  const u = auth.currentUser;
  return Boolean(
    u &&
      u.emailVerified &&
      (u.email || '').trim().toLowerCase() === STRICT_ADMIN_EMAIL
  );
}

function toIso(val: unknown): string {
  if (!val) return new Date().toISOString();
  if (typeof val === 'string') return val;
  if (val instanceof Date) return val.toISOString();
  if (typeof val === 'object' && typeof (val as { toDate?: () => Date }).toDate === 'function') {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function generateCode(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${prefix}-${Date.now().toString(36).toUpperCase()}${rand}`;
}

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

function buildRidePriceAlert(ride: Ride, settings: AppSettings): RidePriceAlert {
  const costPerKm = Math.max(0.3, Number(settings.estimatedCostPerKm ?? 1.35));
  const minMarginPct = Math.max(5, Number(settings.minMarginPct ?? 40));
  const maxMarginPct = Math.max(minMarginPct + 5, Number(settings.maxMarginPct ?? 80));

  const effectiveKm = ride.isRoundTrip
    ? Math.max(0.5, Number(ride.distanceKm || 1) * 2)
    : Math.max(0.5, Number(ride.distanceKm || 1));

  const estimatedCost = Number((effectiveKm * costPerKm).toFixed(2));
  const price = Math.max(1, Number(ride.price || 0));
  const estimatedProfit = Number((price - estimatedCost).toFixed(2));
  const marginPct = Number((((price - estimatedCost) / price) * 100).toFixed(1));
  const suggestedMinPrice = Number((estimatedCost / (1 - minMarginPct / 100)).toFixed(2));

  let alertType: RidePriceAlert['alertType'] = 'OK';
  let message = `Margem saudável de ${marginPct.toFixed(1)}% (faixa ${minMarginPct}%-${maxMarginPct}%).`;

  if (marginPct < minMarginPct) {
    alertType = 'LOW_MARGIN';
    message = `Alerta: margem baixa (${marginPct.toFixed(1)}% < ${minMarginPct}%). Preço sugerido: ${formatCurrency(
      suggestedMinPrice
    )}.`;
  } else if (marginPct > maxMarginPct) {
    alertType = 'HIGH_MARGIN';
    message = `Margem acima do teto configurado (${marginPct.toFixed(1)}% > ${maxMarginPct}%).`;
  }

  return {
    rideCode: ride.rideCode,
    clientName: ride.clientName,
    originName: ride.originName,
    destinationName: ride.destinationName,
    scheduledDate: ride.scheduledDate,
    scheduledTime: ride.scheduledTime,
    price,
    effectiveKm: Number(effectiveKm.toFixed(1)),
    estimatedCost,
    estimatedProfit,
    marginPct,
    targetMinMarginPct: minMarginPct,
    targetMaxMarginPct: maxMarginPct,
    alertType,
    suggestedMinPrice,
    message,
  };
}

function buildUserProfileFromDocs(
  uid: string,
  pubData: Record<string, any> | null,
  privData: Record<string, any> | null
): UserProfile {
  const fbUser = auth.currentUser;
  const email = String(pubData?.email || privData?.email || fbUser?.email || '');
  const points = Number(pubData?.points ?? pubData?.pontos ?? 0);
  const name = String(
    pubData?.name || pubData?.displayName || fbUser?.displayName || email.split('@')[0] || 'Passageiro VIP'
  ).trim();
  const phone = String(pubData?.phone || privData?.phone || fbUser?.phoneNumber || '');
  const address = String(pubData?.address || privData?.address || '');
  const cpf = String(pubData?.cpf || privData?.cpf || '');
  const photoUrl = String(
    pubData?.photoUrl || pubData?.photoURL || privData?.photoURL || fbUser?.photoURL || ''
  );
  const vipActive = Boolean(pubData?.vipActive ?? pubData?.isVip ?? false);
  const profileCompleted = Boolean(
    pubData?.profileCompleted && name.length >= 3 && phone.length >= 8 && address.length >= 6 && cpf.length >= 11
  );

  return {
    uid,
    name,
    email,
    phone,
    address,
    cpf,
    profileCompleted,
    photoUrl,
    points,
    tier: (pubData?.tier as VipTier) || getVipTier(points),
    walletBalance: Number(pubData?.walletBalance ?? 0),
    pendingPenalty: Number(pubData?.pendingPenalty ?? 0),
    vipActive,
    vipSubscribedAt: pubData?.vipSubscribedAt ? toIso(pubData.vipSubscribedAt) : null,
    vipPreferences: pubData?.vipPreferences || privData?.vipPreferences,
    isAdmin: Boolean(
      fbUser &&
        fbUser.uid === uid &&
        fbUser.emailVerified &&
        email.trim().toLowerCase() === STRICT_ADMIN_EMAIL
    ),
  };
}

async function fetchSettingsInternal(): Promise<AppSettings> {
  if (!auth.currentUser) return { ...DEFAULT_APP_SETTINGS };
  try {
    const snap = await getDoc(doc(db, 'settings', 'global'));
    if (!snap.exists()) return { ...DEFAULT_APP_SETTINGS };
    const data = snap.data() as Partial<AppSettings>;
    return {
      ...DEFAULT_APP_SETTINGS,
      ...data,
      standardKm: Math.max(MIN_KM_RATE, Number(data.standardKm ?? DEFAULT_APP_SETTINGS.standardKm)),
      execKm: Math.max(MIN_KM_RATE, Number(data.execKm ?? DEFAULT_APP_SETTINGS.execKm)),
      roundTripKm: Math.max(MIN_KM_RATE, Number(data.roundTripKm ?? DEFAULT_APP_SETTINGS.roundTripKm)),
      minFare: Math.max(15, Number(data.minFare ?? DEFAULT_APP_SETTINGS.minFare)),
      safetyMarginMin: Number(data.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN),
      pixKey: String(data.pixKey || OFFICIAL_PIX_KEY),
      whatsapp: String(data.whatsapp || DEFAULT_DRIVER_WHATSAPP),
    };
  } catch {
    return { ...DEFAULT_APP_SETTINGS };
  }
}

async function fetchActiveBusyWindows(): Promise<BusyTimeWindow[]> {
  if (!auth.currentUser) return [];
  try {
    const q = query(collection(db, 'scheduleSlots'), where('active', '==', true));
    const snap = await getDocs(q);
    const windows: BusyTimeWindow[] = [];

    snap.forEach((docSnap) => {
      const d = docSnap.data();
      const sourceType = d.sourceType === 'manual_block' ? 'manual_block' : 'ride';
      const refCode = String(d.referenceCode || docSnap.id);
      const dateStr = String(d.date || '');
      const reason = String(d.reason || (sourceType === 'manual_block' ? 'Horário bloqueado pelo motorista' : 'Viagem VIP agendada'));

      if (d.startTimeIso && d.endTimeIso) {
        windows.push({
          sourceType,
          referenceCode: refCode,
          startTimeIso: String(d.startTimeIso),
          endTimeIso: String(d.endTimeIso),
          startLabel: formatSpTime(String(d.startTimeIso)),
          endLabel: formatSpTime(String(d.endTimeIso)),
          date: dateStr,
          reason,
        });
      }

      if (d.returnStartTimeIso && d.returnEndTimeIso) {
        windows.push({
          sourceType,
          referenceCode: `${refCode}-RET`,
          startTimeIso: String(d.returnStartTimeIso),
          endTimeIso: String(d.returnEndTimeIso),
          startLabel: formatSpTime(String(d.returnStartTimeIso)),
          endLabel: formatSpTime(String(d.returnEndTimeIso)),
          date: String(d.returnDate || dateStr),
          reason: `${reason} (Retorno)`,
        });
      }
    });

    return windows;
  } catch {
    return [];
  }
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.max(0.8, Number((R * c * 1.28).toFixed(2)));
}

function mapRideDoc(id: string, d: Record<string, any>): Ride {
  return {
    rideCode: String(d.rideCode || id),
    userId: String(d.userId || ''),
    clientName: String(d.clientName || ''),
    clientEmail: d.clientEmail ? String(d.clientEmail) : '',
    clientPhone: d.clientPhone ? String(d.clientPhone) : '',
    originName: String(d.originName || ''),
    originAddress: String(d.originAddress || ''),
    originLat: Number(d.originLat ?? -23.5614),
    originLng: Number(d.originLng ?? -46.6559),
    destinationName: String(d.destinationName || ''),
    destinationAddress: String(d.destinationAddress || ''),
    destinationLat: Number(d.destinationLat ?? -23.5614),
    destinationLng: Number(d.destinationLng ?? -46.6559),
    distanceKm: Number(d.distanceKm ?? 1),
    durationMin: Number(d.durationMin ?? 15),
    category: (d.category as RideCategory) || 'exec',
    isRoundTrip: Boolean(d.isRoundTrip),
    recurrenceFrequency: (d.recurrenceFrequency as RecurrenceFrequency) || 'none',
    preferences: String(d.preferences || ''),
    scheduledDate: String(d.scheduledDate || ''),
    scheduledTime: String(d.scheduledTime || '09:00'),
    totalOccupiedMin: d.totalOccupiedMin ? Number(d.totalOccupiedMin) : undefined,
    safetyMarginMin: d.safetyMarginMin !== undefined ? Number(d.safetyMarginMin) : undefined,
    roundTripMode: d.roundTripMode ? String(d.roundTripMode) : undefined,
    waitTimeMin: d.waitTimeMin !== undefined ? Number(d.waitTimeMin) : undefined,
    returnDate: d.returnDate ? String(d.returnDate) : undefined,
    returnTime: d.returnTime ? String(d.returnTime) : undefined,
    startTime: d.startTime ? String(d.startTime) : null,
    endTime: d.endTime ? String(d.endTime) : null,
    returnStartTime: d.returnStartTime ? String(d.returnStartTime) : null,
    returnEndTime: d.returnEndTime ? String(d.returnEndTime) : null,
    price: Number(d.price ?? 0),
    paymentMethod: d.paymentMethod ? String(d.paymentMethod) : 'Pix',
    paymentStatus: d.paymentStatus ? String(d.paymentStatus) : '',
    walletDeducted: Number(d.walletDeducted ?? 0),
    remainingDue: d.remainingDue !== undefined ? Number(d.remainingDue) : Number(d.price ?? 0),
    penaltyIncluded: Number(d.penaltyIncluded ?? 0),
    pointsEarned: Number(d.pointsEarned ?? 0),
    pointsRedeemed: Number(d.pointsRedeemed ?? 0),
    notes: String(d.notes || ''),
    status: (d.status as RideStatus) || 'Confirmado',
    createdAt: toIso(d.createdAt),
    updatedAt: toIso(d.updatedAt),
  };
}

export const api = {
  getPublicConfig: async () => {
    const settings = await fetchSettingsInternal();
    return {
      settings,
      mapsBrowserKey: '',
      adminEmail: STRICT_ADMIN_EMAIL,
    };
  },

  syncAuth: async (): Promise<{ user: UserProfile; vouchers: Voucher[] }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Usuário não autenticado.');

    const [pubSnap, privSnap, vouchersSnap] = await Promise.all([
      getDoc(doc(db, 'users', fbUser.uid)),
      getDoc(doc(db, 'users', fbUser.uid, 'private', 'info')).catch(() => null),
      getDocs(collection(db, 'users', fbUser.uid, 'vouchers')).catch(() => null),
    ]);

    const pubData = pubSnap.exists() ? (pubSnap.data() as Record<string, any>) : null;
    const privData = privSnap && privSnap.exists() ? (privSnap.data() as Record<string, any>) : null;
    const user = buildUserProfileFromDocs(fbUser.uid, pubData, privData);

    const vouchers: Voucher[] = [];
    vouchersSnap?.forEach((vDoc) => {
      const vd = vDoc.data();
      vouchers.push({
        voucherCode: String(vd.voucherCode || vDoc.id),
        userId: String(vd.userId || fbUser.uid),
        title: String(vd.title || ''),
        discountValue: Number(vd.discountValue || 0),
        pointsCost: Number(vd.pointsCost || 0),
        used: Boolean(vd.used),
        createdAt: toIso(vd.createdAt),
      });
    });

    vouchers.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
    return { user, vouchers };
  },

  updateProfile: async (payload: {
    name: string;
    phone: string;
    address: string;
    cpf: string;
    vipPreferences?: VipPreferences;
  }): Promise<{ user: UserProfile }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Sessão expirada. Faça login novamente.');

    const cleanName = payload.name.trim().slice(0, 120);
    const cleanPhone = payload.phone.trim().slice(0, 40);
    const cleanAddress = payload.address.trim().slice(0, 280);
    const cleanCpf = payload.cpf.trim().slice(0, 20);
    const cleanEmail = (fbUser.email || 'vip@gustavoreis.app').trim().slice(0, 160);
    const cleanPhoto = (fbUser.photoURL || '').slice(0, 500);

    const userRef = doc(db, 'users', fbUser.uid);
    const existingSnap = await getDoc(userRef);

    const baseData: Record<string, any> = {
      uid: fbUser.uid,
      name: cleanName,
      displayName: cleanName,
      email: cleanEmail,
      phone: cleanPhone,
      address: cleanAddress,
      cpf: cleanCpf,
      photoUrl: cleanPhoto,
      photoURL: cleanPhoto,
      profileCompleted: true,
      updatedAt: serverTimestamp(),
    };
    if (payload.vipPreferences) {
      baseData.vipPreferences = payload.vipPreferences;
    }

    if (!existingSnap.exists()) {
      await setDoc(
        userRef,
        {
          ...baseData,
          isVip: false,
          vipActive: false,
          walletBalance: 0,
          pendingPenalty: 0,
          points: 0,
          tier: 'Bronze',
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
    } else {
      const prev = existingSnap.data();
      await setDoc(
        userRef,
        {
          ...baseData,
          isVip: Boolean(prev?.isVip ?? prev?.vipActive ?? false),
          vipActive: Boolean(prev?.vipActive ?? prev?.isVip ?? false),
          walletBalance: Number(prev?.walletBalance ?? 0),
          points: Number(prev?.points ?? prev?.pontos ?? 0),
        },
        { merge: true }
      );
    }

    const updatedSnap = await getDoc(userRef);
    const user = buildUserProfileFromDocs(
      fbUser.uid,
      updatedSnap.exists() ? (updatedSnap.data() as Record<string, any>) : baseData,
      null
    );
    return { user };
  },

  requestVipActivation: async (notes?: string): Promise<{ vipRequest: VipRequest }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Faça login para informar o pagamento VIP.');

    const userSnap = await getDoc(doc(db, 'users', fbUser.uid));
    const uData = userSnap.exists() ? userSnap.data() : {};
    const reqDocRef = await addDoc(collection(db, 'vipRequests'), {
      userId: fbUser.uid,
      userName: String(uData?.name || uData?.displayName || fbUser.displayName || 'Passageiro VIP').slice(0, 120),
      userEmail: String(uData?.email || fbUser.email || '').slice(0, 160),
      userPhone: String(uData?.phone || '').slice(0, 40),
      amount: VIP_MONTHLY_PRICE,
      notes: String(notes || '').slice(0, 300),
      status: 'Pendente',
      createdAt: serverTimestamp(),
    });

    return {
      vipRequest: {
        id: reqDocRef.id,
        userId: fbUser.uid,
        userName: String(uData?.name || fbUser.displayName || 'Passageiro VIP'),
        userEmail: String(uData?.email || fbUser.email || ''),
        userPhone: String(uData?.phone || ''),
        amount: VIP_MONTHLY_PRICE,
        status: 'Pendente',
        notes: String(notes || ''),
        createdAt: new Date().toISOString(),
      },
    };
  },

  updateVipPreferences: async (vipPreferences: VipPreferences): Promise<{ user: UserProfile }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Usuário não autenticado.');
    const userRef = doc(db, 'users', fbUser.uid);
    await updateDoc(userRef, {
      vipPreferences,
      updatedAt: serverTimestamp(),
    });
    const snap = await getDoc(userRef);
    return {
      user: buildUserProfileFromDocs(fbUser.uid, snap.data() as Record<string, any>, null),
    };
  },

  cancelVip: async (): Promise<{ user: UserProfile }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Usuário não autenticado.');
    const userRef = doc(db, 'users', fbUser.uid);
    await updateDoc(userRef, {
      vipActive: false,
      isVip: false,
      updatedAt: serverTimestamp(),
    });
    const snap = await getDoc(userRef);
    return {
      user: buildUserProfileFromDocs(fbUser.uid, snap.data() as Record<string, any>, null),
    };
  },

  getWallet: async (): Promise<{
    walletBalance: number;
    pendingPenalty: number;
    pixKey: string;
    topups: WalletTopupRequest[];
    transactions: WalletTransaction[];
  }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Usuário não autenticado.');

    const [userSnap, topupsSnap, txSnap, settings] = await Promise.all([
      getDoc(doc(db, 'users', fbUser.uid)),
      getDocs(query(collection(db, 'walletTopups'), where('userId', '==', fbUser.uid))),
      getDocs(collection(db, 'users', fbUser.uid, 'walletTransactions')),
      fetchSettingsInternal(),
    ]);

    const uData = userSnap.exists() ? userSnap.data() : {};
    const topups: WalletTopupRequest[] = [];
    topupsSnap.forEach((s) => {
      const d = s.data();
      topups.push({
        id: s.id,
        requestCode: String(d.requestCode || s.id),
        userId: String(d.userId || fbUser.uid),
        userName: String(d.userName || ''),
        userEmail: String(d.userEmail || ''),
        userPhone: String(d.userPhone || ''),
        amount: Number(d.amount || 0),
        pixKey: String(d.pixKey || OFFICIAL_PIX_KEY),
        status: (d.status as WalletTopupRequest['status']) || 'Pendente',
        adminNotes: String(d.adminNotes || ''),
        createdAt: toIso(d.createdAt),
        reviewedAt: d.reviewedAt ? toIso(d.reviewedAt) : null,
      });
    });
    topups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const transactions: WalletTransaction[] = [];
    txSnap.forEach((s) => {
      const d = s.data();
      transactions.push({
        id: s.id,
        userId: String(d.userId || fbUser.uid),
        type: (d.type as WalletTransaction['type']) || 'recarga',
        amount: Number(d.amount || 0),
        balanceAfter: Number(d.balanceAfter || 0),
        description: String(d.description || ''),
        referenceCode: String(d.referenceCode || ''),
        createdAt: toIso(d.createdAt),
      });
    });
    transactions.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    return {
      walletBalance: Number(uData?.walletBalance ?? 0),
      pendingPenalty: Number(uData?.pendingPenalty ?? 0),
      pixKey: settings.pixKey || OFFICIAL_PIX_KEY,
      topups,
      transactions,
    };
  },

  requestWalletTopup: async (amount: number): Promise<{ topup: WalletTopupRequest }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Faça login para solicitar recarga.');

    const cleanAmount = Number(Number(amount).toFixed(2));
    if (!Number.isFinite(cleanAmount) || cleanAmount < 5 || cleanAmount > 10000) {
      throw new Error('Valor de recarga inválido (mínimo R$ 5,00 e máximo R$ 10.000,00).');
    }

    const [userSnap, settings] = await Promise.all([
      getDoc(doc(db, 'users', fbUser.uid)),
      fetchSettingsInternal(),
    ]);
    const uData = userSnap.exists() ? userSnap.data() : {};
    const requestCode = generateCode('PIX');
    const effectivePix = (settings.pixKey || OFFICIAL_PIX_KEY).slice(0, 120);
    const userName = String(uData?.name || uData?.displayName || fbUser.displayName || 'Passageiro VIP').slice(0, 120);
    const userEmail = String(uData?.email || fbUser.email || '').slice(0, 160);
    const userPhone = String(uData?.phone || '').slice(0, 40);

    await setDoc(doc(db, 'walletTopups', requestCode), {
      requestCode,
      userId: fbUser.uid,
      userName,
      userEmail,
      userPhone,
      amount: cleanAmount,
      pixKey: effectivePix,
      status: 'Pendente',
      createdAt: serverTimestamp(),
    });

    return {
      topup: {
        id: requestCode,
        requestCode,
        userId: fbUser.uid,
        userName,
        userEmail,
        userPhone,
        amount: cleanAmount,
        pixKey: effectivePix,
        status: 'Pendente',
        adminNotes: '',
        createdAt: new Date().toISOString(),
      },
    };
  },

  getRaffles: async (): Promise<{ raffles: PartnerRaffle[] }> => {
    if (!auth.currentUser) return { raffles: [] };
    const snap = await getDocs(
      query(collection(db, 'partnerRaffles'), where('active', '==', true))
    );
    const raffles: PartnerRaffle[] = [];
    snap.forEach((s) => {
      const d = s.data();
      raffles.push({
        id: s.id,
        partnerName: String(d.partnerName || ''),
        partnerLogoUrl: String(d.partnerLogoUrl || ''),
        prizeTitle: String(d.prizeTitle || ''),
        prizeDescription: String(d.prizeDescription || ''),
        drawDate: String(d.drawDate || ''),
        active: Boolean(d.active),
        createdAt: toIso(d.createdAt),
      });
    });
    raffles.sort((a, b) => a.drawDate.localeCompare(b.drawDate));
    return { raffles };
  },

  getScheduleAvailability: async (params: {
    date: string;
    durationMin: number;
    category: RideCategory;
    roundTripMode?: RoundTripMode;
    waitTimeMin?: number;
    returnDate?: string;
    returnTime?: string;
    selectedTime?: string;
  }): Promise<ScheduleAvailabilityResponse> => {
    const [settings, busyWindows] = await Promise.all([
      fetchSettingsInternal(),
      fetchActiveBusyWindows(),
    ]);

    const safetyMarginMin = Number(settings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN);
    const isRoundTrip = params.category === 'roundtrip';
    const slots: TimeSlotAvailability[] = [];

    for (let hour = 6; hour <= 23; hour++) {
      for (const minute of [0, 30]) {
        if (hour === 23 && minute > 0) continue;
        const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        const candidate = computeOccupancyWindows({
          scheduledDate: params.date,
          scheduledTime: hhmm,
          durationMin: params.durationMin,
          isRoundTrip,
          safetyMarginMin,
          roundTripMode: params.roundTripMode,
          waitTimeMin: params.waitTimeMin,
        });
        const candStartMs = candidate.outboundStart.getTime();
        const candEndMs = candidate.outboundEnd.getTime();

        const conflict = busyWindows.find((bw) => {
          const bStart = Date.parse(bw.startTimeIso);
          const bEnd = Date.parse(bw.endTimeIso);
          return Number.isFinite(bStart) && Number.isFinite(bEnd) && intervalsOverlap(candStartMs, candEndMs, bStart, bEnd);
        });

        slots.push({
          time: hhmm,
          occupied: Boolean(conflict),
          conflictWindowLabel: conflict ? `${conflict.startLabel} às ${conflict.endLabel}` : undefined,
          windowStartLabel: formatSpTime(candidate.outboundStart),
          windowEndLabel: formatSpTime(candidate.outboundEnd),
        });
      }
    }

    const selectedOcc = computeOccupancyWindows({
      scheduledDate: params.date,
      scheduledTime: params.selectedTime || '09:00',
      durationMin: params.durationMin,
      isRoundTrip,
      safetyMarginMin,
      roundTripMode: params.roundTripMode,
      waitTimeMin: params.waitTimeMin,
      returnDate: params.returnDate,
      returnTime: params.returnTime,
    });

    const selectedConflict =
      busyWindows.find((bw) =>
        intervalsOverlap(
          selectedOcc.outboundStart.getTime(),
          selectedOcc.outboundEnd.getTime(),
          Date.parse(bw.startTimeIso),
          Date.parse(bw.endTimeIso)
        )
      ) || null;

    const returnConflict =
      selectedOcc.returnStart && selectedOcc.returnEnd
        ? busyWindows.find((bw) =>
            intervalsOverlap(
              selectedOcc.returnStart!.getTime(),
              selectedOcc.returnEnd!.getTime(),
              Date.parse(bw.startTimeIso),
              Date.parse(bw.endTimeIso)
            )
          ) || null
        : null;

    return {
      date: params.date,
      safetyMarginMin,
      outboundOccupiedMin: selectedOcc.outboundMinutes,
      returnOccupiedMin: selectedOcc.returnMinutes,
      busyWindows: busyWindows.filter(
        (bw) => bw.date === params.date || (params.returnDate && bw.date === params.returnDate)
      ),
      slots,
      selectedConflict,
      returnConflict,
    };
  },

  getRides: async (): Promise<{ rides: Ride[] }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) return { rides: [] };

    const ridesQuery = isStrictAdminUser()
      ? collection(db, 'rides')
      : query(collection(db, 'rides'), where('userId', '==', fbUser.uid));

    const snap = await getDocs(ridesQuery);
    const rides: Ride[] = [];
    snap.forEach((s) => rides.push(mapRideDoc(s.id, s.data())));
    rides.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
    return { rides };
  },

  createRide: async (payload: {
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
  }): Promise<{
    ride: Ride;
    updatedUser?: UserProfile;
    updatedUserPoints?: number;
    pricingAudit: any;
    whatsappDispatch?: WhatsAppDispatchResult;
  }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Faça login para confirmar a viagem.');

    const [settings, userSnap, busyWindows, voucherSnap] = await Promise.all([
      fetchSettingsInternal(),
      getDoc(doc(db, 'users', fbUser.uid)),
      fetchActiveBusyWindows(),
      payload.voucherCode
        ? getDoc(doc(db, 'users', fbUser.uid, 'vouchers', payload.voucherCode))
        : Promise.resolve(null),
    ]);

    if (!userSnap.exists()) {
      throw new Error('Complete seu cadastro obrigatório antes de confirmar a viagem.');
    }

    const uData = userSnap.data() as Record<string, any>;
    const currentUser = buildUserProfileFromDocs(fbUser.uid, uData, null);

    // Double-check schedule conflict right before committing
    const occupancy = computeOccupancyWindows({
      scheduledDate: payload.scheduledDate,
      scheduledTime: payload.scheduledTime,
      durationMin: payload.durationMin,
      isRoundTrip: payload.isRoundTrip,
      safetyMarginMin: settings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN,
      roundTripMode: payload.roundTripMode,
      waitTimeMin: payload.waitTimeMin,
      returnDate: payload.returnDate,
      returnTime: payload.returnTime,
    });

    const outConflict = busyWindows.find((bw) =>
      intervalsOverlap(
        occupancy.outboundStart.getTime(),
        occupancy.outboundEnd.getTime(),
        Date.parse(bw.startTimeIso),
        Date.parse(bw.endTimeIso)
      )
    );
    if (outConflict) {
      const conflictErr: any = new Error(
        `Horário indisponível: conflito com ${outConflict.startLabel} às ${outConflict.endLabel}. Escolha outro horário.`
      );
      conflictErr.status = 409;
      throw conflictErr;
    }

    if (occupancy.returnStart && occupancy.returnEnd) {
      const retConflict = busyWindows.find((bw) =>
        intervalsOverlap(
          occupancy.returnStart!.getTime(),
          occupancy.returnEnd!.getTime(),
          Date.parse(bw.startTimeIso),
          Date.parse(bw.endTimeIso)
        )
      );
      if (retConflict) {
        const conflictErr: any = new Error(
          `Horário de retorno indisponível: conflito com ${retConflict.startLabel} às ${retConflict.endLabel}.`
        );
        conflictErr.status = 409;
        throw conflictErr;
      }
    }

    let voucher: Voucher | null = null;
    if (voucherSnap && voucherSnap.exists()) {
      const vd = voucherSnap.data();
      if (!vd.used) {
        voucher = {
          voucherCode: String(vd.voucherCode || voucherSnap.id),
          userId: fbUser.uid,
          title: String(vd.title || ''),
          discountValue: Number(vd.discountValue || 0),
          pointsCost: Number(vd.pointsCost || 0),
          used: false,
        };
      }
    }

    const quote = calculateRideQuote({
      distanceKm: payload.distanceKm,
      category: payload.category,
      settings,
      userPoints: currentUser.points,
      vipActive: currentUser.vipActive,
      pointsToRedeem: currentUser.vipActive ? payload.pointsRedeemed : 0,
      voucher,
    });

    const penaltyIncluded = Number(currentUser.pendingPenalty || 0);
    const totalPrice = Number((quote.finalPrice + penaltyIncluded).toFixed(2));
    const useWallet = payload.useWalletBalance !== false;
    const walletBalance = Number(currentUser.walletBalance || 0);
    const walletDeducted =
      useWallet && walletBalance > 0 ? Number(Math.min(walletBalance, totalPrice).toFixed(2)) : 0;
    const remainingDue = Number(Math.max(0, totalPrice - walletDeducted).toFixed(2));
    const secondaryMethod: SecondaryPaymentMethod =
      payload.secondaryPaymentMethod === 'Cartão Presencial' ? 'Cartão Presencial' : 'Pix';

    let paymentMethod = secondaryMethod as string;
    let paymentStatus =
      secondaryMethod === 'Cartão Presencial'
        ? 'Pagamento presencial na maquininha'
        : 'Aguardando pagamento via Pix';

    if (walletDeducted > 0 && remainingDue <= 0) {
      paymentMethod = 'Carteira';
      paymentStatus = 'Pago integralmente via Carteira Digital';
    } else if (walletDeducted > 0 && remainingDue > 0) {
      paymentMethod = `Carteira + ${secondaryMethod}`;
      paymentStatus = `R$ ${walletDeducted.toFixed(2)} debitado da Carteira + saldo via ${secondaryMethod}`;
    }

    const rideCode = generateCode('GR');
    const nextWalletBalance = Number(Math.max(0, walletBalance - walletDeducted).toFixed(2));
    const nextPoints = Math.max(0, currentUser.points - quote.pointsRedeemed);
    const startIso = occupancy.outboundStart.toISOString();
    const endIso = occupancy.outboundEnd.toISOString();
    const retStartIso = occupancy.returnStart ? occupancy.returnStart.toISOString() : '';
    const retEndIso = occupancy.returnEnd ? occupancy.returnEnd.toISOString() : '';

    const batch = writeBatch(db);

    const rideDocData = {
      rideCode,
      userId: fbUser.uid,
      clientName: payload.clientName.trim().slice(0, 120),
      clientEmail: currentUser.email.slice(0, 160),
      clientPhone: (payload.clientPhone || currentUser.phone || '').slice(0, 40),
      originName: payload.originName.slice(0, 180),
      originAddress: (payload.originAddress || '').slice(0, 280),
      originLat: Number(payload.originLat),
      originLng: Number(payload.originLng),
      destinationName: payload.destinationName.slice(0, 180),
      destinationAddress: (payload.destinationAddress || '').slice(0, 280),
      destinationLat: Number(payload.destinationLat),
      destinationLng: Number(payload.destinationLng),
      distanceKm: Number(payload.distanceKm),
      durationMin: Math.max(1, Math.round(payload.durationMin)),
      totalOccupiedMin: occupancy.totalOccupiedMin,
      safetyMarginMin: occupancy.safetyMarginMin,
      roundTripMode: occupancy.roundTripMode,
      waitTimeMin: occupancy.waitTimeMin,
      returnDate: String(payload.returnDate || ''),
      returnTime: String(payload.returnTime || ''),
      startTime: startIso,
      endTime: endIso,
      returnStartTime: retStartIso,
      returnEndTime: retEndIso,
      category: payload.category,
      isRoundTrip: payload.isRoundTrip,
      recurrenceFrequency: currentUser.vipActive ? payload.recurrenceFrequency || 'none' : 'none',
      preferences: currentUser.vipActive ? (payload.preferences || '').slice(0, 300) : '',
      scheduledDate: payload.scheduledDate,
      scheduledTime: payload.scheduledTime,
      price: totalPrice,
      paymentMethod: paymentMethod.slice(0, 60),
      paymentStatus: paymentStatus.slice(0, 80),
      walletDeducted,
      remainingDue,
      penaltyIncluded,
      pointsEarned: quote.pointsEarned,
      pointsRedeemed: quote.pointsRedeemed,
      notes: (payload.notes || '').slice(0, 400),
      status: 'Confirmado' as RideStatus,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    batch.set(doc(db, 'rides', rideCode), rideDocData);

    batch.set(doc(db, 'scheduleSlots', rideCode), {
      slotId: rideCode,
      userId: fbUser.uid,
      sourceType: 'ride',
      referenceCode: rideCode,
      date: payload.scheduledDate,
      returnDate: String(payload.returnDate || ''),
      startTimeIso: startIso,
      endTimeIso: endIso,
      returnStartTimeIso: retStartIso,
      returnEndTimeIso: retEndIso,
      reason: 'Viagem VIP agendada',
      active: true,
      updatedAt: serverTimestamp(),
    });

    if (walletDeducted > 0 || penaltyIncluded > 0 || quote.pointsRedeemed > 0) {
      batch.update(doc(db, 'users', fbUser.uid), {
        walletBalance: nextWalletBalance,
        pendingPenalty: 0,
        points: nextPoints,
        pontos: nextPoints,
        updatedAt: serverTimestamp(),
      });
    }

    if (walletDeducted > 0) {
      const txRef = doc(collection(db, 'users', fbUser.uid, 'walletTransactions'));
      batch.set(txRef, {
        userId: fbUser.uid,
        type: 'corrida',
        amount: -walletDeducted,
        balanceAfter: nextWalletBalance,
        description: `Pagamento corrida ${rideCode}`.slice(0, 240),
        referenceCode: rideCode,
        createdAt: serverTimestamp(),
      });
    }

    if (voucher) {
      batch.update(doc(db, 'users', fbUser.uid, 'vouchers', voucher.voucherCode), {
        used: true,
      });
    }

    await batch.commit();

    const createdRide: Ride = {
      ...rideDocData,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const updatedUser: UserProfile = {
      ...currentUser,
      walletBalance: nextWalletBalance,
      pendingPenalty: 0,
      points: nextPoints,
    };

    const msgPreview = buildRideSummaryText(createdRide, settings, currentUser.vipActive);
    const whatsappUrl = buildWhatsappUrl(
      createdRide,
      settings.whatsapp,
      settings.pixKey,
      currentUser.vipActive
    );

    return {
      ride: createdRide,
      updatedUser,
      updatedUserPoints: nextPoints,
      pricingAudit: quote,
      whatsappDispatch: {
        dispatched: false,
        mode: 'whatsapp-deep-link',
        recipients: [settings.whatsapp || DEFAULT_DRIVER_WHATSAPP],
        messagePreview: msgPreview,
        whatsappUrl,
        statusDetail: 'Resumo pronto para envio direto via WhatsApp.',
      },
    };
  },

  dispatchWhatsapp: async (rideCode: string): Promise<{ whatsappDispatch: WhatsAppDispatchResult }> => {
    const [rideSnap, settings] = await Promise.all([
      getDoc(doc(db, 'rides', rideCode)),
      fetchSettingsInternal(),
    ]);
    if (!rideSnap.exists()) throw new Error('Corrida não encontrada.');
    const ride = mapRideDoc(rideSnap.id, rideSnap.data());
    const msgPreview = buildRideSummaryText(ride, settings, false);
    const whatsappUrl = buildWhatsappUrl(ride, settings.whatsapp, settings.pixKey, false);
    return {
      whatsappDispatch: {
        dispatched: false,
        mode: 'whatsapp-deep-link',
        recipients: [settings.whatsapp || DEFAULT_DRIVER_WHATSAPP],
        messagePreview: msgPreview,
        whatsappUrl,
        statusDetail: 'Link WhatsApp preparado com os detalhes da viagem.',
      },
    };
  },

  updateRideStatus: async (
    rideCode: string,
    status: RideStatus
  ): Promise<{
    ride: Ride;
    updatedUser?: UserProfile;
    updatedUserPoints?: number;
    penaltyCharged?: number;
    penaltyMode?: 'wallet' | 'pending' | null;
    lateCancelPenaltyAmount?: number;
  }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Usuário não autenticado.');

    const rideRef = doc(db, 'rides', rideCode);
    const rideSnap = await getDoc(rideRef);
    if (!rideSnap.exists()) throw new Error('Corrida não encontrada.');

    const existingRide = mapRideDoc(rideSnap.id, rideSnap.data());
    const admin = isStrictAdminUser();
    if (!admin && existingRide.userId !== fbUser.uid) {
      throw new Error('Sem permissão para alterar esta corrida.');
    }

    const batch = writeBatch(db);
    batch.update(rideRef, {
      status,
      updatedAt: serverTimestamp(),
    });

    if (status === 'Cancelado' || status === 'Concluído') {
      const slotRef = doc(db, 'scheduleSlots', rideCode);
      const slotSnap = await getDoc(slotRef);
      if (slotSnap.exists()) {
        batch.update(slotRef, {
          active: false,
          updatedAt: serverTimestamp(),
        });
      }
    }

    let penaltyCharged = 0;
    let penaltyMode: 'wallet' | 'pending' | null = null;
    let updatedUser: UserProfile | undefined;

    const ownerRef = doc(db, 'users', existingRide.userId);
    const ownerSnap = await getDoc(ownerRef);
    const ownerProfile = ownerSnap.exists()
      ? buildUserProfileFromDocs(existingRide.userId, ownerSnap.data() as Record<string, any>, null)
      : null;

    if (
      status === 'Cancelado' &&
      existingRide.status !== 'Cancelado' &&
      existingRide.status !== 'Concluído' &&
      !admin &&
      isLateCancelWindow(existingRide.scheduledDate, existingRide.scheduledTime, existingRide.status) &&
      ownerProfile
    ) {
      penaltyCharged = LATE_CANCEL_PENALTY;
      if (ownerProfile.walletBalance >= LATE_CANCEL_PENALTY) {
        const nextWallet = Number((ownerProfile.walletBalance - LATE_CANCEL_PENALTY).toFixed(2));
        penaltyMode = 'wallet';
        batch.update(ownerRef, {
          walletBalance: nextWallet,
          updatedAt: serverTimestamp(),
        });
        const txRef = doc(collection(db, 'users', existingRide.userId, 'walletTransactions'));
        batch.set(txRef, {
          userId: existingRide.userId,
          type: 'multa',
          amount: -LATE_CANCEL_PENALTY,
          balanceAfter: nextWallet,
          description: `Multa cancelamento < 30 min (${rideCode})`,
          referenceCode: rideCode,
          createdAt: serverTimestamp(),
        });
        updatedUser = { ...ownerProfile, walletBalance: nextWallet };
      } else {
        const nextPenalty = Number((ownerProfile.pendingPenalty + LATE_CANCEL_PENALTY).toFixed(2));
        penaltyMode = 'pending';
        batch.update(ownerRef, {
          pendingPenalty: nextPenalty,
          updatedAt: serverTimestamp(),
        });
        updatedUser = { ...ownerProfile, pendingPenalty: nextPenalty };
      }
    }

    // Admin awards loyalty points upon ride completion
    if (
      admin &&
      status === 'Concluído' &&
      existingRide.status !== 'Concluído' &&
      ownerProfile &&
      existingRide.pointsEarned > 0
    ) {
      const nextPoints = ownerProfile.points + existingRide.pointsEarned;
      const nextTier = getVipTier(nextPoints);
      batch.update(ownerRef, {
        points: nextPoints,
        pontos: nextPoints,
        tier: nextTier,
        updatedAt: serverTimestamp(),
      });
      updatedUser = { ...ownerProfile, points: nextPoints, tier: nextTier };
    }

    await batch.commit();

    return {
      ride: { ...existingRide, status, updatedAt: new Date().toISOString() },
      updatedUser,
      updatedUserPoints: updatedUser?.points,
      penaltyCharged,
      penaltyMode,
      lateCancelPenaltyAmount: LATE_CANCEL_PENALTY,
    };
  },

  getVouchers: async (): Promise<{ vouchers: Voucher[] }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) return { vouchers: [] };
    const snap = await getDocs(collection(db, 'users', fbUser.uid, 'vouchers'));
    const vouchers: Voucher[] = [];
    snap.forEach((s) => {
      const d = s.data();
      vouchers.push({
        voucherCode: String(d.voucherCode || s.id),
        userId: String(d.userId || fbUser.uid),
        title: String(d.title || ''),
        discountValue: Number(d.discountValue || 0),
        pointsCost: Number(d.pointsCost || 0),
        used: Boolean(d.used),
        createdAt: toIso(d.createdAt),
      });
    });
    vouchers.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));
    return { vouchers };
  },

  redeemVoucher: async (
    rewardId: 'desconto_15' | 'desconto_35' | 'upgrade_exec'
  ): Promise<{ voucher: Voucher; points: number; tier: VipTier }> => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Faça login para resgatar vouchers.');

    const catalog = {
      desconto_15: { title: 'Desconto Prata R$ 15', discountValue: 15, cost: 300 },
      desconto_35: { title: 'Voucher Executivo R$ 35', discountValue: 35, cost: 700 },
      upgrade_exec: { title: 'Cortesia Black R$ 60', discountValue: 60, cost: 1200 },
    }[rewardId];

    const voucherCode = generateCode('VIP');
    const userRef = doc(db, 'users', fbUser.uid);
    const voucherRef = doc(db, 'users', fbUser.uid, 'vouchers', voucherCode);

    const resultPoints = await runTransaction(db, async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists()) {
        throw new Error('Complete seu cadastro antes de resgatar pontos.');
      }
      const currentPoints = Number(userSnap.data().points ?? 0);
      if (currentPoints < catalog.cost) {
        throw new Error(`Pontos insuficientes (${currentPoints}/${catalog.cost} pts).`);
      }
      const nextPoints = currentPoints - catalog.cost;
      tx.update(userRef, {
        points: nextPoints,
        pontos: nextPoints,
        updatedAt: serverTimestamp(),
      });
      tx.set(voucherRef, {
        voucherCode,
        userId: fbUser.uid,
        title: catalog.title,
        discountValue: catalog.discountValue,
        pointsCost: catalog.cost,
        used: false,
        createdAt: serverTimestamp(),
      });
      return nextPoints;
    });

    return {
      voucher: {
        voucherCode,
        userId: fbUser.uid,
        title: catalog.title,
        discountValue: catalog.discountValue,
        pointsCost: catalog.cost,
        used: false,
        createdAt: new Date().toISOString(),
      },
      points: resultPoints,
      tier: getVipTier(resultPoints),
    };
  },

  getAdminDashboard: async (period: 'all' | 'today' | 'month' = 'all') => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');

    const [ridesSnap, expensesSnap, slotsSnap, settings] = await Promise.all([
      getDocs(collection(db, 'rides')),
      getDocs(collection(db, 'expenses')),
      getDocs(query(collection(db, 'scheduleSlots'), where('sourceType', '==', 'manual_block'))),
      fetchSettingsInternal(),
    ]);

    const todayStr = new Date().toISOString().split('T')[0];
    const monthPrefix = todayStr.slice(0, 7);
    const matchesPeriod = (dateStr: string) => {
      if (period === 'today') return dateStr === todayStr;
      if (period === 'month') return dateStr.startsWith(monthPrefix);
      return true;
    };

    const allRides: Ride[] = [];
    ridesSnap.forEach((s) => allRides.push(mapRideDoc(s.id, s.data())));
    allRides.sort((a, b) => Date.parse(b.createdAt || '') - Date.parse(a.createdAt || ''));

    const filteredRides = allRides.filter((r) => matchesPeriod(r.scheduledDate));

    const allExpenses: Expense[] = [];
    expensesSnap.forEach((s) => {
      const d = s.data();
      allExpenses.push({
        id: s.id,
        adminUid: String(d.adminUid || ''),
        category: String(d.category || 'Outros'),
        description: String(d.description || ''),
        amount: Number(d.amount || 0),
        expenseDate: String(d.expenseDate || ''),
        odometerKm: d.odometerKm !== undefined && d.odometerKm !== null ? Number(d.odometerKm) : null,
        createdAt: toIso(d.createdAt),
      });
    });
    allExpenses.sort((a, b) => b.expenseDate.localeCompare(a.expenseDate));
    const filteredExpenses = allExpenses.filter((e) => matchesPeriod(e.expenseDate));

    const scheduleBlocks: ScheduleBlock[] = [];
    slotsSnap.forEach((s) => {
      const d = s.data();
      if (d.active === false) return;
      scheduleBlocks.push({
        id: s.id,
        adminUid: String(d.userId || ''),
        blockDate: String(d.date || ''),
        startTimeStr: String(d.startTimeStr || formatSpTime(String(d.startTimeIso || ''))),
        endTimeStr: String(d.endTimeStr || formatSpTime(String(d.endTimeIso || ''))),
        startTime: String(d.startTimeIso || ''),
        endTime: String(d.endTimeIso || ''),
        reason: String(d.reason || 'Bloqueio manual do motorista'),
        createdAt: toIso(d.updatedAt),
      });
    });
    scheduleBlocks.sort((a, b) => Date.parse(a.startTime) - Date.parse(b.startTime));

    let completedEarnings = 0;
    let scheduledRevenue = 0;
    let totalDistanceKm = 0;
    let completedRidesCount = 0;
    let activeOrScheduledCount = 0;
    let canceledRidesCount = 0;

    const rideMargins: Record<string, RidePriceAlert> = {};
    const priceAlerts: RidePriceAlert[] = [];

    for (const r of filteredRides) {
      const alert = buildRidePriceAlert(r, settings);
      rideMargins[r.rideCode] = alert;
      if (r.status !== 'Cancelado' && alert.alertType !== 'OK') {
        priceAlerts.push(alert);
      }

      if (r.status === 'Concluído') {
        completedEarnings += r.price;
        totalDistanceKm += r.isRoundTrip ? r.distanceKm * 2 : r.distanceKm;
        completedRidesCount++;
      } else if (r.status === 'Confirmado' || r.status === 'Em Andamento') {
        scheduledRevenue += r.price;
        activeOrScheduledCount++;
      } else if (r.status === 'Cancelado') {
        canceledRidesCount++;
      }
    }

    const expensesByCategory: Record<string, number> = {};
    let totalExpenses = 0;
    for (const exp of filteredExpenses) {
      totalExpenses += exp.amount;
      expensesByCategory[exp.category] = Number(
        ((expensesByCategory[exp.category] || 0) + exp.amount).toFixed(2)
      );
    }

    const netProfit = Number((completedEarnings - totalExpenses).toFixed(2));
    const profitMarginPct =
      completedEarnings > 0 ? Number(((netProfit / completedEarnings) * 100).toFixed(1)) : 0;
    const avgTicket =
      completedRidesCount > 0 ? Number((completedEarnings / completedRidesCount).toFixed(2)) : 0;
    const effectiveCostPerKm =
      totalDistanceKm > 0 && totalExpenses > 0
        ? Number((totalExpenses / totalDistanceKm).toFixed(2))
        : Number(settings.estimatedCostPerKm ?? 1.35);

    const summary: DashboardSummary = {
      totalRides: filteredRides.length,
      completedRidesCount,
      activeOrScheduledCount,
      canceledRidesCount,
      completedEarnings: Number(completedEarnings.toFixed(2)),
      scheduledRevenue: Number(scheduledRevenue.toFixed(2)),
      totalExpenses: Number(totalExpenses.toFixed(2)),
      netProfit,
      profitMarginPct,
      totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
      avgTicket,
      effectiveCostPerKm,
      priceAlertCount: priceAlerts.length,
      expensesByCategory,
    };

    return {
      summary,
      rides: filteredRides,
      expenses: filteredExpenses,
      scheduleBlocks,
      priceAlerts,
      rideMargins,
      settings,
    };
  },

  createAdminScheduleBlock: async (payload: {
    blockDate: string;
    startHhmm: string;
    endHhmm: string;
    reason?: string;
  }): Promise<{ block: ScheduleBlock }> => {
    const fbUser = auth.currentUser;
    if (!fbUser || !isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');

    const startDt = parseSpDateTime(payload.blockDate, payload.startHhmm);
    const endDt = parseSpDateTime(payload.blockDate, payload.endHhmm);
    if (endDt.getTime() <= startDt.getTime()) {
      throw new Error('O horário de término deve ser posterior ao início.');
    }

    const slotId = generateCode('BLK');
    const reason = (payload.reason || 'Bloqueio manual do motorista').trim().slice(0, 200);
    await setDoc(doc(db, 'scheduleSlots', slotId), {
      slotId,
      userId: fbUser.uid,
      sourceType: 'manual_block',
      referenceCode: slotId,
      date: payload.blockDate,
      startTimeIso: startDt.toISOString(),
      endTimeIso: endDt.toISOString(),
      startTimeStr: payload.startHhmm.slice(0, 5),
      endTimeStr: payload.endHhmm.slice(0, 5),
      reason,
      active: true,
      updatedAt: serverTimestamp(),
    });

    return {
      block: {
        id: slotId,
        adminUid: fbUser.uid,
        blockDate: payload.blockDate,
        startTimeStr: payload.startHhmm.slice(0, 5),
        endTimeStr: payload.endHhmm.slice(0, 5),
        startTime: startDt.toISOString(),
        endTime: endDt.toISOString(),
        reason,
        createdAt: new Date().toISOString(),
      },
    };
  },

  deleteAdminScheduleBlock: async (id: string | number) => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    await deleteDoc(doc(db, 'scheduleSlots', String(id)));
    return { deleted: { id } as ScheduleBlock };
  },

  getAdminWallets: async (): Promise<{
    topups: WalletTopupRequest[];
    vipRequests: VipRequest[];
    clients: AdminClientWallet[];
  }> => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');

    const [topupsSnap, vipSnap, usersSnap] = await Promise.all([
      getDocs(collection(db, 'walletTopups')),
      getDocs(collection(db, 'vipRequests')),
      getDocs(collection(db, 'users')),
    ]);

    const clientsMap = new Map<string, AdminClientWallet>();
    usersSnap.forEach((s) => {
      const d = s.data();
      const uid = String(d.uid || s.id);
      clientsMap.set(uid, {
        uid,
        name: String(d.name || d.displayName || 'Passageiro VIP'),
        email: String(d.email || ''),
        phone: String(d.phone || ''),
        points: Number(d.points ?? d.pontos ?? 0),
        walletBalance: Number(d.walletBalance ?? 0),
        pendingPenalty: Number(d.pendingPenalty ?? 0),
        vipActive: Boolean(d.vipActive ?? d.isVip ?? false),
        vipSubscribedAt: d.vipSubscribedAt ? toIso(d.vipSubscribedAt) : null,
      });
    });

    const topups: WalletTopupRequest[] = [];
    topupsSnap.forEach((s) => {
      const d = s.data();
      const client = clientsMap.get(String(d.userId || ''));
      topups.push({
        id: s.id,
        requestCode: String(d.requestCode || s.id),
        userId: String(d.userId || ''),
        userName: String(d.userName || client?.name || 'Passageiro'),
        userEmail: String(d.userEmail || client?.email || ''),
        userPhone: String(d.userPhone || client?.phone || ''),
        amount: Number(d.amount || 0),
        pixKey: String(d.pixKey || OFFICIAL_PIX_KEY),
        status: (d.status as WalletTopupRequest['status']) || 'Pendente',
        adminNotes: String(d.adminNotes || ''),
        createdAt: toIso(d.createdAt),
        reviewedAt: d.reviewedAt ? toIso(d.reviewedAt) : null,
      });
    });
    topups.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const vipRequests: VipRequest[] = [];
    vipSnap.forEach((s) => {
      const d = s.data();
      const client = clientsMap.get(String(d.userId || ''));
      vipRequests.push({
        id: s.id,
        userId: String(d.userId || ''),
        userName: String(d.userName || client?.name || 'Passageiro'),
        userEmail: String(d.userEmail || client?.email || ''),
        userPhone: String(d.userPhone || client?.phone || ''),
        amount: Number(d.amount ?? VIP_MONTHLY_PRICE),
        status: (d.status as VipRequest['status']) || 'Pendente',
        notes: String(d.notes || ''),
        createdAt: toIso(d.createdAt),
        reviewedAt: d.reviewedAt ? toIso(d.reviewedAt) : null,
      });
    });
    vipRequests.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));

    const clients = Array.from(clientsMap.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );

    return { topups, vipRequests, clients };
  },

  reviewWalletTopup: async (
    id: string | number,
    approve: boolean,
    adminNotes?: string
  ): Promise<{ topup: WalletTopupRequest; updatedWalletBalance?: number }> => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');

    const topupRef = doc(db, 'walletTopups', String(id));
    const result = await runTransaction(db, async (tx) => {
      const topSnap = await tx.get(topupRef);
      if (!topSnap.exists()) throw new Error('Solicitação de recarga não encontrada.');
      const td = topSnap.data();
      if (td.status !== 'Pendente') {
        throw new Error('Esta solicitação já foi revisada.');
      }

      const nextStatus = approve ? 'Aprovado' : 'Rejeitado';
      const nowIso = new Date().toISOString();
      tx.update(topupRef, {
        status: nextStatus,
        adminNotes: String(adminNotes || '').slice(0, 240),
        reviewedAt: nowIso,
      });

      let nextBalance: number | undefined;
      if (approve) {
        const userRef = doc(db, 'users', String(td.userId));
        const userSnap = await tx.get(userRef);
        const currentBal = userSnap.exists() ? Number(userSnap.data().walletBalance ?? 0) : 0;
        nextBalance = Number((currentBal + Number(td.amount || 0)).toFixed(2));
        if (userSnap.exists()) {
          tx.update(userRef, {
            walletBalance: nextBalance,
            updatedAt: serverTimestamp(),
          });
        }
        const txLogRef = doc(collection(db, 'users', String(td.userId), 'walletTransactions'));
        tx.set(txLogRef, {
          userId: String(td.userId),
          type: 'recarga',
          amount: Number(td.amount || 0),
          balanceAfter: nextBalance,
          description: `Recarga Pix aprovada (${td.requestCode || topSnap.id})`,
          referenceCode: String(td.requestCode || topSnap.id),
          createdAt: serverTimestamp(),
        });
      }

      return {
        topup: {
          id: topSnap.id,
          requestCode: String(td.requestCode || topSnap.id),
          userId: String(td.userId),
          userName: String(td.userName || ''),
          userEmail: String(td.userEmail || ''),
          userPhone: String(td.userPhone || ''),
          amount: Number(td.amount || 0),
          pixKey: String(td.pixKey || OFFICIAL_PIX_KEY),
          status: nextStatus as WalletTopupRequest['status'],
          adminNotes: String(adminNotes || ''),
          createdAt: toIso(td.createdAt),
          reviewedAt: nowIso,
        },
        updatedWalletBalance: nextBalance,
      };
    });

    return result;
  },

  adjustClientWallet: async (uid: string, deltaAmount: number, reason: string) => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    const userRef = doc(db, 'users', uid);

    const client = await runTransaction(db, async (tx) => {
      const snap = await tx.get(userRef);
      if (!snap.exists()) throw new Error('Cliente não encontrado.');
      const current = Number(snap.data().walletBalance ?? 0);
      const next = Number(Math.max(0, current + deltaAmount).toFixed(2));
      tx.update(userRef, {
        walletBalance: next,
        updatedAt: serverTimestamp(),
      });
      const txLogRef = doc(collection(db, 'users', uid, 'walletTransactions'));
      tx.set(txLogRef, {
        userId: uid,
        type: 'ajuste_admin',
        amount: Number(deltaAmount.toFixed(2)),
        balanceAfter: next,
        description: reason.trim().slice(0, 240) || 'Ajuste manual pelo administrador',
        referenceCode: generateCode('ADJ'),
        createdAt: serverTimestamp(),
      });
      return {
        uid,
        walletBalance: next,
        pendingPenalty: Number(snap.data().pendingPenalty ?? 0),
      };
    });

    return { client };
  },

  settleClientPenalty: async (uid: string) => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    const userRef = doc(db, 'users', uid);
    await updateDoc(userRef, {
      pendingPenalty: 0,
      updatedAt: serverTimestamp(),
    });
    const snap = await getDoc(userRef);
    return {
      client: {
        uid,
        walletBalance: Number(snap.data()?.walletBalance ?? 0),
        pendingPenalty: 0,
      },
    };
  },

  reviewVipRequest: async (id: string | number, approve: boolean) => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    const reqRef = doc(db, 'vipRequests', String(id));
    const reqSnap = await getDoc(reqRef);
    if (!reqSnap.exists()) throw new Error('Solicitação VIP não encontrada.');

    const rd = reqSnap.data();
    const nowIso = new Date().toISOString();
    const nextStatus = approve ? 'Aprovado' : 'Rejeitado';
    const batch = writeBatch(db);
    batch.update(reqRef, {
      status: nextStatus,
      reviewedAt: nowIso,
    });
    if (approve) {
      batch.update(doc(db, 'users', String(rd.userId)), {
        vipActive: true,
        isVip: true,
        vipSubscribedAt: nowIso,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    return {
      vipRequest: {
        id: reqSnap.id,
        userId: String(rd.userId),
        userName: String(rd.userName || ''),
        userEmail: String(rd.userEmail || ''),
        userPhone: String(rd.userPhone || ''),
        amount: Number(rd.amount ?? VIP_MONTHLY_PRICE),
        status: nextStatus as VipRequest['status'],
        notes: String(rd.notes || ''),
        createdAt: toIso(rd.createdAt),
        reviewedAt: nowIso,
      },
    };
  },

  adminToggleUserVip: async (uid: string, vipActive: boolean) => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    const nowIso = vipActive ? new Date().toISOString() : null;
    await updateDoc(doc(db, 'users', uid), {
      vipActive,
      isVip: vipActive,
      ...(nowIso ? { vipSubscribedAt: nowIso } : {}),
      updatedAt: serverTimestamp(),
    });
    return {
      client: {
        uid,
        vipActive,
        vipSubscribedAt: nowIso,
      },
    };
  },

  createExpense: async (payload: {
    category: string;
    description: string;
    amount: number;
    expenseDate: string;
    odometerKm?: number | null;
  }): Promise<{ expense: Expense }> => {
    const fbUser = auth.currentUser;
    if (!fbUser || !isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');

    const docData: Record<string, any> = {
      adminUid: fbUser.uid,
      category: payload.category.slice(0, 60),
      description: payload.description.slice(0, 200),
      amount: Number(payload.amount),
      expenseDate: payload.expenseDate,
      createdAt: serverTimestamp(),
    };
    if (payload.odometerKm !== undefined && payload.odometerKm !== null) {
      docData.odometerKm = Math.round(Number(payload.odometerKm));
    }

    const ref = await addDoc(collection(db, 'expenses'), docData);
    return {
      expense: {
        id: ref.id,
        adminUid: fbUser.uid,
        category: payload.category,
        description: payload.description,
        amount: Number(payload.amount),
        expenseDate: payload.expenseDate,
        odometerKm: payload.odometerKm ?? null,
        createdAt: new Date().toISOString(),
      },
    };
  },

  deleteExpense: async (id: string | number) => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    await deleteDoc(doc(db, 'expenses', String(id)));
    return { deleted: { id } as Expense };
  },

  updateSettings: async (payload: AppSettings): Promise<{ settings: AppSettings }> => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    const sanitized: AppSettings = {
      standardKm: Math.max(MIN_KM_RATE, Number(payload.standardKm) || MIN_KM_RATE),
      execKm: Math.max(MIN_KM_RATE, Number(payload.execKm) || 3.6),
      roundTripKm: Math.max(MIN_KM_RATE, Number(payload.roundTripKm) || MIN_KM_RATE),
      minFare: Math.max(15, Number(payload.minFare) || 25),
      estimatedCostPerKm: Math.max(0.3, Number(payload.estimatedCostPerKm ?? 1.35)),
      minMarginPct: Math.max(5, Math.min(90, Number(payload.minMarginPct ?? 40))),
      maxMarginPct: Math.max(10, Math.min(98, Number(payload.maxMarginPct ?? 80))),
      safetyMarginMin: Math.max(0, Math.min(180, Math.round(Number(payload.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN)))),
      pixKey: (payload.pixKey || OFFICIAL_PIX_KEY).trim().slice(0, 120),
      whatsapp: (payload.whatsapp || DEFAULT_DRIVER_WHATSAPP).replace(/\D/g, '').slice(0, 20) || DEFAULT_DRIVER_WHATSAPP,
    };

    await setDoc(doc(db, 'settings', 'global'), {
      ...sanitized,
      updatedAt: serverTimestamp(),
    });
    return { settings: sanitized };
  },

  getAdminRaffles: async (): Promise<{ raffles: PartnerRaffle[] }> => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    const snap = await getDocs(collection(db, 'partnerRaffles'));
    const raffles: PartnerRaffle[] = [];
    snap.forEach((s) => {
      const d = s.data();
      raffles.push({
        id: s.id,
        partnerName: String(d.partnerName || ''),
        partnerLogoUrl: String(d.partnerLogoUrl || ''),
        prizeTitle: String(d.prizeTitle || ''),
        prizeDescription: String(d.prizeDescription || ''),
        drawDate: String(d.drawDate || ''),
        active: Boolean(d.active),
        createdAt: toIso(d.createdAt),
      });
    });
    raffles.sort((a, b) => a.drawDate.localeCompare(b.drawDate));
    return { raffles };
  },

  createAdminRaffle: async (payload: {
    partnerName: string;
    partnerLogoUrl: string;
    prizeTitle: string;
    prizeDescription: string;
    drawDate: string;
  }): Promise<{ raffle: PartnerRaffle }> => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    const ref = await addDoc(collection(db, 'partnerRaffles'), {
      partnerName: payload.partnerName.trim().slice(0, 120),
      partnerLogoUrl: payload.partnerLogoUrl.trim().slice(0, 500),
      prizeTitle: payload.prizeTitle.trim().slice(0, 140),
      prizeDescription: payload.prizeDescription.trim().slice(0, 300),
      drawDate: payload.drawDate,
      active: true,
      createdAt: serverTimestamp(),
    });
    return {
      raffle: {
        id: ref.id,
        ...payload,
        active: true,
        createdAt: new Date().toISOString(),
      },
    };
  },

  toggleAdminRaffle: async (id: string | number, active: boolean) => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    await updateDoc(doc(db, 'partnerRaffles', String(id)), { active });
    const snap = await getDoc(doc(db, 'partnerRaffles', String(id)));
    const d = snap.data() || {};
    return {
      raffle: {
        id: snap.id,
        partnerName: String(d.partnerName || ''),
        partnerLogoUrl: String(d.partnerLogoUrl || ''),
        prizeTitle: String(d.prizeTitle || ''),
        prizeDescription: String(d.prizeDescription || ''),
        drawDate: String(d.drawDate || ''),
        active: Boolean(d.active),
        createdAt: toIso(d.createdAt),
      },
    };
  },

  deleteAdminRaffle: async (id: string | number) => {
    if (!isStrictAdminUser()) throw new Error('Acesso restrito ao administrador.');
    await deleteDoc(doc(db, 'partnerRaffles', String(id)));
    return { deleted: { id } as PartnerRaffle };
  },

  computeRoute: async (
    originLat: number,
    originLng: number,
    destinationLat: number,
    destinationLng: number
  ): Promise<RouteMetrics> => {
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destinationLng},${destinationLat}?overview=full&geometries=geojson`;
      const resp = await fetch(url);
      if (resp.ok) {
        const data = await resp.json();
        const route = data?.routes?.[0];
        if (route) {
          const distanceKm = Math.max(0.8, Number((Number(route.distance) / 1000).toFixed(2)));
          const durationMin = Math.max(4, Math.round(Number(route.duration) / 60));
          const durationInTrafficMin = Math.max(durationMin, Math.round(durationMin * 1.15));
          const coords: [number, number][] = Array.isArray(route.geometry?.coordinates)
            ? route.geometry.coordinates.map(([lng, lat]: [number, number]) => [lat, lng])
            : [
                [originLat, originLng],
                [destinationLat, destinationLng],
              ];
          return {
            distanceKm,
            durationMin,
            durationInTrafficMin,
            trafficDeltaMin: Math.max(0, durationInTrafficMin - durationMin),
            coords,
            source: 'osrm',
          };
        }
      }
    } catch {
      // Fall back to deterministic Haversine calculation
    }

    const distanceKm = haversineKm(originLat, originLng, destinationLat, destinationLng);
    const durationMin = Math.max(5, Math.round((distanceKm / 26) * 60));
    return {
      distanceKm,
      durationMin,
      durationInTrafficMin: durationMin,
      trafficDeltaMin: 0,
      coords: [
        [originLat, originLng],
        [destinationLat, destinationLng],
      ],
      source: 'haversine-estimate',
    };
  },

  searchPlaces: async (
    queryText: string,
    _lat?: number,
    _lng?: number
  ): Promise<{ places: GeoPlace[]; source?: string }> => {
    const qLower = queryText.trim().toLowerCase();
    const localMatches = CURATED_SP_HUBS.filter(
      (h) => h.name.toLowerCase().includes(qLower) || h.address.toLowerCase().includes(qLower)
    );

    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&countrycodes=br&limit=6&addressdetails=1&q=${encodeURIComponent(
        queryText
      )}`;
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (resp.ok) {
        const rows = (await resp.json()) as any[];
        const places: GeoPlace[] = rows.map((row) => ({
          name: String(row.name || String(row.display_name || '').split(',')[0] || queryText),
          address: String(row.display_name || ''),
          lat: Number(row.lat),
          lng: Number(row.lon),
        }));
        const combined = [...localMatches, ...places].slice(0, 8);
        return { places: combined, source: 'nominatim' };
      }
    } catch {
      // Fallback to local hubs
    }

    return { places: localMatches, source: 'curated' };
  },

  reverseGeocode: async (lat: number, lng: number): Promise<GeoPlace> => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
      const resp = await fetch(url, { headers: { Accept: 'application/json' } });
      if (resp.ok) {
        const data = await resp.json();
        const road = data?.address?.road || data?.name || 'Local selecionado no Mapa';
        const suburb = data?.address?.suburb || data?.address?.city || 'São Paulo - SP';
        return {
          name: String(road),
          address: String(data?.display_name || `${road}, ${suburb}`),
          lat,
          lng,
        };
      }
    } catch {
      // Fallback to coordinates label
    }
    return {
      name: 'Ponto Selecionado',
      address: `Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}`,
      lat,
      lng,
    };
  },

  aiChat: async (params: {
    message: string;
    history: ChatMessage[];
    mode: AiMode;
    speed: AiSpeed;
  }): Promise<{ text: string; modelUsed: string; sources: any[] }> => {
    const q = params.message.toLowerCase();
    let reply =
      'Posso ajudar com cotações Executiva ou Ida e Volta (piso R$ 3,00/km), benefícios do Clube VIP (R$ 12,90/mês) e agendamento inteligente.';
    if (q.includes('bate') || q.includes('volta') || q.includes('guarulhos')) {
      reply =
        'Na modalidade Ida e Volta aplicamos 10% de desconto automático sobre o trecho duplo, respeitando o piso de R$ 3,00/km e a margem de segurança de 15 minutos na agenda.';
    } else if (q.includes('vip') || q.includes('ponto') || q.includes('ouro') || q.includes('black')) {
      reply =
        'Assinantes Clube VIP (R$ 12,90/mês) acumulam pontos em dobro, resgatam R$ 5 a cada 100 pts direto na cotação, salvam preferências de bordo e participam dos sorteios em lojas parceiras.';
    } else if (params.mode === 'finance' || q.includes('lucro') || q.includes('margem')) {
      reply =
        'No Painel Master você acompanha receitas concluídas, despesas lançadas, alertas de margem fora da faixa configurada e aprovação de recargas Pix e solicitações VIP em tempo real no Firestore.';
    }
    return {
      text: reply,
      modelUsed: 'concierge-local',
      sources: [],
    };
  },

  aiMapsGrounding: async (queryText: string, lat?: number, lng?: number) => {
    const res = await api.searchPlaces(queryText, lat, lng);
    const list = res.places.slice(0, 5).map((p) => `• ${p.name} — ${p.address}`).join('\n');
    return {
      text: list || 'Nenhum local específico encontrado para essa busca. Tente informar bairro ou ponto de referência em São Paulo.',
      modelUsed: 'nominatim-local',
      sources: [],
    };
  },

  aiSearchGrounding: async (queryText: string) => {
    return {
      text: `Consulta recebida: "${queryText}". Para confirmar embarque e horários disponíveis em tempo real, utilize a seleção de origem/destino e agenda no mapa principal.`,
      modelUsed: 'concierge-local',
      sources: [],
    };
  },
};
