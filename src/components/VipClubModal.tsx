import { useEffect, useState } from 'react';
import {
  Award,
  Calendar,
  CheckCircle2,
  Crown,
  ExternalLink,
  Gift,
  Loader2,
  Lock,
  Repeat,
  Sliders,
  Sparkles,
  Store,
  Ticket,
  X,
} from 'lucide-react';
import { doc } from 'firebase/firestore';
import {
  VIP_CHECKOUT_URL,
  VIP_MONTHLY_PRICE,
  api,
  formatCurrency,
} from '../services/api.ts';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  serverTimestamp,
  setDoc,
} from '../lib/firebase.ts';
import { PartnerRaffle, UserProfile, VipPreferences, Voucher } from '../types.ts';

interface VipClubModalProps {
  isOpen: boolean;
  initialTab?: 'membership' | 'recurrence' | 'raffles';
  user: UserProfile;
  vouchers: Voucher[];
  selectedVoucherCode: string | null;
  onClose: () => void;
  onSelectVoucher: (voucher: Voucher | null) => void;
  onVoucherRedeemed: (voucher: Voucher, newPoints: number) => void;
  onUserUpdated: (user: UserProfile) => void;
}

const REWARDS: {
  id: 'desconto_15' | 'desconto_35' | 'upgrade_exec';
  title: string;
  desc: string;
  cost: number;
  value: number;
}[] = [
  {
    id: 'desconto_15',
    title: 'Desconto Prata R$ 15',
    desc: 'Abate R$ 15,00 na próxima corrida executiva ou aeroporto.',
    cost: 300,
    value: 15,
  },
  {
    id: 'desconto_35',
    title: 'Voucher Executivo R$ 35',
    desc: 'Ideal para trajetos corporativos ou transfers GRU/CGH.',
    cost: 700,
    value: 35,
  },
  {
    id: 'upgrade_exec',
    title: 'Cortesia Black R$ 60',
    desc: 'Crédito máximo VIP aplicável em reservas Ida e Volta.',
    cost: 1200,
    value: 60,
  },
];

