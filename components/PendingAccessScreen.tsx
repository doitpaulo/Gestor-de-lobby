import React, { useState } from 'react';
import { User } from '../types';
import { IconShieldCheck, IconClock, IconUsers } from './Icons';

interface PendingAccessScreenProps {
  user: User;
  onRefresh: () => void;
  onLogout: () => void;
  onRequestHelp?: () => void;
}

export const PendingAccessScreen: React.FC<PendingAccessScreenProps> = ({
  user,
  onRefresh,
  onLogout,
  onRequestHelp
}) => {
  const [isChecking, setIsChecking] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCheckAgain = async () => {
    setIsChecking(true);
    try {
      await onRefresh();
    } finally {
      setTimeout(() => setIsChecking(false), 600);
    }
  };

  const handleCopyId = () => {
    const textToCopy = `Email: ${user.email}\nUID: ${user.id}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(textToCopy);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  };

  const isInactive = user.status === 'inactive';

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 p-4 relative overflow-hidden">
      {/* Background ambient lighting */}
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none" />
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-amber-600/10 rounded-full blur-[130px] pointer-events-none" />

      <div className="w-full max-w-lg bg-dark-850/95 backdrop-blur-2xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/60 relative z-10 text-center animate-fade-in">
        {/* Status Icon */}
        <div className="w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center border shadow-xl transition-transform hover:scale-105 duration-200"
          style={{
            backgroundColor: isInactive ? 'rgba(244, 63, 94, 0.12)' : 'rgba(245, 158, 11, 0.12)',
            borderColor: isInactive ? 'rgba(244, 63, 94, 0.35)' : 'rgba(245, 158, 11, 0.35)',
            color: isInactive ? '#fb7185' : '#fbbf24'
          }}
        >
          {isInactive ? (
            <IconShieldCheck className="w-10 h-10 text-rose-400" />
          ) : (
            <IconClock className="w-10 h-10 text-amber-400 animate-pulse" />
          )}
        </div>

        {/* Title & Badge */}
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-3 border"
          style={{
            backgroundColor: isInactive ? 'rgba(244, 63, 94, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            borderColor: isInactive ? 'rgba(244, 63, 94, 0.4)' : 'rgba(245, 158, 11, 0.4)',
            color: isInactive ? '#fecdd3' : '#fef3c7'
          }}
        >
          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: isInactive ? '#f43f5e' : '#f59e0b' }} />
          <span>{isInactive ? 'Acesso Desativado' : 'Acesso Pendente de Liberação'}</span>
        </div>

        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
          {isInactive ? 'Conta Temporariamente Inativa' : 'Aguardando Aprovação do Administrador'}
        </h2>

        <p className="text-sm text-slate-300 leading-relaxed mb-6">
          {isInactive ? (
            <>
              Sua conta foi identificada no sistema, porém o acesso está configurado como <strong className="text-rose-400">inativo</strong>. Entre em contato com o administrador do Nexus para reativação do seu perfil.
            </>
          ) : (
            <>
              Olá, <strong className="text-white">{user.name || 'Colaborador'}</strong>! Sua conta foi autenticada com sucesso, mas o acesso ao portfólio corporativo de demandas requer liberação individual e definição de permissões pelo administrador do workspace.
            </>
          )}
        </p>

        {/* User Card info box */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 mb-6 text-left space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
            <span className="font-semibold uppercase tracking-wider">Identificação do Usuário</span>
            <button
              type="button"
              onClick={handleCopyId}
              className="text-indigo-400 hover:text-indigo-300 text-[11px] font-semibold underline cursor-pointer"
            >
              {copied ? '✔ Copiado!' : 'Copiar Identificação'}
            </button>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <div className="w-10 h-10 rounded-xl bg-indigo-950/80 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-bold text-sm shrink-0">
              <IconUsers className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-white truncate">{user.name || 'Sem nome'}</p>
              <p className="text-[11px] text-slate-400 font-mono truncate">{user.email || 'Sem email'}</p>
              <p className="text-[10px] text-slate-500 font-mono truncate mt-0.5">UID: {user.id}</p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleCheckAgain}
            disabled={isChecking}
            className="flex-1 py-3 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-sm shadow-lg shadow-indigo-950/50 transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {isChecking ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Verificando Liberação...</span>
              </>
            ) : (
              <span>Verificar Acesso Novamente</span>
            )}
          </button>

          <button
            type="button"
            onClick={onLogout}
            className="py-3 px-5 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 hover:text-white font-semibold text-sm transition-colors cursor-pointer"
          >
            Sair / Trocar Conta
          </button>
        </div>

        {/* Help request button */}
        {onRequestHelp && (
          <div className="mt-4 pt-3 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onRequestHelp}
              className="text-xs text-indigo-400 hover:text-indigo-300 font-medium underline transition-colors cursor-pointer"
            >
              Precisa de ajuda com seu acesso? Solicitar ajuda ao administrador
            </button>
          </div>
        )}

        {/* Footer note */}
        <p className="text-[11px] text-slate-500 mt-4 italic">
          * Assim que o administrador cadastrar ou ativar suas permissões no painel de Gestão de Usuários, seu acesso será liberado instantaneamente.
        </p>
      </div>
    </div>
  );
};
