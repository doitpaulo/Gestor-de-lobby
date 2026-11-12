import React, { useState } from 'react';
import { User, WorkspaceMember } from '../types';
import { FirebaseService } from '../services/firebase';
import { IconShieldCheck, IconCheck, IconUsers } from './Icons';

interface ForcePasswordChangeScreenProps {
  user: User;
  onPasswordChanged: (updatedMember: WorkspaceMember) => void;
  onLogout: () => void;
}

export const ForcePasswordChangeScreen: React.FC<ForcePasswordChangeScreenProps> = ({
  user,
  onPasswordChanged,
  onLogout
}) => {
  const [currentTempPassword, setCurrentTempPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!currentTempPassword) {
      setError('Informe a senha temporária fornecida pelo administrador.');
      return;
    }
    if (newPassword.length < 6) {
      setError('A nova senha deve possuir no mínimo 6 caracteres.');
      return;
    }
    if (newPassword === currentTempPassword) {
      setError('A nova senha pessoal deve ser diferente da senha temporária atual.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('A confirmação da nova senha não coincide.');
      return;
    }

    setIsSubmitting(true);
    const tempSnap = currentTempPassword;
    const nextSnap = newPassword;

    try {
      const result = await FirebaseService.changeFirstAccessPassword(tempSnap, nextSnap);
      setCurrentTempPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onPasswordChanged(result.member);
    } catch (err: any) {
      const code = err?.code || '';
      if (
        code === 'auth/wrong-password' ||
        code === 'auth/invalid-credential' ||
        code === 'auth/invalid-login-credentials'
      ) {
        setError('A senha temporária atual está incorreta. Confira a senha fornecida pelo administrador.');
      } else if (code === 'auth/weak-password') {
        setError('A nova senha é considerada fraca pelo Firebase Auth. Utilize letras e números.');
      } else if (code === 'auth/too-many-requests') {
        setError('Muitas tentativas seguidas. Aguarde alguns minutos antes de tentar novamente.');
      } else if (code === 'auth/requires-recent-login') {
        setError('Sua sessão expirou. Clique em "Sair" e entre novamente com sua senha temporária.');
      } else {
        setError(err?.message || 'Não foi possível concluir a troca obrigatória de senha.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none" />
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-emerald-600/10 rounded-full blur-[130px] pointer-events-none" />

      <div className="w-full max-w-md bg-dark-850/95 backdrop-blur-2xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/60 relative z-10 animate-fade-in">
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
            <IconShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <span className="inline-block px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-amber-500/15 text-amber-300 border border-amber-500/30 mb-1">
              Troca Obrigatória de Senha
            </span>
            <h2 className="text-xl font-extrabold text-white tracking-tight">
              Defina sua Senha Pessoal
            </h2>
          </div>
        </div>

        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-3.5 mb-5 flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-indigo-950/80 border border-indigo-500/30 flex items-center justify-center text-indigo-300 shrink-0">
            <IconUsers className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-white truncate">{user.name || 'Colaborador'}</p>
            <p className="text-[11px] text-slate-400 font-mono truncate">{user.email}</p>
            {user.linkedDevName && (
              <p className="text-[10px] text-emerald-400 mt-0.5 truncate">
                Dev vinculado: {user.linkedDevName}
              </p>
            )}
          </div>
        </div>

        <div className="bg-amber-950/30 border border-amber-500/30 rounded-xl p-3 mb-5 text-[11px] text-amber-200 leading-relaxed">
          Seu login foi provisionado com uma <strong>senha temporária</strong>. Por segurança, os dados e demandas da workspace permanecem bloqueados até que você defina uma nova senha pessoal exclusiva para o Nexus (não utilize sua senha corporativa/Outlook).
        </div>

        {error && (
          <div className="bg-rose-950/70 border border-rose-500/50 rounded-xl p-3 mb-4 text-xs text-rose-200 leading-relaxed">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
              Senha Temporária Atual <span className="text-rose-400">*</span>
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={currentTempPassword}
              onChange={(e) => setCurrentTempPassword(e.target.value)}
              placeholder="Digite a senha temporária recebida"
              autoComplete="current-password"
              required
              className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
              Nova Senha Pessoal <span className="text-rose-400">*</span>
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Mínimo 6 caracteres (diferente da temporária)"
              autoComplete="new-password"
              minLength={6}
              required
              className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
              Confirmar Nova Senha <span className="text-rose-400">*</span>
            </label>
            <input
              type={showPasswords ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repita a nova senha pessoal"
              autoComplete="new-password"
              minLength={6}
              required
              className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
            />
          </div>

          <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer select-none pt-0.5">
            <input
              type="checkbox"
              checked={showPasswords}
              onChange={(e) => setShowPasswords(e.target.checked)}
              className="rounded text-indigo-600 focus:ring-0 cursor-pointer"
            />
            <span>Mostrar senhas digitadas</span>
          </label>

          <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-2.5 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-xs shadow-lg shadow-indigo-950/50 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <IconCheck className="w-4 h-4" />
              <span>{isSubmitting ? 'Salvando e Liberando Acesso...' : 'Salvar Nova Senha e Entrar'}</span>
            </button>
            <button
              type="button"
              onClick={onLogout}
              disabled={isSubmitting}
              className="py-2.5 px-4 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              Sair
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
