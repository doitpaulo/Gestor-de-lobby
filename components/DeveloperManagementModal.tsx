import React, { useState, useMemo, useRef, useEffect } from 'react';
import { Developer, Task } from '../types';
import { IconUsers, IconPlus, IconPencil, IconTrash, IconCheck, IconX, IconSearch } from './Icons';

interface DeveloperManagementModalProps {
  isOpen: boolean;
  onClose: () => void;
  developers: Developer[];
  tasks: Task[];
  onAddDev: (name: string) => { success: boolean; message: string };
  onEditDev: (id: string, newName: string) => { success: boolean; message: string };
  onDeleteDev: (id: string) => { success: boolean; message: string };
}

const AVATAR_GRADIENTS = [
  'from-indigo-600 to-blue-500',
  'from-emerald-600 to-teal-500',
  'from-amber-600 to-orange-500',
  'from-rose-600 to-pink-500',
  'from-purple-600 to-indigo-500',
  'from-cyan-600 to-blue-600',
  'from-violet-600 to-fuchsia-600',
];

const getAvatarGradient = (name: string) => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % AVATAR_GRADIENTS.length;
  return AVATAR_GRADIENTS[index];
};

const getInitials = (name: string) => {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0 || !parts[0]) return 'D';
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const DeveloperManagementModal: React.FC<DeveloperManagementModalProps> = ({
  isOpen,
  onClose,
  developers,
  tasks,
  onAddDev,
  onEditDev,
  onDeleteDev,
}) => {
  const [search, setSearch] = useState('');
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deletingDev, setDeletingDev] = useState<Developer | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null);

  const addInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        addInputRef.current?.focus();
      }, 100);
    } else {
      setSearch('');
      setNewName('');
      setEditingId(null);
      setEditingName('');
      setDeletingDev(null);
      setFeedback(null);
    }
  }, [isOpen]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Auto-dismiss feedback after 4 seconds
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  // Pre-calculate assigned tasks count per developer name
  const taskCountByDev = useMemo(() => {
    const map: Record<string, number> = {};
    tasks.forEach(t => {
      const assignee = (t.assignee || '').trim().toLowerCase();
      if (assignee) {
        map[assignee] = (map[assignee] || 0) + 1;
      }
    });
    return map;
  }, [tasks]);

  const filteredDevelopers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return developers;
    return developers.filter(d => d.name.toLowerCase().includes(q));
  }, [developers, search]);

  if (!isOpen) return null;

  const handleAddSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) {
      setFeedback({ type: 'error', text: 'Por favor, informe o nome do desenvolvedor.' });
      addInputRef.current?.focus();
      return;
    }

    const res = onAddDev(trimmed);
    if (res.success) {
      setNewName('');
      setFeedback({ type: 'success', text: res.message });
      addInputRef.current?.focus();
    } else {
      setFeedback({ type: 'error', text: res.message });
    }
  };

  const handleStartEdit = (dev: Developer) => {
    setEditingId(dev.id);
    setEditingName(dev.name);
    setFeedback(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditingName('');
  };

  const handleSaveEditSubmit = (dev: Developer, e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = editingName.trim();
    if (!trimmed) {
      setFeedback({ type: 'error', text: 'O nome do desenvolvedor não pode ficar vazio.' });
      editInputRef.current?.focus();
      return;
    }

    const targetId = dev.id || dev.name;
    const res = onEditDev(targetId, trimmed);
    if (res.success) {
      setEditingId(null);
      setEditingName('');
      setFeedback({ type: 'success', text: res.message });
    } else {
      setFeedback({ type: 'error', text: res.message });
    }
  };

  const handleConfirmDelete = () => {
    if (!deletingDev) return;
    const devId = deletingDev.id || deletingDev.name;
    const res = onDeleteDev(devId);
    setDeletingDev(null);
    if (res.success) {
      setFeedback({ type: 'success', text: res.message });
    } else {
      setFeedback({ type: 'error', text: res.message });
    }
  };

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-[70] p-3 sm:p-4 animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="manage-devs-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !deletingDev && !editingId) {
          onClose();
        }
      }}
    >
      <div className="bg-dark-900 border border-slate-700/80 rounded-2xl max-w-xl w-full shadow-2xl shadow-black/70 flex flex-col max-h-[90vh] overflow-hidden animate-fade-in-dialog">
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-dark-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-indigo-950/50 shrink-0">
              <IconUsers className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 id="manage-devs-title" className="text-base sm:text-lg font-bold text-white tracking-tight">
                  Gerenciar Desenvolvedores
                </h3>
                <span className="bg-indigo-950/80 text-indigo-300 border border-indigo-800/80 text-xs px-2 py-0.5 rounded-full font-semibold">
                  {developers.length} {developers.length === 1 ? 'membro' : 'membros'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Cadastre novos membros, edite nomes existentes ou remova da equipe.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fechar (Esc)"
            aria-label="Fechar janela de gerenciamento de desenvolvedores"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Alert Banner */}
        {feedback && (
          <div 
            className={`px-4 py-2.5 text-xs font-medium flex items-center justify-between shrink-0 border-b ${
              feedback.type === 'success' 
                ? 'bg-emerald-950/80 text-emerald-200 border-emerald-800/80' 
                : feedback.type === 'error'
                ? 'bg-rose-950/80 text-rose-200 border-rose-800/80'
                : 'bg-indigo-950/80 text-indigo-200 border-indigo-800/80'
            }`}
          >
            <span>{feedback.text}</span>
            <button 
              type="button"
              onClick={() => setFeedback(null)} 
              className="text-slate-400 hover:text-white ml-2 text-xs cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}

        {/* Add New Developer Form */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-dark-850/60 shrink-0">
          <label htmlFor="new-developer-name" className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Adicionar Novo Desenvolvedor à Equipe
          </label>
          <form onSubmit={handleAddSubmit} className="flex gap-2">
            <input
              ref={addInputRef}
              id="new-developer-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="Ex: Ana Clara, Carlos Mendes, Mariana Costa..."
              className="flex-1 bg-dark-950 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500 transition-all"
            />
            <button
              type="submit"
              className="px-4 py-2.5 bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 text-white rounded-xl text-sm font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-950/40 active:scale-95 transition-all cursor-pointer shrink-0"
              title="Salvar novo desenvolvedor"
            >
              <IconPlus className="w-4 h-4" />
              <span>Adicionar</span>
            </button>
          </form>
        </div>

        {/* Search and List Header */}
        <div className="px-4 py-3 border-b border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-dark-900 shrink-0">
          <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
            Membros da Equipe ({filteredDevelopers.length})
          </span>
          {developers.length > 2 && (
            <div className="relative w-full sm:w-60">
              <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar por nome..."
                className="w-full bg-dark-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white text-xs cursor-pointer"
                >
                  ✕
                </button>
              )}
            </div>
          )}
        </div>

        {/* Developer List */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2.5 custom-scrollbar min-h-[160px]">
          {filteredDevelopers.length === 0 ? (
            <div className="text-center py-10 px-4 border border-dashed border-slate-800 rounded-2xl bg-dark-950/40">
              <div className="w-12 h-12 mx-auto rounded-full bg-slate-800/80 flex items-center justify-center text-slate-500 mb-3">
                <IconUsers className="w-6 h-6" />
              </div>
              <p className="text-sm font-medium text-slate-300">
                {search ? 'Nenhum desenvolvedor encontrado na busca.' : 'Nenhum desenvolvedor cadastrado na equipe.'}
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                {search ? 'Tente buscar com outro termo ou limpe o campo.' : 'Utilize o campo acima para adicionar o primeiro desenvolvedor e vincular demandas.'}
              </p>
            </div>
          ) : (
            filteredDevelopers.map(dev => {
              const isEditing = editingId === dev.id;
              const assignedTasksCount = taskCountByDev[dev.name.trim().toLowerCase()] || 0;
              const gradient = getAvatarGradient(dev.name);
              const initials = getInitials(dev.name);

              if (isEditing) {
                return (
                  <form
                    key={dev.id}
                    onSubmit={(e) => handleSaveEditSubmit(dev, e)}
                    className="p-3 bg-dark-950 border-2 border-indigo-500/80 rounded-xl shadow-lg flex flex-col sm:flex-row items-stretch sm:items-center gap-2 animate-fade-in"
                  >
                    <div className="flex items-center gap-2.5 flex-1 min-w-0">
                      <div className={`w-8 h-8 rounded-lg bg-gradient-to-tr ${gradient} flex items-center justify-center text-white text-xs font-bold shrink-0`}>
                        {initials}
                      </div>
                      <input
                        ref={editInputRef}
                        type="text"
                        value={editingName}
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') handleCancelEdit();
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleSaveEditSubmit(dev, e);
                          }
                        }}
                        placeholder="Nome do desenvolvedor"
                        className="flex-1 bg-dark-900 border border-slate-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1.5 shrink-0 pt-1 sm:pt-0">
                      <button
                        type="submit"
                        onClick={(e) => handleSaveEditSubmit(dev, e)}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-xs font-bold flex items-center gap-1 shadow-sm cursor-pointer transition-colors"
                        title="Salvar alteração (Enter)"
                        aria-label={`Salvar alteração do nome de ${dev.name}`}
                      >
                        <IconCheck className="w-3.5 h-3.5" />
                        <span>Salvar</span>
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium flex items-center gap-1 cursor-pointer transition-colors"
                        title="Cancelar edição (Esc)"
                        aria-label="Cancelar edição"
                      >
                        <IconX className="w-3.5 h-3.5" />
                        <span>Cancelar</span>
                      </button>
                    </div>
                  </form>
                );
              }

              return (
                <div
                  key={dev.id}
                  className="group p-3 bg-dark-950/80 hover:bg-dark-950 border border-slate-800 hover:border-slate-700/80 rounded-xl flex items-center justify-between gap-3 transition-all"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={`w-9 h-9 rounded-xl bg-gradient-to-tr ${gradient} flex items-center justify-center text-white text-xs font-bold shrink-0 shadow-sm`}>
                      {initials}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-white truncate block">
                          {dev.name}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 block mt-0.5">
                        {assignedTasksCount > 0 ? (
                          <span className="text-indigo-400 font-medium">
                            {assignedTasksCount} {assignedTasksCount === 1 ? 'demanda vinculada' : 'demandas vinculadas'}
                          </span>
                        ) : (
                          <span className="text-slate-500">Sem demandas vinculadas</span>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Actions: Edit & Delete */}
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(dev)}
                      className="p-2 text-slate-400 hover:text-indigo-300 hover:bg-indigo-950/50 rounded-lg border border-transparent hover:border-indigo-800/60 transition-colors cursor-pointer"
                      title={`Editar nome de ${dev.name}`}
                      aria-label={`Editar desenvolvedor ${dev.name}`}
                    >
                      <IconPencil className="w-4 h-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingDev(dev)}
                      className="p-2 text-slate-400 hover:text-rose-300 hover:bg-rose-950/50 rounded-lg border border-transparent hover:border-rose-800/60 transition-colors cursor-pointer"
                      title={`Excluir desenvolvedor ${dev.name}`}
                      aria-label={`Excluir desenvolvedor ${dev.name}`}
                    >
                      <IconTrash className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Delete Confirmation Sub-Dialog */}
        {deletingDev && (
          <div className="p-4 border-t border-rose-900/50 bg-rose-950/40 shrink-0 animate-fade-in">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-rose-900/60 border border-rose-700/80 flex items-center justify-center text-rose-300 shrink-0">
                <IconTrash className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <h4 className="text-sm font-bold text-white">
                  Confirmar Exclusão de {deletingDev.name}?
                </h4>
                <p className="text-xs text-rose-200/90 mt-1">
                  {taskCountByDev[deletingDev.name.trim().toLowerCase()] > 0 ? (
                    <>
                      Atenção: Este desenvolvedor possui <strong className="font-bold underline">{taskCountByDev[deletingDev.name.trim().toLowerCase()]} demandas vinculadas</strong>. 
                      Ao confirmar, as demandas serão desvinculadas (Sem Atribuição).
                    </>
                  ) : (
                    'O desenvolvedor será removido permanentemente da equipe e da sincronização.'
                  )}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleConfirmDelete}
                    className="px-3.5 py-1.5 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-xs font-bold cursor-pointer transition-colors shadow-sm"
                  >
                    Confirmar Exclusão
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingDev(null)}
                    className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium cursor-pointer transition-colors"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="p-3.5 sm:p-4 border-t border-slate-800 bg-dark-950 flex items-center justify-between shrink-0">
          <span className="text-xs text-slate-500">
            Alterações são sincronizadas automaticamente com a nuvem e cache local.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold cursor-pointer transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
