import { useEffect, useState } from 'react';
import {
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  Download,
  Loader2,
  MessageCircle,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  OFFICIAL_PIX_KEY,
  api,
  buildGoogleCalendarUrl,
  buildRideSummaryText,
  buildWhatsappUrl,
  downloadRideIcs,
  formatCurrency,
} from '../services/api.ts';
import { AppSettings, Ride, WhatsAppDispatchResult } from '../types.ts';
import {
  DEFAULT_DRIVER_WHATSAPP,
  formatBrDate,
  formatKmPtBr,
  formatRideWindowSummary,
} from '../utils/schedule.ts';

interface SuccessModalProps {
  ride: Ride | null;
  settings: AppSettings;
  vipActive?: boolean;
  whatsappDispatch?: WhatsAppDispatchResult | null;
  isGuest?: boolean;
  onClose: () => void;
}

export function SuccessModal({
  ride,
  settings,
  vipActive,
  whatsappDispatch,
  isGuest,
  onClose,
}: SuccessModalProps) {
  const [copiedPix, setCopiedPix] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [retryingWhatsapp, setRetryingWhatsapp] = useState(false);
  const [localDispatch, setLocalDispatch] = useState<WhatsAppDispatchResult | null>(
    whatsappDispatch || null
  );

  useEffect(() => {
    setLocalDispatch(whatsappDispatch || null);
  }, [whatsappDispatch, ride?.rideCode]);

  if (!ride) return null;

  const effectivePixKey = settings.pixKey || OFFICIAL_PIX_KEY;
  const driverPhone = settings.whatsapp || DEFAULT_DRIVER_WHATSAPP;
  const paymentMethodLabel = ride.paymentMethod || 'Pix';
  const walletDeducted = Number(ride.walletDeducted || 0);
  const remainingDue = Number(ride.remainingDue ?? ride.price ?? 0);
  const penaltyIncluded = Number(ride.penaltyIncluded || 0);
  const usesPix = paymentMethodLabel.includes('Pix') && remainingDue > 0;
  const usesCard = paymentMethodLabel.includes('Cartão') && remainingDue > 0;

  const isRoundTrip = Boolean(ride.isRoundTrip || ride.category === 'roundtrip');
  const modalityLabel = !isRoundTrip
    ? 'Executiva (Somente Ida)'
    : ride.roundTripMode === 'scheduled_return' && ride.returnTime
      ? `Ida e Volta (Retorno às ${ride.returnTime.slice(0, 5)})`
      : Number(ride.waitTimeMin || 0) > 0
        ? `Ida e Volta (Contínuo · espera ${ride.waitTimeMin} min)`
        : 'Ida e Volta (Retorno Contínuo)';

  const windowSummary = formatRideWindowSummary(ride);
  const summaryText =
    localDispatch?.messagePreview || buildRideSummaryText(ride, settings, vipActive);
  const whatsappHref =
    localDispatch?.whatsappUrl ||
    buildWhatsappUrl(ride, driverPhone, effectivePixKey, vipActive);

  let paymentSummaryText = '';
  if (walletDeducted > 0 && remainingDue <= 0) {
    paymentSummaryText = `Carteira Digital (${formatCurrency(walletDeducted)} abatidos do saldo)`;
  } else if (walletDeducted > 0 && remainingDue > 0) {
    paymentSummaryText = usesCard
      ? `Carteira (${formatCurrency(walletDeducted)}) + Cartão Presencial (${formatCurrency(remainingDue)})`
      : `Carteira (${formatCurrency(walletDeducted)}) + Pix (${formatCurrency(remainingDue)})`;
  } else if (usesCard) {
    paymentSummaryText = `Cartão Presencial na maquininha (${formatCurrency(remainingDue)})`;
  } else {
    paymentSummaryText = `Pix (${formatCurrency(remainingDue)})`;
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
  const showVipRow = Boolean(recurrenceLabel || ride.preferences?.trim());

  const handleCopyPix = async () => {
    try {
      await navigator.clipboard.writeText(effectivePixKey);
      setCopiedPix(true);
      setTimeout(() => setCopiedPix(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText);
      setCopiedSummary(true);
      setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const handleRetryWhatsapp = async () => {
    if (!ride.rideCode || isGuest) return;
    setRetryingWhatsapp(true);
    try {
      const res = await api.dispatchWhatsapp(ride.rideCode);
      setLocalDispatch(res.whatsappDispatch);
    } catch {
      // Keep direct link active
    } finally {
      setRetryingWhatsapp(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-md max-h-[92vh] overflow-y-auto rounded-3xl shadow-2xl border border-emeraldVip/30">
        <div className="p-5 sm:p-6 text-center border-b border-white/10 relative">
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar confirmação"
            className="absolute right-4 top-4 w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="w-14 h-14 rounded-2xl bg-emeraldVip/15 border border-emeraldVip/30 text-emeraldVip flex items-center justify-center mx-auto mb-3 shadow-[0_0_24px_rgba(16,185,129,0.2)]">
            <ShieldCheck className="w-7 h-7" />
          </div>
          <h3 className="font-display text-xl font-bold text-white">Reserva Confirmada</h3>
          <p className="text-xs text-slate-400 mt-1">
            Código: <span className="font-mono font-bold text-emeraldVip">{ride.rideCode}</span> · +
            {ride.pointsEarned} pts VIP após conclusão
          </p>
        </div>

        <div className="p-5 space-y-4">
          {/* Clean Receipt Card */}
          <div className="rounded-2xl bg-slate-900/85 border border-white/10 p-4 space-y-2.5 text-xs">
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Passageiro</span>
              <span className="text-white font-semibold text-right truncate max-w-[65%]">
                {ride.clientName}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Embarque</span>
              <span className="text-white font-medium text-right truncate max-w-[65%]">
                {ride.originName}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Destino</span>
              <span className="text-white font-medium text-right truncate max-w-[65%]">
                {ride.destinationName}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Data e Horário</span>
              <span className="text-slate-100 font-mono font-semibold tabular-nums">
                {formatBrDate(ride.scheduledDate)} às {String(ride.scheduledTime || '09:00').slice(0, 5)}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Modalidade</span>
              <span className="text-slate-200 font-medium text-right">{modalityLabel}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-400">Percurso</span>
              <span className="text-emeraldVip font-semibold tabular-nums">
                {formatKmPtBr(ride.distanceKm)} km (~{Math.max(1, Math.round(ride.durationMin || 15))} min)
              </span>
            </div>
            {windowSummary && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-400 flex items-center gap-1">
                  <Clock className="w-3 h-3 text-emeraldVip" />
                  Agenda Bloqueada
                </span>
                <span className="text-emerald-200 font-mono text-[11px] tabular-nums text-right">
                  {windowSummary}
                </span>
              </div>
            )}

            {showVipRow && (
              <div className="pt-2 border-t border-white/10 space-y-1">
                {recurrenceLabel && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Benefício VIP</span>
                    <span className="text-goldVip font-semibold text-right">{recurrenceLabel}</span>
                  </div>
                )}
                {ride.preferences?.trim() && (
                  <div className="flex justify-between gap-2">
                    <span className="text-slate-400">Preferências</span>
                    <span className="text-slate-200 text-right truncate max-w-[65%]">
                      {ride.preferences.trim()}
                    </span>
                  </div>
                )}
              </div>
            )}

            <div className="pt-2 border-t border-white/10 space-y-1.5">
              {penaltyIncluded > 0 && (
                <div className="flex justify-between gap-2 text-red-300">
                  <span>Multa pendente quitada</span>
                  <span className="font-mono font-semibold tabular-nums">
                    +{formatCurrency(penaltyIncluded)}
                  </span>
                </div>
              )}
              <div className="flex justify-between gap-2">
                <span className="text-slate-400">Pagamento</span>
                <span className="text-slate-200 font-semibold text-right max-w-[68%]">
                  {paymentSummaryText}
                </span>
              </div>
              <div className="pt-1 flex justify-between items-center">
                <span className="text-slate-200 font-semibold">Valor Total</span>
                <span className="font-display text-lg font-extrabold text-emeraldVip tabular-nums">
                  {formatCurrency(ride.price)}
                </span>
              </div>
            </div>
          </div>

          {usesPix && (
            <div className="rounded-2xl bg-slate-900/60 border border-emeraldVip/30 p-3.5 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                  Chave PIX ({formatCurrency(remainingDue)})
                </span>
                {copiedPix && (
                  <span className="text-[11px] text-emeraldVip font-bold">Chave copiada!</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-slate-950/80 border border-white/5 rounded-xl px-3 py-2 text-xs text-emeraldVip truncate font-mono">
                  {effectivePixKey}
                </code>
                <button
                  type="button"
                  onClick={handleCopyPix}
                  className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white flex items-center gap-1.5 shrink-0 transition-colors"
                >
                  {copiedPix ? (
                    <Check className="w-3.5 h-3.5 text-emeraldVip" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                  {copiedPix ? 'Copiada!' : 'Copiar Chave Pix'}
                </button>
              </div>
            </div>
          )}

          {usesCard && (
            <div className="rounded-2xl bg-slate-900/60 border border-white/10 p-3 flex items-start gap-2.5 text-xs text-slate-300">
              <CreditCard className="w-4 h-4 text-goldVip shrink-0 mt-0.5" />
              <p>
                <strong>Cartão Presencial ({formatCurrency(remainingDue)}):</strong> pagamento realizado na maquininha ao final da corrida.
              </p>
            </div>
          )}

          {/* Primary WhatsApp CTA + Copy Summary */}
          <div className="space-y-2">
            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-3.5 px-4 rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-extrabold text-sm flex items-center justify-center gap-2 transition-all shadow-lg shadow-emerald-500/25"
            >
              <MessageCircle className="w-4 h-4" />
              Enviar Comprovante no WhatsApp
            </a>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={handleCopySummary}
                className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-1.5 transition-colors"
              >
                {copiedSummary ? (
                  <Check className="w-3.5 h-3.5 text-emeraldVip" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-slate-300" />
                )}
                {copiedSummary ? 'Resumo copiado!' : 'Copiar Resumo'}
              </button>

              {!isGuest ? (
                <button
                  type="button"
                  disabled={retryingWhatsapp}
                  onClick={handleRetryWhatsapp}
                  className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-semibold text-slate-200 flex items-center justify-center gap-1.5 transition-colors disabled:opacity-60"
                >
                  {retryingWhatsapp ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5 text-emeraldVip" />
                  )}
                  {localDispatch?.dispatched ? 'Enviado via API' : 'Disparar via API'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={onClose}
                  className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-white/10 text-xs font-semibold text-slate-200"
                >
                  Fechar
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2.5">
            <a
              href={buildGoogleCalendarUrl(ride)}
              target="_blank"
              rel="noopener noreferrer"
              className="py-2.5 px-3 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors"
            >
              <Calendar className="w-4 h-4 text-emeraldVip" />
              Google Agenda
            </a>
            <button
              type="button"
              onClick={() => downloadRideIcs(ride)}
              className="py-2.5 px-3 rounded-xl bg-slate-900/90 hover:bg-slate-800 border border-white/10 text-xs font-semibold text-white flex items-center justify-center gap-2 transition-colors"
            >
              <Download className="w-4 h-4 text-goldVip" />
              Baixar .ICS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
