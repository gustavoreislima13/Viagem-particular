import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  Calendar,
  Car,
  CheckCircle2,
  Clock,
  CreditCard,
  Crown,
  DollarSign,
  Fuel,
  Loader2,
  Lock,
  MessageCircle,
  Play,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Ticket,
  Trash2,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import {
  MIN_KM_RATE,
  api,
  buildWhatsappUrl,
  formatCurrency,
} from '../services/api.ts';
import {
  AdminClientWallet,
  AppSettings,
  DashboardSummary,
  Expense,
  ExpenseCategory,
  PartnerRaffle,
  Ride,
  RidePriceAlert,
  RideStatus,
  ScheduleBlock,
  VipRequest,
  WalletTopupRequest,
} from '../types.ts';
import {
  DEFAULT_SAFETY_MARGIN_MIN,
  formatBrDate,
  formatKmPtBr,
  formatRideWindowSummary,
} from '../utils/schedule.ts';

interface CreatorDashboardModalProps {
  isOpen: boolean;
  isAdmin: boolean;
  settings: AppSettings;
  onClose: () => void;
  onSettingsUpdated: (settings: AppSettings) => void;
  onRideStatusUpdated: () => void;
  onOpenAiFinance: () => void;
}

type DashTab =
  | 'finance'
  | 'alerts'
  | 'wallets'
  | 'rides'
  | 'expenses'
  | 'partners'
  | 'settings'
  | 'security';

const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  'Combustível',
  'Manutenção',
  'Pedágio',
  'Lavagem',
  'Seguro',
  'Outros',
];