export function VipClubModal({
  isOpen,
  initialTab = 'membership',
  user,
  vouchers,
  selectedVoucherCode,
  onClose,
  onSelectVoucher,
  onVoucherRedeemed,
  onUserUpdated,
}: VipClubModalProps) {
  const [tab, setTab] = useState<'membership' | 'recurrence' | 'raffles'>(initialTab);
  const [redeemingId, setRedeemingId] = useState<string | null>(null);
  const [subscribing, setSubscribing] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [raffles, setRaffles] = useState<PartnerRaffle[]>([]);
  const [loadingRaffles, setLoadingRaffles] = useState(false);

  const [prefs, setPrefs] = useState<VipPreferences>({
    acTemp: user.vipPreferences?.acTemp || '21°C (Conforto)',
    rideStyle: user.vipPreferences?.rideStyle || 'Viagem Silenciosa',
    favoriteTime: user.vipPreferences?.favoriteTime || '08:00',
    favoriteRoute: user.vipPreferences?.favoriteRoute || '',
  });

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      setErrorMsg(null);
      setSuccessMsg(null);
      setPrefs({
        acTemp: user.vipPreferences?.acTemp || '21°C (Conforto)',
        rideStyle: user.vipPreferences?.rideStyle || 'Viagem Silenciosa',
        favoriteTime: user.vipPreferences?.favoriteTime || '08:00',
        favoriteRoute: user.vipPreferences?.favoriteRoute || '',
      });
    }
  }, [isOpen, initialTab, user.vipPreferences]);

  useEffect(() => {
    if (!isOpen) return;
    setLoadingRaffles(true);
    api
      .getRaffles()
      .then((res) => setRaffles(res.raffles || []))
      .catch(() => setRaffles([]))
      .finally(() => setLoadingRaffles(false));
  }, [isOpen]);

  if (!isOpen) return null;

  const nextTierPoints =
    user.points < 400 ? 400 : user.points < 1000 ? 1000 : user.points < 2500 ? 2500 : 2500;
  const progressPct = Math.min(100, Math.round((user.points / nextTierPoints) * 100));

  const handleNotifyPayment = async () => {
    if (user.isGuest) {
      setErrorMsg('Entre com sua conta Google para informar o pagamento do Clube VIP.');
      return;
    }
    setErrorMsg(null);
    setSuccessMsg(null);
    setSubscribing(true);
    try {
      const res = await api.requestVipActivation(
        `Solicitação enviada pelo app após checkout Mercado Pago (${VIP_CHECKOUT_URL})`
      );
      if (auth.currentUser && res.vipRequest?.id) {
        const docId = `VIPREQ-${res.vipRequest.id}`;
        try {
          await setDoc(doc(db, 'vipRequests', docId), {
            userId: user.uid,
            userName: (user.name || 'Passageiro VIP').slice(0, 120),
            amount: VIP_MONTHLY_PRICE,
            status: 'Pendente',
            createdAt: serverTimestamp(),
          });
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.CREATE, `vipRequests/${docId}`);
        }
      }
      setSuccessMsg(
        'Aviso de pagamento enviado! O motorista administrador validará sua assinatura Clube VIP em instantes.'
      );
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao informar pagamento da assinatura VIP.');
    } finally {
      setSubscribing(false);
    }
  };

  const handleCancelVip = async () => {
    setErrorMsg(null);
    setSubscribing(true);
    try {
      const res = await api.cancelVip();
      onUserUpdated(res.user);
      setSuccessMsg('Assinatura VIP encerrada. Seus pontos acumulados continuam salvos.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao cancelar assinatura.');
    } finally {
      setSubscribing(false);
    }
  };

  const handleSavePrefs = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user.vipActive || user.isGuest) return;
    setSavingPrefs(true);
    setErrorMsg(null);
    try {
      const res = await api.updateVipPreferences(prefs);
      onUserUpdated(res.user);
      setSuccessMsg('Preferências de conforto e recorrência VIP salvas com sucesso.');
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao salvar preferências.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const handleRedeem = async (rewardId: 'desconto_15' | 'desconto_35' | 'upgrade_exec') => {
    if (user.isGuest) {
      setErrorMsg('Entre com sua conta Google para resgatar e salvar benefícios reais.');
      return;
    }
    setErrorMsg(null);
    setRedeemingId(rewardId);
    try {
      const res = await api.redeemVoucher(rewardId);
      onVoucherRedeemed(res.voucher, res.points);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível resgatar este benefício.');
    } finally {
      setRedeemingId(null);
    }
  };

  const unusedVouchers = vouchers.filter((v) => !v.used);

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-goldVip/30 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-goldVip/15 border border-goldVip/35 text-goldVip flex items-center justify-center">
              <Crown className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-lg text-white">Clube VIP Gustavo Reis</h3>
                <span className="px-2 py-0.5 rounded-md bg-goldVip/20 text-goldVip text-[10px] font-extrabold border border-goldVip/30">
                  {formatCurrency(VIP_MONTHLY_PRICE)}/mês
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Recorrência &amp; preferências · Pontos em dobro · Sorteios exclusivos
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Clube VIP"
            className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Navigation Tabs */}
        <div className="px-5 py-2.5 border-b border-white/10 bg-slate-900/50 flex items-center gap-2 overflow-x-auto no-scrollbar shrink-0">
          {[
            { id: 'membership' as const, label: 'Assinatura & Pontos', icon: Crown },
            { id: 'recurrence' as const, label: 'Recorrência & Preferências', icon: Repeat },
            { id: 'raffles' as const, label: `Sorteios Parceiros (${raffles.length})`, icon: Ticket },
          ].map((item) => {
            const Icon = item.icon;
            const active = tab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setTab(item.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 transition-colors ${
                  active
                    ? 'bg-goldVip text-slate-950 font-bold'
                    : 'bg-slate-800/75 text-slate-300 hover:bg-slate-800'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-200">
              {errorMsg}
            </div>
          )}
          {successMsg && (
            <div className="p-3 rounded-xl bg-emeraldVip/15 border border-emeraldVip/30 text-xs text-emeraldVip flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              {successMsg}
            </div>
          )}

          {/* TAB 1: MEMBERSHIP & POINTS */}
          {tab === 'membership' && (
            <div className="space-y-5">
              {/* Subscription Plan Banner */}
              <div
                className={`rounded-2xl p-5 border space-y-3 ${
                  user.vipActive
                    ? 'bg-gradient-to-br from-emerald-950/60 via-slate-900 to-amber-950/35 border-emeraldVip/40'
                    : 'bg-gradient-to-br from-slate-900 via-slate-900 to-amber-950/40 border-goldVip/35'
                }`}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span
                      className={`px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${
                        user.vipActive
                          ? 'bg-emeraldVip/20 text-emeraldVip border border-emeraldVip/30'
                          : 'bg-goldVip/20 text-goldVip border border-goldVip/30'
                      }`}
                    >
                      {user.vipActive ? 'Assinatura Ativa' : 'Plano Clube VIP'}
                    </span>
                    <h4 className="font-display text-xl font-extrabold text-white mt-1.5">
                      {user.vipActive
                        ? 'Você é Assinante Clube VIP'
                        : `Assine por ${formatCurrency(VIP_MONTHLY_PRICE)}/mês`}
                    </h4>
                  </div>

                  {user.vipActive ? (
                    <button
                      type="button"
                      disabled={subscribing}
                      onClick={handleCancelVip}
                      className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300"
                    >
                      {subscribing ? 'Atualizando...' : 'Cancelar Assinatura'}
                    </button>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        href={VIP_CHECKOUT_URL}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-4 py-2.5 rounded-xl bg-goldVip hover:brightness-110 text-slate-950 font-bold text-xs inline-flex items-center gap-1.5 shadow-lg shadow-goldVip/20"
                      >
                        <Crown className="w-3.5 h-3.5" />
                        Assinar Clube VIP · {formatCurrency(VIP_MONTHLY_PRICE)}/mês
                        <ExternalLink className="w-3 h-3" />
                      </a>
                      <button
                        type="button"
                        disabled={subscribing}
                        onClick={handleNotifyPayment}
                        className="px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-slate-200 font-semibold text-xs inline-flex items-center gap-1.5"
                      >
                        {subscribing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emeraldVip" />
                        )}
                        Já realizei o pagamento / Informar Assinatura
                      </button>
                    </div>
                  )}
                </div>

                <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-[11px] text-slate-200 pt-1">
                  <li className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5">
                    <strong className="text-emeraldVip block">1. Recorrência &amp; Preferências</strong>
                    Viagens Diárias, Semanais ou Mensais com ar e música salvos.
                  </li>
                  <li className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5">
                    <strong className="text-goldVip block">2. Pontos + Desconto Direto</strong>
                    Ganhe pontos em dobro e abata R$ 5 a cada 100 pts direto na cotação.
                  </li>
                  <li className="rounded-xl bg-slate-950/60 border border-white/5 p-2.5">
                    <strong className="text-sky-300 block">3. Sorteios Parceiros</strong>
                    Participação garantida nos prêmios de lojas parceiras todo mês.
                  </li>
                </ul>
              </div>

              {/* Tier & Points Card */}
              <div className="rounded-2xl bg-slate-900/85 border border-white/10 p-4">
                <div className="flex items-center justify-between gap-4 mb-3">
                  <div>
                    <span className="text-xs text-goldVip font-semibold uppercase tracking-wider">
                      Nível Fidelidade
                    </span>
                    <h4 className="font-display text-2xl font-extrabold text-white mt-0.5">
                      {user.tier}
                    </h4>
                  </div>
                  <div className="text-right">
                    <span className="text-xs text-slate-400">Saldo Acumulado</span>
                    <p className="font-display text-2xl font-extrabold text-goldVip tabular-nums">
                      {user.points} pts
                    </p>
                    <p className="text-[10px] text-emeraldVip tabular-nums">
                      Equivalente a {formatCurrency(Math.floor(user.points / 100) * 5)} em desconto VIP
                    </p>
                  </div>
                </div>

                <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden mb-2">
                  <div
                    className="h-full bg-gradient-to-r from-emeraldVip to-goldVip transition-all duration-300"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>Bronze (0%) · Prata (-5%) · Ouro (-10%) · Black (-15%)</span>
                  <span className="tabular-nums">Meta: {nextTierPoints} pts</span>
                </div>
              </div>

              {/* Active Vouchers */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <Gift className="w-4 h-4 text-emeraldVip" />
                  Seus Vouchers Disponíveis ({unusedVouchers.length})
                </h4>
                {unusedVouchers.length === 0 ? (
                  <p className="text-xs text-slate-400 rounded-2xl bg-slate-900/60 border border-white/5 p-3.5">
                    Nenhum voucher resgatado no momento. Assinantes VIP também podem aplicar pontos diretamente na tela de cotação!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {unusedVouchers.map((v) => {
                      const active = selectedVoucherCode === v.voucherCode;
                      return (
                        <div
                          key={v.voucherCode}
                          className={`p-3.5 rounded-2xl border flex items-center justify-between gap-3 ${
                            active
                              ? 'bg-emeraldVip/10 border-emeraldVip/40'
                              : 'bg-slate-900/70 border-white/10'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-white truncate">{v.title}</p>
                            <p className="text-xs text-slate-400 font-mono">
                              {v.voucherCode} · Desconto {formatCurrency(v.discountValue)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              onSelectVoucher(active ? null : v);
                              onClose();
                            }}
                            className={`px-3.5 py-2 rounded-xl text-xs font-bold shrink-0 transition-colors ${
                              active
                                ? 'bg-slate-800 text-slate-200 hover:bg-slate-700'
                                : 'bg-emeraldVip text-slate-950 hover:brightness-110'
                            }`}
                          >
                            {active ? 'Remover' : 'Aplicar na Corrida'}
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Redeem Catalog */}
              <div>
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <Sparkles className="w-4 h-4 text-goldVip" />
                  Trocar Pontos por Vouchers
                </h4>
                <div className="space-y-2.5">
                  {REWARDS.map((reward) => {
                    const canAfford = user.points >= reward.cost;
                    const isBusy = redeemingId === reward.id;
                    return (
                      <div
                        key={reward.id}
                        className="p-4 rounded-2xl bg-slate-900/75 border border-white/10 flex items-center justify-between gap-4"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <Award className="w-4 h-4 text-goldVip shrink-0" />
                            <p className="text-sm font-bold text-white truncate">{reward.title}</p>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{reward.desc}</p>
                          <p className="text-xs font-semibold text-goldVip mt-1 tabular-nums">
                            Custo: {reward.cost} pts
                          </p>
                        </div>
                        <button
                          type="button"
                          disabled={!canAfford || isBusy}
                          onClick={() => handleRedeem(reward.id)}
                          className={`px-4 py-2.5 rounded-xl text-xs font-bold shrink-0 flex items-center gap-1.5 transition-all ${
                            canAfford
                              ? 'bg-goldVip text-slate-950 hover:brightness-110'
                              : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                          }`}
                        >
                          {isBusy ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                          {isBusy ? 'Resgatando' : canAfford ? 'Resgatar' : 'Pontos Insuf.'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: RECURRENCE & PREFERENCES */}
          {tab === 'recurrence' && (
            <div className="space-y-4">
              {!user.vipActive ? (
                <div className="rounded-2xl bg-slate-900/85 border border-goldVip/30 p-6 text-center space-y-3">
                  <div className="w-12 h-12 rounded-2xl bg-goldVip/15 border border-goldVip/30 text-goldVip flex items-center justify-center mx-auto">
                    <Lock className="w-6 h-6" />
                  </div>
                  <h4 className="font-display font-bold text-base text-white">
                    Agendamento Recorrente &amp; Preferências Exclusivas
                  </h4>
                  <p className="text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
                    Programe rotas fixas <strong>Diárias, Semanais ou Mensais</strong> e salve suas preferências de ar-condicionado, viagem silenciosa ou música ambiente. Recurso exclusivo do Clube VIP por apenas{' '}
                    <strong>{formatCurrency(VIP_MONTHLY_PRICE)}/mês</strong>.
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    <a
                      href={VIP_CHECKOUT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-5 py-3 rounded-2xl bg-goldVip hover:brightness-110 text-slate-950 font-bold text-xs inline-flex items-center gap-2 shadow-lg shadow-goldVip/20"
                    >
                      <Crown className="w-4 h-4" />
                      Assinar Clube VIP ({formatCurrency(VIP_MONTHLY_PRICE)}/mês)
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                    <button
                      type="button"
                      disabled={subscribing}
                      onClick={handleNotifyPayment}
                      className="px-4 py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-semibold text-slate-200 inline-flex items-center gap-1.5"
                    >
                      {subscribing ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emeraldVip" />
                      )}
                      Já realizei o pagamento
                    </button>
                  </div>
                </div>
              ) : (
                <form
                  onSubmit={handleSavePrefs}
                  className="rounded-2xl bg-slate-900/80 border border-white/10 p-5 space-y-4"
                >
                  <div className="flex items-center gap-2">
                    <Sliders className="w-4 h-4 text-emeraldVip" />
                    <h4 className="font-display font-bold text-sm text-white">
                      Preferências Padrão de Bordo (Clube VIP Ativo)
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        Temperatura do Ar-Condicionado
                      </label>
                      <select
                        value={prefs.acTemp}
                        onChange={(e) => setPrefs((p) => ({ ...p, acTemp: e.target.value }))}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      >
                        <option value="18°C (Bem Frio)">18°C (Bem Frio)</option>
                        <option value="21°C (Conforto)">21°C (Conforto)</option>
                        <option value="23°C (Suave)">23°C (Suave)</option>
                        <option value="Janelas Abertas">Janelas Abertas</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        Ambiente &amp; Som
                      </label>
                      <select
                        value={prefs.rideStyle}
                        onChange={(e) => setPrefs((p) => ({ ...p, rideStyle: e.target.value }))}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      >
                        <option value="Viagem Silenciosa">Viagem Silenciosa (Foco/Trabalho)</option>
                        <option value="Música Ambiente Suave">Música Ambiente Suave</option>
                        <option value="Rádio Notícias / Executivo">Rádio Notícias / Executivo</option>
                        <option value="Conversa Amigável">Conversa Amigável</option>
                      </select>
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        Horário Fixo Preferido
                      </label>
                      <input
                        type="time"
                        value={prefs.favoriteTime || '08:00'}
                        onChange={(e) => setPrefs((p) => ({ ...p, favoriteTime: e.target.value }))}
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-semibold text-slate-300 block mb-1">
                        Trajeto / Endereço Favorito
                      </label>
                      <input
                        type="text"
                        value={prefs.favoriteRoute || ''}
                        onChange={(e) => setPrefs((p) => ({ ...p, favoriteRoute: e.target.value }))}
                        placeholder="Ex: Casa -> Faria Lima 3477"
                        className="w-full bg-slate-950 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-white outline-none"
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={savingPrefs}
                    className="px-5 py-2.5 rounded-xl bg-emeraldVip text-slate-950 font-bold text-xs hover:brightness-110 inline-flex items-center gap-2"
                  >
                    {savingPrefs ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    Salvar Preferências VIP
                  </button>
                </form>
              )}
            </div>
          )}

          {/* TAB 3: PARTNER STORE RAFFLES */}
          {tab === 'raffles' && (
            <div className="space-y-4">
              {!user.vipActive && (
                <div className="rounded-2xl bg-goldVip/10 border border-goldVip/30 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
                  <div className="flex items-center gap-2 text-amber-100">
                    <Lock className="w-4 h-4 text-goldVip shrink-0" />
                    <span>
                      Assine o Clube VIP por <strong>{formatCurrency(VIP_MONTHLY_PRICE)}/mês</strong> para garantir sua participação em todos os sorteios abaixo.
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={VIP_CHECKOUT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="px-3.5 py-2 rounded-xl bg-goldVip text-slate-950 font-bold text-[11px] hover:brightness-110 whitespace-nowrap inline-flex items-center gap-1"
                    >
                      Assinar Clube VIP
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      type="button"
                      disabled={subscribing}
                      onClick={handleNotifyPayment}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 whitespace-nowrap"
                    >
                      Informar Pagamento
                    </button>
                  </div>
                </div>
              )}

              {loadingRaffles ? (
                <div className="py-10 flex items-center justify-center gap-2 text-xs text-slate-400">
                  <Loader2 className="w-4 h-4 animate-spin text-goldVip" />
                  Carregando sorteios em lojas parceiras...
                </div>
              ) : raffles.length === 0 ? (
                <div className="rounded-2xl bg-slate-900/75 border border-white/10 p-6 text-center space-y-2">
                  <Store className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-sm font-semibold text-white">
                    Nenhum sorteio ativo cadastrado no momento
                  </p>
                  <p className="text-xs text-slate-400">
                    Novas lojas parceiras e prêmios são divulgados aqui assim que publicados pelo motorista Gustavo Reis.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3">
                  {raffles.map((raffle) => (
                    <div
                      key={raffle.id}
                      className="rounded-2xl bg-slate-900/85 border border-white/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                    >
                      <div className="flex items-start gap-3.5 min-w-0">
                        {raffle.partnerLogoUrl ? (
                          <img
                            src={raffle.partnerLogoUrl}
                            alt={raffle.partnerName}
                            referrerPolicy="no-referrer"
                            className="w-12 h-12 rounded-xl object-cover border border-white/10 shrink-0 bg-slate-950"
                          />
                        ) : (
                          <div className="w-12 h-12 rounded-xl bg-goldVip/15 border border-goldVip/30 text-goldVip font-display font-extrabold text-sm flex items-center justify-center shrink-0">
                            {raffle.partnerName.slice(0, 2).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-bold text-goldVip uppercase tracking-wider">
                              {raffle.partnerName}
                            </span>
                            <span className="text-[11px] text-slate-400 inline-flex items-center gap-1 tabular-nums">
                              <Calendar className="w-3 h-3" />
                              Sorteio: {raffle.drawDate}
                            </span>
                          </div>
                          <h4 className="font-display font-bold text-sm text-white">
                            {raffle.prizeTitle}
                          </h4>
                          {raffle.prizeDescription && (
                            <p className="text-xs text-slate-400 leading-relaxed">
                              {raffle.prizeDescription}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="shrink-0">
                        {user.vipActive ? (
                          <span className="px-3 py-1.5 rounded-xl bg-emeraldVip/15 border border-emeraldVip/35 text-emeraldVip text-[11px] font-bold inline-flex items-center gap-1.5 whitespace-nowrap">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Participação Garantida
                          </span>
                        ) : (
                          <span className="px-3 py-1.5 rounded-xl bg-slate-800 border border-white/10 text-slate-400 text-[11px] font-semibold inline-flex items-center gap-1.5 whitespace-nowrap">
                            <Lock className="w-3.5 h-3.5" />
                            Exclusivo VIP
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
