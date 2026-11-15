import { and, asc, desc, eq, ne, sql } from 'drizzle-orm';
import { db } from './index.ts';
import {
  appSettings,
  expenses,
  partnerRaffles,
  rides,
  scheduleBlocks,
  users,
  vipRequests,
  vouchers,
  walletTopups,
  walletTransactions,
} from './schema.ts';
import {
  DEFAULT_DRIVER_WHATSAPP,
  DEFAULT_SAFETY_MARGIN_MIN,
  OFFICIAL_PIX_KEY,
  computeOccupancyWindows,
  formatSpDate,
  formatSpTime,
  intervalsOverlap,
  parseSpDateTime,
} from '../utils/schedule.ts';
import { BusyTimeWindow } from '../types.ts';

export const MIN_KM_RATE = 3.0;
export const VIP_MONTHLY_PRICE = 12.9;
export const LATE_CANCEL_PENALTY = 15.0;
export { OFFICIAL_PIX_KEY, DEFAULT_DRIVER_WHATSAPP, DEFAULT_SAFETY_MARGIN_MIN };

export class ScheduleConflictError extends Error {
  conflictWindow: BusyTimeWindow;
  constructor(message: string, conflictWindow: BusyTimeWindow) {
    super(message);
    this.name = 'ScheduleConflictError';
    this.conflictWindow = conflictWindow;
  }
}

export async function getOrCreateUser(params: {
  uid: string;
  email: string;
  name?: string;
  phone?: string;
  photoUrl?: string;
  isAdmin?: boolean;
}) {
  try {
    const role = params.isAdmin ? 'admin' : 'client';
    const result = await db
      .insert(users)
      .values({
        uid: params.uid,
        email: params.email,
        name: params.name || params.email.split('@')[0] || 'Passageiro VIP',
        phone: params.phone || '',
        photoUrl: params.photoUrl || '',
        role,
        points: 100,
      })
      .onConflictDoUpdate({
        target: users.uid,
        set: {
          email: params.email,
          photoUrl: params.photoUrl || undefined,
          role: params.isAdmin ? 'admin' : 'client',
          updatedAt: new Date(),
        },
      })
      .returning();

    return result[0];
  } catch (error) {
    console.error('Database error in getOrCreateUser:', error);
    throw new Error('Falha ao sincronizar perfil de usuário.', { cause: error });
  }
}

export async function getUserByUid(uid: string) {
  try {
    const rows = await db.select().from(users).where(eq(users.uid, uid)).limit(1);
    return rows[0] || null;
  } catch (error) {
    console.error('Database error in getUserByUid:', error);
    throw new Error('Falha ao consultar dados do usuário.', { cause: error });
  }
}

export async function updateUserProfileRecord(params: {
  uid: string;
  name: string;
  phone: string;
  address: string;
  cpf: string;
  vipPreferences?: string;
}) {
  try {
    const updated = await db
      .update(users)
      .set({
        name: params.name.slice(0, 120),
        phone: params.phone.slice(0, 40),
        address: params.address.slice(0, 280),
        cpf: params.cpf.slice(0, 20),
        profileCompleted: true,
        ...(params.vipPreferences !== undefined
          ? { vipPreferences: params.vipPreferences.slice(0, 1000) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.uid, params.uid))
      .returning();
    return updated[0] || null;
  } catch (error) {
    console.error('Database error in updateUserProfileRecord:', error);
    throw new Error('Falha ao salvar dados cadastrais do usuário.', { cause: error });
  }
}

export async function updateUserVipSubscription(params: {
  uid: string;
  vipActive: boolean;
  vipPreferences?: string;
}) {
  try {
    const existing = await getUserByUid(params.uid);
    if (!existing) return null;

    const updated = await db
      .update(users)
      .set({
        vipActive: params.vipActive,
        vipSubscribedAt: params.vipActive ? existing.vipSubscribedAt || new Date() : existing.vipSubscribedAt,
        ...(params.vipPreferences !== undefined
          ? { vipPreferences: params.vipPreferences.slice(0, 1000) }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.uid, params.uid))
      .returning();

    return updated[0] || null;
  } catch (error) {
    console.error('Database error in updateUserVipSubscription:', error);
    throw new Error('Falha ao atualizar assinatura do Clube VIP.', { cause: error });
  }
}

export async function getGlobalSettings() {
  try {
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.settingKey, 'global'))
      .limit(1);

    if (rows[0]) {
      const needsPixMigration = rows[0].pixKey === 'gustavo.reis.vip@pix.com.br';
      const needsWhatsappMigration = rows[0].whatsapp === '5511999999999';
      if (needsPixMigration || needsWhatsappMigration) {
        const migrated = await db
          .update(appSettings)
          .set({
            ...(needsPixMigration ? { pixKey: OFFICIAL_PIX_KEY } : {}),
            ...(needsWhatsappMigration ? { whatsapp: DEFAULT_DRIVER_WHATSAPP } : {}),
            updatedAt: new Date(),
          })
          .where(eq(appSettings.settingKey, 'global'))
          .returning();
        if (migrated[0]) return migrated[0];
      }
      return rows[0];
    }

    const inserted = await db
      .insert(appSettings)
      .values({
        settingKey: 'global',
        standardKm: 3.0,
        execKm: 3.6,
        roundTripKm: 3.0,
        minFare: 25.0,
        estimatedCostPerKm: 1.35,
        minMarginPct: 40.0,
        maxMarginPct: 80.0,
        safetyMarginMin: DEFAULT_SAFETY_MARGIN_MIN,
        pixKey: OFFICIAL_PIX_KEY,
        whatsapp: DEFAULT_DRIVER_WHATSAPP,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted[0]) return inserted[0];
    const retry = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.settingKey, 'global'))
      .limit(1);
    return retry[0];
  } catch (error) {
    console.error('Database error in getGlobalSettings:', error);
    throw new Error('Falha ao carregar configurações globais.', { cause: error });
  }
}

