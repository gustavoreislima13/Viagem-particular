import { useState } from 'react';
import {
  AlertTriangle,
  Calendar,
  Clock,
  Download,
  MapPin,
  MessageCircle,
  X,
  XCircle,
} from 'lucide-react';
import {
  LATE_CANCEL_PENALTY,
  buildWhatsappUrl,
  downloadRideIcs,
  formatCurrency,
  isLateCancelWindow,
} from '../services/api.ts';
import { AppSettings, Ride } from '../types.ts';
import {
  formatBrDate,
  formatKmPtBr,
  formatRideWindowSummary,
} from '../utils/schedule.ts';

interface HistoryModalProps {
  isOpen: boolean;
  rides: Ride[];
  settings: AppSettings;
  vipActive?: boolean;
  onClose: () => void;
  onCancelRide: (rideCode: string) => void;
}

export function HistoryModal({
  isOpen,
  rides,
  settings,
  vipActive,
  onClose,
  onCancelRide,
}: HistoryModalProps) {
  const [confirmCancelCode, setConfirmCancelCode] = useState<string | null>(null);

  if (!isOpen) return null;

  const statusStyle = (status: Ride['status']) => {
    if (status === 'Concluído') return 'text-emeraldVip';
    if (status === 'Em Andamento') return 'text-amber-400';
    if (status === 'Cancelado') return 'text-red-400';
    return 'text-sky-400';
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md">
      <div className="glass-panel w-full max-w-2xl rounded-3xl overflow-hidden shadow-2xl border border-white/10 max-h-[88vh] flex flex-col">
        <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-display font-bold text-lg text-white">Minhas Viagens & Agenda</h3>
            <p className="text-xs text-slate-400">
              {rides.length} {rides.length === 1 ? 'corrida registrada' : 'corridas registradas'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar histórico"
            className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-3">
          {rides.length === 0 ? (
            <div className="py-12 text-center space-y-2">
              <MapPin className="w-10 h-10 text-slate-600 mx-auto" />
              <p className="text-sm font-semibold text-slate-300">Nenhuma viagem agendada ainda</p>
              <p className="text-xs text-slate-500">
                Selecione um destino no mapa para cotar e confirmar sua primeira corrida VIP.
              </p>
            </div>
          ) : (
            rides.map((ride) => {
              const isLate = isLateCancelWindow(
                ride.scheduledDate,
                ride.scheduledTime,
                ride.status
              );
              const canClientCancel =
                ride.status === 'Confirmado' || ride.status === 'Em Andamento';
              const isConfirming = confirmCancelCode === ride.rideCode;

              return (
                <div
                  key={ride.rideCode}
                  className="rounded-2xl bg-slate-900/75 border border-white/10 p-4 space-y-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      <span className="font-mono font-bold text-slate-200">{ride.rideCode}</span>
                      <span>·</span>
                      <span className={`font-bold ${statusStyle(ride.status)}`}>{ride.status}</span>
                      <span>·</span>
                      <span>
                        {ride.isRoundTrip || ride.category === 'roundtrip'
                          ? 'Ida e Volta'
                          : 'Executiva'}
                      </span>
                      {ride.paymentMethod && (
                        <>
                          <span>·</span>
                          <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 font-semibold">
                            {ride.paymentMethod}
                          </span>
                        </>
                      )}
                      {ride.recurrenceFrequency && ride.recurrenceFrequency !== 'none' && (
                        <>
                          <span>·</span>
                          <span className="px-2 py-0.5 rounded-md bg-goldVip/15 text-goldVip font-semibold">
                            Recorrência:{' '}
                            {ride.recurrenceFrequency === 'daily'
                              ? 'Diária'
                              : ride.recurrenceFrequency === 'weekly'
                                ? 'Semanal'
                                : 'Mensal'}
                          </span>
                        </>
                      )}
                    </div>
                    <div className="text-right">
                      <span className="font-display text-base font-bold text-emeraldVip tabular-nums">
                        {formatCurrency(ride.price)}
                      </span>
                      {(ride.walletDeducted || 0) > 0 && (
                        <p className="text-[10px] text-emerald-300 tabular-nums">
                          Carteira: -{formatCurrency(ride.walletDeducted || 0)}
                        </p>
                      )}
                      {(ride.pointsRedeemed || 0) > 0 && (
                        <p className="text-[10px] text-goldVip tabular-nums">
                          -{ride.pointsRedeemed} pts aplicados
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="space-y-1 text-xs">
                    <p className="text-slate-300 truncate">
                      <span className="text-emeraldVip font-semibold">De:</span> {ride.originName}
                    </p>
                    <p className="text-slate-300 truncate">
                      <span className="text-goldVip font-semibold">Para:</span>{' '}
                      {ride.destinationName}
                    </p>
                    {ride.paymentStatus && (
                      <p className="text-[11px] text-slate-400">
                        Pagamento: <span className="text-slate-200">{ride.paymentStatus}</span>
                      </p>
                    )}
                    {ride.preferences && (
                      <p className="text-[11px] text-sky-300 truncate pt-0.5">
                        Preferências VIP: {ride.preferences}
                      </p>
                    )}
                  </div>

                  {isConfirming && (
                    <div
                      className={`rounded-xl p-3 border text-xs space-y-2 ${
                        isLate
                          ? 'bg-red-950/50 border-red-500/40 text-red-100'
                          : 'bg-slate-950/80 border-white/10 text-slate-200'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <AlertTriangle
                          className={`w-4 h-4 shrink-0 mt-0.5 ${
                            isLate ? 'text-red-400' : 'text-amber-400'
                          }`}
                        />
                        <p className="leading-relaxed">
                          {isLate ? (
                            <>
                              <strong>Atenção (Multa de {formatCurrency(LATE_CANCEL_PENALTY)}):</strong>{' '}
                              faltam 30 minutos ou menos para o embarque (ou viagem em andamento). Ao cancelar agora, será cobrada multa de{' '}
                              <strong>{formatCurrency(LATE_CANCEL_PENALTY)}</strong> na sua carteira ou próxima corrida.
                            </>
                          ) : (
                            'Deseja realmente cancelar esta viagem agendada? Sem cobrança de multa (mais de 30 min de antecedência).'
                          )}
                        </p>
                      </div>
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmCancelCode(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200"
                        >
                          Voltar
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setConfirmCancelCode(null);
                            onCancelRide(ride.rideCode);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 text-[11px] font-bold text-white"
                        >
                          {isLate
                            ? `Confirmar Cancelamento (${formatCurrency(LATE_CANCEL_PENALTY)})`
                            : 'Confirmar Cancelamento'}
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 tabular-nums">
                      <span className="inline-flex items-center gap-1">
                        <Calendar className="w-3.5 h-3.5" />
                        {formatBrDate(ride.scheduledDate)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {formatRideWindowSummary(ride) || ride.scheduledTime}
                      </span>
                      <span>
                        {formatKmPtBr(ride.distanceKm)} km (~{Math.max(1, Math.round(ride.durationMin || 15))} min)
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => downloadRideIcs(ride)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-semibold text-slate-200 inline-flex items-center gap-1"
                      >
                        <Download className="w-3 h-3" />
                        .ICS
                      </button>
                      <a
                        href={buildWhatsappUrl(ride, settings.whatsapp, settings.pixKey, vipActive)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-2.5 py-1.5 rounded-lg bg-emeraldVip/15 hover:bg-emeraldVip/25 text-[11px] font-semibold text-emeraldVip inline-flex items-center gap-1"
                      >
                        <MessageCircle className="w-3 h-3" />
                        WhatsApp
                      </a>
                      {canClientCancel && !isConfirming && (
                        <button
                          type="button"
                          onClick={() => setConfirmCancelCode(ride.rideCode)}
                          className="px-2.5 py-1.5 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-[11px] font-semibold text-red-300 inline-flex items-center gap-1"
                        >
                          <XCircle className="w-3 h-3" />
                          Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
