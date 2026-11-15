import 'dotenv/config';
import path from 'path';
import { fileURLToPath } from 'url';
import express, { Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import { adminAuth } from './src/lib/firebase-admin.ts';
import { ADMIN_EMAILS, AuthRequest, requireAdmin, requireAuth } from './src/middleware/auth.ts';
import {
  LATE_CANCEL_PENALTY,
  MIN_KM_RATE,
  OFFICIAL_PIX_KEY,
  ScheduleConflictError,
  VIP_MONTHLY_PRICE,
  adjustUserWalletBalance,
  createExpenseRecord,
  createPartnerRaffleRecord,
  createRideRecord,
  createScheduleBlockRecord,
  createVipPaymentRequest,
  createWalletTopupRequest,
  deleteExpenseRecord,
  deletePartnerRaffleRecord,
  deleteScheduleBlockRecord,
  getActiveBusyWindows,
  getGlobalSettings,
  getOrCreateUser,
  getUserByUid,
  listAllExpenses,
  listAllRides,
  listAllUsersWallets,
  listAllWalletTopups,
  listPartnerRaffles,
  listRidesForUser,
  listScheduleBlocks,
  listUserVouchers,
  listVipPaymentRequests,
  listWalletTopupsForUser,
  listWalletTransactionsForUser,
  redeemVoucherForUser,
  reviewVipPaymentRequest,
  reviewWalletTopupRequest,
  settleUserPendingPenalty,
  togglePartnerRaffleRecord,
  updateGlobalSettings,
  updateRideStatusRecord,
  updateUserProfileRecord,
  updateUserVipSubscription,
} from './src/db/repository.ts';
import {
  DEFAULT_DRIVER_WHATSAPP,
  DEFAULT_SAFETY_MARGIN_MIN,
  addMinutes,
  computeOccupancyWindows,
  formatRideConfirmationMessage,
  formatSpDate,
  formatSpTime,
  intervalsOverlap,
  parseSpDateTime,
} from './src/utils/schedule.ts';
import { formatCpf, formatPhoneBr, isValidCpf, onlyDigits } from './src/utils/validators.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function computeVipTier(points: number): 'Bronze' | 'Prata' | 'Ouro' | 'Black' {
  if (points >= 2500) return 'Black';
  if (points >= 1000) return 'Ouro';
  if (points >= 400) return 'Prata';
  return 'Bronze';
}

function getTierDiscountPct(points: number): number {
  if (points >= 2500) return 0.15;
  if (points >= 1000) return 0.10;
  if (points >= 400) return 0.05;
  return 0;
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
  return R * c;
}

function decodeEncodedPolyline(encoded: string): [number, number][] {
  const points: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let b = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = result & 1 ? ~(result >> 1) : result >> 1;
    lng += dlng;

    points.push([lat / 1e5, lng / 1e5]);
  }
  return points;
}

function getGenAiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getMapsServerKey(): string {
  const k = process.env.GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
  if (k === 'MY_GOOGLE_MAPS_API_KEY') return '';
  return k;
}

const optionalAuth = async (req: AuthRequest, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split('Bearer ')[1];
    try {
      const decoded = await adminAuth.verifyIdToken(token);
      req.user = decoded;
      req.isAdminUser = Boolean(
        decoded.email && decoded.email_verified && ADMIN_EMAILS.has(decoded.email.toLowerCase())
      );
    } catch {
      // Proceed unauthenticated for public/optional endpoints
    }
  }
  next();
};

const REWARDS_CATALOG: Record<string, { title: string; discountValue: number; pointsCost: number }> = {
  desconto_15: { title: 'Desconto Prata R$ 15', discountValue: 15, pointsCost: 300 },
  desconto_35: { title: 'Voucher Executivo R$ 35', discountValue: 35, pointsCost: 700 },
  upgrade_exec: { title: 'Cortesia Black R$ 60', discountValue: 60, pointsCost: 1200 },
};

function formatBrl(value: number): string {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function normalizeWhatsAppDigits(raw: string): string {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  return digits.length >= 12 ? digits : '';
}

function buildWhatsAppConfirmationText(
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
    paymentStatus?: string | null;
    walletDeducted?: number | null;
    remainingDue?: number | null;
    penaltyIncluded?: number | null;
    pointsRedeemed?: number | null;
    notes?: string | null;
  },
  settings: { pixKey: string; whatsapp: string },
  options?: { vipActive?: boolean }
): string {
  return formatRideConfirmationMessage(ride, settings, options);
}