export async function updateGlobalSettings(params: {
  standardKm: number;
  execKm: number;
  roundTripKm: number;
  minFare: number;
  estimatedCostPerKm?: number;
  minMarginPct?: number;
  maxMarginPct?: number;
  safetyMarginMin?: number;
  pixKey: string;
  whatsapp: string;
}) {
  try {
    const safeStandard = Math.max(MIN_KM_RATE, Number(params.standardKm) || MIN_KM_RATE);
    const safeExec = Math.max(MIN_KM_RATE, Number(params.execKm) || 3.6);
    const safeRound = Math.max(MIN_KM_RATE, Number(params.roundTripKm) || MIN_KM_RATE);
    const safeMinFare = Math.max(15, Number(params.minFare) || 25);
    const safeCostPerKm = Math.max(0.3, Math.min(20, Number(params.estimatedCostPerKm) || 1.35));
    const safeMinMargin = Math.max(5, Math.min(90, Number(params.minMarginPct) || 40));
    const safeMaxMargin = Math.max(safeMinMargin + 5, Math.min(98, Number(params.maxMarginPct) || 80));
    const safeMarginMin = Math.max(0, Math.min(180, Math.round(Number(params.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN))));

    const rows = await db
      .insert(appSettings)
      .values({
        settingKey: 'global',
        standardKm: safeStandard,
        execKm: safeExec,
        roundTripKm: safeRound,
        minFare: safeMinFare,
        estimatedCostPerKm: safeCostPerKm,
        minMarginPct: safeMinMargin,
        maxMarginPct: safeMaxMargin,
        safetyMarginMin: safeMarginMin,
        pixKey: params.pixKey.slice(0, 120),
        whatsapp: params.whatsapp.replace(/\D/g, '').slice(0, 20) || DEFAULT_DRIVER_WHATSAPP,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: appSettings.settingKey,
        set: {
          standardKm: safeStandard,
          execKm: safeExec,
          roundTripKm: safeRound,
          minFare: safeMinFare,
          estimatedCostPerKm: safeCostPerKm,
          minMarginPct: safeMinMargin,
          maxMarginPct: safeMaxMargin,
          safetyMarginMin: safeMarginMin,
          pixKey: params.pixKey.slice(0, 120),
          whatsapp: params.whatsapp.replace(/\D/g, '').slice(0, 20) || DEFAULT_DRIVER_WHATSAPP,
          updatedAt: new Date(),
        },
      })
      .returning();

    return rows[0];
  } catch (error) {
    console.error('Database error in updateGlobalSettings:', error);
    throw new Error('Falha ao atualizar tarifas e marca.', { cause: error });
  }
}

