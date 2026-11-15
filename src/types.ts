export type RideCategory = 'exec' | 'roundtrip';

export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly';

export type RideStatus = 'Confirmado' | 'Em Andamento' | 'Concluído' | 'Cancelado';

export type VipTier = 'Bronze' | 'Prata' | 'Ouro' | 'Black';

export type ExpenseCategory =
  | 'Combustível'
  | 'Manutenção'
  | 'Pedágio'
  | 'Lavagem'
  | 'Seguro'
  | 'Outros';

export interface GeoPlace {
  name: string;
  address: string;
  lat: number;
  lng: number;
  icon?: string;
  placeId?: string;
}

export interface RouteMetrics {
  distanceKm: number;
  durationMin: number;
  durationInTrafficMin: number;
  trafficDeltaMin: number;
  coords: [number, number][]; // [lat, lng]
  source: 'routes-api-v2' | 'osrm' | 'haversine-estimate';
  encodedPolyline?: string;
}

export type RoundTripMode = 'continuous' | 'scheduled_return';

export interface AppSettings {
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
  mapsBrowserKey?: string;
  adminEmail?: string;
}

export interface WhatsAppDispatchResult {
  dispatched: boolean;
  mode: 'whatsapp-cloud-api' | 'whatsapp-deep-link';
  recipients: string[];
  messagePreview: string;
  whatsappUrl: string;
  statusDetail: string;
}

export interface RidePriceAlert {
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

export interface VipPreferences {
  acTemp?: string;
  rideStyle?: string;
  favoriteTime?: string;
  favoriteRoute?: string;
}

export interface PartnerRaffle {
  id: string | number;
  partnerName: string;
  partnerLogoUrl: string;
  prizeTitle: string;
  prizeDescription: string;
  drawDate: string;
  active: boolean;
  createdAt?: string;
}

export type SecondaryPaymentMethod = 'Pix' | 'Cartão Presencial';

export type PaymentMethod =
  | 'Carteira'
  | 'Pix'
  | 'Cartão Presencial'
  | 'Carteira + Pix'
  | 'Carteira + Cartão Presencial';

export interface WalletTopupRequest {
  id: string | number;
  requestCode: string;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  amount: number;
  pixKey: string;
  status: 'Pendente' | 'Aprovado' | 'Rejeitado';
  adminNotes: string;
  createdAt: string;
  reviewedAt?: string | null;
}

export interface WalletTransaction {
  id: string | number;
  userId: string;
  type: 'recarga' | 'corrida' | 'multa' | 'ajuste_admin' | 'estorno';
  amount: number;
  balanceAfter: number;
  description: string;
  referenceCode: string;
  createdAt: string;
}

export interface VipRequest {
  id: string | number;
  userId: string;
  userName: string;
  userEmail: string;
  userPhone: string;
  amount: number;
  status: 'Pendente' | 'Aprovado' | 'Rejeitado';
  notes: string;
  createdAt: string;
  reviewedAt?: string | null;
}

export interface AdminClientWallet {
  uid: string;
  name: string;
  email: string;
  phone: string;
  points: number;
  walletBalance: number;
  pendingPenalty: number;
  vipActive: boolean;
  vipSubscribedAt?: string | null;
}

export interface UserProfile {
  uid: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  cpf: string;
  profileCompleted: boolean;
  photoUrl: string;
  points: number;
  tier: VipTier;
  walletBalance: number;
  pendingPenalty: number;
  vipActive: boolean;
  vipSubscribedAt?: string | null;
  vipPreferences?: VipPreferences;
  isAdmin: boolean;
  isGuest?: boolean;
}

export interface Voucher {
  voucherCode: string;
  userId: string;
  title: string;
  discountValue: number;
  pointsCost: number;
  used: boolean;
  createdAt?: string;
}

export interface Ride {
  id?: number;
  rideCode: string;
  userId: string;
  clientName: string;
  clientEmail?: string;
  clientPhone?: string;
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
  category: RideCategory | 'standard';
  isRoundTrip: boolean;
  recurrenceFrequency?: RecurrenceFrequency;
  preferences?: string;
  scheduledDate: string;
  scheduledTime: string;
  totalOccupiedMin?: number;
  safetyMarginMin?: number;
  roundTripMode?: RoundTripMode | string;
  waitTimeMin?: number;
  returnDate?: string;
  returnTime?: string;
  startTime?: string | null;
  endTime?: string | null;
  returnStartTime?: string | null;
  returnEndTime?: string | null;
  price: number;
  paymentMethod?: PaymentMethod | string;
  paymentStatus?: string;
  walletDeducted?: number;
  remainingDue?: number;
  penaltyIncluded?: number;
  pointsEarned: number;
  pointsRedeemed?: number;
  notes: string;
  status: RideStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface ScheduleBlock {
  id: string | number;
  adminUid: string;
  blockDate: string;
  startTimeStr: string;
  endTimeStr: string;
  startTime: string;
  endTime: string;
  reason: string;
  createdAt?: string;
}

export interface BusyTimeWindow {
  sourceType: 'ride' | 'manual_block';
  referenceCode: string;
  startTimeIso: string;
  endTimeIso: string;
  startLabel: string;
  endLabel: string;
  date: string;
  reason?: string;
}

export interface TimeSlotAvailability {
  time: string;
  occupied: boolean;
  conflictWindowLabel?: string;
  windowStartLabel: string;
  windowEndLabel: string;
}

export interface ScheduleAvailabilityResponse {
  date: string;
  safetyMarginMin: number;
  outboundOccupiedMin: number;
  returnOccupiedMin: number;
  busyWindows: BusyTimeWindow[];
  slots: TimeSlotAvailability[];
  selectedConflict?: BusyTimeWindow | null;
  returnConflict?: BusyTimeWindow | null;
}

export interface Expense {
  id: string | number;
  adminUid: string;
  category: ExpenseCategory | string;
  description: string;
  amount: number;
  expenseDate: string;
  odometerKm?: number | null;
  createdAt?: string;
}

export interface DashboardSummary {
  totalRides: number;
  completedRidesCount: number;
  activeOrScheduledCount: number;
  canceledRidesCount: number;
  completedEarnings: number;
  scheduledRevenue: number;
  totalExpenses: number;
  netProfit: number;
  profitMarginPct: number;
  totalDistanceKm: number;
  avgTicket: number;
  effectiveCostPerKm: number;
  priceAlertCount: number;
  expensesByCategory: Record<string, number>;
}

export interface GroundingSource {
  type: 'maps' | 'web';
  title: string;
  uri: string;
  snippet?: string;
  placeId?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  modelUsed?: string;
  sources?: GroundingSource[];
  timestamp: string;
}

export type AiMode = 'concierge' | 'maps' | 'search' | 'finance';
export type AiSpeed = 'fast' | 'deep';
