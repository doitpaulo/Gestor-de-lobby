import React, { useState, useMemo, useEffect } from 'react';
import { 
  User, 
  Task, 
  WorkspaceMember, 
  UserRole, 
  UserStatus, 
  UserPermissions, 
  AccountRecoveryRequest,
  NEXUS_OWNER_UID,
  DEFAULT_ADM_PERMISSIONS, 
  DEFAULT_COLLABORATOR_PERMISSIONS 
} from '../types';
import { OWNER_EMAIL, StorageService } from '../services/storageService';
import { FirebaseService } from '../services/firebase';
import { 
  IconShieldCheck, 
  IconUsers, 
  IconPlus, 
  IconPencil, 
  IconSearch, 
  IconCheck, 
  IconX, 
  IconClock, 
  IconKanban, 
  IconProject, 
  IconDownload, 
  IconDocument,
  IconSprint 
} from './Icons';

interface AdminUserManagementViewProps {
  currentUser: User;
  tasks: Task[];
  onMembersUpdated?: () => void;
}

export const AdminUserManagementView: React.FC<AdminUserManagementViewProps> = ({
  currentUser,
  tasks,
  onMembersUpdated
}) => {
  const [activeTab, setActiveTab] = useState<'members' | 'recovery'>('members');
  const [members, setMembers] = useState<WorkspaceMember[]>(() => StorageService.getMembers());
  const [recoveryRequests, setRecoveryRequests] = useState<AccountRecoveryRequest[]>(() => StorageService.getRecoveryRequests());
  const [recoveryModalInfo, setRecoveryModalInfo] = useState<{ open: boolean; title: string; message: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | UserStatus>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<WorkspaceMember | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  // Link UID Modal state
  const [linkUidModalMember, setLinkUidModalMember] = useState<WorkspaceMember | null>(null);
  const [linkUidInput, setLinkUidInput] = useState('');

  // Form states inside modal
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('Colaborador');
  const [formStatus, setFormStatus] = useState<UserStatus>('active');
  const [formPermissions, setFormPermissions] = useState<UserPermissions>(DEFAULT_COLLABORATOR_PERMISSIONS);
  const [formAssignedTasks, setFormAssignedTasks] = useState<string[]>([]);
  const [demandSearchFilter, setDemandSearchFilter] = useState('');

  const triggerToast = (type: 'success' | 'info' | 'error', message: string) => {
    setFeedbackToast({ type, message });
    setTimeout(() => {
      setFeedbackToast(prev => prev?.message === message ? null : prev);
    }, 4000);
  };

  const reloadMembers = () => {
    const list = StorageService.getMembers();
    setMembers(list);
    if (onMembersUpdated) onMembersUpdated();
  };

  const handleOpenLinkUid = (member: WorkspaceMember) => {
    setLinkUidModalMember(member);
    setLinkUidInput(member.uid || '');
  };

  const handleConfirmLinkUid = (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUidModalMember) return;
    const cleanUid = linkUidInput.trim();
    if (!cleanUid) {
      triggerToast('error', 'Por favor, informe o UID do usuário.');
      return;
    }
    const updated = StorageService.linkMemberUid(linkUidModalMember.id, cleanUid, true);
    if (updated) {
      reloadMembers();
      setLinkUidModalMember(null);
      setLinkUidInput('');
      triggerToast('success', `UID vinculado com sucesso! Colaborador ${updated.name} está ativado.`);
    } else {
      triggerToast('error', 'Falha ao vincular UID.');
    }
  };

  const openCreateModal = () => {
    setEditingMember(null);
    setFormEmail('');
    setFormName('');
    setFormRole('Colaborador');
    setFormStatus('active');
    setFormPermissions(JSON.parse(JSON.stringify(DEFAULT_COLLABORATOR_PERMISSIONS)));
    setFormAssignedTasks([]);
    setDemandSearchFilter('');
    setIsModalOpen(true);
  };

  const openEditModal = (member: WorkspaceMember) => {
    setEditingMember(member);
    setFormEmail(member.email);
    setFormName(member.name);
    setFormRole(member.role);
    setFormStatus(member.status);
    setFormPermissions(JSON.parse(JSON.stringify(member.permissions || (member.role === 'ADM' ? DEFAULT_ADM_PERMISSIONS : DEFAULT_COLLABORATOR_PERMISSIONS))));
    setFormAssignedTasks(member.assignedTaskIds || []);
    setDemandSearchFilter('');
    setIsModalOpen(true);
  };

  const handleRoleChange = (newRole: UserRole) => {
    setFormRole(newRole);
    if (newRole === 'ADM') {
      setFormPermissions(JSON.parse(JSON.stringify(DEFAULT_ADM_PERMISSIONS)));
    } else {
      setFormPermissions(JSON.parse(JSON.stringify(DEFAULT_COLLABORATOR_PERMISSIONS)));
    }
  };

  const handleToggleModule = (key: keyof UserPermissions['modules']) => {
    setFormPermissions(prev => ({
      ...prev,
      modules: {
        ...prev.modules,
        [key]: !prev.modules[key]
      }
    }));
  };

  const handleToggleAction = (key: keyof UserPermissions['actions']) => {
    setFormPermissions(prev => ({
      ...prev,
      actions: {
        ...prev.actions,
        [key]: !prev.actions[key]
      }
    }));
  };

  const handleToggleCanManageSprints = () => {
    setFormPermissions(prev => ({
      ...prev,
      canManageSprints: !prev.canManageSprints
    }));
  };

  const handleToggleTaskAssignment = (taskId: string) => {
    setFormAssignedTasks(prev => {
      if (prev.includes(taskId)) {
        return prev.filter(id => id !== taskId);
      }
      return [...prev, taskId];
    });
  };

  const handleSelectAllTasks = () => {
    setFormAssignedTasks(tasks.map(t => t.id));
  };

  const handleClearAllTasks = () => {
    setFormAssignedTasks([]);
  };

  const isOwnerMember = (m?: WorkspaceMember | null) => {
    if (!m) return false;
    return m.uid === NEXUS_OWNER_UID || m.id === NEXUS_OWNER_UID || m.id === 'member_owner_paulo' || (m.email && m.email.toLowerCase() === 'paulo.mmartinio@gmail.com');
  };

  useEffect(() => {
    const unsub = FirebaseService.subscribeRecoveryRequests(NEXUS_OWNER_UID, (list) => {
      setRecoveryRequests(list);
      StorageService.setRecoveryRequestsInMemory(list);
    });
    return () => unsub();
  }, []);

  const handleSaveMember = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = formEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      triggerToast('error', 'Por favor, informe um e-mail válido.');
      return;
    }

    const memberId = editingMember ? editingMember.id : `mem_${cleanEmail.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const cleanName = formName.trim() || cleanEmail.split('@')[0];

    const isOwner = isOwnerMember(editingMember) || cleanEmail === 'paulo.mmartinio@gmail.com' || editingMember?.uid === NEXUS_OWNER_UID;

    // Protection: only root owner can promote someone to ADM
    if (!isOwner && formRole === 'ADM' && currentUser.id !== NEXUS_OWNER_UID) {
      triggerToast('error', 'Apenas o proprietário raiz do workspace pode promover usuários ao perfil ADM.');
      return;
    }

    const newMember: WorkspaceMember = {
      id: memberId,
      uid: editingMember?.uid,
      email: cleanEmail,
      name: cleanName,
      role: isOwner ? 'ADM' : formRole,
      status: isOwner ? 'active' : formStatus,
      permissions: isOwner ? DEFAULT_ADM_PERMISSIONS : formPermissions,
      assignedTaskIds: isOwner ? [] : formAssignedTasks,
      workspaceOwnerUid: NEXUS_OWNER_UID,
      invitedAt: editingMember?.invitedAt || new Date().toISOString(),
      activatedAt: formStatus === 'active' ? (editingMember?.activatedAt || new Date().toISOString()) : undefined,
      invitedBy: currentUser.email
    };

    StorageService.saveMember(newMember, NEXUS_OWNER_UID);
    reloadMembers();
    setIsModalOpen(false);
    triggerToast('success', editingMember ? `Permissões de ${cleanName} atualizadas com sucesso!` : `Novo colaborador ${cleanName} pré-cadastrado com sucesso!`);
  };

  const handleToggleStatus = (member: WorkspaceMember) => {
    if (isOwnerMember(member)) {
      triggerToast('error', 'O proprietário da workspace principal não pode ser desativado.');
      return;
    }
    const newStatus: UserStatus = member.status === 'active' ? 'inactive' : 'active';
    const updated: WorkspaceMember = {
      ...member,
      status: newStatus,
      activatedAt: newStatus === 'active' ? new Date().toISOString() : member.activatedAt
    };
    StorageService.saveMember(updated, NEXUS_OWNER_UID);
    reloadMembers();
    triggerToast('info', `Status de ${member.name} alterado para ${newStatus === 'active' ? 'Ativo' : 'Inativo'}.`);
  };

  const handleDeleteMember = (member: WorkspaceMember) => {
    if (isOwnerMember(member)) {
      triggerToast('error', 'O proprietário da workspace principal não pode ser removido.');
      return;
    }
    if (window.confirm(`Tem certeza que deseja remover o usuário ${member.name} (${member.email}) da workspace?`)) {
      StorageService.deleteMember(member.id, NEXUS_OWNER_UID);
      reloadMembers();
      triggerToast('success', `Usuário ${member.name} removido com sucesso.`);
    }
  };

  const handleGenerateResetLink = async (reqItem: AccountRecoveryRequest) => {
    if (reqItem.email.toLowerCase() === 'paulo.mmartinio@gmail.com') {
      triggerToast('error', 'A conta do proprietário do workspace não pode ser redefinida via este canal.');
      return;
    }

    try {
      const res = await fetch('/api/admin/generate-password-reset-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          targetEmail: reqItem.email
        })
      });

      const data = await res.json().catch(() => ({}));
      setRecoveryModalInfo({
        open: true,
        title: 'Recuperação Assistida (Fail-Closed)',
        message: data.message || 'Credencial Firebase Admin SDK não configurada no servidor (fail-closed seguro). O administrador deve orientar o usuário a utilizar o canal corporativo ou o fluxo de redefinição oficial do Firebase Auth.'
      });
    } catch (e: any) {
      setRecoveryModalInfo({
        open: true,
        title: 'Recuperação Assistida',
        message: 'Serviço de geração individual offline no servidor. O administrador deve orientar o usuário a utilizar o canal corporativo ou o fluxo oficial do Firebase Auth.'
      });
    }
  };

  const handleUpdateRecoveryStatus = (id: string, newStatus: 'resolved' | 'rejected') => {
    StorageService.updateRecoveryRequestStatus(id, newStatus, currentUser.id);
    setRecoveryRequests(prev => prev.map(r => r.id === id ? { ...r, status: newStatus, resolvedAt: new Date().toISOString() } : r));
    triggerToast('success', `Solicitação marcada como ${newStatus === 'resolved' ? 'Atendida' : 'Rejeitada'}.`);
  };

  const handleCopyInvite = (member: WorkspaceMember) => {
    // PRD domain priority or current origin if on custom domain
    const appBaseUrl = window.location.hostname === 'localhost' || window.location.hostname.includes('webcontainer')
      ? 'https://gestor-de-lobby.vercel.app'
      : window.location.origin;

    const inviteText = `Olá ${member.name}!\n\nSeu acesso à workspace Nexus foi pré-autorizado pelo Administrador.\n\n• E-mail autorizado: ${member.email}\n• Perfil: ${member.role}\n\nINSTRUÇÕES DE PRIMEIRO ACESSO:\n1. Acesse o sistema em: ${appBaseUrl}\n2. Na tela de autenticação, clique na aba "Primeiro Acesso / Ativar Conta"\n3. Preencha seu nome, e-mail (${member.email}) e cadastre uma senha pessoal do Nexus (mínimo 6 caracteres). Não utilize sua senha corporativa do Windows/Outlook.\n4. Após concluir o cadastro, seu perfil e permissões serão validados e ativados pelo Administrador.`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(inviteText);
      triggerToast('success', `Instruções de acesso e convite de ${member.name} copiadas!`);
    }
  };

  // Filtered members list
  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      const matchSearch = (m.name || '').toLowerCase().includes(searchTerm.toLowerCase()) || 
                          (m.email || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'all' || m.status === statusFilter;
      const matchRole = roleFilter === 'all' || m.role === roleFilter;
      return matchSearch && matchStatus && matchRole;
    });
  }, [members, searchTerm, statusFilter, roleFilter]);

  // Filtered tasks inside modal
  const filteredTasksForSelection = useMemo(() => {
    if (!demandSearchFilter.trim()) return tasks;
    const q = demandSearchFilter.trim().toLowerCase();
    return tasks.filter(t => 
      t.id.toLowerCase().includes(q) || 
      t.summary.toLowerCase().includes(q) || 
      (t.assignee && t.assignee.toLowerCase().includes(q))
    );
  }, [tasks, demandSearchFilter]);

  // Metrics calculation
  const totalCount = members.length;
  const adminCount = members.filter(m => m.role === 'ADM').length;
  const activeCount = members.filter(m => m.status === 'active' && m.role === 'Colaborador').length;
  const pendingCount = members.filter(m => m.status === 'pending').length;

  return (
    <div className="h-full flex flex-col space-y-5 animate-fade-in pr-1">
      {/* Toast */}
      {feedbackToast && (
        <div className={`fixed top-5 right-5 z-[100] px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-2.5 animate-fade-in ${
          feedbackToast.type === 'success' 
            ? 'bg-emerald-950/95 border-emerald-500 text-emerald-300' 
            : feedbackToast.type === 'error'
            ? 'bg-rose-950/95 border-rose-500 text-rose-300'
            : 'bg-indigo-950/95 border-indigo-500 text-indigo-300'
        }`}>
          {feedbackToast.type === 'success' ? <IconCheck className="w-4 h-4 text-emerald-400" /> : <IconShieldCheck className="w-4 h-4" />}
          <span>{feedbackToast.message}</span>
        </div>
      )}

      {/* Top Banner / Hero */}
      <div className="bg-gradient-to-r from-slate-900 via-dark-850 to-indigo-950/40 p-5 sm:p-6 rounded-2xl border border-slate-800 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-indigo-600 to-emerald-500 flex items-center justify-center text-white shadow-lg shadow-indigo-900/40 shrink-0">
            <IconShieldCheck className="w-6 h-6 stroke-[2]" />
          </div>
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <h2 className="text-xl sm:text-2xl font-black text-white tracking-tight">
                Administração de Usuários & Permissões
              </h2>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                Painel do Administrador (ADM)
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Configure individualmente a visibilidade de módulos, ações e demandas autorizadas para cada colaborador.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="h-10 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/50 transition-all active:scale-95 cursor-pointer shrink-0"
        >
          <IconPlus className="w-4 h-4 stroke-[2.5]" />
          <span>+ Autorizar Acesso</span>
        </button>
      </div>

      {/* Navigation Sub-Tabs */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab('members')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'members'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/50'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <IconUsers className="w-4 h-4" />
          <span>Membros & Permissões</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 font-mono">
            {members.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('recovery')}
          className={`px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center gap-2 cursor-pointer ${
            activeTab === 'recovery'
              ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-950/50'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
          }`}
        >
          <IconShieldCheck className="w-4 h-4 text-amber-400" />
          <span>Fila de Recuperação de Acesso</span>
          {recoveryRequests.filter(r => r.status === 'pending').length > 0 ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold animate-pulse">
              {recoveryRequests.filter(r => r.status === 'pending').length} pendente(s)
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 font-mono text-slate-400">
              {recoveryRequests.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: MEMBERS MANAGEMENT */}
      {activeTab === 'members' && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <IconUsers className="w-3.5 h-3.5 text-slate-400" />
                <span>Total Cadastrados</span>
              </p>
              <p className="text-2xl font-black text-white">{totalCount}</p>
            </div>

            <div className="bg-indigo-950/30 border border-indigo-500/30 rounded-2xl p-4 shadow-sm">
              <p className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <IconShieldCheck className="w-3.5 h-3.5 text-indigo-400" />
                <span>Administradores (ADM)</span>
              </p>
              <p className="text-2xl font-black text-indigo-400">{adminCount}</p>
            </div>

            <div className="bg-emerald-950/30 border border-emerald-500/30 rounded-2xl p-4 shadow-sm">
              <p className="text-[11px] font-bold text-emerald-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <IconCheck className="w-3.5 h-3.5 text-emerald-400" />
                <span>Colaboradores Ativos</span>
              </p>
              <p className="text-2xl font-black text-emerald-400">{activeCount}</p>
            </div>

            <div className="bg-amber-950/30 border border-amber-500/30 rounded-2xl p-4 shadow-sm">
              <p className="text-[11px] font-bold text-amber-300 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <IconClock className="w-3.5 h-3.5 text-amber-400" />
                <span>Acessos Pendentes</span>
              </p>
              <p className="text-2xl font-black text-amber-400">{pendingCount}</p>
            </div>
          </div>

          {/* Filter and Search Bar */}
          <div className="bg-slate-900/80 border border-slate-800 p-3.5 rounded-2xl flex flex-col md:flex-row gap-3 items-center justify-between">
            <div className="relative w-full md:w-80">
              <IconSearch className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Buscar por nome ou e-mail..."
                className="w-full bg-dark-900 border border-slate-700/80 rounded-xl pl-9 pr-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 transition-colors"
              />
            </div>

            <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
              <span className="text-xs text-slate-400 font-semibold shrink-0">Filtrar:</span>
              
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-dark-900 text-xs text-slate-200 border border-slate-700/80 rounded-xl px-2.5 py-1.5 outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">Status: Todos</option>
                <option value="active">Ativos</option>
                <option value="pending">Pendentes</option>
                <option value="inactive">Inativos</option>
              </select>

              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value as any)}
                className="bg-dark-900 text-xs text-slate-200 border border-slate-700/80 rounded-xl px-2.5 py-1.5 outline-none focus:border-indigo-500 cursor-pointer"
              >
                <option value="all">Perfil: Todos</option>
                <option value="ADM">ADM (Administrador)</option>
                <option value="Colaborador">Colaborador</option>
              </select>

              {(searchTerm || statusFilter !== 'all' || roleFilter !== 'all') && (
                <button
                  onClick={() => { setSearchTerm(''); setStatusFilter('all'); setRoleFilter('all'); }}
                  className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer shrink-0 ml-1"
                >
                  Limpar
                </button>
              )}
            </div>
          </div>

          {/* Users Table */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex-1 flex flex-col">
            <div className="overflow-x-auto flex-1 custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3.5 px-4">Usuário / Colaborador</th>
                    <th className="py-3.5 px-3">Perfil</th>
                    <th className="py-3.5 px-3">Status</th>
                    <th className="py-3.5 px-3">Demandas Autorizadas</th>
                    <th className="py-3.5 px-3">Módulos Liberados</th>
                    <th className="py-3.5 px-3">Ações Permitidas</th>
                    <th className="py-3.5 px-4 text-right">Gerenciar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {filteredMembers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-12 text-center text-slate-500">
                        Nenhum usuário encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  ) : (
                    filteredMembers.map(member => {
                      const isOwner = isOwnerMember(member);
                      const assignedCount = member.assignedTaskIds ? member.assignedTaskIds.length : 0;
                  
                  return (
                    <tr key={member.id} className="hover:bg-slate-800/30 transition-colors">
                      {/* Name & Email */}
                      <td className="py-3.5 px-4">
                        <div className="flex items-center gap-3 min-w-[200px]">
                          <div className="w-9 h-9 rounded-xl bg-slate-800 border border-slate-700 flex items-center justify-center font-bold text-xs text-indigo-300 shrink-0">
                            {member.name.substring(0, 2).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="font-bold text-white text-xs truncate">{member.name}</p>
                              {isOwner && (
                                <span className="text-[9px] bg-indigo-500/20 text-indigo-300 border border-indigo-500/40 px-1.5 py-0.2 rounded font-mono font-normal">
                                  Owner
                                </span>
                              )}
                              {!isOwner && (
                                member.uid ? (
                                  <span className="text-[9px] bg-slate-800 text-slate-400 font-mono px-1.5 py-0.2 rounded border border-slate-700/60" title={`UID: ${member.uid}`}>
                                    UID OK
                                  </span>
                                ) : (
                                  <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-mono">
                                    UID pendente
                                  </span>
                                )
                              )}
                            </div>
                            <p className="text-[11px] text-slate-400 font-mono truncate">{member.email}</p>
                          </div>
                        </div>
                      </td>

                      {/* Role Badge */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          member.role === 'ADM'
                            ? 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40'
                            : 'bg-slate-800 text-slate-300 border-slate-700'
                        }`}>
                          {member.role === 'ADM' ? 'Administrador' : 'Colaborador'}
                        </span>
                      </td>

                      {/* Status Badge */}
                      <td className="py-3.5 px-3 whitespace-nowrap">
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          member.status === 'active'
                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                            : member.status === 'pending'
                            ? 'bg-amber-950/60 text-amber-300 border-amber-500/40'
                            : 'bg-rose-950/60 text-rose-300 border-rose-500/40'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${
                            member.status === 'active' ? 'bg-emerald-400' : member.status === 'pending' ? 'bg-amber-400 animate-pulse' : 'bg-rose-400'
                          }`} />
                          <span>
                            {member.status === 'active' ? 'Ativo' : member.status === 'pending' ? 'Pendente' : 'Inativo'}
                          </span>
                        </span>
                      </td>

                      {/* Assigned Tasks */}
                      <td className="py-3.5 px-3">
                        {member.role === 'ADM' ? (
                          <span className="text-[11px] font-semibold text-indigo-300">
                            Acesso a Todas as Demandas
                          </span>
                        ) : assignedCount > 0 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="px-2 py-0.5 bg-emerald-950/40 border border-emerald-500/30 text-emerald-300 rounded font-semibold text-[10px]">
                              {assignedCount} {assignedCount === 1 ? 'demanda' : 'demandas'}
                            </span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-slate-500 italic">
                            Nenhuma demanda vinculada
                          </span>
                        )}
                      </td>

                      {/* Modules Count & Badges */}
                      <td className="py-3.5 px-3">
                        {member.role === 'ADM' ? (
                          <span className="text-[11px] text-slate-300">Todos os módulos</span>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap max-w-xs">
                            {member.permissions?.modules?.kanban && <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">Kanban</span>}
                            {member.permissions?.modules?.list && <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">Lista</span>}
                            {member.permissions?.modules?.dashboard && <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">Dash</span>}
                            {member.permissions?.modules?.projects && <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">Projetos</span>}
                            {member.permissions?.modules?.sprints && <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">Sprints</span>}
                            {member.permissions?.modules?.rpa && <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">RPA</span>}
                          </div>
                        )}
                      </td>

                      {/* Actions Permissions Badges */}
                      <td className="py-3.5 px-3">
                        {member.role === 'ADM' ? (
                          <span className="text-[11px] text-slate-300">Controle Total</span>
                        ) : (
                          <div className="flex items-center gap-1 flex-wrap">
                            {member.permissions?.actions?.view && <span className="px-1.5 py-0.2 bg-indigo-950/40 text-indigo-300 rounded text-[9px] border border-indigo-800/40">Ver</span>}
                            {member.permissions?.actions?.create && <span className="px-1.5 py-0.2 bg-emerald-950/40 text-emerald-300 rounded text-[9px] border border-emerald-800/40">Criar</span>}
                            {member.permissions?.actions?.edit && <span className="px-1.5 py-0.2 bg-cyan-950/40 text-cyan-300 rounded text-[9px] border border-cyan-800/40">Editar</span>}
                            {member.permissions?.actions?.export && <span className="px-1.5 py-0.2 bg-amber-950/40 text-amber-300 rounded text-[9px] border border-amber-800/40">Exportar</span>}
                            {member.permissions?.canManageSprints && <span className="px-1.5 py-0.2 bg-violet-950/60 text-violet-300 rounded text-[9px] border border-violet-700/50 font-semibold" title="Permissão delegada para gerenciar e mover sprints em lote">Sprints (Lote)</span>}
                          </div>
                        )}
                      </td>

                      {/* Manage Buttons */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          {!isOwner && (
                            <button
                              type="button"
                              onClick={() => handleOpenLinkUid(member)}
                              className={`px-2 py-1 rounded-lg text-[10px] font-bold border transition-colors cursor-pointer flex items-center gap-1 ${
                                !member.uid 
                                  ? 'bg-amber-950/50 hover:bg-amber-900 border-amber-600/50 text-amber-300' 
                                  : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                              }`}
                              title={member.uid ? `UID: ${member.uid} (Clique para alterar)` : 'Vincular UID informado pelo colaborador'}
                            >
                              <IconShieldCheck className="w-3 h-3" />
                              <span>{member.uid ? 'UID' : 'Vincular UID'}</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openEditModal(member)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition-colors cursor-pointer"
                            title="Editar Permissões e Demandas"
                          >
                            <IconPencil className="w-3.5 h-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => handleCopyInvite(member)}
                            className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white rounded-lg transition-colors cursor-pointer"
                            title="Copiar dados de acesso / convite"
                          >
                            <IconDownload className="w-3.5 h-3.5" />
                          </button>

                          {!isOwner && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleToggleStatus(member)}
                                className={`px-2 py-1 rounded-lg text-[10px] font-bold transition-colors cursor-pointer ${
                                  member.status === 'active'
                                    ? 'bg-amber-950/50 hover:bg-amber-900/60 text-amber-300 border border-amber-700/50'
                                    : 'bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-700/50'
                                }`}
                                title={member.status === 'active' ? 'Desativar Acesso' : 'Ativar Acesso'}
                              >
                                {member.status === 'active' ? 'Pausar' : 'Ativar'}
                              </button>

                              <button
                                type="button"
                                onClick={() => handleDeleteMember(member)}
                                className="p-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 rounded-lg border border-rose-800/40 transition-colors cursor-pointer"
                                title="Remover usuário da workspace"
                              >
                                <IconX className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
      </>
      )}

      {/* TAB 2: RECOVERY REQUESTS QUEUE */}
      {activeTab === 'recovery' && (
        <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex-1 flex flex-col animate-fade-in">
          <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <IconShieldCheck className="w-4 h-4 text-amber-400" />
                <span>Fila de Recuperação Assistida de Acessos</span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                Solicitações feitas na tela de login por usuários que esqueceram credenciais. Confirme a identidade por canal corporativo seguro antes de atender.
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800 shrink-0">
              {recoveryRequests.length} solicitação(ões) no total
            </span>
          </div>

          <div className="overflow-x-auto flex-1 custom-scrollbar">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                  <th className="py-3.5 px-4">E-mail Solicitante</th>
                  <th className="py-3.5 px-3">Nome / Depto</th>
                  <th className="py-3.5 px-3">Data / Hora</th>
                  <th className="py-3.5 px-3">Status</th>
                  <th className="py-3.5 px-4 text-right">Ações do Administrador</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {recoveryRequests.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500">
                      Nenhuma solicitação de recuperação registrada na fila.
                    </td>
                  </tr>
                ) : (
                  recoveryRequests.map(reqItem => (
                    <tr key={reqItem.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-3.5 px-4">
                        <span className="font-mono text-white font-medium">{reqItem.email}</span>
                      </td>
                      <td className="py-3.5 px-3 text-slate-300">
                        <div>
                          <p className="font-medium text-white">{reqItem.name || 'Não informado'}</p>
                          {reqItem.department && (
                            <p className="text-[10px] text-slate-400">{reqItem.department}</p>
                          )}
                        </div>
                      </td>
                      <td className="py-3.5 px-3 text-slate-400 font-mono text-[11px]">
                        {new Date(reqItem.requestedAt).toLocaleString('pt-BR')}
                      </td>
                      <td className="py-3.5 px-3">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                          reqItem.status === 'resolved'
                            ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                            : reqItem.status === 'rejected'
                            ? 'bg-rose-950/60 text-rose-300 border-rose-500/40'
                            : 'bg-amber-950/60 text-amber-300 border-amber-500/40 animate-pulse'
                        }`}>
                          {reqItem.status === 'resolved' ? 'Atendido' : reqItem.status === 'rejected' ? 'Rejeitado' : 'Pendente'}
                        </span>
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => handleGenerateResetLink(reqItem)}
                            className="px-2.5 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-[11px] font-semibold transition-colors cursor-pointer"
                            title="Gerar link oficial com verificação fail-closed"
                          >
                            Gerar Link Oficial
                          </button>
                          {reqItem.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleUpdateRecoveryStatus(reqItem.id, 'resolved')}
                                className="px-2.5 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-300 text-[11px] font-semibold transition-colors cursor-pointer"
                                title="Marcar como atendido"
                              >
                                Concluir
                              </button>
                              <button
                                type="button"
                                onClick={() => handleUpdateRecoveryStatus(reqItem.id, 'rejected')}
                                className="p-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 transition-colors cursor-pointer"
                                title="Rejeitar solicitação"
                              >
                                <IconX className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {isModalOpen && (
        <div className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center z-50 p-3 sm:p-4 animate-fade-in">
          <div className="bg-slate-900 border border-slate-700 rounded-3xl max-w-2xl w-full shadow-2xl shadow-black/70 max-h-[92vh] flex flex-col overflow-hidden">
            {/* Modal Header */}
            <div className="p-4 sm:p-5 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
                  <IconShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-bold text-white">
                    {editingMember ? `Editar Permissões: ${editingMember.name}` : 'Autorizar Acesso de Colaborador'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    Defina o papel, as telas permitidas e as demandas acessíveis pelo colaborador
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <form onSubmit={handleSaveMember} className="p-4 sm:p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1">
              {/* Security notice regarding pre-authorization vs Firebase Auth */}
              <div className="bg-amber-950/40 border border-amber-500/40 p-3.5 rounded-2xl flex items-start gap-3 text-xs text-amber-200">
                <IconShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <p className="font-bold text-amber-300">
                    Importante: Esta ação apenas pré-autoriza o acesso e define as permissões da workspace.
                  </p>
                  <p className="text-[11px] text-amber-200/90 leading-relaxed">
                    Ela <strong>não cria senha nem cria conta no Firebase Auth</strong>. O colaborador deve acessar a tela inicial do Nexus e realizar o seu <strong>"Primeiro Acesso / Ativar Conta"</strong> utilizando este mesmo e-mail para cadastrar sua senha pessoal.
                  </p>
                </div>
              </div>

              {/* Basic Info: Email & Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                    E-mail do Usuário <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    disabled={editingMember?.email.toLowerCase() === OWNER_EMAIL.toLowerCase()}
                    placeholder="ex: colaborador@empresa.com"
                    required
                    className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500 font-mono disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                    Nome Completo
                  </label>
                  <input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    placeholder="ex: Carlos Silva"
                    className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Role & Status */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                    Perfil / Papel
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => handleRoleChange(e.target.value as UserRole)}
                    disabled={formEmail.toLowerCase() === OWNER_EMAIL.toLowerCase()}
                    className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                  >
                    <option value="Colaborador">Colaborador (Visão e ações restritas)</option>
                    <option value="ADM">Administrador (Acesso irrestrito a tudo)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                    Status da Conta
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) => setFormStatus(e.target.value as UserStatus)}
                    disabled={formEmail.toLowerCase() === OWNER_EMAIL.toLowerCase()}
                    className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-500 cursor-pointer disabled:opacity-50"
                  >
                    <option value="active">Ativo (Acesso imediato liberado)</option>
                    <option value="pending">Pendente (Aguardando liberação)</option>
                    <option value="inactive">Inativo (Acesso bloqueado)</option>
                  </select>
                </div>
              </div>

              {/* Module Permissions Matrix */}
              <div className="bg-dark-850/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <IconKanban className="w-3.5 h-3.5 text-indigo-400" />
                    <span>Módulos Liberados</span>
                  </h4>
                  <span className="text-[10px] text-slate-400">
                    {formRole === 'ADM' ? 'Administrador possui acesso a todos' : 'Marque os módulos autorizados'}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                  {[
                    { key: 'dashboard', label: 'Dashboard Geral' },
                    { key: 'projects', label: 'Projetos (Fases)' },
                    { key: 'esteira', label: 'Esteira Documental' },
                    { key: 'sprints', label: 'Sprints CoE' },
                    { key: 'projectReport', label: 'Report Projetos' },
                    { key: 'kanban', label: 'Quadro Kanban' },
                    { key: 'list', label: 'Lista Tabela' },
                    { key: 'gantt', label: 'Cronograma Gantt' },
                    { key: 'robots', label: 'Robôs RPA' },
                    { key: 'totem', label: 'Totem RPA' },
                    { key: 'reports', label: 'Relatórios Consolid.' }
                  ].map(({ key, label }) => {
                    const isChecked = Boolean(formPermissions.modules[key as keyof UserPermissions['modules']]);
                    const isDisabled = formRole === 'ADM';

                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-indigo-950/40 border-indigo-500/40 text-white'
                            : 'bg-dark-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        } ${isDisabled ? 'opacity-80 cursor-default' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isDisabled}
                          onChange={() => handleToggleModule(key as any)}
                          className="rounded text-indigo-600 focus:ring-0 cursor-pointer"
                        />
                        <span className="truncate text-[11px] font-medium">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Action Permissions Matrix */}
              <div className="bg-dark-850/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <IconCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Ações Permitidas</span>
                  </h4>
                  <span className="text-[10px] text-slate-400">
                    Ações privilegiadas (Excluir, Importar, Gerenciar Usuários) são restritas ao ADM
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-1">
                  {[
                    { key: 'view', label: 'Visualizar Demandas' },
                    { key: 'create', label: 'Criar Demandas' },
                    { key: 'edit', label: 'Editar Demandas' },
                    { key: 'comment', label: 'Comentar no Histórico' },
                    { key: 'attach', label: 'Anexar Documentos' },
                    { key: 'export', label: 'Exportar Excel / PPTX' }
                  ].map(({ key, label }) => {
                    const isChecked = Boolean(formPermissions.actions[key as keyof UserPermissions['actions']]);
                    const isDisabled = formRole === 'ADM';

                    return (
                      <label
                        key={key}
                        className={`flex items-center gap-2 p-2 rounded-xl border text-xs cursor-pointer transition-colors ${
                          isChecked
                            ? 'bg-emerald-950/40 border-emerald-500/40 text-white'
                            : 'bg-dark-900 border-slate-800 text-slate-400 hover:text-slate-200'
                        } ${isDisabled ? 'opacity-80 cursor-default' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isDisabled}
                          onChange={() => handleToggleAction(key as any)}
                          className="rounded text-emerald-600 focus:ring-0 cursor-pointer"
                        />
                        <span className="truncate text-[11px] font-medium">{label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Privileged Delegated Permissions (Configured by Administrator) */}
              <div className="bg-dark-850/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                    <IconSprint className="w-3.5 h-3.5 text-violet-400" />
                    <span>Permissões Delegadas Especiais</span>
                  </h4>
                  <span className="text-[10px] text-slate-400">
                    {formRole === 'ADM' ? 'Administrador possui controle total' : 'Configuração delegada pelo ADM'}
                  </span>
                </div>

                <div className="pt-1">
                  <label
                    className={`flex items-start gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-colors ${
                      Boolean(formPermissions.canManageSprints)
                        ? 'bg-violet-950/40 border-violet-500/40 text-white'
                        : 'bg-dark-900 border-slate-800 text-slate-400 hover:text-slate-200'
                    } ${formRole === 'ADM' ? 'opacity-80 cursor-default' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={Boolean(formPermissions.canManageSprints)}
                      disabled={formRole === 'ADM'}
                      onChange={handleToggleCanManageSprints}
                      className="mt-0.5 rounded text-violet-600 focus:ring-0 cursor-pointer"
                    />
                    <div>
                      <p className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                        <span>Gerenciar e Mover Sprints em Massa</span>
                        <span className="text-[10px] bg-violet-500/20 text-violet-300 border border-violet-500/30 px-1.5 py-0.2 rounded font-mono">
                          canManageSprints
                        </span>
                      </p>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Permite selecionar múltiplas demandas na visualização em Lista e alterar a Sprint de destino em lote (requer também permissão de edição e autorização por demanda).
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Specific Demands Assignment Selector (Only for Collaborator) */}
              {formRole === 'Colaborador' && (
                <div className="bg-dark-850/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <IconProject className="w-3.5 h-3.5 text-amber-400" />
                        <span>Demandas Autorizadas Especificamente</span>
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        O colaborador visualizará e editará somente as demandas marcadas abaixo ou atribuídas a ele.
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleSelectAllTasks}
                        className="text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold underline cursor-pointer"
                      >
                        Marcar Todas
                      </button>
                      <span className="text-slate-600">•</span>
                      <button
                        type="button"
                        onClick={handleClearAllTasks}
                        className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                      >
                        Limpar
                      </button>
                    </div>
                  </div>

                  {/* Filter inside demand selector */}
                  <div className="relative">
                    <IconSearch className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={demandSearchFilter}
                      onChange={(e) => setDemandSearchFilter(e.target.value)}
                      placeholder="Pesquisar demanda pelo ID ou resumo..."
                      className="w-full bg-dark-900 border border-slate-700/60 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
                    />
                  </div>

                  {/* Demands list */}
                  <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1.5 pr-1">
                    {filteredTasksForSelection.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">Nenhuma demanda encontrada.</p>
                    ) : (
                      filteredTasksForSelection.map(task => {
                        const isSelected = formAssignedTasks.includes(task.id);
                        return (
                          <div
                            key={task.id}
                            onClick={() => handleToggleTaskAssignment(task.id)}
                            className={`p-2 rounded-xl border text-xs flex items-center justify-between gap-3 cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-indigo-950/50 border-indigo-500/50 text-white'
                                : 'bg-dark-900/60 border-slate-800 text-slate-300 hover:bg-slate-800/50'
                            }`}
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => {}} // Handled by parent div onClick
                                className="rounded text-indigo-600 focus:ring-0 pointer-events-none"
                              />
                              <span className="font-mono font-bold text-[11px] text-indigo-300 shrink-0">
                                {task.id}
                              </span>
                              <span className="truncate text-[11px] font-medium">{task.summary}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-[10px] text-slate-400 font-mono">{task.type}</span>
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300">
                                {task.status}
                              </span>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {/* Modal Actions */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white text-xs font-bold shadow-md shadow-indigo-950/50 transition-all cursor-pointer"
                >
                  {editingMember ? 'Salvar Permissões' : 'Confirmar Autorização de Acesso'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Vincular UID */}
      {linkUidModalMember && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50 p-4 animate-fade-in">
          <div className="bg-slate-900 border border-indigo-500/50 rounded-3xl max-w-md w-full p-6 shadow-2xl text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400">
                  <IconShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Vincular UID de Autenticação</h3>
                  <p className="text-xs text-slate-400 truncate">{linkUidModalMember.name} ({linkUidModalMember.email})</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setLinkUidModalMember(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleConfirmLinkUid} className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Insira o <strong>UID do Firebase</strong> do colaborador (obtido via canal corporativo ou copiado pelo próprio usuário da tela de acesso pendente). A vinculação ativará imediatamente o acesso às demandas e módulos autorizados.
              </p>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                  UID do Firebase <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={linkUidInput}
                  onChange={(e) => setLinkUidInput(e.target.value)}
                  placeholder="ex: pM6ApHmKYfW2nMFRmUFGCtfjCEx1"
                  required
                  className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-indigo-300 placeholder-slate-500 outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setLinkUidModalMember(null)}
                  className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white text-xs font-bold shadow-md shadow-indigo-950/50 transition-all cursor-pointer"
                >
                  Vincular e Ativar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Recovery Link Info Dialog */}
      {recoveryModalInfo && recoveryModalInfo.open && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[110] p-4 animate-fade-in">
          <div className="bg-slate-900 border border-indigo-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl text-left space-y-4 animate-fade-in-dialog">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-indigo-500/20 border border-indigo-500/40 flex items-center justify-center text-indigo-400 shrink-0">
                <IconShieldCheck className="w-5 h-5" />
              </div>
              <h4 className="text-base font-bold text-white">{recoveryModalInfo.title}</h4>
            </div>

            <div className="bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 text-xs text-slate-300 leading-relaxed space-y-2">
              <p>{recoveryModalInfo.message}</p>
              <p className="text-[11px] text-amber-300/90 pt-1 border-t border-slate-800/80">
                🔒 Política de segurança: O administrador jamais deve solicitar ou definir a senha pessoal do colaborador. Instrua o usuário a redefinir por meio do canal corporativo ou do formulário oficial.
              </p>
            </div>

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setRecoveryModalInfo(null)}
                className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold transition-all cursor-pointer"
              >
                Compreendi
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
