import React, { useState } from 'react';
import { StorageService } from '../services/storageService';
import { IconShieldCheck, IconX, IconCheck } from './Icons';

interface AccountHelpModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultEmail?: string;
  defaultName?: string;
}

export const AccountHelpModal: React.FC<AccountHelpModalProps> = ({
  isOpen,
  onClose,
  defaultEmail = '',
  defaultName = ''
}) => {
  const [email, setEmail] = useState(defaultEmail);
  const [name, setName] = useState(defaultName);
  const [department, setDepartment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.length > 120) {
      setFeedback({ type: 'error', message: 'Por favor, informe um endereço de e-mail corporativo válido.' });
      return;
    }

    setIsSubmitting(true);
    setFeedback(null);

    const safeName = name.trim().substring(0, 60);
    const safeDept = department.trim().substring(0, 80);

    try {
      const res = await fetch('/api/recovery/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: cleanEmail,
          name: safeName || undefined,
          department: safeDept || undefined
        })
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 429) {
          setFeedback({
            type: 'error',
            message: data.message || 'Uma solicitação recente já foi registrada para este endereço nos últimos 15 minutos.'
          });
          return;
        }
        throw new Error(data.error || 'Erro ao registrar solicitação.');
      }

      // Also record in client storage service
      StorageService.saveRecoveryRequest({
        id: 'req_' + Date.now(),
        email: cleanEmail,
        name: safeName || undefined,
        department: safeDept || undefined,
        requestedAt: new Date().toISOString(),
        status: 'pending'
      });

      setFeedback({
        type: 'success',
        message: data.message || 'Solicitação enviada ao administrador! Ele analisará sua fila de solicitações no painel corporativo.'
      });
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Erro ao comunicar com o servidor de recuperação.'
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-[120] p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-md w-full p-6 shadow-2xl shadow-black/80 relative text-left space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
              <IconShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white leading-tight">
                Solicitar Ajuda ao Administrador
              </h3>
              <p className="text-[11px] text-slate-400">
                Recuperação de acesso e solicitação de liberação
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <IconX className="w-4 h-4" />
          </button>
        </div>

        {feedback && (
          <div className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/70 border-emerald-500/50 text-emerald-300'
              : 'bg-rose-950/70 border-rose-500/50 text-rose-300'
          }`}>
            {feedback.type === 'success' ? (
              <IconCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
            ) : (
              <span className="text-rose-400 font-bold shrink-0">⚠️</span>
            )}
            <p className="leading-relaxed">{feedback.message}</p>
          </div>
        )}

        {feedback?.type === 'success' ? (
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md transition-all cursor-pointer"
            >
              Fechar
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-3.5 pt-1">
            <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
              Informe seu e-mail corporativo (Microsoft 365 / Outlook) para notificar o administrador da workspace na fila interna de recuperação assistida.
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                E-mail Corporativo <span className="text-rose-400">*</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu.email@empresa.com"
                maxLength={120}
                required
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white font-mono placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Seu Nome Completo (Opcional)
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Ex: João da Silva"
                maxLength={60}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">
                Área / Departamento (Opcional)
              </label>
              <input
                type="text"
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="Ex: Automação RPA / Financeiro"
                maxLength={80}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="flex items-center justify-end gap-2.5 pt-3 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-xs shadow-md shadow-indigo-950/60 transition-all disabled:opacity-50 cursor-pointer"
              >
                {isSubmitting ? 'Enviando...' : 'Enviar Solicitação'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