function extractBusyWindowsFromRecords(
  activeRides: Array<typeof rides.$inferSelect>,
  blocks: Array<typeof scheduleBlocks.$inferSelect>
): BusyTimeWindow[] {
  const windows: BusyTimeWindow[] = [];

  for (const r of activeRides) {
    if (r.status === 'Cancelado') continue;
    let s1 = r.startTime ? new Date(r.startTime) : null;
    let e1 = r.endTime ? new Date(r.endTime) : null;
    let s2 = r.returnStartTime ? new Date(r.returnStartTime) : null;
    let e2 = r.returnEndTime ? new Date(r.returnEndTime) : null;

    if (!s1 || !e1) {
      const computed = computeOccupancyWindows({
        scheduledDate: r.scheduledDate,
        scheduledTime: r.scheduledTime,
        durationMin: r.durationMin,
        isRoundTrip: r.isRoundTrip,
        safetyMarginMin: r.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN,
        roundTripMode: r.roundTripMode,
        waitTimeMin: r.waitTimeMin,
        returnDate: r.returnDate,
        returnTime: r.returnTime,
      });
      s1 = computed.outboundStart;
      e1 = computed.outboundEnd;
      s2 = computed.returnStart;
      e2 = computed.returnEnd;
    }

    windows.push({
      sourceType: 'ride',
      referenceCode: r.rideCode,
      startTimeIso: s1.toISOString(),
      endTimeIso: e1.toISOString(),
      startLabel: formatSpTime(s1),
      endLabel: formatSpTime(e1),
      date: formatSpDate(s1),
      reason: 'Corrida reservada',
    });

    if (s2 && e2) {
      windows.push({
        sourceType: 'ride',
        referenceCode: `${r.rideCode}-VOLTA`,
        startTimeIso: s2.toISOString(),
        endTimeIso: e2.toISOString(),
        startLabel: formatSpTime(s2),
        endLabel: formatSpTime(e2),
        date: formatSpDate(s2),
        reason: 'Retorno agendado',
      });
    }
  }

  for (const b of blocks) {
    const bs = new Date(b.startTime);
    const be = new Date(b.endTime);
    windows.push({
      sourceType: 'manual_block',
      referenceCode: `BLK-${b.id}`,
      startTimeIso: bs.toISOString(),
      endTimeIso: be.toISOString(),
      startLabel: b.startTimeStr || formatSpTime(bs),
      endLabel: b.endTimeStr || formatSpTime(be),
      date: b.blockDate || formatSpDate(bs),
      reason: b.reason || 'Horário bloqueado pelo motorista',
    });
  }

  return windows;
}

export async function getActiveBusyWindows(executor: typeof db = db): Promise<BusyTimeWindow[]> {
  try {
    const [activeRides, blocks] = await Promise.all([
      executor.select().from(rides).where(ne(rides.status, 'Cancelado')),
      executor.select().from(scheduleBlocks).orderBy(asc(scheduleBlocks.startTime)),
    ]);
    return extractBusyWindowsFromRecords(activeRides, blocks);
  } catch (error) {
    console.error('Database error in getActiveBusyWindows:', error);
    throw new Error('Falha ao consultar disponibilidade da agenda.', { cause: error });
  }
}

export async function listScheduleBlocks() {
  try {
    return await db
      .select()
      .from(scheduleBlocks)
      .orderBy(asc(scheduleBlocks.blockDate), asc(scheduleBlocks.startTime));
  } catch (error) {
    console.error('Database error in listScheduleBlocks:', error);
    throw new Error('Falha ao listar bloqueios manuais da agenda.', { cause: error });
  }
}

export async function createScheduleBlockRecord(params: {
  adminUid: string;
  blockDate: string;
  startTimeStr: string;
  endTimeStr: string;
  reason?: string;
}) {
  try {
    const startTime = parseSpDateTime(params.blockDate, params.startTimeStr);
    const endTime = parseSpDateTime(params.blockDate, params.endTimeStr);
    if (endTime.getTime() <= startTime.getTime()) {
      throw new Error('O horário de término do bloqueio deve ser posterior ao início.');
    }
    const inserted = await db
      .insert(scheduleBlocks)
      .values({
        adminUid: params.adminUid,
        blockDate: params.blockDate,
        startTimeStr: params.startTimeStr.slice(0, 5),
        endTimeStr: params.endTimeStr.slice(0, 5),
        startTime,
        endTime,
        reason: String(params.reason || 'Bloqueio manual do motorista').trim().slice(0, 180),
      })
      .returning();
    return inserted[0];
  } catch (error: any) {
    if (error?.message?.includes('posterior')) throw error;
    console.error('Database error in createScheduleBlockRecord:', error);
    throw new Error('Falha ao registrar bloqueio manual de horário.', { cause: error });
  }
}

export async function deleteScheduleBlockRecord(id: number) {
  try {
    const deleted = await db
      .delete(scheduleBlocks)
      .where(eq(scheduleBlocks.id, id))
      .returning();
    return deleted[0] || null;
  } catch (error) {
    console.error('Database error in deleteScheduleBlockRecord:', error);
    throw new Error('Falha ao liberar bloqueio manual.', { cause: error });
  }
}

