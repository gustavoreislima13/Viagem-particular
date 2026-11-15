import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Copy,
  Loader2,
  PlusCircle,
  Wallet,
  X,
} from 'lucide-react';
import { doc } from 'firebase/firestore';
import { OFFICIAL_PIX_KEY, api, formatCurrency } from '../services/api.ts';
import {
  OperationType,
  auth,
  db,
  handleFirestoreError,
  serverTimestamp,
  setDoc,
} from '../lib/firebase.ts';
import { UserProfile, WalletTopupRequest, WalletTransaction } from '../types.ts';

interface WalletModalProps {
  isOpen: boolean;
  user: UserProfile;
  pixKey: string;
  onClose: () => void;
  onWalletUpdated: (balance: number, pendingPenalty: number) => void;
}

const PRESET_AMOUNTS = [20, 50, 100, 200];

export function WalletModal({
  isOpen,
  user,
  pixKey,
  onClose,
  onWalletUpdated,
}: WalletModalProps) {
  const [loading, setLoading] = useState(false);
  const [balance, setBalance] = useState<number>(user.walletBalance || 0);
  const [pendingPenalty, setPendingPenalty] = useState<number>(user.pendingPenalty || 0);
  const [topups, setTopups] = useState<WalletTopupRequest[]>([]);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);

  const [amountInput, setAmountInput] = useState('50');
  const [copied, setCopied] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const effectivePixKey = pixKey || OFFICIAL_PIX_KEY;

  const loadWallet = useCallback(async () => {
    if (!isOpen || user.isGuest) return;
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.getWallet();
      setBalance(Number(data.walletBalance || 0));
      setPendingPenalty(Number(data.pendingPenalty || 0));
      setTopups(data.topups || []);
      setTransactions(data.transactions || []);
      onWalletUpdated(Number(data.walletBalance || 0), Number(data.pendingPenalty || 0));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível carregar os dados da carteira.');
    } finally {
      setLoading(false);
    }
  }, [isOpen, user.isGuest, onWalletUpdated]);

  useEffect(() => {
    if (isOpen) {
      setBalance(Number(user.walletBalance || 0));
      setPendingPenalty(Number(user.pendingPenalty || 0));
      setErrorMsg(null);
      setSuccessMsg(null);
      loadWallet();
    }
  }, [isOpen, user.walletBalance, user.pendingPenalty, loadWallet]);

  if (!isOpen) return null;

  const handleCopyPix = async () => {
    try {
      await navigator.clipboard.writeText(effectivePixKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 2800);
    } catch {
      // Clipboard fallback ignored cleanly
    }
  };

  const handleRequestTopup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (user.isGuest) {
      setErrorMsg('Entre com sua conta Google para adicionar créditos reais à sua carteira.');
      return;
    }

    const numeric = Number(amountInput.replace(',', '.'));
    if (!Number.isFinite(numeric) || numeric < 5 || numeric > 10000) {
      setErrorMsg('Escolha um valor de recarga entre R$ 5,00 e R$ 10.000,00.');
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await api.requestWalletTopup(numeric);
      const created = res.topup;

      if (auth.currentUser) {
        try {
          await setDoc(doc(db, 'walletTopups', created.requestCode), {
            requestCode: created.requestCode,
            userId: user.uid,
            userName: (user.name || 'Passageiro VIP').slice(0, 120),
            amount: Number(created.amount),
            pixKey: effectivePixKey.slice(0, 120),
            status: 'Pendente',
            createdAt: serverTimestamp(),
          });
        } catch (fsErr) {
          handleFirestoreError(fsErr, OperationType.CREATE, `walletTopups/${created.requestCode}`);
        }
      }

      setSuccessMsg(
        `Solicitação ${created.requestCode} de ${formatCurrency(
          created.amount
        )} registrada! Assim que o motorista confirmar o Pix, o saldo entra automaticamente.`
      );
      await loadWallet();
    } catch (err: any) {
      setErrorMsg(err?.message || 'Erro ao solicitar crédito via Pix.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[215] flex items-center justify-center p-3 sm:p-4 bg-black/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-emeraldVip/30 max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0 bg-slate-900/80">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emeraldVip/15 border border-emeraldVip/35 text-emeraldVip flex items-center justify-center">
              <Wallet className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-display font-bold text-lg text-white">Minha Carteira Digital</h3>
              <p className="text-xs text-slate-400">
                Adicione créditos via Pix e pague suas viagens automaticamente
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Minha Carteira"
            className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-5">
          {/* Saldo Disponível Banner */}
          <div className="rounded-2xl bg-gradient-to-br from-emerald-950/70 via-slate-900 to-slate-950 border border-emeraldVip/35 p-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-emeraldVip">
                Saldo Disponível
              </span>
              <p className="font-display text-3xl sm:text-4xl font-extrabold text-white mt-1 tabular-nums">
                {formatCurrency(balance)}
              </p>
              <p className="text-[11px] text-slate-300 mt-1">
                Abatido automaticamente na confirmação de suas corridas.
              </p>
            </div>

            {pendingPenalty > 0 && (
              <div className="rounded-xl bg-red-950/60 border border-red-500/40 px-4 py-3 text-xs space-y-1 max-w-xs">
                <div className="flex items-center gap-1.5 text-red-300 font-bold">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Multa Pendente: {formatCurrency(pendingPenalty)}
                </div>
                <p className="text-[11px] text-red-200/85 leading-snug">
                  Referente a cancelamento com menos de 30 min. Será somada automaticamente na próxima corrida.
                </p>
              </div>
            )}
          </div>

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

          {/* Adicionar Crédito via Pix */}
          <form
            onSubmit={handleRequestTopup}
            className="rounded-2xl bg-slate-900/85 border border-white/10 p-4 sm:p-5 space-y-4"
          >
            <div className="flex items-center justify-between gap-2">
              <h4 className="font-display font-bold text-sm text-white flex items-center gap-2">
                <PlusCircle className="w-4 h-4 text-emeraldVip" />
                Adicionar Crédito via Pix
              </h4>
              <span className="text-[10px] font-semibold text-goldVip uppercase tracking-wider">
                Aprovação rápida pelo motorista
              </span>
            </div>

            {/* Presets + Input */}
            <div className="space-y-2.5">
              <div className="grid grid-cols-4 gap-2">
                {PRESET_AMOUNTS.map((val) => {
                  const selected = Number(amountInput.replace(',', '.')) === val;
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => setAmountInput(String(val))}
                      className={`py-2.5 rounded-xl text-xs font-bold border tabular-nums transition-all ${
                        selected
                          ? 'bg-emeraldVip text-slate-950 border-emeraldVip shadow-md shadow-emeraldVip/20'
                          : 'bg-slate-950/80 text-slate-200 border-white/10 hover:bg-slate-800'
                      }`}
                    >
                      {formatCurrency(val)}
                    </button>
                  );
                })}
              </div>

              <div>
                <label className="text-[11px] font-semibold text-slate-400 block mb-1">
                  Ou digite o valor desejado (R$)
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="5"
                  max="10000"
                  required
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="w-full bg-slate-950 border border-white/10 focus:border-emeraldVip rounded-xl px-3.5 py-2.5 text-sm font-bold text-white tabular-nums outline-none"
                />
              </div>
            </div>

            {/* Chave Pix Copy Box */}
            <div className="rounded-xl bg-slate-950/90 border border-emeraldVip/25 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-300">
                  1. Copie a Chave Pix Aleatória oficial e faça o pagamento no seu banco:
                </span>
                {copied && (
                  <span className="text-[11px] font-bold text-emeraldVip">Chave copiada!</span>
                )}
              </div>
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                <code className="flex-1 bg-slate-900 border border-white/10 rounded-xl px-3 py-2.5 text-xs text-emeraldVip font-mono select-all break-all">
                  {effectivePixKey}
                </code>
                <button
                  type="button"
                  onClick={handleCopyPix}
                  className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-white inline-flex items-center justify-center gap-1.5 shrink-0 transition-colors"
                >
                  {copied ? (
                    <Check className="w-3.5 h-3.5 text-emeraldVip" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-goldVip" />
                  )}
                  {copied ? 'Chave copiada!' : 'Copiar Chave Pix'}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-3.5 px-4 rounded-2xl bg-emeraldVip hover:brightness-110 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emeraldVip/20 transition-all disabled:opacity-60"
            >
              {submitting ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Check className="w-4 h-4" />
              )}
              2. Já fiz o Pix / Solicitar Crédito
            </button>
          </form>

          {/* Solicitações de Recarga Pendentes / Recentes */}
          {topups.length > 0 && (
            <div className="space-y-2.5">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                Solicitações de Recarga ({topups.length})
              </h4>
              <div className="space-y-2">
                {topups.map((t) => (
                  <div
                    key={t.requestCode}
                    className="rounded-xl bg-slate-900/75 border border-white/10 px-4 py-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-white">{t.requestCode}</span>
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
                      <p className="text-[11px] text-slate-400 mt-0.5 inline-flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(t.createdAt).toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <span className="font-display font-bold text-sm text-white tabular-nums">
                      +{formatCurrency(t.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Extrato da Carteira */}
          <div className="space-y-2.5">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Histórico de Movimentações
            </h4>
            {loading ? (
              <div className="py-6 flex items-center justify-center gap-2 text-xs text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin text-emeraldVip" />
                Carregando extrato...
              </div>
            ) : transactions.length === 0 ? (
              <div className="rounded-2xl bg-slate-900/60 border border-white/5 p-5 text-center text-xs text-slate-400">
                Nenhuma movimentação registrada ainda. Faça sua primeira recarga acima para utilizar saldo automático nas viagens.
              </div>
            ) : (
              <div className="space-y-2">
                {transactions.map((tx) => {
                  const isCredit = Number(tx.amount) >= 0;
                  return (
                    <div
                      key={tx.id}
                      className="rounded-xl bg-slate-900/75 border border-white/10 px-4 py-3 flex items-center justify-between gap-3 text-xs"
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${
                            isCredit
                              ? 'bg-emeraldVip/15 text-emeraldVip'
                              : 'bg-red-500/15 text-red-300'
                          }`}
                        >
                          {isCredit ? (
                            <ArrowDownLeft className="w-4 h-4" />
                          ) : (
                            <ArrowUpRight className="w-4 h-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white truncate">{tx.description}</p>
                          <p className="text-[11px] text-slate-400 tabular-nums">
                            {new Date(tx.createdAt).toLocaleString('pt-BR')} · Saldo após:{' '}
                            {formatCurrency(tx.balanceAfter)}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`font-mono font-bold text-sm tabular-nums shrink-0 ${
                          isCredit ? 'text-emeraldVip' : 'text-red-300'
                        }`}
                      >
                        {isCredit ? '+' : ''}
                        {formatCurrency(tx.amount)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
