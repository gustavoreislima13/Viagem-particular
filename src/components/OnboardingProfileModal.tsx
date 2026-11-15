import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Crown,
  Loader2,
  LogOut,
  MapPin,
  Phone,
  ShieldCheck,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { api, formatCurrency } from '../services/api.ts';
import { UserProfile } from '../types.ts';
import { formatCpf, formatPhoneBr, isValidCpf, onlyDigits } from '../utils/validators.ts';

interface OnboardingProfileModalProps {
  isOpen: boolean;
  mode: 'onboarding' | 'edit';
  user: UserProfile;
  onClose?: () => void;
  onLogout?: () => void;
  onProfileSaved: (updatedUser: UserProfile) => void;
}

export function OnboardingProfileModal({
  isOpen,
  mode,
  user,
  onClose,
  onLogout,
  onProfileSaved,
}: OnboardingProfileModalProps) {
  const [name, setName] = useState(user.name || '');
  const [phone, setPhone] = useState(formatPhoneBr(user.phone || ''));
  const [address, setAddress] = useState(user.address || '');
  const [cpf, setCpf] = useState(formatCpf(user.cpf || ''));
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(user.name || '');
      setPhone(formatPhoneBr(user.phone || ''));
      setAddress(user.address || '');
      setCpf(formatCpf(user.cpf || ''));
      setErrorMsg(null);
      setSavedToast(false);
    }
  }, [isOpen, user]);

  if (!isOpen) return null;

  const cpfDigits = onlyDigits(cpf);
  const cpfReady = cpfDigits.length === 11;
  const cpfValid = cpfReady ? isValidCpf(cpf) : false;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (name.trim().length < 3) {
      setErrorMsg('Informe seu Nome Completo (mínimo 3 caracteres).');
      return;
    }
    if (onlyDigits(phone).length < 10) {
      setErrorMsg('Informe um número de Celular / WhatsApp válido com DDD.');
      return;
    }
    if (address.trim().length < 8) {
      setErrorMsg('Informe seu Endereço Completo (Rua, número, bairro, cidade/UF).');
      return;
    }
    if (!isValidCpf(cpf)) {
      setErrorMsg('CPF inválido. Confira os 11 dígitos informados.');
      return;
    }

    setSaving(true);
    try {
      const res = await api.updateProfile({
        name: name.trim(),
        phone,
        address: address.trim(),
        cpf,
      });
      onProfileSaved(res.user);
      setSavedToast(true);
      if (mode === 'edit' && onClose) {
        setTimeout(() => onClose(), 700);
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Não foi possível salvar seu cadastro.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/85 backdrop-blur-md">
      <div className="glass-panel w-full max-w-lg rounded-3xl overflow-hidden shadow-2xl border border-emeraldVip/30 max-h-[92vh] flex flex-col">
        <div className="px-6 py-5 border-b border-white/10 flex items-start justify-between gap-4 shrink-0 bg-slate-900/75">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-emeraldVip/15 border border-emeraldVip/30 text-emeraldVip flex items-center justify-center shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display font-bold text-lg text-white">
                {mode === 'onboarding' ? 'Complete seu Cadastro VIP' : 'Meu Perfil & Dados Cadastrais'}
              </h2>
              <p className="text-xs text-slate-400">
                {mode === 'onboarding'
                  ? 'Obrigatório no primeiro acesso para segurança das viagens e envio de confirmações.'
                  : 'Mantenha seus dados atualizados para agendamentos e Clube VIP.'}
              </p>
            </div>
          </div>

          {mode === 'edit' && onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Fechar perfil"
              className="w-9 h-9 rounded-full bg-slate-800/80 hover:bg-slate-700 text-slate-300 flex items-center justify-center shrink-0"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit} className="p-6 overflow-y-auto space-y-4">
          {/* Account & VIP badge */}
          <div className="rounded-2xl bg-slate-900/80 border border-white/10 p-3.5 space-y-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] text-slate-400">Conta Google conectada</p>
                <p className="text-xs font-semibold text-white truncate">{user.email}</p>
              </div>
              <span
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 shrink-0 ${
                  user.vipActive
                    ? 'bg-goldVip/20 text-goldVip border border-goldVip/40'
                    : 'bg-slate-800 text-slate-300 border border-white/10'
                }`}
              >
                <Crown className="w-3 h-3" />
                {user.vipActive ? 'Clube VIP Ativo' : `${user.tier} · ${user.points} pts`}
              </span>
            </div>

            {mode === 'edit' && (
              <div className="pt-2 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="inline-flex items-center gap-1.5 text-emeraldVip font-bold tabular-nums">
                  <Wallet className="w-3.5 h-3.5" />
                  Saldo Carteira: {formatCurrency(user.walletBalance || 0)}
                </span>
                {(user.pendingPenalty || 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-red-300 font-bold tabular-nums">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Multa Pendente: {formatCurrency(user.pendingPenalty || 0)}
                  </span>
                )}
              </div>
            )}
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              1. Nome Completo *
            </label>
            <div className="relative">
              <User className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                minLength={3}
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Seu nome completo"
                className="w-full bg-slate-950 border border-white/10 focus:border-emeraldVip rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <div>
              <label className="text-xs font-semibold text-slate-300 block mb-1.5">
                2. Celular / WhatsApp *
              </label>
              <div className="relative">
                <Phone className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(formatPhoneBr(e.target.value))}
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                  className="w-full bg-slate-950 border border-white/10 focus:border-emeraldVip rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white font-mono outline-none"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-slate-300">4. CPF *</label>
                {cpfReady && (
                  <span
                    className={`text-[10px] font-bold ${
                      cpfValid ? 'text-emeraldVip' : 'text-red-400'
                    }`}
                  >
                    {cpfValid ? 'CPF Válido' : 'Dígitos inválidos'}
                  </span>
                )}
              </div>
              <input
                type="text"
                inputMode="numeric"
                required
                value={cpf}
                onChange={(e) => setCpf(formatCpf(e.target.value))}
                placeholder="000.000.000-00"
                maxLength={14}
                className={`w-full bg-slate-950 border rounded-xl px-3.5 py-2.5 text-sm text-white font-mono outline-none ${
                  cpfReady && !cpfValid
                    ? 'border-red-500/60'
                    : 'border-white/10 focus:border-emeraldVip'
                }`}
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-slate-300 block mb-1.5">
              3. Endereço Completo (Rua, número, bairro, cidade/UF) *
            </label>
            <div className="relative">
              <MapPin className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <textarea
                required
                minLength={8}
                maxLength={280}
                rows={2}
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Ex: Av. Paulista, 1578, Apto 42, Bela Vista, São Paulo/SP"
                className="w-full bg-slate-950 border border-white/10 focus:border-emeraldVip rounded-xl pl-10 pr-3.5 py-2.5 text-sm text-white outline-none resize-none"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-red-500/15 border border-red-500/30 text-xs text-red-200">
              {errorMsg}
            </div>
          )}

          {savedToast && (
            <div className="p-3 rounded-xl bg-emeraldVip/15 border border-emeraldVip/30 text-xs text-emeraldVip flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              Cadastro salvo e vinculado com segurança à sua conta!
            </div>
          )}

          <div className="pt-1 flex flex-col sm:flex-row items-center gap-2.5">
            <button
              type="submit"
              disabled={saving}
              className="w-full py-3.5 px-4 rounded-2xl bg-emeraldVip hover:brightness-110 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-emeraldVip/20 transition-all disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <CheckCircle2 className="w-4 h-4" />
              )}
              {saving
                ? 'Salvando Cadastro...'
                : mode === 'onboarding'
                  ? 'Concluir Cadastro e Acessar App'
                  : 'Salvar Alterações'}
            </button>

            {mode === 'onboarding' && onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="w-full sm:w-auto px-4 py-3.5 rounded-2xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-300 flex items-center justify-center gap-1.5 shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
                Sair
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