export async function createRideRecord(params: {
  rideCode: string;
  userId: string;
  clientName: string;
  clientEmail: string;
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
  category: string;
  isRoundTrip: boolean;
  roundTripMode: string;
  waitTimeMin: number;
  returnDate: string;
  returnTime: string;
  totalOccupiedMin: number;
  safetyMarginMin: number;
  startTime: Date;
  endTime: Date;
  returnStartTime: Date | null;
  returnEndTime: Date | null;
  recurrenceFrequency: string;
  preferences: string;
  scheduledDate: string;
  scheduledTime: string;
  price: number;
  paymentMethod: string;
  paymentStatus: string;
  walletDeducted: number;
  remainingDue: number;
  penaltyIncluded: number;
  pointsEarned: number;
  pointsRedeemed: number;
  notes: string;
  voucherCode?: string;
}) {
  try {
    return await db.transaction(async (tx) => {
      // PostgreSQL transaction-scoped advisory lock prevents simultaneous double-booking at the exact same second
      await tx.execute(sql`SELECT pg_advisory_xact_lock(9384721)`);

      const [activeRides, blocks] = await Promise.all([
        tx.select().from(rides).where(ne(rides.status, 'Cancelado')),
        tx.select().from(scheduleBlocks),
      ]);
      const busyWindows = extractBusyWindowsFromRecords(activeRides, blocks);

      const outStartMs = params.startTime.getTime();
      const outEndMs = params.endTime.getTime();
      for (const w of busyWindows) {
        const wStartMs = Date.parse(w.startTimeIso);
        const wEndMs = Date.parse(w.endTimeIso);
        if (intervalsOverlap(outStartMs, outEndMs, wStartMs, wEndMs)) {
          throw new ScheduleConflictError(
            `Horário indisponível (${formatSpTime(params.startTime)} às ${formatSpTime(
              params.endTime
            )}): conflita com ${w.reason?.toLowerCase() || 'janela ocupada'} de ${w.startLabel} às ${w.endLabel}.`,
            w
          );
        }
      }

      if (params.returnStartTime && params.returnEndTime) {
        const retStartMs = params.returnStartTime.getTime();
        const retEndMs = params.returnEndTime.getTime();
        if (intervalsOverlap(outStartMs, outEndMs, retStartMs, retEndMs)) {
          throw new ScheduleConflictError(
            'O horário de volta selecionado sobrepõe a janela estimada da viagem de ida.',
            {
              sourceType: 'ride',
              referenceCode: 'IDA',
              startTimeIso: params.startTime.toISOString(),
              endTimeIso: params.endTime.toISOString(),
              startLabel: formatSpTime(params.startTime),
              endLabel: formatSpTime(params.endTime),
              date: params.scheduledDate,
              reason: 'Janela da viagem de ida',
            }
          );
        }
        for (const w of busyWindows) {
          const wStartMs = Date.parse(w.startTimeIso);
          const wEndMs = Date.parse(w.endTimeIso);
          if (intervalsOverlap(retStartMs, retEndMs, wStartMs, wEndMs)) {
            throw new ScheduleConflictError(
              `Horário de volta indisponível (${formatSpTime(params.returnStartTime)} às ${formatSpTime(
                params.returnEndTime
              )}): conflita com janela de ${w.startLabel} às ${w.endLabel}.`,
              w
            );
          }
        }
      }

      if (params.voucherCode) {
        await tx
          .update(vouchers)
          .set({ used: true })
          .where(and(eq(vouchers.voucherCode, params.voucherCode), eq(vouchers.userId, params.userId)));
      }

      const passengerRows = await tx
        .select()
        .from(users)
        .where(eq(users.uid, params.userId))
        .limit(1);
      const passenger = passengerRows[0];
      if (passenger) {
        const nextPoints =
          params.pointsRedeemed > 0
            ? Math.max(0, passenger.points - params.pointsRedeemed)
            : passenger.points;
        const safeWalletDeducted = Math.max(
          0,
          Math.min(Number(passenger.walletBalance || 0), Number(params.walletDeducted || 0))
        );
        const nextBalance = Number(
          Math.max(0, Number(passenger.walletBalance || 0) - safeWalletDeducted).toFixed(2)
        );
        const nextPenalty =
          params.penaltyIncluded > 0
            ? Number(
                Math.max(0, Number(passenger.pendingPenalty || 0) - params.penaltyIncluded).toFixed(2)
              )
            : Number(passenger.pendingPenalty || 0);

        await tx
          .update(users)
          .set({
            points: nextPoints,
            walletBalance: nextBalance,
            pendingPenalty: nextPenalty,
            updatedAt: new Date(),
          })
          .where(eq(users.uid, params.userId));

        if (safeWalletDeducted > 0) {
          await tx.insert(walletTransactions).values({
            userId: params.userId,
            type: 'corrida',
            amount: -safeWalletDeducted,
            balanceAfter: nextBalance,
            description: `Desconto automático na corrida ${params.rideCode} (${params.originName.slice(0, 40)} → ${params.destinationName.slice(0, 40)})`,
            referenceCode: params.rideCode,
          });
        }
      }

      const inserted = await tx
        .insert(rides)
        .values({
          rideCode: params.rideCode,
          userId: params.userId,
          clientName: params.clientName.slice(0, 120),
          clientEmail: params.clientEmail.slice(0, 160),
          clientPhone: params.clientPhone.slice(0, 40),
          originName: params.originName.slice(0, 180),
          originAddress: params.originAddress.slice(0, 280),
          originLat: params.originLat,
          originLng: params.originLng,
          destinationName: params.destinationName.slice(0, 180),
          destinationAddress: params.destinationAddress.slice(0, 280),
          destinationLat: params.destinationLat,
          destinationLng: params.destinationLng,
          distanceKm: params.distanceKm,
          durationMin: params.durationMin,
          category: params.category,
          isRoundTrip: params.isRoundTrip,
          roundTripMode: params.roundTripMode,
          waitTimeMin: params.waitTimeMin,
          returnDate: params.returnDate,
          returnTime: params.returnTime,
          totalOccupiedMin: params.totalOccupiedMin,
          safetyMarginMin: params.safetyMarginMin,
          startTime: params.startTime,
          endTime: params.endTime,
          returnStartTime: params.returnStartTime,
          returnEndTime: params.returnEndTime,
          recurrenceFrequency: params.recurrenceFrequency.slice(0, 20),
          preferences: params.preferences.slice(0, 300),
          scheduledDate: params.scheduledDate,
          scheduledTime: params.scheduledTime,
          price: params.price,
          paymentMethod: params.paymentMethod.slice(0, 60),
          paymentStatus: params.paymentStatus.slice(0, 80),
          walletDeducted: Number(params.walletDeducted || 0),
          remainingDue: Number(params.remainingDue || 0),
          penaltyIncluded: Number(params.penaltyIncluded || 0),
          pointsEarned: params.pointsEarned,
          pointsRedeemed: params.pointsRedeemed,
          notes: params.notes.slice(0, 400),
          status: 'Confirmado',
        })
        .returning();

      return inserted[0];
    });
  } catch (error) {
    if (error instanceof ScheduleConflictError) {
      throw error;
    }
    console.error('Database error in createRideRecord:', error);
    throw new Error('Falha ao registrar agendamento no banco de dados.', { cause: error });
  }
}

