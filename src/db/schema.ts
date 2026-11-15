import { relations } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').notNull().unique(),
  email: text('email').notNull(),
  name: text('name').notNull().default('Passageiro VIP'),
  phone: text('phone').notNull().default(''),
  address: text('address').notNull().default(''),
  cpf: text('cpf').notNull().default(''),
  profileCompleted: boolean('profile_completed').notNull().default(false),
  photoUrl: text('photo_url').notNull().default(''),
  role: text('role').notNull().default('client'),
  points: integer('points').notNull().default(100),
  walletBalance: doublePrecision('wallet_balance').notNull().default(0),
  pendingPenalty: doublePrecision('pending_penalty').notNull().default(0),
  vipActive: boolean('vip_active').notNull().default(false),
  vipSubscribedAt: timestamp('vip_subscribed_at'),
  vipPreferences: text('vip_preferences').notNull().default('{}'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const rides = pgTable('rides', {
  id: serial('id').primaryKey(),
  rideCode: text('ride_code').notNull().unique(),
  userId: text('user_id')
    .references(() => users.uid)
    .notNull(),
  clientName: text('client_name').notNull(),
  clientEmail: text('client_email').notNull().default(''),
  clientPhone: text('client_phone').notNull().default(''),
  originName: text('origin_name').notNull(),
  originAddress: text('origin_address').notNull().default(''),
  originLat: doublePrecision('origin_lat').notNull(),
  originLng: doublePrecision('origin_lng').notNull(),
  destinationName: text('destination_name').notNull(),
  destinationAddress: text('destination_address').notNull().default(''),
  destinationLat: doublePrecision('destination_lat').notNull(),
  destinationLng: doublePrecision('destination_lng').notNull(),
  distanceKm: doublePrecision('distance_km').notNull(),
  durationMin: integer('duration_min').notNull(),
  category: text('category').notNull(),
  isRoundTrip: boolean('is_round_trip').notNull().default(false),
  recurrenceFrequency: text('recurrence_frequency').notNull().default('none'),
  preferences: text('preferences').notNull().default(''),
  scheduledDate: text('scheduled_date').notNull(),
  scheduledTime: text('scheduled_time').notNull(),
  totalOccupiedMin: integer('total_occupied_min').notNull().default(40),
  safetyMarginMin: integer('safety_margin_min').notNull().default(15),
  roundTripMode: text('round_trip_mode').notNull().default('continuous'),
  waitTimeMin: integer('wait_time_min').notNull().default(0),
  returnDate: text('return_date').notNull().default(''),
  returnTime: text('return_time').notNull().default(''),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  returnStartTime: timestamp('return_start_time'),
  returnEndTime: timestamp('return_end_time'),
  price: doublePrecision('price').notNull(),
  paymentMethod: text('payment_method').notNull().default('Pix'),
  paymentStatus: text('payment_status').notNull().default('Aguardando Pix'),
  walletDeducted: doublePrecision('wallet_deducted').notNull().default(0),
  remainingDue: doublePrecision('remaining_due').notNull().default(0),
  penaltyIncluded: doublePrecision('penalty_included').notNull().default(0),
  pointsEarned: integer('points_earned').notNull().default(0),
  pointsRedeemed: integer('points_redeemed').notNull().default(0),
  notes: text('notes').notNull().default(''),
  status: text('status').notNull().default('Confirmado'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const walletTopups = pgTable('wallet_topups', {
  id: serial('id').primaryKey(),
  requestCode: text('request_code').notNull().unique(),
  userId: text('user_id')
    .references(() => users.uid)
    .notNull(),
  userName: text('user_name').notNull(),
  userEmail: text('user_email').notNull().default(''),
  userPhone: text('user_phone').notNull().default(''),
  amount: doublePrecision('amount').notNull(),
  pixKey: text('pix_key').notNull().default('cc67fed7-c665-4bb9-aeb5-f7a2dc7ac84e'),
  status: text('status').notNull().default('Pendente'),
  adminNotes: text('admin_notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at'),
});

export const walletTransactions = pgTable('wallet_transactions', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .references(() => users.uid)
    .notNull(),
  type: text('type').notNull(),
  amount: doublePrecision('amount').notNull(),
  balanceAfter: doublePrecision('balance_after').notNull(),
  description: text('description').notNull(),
  referenceCode: text('reference_code').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const vipRequests = pgTable('vip_requests', {
  id: serial('id').primaryKey(),
  userId: text('user_id')
    .references(() => users.uid)
    .notNull(),
  userName: text('user_name').notNull(),
  userEmail: text('user_email').notNull().default(''),
  userPhone: text('user_phone').notNull().default(''),
  amount: doublePrecision('amount').notNull().default(12.9),
  status: text('status').notNull().default('Pendente'),
  notes: text('notes').notNull().default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  reviewedAt: timestamp('reviewed_at'),
});

export const expenses = pgTable('expenses', {
  id: serial('id').primaryKey(),
  adminUid: text('admin_uid')
    .references(() => users.uid)
    .notNull(),
  category: text('category').notNull(),
  description: text('description').notNull(),
  amount: doublePrecision('amount').notNull(),
  expenseDate: text('expense_date').notNull(),
  odometerKm: integer('odometer_km'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const vouchers = pgTable('vouchers', {
  id: serial('id').primaryKey(),
  voucherCode: text('voucher_code').notNull().unique(),
  userId: text('user_id')
    .references(() => users.uid)
    .notNull(),
  title: text('title').notNull(),
  discountValue: doublePrecision('discount_value').notNull(),
  pointsCost: integer('points_cost').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const partnerRaffles = pgTable('partner_raffles', {
  id: serial('id').primaryKey(),
  partnerName: text('partner_name').notNull(),
  partnerLogoUrl: text('partner_logo_url').notNull().default(''),
  prizeTitle: text('prize_title').notNull(),
  prizeDescription: text('prize_description').notNull().default(''),
  drawDate: text('draw_date').notNull(),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const scheduleBlocks = pgTable('schedule_blocks', {
  id: serial('id').primaryKey(),
  adminUid: text('admin_uid')
    .references(() => users.uid)
    .notNull(),
  blockDate: text('block_date').notNull(),
  startTimeStr: text('start_time_str').notNull(),
  endTimeStr: text('end_time_str').notNull(),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  reason: text('reason').notNull().default('Bloqueio manual do motorista'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const appSettings = pgTable('app_settings', {
  id: serial('id').primaryKey(),
  settingKey: text('setting_key').notNull().unique(),
  standardKm: doublePrecision('standard_km').notNull().default(3.0),
  execKm: doublePrecision('exec_km').notNull().default(3.6),
  roundTripKm: doublePrecision('round_trip_km').notNull().default(3.0),
  minFare: doublePrecision('min_fare').notNull().default(25.0),
  estimatedCostPerKm: doublePrecision('estimated_cost_per_km').notNull().default(1.35),
  minMarginPct: doublePrecision('min_margin_pct').notNull().default(40.0),
  maxMarginPct: doublePrecision('max_margin_pct').notNull().default(80.0),
  safetyMarginMin: integer('safety_margin_min').notNull().default(15),
  pixKey: text('pix_key').notNull().default('cc67fed7-c665-4bb9-aeb5-f7a2dc7ac84e'),
  whatsapp: text('whatsapp').notNull().default('5511947476229'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  rides: many(rides),
  expenses: many(expenses),
  vouchers: many(vouchers),
  walletTopups: many(walletTopups),
  walletTransactions: many(walletTransactions),
  vipRequests: many(vipRequests),
}));

export const ridesRelations = relations(rides, ({ one }) => ({
  passenger: one(users, {
    fields: [rides.userId],
    references: [users.uid],
  }),
}));

export const expensesRelations = relations(expenses, ({ one }) => ({
  admin: one(users, {
    fields: [expenses.adminUid],
    references: [users.uid],
  }),
}));

export const vouchersRelations = relations(vouchers, ({ one }) => ({
  owner: one(users, {
    fields: [vouchers.userId],
    references: [users.uid],
  }),
}));