export function CreatorDashboardModal({
  isOpen,
  isAdmin,
  settings,
  onClose,
  onSettingsUpdated,
  onRideStatusUpdated,
  onOpenAiFinance,
}: CreatorDashboardModalProps) {
  const [tab, setTab] = useState<DashTab>('finance');
  const [period, setPeriod] = useState<'all' | 'today' | 'month'>('all');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [rides, setRides] = useState<Ride[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<RidePriceAlert[]>([]);
  const [rideMargins, setRideMargins] = useState<Record<string, RidePriceAlert>>({});
  const [raffles, setRaffles] = useState<PartnerRaffle[]>([]);

  // Wallets, Topups & VIP Requests state
  const [topups, setTopups] = useState<WalletTopupRequest[]>([]);
  const [vipRequests, setVipRequests] = useState<VipRequest[]>([]);
  const [clients, setClients] = useState<AdminClientWallet[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [walletBusyKey, setWalletBusyKey] = useState<string | null>(null);
  const [adjustTargetUid, setAdjustTargetUid] = useState<string | null>(null);
  const [adjustAmount, setAdjustAmount] = useState('20');
  const [adjustReason, setAdjustReason] = useState('');

  // Partner Raffle Form
  const [partnerName, setPartnerName] = useState('');
  const [partnerLogoUrl, setPartnerLogoUrl] = useState('');
  const [prizeTitle, setPrizeTitle] = useState('');
  const [prizeDescription, setPrizeDescription] = useState('');
  const [drawDate, setDrawDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [savingRaffle, setSavingRaffle] = useState(false);

  // Rides filters
  const [rideStatusFilter, setRideStatusFilter] = useState<'Todas' | RideStatus>('Todas');
  const [rideSearch, setRideSearch] = useState('');
  const [updatingRideCode, setUpdatingRideCode] = useState<string | null>(null);

  // Manual Schedule Blocks
  const [scheduleBlocks, setScheduleBlocks] = useState<ScheduleBlock[]>([]);
  const [blockDate, setBlockDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [blockStartHhmm, setBlockStartHhmm] = useState('12:00');
  const [blockEndHhmm, setBlockEndHhmm] = useState('13:30');
  const [blockReason, setBlockReason] = useState('');
  const [savingBlock, setSavingBlock] = useState(false);
  const [deletingBlockId, setDeletingBlockId] = useState<string | number | null>(null);

  // New Expense Form
  const [expCategory, setExpCategory] = useState<ExpenseCategory>('Combustível');
  const [expDesc, setExpDesc] = useState('');
  const [expAmount, setExpAmount] = useState('');
  const [expDate, setExpDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [expOdometer, setExpOdometer] = useState('');
  const [savingExpense, setSavingExpense] = useState(false);

  // Tariff & Brand Form
  const [formSettings, setFormSettings] = useState<AppSettings>(settings);
  const [savingSettings, setSavingSettings] = useState(false);

  useEffect(() => {
    setFormSettings(settings);
  }, [settings]);

  const loadDashboard = useCallback(async () => {
    if (!isOpen || !isAdmin) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const [data, rafflesRes, walletsRes] = await Promise.all([
        api.getAdminDashboard(period),
        api.getAdminRaffles().catch(() => ({ raffles: [] })),
        api.getAdminWallets().catch(() => ({ topups: [], vipRequests: [], clients: [] })),
      ]);
      setSummary(data.summary);
      setRides(data.rides);
      setExpenses(data.expenses);
      setScheduleBlocks(data.scheduleBlocks || []);
      setPriceAlerts(data.priceAlerts || []);
      setRideMargins(data.rideMargins || {});
      setRaffles(rafflesRes.raffles || []);
      setTopups(walletsRes.topups || []);
      setVipRequests(walletsRes.vipRequests || []);
      setClients(walletsRes.clients || []);
      if (data.settings) {
        setFormSettings(data.settings);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao carregar dados administrativos.');
    } finally {
      setLoading(false);
    }
  }, [isOpen, isAdmin, period]);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  if (!isOpen || !isAdmin) return null;

  if (!isAdmin) {
    return (
      <div className="fixed inset-0 z-[240] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
        <div className="glass-panel max-w-md w-full rounded-3xl p-6 text-center border border-red-500/30">
          <div className="w-12 h-12 rounded-2xl bg-red-500/15 text-red-400 flex items-center justify-center mx-auto mb-3">
            <Lock className="w-6 h-6" />
          </div>
          <h3 className="font-display font-bold text-lg text-white">Acesso Exclusivo do Motorista</h3>
          <p className="text-xs text-slate-400 mt-2 mb-5">
            Por segurança, o Painel Master não usa mais senhas fixas no navegador. Entre com a conta Google verificada do administrador para acessar corridas, ganhos e gastos.
          </p>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-sm font-bold text-white"
          >
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const handleStatusChange = async (rideCode: string, status: RideStatus) => {
    setUpdatingRideCode(rideCode);
    try {
      await api.updateRideStatus(rideCode, status);
      await loadDashboard();
      onRideStatusUpdated();
      setSuccessMsg(
        status === 'Cancelado'
          ? `Corrida ${rideCode} cancelada e janela liberada automaticamente na agenda.`
          : `Corrida ${rideCode} atualizada para "${status}".`
      );
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao atualizar status.');
    } finally {
      setUpdatingRideCode(null);
    }
  };

  const handleAddScheduleBlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingBlock(true);
    setErrorMsg(null);
    try {
      await api.createAdminScheduleBlock({
        blockDate,
        startHhmm: blockStartHhmm,
        endHhmm: blockEndHhmm,
        reason: blockReason.trim() || 'Bloqueio manual do motorista',
      });
      setBlockReason('');
      await loadDashboard();
      onRideStatusUpdated();
      setSuccessMsg(
        `Horário ${blockStartHhmm} às ${blockEndHhmm} (${formatBrDate(blockDate)}) bloqueado na agenda.`
      );
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao criar bloqueio manual de agenda.');
    } finally {
      setSavingBlock(false);
    }
  };

  const handleDeleteScheduleBlock = async (id: string | number) => {
    setDeletingBlockId(id);
    setErrorMsg(null);
    try {
      await api.deleteAdminScheduleBlock(id);
      await loadDashboard();
      onRideStatusUpdated();
      setSuccessMsg('Bloqueio removido e horário liberado na agenda.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao liberar bloqueio de agenda.');
    } finally {
      setDeletingBlockId(null);
    }
  };

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    const numericAmount = Number(expAmount.replace(',', '.'));
    if (!expDesc.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0) {
      setErrorMsg('Informe uma descrição e um valor positivo para o gasto.');
      return;
    }
    setSavingExpense(true);
    setErrorMsg(null);
    try {
      await api.createExpense({
        category: expCategory,
        description: expDesc.trim(),
        amount: numericAmount,
        expenseDate: expDate,
        odometerKm: expOdometer ? Number(expOdometer) : null,
      });
      setExpDesc('');
      setExpAmount('');
      setExpOdometer('');
      await loadDashboard();
      setSuccessMsg('Despesa registrada com sucesso no Firestore.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao cadastrar gasto.');
    } finally {
      setSavingExpense(false);
    }
  };

  const handleAddRaffle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (partnerName.trim().length < 2 || prizeTitle.trim().length < 2) {
      setErrorMsg('Informe o nome da loja parceira e o título do prêmio.');
      return;
    }
    setSavingRaffle(true);
    setErrorMsg(null);
    try {
      await api.createAdminRaffle({
        partnerName: partnerName.trim(),
        partnerLogoUrl: partnerLogoUrl.trim(),
        prizeTitle: prizeTitle.trim(),
        prizeDescription: prizeDescription.trim(),
        drawDate,
      });
      setPartnerName('');
      setPartnerLogoUrl('');
      setPrizeTitle('');
      setPrizeDescription('');
      await loadDashboard();
      setSuccessMsg('Loja parceira e sorteio VIP publicados!');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao cadastrar sorteio parceiro.');
    } finally {
      setSavingRaffle(false);
    }
  };

  const handleToggleRaffle = async (id: string | number, nextActive: boolean) => {
    try {
      await api.toggleAdminRaffle(id, nextActive);
      await loadDashboard();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao atualizar status do sorteio.');
    }
  };

  const handleDeleteRaffle = async (id: string | number) => {
    try {
      await api.deleteAdminRaffle(id);
      await loadDashboard();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao remover sorteio parceiro.');
    }
  };

  const handleDeleteExpense = async (id: string | number) => {
    try {
      await api.deleteExpense(id);
      await loadDashboard();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Falha ao excluir gasto.');
    }
  };

  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingSettings(true);
    setErrorMsg(null);
    try {
      const safeMinMargin = Math.max(5, Math.min(90, Number(formSettings.minMarginPct) || 40));
      const safeMaxMargin = Math.max(
        safeMinMargin + 5,
        Math.min(98, Number(formSettings.maxMarginPct) || 80)
      );
      const safeSafetyMargin = Math.max(
        0,
        Math.min(180, Math.round(Number(formSettings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN)))
      );
      const sanitized: AppSettings = {
        ...formSettings,
        standardKm: Math.max(MIN_KM_RATE, Number(formSettings.standardKm) || MIN_KM_RATE),
        execKm: Math.max(MIN_KM_RATE, Number(formSettings.execKm) || 3.6),
        roundTripKm: Math.max(MIN_KM_RATE, Number(formSettings.roundTripKm) || MIN_KM_RATE),
        minFare: Math.max(15, Number(formSettings.minFare) || 25),
        estimatedCostPerKm: Math.max(0.3, Number(formSettings.estimatedCostPerKm) || 1.35),
        minMarginPct: safeMinMargin,
        maxMarginPct: safeMaxMargin,
        safetyMarginMin: safeSafetyMargin,
      };
      const res = await api.updateSettings(sanitized);
      onSettingsUpdated(res.settings);
      await loadDashboard();
      setSuccessMsg('Tarifas, margem de segurança da agenda e dados salvos com segurança.');
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao atualizar configurações.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleReviewTopup = async (id: string | number, approve: boolean) => {
    setWalletBusyKey(`topup-${id}`);
    setErrorMsg(null);
    try {
      await api.reviewWalletTopup(id, approve);
      await loadDashboard();
      onRideStatusUpdated();
      setSuccessMsg(
        approve
          ? 'Recarga Pix aprovada e creditada na carteira do passageiro!'
          : 'Solicitação de recarga marcada como rejeitada.'
      );
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao revisar solicitação de crédito.');
    } finally {
      setWalletBusyKey(null);
    }
  };

  const handleAdjustWallet = async (uid: string, sign: 1 | -1) => {
    const raw = Number(adjustAmount.replace(',', '.'));
    if (!Number.isFinite(raw) || raw <= 0) {
      setErrorMsg('Informe um valor positivo para ajustar o saldo.');
      return;
    }
    setWalletBusyKey(`adjust-${uid}`);
    setErrorMsg(null);
    try {
      await api.adjustClientWallet(
        uid,
        sign * raw,
        adjustReason.trim() ||
          (sign > 0 ? 'Crédito manual pelo motorista' : 'Débito manual pelo motorista')
      );
      setAdjustTargetUid(null);
      setAdjustReason('');
      await loadDashboard();
      onRideStatusUpdated();
      setSuccessMsg('Saldo da carteira atualizado com sucesso.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao ajustar saldo do cliente.');
    } finally {
      setWalletBusyKey(null);
    }
  };

  const handleSettlePenalty = async (uid: string) => {
    setWalletBusyKey(`penalty-${uid}`);
    setErrorMsg(null);
    try {
      await api.settleClientPenalty(uid);
      await loadDashboard();
      onRideStatusUpdated();
      setSuccessMsg('Multa pendente quitada com sucesso.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao quitar pendência.');
    } finally {
      setWalletBusyKey(null);
    }
  };

  const handleReviewVipRequest = async (id: string | number, approve: boolean) => {
    setWalletBusyKey(`vipreq-${id}`);
    setErrorMsg(null);
    try {
      await api.reviewVipRequest(id, approve);
      await loadDashboard();
      onRideStatusUpdated();
      setSuccessMsg(
        approve
          ? 'Assinatura Clube VIP aprovada e ativada para o passageiro!'
          : 'Solicitação Clube VIP rejeitada.'
      );
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao processar solicitação VIP.');
    } finally {
      setWalletBusyKey(null);
    }
  };

  const handleToggleUserVip = async (uid: string, nextVip: boolean) => {
    setWalletBusyKey(`vip-${uid}`);
    setErrorMsg(null);
    try {
      await api.adminToggleUserVip(uid, nextVip);
      await loadDashboard();
      onRideStatusUpdated();
      setSuccessMsg(nextVip ? 'Clube VIP ativado para o cliente.' : 'Clube VIP desativado.');
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao atualizar status VIP.');
    } finally {
      setWalletBusyKey(null);
    }
  };

  const pendingTopupsCount = topups.filter((t) => t.status === 'Pendente').length;
  const pendingVipCount = vipRequests.filter((v) => v.status === 'Pendente').length;
  const pendingWalletBadge = pendingTopupsCount + pendingVipCount;

  const filteredClients = clients.filter((c) => {
    if (!clientSearch.trim()) return true;
    const q = clientSearch.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.phone.toLowerCase().includes(q)
    );
  });

  const filteredRides = rides.filter((r) => {
    if (rideStatusFilter !== 'Todas' && r.status !== rideStatusFilter) return false;
    if (rideSearch.trim()) {
      const q = rideSearch.toLowerCase();
      return (
        r.rideCode.toLowerCase().includes(q) ||
        r.clientName.toLowerCase().includes(q) ||
        r.originName.toLowerCase().includes(q) ||
        r.destinationName.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const maxBar = Math.max(
    1,
    summary?.completedEarnings || 0,
    summary?.scheduledRevenue || 0,
    summary?.totalExpenses || 0
  );

  return (
    <div className="fixed inset-0 z-[240] flex items-center justify-center p-2 sm:p-5 bg-black/85 backdrop-blur-md">
      <div className="glass-panel w-full max-w-6xl h-[92vh] rounded-3xl overflow-hidden shadow-2xl border border-white/10 flex flex-col">
        {/* Top Bar Contract */}
        <div className="px-5 py-4 border-b border-white/10 flex flex-wrap items-center justify-between gap-4 shrink-0 bg-slate-900/70">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emeraldVip/15 border border-emeraldVip/30 text-emeraldVip flex items-center justify-center">
              <BarChart3 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg text-white">
                Painel Master · Gustavo Reis
              </h2>
              <p className="text-xs text-slate-400">
                Monitor de Corridas, Ganhos, Gastos, Agenda e Segurança
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* Period Segmented Filter */}
            <div className="flex items-center gap-1 p-1 bg-slate-950/80 rounded-xl border border-white/10">
              {(['today', 'month', 'all'] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPeriod(p)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
                    period === p
                      ? 'bg-emeraldVip text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {p === 'today' ? 'Hoje' : p === 'month' ? 'Este Mês' : 'Tudo'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenAiFinance();
              }}
              className="px-3.5 py-2 rounded-xl bg-goldVip/15 hover:bg-goldVip/25 border border-goldVip/30 text-goldVip text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Auditoria IA
            </button>

            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar Painel Master"
              className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 py-2.5 border-b border-white/10 bg-slate-900/40 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          {[
            { id: 'finance' as const, label: 'Ganhos vs Gastos', icon: BarChart3 },
            {
              id: 'wallets' as const,
              label:
                pendingWalletBadge > 0
                  ? `Recargas & Carteiras (${pendingWalletBadge})`
                  : 'Recargas & Carteiras',
              icon: Wallet,
              highlight: pendingWalletBadge > 0,
            },
            {
              id: 'alerts' as const,
              label: `Alerta de Preço (${priceAlerts.length})`,
              icon: AlertTriangle,
              highlight: priceAlerts.length > 0,
            },
            { id: 'rides' as const, label: `Corridas & Agenda (${rides.length})`, icon: Calendar },
            { id: 'expenses' as const, label: `Gastos (${expenses.length})`, icon: Fuel },
            { id: 'partners' as const, label: `Parceiros & Sorteios (${raffles.length})`, icon: Store },
            { id: 'settings' as const, label: 'Tarifas & PIX', icon: Settings },
            { id: 'security' as const, label: 'Segurança', icon: ShieldCheck },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-2 transition-colors ${
                  active
                    ? 'bg-emeraldVip text-slate-950 font-bold'
                    : item.highlight
                      ? 'bg-amber-500/20 border border-amber-400/40 text-amber-200 hover:bg-amber-500/30'
                      : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Live Price Alert Banner */}
        {priceAlerts.length > 0 && tab !== 'alerts' && (
          <div className="px-5 pt-3 shrink-0">
            <div className="p-3 rounded-2xl bg-amber-500/15 border border-amber-400/35 flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2.5 text-amber-100">
                <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
                <span>
                  <strong>Alerta de Preço:</strong> {priceAlerts.length} viagem(ns) com margem fora da faixa{' '}
                  <strong>
                    {Number(formSettings.minMarginPct ?? 40).toFixed(0)}%–
                    {Number(formSettings.maxMarginPct ?? 80).toFixed(0)}%
                  </strong>{' '}
                  (custo efetivo do sistema: {formatCurrency(summary?.effectiveCostPerKm ?? 1.35)}/km).
                </span>
              </div>
              <button
                type="button"
                onClick={() => setTab('alerts')}
                className="px-3 py-1.5 rounded-xl bg-amber-400 text-slate-950 font-bold text-[11px] hover:brightness-110 whitespace-nowrap"
              >
                Inspecionar Alertas
              </button>
            </div>
          </div>
        )}

        {/* Feedback Banners */}
        {(errorMsg || successMsg) && (
          <div className="px-5 pt-3 shrink-0">
            {errorMsg && (
              <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-200">
                {errorMsg}
              </div>
            )}
            {successMsg && (
              <div className="p-3 rounded-xl bg-emeraldVip/15 border border-emeraldVip/30 text-xs text-emeraldVip">
                {successMsg}
              </div>
            )}
          </div>
        )}

        {/* Main Viewport */}
        <div className="flex-1 overflow-y-auto p-5 space-y-6">
          {loading && !summary ? (
            <div className="py-16 flex items-center justify-center gap-2 text-slate-400 text-sm">
              <Loader2 className="w-5 h-5 animate-spin text-emeraldVip" />
              Sincronizando Firestore e métricas...
            </div>
          ) : (
            <>
              {/* TAB 1: FINANCIAL OVERVIEW */}
              {tab === 'finance' && summary && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-4">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                        <span>Ganhos Concluídos</span>
                        <TrendingUp className="w-4 h-4 text-emeraldVip" />
                      </div>
                      <p className="font-display text-2xl font-extrabold text-emeraldVip tabular-nums">
                        {formatCurrency(summary.completedEarnings)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                        {summary.completedRidesCount} corridas finalizadas
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-4">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                        <span>Receita Agendada</span>
                        <Calendar className="w-4 h-4 text-sky-400" />
                      </div>
                      <p className="font-display text-2xl font-extrabold text-sky-400 tabular-nums">
                        {formatCurrency(summary.scheduledRevenue)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                        {summary.activeOrScheduledCount} reservas ativas
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-4">
                      <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                        <span>Gastos Totais</span>
                        <TrendingDown className="w-4 h-4 text-red-400" />
                      </div>
                      <p className="font-display text-2xl font-extrabold text-red-400 tabular-nums">
                        {formatCurrency(summary.totalExpenses)}
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1 tabular-nums">
                        {expenses.length} lançamentos operacionais
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-900/80 border border-goldVip/30 p-4">
                      <div className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                        <span>Lucro Líquido Real</span>
                        <DollarSign className="w-4 h-4 text-goldVip" />
                      </div>
                      <p
                        className={`font-display text-2xl font-extrabold tabular-nums ${
                          summary.netProfit >= 0 ? 'text-goldVip' : 'text-red-400'
                        }`}
                      >
                        {formatCurrency(summary.netProfit)}
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1 tabular-nums">
                        Margem: {summary.profitMarginPct}% · Ticket: {formatCurrency(summary.avgTicket)}
                      </p>
                    </div>
                  </div>

                  {/* Visual Comparison & Breakdown */}
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                    <div className="rounded-2xl bg-slate-900/75 border border-white/10 p-5 space-y-4">
                      <h3 className="font-display font-bold text-sm text-white">
                        Comparativo Financeiro & Eficiência
                      </h3>
                      <div className="space-y-3 text-xs">
                        <div>
                          <div className="flex justify-between mb-1">
                            <span className="text-slate-300">Faturamento Concluído</span>
                            <span className="font-mono font-bold text-emeraldVip tabular-nums">
                              {formatCurrency(summary.completedEarnings)}
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-emeraldVip rounded-full"
                              style={{
                                width: `${Math.round((summary.completedEarnings / maxBar) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between mb-1">
                            <span className="text-slate-300">Receita Prevista na Agenda</span>
                            <span className="font-mono font-bold text-sky-400 tabular-nums">
                              {formatCurrency(summary.scheduledRevenue)}
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-sky-400 rounded-full"
                              style={{
                                width: `${Math.round((summary.scheduledRevenue / maxBar) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>

                        <div>
                          <div className="flex justify-between mb-1">
                            <span className="text-slate-300">Gastos Operacionais</span>
                            <span className="font-mono font-bold text-red-400 tabular-nums">
                              {formatCurrency(summary.totalExpenses)}
                            </span>
                          </div>
                          <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className="h-full bg-red-400 rounded-full"
                              style={{
                                width: `${Math.round((summary.totalExpenses / maxBar) * 100)}%`,
                              }}
                            />
                          </div>
                        </div>
                      </div>

                      <div className="pt-3 border-t border-white/10 grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <span className="text-slate-400">Km Totais Rodados</span>
                          <p className="font-mono font-bold text-white text-base tabular-nums">
                            {Number(summary.totalDistanceKm || 0).toFixed(1)} km
                          </p>
                        </div>
                        <div>
                          <span className="text-slate-400">Receita Bruta / Km</span>
                          <p className="font-mono font-bold text-emeraldVip text-base tabular-nums">
                            {summary.totalDistanceKm > 0
                              ? formatCurrency(
                                  (summary.completedEarnings + summary.scheduledRevenue) /
                                    summary.totalDistanceKm
                                )
                              : 'R$ 0,00'}
                          </p>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-2xl bg-slate-900/75 border border-white/10 p-5 space-y-4">
                      <h3 className="font-display font-bold text-sm text-white">
                        Distribuição de Gastos por Categoria
                      </h3>
                      {Object.keys(summary.expensesByCategory).length === 0 ? (
                        <div className="py-8 text-center text-xs text-slate-400 space-y-2">
                          <p>Nenhum gasto lançado neste período.</p>
                          <button
                            type="button"
                            onClick={() => setTab('expenses')}
                            className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold"
                          >
                            Lançar Primeiro Gasto
                          </button>
                        </div>
                      ) : (
                        <div className="space-y-2.5">
                          {Object.entries(summary.expensesByCategory).map(([cat, total]) => {
                            const pct =
                              summary.totalExpenses > 0
                                ? Math.round((total / summary.totalExpenses) * 100)
                                : 0;
                            return (
                              <div key={cat} className="space-y-1 text-xs">
                                <div className="flex justify-between">
                                  <span className="text-slate-300 font-medium">{cat}</span>
                                  <span className="font-mono text-slate-200 tabular-nums">
                                    {formatCurrency(total)} ({pct}%)
                                  </span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                                  <div
                                    className="h-full bg-goldVip rounded-full"
                                    style={{ width: `${pct}%` }}
                                  />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 1B: PRICE ALERTS (ALERTA DE PREÇO) */}
              {tab === 'alerts' && (
                <div className="space-y-5">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-4">
                      <span className="text-xs text-slate-400">Custo Efetivo Calculado</span>
                      <p className="font-display text-2xl font-extrabold text-white mt-1 tabular-nums">
                        {formatCurrency(summary?.effectiveCostPerKm ?? formSettings.estimatedCostPerKm ?? 1.35)}
                        <span className="text-xs font-normal text-slate-400"> / km</span>
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        Combina custo base + despesas reais do período
                      </p>
                    </div>

                    <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-4">
                      <span className="text-xs text-slate-400">Faixa de Margem Alvo</span>
                      <p className="font-display text-2xl font-extrabold text-emeraldVip mt-1 tabular-nums">
                        {Number(formSettings.minMarginPct ?? 40).toFixed(0)}% –{' '}
                        {Number(formSettings.maxMarginPct ?? 80).toFixed(0)}%
                      </p>
                      <button
                        type="button"
                        onClick={() => setTab('settings')}
                        className="text-[11px] text-goldVip hover:underline mt-1 font-semibold"
                      >
                        Ajustar parâmetros em Tarifas &amp; PIX
                      </button>
                    </div>

                    <div className="rounded-2xl bg-slate-900/80 border border-amber-400/30 p-4">
                      <span className="text-xs text-slate-400">Viagens Fora da Margem</span>
                      <p
                        className={`font-display text-2xl font-extrabold mt-1 tabular-nums ${
                          priceAlerts.length > 0 ? 'text-amber-300' : 'text-emeraldVip'
                        }`}
                      >
                        {priceAlerts.length} alerta(s)
                      </p>
                      <p className="text-[11px] text-slate-500 mt-1">
                        {priceAlerts.filter((a) => a.alertType === 'LOW_MARGIN').length} abaixo do piso ·{' '}
                        {priceAlerts.filter((a) => a.alertType === 'HIGH_MARGIN').length} acima do teto
                      </p>
                    </div>
                  </div>

                  {priceAlerts.length === 0 ? (
                    <div className="rounded-2xl bg-emeraldVip/10 border border-emeraldVip/30 p-6 text-center space-y-2">
                      <CheckCircle2 className="w-8 h-8 text-emeraldVip mx-auto" />
                      <h3 className="font-display font-bold text-sm text-white">
                        Todas as corridas estão dentro da margem saudável
                      </h3>
                      <p className="text-xs text-slate-300 max-w-lg mx-auto">
                        Nenhuma viagem neste período apresentou custo total fora da faixa de lucro configurada ({Number(formSettings.minMarginPct ?? 40).toFixed(0)}% a {Number(formSettings.maxMarginPct ?? 80).toFixed(0)}%).
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {priceAlerts.map((alert) => {
                        const isLow = alert.alertType === 'LOW_MARGIN';
                        return (
                          <div
                            key={alert.rideCode}
                            className={`rounded-2xl p-4 border space-y-3 ${
                              isLow
                                ? 'bg-red-950/30 border-red-500/35'
                                : 'bg-amber-950/25 border-amber-400/35'
                            }`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="space-y-1 min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <span
                                    className={`px-2 py-0.5 rounded-md font-bold text-[10px] uppercase tracking-wider ${
                                      isLow
                                        ? 'bg-red-500/25 text-red-200 border border-red-400/30'
                                        : 'bg-amber-500/25 text-amber-200 border border-amber-400/30'
                                    }`}
                                  >
                                    {isLow ? 'Margem Baixa' : 'Acima da Faixa'}
                                  </span>
                                  <span className="font-mono font-bold text-white">{alert.rideCode}</span>
                                  <span className="text-slate-400">·</span>
                                  <span className="text-emeraldVip font-semibold">{alert.clientName}</span>
                                  <span className="text-slate-400 tabular-nums">
                                    {alert.scheduledDate} {alert.scheduledTime}
                                  </span>
                                </div>
                                <p className="text-xs text-slate-200 truncate">
                                  {alert.originName} → {alert.destinationName} ({Number(alert.effectiveKm || 0).toFixed(1)} km)
                                </p>
                              </div>

                              <div className="text-right shrink-0">
                                <p className="text-[11px] text-slate-400">Margem Real</p>
                                <p
                                  className={`font-display text-lg font-extrabold tabular-nums ${
                                    isLow ? 'text-red-300' : 'text-amber-300'
                                  }`}
                                >
                                  {Number(alert.marginPct || 0).toFixed(1)}%
                                </p>
                              </div>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs bg-slate-950/60 border border-white/5 rounded-xl p-3">
                              <div>
                                <span className="text-[10px] text-slate-400 block">Valor Cobrado</span>
                                <span className="font-mono font-bold text-white tabular-nums">
                                  {formatCurrency(alert.price)}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block">Custo Estimado</span>
                                <span className="font-mono font-bold text-red-300 tabular-nums">
                                  {formatCurrency(alert.estimatedCost)}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block">Lucro Estimado</span>
                                <span className="font-mono font-bold text-emeraldVip tabular-nums">
                                  {formatCurrency(alert.estimatedProfit)}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] text-slate-400 block">Preço Mín. Sugerido</span>
                                <span className="font-mono font-bold text-goldVip tabular-nums">
                                  {formatCurrency(alert.suggestedMinPrice)}
                                </span>
                              </div>
                            </div>

                            <p className="text-xs text-slate-300">{alert.message}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 1C: RECARGAS, CARTEIRAS DOS CLIENTES & CLUBE VIP */}
              {tab === 'wallets' && (
                <div className="space-y-6">
                  {/* Pending Pix Top-ups */}
                  <div className="rounded-2xl bg-slate-900/80 border border-emeraldVip/25 p-4 sm:p-5 space-y-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display font-bold text-sm text-white flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-emeraldVip" />
                        Solicitações de Crédito via Pix ({pendingTopupsCount} pendente(s))
                      </h3>
                      <span className="text-[11px] text-slate-400">
                        Chave oficial: <code className="text-emeraldVip">{formSettings.pixKey}</code>
                      </span>
                    </div>

                    {topups.length === 0 ? (
                      <p className="text-xs text-slate-400 py-3">
                        Nenhuma solicitação de recarga via Pix registrada até o momento.
                      </p>
                    ) : (
                      <div className="space-y-2.5">
                        {topups.map((t) => (
                          <div
                            key={t.id}
                            className={`rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs ${
                              t.status === 'Pendente'
                                ? 'bg-amber-950/25 border-amber-400/35'
                                : 'bg-slate-950/60 border-white/10 opacity-80'
                            }`}
                          >
                            <div className="space-y-0.5 min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-mono font-bold text-white">
                                  {t.requestCode}
                                </span>
                                <span className="font-bold text-emeraldVip">{t.userName}</span>
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                    t.status === 'Aprovado'
                                      ? 'bg-emeraldVip/20 text-emeraldVip'
                                      : t.status === 'Rejeitado'
                                        ? 'bg-red-500/20 text-red-300'
                                        : 'bg-amber-500/20 text-amber-300'
                                  }`}
                                >
                                  {t.status}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                {t.userPhone || 'Sem WhatsApp'} · {t.userEmail} ·{' '}
                                {new Date(t.createdAt).toLocaleString('pt-BR')}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <span className="font-display text-base font-extrabold text-white tabular-nums mr-1">
                                {formatCurrency(t.amount)}
                              </span>
                              {t.status === 'Pendente' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={walletBusyKey === `topup-${t.id}`}
                                    onClick={() => handleReviewTopup(t.id, true)}
                                    className="px-3.5 py-2 rounded-xl bg-emeraldVip hover:brightness-110 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5"
                                  >
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    Aprovar e Creditar Saldo
                                  </button>
                                  <button
                                    type="button"
                                    disabled={walletBusyKey === `topup-${t.id}`}
                                    onClick={() => handleReviewTopup(t.id, false)}
                                    className="px-3 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 text-red-300 font-semibold text-xs"
                                  >
                                    Rejeitar
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Pending Clube VIP Payment Confirmations */}
                  {vipRequests.length > 0 && (
                    <div className="rounded-2xl bg-slate-900/80 border border-goldVip/30 p-4 sm:p-5 space-y-3">
                      <h3 className="font-display font-bold text-sm text-white flex items-center gap-2">
                        <Crown className="w-4 h-4 text-goldVip" />
                        Avisos de Pagamento Clube VIP (R$ 12,90/mês) · {pendingVipCount} pendente(s)
                      </h3>
                      <div className="space-y-2">
                        {vipRequests.map((vr) => (
                          <div
                            key={vr.id}
                            className={`rounded-xl border p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs ${
                              vr.status === 'Pendente'
                                ? 'bg-goldVip/10 border-goldVip/35'
                                : 'bg-slate-950/60 border-white/10 opacity-75'
                            }`}
                          >
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-white">{vr.userName}</span>
                                <span className="text-goldVip font-bold tabular-nums">
                                  {formatCurrency(vr.amount)}
                                </span>
                                <span className="px-2 py-0.5 rounded-md bg-slate-800 text-[10px] font-bold text-slate-200">
                                  {vr.status}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400">
                                {vr.userPhone || 'Sem WhatsApp'} · {vr.userEmail} ·{' '}
                                {new Date(vr.createdAt).toLocaleString('pt-BR')}
                              </p>
                            </div>
                            {vr.status === 'Pendente' && (
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  disabled={walletBusyKey === `vipreq-${vr.id}`}
                                  onClick={() => handleReviewVipRequest(vr.id, true)}
                                  className="px-3.5 py-2 rounded-xl bg-goldVip text-slate-950 font-bold text-xs hover:brightness-110 inline-flex items-center gap-1"
                                >
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  Aprovar &amp; Ativar VIP
                                </button>
                                <button
                                  type="button"
                                  disabled={walletBusyKey === `vipreq-${vr.id}`}
                                  onClick={() => handleReviewVipRequest(vr.id, false)}
                                  className="px-3 py-2 rounded-xl bg-red-500/20 text-red-300 font-semibold text-xs"
                                >
                                  Rejeitar
                                </button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Client Wallets Management (Manual Balance +/- & Penalty & VIP) */}
                  <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-4 sm:p-5 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h3 className="font-display font-bold text-sm text-white">
                          Carteiras dos Clientes &amp; Ajuste Manual ({clients.length})
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Adicione ou remova saldo manualmente, quite multas de cancelamento e gerencie assinantes VIP.
                        </p>
                      </div>
                      <div className="relative w-full sm:w-64">
                        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                        <input
                          type="text"
                          value={clientSearch}
                          onChange={(e) => setClientSearch(e.target.value)}
                          placeholder="Buscar cliente, e-mail, WhatsApp..."
                          className="w-full bg-slate-950 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
                        />
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      {filteredClients.map((c) => {
                        const isAdjusting = adjustTargetUid === c.uid;
                        return (
                          <div
                            key={c.uid}
                            className="rounded-xl bg-slate-950/75 border border-white/10 p-3.5 space-y-3 text-xs"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-bold text-white">{c.name}</span>
                                  {c.vipActive && (
                                    <span className="px-2 py-0.5 rounded-md bg-goldVip/20 text-goldVip text-[10px] font-bold">
                                      CLUBE VIP
                                    </span>
                                  )}
                                  {c.pendingPenalty > 0 && (
                                    <span className="px-2 py-0.5 rounded-md bg-red-500/20 text-red-300 text-[10px] font-bold tabular-nums">
                                      Multa Pendente: {formatCurrency(c.pendingPenalty)}
                                    </span>
                                  )}
                                </div>
                                <p className="text-[11px] text-slate-400">
                                  {c.phone || 'Sem WhatsApp'} · {c.email} · {c.points} pts
                                </p>
                              </div>

                              <div className="flex flex-wrap items-center gap-2">
                                <div className="text-right mr-2">
                                  <span className="text-[10px] text-slate-400 block">Saldo Carteira</span>
                                  <span className="font-display font-extrabold text-sm text-emeraldVip tabular-nums">
                                    {formatCurrency(c.walletBalance)}
                                  </span>
                                </div>

                                <button
                                  type="button"
                                  onClick={() =>
                                    setAdjustTargetUid(isAdjusting ? null : c.uid)
                                  }
                                  className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white"
                                >
                                  {isAdjusting ? 'Fechar Ajuste' : 'Ajustar Saldo (+/-)'}
                                </button>

                                {c.pendingPenalty > 0 && (
                                  <button
                                    type="button"
                                    disabled={walletBusyKey === `penalty-${c.uid}`}
                                    onClick={() => handleSettlePenalty(c.uid)}
                                    className="px-3 py-1.5 rounded-lg bg-emeraldVip/20 hover:bg-emeraldVip/30 text-emeraldVip text-xs font-bold"
                                  >
                                    Quitar Multa
                                  </button>
                                )}

                                <button
                                  type="button"
                                  disabled={walletBusyKey === `vip-${c.uid}`}
                                  onClick={() => handleToggleUserVip(c.uid, !c.vipActive)}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
                                    c.vipActive
                                      ? 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                                      : 'bg-goldVip/20 hover:bg-goldVip/30 text-goldVip'
                                  }`}
                                >
                                  {c.vipActive ? 'Desativar VIP' : 'Ativar VIP'}
                                </button>
                              </div>
                            </div>

                            {isAdjusting && (
                              <div className="pt-2.5 border-t border-white/10 flex flex-wrap items-center gap-2">
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0.01"
                                  value={adjustAmount}
                                  onChange={(e) => setAdjustAmount(e.target.value)}
                                  placeholder="Valor R$"
                                  className="w-28 bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white tabular-nums outline-none"
                                />
                                <input
                                  type="text"
                                  value={adjustReason}
                                  onChange={(e) => setAdjustReason(e.target.value)}
                                  placeholder="Motivo (ex: Bônus Pix / Estorno / Acerto)"
                                  className="flex-1 min-w-[160px] bg-slate-900 border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white outline-none"
                                />
                                <button
                                  type="button"
                                  disabled={walletBusyKey === `adjust-${c.uid}`}
                                  onClick={() => handleAdjustWallet(c.uid, 1)}
                                  className="px-3 py-1.5 rounded-lg bg-emeraldVip text-slate-950 font-bold text-xs hover:brightness-110"
                                >
                                  + Adicionar
                                </button>
                                <button
                                  type="button"
                                  disabled={walletBusyKey === `adjust-${c.uid}`}
                                  onClick={() => handleAdjustWallet(c.uid, -1)}
                                  className="px-3 py-1.5 rounded-lg bg-red-500/20 text-red-300 font-bold text-xs hover:bg-red-500/30"
                                >
                                  - Remover
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: RIDES & SCHEDULE MONITOR */}
              {tab === 'rides' && (
                <div className="space-y-5">
                  {/* Manual Schedule Blocking Panel */}
                  <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-4 space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-display font-bold text-sm text-white flex items-center gap-2">
                          <Clock className="w-4 h-4 text-emeraldVip" />
                          Bloqueios Manuais de Agenda ({scheduleBlocks.length})
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Margem automática por corrida: <strong>{Number(formSettings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN)} min</strong> · Corridas canceladas liberam o horário na hora.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setTab('settings')}
                        className="text-[11px] font-semibold text-goldVip hover:underline"
                      >
                        Ajustar margem ({Number(formSettings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN)} min)
                      </button>
                    </div>

                    <form
                      onSubmit={handleAddScheduleBlock}
                      className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end"
                    >
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                          Data
                        </label>
                        <input
                          type="date"
                          required
                          value={blockDate}
                          onChange={(e) => setBlockDate(e.target.value)}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                          Início
                        </label>
                        <input
                          type="time"
                          required
                          value={blockStartHhmm}
                          onChange={(e) => setBlockStartHhmm(e.target.value)}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                          Término
                        </label>
                        <input
                          type="time"
                          required
                          value={blockEndHhmm}
                          onChange={(e) => setBlockEndHhmm(e.target.value)}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                        />
                      </div>
                      <div className="col-span-2 sm:col-span-1">
                        <label className="text-[10px] text-slate-400 font-semibold block mb-1">
                          Motivo
                        </label>
                        <input
                          type="text"
                          value={blockReason}
                          onChange={(e) => setBlockReason(e.target.value)}
                          placeholder="Almoço / Revisão..."
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-2.5 py-2 text-xs text-white outline-none"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={savingBlock}
                        className="col-span-2 sm:col-span-1 py-2 px-3 rounded-xl bg-emeraldVip text-slate-950 font-bold text-xs hover:brightness-110 flex items-center justify-center gap-1.5"
                      >
                        {savingBlock ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Plus className="w-3.5 h-3.5" />
                        )}
                        Bloquear
                      </button>
                    </form>

                    {scheduleBlocks.length > 0 && (
                      <div className="flex flex-wrap gap-2 pt-1">
                        {scheduleBlocks.map((b) => (
                          <div
                            key={b.id}
                            className="rounded-xl bg-slate-950/80 border border-amber-400/25 px-3 py-1.5 text-[11px] flex items-center gap-2.5"
                          >
                            <span className="font-mono font-bold text-amber-200 tabular-nums">
                              {formatBrDate(b.blockDate)} · {b.startTimeStr} às {b.endTimeStr}
                            </span>
                            <span className="text-slate-300 truncate max-w-[160px]">
                              {b.reason}
                            </span>
                            <button
                              type="button"
                              disabled={deletingBlockId === b.id}
                              onClick={() => handleDeleteScheduleBlock(b.id)}
                              className="text-red-300 hover:text-red-200 font-bold text-[11px]"
                            >
                              {deletingBlockId === b.id ? '...' : 'Liberar'}
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                      {(['Todas', 'Confirmado', 'Em Andamento', 'Concluído', 'Cancelado'] as const).map(
                        (st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => setRideStatusFilter(st)}
                            className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap ${
                              rideStatusFilter === st
                                ? 'bg-emeraldVip text-slate-950'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            {st}
                          </button>
                        )
                      )}
                    </div>

                    <div className="relative w-full sm:w-64">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={rideSearch}
                        onChange={(e) => setRideSearch(e.target.value)}
                        placeholder="Filtrar passageiro, código, local..."
                        className="w-full bg-slate-900 border border-white/10 rounded-xl pl-8 pr-3 py-2 text-xs text-white placeholder-slate-500 outline-none"
                      />
                    </div>
                  </div>

                  {filteredRides.length === 0 ? (
                    <div className="py-12 text-center text-xs text-slate-400 rounded-2xl bg-slate-900/60 border border-white/5">
                      Nenhuma corrida encontrada com os filtros selecionados.
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {filteredRides.map((r) => {
                        const windowSummary = formatRideWindowSummary(r);
                        const isCanceled = r.status === 'Cancelado';
                        return (
                          <div
                            key={r.rideCode}
                            className="rounded-2xl bg-slate-900/75 border border-white/10 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                          >
                            <div className="space-y-1 min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-mono font-bold text-white">{r.rideCode}</span>
                                <span>·</span>
                                <span className="font-semibold text-emeraldVip">{r.clientName}</span>
                                <span>·</span>
                                <span className="text-slate-400 tabular-nums">
                                  {formatBrDate(r.scheduledDate)} {r.scheduledTime}
                                </span>
                                <span>·</span>
                                <span className="font-semibold text-goldVip">{r.status}</span>
                                {windowSummary && (
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold inline-flex items-center gap-1 tabular-nums ${
                                      isCanceled
                                        ? 'bg-slate-800 text-slate-400 line-through'
                                        : 'bg-sky-500/15 text-sky-200 border border-sky-400/25'
                                    }`}
                                  >
                                    <Clock className="w-3 h-3" />
                                    {isCanceled ? `Agenda liberada (${windowSummary})` : windowSummary}
                                  </span>
                                )}
                                {r.paymentMethod && (
                                  <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 text-[10px] font-bold inline-flex items-center gap-1">
                                    <CreditCard className="w-3 h-3 text-emeraldVip" />
                                    {r.paymentMethod}
                                  </span>
                                )}
                                {rideMargins[r.rideCode] && (
                                  <span
                                    className={`px-2 py-0.5 rounded-md text-[10px] font-bold tabular-nums ${
                                      rideMargins[r.rideCode].alertType === 'LOW_MARGIN'
                                        ? 'bg-red-500/20 text-red-200 border border-red-500/30'
                                        : rideMargins[r.rideCode].alertType === 'HIGH_MARGIN'
                                          ? 'bg-amber-500/20 text-amber-200 border border-amber-400/30'
                                          : 'bg-emeraldVip/15 text-emeraldVip border border-emeraldVip/25'
                                    }`}
                                  >
                                    Margem {Number(rideMargins[r.rideCode].marginPct || 0).toFixed(0)}%
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-slate-300 truncate">
                                {r.originName} → {r.destinationName}
                              </p>
                              <p className="text-[11px] text-slate-400 tabular-nums">
                                {formatKmPtBr(r.distanceKm)} km (~{Number(r.durationMin || 0)} min) ·{' '}
                                {r.isRoundTrip || r.category === 'roundtrip'
                                  ? 'Ida e Volta (-10%)'
                                  : 'Executiva'}
                                {r.totalOccupiedMin
                                  ? ` · Ocupação total: ${r.totalOccupiedMin} min`
                                  : ''}
                                {r.paymentStatus ? ` · ${r.paymentStatus}` : ''}
                                {(r.walletDeducted || 0) > 0
                                  ? ` · Carteira -${formatCurrency(r.walletDeducted || 0)}`
                                  : ''}
                                {(r.penaltyIncluded || 0) > 0
                                  ? ` · Inclui multa +${formatCurrency(r.penaltyIncluded || 0)}`
                                  : ''}
                                {r.recurrenceFrequency && r.recurrenceFrequency !== 'none'
                                  ? ` · Recorrência VIP: ${r.recurrenceFrequency}`
                                  : ''}
                                {r.preferences ? ` · Pref: ${r.preferences}` : ''}
                                {r.notes ? ` · Obs: ${r.notes}` : ''}
                              </p>
                            </div>

                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              <span className="font-display text-base font-bold text-white tabular-nums mr-2">
                                {formatCurrency(r.price)}
                              </span>

                              {r.status === 'Confirmado' && (
                                <button
                                  type="button"
                                  disabled={updatingRideCode === r.rideCode}
                                  onClick={() => handleStatusChange(r.rideCode, 'Em Andamento')}
                                  className="px-3 py-1.5 rounded-lg bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 text-xs font-semibold inline-flex items-center gap-1"
                                >
                                  <Play className="w-3 h-3" />
                                  Iniciar
                                </button>
                              )}

                              {(r.status === 'Confirmado' || r.status === 'Em Andamento') && (
                                <>
                                  <button
                                    type="button"
                                    disabled={updatingRideCode === r.rideCode}
                                    onClick={() => handleStatusChange(r.rideCode, 'Concluído')}
                                    className="px-3 py-1.5 rounded-lg bg-emeraldVip text-slate-950 hover:brightness-110 text-xs font-bold inline-flex items-center gap-1"
                                  >
                                    <CheckCircle2 className="w-3 h-3" />
                                    Concluir
                                  </button>
                                  <button
                                    type="button"
                                    disabled={updatingRideCode === r.rideCode}
                                    onClick={() => handleStatusChange(r.rideCode, 'Cancelado')}
                                    className="px-3 py-1.5 rounded-lg bg-red-500/20 hover:bg-red-500/30 text-red-300 text-xs font-semibold inline-flex items-center gap-1"
                                  >
                                    <XCircle className="w-3 h-3" />
                                    Cancelar
                                  </button>
                                </>
                              )}

                              <a
                                href={buildWhatsappUrl(r, settings.whatsapp, settings.pixKey)}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold inline-flex items-center gap-1"
                              >
                                <MessageCircle className="w-3 h-3 text-emeraldVip" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 3: EXPENSES MANAGEMENT */}
              {tab === 'expenses' && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                  <form
                    onSubmit={handleAddExpense}
                    className="lg:col-span-2 rounded-2xl bg-slate-900/80 border border-white/10 p-5 space-y-3.5 h-fit"
                  >
                    <h3 className="font-display font-bold text-sm text-white flex items-center gap-2">
                      <Plus className="w-4 h-4 text-emeraldVip" />
                      Registrar Novo Gasto
                    </h3>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                        Categoria
                      </label>
                      <select
                        value={expCategory}
                        onChange={(e) => setExpCategory(e.target.value as ExpenseCategory)}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      >
                        {EXPENSE_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {c}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                        Descrição
                      </label>
                      <input
                        type="text"
                        required
                        value={expDesc}
                        onChange={(e) => setExpDesc(e.target.value)}
                        placeholder="Ex: Abastecimento Shell Marginal"
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                          Valor (R$)
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0.01"
                          required
                          value={expAmount}
                          onChange={(e) => setExpAmount(e.target.value)}
                          placeholder="240.00"
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                          Data
                        </label>
                        <input
                          type="date"
                          required
                          value={expDate}
                          onChange={(e) => setExpDate(e.target.value)}
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                        Hodômetro (km, opcional)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={expOdometer}
                        onChange={(e) => setExpOdometer(e.target.value)}
                        placeholder="Ex: 58420"
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none tabular-nums"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={savingExpense}
                      className="w-full py-3 rounded-xl bg-emeraldVip text-slate-950 font-bold text-xs hover:brightness-110 flex items-center justify-center gap-2 transition-all"
                    >
                      {savingExpense ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                      Salvar Despesa no Banco
                    </button>
                  </form>

                  <div className="lg:col-span-3 space-y-2.5">
                    <h3 className="font-display font-bold text-sm text-white">
                      Histórico de Gastos Lançados
                    </h3>
                    {expenses.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400 rounded-2xl bg-slate-900/60 border border-white/5">
                        Nenhuma despesa registrada neste período.
                      </div>
                    ) : (
                      expenses.map((exp) => (
                        <div
                          key={exp.id}
                          className="rounded-2xl bg-slate-900/75 border border-white/10 p-3.5 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-white truncate">
                              {exp.category} · {exp.description}
                            </p>
                            <p className="text-[11px] text-slate-400 tabular-nums">
                              {exp.expenseDate}
                              {exp.odometerKm ? ` · ${exp.odometerKm.toLocaleString('pt-BR')} km` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono font-bold text-sm text-red-400 tabular-nums">
                              -{formatCurrency(exp.amount)}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleDeleteExpense(exp.id)}
                              aria-label="Excluir despesa"
                              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-300 flex items-center justify-center transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 3B: PARTNER STORES & VIP RAFFLES */}
              {tab === 'partners' && (
                <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                  <form
                    onSubmit={handleAddRaffle}
                    className="lg:col-span-2 rounded-2xl bg-slate-900/80 border border-white/10 p-5 space-y-3.5 h-fit"
                  >
                    <h3 className="font-display font-bold text-sm text-white flex items-center gap-2">
                      <Ticket className="w-4 h-4 text-goldVip" />
                      Cadastrar Loja Parceira &amp; Sorteio VIP
                    </h3>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                        Nome da Loja Parceira *
                      </label>
                      <input
                        type="text"
                        required
                        value={partnerName}
                        onChange={(e) => setPartnerName(e.target.value)}
                        placeholder="Ex: Empório Paulista"
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                        URL da Logo da Loja (opcional)
                      </label>
                      <input
                        type="url"
                        value={partnerLogoUrl}
                        onChange={(e) => setPartnerLogoUrl(e.target.value)}
                        placeholder="https://..."
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                        Prêmio do Sorteio *
                      </label>
                      <input
                        type="text"
                        required
                        value={prizeTitle}
                        onChange={(e) => setPrizeTitle(e.target.value)}
                        placeholder="Ex: Vale-Compras de R$ 300,00"
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                        Detalhes / Regras (opcional)
                      </label>
                      <input
                        type="text"
                        value={prizeDescription}
                        onChange={(e) => setPrizeDescription(e.target.value)}
                        placeholder="Válido para assinantes ativos R$ 12,90/mês"
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                        Data do Sorteio *
                      </label>
                      <input
                        type="date"
                        required
                        value={drawDate}
                        onChange={(e) => setDrawDate(e.target.value)}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={savingRaffle}
                      className="w-full py-3 rounded-xl bg-goldVip text-slate-950 font-bold text-xs hover:brightness-110 flex items-center justify-center gap-2 transition-all"
                    >
                      {savingRaffle ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Plus className="w-4 h-4" />
                      )}
                      Publicar Sorteio VIP
                    </button>
                  </form>

                  <div className="lg:col-span-3 space-y-2.5">
                    <h3 className="font-display font-bold text-sm text-white">
                      Lojas Parceiras &amp; Sorteios Publicados
                    </h3>
                    {raffles.length === 0 ? (
                      <div className="p-8 text-center text-xs text-slate-400 rounded-2xl bg-slate-900/60 border border-white/5">
                        Nenhuma loja parceira cadastrada ainda. Adicione ao lado para exibir na vitrine VIP.
                      </div>
                    ) : (
                      raffles.map((rf) => (
                        <div
                          key={rf.id}
                          className="rounded-2xl bg-slate-900/75 border border-white/10 p-4 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0 space-y-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold text-goldVip truncate">
                                {rf.partnerName}
                              </span>
                              <span
                                className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${
                                  rf.active
                                    ? 'bg-emeraldVip/15 text-emeraldVip'
                                    : 'bg-slate-800 text-slate-400'
                                }`}
                              >
                                {rf.active ? 'Ativo' : 'Encerrado'}
                              </span>
                            </div>
                            <p className="text-xs font-semibold text-white truncate">
                              {rf.prizeTitle}
                            </p>
                            <p className="text-[11px] text-slate-400 tabular-nums">
                              Sorteio em {rf.drawDate}
                              {rf.prizeDescription ? ` · ${rf.prizeDescription}` : ''}
                            </p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleToggleRaffle(rf.id, !rf.active)}
                              className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200"
                            >
                              {rf.active ? 'Pausar' : 'Ativar'}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteRaffle(rf.id)}
                              aria-label="Excluir sorteio parceiro"
                              className="w-8 h-8 rounded-lg bg-slate-800 hover:bg-red-500/20 text-slate-400 hover:text-red-300 flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: TARIFFS (>= R$ 3.00/KM) & BRAND */}
              {tab === 'settings' && (
                <form
                  onSubmit={handleSaveSettings}
                  className="max-w-2xl rounded-2xl bg-slate-900/80 border border-white/10 p-5 space-y-4"
                >
                  <div>
                    <h3 className="font-display font-bold text-base text-white">
                      Regras Tarifárias & Dados da Marca
                    </h3>
                    <p className="text-xs text-slate-400">
                      O servidor impõe trava automática garantindo no mínimo R$ 3,00/km em todas as opções.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs text-slate-300 font-semibold block mb-1">
                        Executiva — Ida (R$/km · mín. 3,00)
                      </label>
                      <input
                        type="number"
                        step="0.10"
                        min={MIN_KM_RATE}
                        value={formSettings.execKm}
                        onChange={(e) =>
                          setFormSettings((s) => ({ ...s, execKm: Number(e.target.value) }))
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white tabular-nums outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300 font-semibold block mb-1">
                        Ida e Volta (R$/km · mín. 3,00)
                      </label>
                      <input
                        type="number"
                        step="0.10"
                        min={MIN_KM_RATE}
                        value={formSettings.roundTripKm}
                        onChange={(e) =>
                          setFormSettings((s) => ({ ...s, roundTripKm: Number(e.target.value) }))
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white tabular-nums outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300 font-semibold block mb-1">
                        Valor Mínimo por Corrida (R$)
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="15"
                        value={formSettings.minFare}
                        onChange={(e) =>
                          setFormSettings((s) => ({ ...s, minFare: Number(e.target.value) }))
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white tabular-nums outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300 font-semibold block mb-1">
                        Chave PIX Oficial
                      </label>
                      <input
                        type="text"
                        value={formSettings.pixKey}
                        onChange={(e) =>
                          setFormSettings((s) => ({ ...s, pixKey: e.target.value }))
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300 font-semibold block mb-1">
                        WhatsApp do Motorista (DDI + DDD + Número)
                      </label>
                      <input
                        type="text"
                        value={formSettings.whatsapp}
                        onChange={(e) =>
                          setFormSettings((s) => ({ ...s, whatsapp: e.target.value }))
                        }
                        placeholder="5511947476229"
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white font-mono outline-none"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-slate-300 font-semibold block mb-1">
                        Margem de Segurança da Agenda (minutos)
                      </label>
                      <input
                        type="number"
                        step="1"
                        min="0"
                        max="180"
                        value={formSettings.safetyMarginMin ?? DEFAULT_SAFETY_MARGIN_MIN}
                        onChange={(e) =>
                          setFormSettings((s) => ({
                            ...s,
                            safetyMarginMin: Number(e.target.value),
                          }))
                        }
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white tabular-nums outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-3 border-t border-white/10 space-y-3">
                    <div>
                      <h4 className="font-display font-bold text-sm text-white flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-400" />
                        Parâmetros do Alerta de Preço &amp; Margem de Lucro
                      </h4>
                      <p className="text-[11px] text-slate-400">
                        O painel dispara alertas quando uma viagem apresenta margem real fora desta faixa.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div>
                        <label className="text-xs text-slate-300 font-semibold block mb-1">
                          Custo Base (R$/km)
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min="0.30"
                          value={formSettings.estimatedCostPerKm ?? 1.35}
                          onChange={(e) =>
                            setFormSettings((s) => ({
                              ...s,
                              estimatedCostPerKm: Number(e.target.value),
                            }))
                          }
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white tabular-nums outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-300 font-semibold block mb-1">
                          Margem Mínima Alvo (%)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="5"
                          max="90"
                          value={formSettings.minMarginPct ?? 40}
                          onChange={(e) =>
                            setFormSettings((s) => ({
                              ...s,
                              minMarginPct: Number(e.target.value),
                            }))
                          }
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white tabular-nums outline-none"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-slate-300 font-semibold block mb-1">
                          Margem Máxima Alvo (%)
                        </label>
                        <input
                          type="number"
                          step="1"
                          min="10"
                          max="98"
                          value={formSettings.maxMarginPct ?? 80}
                          onChange={(e) =>
                            setFormSettings((s) => ({
                              ...s,
                              maxMarginPct: Number(e.target.value),
                            }))
                          }
                          className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white tabular-nums outline-none"
                        />
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingSettings}
                    className="px-5 py-3 rounded-xl bg-emeraldVip text-slate-950 font-bold text-xs hover:brightness-110 inline-flex items-center gap-2 transition-all"
                  >
                    {savingSettings ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Car className="w-4 h-4" />
                    )}
                    Atualizar Tarifas no Firestore
                  </button>
                </form>
              )}

              {/* TAB 5: SECURITY ARCHITECTURE */}
              {tab === 'security' && (
                <div className="max-w-3xl rounded-2xl bg-slate-900/80 border border-white/10 p-5 space-y-3">
                  <h3 className="font-display font-bold text-base text-white flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-emeraldVip" />
                    Melhorias de Segurança Implementadas
                  </h3>
                  <ul className="space-y-2.5 text-xs text-slate-300 leading-relaxed">
                    <li>
                      • <strong className="text-white">Autenticação Zero-Trust via Firebase Auth Pop-up:</strong> O acesso administrativo é restrito estritamente à conta Google verificada <code className="text-emeraldVip">reisanselmo7@gmail.com</code> tanto na interface quanto nas regras do banco.
                    </li>
                    <li>
                      • <strong className="text-white">Auditoria e Piso de Preço + Anti-Escalação:</strong> As regras <code className="text-emeraldVip">firestore.rules</code> impedem que qualquer passageiro altere saldo da carteira, status Clube VIP ou aumente pontos manualmente, validando transações atômicas diretamente no Firestore.
                    </li>
                    <li>
                      • <strong className="text-white">Agenda Anti-Conflito sem Expor Dados Privados:</strong> A coleção <code className="text-emeraldVip">scheduleSlots</code> bloqueia horários ocupados em tempo real sem expor nome, telefone ou endereço de outros passageiros.
                    </li>
                    <li>
                      • <strong className="text-white">Comunicação 100% SDK Oficial Firebase Firestore:</strong> Leituras e gravações ocorrem diretamente via <code className="text-emeraldVip">firebase/firestore</code> sem intermediários que retornem HTML/404 em deploy estático.
                    </li>
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