export async function listRidesForUser(uid: string) {
  try {
    return await db
      .select()
      .from(rides)
      .where(eq(rides.userId, uid))
      .orderBy(desc(rides.createdAt));
  } catch (error) {
    console.error('Database error in listRidesForUser:', error);
    throw new Error('Falha ao consultar suas corridas.', { cause: error });
  }
}

export async function listAllRides() {
  try {
    return await db.select().from(rides).orderBy(desc(rides.createdAt));
  } catch (error) {
    console.error('Database error in listAllRides:', error);
    throw new Error('Falha ao consultar corridas administrativas.', { cause: error });
  }
}

export function isLateCancellation(scheduledDate: string, scheduledTime: string, currentStatus: string): boolean {
  if (currentStatus === 'Em Andamento') return true;
  if (!scheduledDate || !scheduledTime) return false;
  const hhmm = scheduledTime.slice(0, 5);
  const scheduledMs = Date.parse(`${scheduledDate}T${hhmm}:00-03:00`);
  if (!Number.isFinite(scheduledMs)) return false;
  const diffMs = scheduledMs - Date.now();
  return diffMs <= 30 * 60 * 1000;
}

export async function updateRideStatusRecord(
  rideCode: string,
  newStatus: 'Confirmado' | 'Em Andamento' | 'Concluído' | 'Cancelado',
  options?: { applyLateCancelPenaltyIfNeeded?: boolean }
) {
  try {
    const existingRows = await db
      .select()
      .from(rides)
      .where(eq(rides.rideCode, rideCode))
      .limit(1);

    const existing = existingRows[0];
    if (!existing) {
      return null;
    }

    const updated = await db
      .update(rides)
      .set({ status: newStatus, updatedAt: new Date() })
      .where(eq(rides.rideCode, rideCode))
      .returning();

    let penaltyCharged = 0;
    let penaltyMode: 'wallet' | 'pending' | null = null;

    if (newStatus === 'Concluído' && existing.status !== 'Concluído') {
      const passenger = await getUserByUid(existing.userId);
      if (passenger) {
        const earned = existing.pointsEarned || 50;
        const vipBonus = passenger.vipActive ? Math.round(earned * 0.5) : 0;
        await db
          .update(users)
          .set({
            points: passenger.points + earned + vipBonus,
            updatedAt: new Date(),
          })
          .where(eq(users.uid, existing.userId));
      }
    }

    if (
      newStatus === 'Cancelado' &&
      existing.status !== 'Cancelado' &&
      options?.applyLateCancelPenaltyIfNeeded
    ) {
      const late = isLateCancellation(existing.scheduledDate, existing.scheduledTime, existing.status);
      if (late) {
        const passenger = await getUserByUid(existing.userId);
        if (passenger) {
          const currentBalance = Number(passenger.walletBalance || 0);
          if (currentBalance >= LATE_CANCEL_PENALTY) {
            const nextBalance = Number((currentBalance - LATE_CANCEL_PENALTY).toFixed(2));
            await db
              .update(users)
              .set({ walletBalance: nextBalance, updatedAt: new Date() })
              .where(eq(users.uid, existing.userId));

            await db.insert(walletTransactions).values({
              userId: existing.userId,
              type: 'multa',
              amount: -LATE_CANCEL_PENALTY,
              balanceAfter: nextBalance,
              description: `Multa por cancelamento tardio (${existing.rideCode})`,
              referenceCode: existing.rideCode,
            });
            penaltyCharged = LATE_CANCEL_PENALTY;
            penaltyMode = 'wallet';
          } else {
            const nextPending = Number(
              (Number(passenger.pendingPenalty || 0) + LATE_CANCEL_PENALTY).toFixed(2)
            );
            await db
              .update(users)
              .set({ pendingPenalty: nextPending, updatedAt: new Date() })
              .where(eq(users.uid, existing.userId));
            penaltyCharged = LATE_CANCEL_PENALTY;
            penaltyMode = 'pending';
          }
        }
      }
    }

    return {
      ride: updated[0],
      penaltyCharged,
      penaltyMode,
    };
  } catch (error) {
    console.error('Database error in updateRideStatusRecord:', error);
    throw new Error('Falha ao atualizar status da corrida.', { cause: error });
  }
}

