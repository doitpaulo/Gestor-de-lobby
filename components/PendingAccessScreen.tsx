import React, { useEffect, useState } from 'react';
import { User, AccessRequest, NEXUS_OWNER_UID } from '../types';
import { FirebaseService } from '../services/firebase';
import { IconShieldCheck, IconClock, IconUsers, IconCheck } from './Icons';

interface PendingAccessScreenProps {
  user: User;
  onRefresh: () => Promise<void> | void;
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
  const [isNotifying, setIsNotifying] = useState(false);
  const [notifySuccess, setNotifySuccess] = useState(false);
  const [notifyError, setNotifyError] = useState<string | null>(null);
  const [existingRequest, setExistingRequest] = useState<AccessRequest | null>(null);
  const [devNameHint, setDevNameHint] = useState(user.name || '');

  const [isSendingVerify, setIsSendingVerify] = useState(false);
  const [verifyFeedback, setVerifyFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const isInactive = user.status === 'inactive';
  const isEmailUnverified = user.emailVerified === false || user.pendingReason === 'EMAIL_UNVERIFIED';
  const isUidUnlinked = user.pendingReason === 'UID_UNLINKED';

  useEffect(() => {
    let active = true;
    if (!user?.id || isInactive) return;

    FirebaseService.fetchMyAccessRequest(NEXUS_OWNER_UID, user.id)
      .then((req) => {
        if (!active) return;
        setExistingRequest(req);
        if (req && req.status === 'pending') {
          setNotifySuccess(true);
        }
      })
      .catch((err: any) => {
        if (!active) return;
        console.warn('Could not read access request status:', err);
      });

    return () => {
      active = false;
    };
  }, [user?.id, isInactive]);

  const handleCheckAgain = async () => {
    setIsChecking(true);
    setNotifyError(null);
    setVerifyFeedback(null);
    try {
      await FirebaseService.reloadCurrentUser().catch(() => null);
      await onRefresh();
    } catch (e: any) {
      setNotifyError(e?.message || 'Não foi possível verificar o status atualizado no servidor.');
    } finally {
      setTimeout(() => setIsChecking(false), 400);
    }
  };

  const handleResendVerification = async () => {
    setIsSendingVerify(true);
    setVerifyFeedback(null);
    try {
      await FirebaseService.sendVerificationEmail();
      setVerifyFeedback({
        type: 'success',
        message: `E-mail de verificação enviado para ${user.email}. Abra o link recebido e depois clique em "Já verifiquei meu e-mail".`
      });
    } catch (e: any) {
      setVerifyFeedback({
        type: 'error',
        message: e?.message || 'Não foi possível enviar o e-mail de verificação agora. Tente novamente em instantes.'
      });
    } finally {
      setIsSendingVerify(false);
    }
  };

  const handleSendAdminNotification = async () => {
    setIsNotifying(true);
    setNotifyError(null);
    try {
      if (isEmailUnverified) {
        throw new Error('Confirme seu e-mail primeiro usando o link enviado pelo Firebase antes de registrar a solicitação.');
      }
      const reqData: AccessRequest = {
        id: user.id,
        uid: user.id,
        email: (user.email || '').trim().toLowerCase(),
        name: (user.name || '').trim().slice(0, 120) || undefined,
        department: `Solicitação autenticada (UID: ${user.id})`.slice(0, 160),
        devNameHint: devNameHint.trim().slice(0, 120) || undefined,
        requestedAt: new Date().toISOString(),
        status: 'pending'
      };

      await FirebaseService.saveAccessRequest(NEXUS_OWNER_UID, reqData);
      setExistingRequest(reqData);
      setNotifySuccess(true);
    } catch (e: any) {
      console.error('Error sending access request:', e);
      setNotifyError(
        e?.message ||
          'Falha ao persistir solicitação de acesso no Firestore. Verifique sua conexão ou informe seu UID diretamente ao Administrador.'
      );
    } finally {
      setIsNotifying(false);
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

  return (
    <div className="min-h-screen flex items-center justify-center bg-dark-900 p-4 relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 pointer-events-none" />
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/15 rounded-full blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-amber-600/10 rounded-full blur-[130px] pointer-events-none" />

      <div className="w-full max-w-lg bg-dark-850/95 backdrop-blur-2xl border border-slate-800 rounded-3xl p-6 sm:p-8 shadow-2xl shadow-black/60 relative z-10 text-center animate-fade-in">
        {/* Status Icon */}
        <div
          className="w-20 h-20 mx-auto mb-5 rounded-2xl flex items-center justify-center border shadow-xl transition-transform hover:scale-105 duration-200"
          style={{
            backgroundColor: isInactive ? 'rgba(244, 63, 94, 0.12)' : isUidUnlinked ? 'rgba(99, 102, 241, 0.12)' : 'rgba(245, 158, 11, 0.12)',
            borderColor: isInactive ? 'rgba(244, 63, 94, 0.35)' : isUidUnlinked ? 'rgba(99, 102, 241, 0.35)' : 'rgba(245, 158, 11, 0.35)',
            color: isInactive ? '#fb7185' : isUidUnlinked ? '#818cf8' : '#fbbf24'
          }}
        >
          {isInactive ? (
            <IconShieldCheck className="w-10 h-10 text-rose-400" />
          ) : isUidUnlinked ? (
            <IconShieldCheck className="w-10 h-10 text-indigo-400 animate-pulse" />
          ) : (
            <IconClock className="w-10 h-10 text-amber-400 animate-pulse" />
          )}
        </div>

        {/* Title & Badge */}
        <div
          className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-3 border"
          style={{
            backgroundColor: isInactive ? 'rgba(244, 63, 94, 0.15)' : isUidUnlinked ? 'rgba(99, 102, 241, 0.15)' : 'rgba(245, 158, 11, 0.15)',
            borderColor: isInactive ? 'rgba(244, 63, 94, 0.4)' : isUidUnlinked ? 'rgba(99, 102, 241, 0.4)' : 'rgba(245, 158, 11, 0.4)',
            color: isInactive ? '#fecdd3' : isUidUnlinked ? '#c7d2fe' : '#fef3c7'
          }}
        >
          <span
            className="w-2 h-2 rounded-full"
            style={{ backgroundColor: isInactive ? '#f43f5e' : isUidUnlinked ? '#6366f1' : '#f59e0b' }}
          />
          <span>
            {isInactive
              ? 'Acesso Desativado'
              : isEmailUnverified
              ? 'Confirmação de E-mail Pendente'
              : isUidUnlinked
              ? 'E-mail Autorizado • Vinculação de UID Pendente'
              : 'Aguardando Aprovação do Administrador'}
          </span>
        </div>

        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight mb-2">
          {isInactive
            ? 'Conta Temporariamente Inativa'
            : isEmailUnverified
            ? 'Confirme seu E-mail para Continuar'
            : isUidUnlinked
            ? 'Aguardando Vinculação de UID pelo ADM'
            : 'Acesso Pendente de Aprovação'}
        </h2>

        <div className="text-sm text-slate-300 leading-relaxed mb-6 space-y-2">
          {isInactive ? (
            <p>
              Sua conta foi identificada no sistema, porém o acesso está configurado como <strong className="text-rose-400">inativo</strong>. Entre em contato com o administrador do Nexus para reativação do seu perfil.
            </p>
          ) : isEmailUnverified ? (
            <p>
              Olá, <strong className="text-white">{user.name || 'Colaborador'}</strong>! Para segurança da workspace, é necessário verificar seu endereço de e-mail antes de enviar sua solicitação de acesso ou solicitar ao administrador a vinculação direta da sua conta.
            </p>
          ) : isUidUnlinked ? (
            <>
              <p>
                Olá, <strong className="text-white">{user.name || 'Colaborador'}</strong>! Seu e-mail já possui registro prévio, mas aguarda vinculação do seu identificador <span className="text-indigo-300 font-semibold">UID</span> pelo Administrador.
              </p>
              <p className="text-xs text-indigo-300/90 bg-indigo-950/40 border border-indigo-500/30 p-2.5 rounded-xl">
                Informe o UID abaixo ao Administrador ou envie a solicitação autenticada para agilizar a liberação das suas demandas.
              </p>
            </>
          ) : (
            <>
              <p>
                Olá, <strong className="text-white">{user.name || 'Colaborador'}</strong>! Sua conta está autenticada, mas ainda <span className="text-amber-400 font-semibold">aguarda provisionamento e aprovação</span> pelo Administrador do Nexus.
              </p>
              <p className="text-xs text-slate-400">
                O cadastro na lista de Devs do dashboard não libera login automaticamente: o ADM precisa vincular seu UID, definir seus módulos (ex: Lista/Kanban) e selecionar suas demandas autorizadas.
              </p>
            </>
          )}
        </div>

        {/* User Card info box */}
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 mb-5 text-left space-y-2">
          <div className="flex items-center justify-between text-xs text-slate-400 border-b border-slate-800 pb-2">
            <span className="font-semibold uppercase tracking-wider">Identificação do Usuário</span>
            <button
              type="button"
              onClick={handleCopyId}
              className="text-indigo-400 hover:text-indigo-300 text-[11px] font-semibold underline cursor-pointer flex items-center gap-1"
            >
              {copied ? (
                <>
                  <IconCheck className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">Copiado!</span>
                </>
              ) : (
                'Copiar E-mail e UID'
              )}
            </button>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <div className="w-10 h-10 rounded-xl bg-indigo-950/80 border border-indigo-500/30 flex items-center justify-center text-indigo-300 font-bold text-sm shrink-0">
              <IconUsers className="w-5 h-5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="text-xs font-semibold text-white truncate">{user.name || 'Sem nome'}</p>
                <span className={`text-[9px] px-1.5 py-0.5 rounded font-mono border ${
                  user.emailVerified
                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                    : 'bg-amber-950/60 text-amber-300 border-amber-500/40'
                }`}>
                  {user.emailVerified ? 'E-mail verificado' : 'E-mail não verificado'}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 font-mono truncate">{user.email || 'Sem email'}</p>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-slate-500 font-mono">UID:</span>
                <span className="text-[11px] text-indigo-300 font-mono font-semibold truncate bg-indigo-950/60 px-1.5 py-0.2 rounded border border-indigo-500/30">
                  {user.id}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Email verification step when unverified */}
        {!isInactive && isEmailUnverified && (
          <div className="mb-5 p-4 bg-amber-950/30 border border-amber-500/40 rounded-2xl text-left space-y-3">
            <p className="text-xs font-bold text-amber-300">
              Etapa 1: Verificação de E-mail Obrigatória
            </p>
            <p className="text-[11px] text-slate-300 leading-relaxed">
              Para enviar sua solicitação autenticada à fila do Administrador, confirme o link enviado para <strong>{user.email}</strong>. Se preferir, envie seu UID acima ao Administrador para vinculação manual direta.
            </p>
            {verifyFeedback && (
              <div className={`p-2.5 rounded-xl border text-[11px] ${
                verifyFeedback.type === 'success'
                  ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                  : 'bg-rose-950/60 border-rose-500/40 text-rose-300'
              }`}>
                {verifyFeedback.message}
              </div>
            )}
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={handleResendVerification}
                disabled={isSendingVerify}
                className="flex-1 py-2 px-3 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSendingVerify ? 'Enviando...' : 'Reenviar E-mail de Verificação'}
              </button>
              <button
                type="button"
                onClick={handleCheckAgain}
                disabled={isChecking}
                className="py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                Já Verifiquei Meu E-mail
              </button>
            </div>
          </div>
        )}

        {/* Authenticated Access Request Submission */}
        {!isInactive && !isEmailUnverified && (
          <div className="mb-6 p-4 bg-indigo-950/40 border border-indigo-500/40 rounded-2xl text-left space-y-3">
            {notifySuccess || existingRequest?.status === 'pending' ? (
              <div className="flex items-start gap-2.5 text-xs font-semibold text-emerald-300">
                <IconCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                <div>
                  <p>Solicitação persistida na fila de aprovações do Administrador!</p>
                  <p className="text-[11px] font-normal text-emerald-200/80 mt-0.5">
                    Seu UID e e-mail verificado estão aguardando análise. Assim que o ADM aprovar e liberar suas demandas, clique em "Verificar Acesso Novamente".
                  </p>
                </div>
              </div>
            ) : existingRequest?.status === 'rejected' ? (
              <div className="text-xs text-rose-300 bg-rose-950/50 border border-rose-500/40 p-3 rounded-xl">
                Sua solicitação anterior foi rejeitada pelo Administrador. Caso seja um engano, copie seu UID acima e contate o administrador pelo canal corporativo.
              </div>
            ) : (
              <>
                <div>
                  <p className="text-xs font-bold text-white flex items-center gap-1.5">
                    <IconShieldCheck className="w-4 h-4 text-indigo-400" />
                    <span>Registrar Solicitação Autenticada ao ADM</span>
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Envia uma solicitação vinculada ao seu UID e e-mail verificado diretamente para o painel do Administrador.
                  </p>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                    Seu Nome como Desenvolvedor (Opcional)
                  </label>
                  <input
                    type="text"
                    value={devNameHint}
                    onChange={(e) => setDevNameHint(e.target.value)}
                    maxLength={120}
                    placeholder="Ex: Arthur Faria Santos"
                    className="w-full bg-dark-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
                  />
                </div>

                <button
                  type="button"
                  onClick={handleSendAdminNotification}
                  disabled={isNotifying}
                  className="w-full py-2.5 px-3.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-md transition-all active:scale-95 disabled:opacity-50 cursor-pointer"
                >
                  {isNotifying ? 'Registrando no Firestore...' : 'Enviar Solicitação ao Administrador'}
                </button>
              </>
            )}

            {notifyError && (
              <div className="p-2.5 rounded-xl bg-rose-950/70 border border-rose-500/50 text-[11px] text-rose-200 leading-relaxed">
                {notifyError}
              </div>
            )}
          </div>
        )}

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
              Precisa de ajuda ou esqueceu credenciais? Solicitar ajuda ao administrador
            </button>
          </div>
        )}

        <p className="text-[11px] text-slate-500 mt-4 italic">
          * Assim que o administrador provisionar ou vincular seu perfil no painel de Administração, seu acesso será liberado instantaneamente.
        </p>
      </div>
    </div>
  );
};