async function dispatchWhatsAppConfirmation(
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
    paymentStatus?: string | null;
    walletDeducted?: number | null;
    remainingDue?: number | null;
    penaltyIncluded?: number | null;
    pointsRedeemed?: number | null;
    notes?: string | null;
  },
  settings: { pixKey: string; whatsapp: string },
  options?: { vipActive?: boolean }
) {
  const messagePreview = buildWhatsAppConfirmationText(ride, settings, options);
  const driverPhone = normalizeWhatsAppDigits(settings.whatsapp) || DEFAULT_DRIVER_WHATSAPP;
  const passengerPhone = normalizeWhatsAppDigits(ride.clientPhone || '');

  const recipients = Array.from(
    new Set([passengerPhone, driverPhone].filter(Boolean))
  );
  const whatsappUrl = `https://wa.me/${driverPhone}?text=${encodeURIComponent(messagePreview)}`;

  const apiUrl = (process.env.WHATSAPP_API_URL || '').trim();
  const apiToken = (process.env.WHATSAPP_API_TOKEN || '').trim();

  if (!apiUrl || !apiToken || apiToken === 'MY_WHATSAPP_API_TOKEN') {
    return {
      dispatched: false,
      mode: 'whatsapp-deep-link' as const,
      recipients,
      messagePreview,
      whatsappUrl,
      statusDetail:
        'Mensagem automática preparada com os detalhes da viagem. Configure WHATSAPP_API_URL e WHATSAPP_API_TOKEN no servidor para disparo direto sem cliques.',
    };
  }

  let sentCount = 0;
  const errors: string[] = [];

  for (const to of recipients) {
    try {
      const resp = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiToken}`,
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to,
          type: 'text',
          text: {
            preview_url: false,
            body: messagePreview,
          },
        }),
        signal: AbortSignal.timeout(8000),
      });

      if (resp.ok) {
        sentCount += 1;
      } else {
        const errBody = await resp.text().catch(() => '');
        errors.push(`HTTP ${resp.status}${errBody ? `: ${errBody.slice(0, 100)}` : ''}`);
      }
    } catch (err: any) {
      errors.push(err?.message || 'Falha de rede na API WhatsApp');
    }
  }

  if (sentCount > 0) {
    return {
      dispatched: true,
      mode: 'whatsapp-cloud-api' as const,
      recipients,
      messagePreview,
      whatsappUrl,
      statusDetail: `Confirmação disparada automaticamente via API do WhatsApp para ${sentCount} destinatário(s).`,
    };
  }

  return {
    dispatched: false,
    mode: 'whatsapp-deep-link' as const,
    recipients,
    messagePreview,
    whatsappUrl,
    statusDetail: `Não foi possível enviar via API externa (${errors.join(' | ') || 'erro desconhecido'}). Link direto gerado abaixo.`,
  };
}

function evaluateRidePriceAlerts(
  ridesList: Array<{
    rideCode: string;
    clientName: string;
    originName: string;
    destinationName: string;
    scheduledDate: string;
    scheduledTime: string;
    distanceKm: number;
    isRoundTrip: boolean;
    price: number;
    status: string;
  }>,
  expensesList: Array<{ amount: number }>,
  settings: {
    minFare: number;
    estimatedCostPerKm?: number;
    minMarginPct?: number;
    maxMarginPct?: number;
  }
) {
  const configuredCostPerKm = Math.max(0.3, Number(settings.estimatedCostPerKm) || 1.35);
  const targetMinMarginPct = Math.max(5, Math.min(90, Number(settings.minMarginPct) || 40));
  const targetMaxMarginPct = Math.max(
    targetMinMarginPct + 5,
    Math.min(98, Number(settings.maxMarginPct) || 80)
  );

  const nonCanceledRides = ridesList.filter((r) => r.status !== 'Cancelado');
  const fleetKm = nonCanceledRides.reduce(
    (acc, r) => acc + Math.max(0.5, Number(r.distanceKm || 0) * (r.isRoundTrip ? 2 : 1)),
    0
  );
  const totalExpenses = expensesList.reduce((acc, e) => acc + Number(e.amount || 0), 0);

  const observedCostPerKm = fleetKm > 0 && totalExpenses > 0 ? totalExpenses / fleetKm : 0;
  const effectiveCostPerKm =
    observedCostPerKm > 0
      ? Number((configuredCostPerKm * 0.6 + observedCostPerKm * 0.4).toFixed(2))
      : Number(configuredCostPerKm.toFixed(2));

  const rideMargins: Record<
    string,
    {
      rideCode: string;
      clientName: string;
      originName: string;
      destinationName: string;
      scheduledDate: string;
      scheduledTime: string;
      price: number;
      effectiveKm: number;
      estimatedCost: number;
      estimatedProfit: number;
      marginPct: number;
      targetMinMarginPct: number;
      targetMaxMarginPct: number;
      alertType: 'LOW_MARGIN' | 'HIGH_MARGIN' | 'OK';
      suggestedMinPrice: number;
      message: string;
    }
  > = {};

  const priceAlerts: Array<(typeof rideMargins)[string]> = [];

  for (const r of nonCanceledRides) {
    const effectiveKm = Number(
      Math.max(0.5, Number(r.distanceKm || 0) * (r.isRoundTrip ? 2 : 1)).toFixed(1)
    );
    const estimatedCost = Number((effectiveKm * effectiveCostPerKm).toFixed(2));
    const price = Number(r.price || 0);
    const estimatedProfit = Number((price - estimatedCost).toFixed(2));
    const marginPct = price > 0 ? Number(((estimatedProfit / price) * 100).toFixed(1)) : 0;
    const suggestedMinPrice =
      targetMinMarginPct < 99
        ? Number(
            Math.max(
              Number(settings.minFare) || 25,
              estimatedCost / (1 - targetMinMarginPct / 100)
            ).toFixed(2)
          )
        : Number((estimatedCost * 2).toFixed(2));

    let alertType: 'LOW_MARGIN' | 'HIGH_MARGIN' | 'OK' = 'OK';
    let message = `Margem saudável (${marginPct.toFixed(1)}%) dentro da faixa ${targetMinMarginPct.toFixed(0)}%–${targetMaxMarginPct.toFixed(0)}%.`;

    if (marginPct < targetMinMarginPct) {
      alertType = 'LOW_MARGIN';
      message = `Alerta de Margem Baixa: custo estimado de ${formatBrl(
        estimatedCost
      )} deixa margem de ${marginPct.toFixed(1)}% (abaixo de ${targetMinMarginPct.toFixed(
        0
      )}%). Tarifa sugerida: ${formatBrl(suggestedMinPrice)}.`;
    } else if (marginPct > targetMaxMarginPct) {
      alertType = 'HIGH_MARGIN';
      message = `Margem Acima da Faixa (${marginPct.toFixed(1)}% vs teto de ${targetMaxMarginPct.toFixed(
        0
      )}%): oportunidade para bonificação VIP ou condição especial.`;
    }

    const analysis = {
      rideCode: r.rideCode,
      clientName: r.clientName,
      originName: r.originName,
      destinationName: r.destinationName,
      scheduledDate: r.scheduledDate,
      scheduledTime: r.scheduledTime,
      price,
      effectiveKm,
      estimatedCost,
      estimatedProfit,
      marginPct,
      targetMinMarginPct,
      targetMaxMarginPct,
      alertType,
      suggestedMinPrice,
      message,
    };

    rideMargins[r.rideCode] = analysis;
    if (alertType !== 'OK') {
      priceAlerts.push(analysis);
    }
  }

  priceAlerts.sort((a, b) => {
    if (a.alertType !== b.alertType) {
      return a.alertType === 'LOW_MARGIN' ? -1 : 1;
    }
    return a.marginPct - b.marginPct;
  });

  return {
    effectiveCostPerKm,
    priceAlerts,
    rideMargins,
  };
}

async function startServer() {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self)');
    next();
  });

  app.use(express.json({ limit: '1mb' }));

  // =========================================================
  // PUBLIC CONFIGURATION
  // =========================================================
  app.get('/api/public/config', async (_req, res) => {
    try {
      const settings = await getGlobalSettings();
      const mapsBrowserKey =
        process.env.VITE_GOOGLE_MAPS_API_KEY && process.env.VITE_GOOGLE_MAPS_API_KEY !== 'MY_GOOGLE_MAPS_API_KEY'
          ? process.env.VITE_GOOGLE_MAPS_API_KEY
          : getMapsServerKey();

      res.json({
        settings: {
          standardKm: Math.max(MIN_KM_RATE, settings.standardKm),
          execKm: Math.max(MIN_KM_RATE, settings.execKm),
          roundTripKm: Math.max(MIN_KM_RATE, settings.roundTripKm),
          minFare: settings.minFare,
          estimatedCostPerKm: Number(settings.estimatedCostPerKm ?? 1.35),
          minMarginPct: Number(settings.minMarginPct ?? 40),
          maxMarginPct: Number(settings.maxMarginPct ?? 80),
          safetyMarginMin: Number(settings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN),
          pixKey: settings.pixKey,
          whatsapp: settings.whatsapp || DEFAULT_DRIVER_WHATSAPP,
        },
        mapsBrowserKey,
        adminEmail: 'reisanselmo7@gmail.com',
      });
    } catch (error) {
      console.error('Error in /api/public/config:', error);
      res.status(500).json({ error: 'Erro ao carregar configurações do sistema.' });
    }
  });

  // =========================================================
  // AUTH, ONBOARDING PROFILE & CLUBE VIP (R$ 12,90/MÊS)
  // =========================================================
  function serializeUserProfile(dbUser: any, isAdminUser: boolean) {
    let parsedPrefs: Record<string, string> = {};
    try {
      parsedPrefs = JSON.parse(dbUser.vipPreferences || '{}') || {};
    } catch {
      parsedPrefs = {};
    }
    return {
      uid: dbUser.uid,
      name: dbUser.name,
      email: dbUser.email,
      phone: dbUser.phone || '',
      address: dbUser.address || '',
      cpf: dbUser.cpf || '',
      profileCompleted: Boolean(dbUser.profileCompleted),
      photoUrl: dbUser.photoUrl || '',
      points: Number(dbUser.points || 0),
      tier: computeVipTier(dbUser.points || 0),
      walletBalance: Number(dbUser.walletBalance || 0),
      pendingPenalty: Number(dbUser.pendingPenalty || 0),
      vipActive: Boolean(dbUser.vipActive),
      vipSubscribedAt: dbUser.vipSubscribedAt ? new Date(dbUser.vipSubscribedAt).toISOString() : null,
      vipPreferences: parsedPrefs,
      isAdmin: Boolean(isAdminUser),
    };
  }

  app.post('/api/auth/sync', requireAuth, async (req: AuthRequest, res) => {
    try {
      const tokenUser = req.user!;
      const bodyPhone = typeof req.body?.phone === 'string' ? req.body.phone.slice(0, 40) : '';
      const dbUser = await getOrCreateUser({
        uid: tokenUser.uid,
        email: tokenUser.email || '',
        name: tokenUser.name || tokenUser.email?.split('@')[0] || 'Passageiro VIP',
        phone: bodyPhone,
        photoUrl: tokenUser.picture || '',
        isAdmin: Boolean(req.isAdminUser),
      });
      const vouchers = await listUserVouchers(tokenUser.uid);

      res.json({
        user: serializeUserProfile(dbUser, Boolean(req.isAdminUser)),
        vouchers,
      });
    } catch (error) {
      console.error('Error in /api/auth/sync:', error);
      res.status(500).json({ error: 'Falha ao sincronizar conta com o servidor.' });
    }
  });

  app.put('/api/profile', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body || {};
      const name = String(body.name || '').trim();
      const phoneDigits = onlyDigits(String(body.phone || ''));
      const address = String(body.address || '').trim();
      const cpfRaw = String(body.cpf || '');

      if (name.length < 3) {
        return res.status(400).json({ error: 'Informe seu Nome Completo (mínimo 3 caracteres).' });
      }
      if (phoneDigits.length < 10 || phoneDigits.length > 11) {
        return res.status(400).json({ error: 'Informe um WhatsApp válido com DDD: (00) 00000-0000.' });
      }
      if (address.length < 8) {
        return res.status(400).json({ error: 'Informe seu Endereço Completo (rua, número, bairro, cidade/UF).' });
      }
      if (!isValidCpf(cpfRaw)) {
        return res.status(400).json({ error: 'CPF inválido. Verifique os dígitos informados.' });
      }

      const formattedPhone = formatPhoneBr(phoneDigits);
      const formattedCpf = formatCpf(cpfRaw);
      const vipPrefsJson =
        body.vipPreferences && typeof body.vipPreferences === 'object'
          ? JSON.stringify(body.vipPreferences)
          : undefined;

      const updated = await updateUserProfileRecord({
        uid: req.user!.uid,
        name,
        phone: formattedPhone,
        address,
        cpf: formattedCpf,
        vipPreferences: vipPrefsJson,
      });

      if (!updated) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }

      res.json({ user: serializeUserProfile(updated, Boolean(req.isAdminUser)) });
    } catch (error) {
      console.error('Error in PUT /api/profile:', error);
      res.status(500).json({ error: 'Erro ao salvar dados cadastrais.' });
    }
  });

  app.post('/api/vip/subscribe', requireAuth, async (req: AuthRequest, res) => {
    try {
      if (!req.isAdminUser) {
        return res.status(403).json({
          error:
            'A ativação do Clube VIP é feita após pagamento pelo link oficial e validação do motorista administrador.',
        });
      }
      const targetUid = String(req.body?.uid || req.user!.uid);
      const prefs =
        req.body?.vipPreferences && typeof req.body.vipPreferences === 'object'
          ? JSON.stringify(req.body.vipPreferences)
          : undefined;
      const updated = await updateUserVipSubscription({
        uid: targetUid,
        vipActive: true,
        vipPreferences: prefs,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      res.json({
        user: serializeUserProfile(updated, updated.uid === req.user!.uid && Boolean(req.isAdminUser)),
        monthlyPrice: VIP_MONTHLY_PRICE,
      });
    } catch (error) {
      console.error('Error in POST /api/vip/subscribe:', error);
      res.status(500).json({ error: 'Não foi possível ativar sua assinatura Clube VIP.' });
    }
  });

  app.post('/api/vip/request', requireAuth, async (req: AuthRequest, res) => {
    try {
      const userRecord = await getUserByUid(req.user!.uid);
      if (!userRecord) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      const vipRequest = await createVipPaymentRequest({
        userId: req.user!.uid,
        userName: userRecord.name || req.user!.name || 'Passageiro VIP',
        userEmail: userRecord.email || req.user!.email || '',
        userPhone: userRecord.phone || '',
        notes: typeof req.body?.notes === 'string' ? req.body.notes : undefined,
      });
      res.status(201).json({ vipRequest });
    } catch (error) {
      console.error('Error in POST /api/vip/request:', error);
      res.status(500).json({ error: 'Não foi possível registrar o aviso de assinatura VIP.' });
    }
  });

  app.put('/api/vip/preferences', requireAuth, async (req: AuthRequest, res) => {
    try {
      const existing = await getUserByUid(req.user!.uid);
      if (!existing) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      if (!existing.vipActive && !req.isAdminUser) {
        return res.status(403).json({
          error: 'Preferências VIP disponíveis somente com assinatura Clube VIP ativa.',
        });
      }
      const prefs =
        req.body?.vipPreferences && typeof req.body.vipPreferences === 'object'
          ? JSON.stringify(req.body.vipPreferences)
          : '{}';
      const updated = await updateUserVipSubscription({
        uid: req.user!.uid,
        vipActive: existing.vipActive,
        vipPreferences: prefs,
      });
      res.json({
        user: serializeUserProfile(updated, Boolean(req.isAdminUser)),
      });
    } catch (error) {
      console.error('Error in PUT /api/vip/preferences:', error);
      res.status(500).json({ error: 'Erro ao salvar preferências VIP.' });
    }
  });

  app.post('/api/vip/cancel', requireAuth, async (req: AuthRequest, res) => {
    try {
      const updated = await updateUserVipSubscription({
        uid: req.user!.uid,
        vipActive: false,
      });
      if (!updated) {
        return res.status(404).json({ error: 'Usuário não encontrado.' });
      }
      res.json({
        user: serializeUserProfile(updated, Boolean(req.isAdminUser)),
      });
    } catch (error) {
      console.error('Error in POST /api/vip/cancel:', error);
      res.status(500).json({ error: 'Erro ao atualizar assinatura Clube VIP.' });
    }
  });

  // =========================================================
  // CARTEIRA DIGITAL (MINHA CARTEIRA & RECARGA VIA PIX)
  // =========================================================
  app.get('/api/wallet', requireAuth, async (req: AuthRequest, res) => {
    try {
      const uid = req.user!.uid;
      const [userRecord, topups, transactions, settings] = await Promise.all([
        getUserByUid(uid),
        listWalletTopupsForUser(uid),
        listWalletTransactionsForUser(uid),
        getGlobalSettings(),
      ]);
      res.json({
        walletBalance: Number(userRecord?.walletBalance || 0),
        pendingPenalty: Number(userRecord?.pendingPenalty || 0),
        pixKey: settings.pixKey || OFFICIAL_PIX_KEY,
        topups,
        transactions,
      });
    } catch (error) {
      console.error('Error in GET /api/wallet:', error);
      res.status(500).json({ error: 'Erro ao consultar dados da carteira digital.' });
    }
  });

  app.post('/api/wallet/topup', requireAuth, async (req: AuthRequest, res) => {
    try {
      const amount = Number(req.body?.amount);
      if (!Number.isFinite(amount) || amount < 5 || amount > 10000) {
        return res.status(400).json({
          error: 'Informe um valor de recarga válido entre R$ 5,00 e R$ 10.000,00.',
        });
      }
      const uid = req.user!.uid;
      const [userRecord, settings] = await Promise.all([
        getUserByUid(uid),
        getGlobalSettings(),
      ]);
      const requestCode = `PIX-${Date.now().toString(36).toUpperCase()}`;
      const topup = await createWalletTopupRequest({
        requestCode,
        userId: uid,
        userName: userRecord?.name || req.user!.name || 'Passageiro VIP',
        userEmail: userRecord?.email || req.user!.email || '',
        userPhone: userRecord?.phone || '',
        amount: Number(amount.toFixed(2)),
        pixKey: settings.pixKey || OFFICIAL_PIX_KEY,
      });
      res.status(201).json({ topup });
    } catch (error) {
      console.error('Error in POST /api/wallet/topup:', error);
      res.status(500).json({ error: 'Não foi possível registrar sua solicitação de crédito.' });
    }
  });

  app.get('/api/raffles', optionalAuth, async (_req, res) => {
    try {
      const raffles = await listPartnerRaffles(true);
      res.json({ raffles });
    } catch (error) {
      console.error('Error in GET /api/raffles:', error);
      res.status(500).json({ error: 'Falha ao carregar sorteios parceiros.' });
    }
  });

  // =========================================================
  // AGENDA & BLOQUEIO ANTI-CONFLITO
  // =========================================================
  app.get('/api/schedule/availability', optionalAuth, async (req, res) => {
    try {
      const dateStr =
        typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date.trim())
          ? req.query.date.trim()
          : formatSpDate(new Date());
      const durationMin = Math.max(1, Math.round(Number(req.query.durationMin) || 20));
      const category = req.query.category === 'roundtrip' ? 'roundtrip' : 'exec';
      const isRoundTrip = category === 'roundtrip';
      const roundTripMode =
        isRoundTrip && req.query.roundTripMode === 'scheduled_return'
          ? 'scheduled_return'
          : 'continuous';
      const waitTimeMin =
        isRoundTrip && roundTripMode === 'continuous'
          ? Math.max(0, Math.min(720, Math.round(Number(req.query.waitTimeMin) || 0)))
          : 0;
      const returnDate =
        typeof req.query.returnDate === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(req.query.returnDate.trim())
          ? req.query.returnDate.trim()
          : dateStr;
      const returnTime =
        typeof req.query.returnTime === 'string' && /^\d{2}:\d{2}$/.test(req.query.returnTime.trim())
          ? req.query.returnTime.trim()
          : '';
      const selectedTime =
        typeof req.query.selectedTime === 'string' &&
        /^\d{2}:\d{2}$/.test(req.query.selectedTime.trim())
          ? req.query.selectedTime.trim()
          : '';

      const [settings, busyWindows] = await Promise.all([
        getGlobalSettings(),
        getActiveBusyWindows(),
      ]);
      const safetyMarginMin = Number(settings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN);

      const candidateTimes: string[] = [];
      for (let h = 6; h <= 23; h += 1) {
        candidateTimes.push(`${String(h).padStart(2, '0')}:00`);
        candidateTimes.push(`${String(h).padStart(2, '0')}:30`);
      }

      const findConflictWindow = (startDate: Date, endDate: Date) => {
        const sMs = startDate.getTime();
        const eMs = endDate.getTime();
        for (const w of busyWindows) {
          const wStartMs = Date.parse(w.startTimeIso);
          const wEndMs = Date.parse(w.endTimeIso);
          if (intervalsOverlap(sMs, eMs, wStartMs, wEndMs)) {
            return w;
          }
        }
        return null;
      };

      const sampleOcc = computeOccupancyWindows({
        scheduledDate: dateStr,
        scheduledTime: selectedTime || '09:00',
        durationMin,
        isRoundTrip,
        safetyMarginMin,
        roundTripMode,
        waitTimeMin,
        returnDate,
        returnTime: returnTime || undefined,
      });

      const slots = candidateTimes.map((time) => {
        const occ = computeOccupancyWindows({
          scheduledDate: dateStr,
          scheduledTime: time,
          durationMin,
          isRoundTrip,
          safetyMarginMin,
          roundTripMode,
          waitTimeMin,
        });
        const conflict = findConflictWindow(occ.outboundStart, occ.outboundEnd);
        return {
          time,
          occupied: Boolean(conflict),
          conflictWindowLabel: conflict ? `${conflict.startLabel} às ${conflict.endLabel}` : undefined,
          windowStartLabel: formatSpTime(occ.outboundStart),
          windowEndLabel: formatSpTime(occ.outboundEnd),
        };
      });

      let selectedConflict = null;
      let returnConflict = null;

      if (selectedTime) {
        const occ = computeOccupancyWindows({
          scheduledDate: dateStr,
          scheduledTime: selectedTime,
          durationMin,
          isRoundTrip,
          safetyMarginMin,
          roundTripMode,
          waitTimeMin,
          returnDate,
          returnTime: returnTime || undefined,
        });

        selectedConflict = findConflictWindow(occ.outboundStart, occ.outboundEnd);

        if (isRoundTrip && roundTripMode === 'scheduled_return' && returnTime) {
          const retStart = occ.returnStart || parseSpDateTime(returnDate, returnTime);
          const retEnd = occ.returnEnd || addMinutes(retStart, durationMin + safetyMarginMin);

          if (retStart.getTime() < occ.outboundEnd.getTime()) {
            returnConflict = {
              sourceType: 'ride' as const,
              referenceCode: 'IDA',
              startTimeIso: occ.outboundStart.toISOString(),
              endTimeIso: occ.outboundEnd.toISOString(),
              startLabel: formatSpTime(occ.outboundStart),
              endLabel: formatSpTime(occ.outboundEnd),
              date: dateStr,
              reason: `Retorno deve ser após o término da ida (${formatSpTime(occ.outboundEnd)})`,
            };
          } else {
            returnConflict = findConflictWindow(retStart, retEnd);
          }
        }
      }

      res.json({
        date: dateStr,
        safetyMarginMin,
        outboundOccupiedMin: sampleOcc.outboundMinutes,
        returnOccupiedMin: sampleOcc.returnMinutes,
        busyWindows: busyWindows.filter((w) => w.date === dateStr),
        slots,
        selectedConflict,
        returnConflict,
      });
    } catch (error) {
      console.error('Error in GET /api/schedule/availability:', error);
      res.status(500).json({ error: 'Erro ao verificar disponibilidade da agenda.' });
    }
  });

  // =========================================================
  // RIDES & SERVER-AUTHORITATIVE PRICING (>= R$ 3,00 / km)
  // =========================================================
  app.get('/api/rides', requireAuth, async (req: AuthRequest, res) => {
    try {
      const list = req.isAdminUser
        ? await listAllRides()
        : await listRidesForUser(req.user!.uid);
      res.json({ rides: list });
    } catch (error) {
      console.error('Error in GET /api/rides:', error);
      res.status(500).json({ error: 'Não foi possível carregar o histórico de corridas.' });
    }
  });

  app.post('/api/rides', requireAuth, async (req: AuthRequest, res) => {
    try {
      const body = req.body || {};
      const uid = req.user!.uid;
      const userRecord = await getUserByUid(uid);
      const settings = await getGlobalSettings();

      const originLat = Number(body.originLat);
      const originLng = Number(body.originLng);
      const destinationLat = Number(body.destinationLat);
      const destinationLng = Number(body.destinationLng);
      const rawDistanceKm = Number(body.distanceKm);
      const durationMin = Math.max(1, Math.round(Number(body.durationMin) || 15));

      if (
        !Number.isFinite(originLat) ||
        !Number.isFinite(originLng) ||
        !Number.isFinite(destinationLat) ||
        !Number.isFinite(destinationLng) ||
        !Number.isFinite(rawDistanceKm) ||
        rawDistanceKm <= 0 ||
        rawDistanceKm > 3000
      ) {
        return res.status(400).json({ error: 'Coordenadas ou distância da rota inválidas.' });
      }

      const category = body.category === 'roundtrip' ? 'roundtrip' : 'exec';
      const isRoundTrip = Boolean(body.isRoundTrip || category === 'roundtrip');

      const requestedRecurrence = String(body.recurrenceFrequency || 'none');
      const recurrenceFrequency =
        requestedRecurrence === 'daily' ||
        requestedRecurrence === 'weekly' ||
        requestedRecurrence === 'monthly'
          ? requestedRecurrence
          : 'none';

      if (recurrenceFrequency !== 'none' && !userRecord?.vipActive) {
        return res.status(403).json({
          error: 'Agendamento recorrente é exclusivo para assinantes do Clube VIP (R$ 12,90/mês).',
        });
      }

      const preferences =
        userRecord?.vipActive && typeof body.preferences === 'string'
          ? body.preferences.trim().slice(0, 300)
          : '';

      const ratePerKmRaw = isRoundTrip ? settings.roundTripKm : settings.execKm;
      const safeRatePerKm = Math.max(MIN_KM_RATE, ratePerKmRaw);

      const effectiveKm = isRoundTrip ? rawDistanceKm * 2 : rawDistanceKm;
      const baseGross = effectiveKm * safeRatePerKm;
      const roundTripDiscount = isRoundTrip ? baseGross * 0.1 : 0;
      const subtotalAfterTrip = baseGross - roundTripDiscount;
      const tierDiscount = subtotalAfterTrip * getTierDiscountPct(userRecord?.points || 0);

      let voucherDiscount = 0;
      let validVoucherCode: string | undefined;
      if (typeof body.voucherCode === 'string' && body.voucherCode.trim()) {
        const userVouchers = await listUserVouchers(uid);
        const match = userVouchers.find(
          (v) => v.voucherCode === body.voucherCode.trim() && !v.used
        );
        if (match) {
          voucherDiscount = Number(match.discountValue) || 0;
          validVoucherCode = match.voucherCode;
        }
      }

      // Direct VIP Points redemption (100 pts = R$ 5,00)
      let pointsRedeemed = 0;
      let pointsDiscount = 0;
      const requestedPoints = Math.max(0, Math.floor(Number(body.pointsRedeemed) || 0));
      if (requestedPoints > 0) {
        if (!userRecord?.vipActive) {
          return res.status(403).json({
            error: 'Uso direto de pontos na cotação é exclusivo para assinantes Clube VIP (R$ 12,90/mês).',
          });
        }
        const blocks = Math.floor(Math.min(requestedPoints, userRecord.points) / 100);
        const subtotalBeforePoints = Math.max(settings.minFare, subtotalAfterTrip - tierDiscount - voucherDiscount);
        const maxRedeemableDiscount = Math.max(0, subtotalBeforePoints - settings.minFare);
        const maxUsefulBlocks = Math.floor(maxRedeemableDiscount / 5);
        const finalBlocks = Math.min(blocks, maxUsefulBlocks);
        if (finalBlocks > 0) {
          pointsRedeemed = finalBlocks * 100;
          pointsDiscount = finalBlocks * 5;
        }
      }

      const farePrice = Number(
        Math.max(
          settings.minFare,
          subtotalAfterTrip - tierDiscount - voucherDiscount - pointsDiscount
        ).toFixed(2)
      );
      const pendingPenalty = Number(userRecord?.pendingPenalty || 0);
      const penaltyIncluded = pendingPenalty > 0 ? Number(pendingPenalty.toFixed(2)) : 0;
      const totalToPay = Number((farePrice + penaltyIncluded).toFixed(2));

      const currentWalletBalance = Number(userRecord?.walletBalance || 0);
      const useWalletBalance = body.useWalletBalance !== false;
      const walletDeducted =
        useWalletBalance && currentWalletBalance > 0
          ? Number(Math.min(currentWalletBalance, totalToPay).toFixed(2))
          : 0;
      const remainingDue = Number(Math.max(0, totalToPay - walletDeducted).toFixed(2));
      const secondaryPaymentMethod =
        body.secondaryPaymentMethod === 'Cartão Presencial' ? 'Cartão Presencial' : 'Pix';

      let paymentMethod = secondaryPaymentMethod;
      let paymentStatus =
        secondaryPaymentMethod === 'Cartão Presencial'
          ? 'Pagamento presencial na maquininha'
          : 'Aguardando pagamento via Pix';

      if (remainingDue <= 0) {
        paymentMethod = 'Carteira';
        paymentStatus = 'Pago via Carteira (Saldo)';
      } else if (walletDeducted > 0) {
        paymentMethod = `Carteira + ${secondaryPaymentMethod}`;
        paymentStatus =
          secondaryPaymentMethod === 'Cartão Presencial'
            ? 'Saldo abatido + Cartão na maquininha'
            : 'Saldo abatido + Restante via Pix';
      }

      const pointsEarned = userRecord?.vipActive
        ? Math.max(30, Math.round(farePrice * 2))
        : Math.max(20, Math.round(farePrice));

      const rideCode =
        typeof body.rideCode === 'string' && /^[a-zA-Z0-9_-]{4,64}$/.test(body.rideCode)
          ? body.rideCode
          : `GR-${Date.now().toString(36).toUpperCase()}`;

      const scheduledDate = String(body.scheduledDate || formatSpDate(new Date())).trim();
      const scheduledTime = String(body.scheduledTime || '09:00').trim().slice(0, 5);
      const roundTripMode =
        isRoundTrip && body.roundTripMode === 'scheduled_return'
          ? 'scheduled_return'
          : 'continuous';
      const waitTimeMin =
        isRoundTrip && roundTripMode === 'continuous'
          ? Math.max(0, Math.min(720, Math.round(Number(body.waitTimeMin) || 0)))
          : 0;
      const returnDate =
        isRoundTrip && roundTripMode === 'scheduled_return'
          ? String(body.returnDate || scheduledDate).trim()
          : '';
      const returnTime =
        isRoundTrip && roundTripMode === 'scheduled_return'
          ? String(body.returnTime || '').trim().slice(0, 5)
          : '';

      if (isRoundTrip && roundTripMode === 'scheduled_return' && !/^\d{2}:\d{2}$/.test(returnTime)) {
        return res.status(400).json({
          error: 'Informe o horário específico de retorno para viagem Ida e Volta.',
        });
      }

      const safetyMarginMin = Number(settings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN);
      const occupancy = computeOccupancyWindows({
        scheduledDate,
        scheduledTime,
        durationMin,
        isRoundTrip,
        safetyMarginMin,
        roundTripMode,
        waitTimeMin,
        returnDate: returnDate || undefined,
        returnTime: returnTime || undefined,
      });

      if (
        occupancy.returnStart &&
        occupancy.returnStart.getTime() < occupancy.outboundEnd.getTime()
      ) {
        return res.status(400).json({
          error: `O horário específico de retorno (${formatSpTime(
            occupancy.returnStart
          )}) não pode ser anterior ao término da viagem de ida (${formatSpTime(
            occupancy.outboundEnd
          )}).`,
        });
      }

      const created = await createRideRecord({
        rideCode,
        userId: uid,
        clientName: String(body.clientName || userRecord?.name || req.user!.name || 'Passageiro VIP').trim(),
        clientEmail: String(req.user!.email || ''),
        clientPhone: String(body.clientPhone || userRecord?.phone || '').trim(),
        originName: String(body.originName || 'Ponto de Embarque').trim(),
        originAddress: String(body.originAddress || '').trim(),
        originLat,
        originLng,
        destinationName: String(body.destinationName || 'Destino').trim(),
        destinationAddress: String(body.destinationAddress || '').trim(),
        destinationLat,
        destinationLng,
        distanceKm: Number(rawDistanceKm.toFixed(2)),
        durationMin,
        totalOccupiedMin: occupancy.totalOccupiedMin,
        safetyMarginMin: occupancy.safetyMarginMin,
        roundTripMode: occupancy.roundTripMode,
        waitTimeMin: occupancy.waitTimeMin,
        returnDate,
        returnTime,
        startTime: occupancy.outboundStart,
        endTime: occupancy.outboundEnd,
        returnStartTime: occupancy.returnStart,
        returnEndTime: occupancy.returnEnd,
        category,
        isRoundTrip,
        recurrenceFrequency,
        preferences,
        scheduledDate,
        scheduledTime,
        price: totalToPay,
        paymentMethod,
        paymentStatus,
        walletDeducted,
        remainingDue,
        penaltyIncluded,
        pointsEarned,
        pointsRedeemed,
        notes: String(body.notes || '').trim(),
        voucherCode: validVoucherCode,
      });

      const refreshedPassenger = await getUserByUid(uid);
      const whatsappDispatch = await dispatchWhatsAppConfirmation(created, settings, {
        vipActive: Boolean(refreshedPassenger?.vipActive || userRecord?.vipActive),
      });

      res.status(201).json({
        ride: created,
        updatedUser: refreshedPassenger
          ? serializeUserProfile(refreshedPassenger, Boolean(req.isAdminUser))
          : undefined,
        updatedUserPoints: refreshedPassenger?.points,
        pricingAudit: {
          safeRatePerKm,
          roundTripDiscount: Number(roundTripDiscount.toFixed(2)),
          tierDiscount: Number(tierDiscount.toFixed(2)),
          voucherDiscount,
          pointsRedeemed,
          pointsDiscount,
          farePrice,
          penaltyIncluded,
          finalPrice: totalToPay,
          walletDeducted,
          remainingDue,
          paymentMethod,
          paymentStatus,
        },
        whatsappDispatch,
      });
    } catch (error) {
      if (error instanceof ScheduleConflictError) {
        return res.status(409).json({ error: error.message });
      }
      console.error('Error in POST /api/rides:', error);
      res.status(500).json({ error: 'Erro ao confirmar agendamento no servidor.' });
    }
  });

  app.post('/api/whatsapp/dispatch', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rideCode = String(req.body?.rideCode || '').trim();
      if (!rideCode) {
        return res.status(400).json({ error: 'Código da corrida obrigatório.' });
      }
      const userRides = req.isAdminUser
        ? await listAllRides()
        : await listRidesForUser(req.user!.uid);
      const ride = userRides.find((r) => r.rideCode === rideCode);
      if (!ride) {
        return res.status(404).json({ error: 'Corrida não encontrada ou sem permissão.' });
      }
      const [settings, rideUser] = await Promise.all([
        getGlobalSettings(),
        getUserByUid(ride.userId),
      ]);
      const whatsappDispatch = await dispatchWhatsAppConfirmation(ride, settings, {
        vipActive: Boolean(rideUser?.vipActive),
      });
      res.json({ whatsappDispatch });
    } catch (error) {
      console.error('Error in POST /api/whatsapp/dispatch:', error);
      res.status(500).json({ error: 'Falha ao disparar confirmação via WhatsApp.' });
    }
  });

  app.patch('/api/rides/:rideCode/status', requireAuth, async (req: AuthRequest, res) => {
    try {
      const { rideCode } = req.params;
      const { status } = req.body || {};
      const validStatuses = ['Confirmado', 'Em Andamento', 'Concluído', 'Cancelado'];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Status de corrida inválido.' });
      }

      if (!req.isAdminUser) {
        const userRides = await listRidesForUser(req.user!.uid);
        const owned = userRides.find((r) => r.rideCode === rideCode);
        if (!owned) {
          return res.status(403).json({ error: 'Sem permissão para alterar esta corrida.' });
        }
        if (status !== 'Cancelado' || owned.status === 'Concluído') {
          return res.status(403).json({
            error: 'Passageiros só podem cancelar corridas ainda não concluídas.',
          });
        }
      }

      const result = await updateRideStatusRecord(rideCode, status, {
        applyLateCancelPenaltyIfNeeded: !req.isAdminUser && status === 'Cancelado',
      });
      if (!result) {
        return res.status(404).json({ error: 'Corrida não encontrada.' });
      }

      const refreshedUser = await getUserByUid(result.ride.userId);
      res.json({
        ride: result.ride,
        updatedUser: refreshedUser
          ? serializeUserProfile(
              refreshedUser,
              Boolean(req.isAdminUser && refreshedUser.uid === req.user?.uid)
            )
          : undefined,
        updatedUserPoints: refreshedUser?.points,
        penaltyCharged: result.penaltyCharged,
        penaltyMode: result.penaltyMode,
        lateCancelPenaltyAmount: LATE_CANCEL_PENALTY,
      });
    } catch (error) {
      console.error('Error in PATCH /api/rides/:rideCode/status:', error);
      res.status(500).json({ error: 'Falha ao atualizar status da corrida.' });
    }
  });

  // =========================================================
  // VOUCHERS & CLUBE VIP
  // =========================================================
  app.get('/api/vouchers', requireAuth, async (req: AuthRequest, res) => {
    try {
      const vouchers = await listUserVouchers(req.user!.uid);
      res.json({ vouchers });
    } catch (error) {
      console.error('Error in GET /api/vouchers:', error);
      res.status(500).json({ error: 'Erro ao consultar benefícios VIP.' });
    }
  });

  app.post('/api/vouchers/redeem', requireAuth, async (req: AuthRequest, res) => {
    try {
      const rewardId = String(req.body?.rewardId || '');
      const reward = REWARDS_CATALOG[rewardId];
      if (!reward) {
        return res.status(400).json({ error: 'Recompensa VIP não reconhecida.' });
      }

      const voucherCode = `VIP-${Date.now().toString(36).toUpperCase()}`;
      const result = await redeemVoucherForUser({
        uid: req.user!.uid,
        voucherCode,
        title: reward.title,
        discountValue: reward.discountValue,
        pointsCost: reward.pointsCost,
      });

      res.status(201).json({
        voucher: result.voucher,
        points: result.user.points,
        tier: computeVipTier(result.user.points),
      });
    } catch (error: any) {
      const msg = error?.message || 'Erro ao resgatar benefício.';
      res.status(msg.includes('insuficientes') ? 400 : 500).json({ error: msg });
    }
  });

  // =========================================================
  // CREATOR / DRIVER MASTER DASHBOARD (ADMIN ONLY)
  // =========================================================
  app.get('/api/admin/dashboard', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const period = String(req.query.period || 'all');
      const [allRides, allExpenses, settings, scheduleBlocks] = await Promise.all([
        listAllRides(),
        listAllExpenses(),
        getGlobalSettings(),
        listScheduleBlocks(),
      ]);

      const todayStr = new Date().toISOString().split('T')[0];
      const monthPrefix = todayStr.slice(0, 7);

      const matchesPeriod = (dateStr: string) => {
        if (period === 'today') return dateStr === todayStr;
        if (period === 'month') return dateStr.startsWith(monthPrefix);
        return true;
      };

      const filteredRides = allRides.filter((r) => matchesPeriod(r.scheduledDate));
      const filteredExpenses = allExpenses.filter((e) => matchesPeriod(e.expenseDate));

      const completedRides = filteredRides.filter((r) => r.status === 'Concluído');
      const activeRides = filteredRides.filter(
        (r) => r.status === 'Confirmado' || r.status === 'Em Andamento'
      );
      const canceledRides = filteredRides.filter((r) => r.status === 'Cancelado');

      const completedEarnings = completedRides.reduce((acc, r) => acc + Number(r.price || 0), 0);
      const scheduledRevenue = activeRides.reduce((acc, r) => acc + Number(r.price || 0), 0);
      const totalExpenses = filteredExpenses.reduce((acc, e) => acc + Number(e.amount || 0), 0);
      const netProfit = completedEarnings - totalExpenses;
      const profitMarginPct =
        completedEarnings > 0 ? Number(((netProfit / completedEarnings) * 100).toFixed(1)) : 0;
      const totalDistanceKm = filteredRides
        .filter((r) => r.status !== 'Cancelado')
        .reduce((acc, r) => acc + Number(r.distanceKm || 0) * (r.isRoundTrip ? 2 : 1), 0);
      const avgTicket =
        completedRides.length > 0 ? completedEarnings / completedRides.length : 0;

      const expensesByCategory: Record<string, number> = {};
      for (const exp of filteredExpenses) {
        expensesByCategory[exp.category] =
          (expensesByCategory[exp.category] || 0) + Number(exp.amount || 0);
      }

      const { effectiveCostPerKm, priceAlerts, rideMargins } = evaluateRidePriceAlerts(
        filteredRides,
        filteredExpenses,
        settings
      );

      res.json({
        summary: {
          totalRides: filteredRides.length,
          completedRidesCount: completedRides.length,
          activeOrScheduledCount: activeRides.length,
          canceledRidesCount: canceledRides.length,
          completedEarnings: Number(completedEarnings.toFixed(2)),
          scheduledRevenue: Number(scheduledRevenue.toFixed(2)),
          totalExpenses: Number(totalExpenses.toFixed(2)),
          netProfit: Number(netProfit.toFixed(2)),
          profitMarginPct,
          totalDistanceKm: Number(totalDistanceKm.toFixed(1)),
          avgTicket: Number(avgTicket.toFixed(2)),
          effectiveCostPerKm,
          priceAlertCount: priceAlerts.length,
          expensesByCategory,
        },
        rides: filteredRides,
        expenses: filteredExpenses,
        scheduleBlocks,
        priceAlerts,
        rideMargins,
        settings,
      });
    } catch (error) {
      console.error('Error in GET /api/admin/dashboard:', error);
      res.status(500).json({ error: 'Falha ao carregar métricas do painel do motorista.' });
    }
  });

  app.get('/api/admin/expenses', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const expenses = await listAllExpenses();
      res.json({ expenses });
    } catch (error) {
      console.error('Error in GET /api/admin/expenses:', error);
      res.status(500).json({ error: 'Falha ao listar despesas.' });
    }
  });

  app.post('/api/admin/expenses', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const { category, description, amount, expenseDate, odometerKm } = req.body || {};
      const parsedAmount = Number(amount);
      if (!category || !description || !Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Informe categoria, descrição e valor positivo.' });
      }

      const created = await createExpenseRecord({
        adminUid: req.user!.uid,
        category: String(category).trim(),
        description: String(description).trim(),
        amount: parsedAmount,
        expenseDate: String(expenseDate || new Date().toISOString().split('T')[0]),
        odometerKm: odometerKm ? Math.max(0, Math.round(Number(odometerKm))) : null,
      });

      res.status(201).json({ expense: created });
    } catch (error) {
      console.error('Error in POST /api/admin/expenses:', error);
      res.status(500).json({ error: 'Falha ao cadastrar despesa.' });
    }
  });

  app.delete('/api/admin/expenses/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de despesa inválido.' });
      }
      const deleted = await deleteExpenseRecord(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Despesa não encontrada.' });
      }
      res.json({ deleted });
    } catch (error) {
      console.error('Error in DELETE /api/admin/expenses/:id:', error);
      res.status(500).json({ error: 'Falha ao remover despesa.' });
    }
  });

  app.put('/api/admin/settings', requireAuth, requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const updated = await updateGlobalSettings({
        standardKm: Number(body.standardKm),
        execKm: Number(body.execKm),
        roundTripKm: Number(body.roundTripKm),
        minFare: Number(body.minFare),
        estimatedCostPerKm: Number(body.estimatedCostPerKm),
        minMarginPct: Number(body.minMarginPct),
        maxMarginPct: Number(body.maxMarginPct),
        safetyMarginMin:
          body.safetyMarginMin !== undefined ? Number(body.safetyMarginMin) : undefined,
        pixKey: String(body.pixKey || OFFICIAL_PIX_KEY),
        whatsapp: String(body.whatsapp || DEFAULT_DRIVER_WHATSAPP),
      });
      res.json({ settings: updated });
    } catch (error) {
      console.error('Error in PUT /api/admin/settings:', error);
      res.status(500).json({ error: 'Falha ao salvar tarifas e configurações.' });
    }
  });

  // =========================================================
  // ADMIN: BLOQUEIOS MANUAIS DE HORÁRIO NA AGENDA
  // =========================================================
  app.get('/api/admin/schedule-blocks', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const scheduleBlocks = await listScheduleBlocks();
      res.json({ scheduleBlocks });
    } catch (error) {
      console.error('Error in GET /api/admin/schedule-blocks:', error);
      res.status(500).json({ error: 'Falha ao listar bloqueios de agenda.' });
    }
  });

  app.post('/api/admin/schedule-blocks', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
    try {
      const body = req.body || {};
      const blockDate = String(body.blockDate || '').trim();
      const startHhmm = String(body.startHhmm || '').trim().slice(0, 5);
      const endHhmm = String(body.endHhmm || '').trim().slice(0, 5);
      const reason = String(body.reason || 'Bloqueio manual do motorista').trim();

      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(blockDate) ||
        !/^\d{2}:\d{2}$/.test(startHhmm) ||
        !/^\d{2}:\d{2}$/.test(endHhmm)
      ) {
        return res.status(400).json({
          error: 'Informe data (AAAA-MM-DD), hora inicial e hora final válidas.',
        });
      }

      const startTime = parseSpDateTime(blockDate, startHhmm);
      const endTime = parseSpDateTime(blockDate, endHhmm);
      if (endTime.getTime() <= startTime.getTime()) {
        return res.status(400).json({
          error: 'O horário de término deve ser maior que o horário de início.',
        });
      }

      const block = await createScheduleBlockRecord({
        adminUid: req.user!.uid,
        blockDate,
        startTimeStr: startHhmm,
        endTimeStr: endHhmm,
        reason,
      });
      res.status(201).json({ block });
    } catch (error) {
      console.error('Error in POST /api/admin/schedule-blocks:', error);
      res.status(500).json({ error: 'Falha ao criar bloqueio manual de agenda.' });
    }
  });

  app.delete('/api/admin/schedule-blocks/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de bloqueio inválido.' });
      }
      const deleted = await deleteScheduleBlockRecord(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Bloqueio de agenda não encontrado.' });
      }
      res.json({ deleted });
    } catch (error) {
      console.error('Error in DELETE /api/admin/schedule-blocks/:id:', error);
      res.status(500).json({ error: 'Falha ao remover bloqueio manual de agenda.' });
    }
  });

  // =========================================================
  // ADMIN: RECARGAS, CARTEIRAS DOS CLIENTES & SOLICITAÇÕES VIP
  // =========================================================
  app.get('/api/admin/wallets', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const [topups, vipRequestsList, allUsers] = await Promise.all([
        listAllWalletTopups(),
        listVipPaymentRequests(),
        listAllUsersWallets(),
      ]);
      const clients = allUsers.map((u) => ({
        uid: u.uid,
        name: u.name,
        email: u.email,
        phone: u.phone || '',
        points: Number(u.points || 0),
        walletBalance: Number(u.walletBalance || 0),
        pendingPenalty: Number(u.pendingPenalty || 0),
        vipActive: Boolean(u.vipActive),
        vipSubscribedAt: u.vipSubscribedAt ? new Date(u.vipSubscribedAt).toISOString() : null,
      }));
      res.json({ topups, vipRequests: vipRequestsList, clients });
    } catch (error) {
      console.error('Error in GET /api/admin/wallets:', error);
      res.status(500).json({ error: 'Falha ao carregar carteiras e solicitações de recarga.' });
    }
  });

  app.post('/api/admin/wallets/topups/:id/review', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de solicitação inválido.' });
      }
      const approve = Boolean(req.body?.approve);
      const adminNotes = typeof req.body?.adminNotes === 'string' ? req.body.adminNotes : '';
      const result = await reviewWalletTopupRequest({ id, approve, adminNotes });
      if (!result) {
        return res.status(404).json({ error: 'Solicitação de recarga não encontrada.' });
      }
      res.json({
        topup: result.topup,
        updatedWalletBalance: result.user ? Number(result.user.walletBalance || 0) : undefined,
      });
    } catch (error: any) {
      const msg = error?.message || 'Erro ao revisar solicitação de recarga.';
      res.status(msg.includes('processada') ? 409 : 500).json({ error: msg });
    }
  });

  app.post('/api/admin/wallets/adjust', requireAuth, requireAdmin, async (req, res) => {
    try {
      const uid = String(req.body?.uid || '').trim();
      const deltaAmount = Number(req.body?.deltaAmount);
      const reason = String(req.body?.reason || '').trim();
      if (!uid || !Number.isFinite(deltaAmount) || deltaAmount === 0) {
        return res.status(400).json({ error: 'Informe cliente e valor válido (diferente de zero).' });
      }
      const updated = await adjustUserWalletBalance({ uid, deltaAmount, reason });
      if (!updated) {
        return res.status(404).json({ error: 'Cliente não encontrado.' });
      }
      res.json({
        client: {
          uid: updated.uid,
          walletBalance: Number(updated.walletBalance || 0),
          pendingPenalty: Number(updated.pendingPenalty || 0),
        },
      });
    } catch (error) {
      console.error('Error in POST /api/admin/wallets/adjust:', error);
      res.status(500).json({ error: 'Erro ao ajustar saldo do cliente.' });
    }
  });

  app.post('/api/admin/wallets/settle-penalty', requireAuth, requireAdmin, async (req, res) => {
    try {
      const uid = String(req.body?.uid || '').trim();
      if (!uid) {
        return res.status(400).json({ error: 'UID do cliente obrigatório.' });
      }
      const updated = await settleUserPendingPenalty(uid);
      if (!updated) {
        return res.status(404).json({ error: 'Cliente não encontrado.' });
      }
      res.json({
        client: {
          uid: updated.uid,
          walletBalance: Number(updated.walletBalance || 0),
          pendingPenalty: Number(updated.pendingPenalty || 0),
        },
      });
    } catch (error) {
      console.error('Error in POST /api/admin/wallets/settle-penalty:', error);
      res.status(500).json({ error: 'Erro ao quitar pendência de multa.' });
    }
  });

  app.post('/api/admin/vip-requests/:id/review', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de solicitação VIP inválido.' });
      }
      const approve = Boolean(req.body?.approve);
      const result = await reviewVipPaymentRequest(id, approve);
      if (!result) {
        return res.status(404).json({ error: 'Solicitação VIP não encontrada.' });
      }
      res.json(result);
    } catch (error) {
      console.error('Error in POST /api/admin/vip-requests/:id/review:', error);
      res.status(500).json({ error: 'Falha ao processar solicitação Clube VIP.' });
    }
  });

  app.patch('/api/admin/users/:uid/vip', requireAuth, requireAdmin, async (req, res) => {
    try {
      const uid = String(req.params.uid || '').trim();
      const vipActive = Boolean(req.body?.vipActive);
      const updated = await updateUserVipSubscription({ uid, vipActive });
      if (!updated) {
        return res.status(404).json({ error: 'Cliente não encontrado.' });
      }
      res.json({
        client: {
          uid: updated.uid,
          vipActive: Boolean(updated.vipActive),
          vipSubscribedAt: updated.vipSubscribedAt ? new Date(updated.vipSubscribedAt).toISOString() : null,
        },
      });
    } catch (error) {
      console.error('Error in PATCH /api/admin/users/:uid/vip:', error);
      res.status(500).json({ error: 'Falha ao alterar status VIP do cliente.' });
    }
  });

  app.get('/api/admin/raffles', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const raffles = await listPartnerRaffles(false);
      res.json({ raffles });
    } catch (error) {
      console.error('Error in GET /api/admin/raffles:', error);
      res.status(500).json({ error: 'Falha ao listar lojas parceiras e sorteios.' });
    }
  });

  app.post('/api/admin/raffles', requireAuth, requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const partnerName = String(body.partnerName || '').trim();
      const prizeTitle = String(body.prizeTitle || '').trim();
      const drawDate = String(body.drawDate || '').trim();
      if (partnerName.length < 2 || prizeTitle.length < 2 || drawDate.length < 8) {
        return res.status(400).json({
          error: 'Informe nome da loja parceira, prêmio e data do sorteio.',
        });
      }
      const created = await createPartnerRaffleRecord({
        partnerName,
        partnerLogoUrl: String(body.partnerLogoUrl || '').trim(),
        prizeTitle,
        prizeDescription: String(body.prizeDescription || '').trim(),
        drawDate,
        active: body.active !== false,
      });
      res.status(201).json({ raffle: created });
    } catch (error) {
      console.error('Error in POST /api/admin/raffles:', error);
      res.status(500).json({ error: 'Falha ao cadastrar sorteio parceiro.' });
    }
  });

  app.patch('/api/admin/raffles/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de sorteio inválido.' });
      }
      const updated = await togglePartnerRaffleRecord(id, Boolean(req.body?.active));
      if (!updated) {
        return res.status(404).json({ error: 'Sorteio não encontrado.' });
      }
      res.json({ raffle: updated });
    } catch (error) {
      console.error('Error in PATCH /api/admin/raffles/:id:', error);
      res.status(500).json({ error: 'Falha ao atualizar status do sorteio.' });
    }
  });

  app.delete('/api/admin/raffles/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: 'ID de sorteio inválido.' });
      }
      const deleted = await deletePartnerRaffleRecord(id);
      if (!deleted) {
        return res.status(404).json({ error: 'Sorteio não encontrado.' });
      }
      res.json({ deleted });
    } catch (error) {
      console.error('Error in DELETE /api/admin/raffles/:id:', error);
      res.status(500).json({ error: 'Falha ao remover sorteio parceiro.' });
    }
  });

  // =========================================================
  // GOOGLE MAPS PLATFORM SERVER PROXIES (CORS-SAFE)
  // =========================================================
  app.post('/api/maps/route', async (req, res) => {
    const originLat = Number(req.body?.originLat);
    const originLng = Number(req.body?.originLng);
    const destinationLat = Number(req.body?.destinationLat);
    const destinationLng = Number(req.body?.destinationLng);

    if (
      !Number.isFinite(originLat) ||
      !Number.isFinite(originLng) ||
      !Number.isFinite(destinationLat) ||
      !Number.isFinite(destinationLng)
    ) {
      return res.status(400).json({ error: 'Coordenadas inválidas para cálculo de rota.' });
    }

    const apiKey = getMapsServerKey();
    if (apiKey) {
      try {
        const routesResp = await fetch(
          'https://routes.googleapis.com/directions/v2:computeRoutes',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Goog-Api-Key': apiKey,
              'X-Goog-FieldMask':
                'routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline',
            },
            body: JSON.stringify({
              origin: { location: { latLng: { latitude: originLat, longitude: originLng } } },
              destination: {
                location: { latLng: { latitude: destinationLat, longitude: destinationLng } },
              },
              travelMode: 'DRIVE',
              routingPreference: 'TRAFFIC_AWARE_OPTIMAL',
              languageCode: 'pt-BR',
              units: 'METRIC',
            }),
          }
        );

        if (routesResp.ok) {
          const data: any = await routesResp.json();
          const route = data?.routes?.[0];
          if (route) {
            const rawMeters = Number(route.distanceMeters);
            const safeMeters = Number.isFinite(rawMeters) && rawMeters > 0 ? rawMeters : 500;
            const distanceKm = Math.max(0.5, Number((safeMeters / 1000).toFixed(2)));
            const liveSec = parseInt(String(route.duration || '900s').replace('s', ''), 10) || 900;
            const staticSec =
              parseInt(String(route.staticDuration || `${liveSec}s`).replace('s', ''), 10) ||
              liveSec;
            const durationInTrafficMin = Math.max(1, Math.round(liveSec / 60));
            const durationMin = Math.max(1, Math.round(staticSec / 60));
            const encodedPolyline = route.polyline?.encodedPolyline || '';
            const coords = encodedPolyline
              ? decodeEncodedPolyline(encodedPolyline)
              : [
                  [originLat, originLng] as [number, number],
                  [destinationLat, destinationLng] as [number, number],
                ];

            return res.json({
              distanceKm,
              durationMin,
              durationInTrafficMin,
              trafficDeltaMin: Math.max(0, durationInTrafficMin - durationMin),
              coords,
              encodedPolyline,
              source: 'routes-api-v2',
            });
          }
        }
      } catch (err) {
        console.warn('Routes API v2 unavailable, using OSRM fallback:', err);
      }
    }

    // Fallback 1: OSRM public router
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${originLng},${originLat};${destinationLng},${destinationLat}?overview=full&geometries=geojson`;
      const osrmResp = await fetch(osrmUrl);
      if (osrmResp.ok) {
        const osrmData: any = await osrmResp.json();
        const route = osrmData?.routes?.[0];
        if (route) {
          const rawDist = Number(route.distance);
          const safeDist = Number.isFinite(rawDist) && rawDist > 0 ? rawDist : 500;
          const rawDur = Number(route.duration);
          const distanceKm = Math.max(0.5, Number((safeDist / 1000).toFixed(2)));
          const durationMin = Math.max(1, Math.round((Number.isFinite(rawDur) && rawDur > 0 ? rawDur : 300) / 60));
          const coords: [number, number][] = (route.geometry?.coordinates || []).map(
            (c: [number, number]) => [c[1], c[0]]
          );
          return res.json({
            distanceKm,
            durationMin,
            durationInTrafficMin: durationMin,
            trafficDeltaMin: 0,
            coords:
              coords.length > 1
                ? coords
                : [
                    [originLat, originLng],
                    [destinationLat, destinationLng],
                  ],
            source: 'osrm',
          });
        }
      }
    } catch {
      // Fall through to Haversine estimate
    }

    // Fallback 2: Haversine road-factor estimate
    const straight = haversineKm(originLat, originLng, destinationLat, destinationLng);
    const distanceKm = Math.max(1.2, Number((straight * 1.28).toFixed(2)));
    const durationMin = Math.max(5, Math.round(distanceKm * 2.1));
    res.json({
      distanceKm,
      durationMin,
      durationInTrafficMin: durationMin,
      trafficDeltaMin: 0,
      coords: [
        [originLat, originLng],
        [destinationLat, destinationLng],
      ],
      source: 'haversine-estimate',
    });
  });

  app.post('/api/maps/places', async (req, res) => {
    const queryText = String(req.body?.query || '').trim();
    if (queryText.length < 2) {
      return res.json({ places: [] });
    }

    const latBias = Number(req.body?.lat) || -23.5505;
    const lngBias = Number(req.body?.lng) || -46.6333;
    const apiKey = getMapsServerKey();

    if (apiKey) {
      try {
        const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask':
              'places.id,places.displayName,places.formattedAddress,places.location',
          },
          body: JSON.stringify({
            textQuery: queryText,
            languageCode: 'pt-BR',
            regionCode: 'BR',
            locationBias: {
              circle: {
                center: { latitude: latBias, longitude: lngBias },
                radius: 50000.0,
              },
            },
            maxResultCount: 6,
          }),
        });

        if (resp.ok) {
          const data: any = await resp.json();
          const places = (data?.places || []).map((p: any) => ({
            placeId: p.id,
            name: p.displayName?.text || queryText,
            address: p.formattedAddress || 'São Paulo, SP',
            lat: p.location?.latitude,
            lng: p.location?.longitude,
          }));
          if (places.length > 0) {
            return res.json({ places, source: 'places-api-new' });
          }
        }
      } catch (err) {
        console.warn('Places API New unavailable, falling back to Nominatim:', err);
      }
    }

    try {
      const nomUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=6&countrycodes=br&q=${encodeURIComponent(
        queryText
      )}`;
      const nomResp = await fetch(nomUrl, {
        headers: { 'User-Agent': 'GustavoReisMobilidadeVIP/1.0' },
      });
      if (nomResp.ok) {
        const items: any[] = await nomResp.json();
        const places = items.map((item) => ({
          name: String(item.display_name || '').split(',')[0] || queryText,
          address: String(item.display_name || ''),
          lat: Number(item.lat),
          lng: Number(item.lon),
        }));
        return res.json({ places, source: 'nominatim' });
      }
    } catch {
      // Return empty list gracefully
    }

    res.json({ places: [], source: 'none' });
  });

  app.post('/api/maps/geocode', async (req, res) => {
    const lat = Number(req.body?.lat);
    const lng = Number(req.body?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(400).json({ error: 'Latitude e longitude inválidas.' });
    }

    const apiKey = getMapsServerKey();
    if (apiKey) {
      try {
        const resp = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=pt-BR&key=${encodeURIComponent(
            apiKey
          )}`
        );
        if (resp.ok) {
          const data: any = await resp.json();
          const first = data?.results?.[0];
          if (first) {
            return res.json({
              name: String(first.formatted_address || '').split(',')[0] || 'Local no Mapa',
              address: first.formatted_address,
              lat,
              lng,
            });
          }
        }
      } catch {
        // Fallback below
      }
    }

    try {
      const nomResp = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { 'User-Agent': 'GustavoReisMobilidadeVIP/1.0' } }
      );
      if (nomResp.ok) {
        const data: any = await nomResp.json();
        if (data?.display_name) {
          return res.json({
            name: String(data.display_name).split(',')[0] || 'Ponto Selecionado',
            address: data.display_name,
            lat,
            lng,
          });
        }
      }
    } catch {
      // Fallback
    }

    res.json({
      name: `Pin (${lat.toFixed(4)}, ${lng.toFixed(4)})`,
      address: `Coordenadas ${lat.toFixed(5)}, ${lng.toFixed(5)}`,
      lat,
      lng,
    });
  });

  app.get('/api/maps/static-preview', async (req, res) => {
    const lat = Number(req.query.lat) || -23.5614;
    const lng = Number(req.query.lng) || -46.6559;
    const apiKey = getMapsServerKey();
    if (!apiKey) {
      return res.status(404).end();
    }

    try {
      const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=14&size=600x260&scale=2&maptype=roadmap&markers=color:0x10B981%7C${lat},${lng}&key=${encodeURIComponent(
        apiKey
      )}`;
      const resp = await fetch(url);
      if (!resp.ok) return res.status(resp.status).end();
      const buffer = Buffer.from(await resp.arrayBuffer());
      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Cache-Control', 'public, max-age=3600');
      res.send(buffer);
    } catch {
      res.status(502).end();
    }
  });

  // =========================================================
  // GEMINI AI MULTI-TURN CONCIERGE + MAPS & SEARCH GROUNDING
  // (Uses free-tier Gemini models: gemini-4-hydrogen & gemini-3.1-flash-lite)
  // =========================================================
  app.post('/api/ai/chat', optionalAuth, async (req: AuthRequest, res) => {
    const ai = getGenAiClient();
    if (!ai) {
      return res.status(503).json({
        error: 'Chave GEMINI_API_KEY não configurada no servidor.',
      });
    }

    try {
      const message = String(req.body?.message || '').trim();
      if (!message) {
        return res.status(400).json({ error: 'Digite uma mensagem para o assistente.' });
      }

      const mode = String(req.body?.mode || 'concierge');
      const speed = req.body?.speed === 'fast' ? 'fast' : 'deep';
      const history = Array.isArray(req.body?.history) ? req.body.history.slice(-12) : [];

      const model = speed === 'fast' ? 'gemini-3.1-flash-lite' : 'gemini-4-hydrogen';

      let systemInstruction =
        'Você é o Concierge Executivo oficial da plataforma Gustavo Reis • Mobilidade Particular & Clube VIP em São Paulo. ' +
        'Responda sempre em português brasileiro claro, educado e objetivo. ' +
        'Regras de negócio: tarifa mínima garantida de R$ 3,00/km (Standard R$ 3,00/km, Executivo R$ 3,60/km, Bate & Volta R$ 3,00/km com 10% de desconto na viagem combinada), ' +
        'níveis Clube VIP (Bronze, Prata -5%, Ouro -10%, Black -15%), agendamento com PIX e confirmação por WhatsApp ou Google Agenda.';

      if (mode === 'finance') {
        if (!req.isAdminUser) {
          return res.status(403).json({
            error: 'O modo Analista Financeiro é exclusivo do administrador autenticado.',
          });
        }
        const [allRides, allExpenses, settings] = await Promise.all([
          listAllRides(),
          listAllExpenses(),
          getGlobalSettings(),
        ]);
        const completedTotal = allRides
          .filter((r) => r.status === 'Concluído')
          .reduce((acc, r) => acc + Number(r.price || 0), 0);
        const scheduledTotal = allRides
          .filter((r) => r.status === 'Confirmado' || r.status === 'Em Andamento')
          .reduce((acc, r) => acc + Number(r.price || 0), 0);
        const expensesTotal = allExpenses.reduce((acc, e) => acc + Number(e.amount || 0), 0);
        const netProfit = completedTotal - expensesTotal;

        systemInstruction =
          'Você é o Analista Financeiro e Estrategista de Frota do motorista Gustavo Reis. ' +
          'Analise receitas, gastos operacionais, margem de lucro líquido e agenda com precisão tabular e recomendações práticas em português. ' +
          `Dados reais atuais do PostgreSQL: Corridas registradas=${allRides.length}, Faturamento Concluído=R$ ${completedTotal.toFixed(
            2
          )}, Receita Agendada=R$ ${scheduledTotal.toFixed(
            2
          )}, Despesas Totais=R$ ${expensesTotal.toFixed(2)}, Lucro Líquido=R$ ${netProfit.toFixed(
            2
          )}, Tarifa Standard=R$ ${settings.standardKm.toFixed(
            2
          )}/km, Executiva=R$ ${settings.execKm.toFixed(2)}/km, Bandeirada Mínima=R$ ${settings.minFare.toFixed(2)}.`;
      }

      const formattedHistory = history
        .filter((h: any) => h && typeof h.text === 'string' && h.text.trim())
        .map((h: any) => ({
          role: h.role === 'assistant' || h.role === 'model' ? 'model' : 'user',
          parts: [{ text: String(h.text).slice(0, 4000) }],
        }));

      const config: Record<string, any> = {
        systemInstruction,
      };
      if (model === 'gemini-4-hydrogen') {
        config.thinkingConfig = {
          thinkingLevel: ThinkingLevel.HIGH,
        };
      }

      const chat = ai.chats.create({
        model,
        history: formattedHistory,
        config,
      });

      const response = await chat.sendMessage({ message });

      res.json({
        text: response.text || 'Não consegui formular uma resposta agora.',
        modelUsed: model,
        sources: [],
      });
    } catch (error) {
      console.error('Error in /api/ai/chat:', error);
      res.status(500).json({ error: 'Falha ao consultar o assistente Gemini.' });
    }
  });

  app.post('/api/ai/maps-grounding', optionalAuth, async (req, res) => {
    const ai = getGenAiClient();
    if (!ai) {
      return res.status(503).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
    }

    try {
      const prompt = String(req.body?.query || '').trim();
      const lat = Number(req.body?.lat) || -23.5614;
      const lng = Number(req.body?.lng) || -46.6559;
      if (!prompt) {
        return res.status(400).json({ error: 'Informe um local ou dúvida para consultar no Google Maps.' });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Em português do Brasil, responda usando dados reais do Google Maps para o passageiro executivo em São Paulo/Brasil: ${prompt}`,
        config: {
          tools: [{ googleMaps: {} }],
          toolConfig: {
            retrievalConfig: {
              latLng: { latitude: lat, longitude: lng },
            },
          },
        },
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = chunks
        .filter((c: any) => c.maps?.uri)
        .map((c: any) => ({
          type: 'maps' as const,
          title: c.maps.title || 'Local no Google Maps',
          uri: c.maps.uri,
          placeId: c.maps.placeId,
          snippet: c.maps.placeAnswerSources?.reviewSnippets?.[0]?.content || '',
        }));

      res.json({
        text: response.text || 'Resultados carregados do Google Maps.',
        modelUsed: 'gemini-4-hydrogen',
        sources,
      });
    } catch (error) {
      console.error('Error in /api/ai/maps-grounding:', error);
      res.status(500).json({ error: 'Erro ao consultar Google Maps Grounding.' });
    }
  });

  app.post('/api/ai/search-grounding', optionalAuth, async (req, res) => {
    const ai = getGenAiClient();
    if (!ai) {
      return res.status(503).json({ error: 'GEMINI_API_KEY não configurada no servidor.' });
    }

    try {
      const prompt = String(req.body?.query || '').trim();
      if (!prompt) {
        return res.status(400).json({ error: 'Informe sua pergunta para pesquisa na Web.' });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: `Responda em português brasileiro com dados atualizados da pesquisa web (voos, eventos, trânsito, clima ou notícias de mobilidade em SP): ${prompt}`,
        config: {
          tools: [{ googleSearch: {} }],
        },
      });

      const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
      const sources = chunks
        .filter((c: any) => c.web?.uri)
        .map((c: any) => ({
          type: 'web' as const,
          title: c.web.title || 'Fonte Web',
          uri: c.web.uri,
        }));

      res.json({
        text: response.text || 'Consulta concluída.',
        modelUsed: 'gemini-4-hydrogen',
        sources,
      });
    } catch (error) {
      console.error('Error in /api/ai/search-grounding:', error);
      res.status(500).json({ error: 'Erro ao consultar Google Search Grounding.' });
    }
  });

  // =========================================================
  // VITE / STATIC SERVING
  // =========================================================
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Gustavo Reis Mobilidade VIP server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});