export async function listUserVouchers(uid: string) {
  try {
    return await db
      .select()
      .from(vouchers)
      .where(eq(vouchers.userId, uid))
      .orderBy(desc(vouchers.createdAt));
  } catch (error) {
    console.error('Database error in listUserVouchers:', error);
    throw new Error('Falha ao listar vouchers VIP.', { cause: error });
  }
}

export async function redeemVoucherForUser(params: {
  uid: string;
  voucherCode: string;
  title: string;
  discountValue: number;
  pointsCost: number;
}) {
  try {
    const user = await getUserByUid(params.uid);
    if (!user) {
      throw new Error('Usuário não encontrado.');
    }
    if (user.points < params.pointsCost) {
      throw new Error('Pontos VIP insuficientes.');
    }

    const updatedUsers = await db
      .update(users)
      .set({
        points: user.points - params.pointsCost,
        updatedAt: new Date(),
      })
      .where(eq(users.uid, params.uid))
      .returning();

    const createdVouchers = await db
      .insert(vouchers)
      .values({
        voucherCode: params.voucherCode,
        userId: params.uid,
        title: params.title,
        discountValue: params.discountValue,
        pointsCost: params.pointsCost,
        used: false,
      })
      .returning();

    return {
      user: updatedUsers[0],
      voucher: createdVouchers[0],
    };
  } catch (error: any) {
    if (error?.message === 'Pontos VIP insuficientes.' || error?.message === 'Usuário não encontrado.') {
      throw error;
    }
    console.error('Database error in redeemVoucherForUser:', error);
    throw new Error('Falha ao resgatar benefício VIP.', { cause: error });
  }
}

export async function listPartnerRaffles(onlyActive = false) {
  try {
    const rows = onlyActive
      ? await db
          .select()
          .from(partnerRaffles)
          .where(eq(partnerRaffles.active, true))
          .orderBy(desc(partnerRaffles.createdAt))
      : await db.select().from(partnerRaffles).orderBy(desc(partnerRaffles.createdAt));

    if (rows.length === 0 && !onlyActive) {
      return [];
    }
    return rows;
  } catch (error) {
    console.error('Database error in listPartnerRaffles:', error);
    throw new Error('Falha ao consultar sorteios de lojas parceiras.', { cause: error });
  }
}

