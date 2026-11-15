import { RoundTripMode } from '../types.ts';

export const DEFAULT_SAFETY_MARGIN_MIN = 15;
export const DEFAULT_DRIVER_WHATSAPP = '5511947476229';
export const OFFICIAL_PIX_KEY = 'cc67fed7-c665-4bb9-aeb5-f7a2dc7ac84e';

export function parseSpDateTime(dateStr: string, timeStr: string): Date {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || '').trim())
    ? String(dateStr).trim()
    : new Date().toISOString().split('T')[0];
  const hhmm = /^\d{2}:\d{2}/.test(String(timeStr || '').trim())
    ? String(timeStr).trim().slice(0, 5)
    : '09:00';
  const parsed = new Date(`${safeDate}T${hhmm}:00-03:00`);
  if (!Number.isFinite(parsed.getTime())) {
    return new Date();
  }
  return parsed;
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + Math.round(minutes) * 60 * 1000);
}

/**
 * Formats a Date into HH:mm in America/Sao_Paulo (UTC-3) deterministically.
 */
export function formatSpTime(dateInput: Date | string | number): string {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (!Number.isFinite(d.getTime())) return '09:00';
  const spMs = d.getTime() - 3 * 60 * 60 * 1000;
  const spDate = new Date(spMs);
  const hh = String(spDate.getUTCHours()).padStart(2, '0');
  const mm = String(spDate.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatSpDate(dateInput: Date | string | number): string {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (!Number.isFinite(d.getTime())) return '';
  const spMs = d.getTime() - 3 * 60 * 60 * 1000;
  const spDate = new Date(spMs);
  const yyyy = spDate.getUTCFullYear();
  const mm = String(spDate.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(spDate.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function formatBrDate(dateStr: string): string {
  const match = String(dateStr || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return String(dateStr || '');
  return `${match[3]}/${match[2]}/${match[1]}`;
}

export function formatKmPtBr(distanceKm: number): string {
  return Number(distanceKm || 0).toFixed(1).replace('.', ',');
}

export function formatBrlCurrency(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

export function intervalsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number
): boolean {
  return aStartMs < bEndMs && aEndMs > bStartMs;
}

export interface ComputedOccupancy {
  outboundStart: Date;
  outboundEnd: Date;
  outboundMinutes: number;
  returnStart: Date | null;
  returnEnd: Date | null;
  returnMinutes: number;
  totalOccupiedMin: number;
  safetyMarginMin: number;
  roundTripMode: RoundTripMode;
  waitTimeMin: number;
}

export function computeOccupancyWindows(params: {
  scheduledDate: string;
  scheduledTime: string;
  durationMin: number;
  isRoundTrip: boolean;
  safetyMarginMin?: number;
  roundTripMode?: RoundTripMode | string;
  waitTimeMin?: number;
  returnDate?: string;
  returnTime?: string;
}): ComputedOccupancy {
  const tripMin = Math.max(1, Math.round(Number(params.durationMin) || 15));
  const marginMin = Math.max(0, Math.min(180, Math.round(Number(params.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN))));
  const mode: RoundTripMode =
    params.isRoundTrip && params.roundTripMode === 'scheduled_return'
      ? 'scheduled_return'
      : 'continuous';
  const waitMin =
    params.isRoundTrip && mode === 'continuous'
      ? Math.max(0, Math.min(720, Math.round(Number(params.waitTimeMin ?? 0))))
      : 0;

  const outboundStart = parseSpDateTime(params.scheduledDate, params.scheduledTime);

  if (!params.isRoundTrip) {
    const outboundMinutes = tripMin + marginMin;
    return {
      outboundStart,
      outboundEnd: addMinutes(outboundStart, outboundMinutes),
      outboundMinutes,
      returnStart: null,
      returnEnd: null,
      returnMinutes: 0,
      totalOccupiedMin: outboundMinutes,
      safetyMarginMin: marginMin,
      roundTripMode: 'continuous',
      waitTimeMin: 0,
    };
  }

  if (mode === 'scheduled_return' && params.returnTime) {
    const outboundMinutes = tripMin + marginMin;
    const returnMinutes = tripMin + marginMin;
    const effectiveReturnDate = params.returnDate || params.scheduledDate;
    const returnStart = parseSpDateTime(effectiveReturnDate, params.returnTime);
    return {
      outboundStart,
      outboundEnd: addMinutes(outboundStart, outboundMinutes),
      outboundMinutes,
      returnStart,
      returnEnd: addMinutes(returnStart, returnMinutes),
      returnMinutes,
      totalOccupiedMin: outboundMinutes + returnMinutes,
      safetyMarginMin: marginMin,
      roundTripMode: 'scheduled_return',
      waitTimeMin: 0,
    };
  }

  // Continuous round-trip: (Tempo x 2) + Espera + Margem
  const totalOccupiedMin = tripMin * 2 + waitMin + marginMin;
  return {
    outboundStart,
    outboundEnd: addMinutes(outboundStart, totalOccupiedMin),
    outboundMinutes: totalOccupiedMin,
    returnStart: null,
    returnEnd: null,
    returnMinutes: 0,
    totalOccupiedMin,
    safetyMarginMin: marginMin,
    roundTripMode: 'continuous',
    waitTimeMin: waitMin,
  };
}

export function formatRideWindowSummary(ride: {
  scheduledDate?: string;
  scheduledTime?: string;
  durationMin?: number;
  isRoundTrip?: boolean;
  safetyMarginMin?: number;
  roundTripMode?: string;
  waitTimeMin?: number;
  returnDate?: string;
  returnTime?: string;
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  returnStartTime?: string | Date | null;
  returnEndTime?: string | Date | null;
}): string {
  if (ride.startTime && ride.endTime) {
    const first = `${formatSpTime(ride.startTime)} às ${formatSpTime(ride.endTime)}`;
    if (ride.returnStartTime && ride.returnEndTime) {
      return `Ida ${first} · Volta ${formatSpTime(ride.returnStartTime)} às ${formatSpTime(ride.returnEndTime)}`;
    }
    return first;
  }

  if (!ride.scheduledDate || !ride.scheduledTime) return '';
  const computed = computeOccupancyWindows({
    scheduledDate: ride.scheduledDate,
    scheduledTime: ride.scheduledTime,
    durationMin: ride.durationMin || 20,
    isRoundTrip: Boolean(ride.isRoundTrip),
    safetyMarginMin: ride.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN,
    roundTripMode: ride.roundTripMode,
    waitTimeMin: ride.waitTimeMin,
    returnDate: ride.returnDate,
    returnTime: ride.returnTime,
  });
  const first = `${formatSpTime(computed.outboundStart)} às ${formatSpTime(computed.outboundEnd)}`;
  if (computed.returnStart && computed.returnEnd) {
    return `Ida ${first} · Volta ${formatSpTime(computed.returnStart)} às ${formatSpTime(computed.returnEnd)}`;
  }
  return first;
}

export function formatRideConfirmationMessage(
  ride: {
    rideCode: string;
    clientName: string;
    clientPhone?: string | null;
    originName: string;
    destinationName: string;
    distanceKm: number;
    durationMin: number;
    category: string;
    isRoundTrip: boolean;
    roundTripMode?: string | null;
    waitTimeMin?: number | null;
    returnDate?: string | null;
    returnTime?: string | null;
    recurrenceFrequency?: string | null;
    preferences?: string | null;
    scheduledDate: string;
    scheduledTime: string;
    price: number;
    paymentMethod?: string | null;
    walletDeducted?: number | null;
    remainingDue?: number | null;
    penaltyIncluded?: number | null;
    pointsRedeemed?: number | null;
    notes?: string | null;
  },
  settings: { pixKey?: string; whatsapp?: string },
  options?: { vipActive?: boolean }
): string {
  const dateBr = formatBrDate(ride.scheduledDate);
  const timeShort = String(ride.scheduledTime || '09:00').slice(0, 5);
  const kmText = formatKmPtBr(ride.distanceKm);
  const minText = Math.max(1, Math.round(Number(ride.durationMin) || 15));

  const isRoundTrip = Boolean(ride.isRoundTrip || ride.category === 'roundtrip');
  let modalityLabel = 'Executiva (Somente Ida)';
  if (isRoundTrip) {
    if (ride.roundTripMode === 'scheduled_return' && ride.returnTime) {
      const retDateLabel =
        ride.returnDate && ride.returnDate !== ride.scheduledDate
          ? `${formatBrDate(ride.returnDate)} às ${ride.returnTime.slice(0, 5)}`
          : ride.returnTime.slice(0, 5);
      modalityLabel = `Ida e Volta (Retorno às ${retDateLabel})`;
    } else {
      const waitMin = Number(ride.waitTimeMin || 0);
      modalityLabel =
        waitMin > 0
          ? `Ida e Volta (Retorno Contínuo · espera ${waitMin} min)`
          : 'Ida e Volta (Retorno Contínuo)';
    }
  }

  const recurrenceMap: Record<string, string> = {
    daily: 'Recorrência Diária',
    weekly: 'Recorrência Semanal',
    monthly: 'Recorrência Mensal',
  };
  const recurrenceLabel =
    ride.recurrenceFrequency && recurrenceMap[ride.recurrenceFrequency]
      ? recurrenceMap[ride.recurrenceFrequency]
      : '';

  const pointsRedeemed = Number(ride.pointsRedeemed || 0);
  const vipBenefitsParts: string[] = [];
  if (recurrenceLabel) vipBenefitsParts.push(recurrenceLabel);
  if (pointsRedeemed > 0) vipBenefitsParts.push(`${pointsRedeemed} pts aplicados`);

  const hasVipSection =
    Boolean(options?.vipActive || recurrenceLabel || ride.preferences?.trim() || pointsRedeemed > 0) &&
    (vipBenefitsParts.length > 0 || Boolean(ride.preferences?.trim()));

  const totalPrice = Number(ride.price || 0);
  const walletDeducted = Number(ride.walletDeducted || 0);
  const remainingDue = Number(
    ride.remainingDue !== undefined && ride.remainingDue !== null
      ? ride.remainingDue
      : Math.max(0, totalPrice - walletDeducted)
  );
  const penaltyIncluded = Number(ride.penaltyIncluded || 0);
  const method = String(ride.paymentMethod || 'Pix');
  const pixKey = settings.pixKey || OFFICIAL_PIX_KEY;

  let paymentSummary = '';
  if (walletDeducted > 0 && remainingDue <= 0) {
    paymentSummary = `Carteira Digital (${formatBrlCurrency(walletDeducted)} abatidos do saldo)`;
  } else if (walletDeducted > 0 && remainingDue > 0) {
    if (method.includes('Cartão')) {
      paymentSummary = `Carteira Digital (${formatBrlCurrency(walletDeducted)} abatidos) + Cartão Presencial na maquininha (${formatBrlCurrency(remainingDue)})`;
    } else {
      paymentSummary = `Carteira Digital (${formatBrlCurrency(walletDeducted)} abatidos) + Pix (${formatBrlCurrency(remainingDue)} · Chave: ${pixKey})`;
    }
  } else if (method.includes('Cartão')) {
    paymentSummary = `Cartão Presencial na maquininha (${formatBrlCurrency(remainingDue)})`;
  } else {
    paymentSummary = `Pix (${formatBrlCurrency(remainingDue)} · Chave: ${pixKey})`;
  }

  const lines: string[] = [
    '*NOVA RESERVA CONFIRMADA* 🚘',
    `*Código:* ${ride.rideCode}`,
    '',
    `*Passageiro:* ${ride.clientName}`,
  ];

  if (ride.clientPhone?.trim()) {
    lines.push(`*WhatsApp:* ${ride.clientPhone.trim()}`);
  }
  lines.push(`*Embarque:* ${ride.originName}`);
  lines.push(`*Destino:* ${ride.destinationName}`);
  lines.push(`*Data/Hora:* ${dateBr} às ${timeShort}`);
  lines.push(`*Modalidade:* ${modalityLabel}`);
  lines.push(`*Percurso:* ${kmText} km (~${minText} min)`);

  if (hasVipSection) {
    lines.push('');
    if (vipBenefitsParts.length > 0) {
      lines.push(`*Benefícios VIP:* ${vipBenefitsParts.join(' · ')}`);
    }
    if (ride.preferences?.trim()) {
      lines.push(`*Preferências:* ${ride.preferences.trim()}`);
    }
  }

  lines.push('');
  lines.push(
    `*Valor Total:* ${formatBrlCurrency(totalPrice)}${
      penaltyIncluded > 0 ? ` (inclui multa pendente de ${formatBrlCurrency(penaltyIncluded)})` : ''
    }`
  );
  lines.push(`*Pagamento:* ${paymentSummary}`);

  if (ride.notes?.trim()) {
    lines.push(`*Observações:* ${ride.notes.trim()}`);
  }

  return lines.join('\n');
}