export async function createPartnerRaffleRecord(params: {
  partnerName: string;
  partnerLogoUrl: string;
  prizeTitle: string;
  prizeDescription: string;
  drawDate: string;
  active?: boolean;
}) {
  try {
    const inserted = await db
      .insert(partnerRaffles)
      .values({
        partnerName: params.partnerName.slice(0, 120),
        partnerLogoUrl: params.partnerLogoUrl.slice(0, 500),
        prizeTitle: params.prizeTitle.slice(0, 140),
        prizeDescription: params.prizeDescription.slice(0, 300),
        drawDate: params.drawDate.slice(0, 20),
        active: params.active ?? true,
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database error in createPartnerRaffleRecord:', error);
    throw new Error('Falha ao cadastrar sorteio de loja parceira.', { cause: error });
  }
}

export async function togglePartnerRaffleRecord(id: number, active: boolean) {
  try {
    const updated = await db
      .update(partnerRaffles)
      .set({ active })
      .where(eq(partnerRaffles.id, id))
      .returning();
    return updated[0] || null;
  } catch (error) {
    console.error('Database error in togglePartnerRaffleRecord:', error);
    throw new Error('Falha ao atualizar status do sorteio.', { cause: error });
  }
}

export async function deletePartnerRaffleRecord(id: number) {
  try {
    const deleted = await db
      .delete(partnerRaffles)
      .where(eq(partnerRaffles.id, id))
      .returning();
    return deleted[0] || null;
  } catch (error) {
    console.error('Database error in deletePartnerRaffleRecord:', error);
    throw new Error('Falha ao remover sorteio parceiro.', { cause: error });
  }
}

export async function listAllExpenses() {
  try {
    return await db.select().from(expenses).orderBy(desc(expenses.expenseDate), desc(expenses.createdAt));
  } catch (error) {
    console.error('Database error in listAllExpenses:', error);
    throw new Error('Falha ao consultar gastos.', { cause: error });
  }
}

export async function createExpenseRecord(params: {
  adminUid: string;
  category: string;
  description: string;
  amount: number;
  expenseDate: string;
  odometerKm?: number | null;
}) {
  try {
    const inserted = await db
      .insert(expenses)
      .values({
        adminUid: params.adminUid,
        category: params.category.slice(0, 60),
        description: params.description.slice(0, 200),
        amount: Math.max(0, Number(params.amount) || 0),
        expenseDate: params.expenseDate,
        odometerKm: params.odometerKm ?? null,
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Database error in createExpenseRecord:', error);
    throw new Error('Falha ao registrar despesa.', { cause: error });
  }
}

export async function deleteExpenseRecord(id: number) {
  try {
    const deleted = await db.delete(expenses).where(eq(expenses.id, id)).returning();
    return deleted[0] || null;
  } catch (error) {
    console.error('Database error in deleteExpenseRecord:', error);
    throw new Error('Falha ao remover despesa.', { cause: error });
  }
}

// =========================================================
// DIGITAL WALLET, TOPUPS & VIP REQUESTS
// =========================================================
export async function createWalletTopupRequest(params: {
  requestCode: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  amount: number;
  pixKey: string;
}) {
  try {
    const safeAmount = Number(Math.max(1, Math.min(10000, Number(params.amount) || 0)).toFixed(2));
    const inserted = await db
      .insert(walletTopups)
      .values({
        requestCode: params.requestCode,
        userId: params.userId,
        userName: params.userName.slice(0, 120),
        userEmail: params.userEmail.slice(0, 160),
        userPhone: params.userPhone.slice(0, 40),
        amount: safeAmount,
        pixKey: params.pixKey.slice(0, 120),
        status: 'Pendente',
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database error in createWalletTopupRequest:', error);
    throw new Error('Falha ao registrar solicitação de crédito Pix.', { cause: error });
  }
}

export async function listWalletTopupsForUser(uid: string) {
  try {
    return await db
      .select()
      .from(walletTopups)
      .where(eq(walletTopups.userId, uid))
      .orderBy(desc(walletTopups.createdAt));
  } catch (error) {
    console.error('Database error in listWalletTopupsForUser:', error);
    throw new Error('Falha ao listar suas recargas.', { cause: error });
  }
}

export async function listAllWalletTopups() {
  try {
    return await db.select().from(walletTopups).orderBy(desc(walletTopups.createdAt));
  } catch (error) {
    console.error('Database error in listAllWalletTopups:', error);
    throw new Error('Falha ao listar solicitações de recarga.', { cause: error });
  }
}

export async function listWalletTransactionsForUser(uid: string) {
  try {
    return await db
      .select()
      .from(walletTransactions)
      .where(eq(walletTransactions.userId, uid))
      .orderBy(desc(walletTransactions.createdAt));
  } catch (error) {
    console.error('Database error in listWalletTransactionsForUser:', error);
    throw new Error('Falha ao listar movimentações da carteira.', { cause: error });
  }
}

export async function reviewWalletTopupRequest(params: {
  id: number;
  approve: boolean;
  adminNotes?: string;
}) {
  try {
    const rows = await db
      .select()
      .from(walletTopups)
      .where(eq(walletTopups.id, params.id))
      .limit(1);
    const reqRow = rows[0];
    if (!reqRow) return null;
    if (reqRow.status !== 'Pendente') {
      throw new Error('Esta solicitação já foi processada anteriormente.');
    }

    const nextStatus = params.approve ? 'Aprovado' : 'Rejeitado';
    const updatedReq = await db
      .update(walletTopups)
      .set({
        status: nextStatus,
        adminNotes: String(params.adminNotes || '').slice(0, 200),
        reviewedAt: new Date(),
      })
      .where(eq(walletTopups.id, params.id))
      .returning();

    let updatedUser = null;
    if (params.approve) {
      const passenger = await getUserByUid(reqRow.userId);
      if (passenger) {
        const nextBalance = Number(
          (Number(passenger.walletBalance || 0) + Number(reqRow.amount || 0)).toFixed(2)
        );
        const userRows = await db
          .update(users)
          .set({ walletBalance: nextBalance, updatedAt: new Date() })
          .where(eq(users.uid, reqRow.userId))
          .returning();
        updatedUser = userRows[0] || null;

        await db.insert(walletTransactions).values({
          userId: reqRow.userId,
          type: 'recarga',
          amount: Number(reqRow.amount),
          balanceAfter: nextBalance,
          description: `Recarga Pix aprovada (${reqRow.requestCode})`,
          referenceCode: reqRow.requestCode,
        });
      }
    }

    return { topup: updatedReq[0], user: updatedUser };
  } catch (error: any) {
    if (error?.message?.includes('processada')) throw error;
    console.error('Database error in reviewWalletTopupRequest:', error);
    throw new Error('Falha ao processar solicitação de recarga.', { cause: error });
  }
}

export async function adjustUserWalletBalance(params: {
  uid: string;
  deltaAmount: number;
  reason: string;
}) {
  try {
    const passenger = await getUserByUid(params.uid);
    if (!passenger) return null;

    const current = Number(passenger.walletBalance || 0);
    const nextBalance = Number(Math.max(0, current + Number(params.deltaAmount || 0)).toFixed(2));
    const actualDelta = Number((nextBalance - current).toFixed(2));

    const updated = await db
      .update(users)
      .set({ walletBalance: nextBalance, updatedAt: new Date() })
      .where(eq(users.uid, params.uid))
      .returning();

    await db.insert(walletTransactions).values({
      userId: params.uid,
      type: 'ajuste_admin',
      amount: actualDelta,
      balanceAfter: nextBalance,
      description:
        params.reason.trim().slice(0, 180) ||
        (actualDelta >= 0 ? 'Crédito manual pelo motorista' : 'Débito manual pelo motorista'),
      referenceCode: `ADM-${Date.now().toString(36).toUpperCase()}`,
    });

    return updated[0] || null;
  } catch (error) {
    console.error('Database error in adjustUserWalletBalance:', error);
    throw new Error('Falha ao ajustar saldo da carteira do cliente.', { cause: error });
  }
}

export async function settleUserPendingPenalty(uid: string) {
  try {
    const updated = await db
      .update(users)
      .set({ pendingPenalty: 0, updatedAt: new Date() })
      .where(eq(users.uid, uid))
      .returning();
    return updated[0] || null;
  } catch (error) {
    console.error('Database error in settleUserPendingPenalty:', error);
    throw new Error('Falha ao quitar pendência financeira do cliente.', { cause: error });
  }
}

export async function listAllUsersWallets() {
  try {
    return await db.select().from(users).orderBy(desc(users.updatedAt));
  } catch (error) {
    console.error('Database error in listAllUsersWallets:', error);
    throw new Error('Falha ao listar carteiras de clientes.', { cause: error });
  }
}

export async function createVipPaymentRequest(params: {
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  notes?: string;
}) {
  try {
    const inserted = await db
      .insert(vipRequests)
      .values({
        userId: params.userId,
        userName: params.userName.slice(0, 120),
        userEmail: params.userEmail.slice(0, 160),
        userPhone: params.userPhone.slice(0, 40),
        amount: VIP_MONTHLY_PRICE,
        status: 'Pendente',
        notes: String(params.notes || 'Pagamento informado via checkout Mercado Pago Clube VIP').slice(0, 250),
      })
      .returning();
    return inserted[0];
  } catch (error) {
    console.error('Database error in createVipPaymentRequest:', error);
    throw new Error('Falha ao registrar aviso de pagamento Clube VIP.', { cause: error });
  }
}

export async function listVipPaymentRequests() {
  try {
    return await db.select().from(vipRequests).orderBy(desc(vipRequests.createdAt));
  } catch (error) {
    console.error('Database error in listVipPaymentRequests:', error);
    throw new Error('Falha ao listar solicitações Clube VIP.', { cause: error });
  }
}

export async function reviewVipPaymentRequest(id: number, approve: boolean) {
  try {
    const rows = await db.select().from(vipRequests).where(eq(vipRequests.id, id)).limit(1);
    const reqRow = rows[0];
    if (!reqRow) return null;

    const updatedReq = await db
      .update(vipRequests)
      .set({
        status: approve ? 'Aprovado' : 'Rejeitado',
        reviewedAt: new Date(),
      })
      .where(eq(vipRequests.id, id))
      .returning();

    let updatedUser = null;
    if (approve) {
      updatedUser = await updateUserVipSubscription({
        uid: reqRow.userId,
        vipActive: true,
      });
    }

    return { vipRequest: updatedReq[0], user: updatedUser };
  } catch (error) {
    console.error('Database error in reviewVipPaymentRequest:', error);
    throw new Error('Falha ao processar solicitação Clube VIP.', { cause: error });
  }
}
