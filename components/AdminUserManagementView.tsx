import React, { useState, useMemo, useEffect } from 'react';
import {
  User,
  Task,
  Developer,
  WorkspaceMember,
  AccessRequest,
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
  IconSprint
} from './Icons';

interface AdminUserManagementViewProps {
  currentUser: User;
  tasks: Task[];
  devs?: Developer[];
  onMembersUpdated?: () => void;
}

const generateRandomTempPassword = (): string => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#';
  const length = 12;
  let result = 'Nx!';
  const array = new Uint32Array(length);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(array);
    for (let i = 0; i < length - 3; i++) {
      result += chars[array[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length - 3; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return result;
};

export const AdminUserManagementView: React.FC<AdminUserManagementViewProps> = ({
  currentUser,
  tasks,
  devs = [],
  onMembersUpdated
}) => {
  const [activeTab, setActiveTab] = useState<'members' | 'recovery'>('members');
  const [members, setMembers] = useState<WorkspaceMember[]>(() => StorageService.getMembers());
  const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
  const [recoveryRequests, setRecoveryRequests] = useState<AccountRecoveryRequest[]>(() => StorageService.getRecoveryRequests());
  const [requestsError, setRequestsError] = useState<string | null>(null);
  const [recoveryModalInfo, setRecoveryModalInfo] = useState<{ open: boolean; title: string; message: string } | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | UserStatus>('all');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingMember, setEditingMember] = useState<WorkspaceMember | null>(null);
  const [provisionMode, setProvisionMode] = useState<'create-with-temp-password' | 'link-existing'>('create-with-temp-password');
  const [isSubmittingModal, setIsSubmittingModal] = useState(false);
  const [modalError, setModalError] = useState<{
    message: string;
    existingUid?: string;
    partialFailure?: boolean;
  } | null>(null);
  const [feedbackToast, setFeedbackToast] = useState<{ type: 'success' | 'info' | 'error'; message: string } | null>(null);

  // Link UID Modal state
  const [linkUidModalMember, setLinkUidModalMember] = useState<WorkspaceMember | null>(null);
  const [linkUidInput, setLinkUidInput] = useState('');
  const [isLinkingUid, setIsLinkingUid] = useState(false);

  // Form states inside modal (tempPassword kept ONLY in memory, never saved or logged)
  const [formEmail, setFormEmail] = useState('');
  const [formName, setFormName] = useState('');
  const [formTempPassword, setFormTempPassword] = useState('');
  const [showTempPassword, setShowTempPassword] = useState(true);
  const [tempCredsCopied, setTempCredsCopied] = useState(false);
  const [formSelectedDevId, setFormSelectedDevId] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('Colaborador');
  const [formStatus, setFormStatus] = useState<UserStatus>('active');
  const [formPermissions, setFormPermissions] = useState<UserPermissions>(DEFAULT_COLLABORATOR_PERMISSIONS);
  const [formAssignedTasks, setFormAssignedTasks] = useState<string[]>([]);
  const [demandSearchFilter, setDemandSearchFilter] = useState('');
  const [formLinkedUid, setFormLinkedUid] = useState<string>('');
  const [originatingAccessRequestUid, setOriginatingAccessRequestUid] = useState<string | null>(null);
  const [originatingRecoveryId, setOriginatingRecoveryId] = useState<string | null>(null);

  const triggerToast = (type: 'success' | 'info' | 'error', message: string) => {
    setFeedbackToast({ type, message });
    setTimeout(() => {
      setFeedbackToast(prev => (prev?.message === message ? null : prev));
    }, 5000);
  };

  const reloadMembers = () => {
    const list = StorageService.getMembers();
    setMembers(list);
    if (onMembersUpdated) onMembersUpdated();
  };

  const isOwnerMember = (m?: WorkspaceMember | null) => {
    if (!m) return false;
    return (
      m.uid === NEXUS_OWNER_UID ||
      m.id === NEXUS_OWNER_UID ||
      m.id === 'member_owner_paulo' ||
      (m.email && m.email.toLowerCase() === 'paulo.mmartinio@gmail.com')
    );
  };

  // Subscribe to members, verified accessRequests, and recoveryRequests
  useEffect(() => {
    const unsubMembers = FirebaseService.subscribeMembers(
      NEXUS_OWNER_UID,
      (remoteMembers) => {
        if (remoteMembers) {
          setMembers(remoteMembers.length > 0 ? remoteMembers : StorageService.getMembers());
          if (remoteMembers.length > 0) {
            StorageService.setMembersInMemory(remoteMembers);
          }
        }
      },
      (err) => {
        console.warn('Members subscription error:', err);
      }
    );

    const unsubAccess = FirebaseService.subscribeAccessRequests(
      NEXUS_OWNER_UID,
      (list) => {
        setAccessRequests(list);
        setRequestsError(null);
      },
      (err) => {
        setRequestsError(`Erro ao carregar fila de solicitações autenticadas: ${err?.message || 'permissão ou rede'}`);
      }
    );

    const unsubRecovery = FirebaseService.subscribeRecoveryRequests(
      NEXUS_OWNER_UID,
      (list) => {
        setRecoveryRequests(prev => {
          const map = new Map<string, AccountRecoveryRequest>();
          prev.forEach(item => map.set(item.id, item));
          list.forEach(item => map.set(item.id, item));
          const merged = Array.from(map.values()).sort(
            (a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime()
          );
          StorageService.setRecoveryRequestsInMemory(merged);
          return merged;
        });
      },
      (err) => {
        console.warn('Recovery subscription notice:', err);
      }
    );

    // Also pull server-side recovery queue created via /api/recovery/request
    (async () => {
      try {
        const token = await FirebaseService.getIdToken();
        if (!token) return;
        const res = await fetch('/api/recovery/requests', {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!res.ok) return;
        const data = await res.json().catch(() => null);
        if (data?.requests && Array.isArray(data.requests)) {
          setRecoveryRequests(prev => {
            const map = new Map<string, AccountRecoveryRequest>();
            prev.forEach(item => map.set(item.id, item));
            data.requests.forEach((item: AccountRecoveryRequest) => map.set(item.id, item));
            const merged = Array.from(map.values()).sort(
              (a, b) => new Date(b.requestedAt || 0).getTime() - new Date(a.requestedAt || 0).getTime()
            );
            StorageService.setRecoveryRequestsInMemory(merged);
            return merged;
          });
        }
      } catch (e) {
        console.warn('Could not fetch server recovery requests:', e);
      }
    })();

    return () => {
      unsubMembers();
      unsubAccess();
      unsubRecovery();
    };
  }, []);

  const getTasksMatchingDevName = (devName: string): string[] => {
    const clean = devName.trim().toLowerCase();
    if (!clean) return [];
    return tasks
      .filter(t => t.assignee && t.assignee.trim().toLowerCase() === clean)
      .map(t => t.id);
  };

  const handleSelectDevInModal = (devId: string, autoSelectTasks: boolean = true) => {
    setFormSelectedDevId(devId);
    const dev = devs.find(d => d.id === devId);
    if (!dev) return;

    if (!formName.trim() || devs.some(d => d.name.toLowerCase() === formName.trim().toLowerCase())) {
      setFormName(dev.name);
    }
    if (!formEmail.trim() && dev.email) {
      setFormEmail(dev.email);
    }
    if (dev.linkedUid && !formLinkedUid) {
      setFormLinkedUid(dev.linkedUid);
    }
    if (autoSelectTasks) {
      const matchingIds = getTasksMatchingDevName(dev.name);
      if (matchingIds.length > 0) {
        setFormAssignedTasks(prev => Array.from(new Set([...prev, ...matchingIds])));
      }
    }
  };

  const openCreateModal = (preselectedDev?: Developer) => {
    setEditingMember(null);
    setProvisionMode('create-with-temp-password');
    setModalError(null);
    setTempCredsCopied(false);
    setFormEmail(preselectedDev?.email || '');
    setFormName(preselectedDev?.name || '');
    setFormTempPassword(generateRandomTempPassword());
    setShowTempPassword(true);
    setFormSelectedDevId(preselectedDev?.id || '');
    setFormRole('Colaborador');
    setFormStatus('active');
    setFormPermissions(JSON.parse(JSON.stringify(DEFAULT_COLLABORATOR_PERMISSIONS)));
    setFormAssignedTasks(preselectedDev ? getTasksMatchingDevName(preselectedDev.name) : []);
    setDemandSearchFilter('');
    setFormLinkedUid(preselectedDev?.linkedUid || '');
    setOriginatingAccessRequestUid(null);
    setOriginatingRecoveryId(null);
    setIsModalOpen(true);
  };

  const openEditModal = (member: WorkspaceMember) => {
    setEditingMember(member);
    setProvisionMode('link-existing');
    setModalError(null);
    setTempCredsCopied(false);
    setFormEmail(member.email);
    setFormName(member.name);
    setFormTempPassword('');
    setShowTempPassword(false);
    setFormSelectedDevId(member.linkedDevId || '');
    setFormRole(member.role);
    setFormStatus(member.status);
    setFormPermissions(
      JSON.parse(
        JSON.stringify(
          member.permissions ||
            (member.role === 'ADM' ? DEFAULT_ADM_PERMISSIONS : DEFAULT_COLLABORATOR_PERMISSIONS)
        )
      )
    );
    setFormAssignedTasks(member.assignedTaskIds || []);
    setDemandSearchFilter('');
    setFormLinkedUid(member.uid || '');
    setOriginatingAccessRequestUid(null);
    setOriginatingRecoveryId(null);
    setIsModalOpen(true);
  };

  const handleAuthorizeFromAccessRequest = (reqItem: AccessRequest) => {
    const existing = members.find(
      m => m.uid === reqItem.uid || m.email.toLowerCase() === reqItem.email.toLowerCase()
    );
    const matchingDev = devs.find(
      d =>
        d.linkedUid === reqItem.uid ||
        (reqItem.devNameHint && d.name.trim().toLowerCase() === reqItem.devNameHint.trim().toLowerCase()) ||
        (reqItem.name && d.name.trim().toLowerCase() === reqItem.name.trim().toLowerCase())
    );

    setModalError(null);
    setTempCredsCopied(false);
    setFormTempPassword('');

    if (existing) {
      setEditingMember(existing);
      setProvisionMode('link-existing');
      setFormEmail(existing.email);
      setFormName(existing.name || reqItem.name || '');
      setFormRole(existing.role);
      setFormStatus('active');
      setFormPermissions(
        JSON.parse(JSON.stringify(existing.permissions || DEFAULT_COLLABORATOR_PERMISSIONS))
      );
      setFormAssignedTasks(existing.assignedTaskIds || []);
      setFormLinkedUid(reqItem.uid);
      setFormSelectedDevId(existing.linkedDevId || matchingDev?.id || '');
    } else {
      setEditingMember(null);
      // Since AccessRequest comes from an already-authenticated Firebase Auth UID, default to link-existing!
      setProvisionMode('link-existing');
      setFormEmail(reqItem.email);
      setFormName(reqItem.name || matchingDev?.name || reqItem.email.split('@')[0]);
      setFormRole('Colaborador');
      setFormStatus('active');
      setFormPermissions(JSON.parse(JSON.stringify(DEFAULT_COLLABORATOR_PERMISSIONS)));
      setFormSelectedDevId(matchingDev?.id || '');
      setFormAssignedTasks(matchingDev ? getTasksMatchingDevName(matchingDev.name) : []);
      setFormLinkedUid(reqItem.uid);
    }

    setOriginatingAccessRequestUid(reqItem.uid);
    setOriginatingRecoveryId(null);
    setDemandSearchFilter('');
    setIsModalOpen(true);
  };

  const handleAuthorizeFromRecovery = (reqItem: AccountRecoveryRequest) => {
    const existing = members.find(m => m.email.toLowerCase() === reqItem.email.toLowerCase());
    let extractedUid = '';
    const match =
      (reqItem.department || '').match(/UID:\s*([a-zA-Z0-9_-]+)/i) ||
      (reqItem.reason || '').match(/UID:\s*([a-zA-Z0-9_-]+)/i);
    if (match && match[1]) {
      extractedUid = match[1].trim();
    }

    setModalError(null);
    setTempCredsCopied(false);

    if (existing) {
      setEditingMember(existing);
      setProvisionMode('link-existing');
      setFormEmail(existing.email);
      setFormName(existing.name || reqItem.name || '');
      setFormRole(existing.role);
      setFormStatus('active');
      setFormPermissions(
        JSON.parse(JSON.stringify(existing.permissions || DEFAULT_COLLABORATOR_PERMISSIONS))
      );
      setFormAssignedTasks(existing.assignedTaskIds || []);
      setFormLinkedUid(existing.uid || extractedUid);
      setFormSelectedDevId(existing.linkedDevId || '');
      setFormTempPassword('');
    } else {
      setEditingMember(null);
      setProvisionMode(extractedUid ? 'link-existing' : 'create-with-temp-password');
      setFormEmail(reqItem.email);
      setFormName(reqItem.name || reqItem.email.split('@')[0]);
      setFormTempPassword(extractedUid ? '' : generateRandomTempPassword());
      setShowTempPassword(true);
      setFormRole('Colaborador');
      setFormStatus('active');
      setFormPermissions(JSON.parse(JSON.stringify(DEFAULT_COLLABORATOR_PERMISSIONS)));
      setFormAssignedTasks([]);
      setFormLinkedUid(extractedUid);
      setFormSelectedDevId('');
    }
    setOriginatingRecoveryId(reqItem.id);
    setOriginatingAccessRequestUid(null);
    setDemandSearchFilter('');
    setIsModalOpen(true);
  };

  const handleCopyTempCredentials = () => {
    const appBaseUrl =
      window.location.hostname === 'localhost' || window.location.hostname.includes('webcontainer')
        ? 'https://gestor-de-lobby.vercel.app'
        : window.location.origin;

    const msg = `Olá ${formName || 'Colaborador'}!\n\nSeu acesso ao Nexus Workspace foi criado pelo Administrador.\n\n• URL: ${appBaseUrl}\n• E-mail: ${formEmail.trim().toLowerCase()}\n• Senha temporária (uso único): ${formTempPassword}\n\nIMPORTANTE: Ao entrar pela primeira vez, você será solicitado(a) a substituir a senha temporária por uma senha pessoal exclusiva do Nexus antes de visualizar suas demandas.`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(msg);
      setTempCredsCopied(true);
      setTimeout(() => setTempCredsCopied(false), 3000);
    }
  };

  const handleOpenLinkUid = (member: WorkspaceMember) => {
    setLinkUidModalMember(member);
    setLinkUidInput(member.uid || '');
  };

  const handleConfirmLinkUid = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!linkUidModalMember) return;
    const cleanUid = linkUidInput.trim();
    if (!cleanUid) {
      triggerToast('error', 'Por favor, informe o UID do usuário.');
      return;
    }

    setIsLinkingUid(true);
    try {
      const updated = await StorageService.linkMemberUidAsync(linkUidModalMember.id, cleanUid, true);
      reloadMembers();
      setLinkUidModalMember(null);
      setLinkUidInput('');
      triggerToast('success', `UID vinculado com sucesso! Colaborador ${updated.name} está ativado.`);
    } catch (err: any) {
      triggerToast('error', err?.message || 'Falha ao vincular UID no Firestore.');
    } finally {
      setIsLinkingUid(false);
    }
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
    setFormAssignedTasks(prev =>
      prev.includes(taskId) ? prev.filter(id => id !== taskId) : [...prev, taskId]
    );
  };

  const handleSelectAllTasks = () => {
    setFormAssignedTasks(tasks.map(t => t.id));
  };

  const handleClearAllTasks = () => {
    setFormAssignedTasks([]);
  };

  const closeAndScrubModal = () => {
    setFormTempPassword('');
    setTempCredsCopied(false);
    setModalError(null);
    setIsModalOpen(false);
  };

  const handleSaveMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    const cleanEmail = formEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      setModalError({ message: 'Por favor, informe um e-mail corporativo válido.' });
      return;
    }

    const cleanName = formName.trim() || cleanEmail.split('@')[0];
    const isOwner =
      isOwnerMember(editingMember) ||
      cleanEmail === 'paulo.mmartinio@gmail.com' ||
      editingMember?.uid === NEXUS_OWNER_UID;

    if (!isOwner && formRole === 'ADM' && currentUser.id !== NEXUS_OWNER_UID) {
      setModalError({
        message: 'Apenas o proprietário raiz do workspace pode promover usuários ao perfil ADM.'
      });
      return;
    }

    const selectedDev = devs.find(d => d.id === formSelectedDevId);
    const resolvedUid = formLinkedUid.trim() || editingMember?.uid || '';

    // Validate password requirement ONLY when creating a new login on server
    if (!editingMember && provisionMode === 'create-with-temp-password') {
      if (!formTempPassword || formTempPassword.length < 6) {
        setModalError({
          message: 'Informe uma senha temporária com pelo menos 6 caracteres.'
        });
        return;
      }
    }

    // When editing owner directly, save permissions/profile safely without Auth creation
    if (isOwner) {
      setIsSubmittingModal(true);
      try {
        const ownerDoc: WorkspaceMember = {
          id: NEXUS_OWNER_UID,
          uid: NEXUS_OWNER_UID,
          email: cleanEmail,
          name: cleanName,
          role: 'ADM',
          status: 'active',
          permissions: DEFAULT_ADM_PERMISSIONS,
          assignedTaskIds: [],
          workspaceOwnerUid: NEXUS_OWNER_UID,
          invitedAt: editingMember?.invitedAt || new Date().toISOString(),
          activatedAt: editingMember?.activatedAt || new Date().toISOString(),
          invitedBy: currentUser.email
        };
        await StorageService.saveMemberAsync(ownerDoc, NEXUS_OWNER_UID);
        reloadMembers();
        closeAndScrubModal();
        triggerToast('success', 'Dados do proprietário atualizados com sucesso!');
      } catch (err: any) {
        setModalError({ message: err?.message || 'Erro ao atualizar dados do proprietário.' });
      } finally {
        setIsSubmittingModal(false);
      }
      return;
    }

    setIsSubmittingModal(true);
    const tempPasswordInFlight = formTempPassword;

    try {
      const idToken = await FirebaseService.getIdToken(true);
      const effectiveMode = editingMember ? 'link-existing' : provisionMode;

      if (effectiveMode === 'create-with-temp-password' || resolvedUid || !editingMember) {
        if (!idToken) {
          throw new Error('Sessão Firebase inválida para chamar o provisionamento no servidor. Faça login novamente.');
        }

        const payload = {
          mode: effectiveMode,
          email: cleanEmail,
          tempPassword: effectiveMode === 'create-with-temp-password' ? tempPasswordInFlight : undefined,
          name: cleanName,
          role: formRole,
          status: formStatus,
          linkedDevId: selectedDev?.id || editingMember?.linkedDevId,
          linkedDevName: selectedDev?.name || editingMember?.linkedDevName,
          existingUid: resolvedUid || undefined,
          previousMemberId: editingMember?.id,
          permissions: formPermissions,
          assignedTaskIds: formRole === 'ADM' ? [] : formAssignedTasks,
          workspaceOwnerUid: NEXUS_OWNER_UID
        };

        // Immediately clear password from React input state
        setFormTempPassword('');

        const res = await fetch('/api/admin/provision-dev', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`
          },
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          // If editing existing unlinked member (or updating an existing UID member) and Admin SDK is not configured locally,
          // allow fallback ONLY for link-existing edits, NEVER for create-with-temp-password!
          if (
            editingMember &&
            effectiveMode === 'link-existing' &&
            data?.code === 'ADMIN_SDK_UNAVAILABLE'
          ) {
            const previousTaskIds = editingMember.assignedTaskIds || [];
            const fallbackMember: WorkspaceMember = {
              ...editingMember,
              id: resolvedUid || editingMember.id,
              uid: resolvedUid || editingMember.uid,
              email: cleanEmail,
              name: cleanName,
              role: formRole,
              status: formStatus,
              permissions: formPermissions,
              assignedTaskIds: formRole === 'ADM' ? [] : formAssignedTasks,
              linkedDevId: selectedDev?.id || editingMember.linkedDevId,
              linkedDevName: selectedDev?.name || editingMember.linkedDevName,
              workspaceOwnerUid: NEXUS_OWNER_UID,
              activatedAt:
                formStatus === 'active'
                  ? editingMember.activatedAt || new Date().toISOString()
                  : editingMember.activatedAt
            };
            const saved = await StorageService.saveMemberAsync(fallbackMember, NEXUS_OWNER_UID);
            if (saved.uid) {
              await FirebaseService.syncMemberTaskAuthorization(
                NEXUS_OWNER_UID,
                saved.uid,
                saved.assignedTaskIds,
                previousTaskIds
              );
            }
            reloadMembers();
            closeAndScrubModal();
            triggerToast('success', `Permissões e demandas de ${cleanName} atualizadas!`);
            return;
          }

          if (data?.member) {
            // Partial failure where member doc WAS written before task sync failed
            const updatedMem = data.member as WorkspaceMember;
            const existing = StorageService.getMembers().filter(
              m => m.id !== updatedMem.id && m.uid !== updatedMem.uid && m.id !== editingMember?.id
            );
            StorageService.setMembersInMemory([...existing, updatedMem]);
            reloadMembers();
          }

          setModalError({
            message: data?.message || 'Não foi possível provisionar o desenvolvedor no servidor.',
            existingUid: data?.existingUid || data?.createdUid,
            partialFailure: Boolean(data?.partialFailure)
          });
          return;
        }

        // Server succeeded cleanly!
        const provisionedMember = data.member as WorkspaceMember;
        const currentList = StorageService.getMembers().filter(
          m =>
            m.id !== provisionedMember.id &&
            m.uid !== provisionedMember.uid &&
            m.id !== editingMember?.id &&
            m.email.trim().toLowerCase() !== cleanEmail
        );
        StorageService.setMembersInMemory([...currentList, provisionedMember]);
        reloadMembers();

        if (originatingAccessRequestUid) {
          await FirebaseService.updateAccessRequestStatus(
            NEXUS_OWNER_UID,
            originatingAccessRequestUid,
            'resolved',
            currentUser.id
          ).catch(() => {});
          setOriginatingAccessRequestUid(null);
        }

        if (originatingRecoveryId) {
          await handleUpdateRecoveryStatus(originatingRecoveryId, 'resolved');
          setOriginatingRecoveryId(null);
        }

        closeAndScrubModal();
        const extraNote = data.warning ? ` (${data.warning})` : '';
        triggerToast(
          'success',
          effectiveMode === 'create-with-temp-password'
            ? `Login criado com senha temporária para ${cleanName} (UID: ${provisionedMember.uid}). Troca obrigatória exigida no primeiro acesso.${extraNote}`
            : `Conta de ${cleanName} vinculada e ${data.addedTasksCount || 0} demanda(s) sincronizada(s)!${extraNote}`
        );
      }
    } catch (err: any) {
      setFormTempPassword('');
      setModalError({
        message: err?.message || 'Erro inesperado ao salvar provisionamento.'
      });
    } finally {
      setIsSubmittingModal(false);
    }
  };

  const handleToggleStatus = async (member: WorkspaceMember) => {
    if (isOwnerMember(member)) {
      triggerToast('error', 'O proprietário da workspace principal não pode ser desativado.');
      return;
    }
    const newStatus: UserStatus = member.status === 'active' ? 'inactive' : 'active';
    const updated: WorkspaceMember = {
      ...member,
      status: newStatus,
      activatedAt: newStatus === 'active' ? member.activatedAt || new Date().toISOString() : member.activatedAt
    };
    try {
      await StorageService.saveMemberAsync(updated, NEXUS_OWNER_UID);
      reloadMembers();
      triggerToast(
        'info',
        `Status de ${member.name} alterado para ${newStatus === 'active' ? 'Ativo' : 'Inativo'}.`
      );
    } catch (err: any) {
      triggerToast('error', err?.message || 'Falha ao atualizar status do colaborador no Firestore.');
    }
  };

  const handleDeleteMember = async (member: WorkspaceMember) => {
    if (isOwnerMember(member)) {
      triggerToast('error', 'O proprietário da workspace principal não pode ser removido.');
      return;
    }
    if (
      window.confirm(
        `Tem certeza que deseja remover o usuário ${member.name} (${member.email}) da workspace?`
      )
    ) {
      try {
        if (member.uid && member.assignedTaskIds?.length) {
          await FirebaseService.syncMemberTaskAuthorization(
            NEXUS_OWNER_UID,
            member.uid,
            [],
            member.assignedTaskIds
          ).catch(() => {});
        }
        await StorageService.deleteMemberAsync(member.id, NEXUS_OWNER_UID);
        reloadMembers();
        triggerToast('success', `Usuário ${member.name} removido com sucesso.`);
      } catch (err: any) {
        triggerToast('error', err?.message || 'Falha ao remover usuário do Firestore.');
      }
    }
  };

  const handleGenerateResetLink = async (reqItem: AccountRecoveryRequest) => {
    if (reqItem.email.toLowerCase() === 'paulo.mmartinio@gmail.com') {
      triggerToast('error', 'A conta do proprietário do workspace não pode ser redefinida via este canal.');
      return;
    }

    try {
      const token = await FirebaseService.getIdToken();
      const res = await fetch('/api/admin/generate-password-reset-link', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          targetEmail: reqItem.email
        })
      });

      const data = await res.json().catch(() => ({}));
      setRecoveryModalInfo({
        open: true,
        title: 'Recuperação Assistida (Fail-Closed)',
        message:
          data.message ||
          'Geração delegada indisponível no momento. O administrador deve orientar o usuário pelo canal corporativo oficial.'
      });
    } catch {
      setRecoveryModalInfo({
        open: true,
        title: 'Recuperação Assistida',
        message:
          'Serviço de geração individual offline no servidor. Oriente o usuário a utilizar o canal corporativo oficial.'
      });
    }
  };

  const handleUpdateAccessRequestStatus = async (
    requestUid: string,
    newStatus: 'resolved' | 'rejected'
  ) => {
    try {
      await FirebaseService.updateAccessRequestStatus(
        NEXUS_OWNER_UID,
        requestUid,
        newStatus,
        currentUser.id
      );
      setAccessRequests(prev =>
        prev.map(r => (r.uid === requestUid ? { ...r, status: newStatus } : r))
      );
      triggerToast(
        'success',
        `Solicitação marcada como ${newStatus === 'resolved' ? 'Atendida' : 'Rejeitada'}.`
      );
    } catch (err: any) {
      triggerToast('error', err?.message || 'Erro ao atualizar status da solicitação de acesso.');
    }
  };

  const handleUpdateRecoveryStatus = async (id: string, newStatus: 'resolved' | 'rejected') => {
    StorageService.updateRecoveryRequestStatus(id, newStatus, currentUser.id);
    setRecoveryRequests(prev =>
      prev.map(r => (r.id === id ? { ...r, status: newStatus, resolvedAt: new Date().toISOString() } : r))
    );
    try {
      const token = await FirebaseService.getIdToken();
      if (token) {
        await fetch('/api/recovery/status', {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ id, status: newStatus })
        });
      }
    } catch {}
    triggerToast(
      'success',
      `Solicitação marcada como ${newStatus === 'resolved' ? 'Atendida' : 'Rejeitada'}.`
    );
  };

  const handleCopyInvite = (member: WorkspaceMember) => {
    const appBaseUrl =
      window.location.hostname === 'localhost' || window.location.hostname.includes('webcontainer')
        ? 'https://gestor-de-lobby.vercel.app'
        : window.location.origin;

    const inviteText = member.mustChangePassword
      ? `Olá ${member.name}!\n\nSeu login no Nexus foi criado pelo Administrador com senha temporária.\n\n• URL: ${appBaseUrl}\n• E-mail: ${member.email}\n• Perfil: ${member.role}\n\nSolicite sua senha temporária ao Administrador pelo canal corporativo oficial e defina sua senha pessoal no primeiro login.`
      : `Olá ${member.name}!\n\nSeu acesso ao Nexus Workspace está configurado.\n\n• URL: ${appBaseUrl}\n• E-mail: ${member.email}\n• Perfil: ${member.role}`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(inviteText);
      triggerToast('success', `Instruções de acesso de ${member.name} copiadas (sem senhas).`);
    }
  };

  // Devs vs Members cross-reference
  const unprovisionedDevs = useMemo(() => {
    return devs.filter(dev => {
      const cleanName = dev.name.trim().toLowerCase();
      return !members.some(
        m =>
          m.linkedDevId === dev.id ||
          (m.linkedDevName && m.linkedDevName.trim().toLowerCase() === cleanName) ||
          (m.name && m.name.trim().toLowerCase() === cleanName) ||
          (dev.linkedUid && m.uid === dev.linkedUid)
      );
    });
  }, [devs, members]);

  const filteredMembers = useMemo(() => {
    return members.filter(m => {
      const matchSearch =
        (m.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.email || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (m.linkedDevName || '').toLowerCase().includes(searchTerm.toLowerCase());
      const matchStatus = statusFilter === 'all' || m.status === statusFilter;
      const matchRole = roleFilter === 'all' || m.role === roleFilter;
      return matchSearch && matchStatus && matchRole;
    });
  }, [members, searchTerm, statusFilter, roleFilter]);

  const filteredTasksForSelection = useMemo(() => {
    if (!demandSearchFilter.trim()) return tasks;
    const q = demandSearchFilter.trim().toLowerCase();
    return tasks.filter(
      t =>
        t.id.toLowerCase().includes(q) ||
        t.summary.toLowerCase().includes(q) ||
        (t.assignee && t.assignee.toLowerCase().includes(q))
    );
  }, [tasks, demandSearchFilter]);

  const selectedDevObj = useMemo(
    () => devs.find(d => d.id === formSelectedDevId) || null,
    [devs, formSelectedDevId]
  );

  const matchingDevTasksCount = useMemo(
    () => (selectedDevObj ? getTasksMatchingDevName(selectedDevObj.name).length : 0),
    [selectedDevObj, tasks]
  );

  const pendingAccessCount = accessRequests.filter(r => r.status === 'pending').length;
  const pendingRecoveryCount = recoveryRequests.filter(r => r.status === 'pending').length;
  const totalPendingRequests = pendingAccessCount + pendingRecoveryCount;

  const totalCount = members.length;
  const adminCount = members.filter(m => m.role === 'ADM').length;
  const activeCount = members.filter(m => m.status === 'active' && m.role === 'Colaborador').length;
  const pendingCount = members.filter(m => m.status === 'pending').length;

  return (
    <div className="h-full flex flex-col space-y-5 animate-fade-in pr-1">
      {/* Toast */}
      {feedbackToast && (
        <div
          className={`fixed top-5 right-5 z-[100] max-w-md px-4 py-3 rounded-2xl shadow-2xl border text-xs font-semibold flex items-center gap-2.5 animate-fade-in ${
            feedbackToast.type === 'success'
              ? 'bg-emerald-950/95 border-emerald-500 text-emerald-300'
              : feedbackToast.type === 'error'
              ? 'bg-rose-950/95 border-rose-500 text-rose-300'
              : 'bg-indigo-950/95 border-indigo-500 text-indigo-300'
          }`}
        >
          {feedbackToast.type === 'success' ? (
            <IconCheck className="w-4 h-4 text-emerald-400 shrink-0" />
          ) : (
            <IconShieldCheck className="w-4 h-4 shrink-0" />
          )}
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
                Provisionamento ADM no Servidor
              </span>
            </div>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Crie logins com senha temporária vinculados ao Dev correspondente ou associe contas existentes, liberando somente módulos e demandas autorizadas.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => openCreateModal()}
          className="h-10 px-4 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-indigo-950/50 transition-all active:scale-95 cursor-pointer shrink-0"
        >
          <IconPlus className="w-4 h-4 stroke-[2.5]" />
          <span>Provisionar Dev / Acesso</span>
        </button>
      </div>

      {/* Architectural Clarification Card: Devs Catalog vs RBAC Members */}
      <div className="bg-slate-900/90 border border-indigo-500/30 rounded-2xl p-4 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-indigo-300 flex items-center gap-2">
              <IconUsers className="w-4 h-4 text-indigo-400" />
              <span>
                Catálogo de Devs ({devs.length}) vs Membros com Login Autorizado ({members.length})
              </span>
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Estar na lista de <strong>Devs</strong> do dashboard serve apenas para atribuição de demandas e <strong>nunca libera acesso automático</strong>. Provisione abaixo para criar o login (e-mail + senha temporária) ou vincular um UID existente.
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-xl text-[11px] font-mono bg-slate-950 border border-slate-800 text-slate-300 shrink-0">
            {unprovisionedDevs.length} Dev(s) sem login vinculado
          </span>
        </div>

        {unprovisionedDevs.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-800/80">
            {unprovisionedDevs.map(dev => (
              <button
                key={dev.id}
                type="button"
                onClick={() => openCreateModal(dev)}
                className="px-3 py-1.5 rounded-xl bg-indigo-950/60 hover:bg-indigo-900/70 border border-indigo-500/40 text-xs text-indigo-200 flex items-center gap-2 transition-colors cursor-pointer"
                title={`Criar login e vincular demandas do Dev ${dev.name}`}
              >
                <IconPlus className="w-3.5 h-3.5 text-emerald-400" />
                <span className="font-semibold">{dev.name}</span>
                <span className="text-[10px] text-slate-400 font-mono">
                  ({getTasksMatchingDevName(dev.name).length} demandas)
                </span>
              </button>
            ))}
          </div>
        )}
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
          <span>Solicitações de Acesso & Suporte</span>
          {totalPendingRequests > 0 ? (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/40 font-mono font-bold animate-pulse">
              {totalPendingRequests} pendente(s)
            </span>
          ) : (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-700 font-mono text-slate-400">
              {accessRequests.length + recoveryRequests.length}
            </span>
          )}
        </button>
      </div>

      {/* TAB 1: MEMBERS MANAGEMENT */}
      {activeTab === 'members' && (
        <>
          {/* Pending Access Requests Alert Banner */}
          {totalPendingRequests > 0 && (
            <div className="bg-amber-950/40 border border-amber-500/40 p-4 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-amber-200 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-400 shrink-0 animate-pulse">
                  <IconShieldCheck className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-xs text-amber-300 flex items-center gap-2">
                    <span>Solicitação(ões) de acesso ou recuperação aguardando análise!</span>
                    <span className="px-2 py-0.5 rounded bg-amber-500/30 text-amber-200 text-[10px] font-mono">
                      {totalPendingRequests} pendente(s)
                    </span>
                  </p>
                  <p className="text-[11px] text-amber-200/80 mt-0.5">
                    Você pode vincular solicitações autenticadas sem redefinir senhas ou provisionar um novo login diretamente pelo botão acima.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('recovery')}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs shrink-0 transition-colors cursor-pointer shadow-md flex items-center gap-1.5"
              >
                <span>Ver Solicitações</span>
                <span>&rarr;</span>
              </button>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm">
              <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <IconUsers className="w-3.5 h-3.5 text-slate-400" />
                <span>Total Membros</span>
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
                placeholder="Buscar por nome, Dev ou e-mail..."
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
                  onClick={() => {
                    setSearchTerm('');
                    setStatusFilter('all');
                    setRoleFilter('all');
                  }}
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
                    <th className="py-3.5 px-4">Usuário / Dev Vinculado</th>
                    <th className="py-3.5 px-3">Perfil</th>
                    <th className="py-3.5 px-3">Status / Segurança</th>
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
                                  {!isOwner &&
                                    (member.uid ? (
                                      <span
                                        className="text-[9px] bg-slate-800 text-slate-400 font-mono px-1.5 py-0.2 rounded border border-slate-700/60"
                                        title={`UID: ${member.uid}`}
                                      >
                                        UID OK
                                      </span>
                                    ) : (
                                      <span className="text-[9px] bg-amber-500/20 text-amber-300 border border-amber-500/40 px-1.5 py-0.2 rounded font-mono">
                                        UID pendente
                                      </span>
                                    ))}
                                </div>
                                <p className="text-[11px] text-slate-400 font-mono truncate">{member.email}</p>
                                {member.linkedDevName && (
                                  <p className="text-[10px] text-emerald-400/90 truncate">
                                    Dev: {member.linkedDevName}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Role Badge */}
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                member.role === 'ADM'
                                  ? 'bg-indigo-950/60 text-indigo-300 border-indigo-500/40'
                                  : 'bg-slate-800 text-slate-300 border-slate-700'
                              }`}
                            >
                              {member.role === 'ADM' ? 'Administrador' : 'Colaborador'}
                            </span>
                          </td>

                          {/* Status Badge */}
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <div className="flex flex-col items-start gap-1">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                                  member.status === 'active'
                                    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                                    : member.status === 'pending'
                                    ? 'bg-amber-950/60 text-amber-300 border-amber-500/40'
                                    : 'bg-rose-950/60 text-rose-300 border-rose-500/40'
                                }`}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${
                                    member.status === 'active'
                                      ? 'bg-emerald-400'
                                      : member.status === 'pending'
                                      ? 'bg-amber-400 animate-pulse'
                                      : 'bg-rose-400'
                                  }`}
                                />
                                <span>
                                  {member.status === 'active'
                                    ? 'Ativo'
                                    : member.status === 'pending'
                                    ? 'Pendente'
                                    : 'Inativo'}
                                </span>
                              </span>
                              {member.mustChangePassword && (
                                <span className="px-2 py-0.5 rounded text-[9px] font-bold bg-amber-950/70 text-amber-300 border border-amber-500/40">
                                  Troca de senha pendente
                                </span>
                              )}
                            </div>
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

                          {/* Modules Badges */}
                          <td className="py-3.5 px-3">
                            {member.role === 'ADM' ? (
                              <span className="text-[11px] text-slate-300">Todos os módulos</span>
                            ) : (
                              <div className="flex items-center gap-1 flex-wrap max-w-xs">
                                {member.permissions?.modules?.kanban && (
                                  <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">
                                    Kanban
                                  </span>
                                )}
                                {member.permissions?.modules?.list && (
                                  <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">
                                    Lista
                                  </span>
                                )}
                                {member.permissions?.modules?.dashboard && (
                                  <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">
                                    Dash
                                  </span>
                                )}
                                {member.permissions?.modules?.projects && (
                                  <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">
                                    Projetos
                                  </span>
                                )}
                                {member.permissions?.modules?.sprints && (
                                  <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">
                                    Sprints
                                  </span>
                                )}
                                {member.permissions?.modules?.robots && (
                                  <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">
                                    Robôs
                                  </span>
                                )}
                                {member.permissions?.modules?.totem && (
                                  <span className="px-1.5 py-0.2 bg-slate-800 rounded text-[9px] text-slate-300">
                                    Totem
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* Actions Permissions Badges */}
                          <td className="py-3.5 px-3">
                            {member.role === 'ADM' ? (
                              <span className="text-[11px] text-slate-300">Controle Total</span>
                            ) : (
                              <div className="flex items-center gap-1 flex-wrap">
                                {member.permissions?.actions?.view && (
                                  <span className="px-1.5 py-0.2 bg-indigo-950/40 text-indigo-300 rounded text-[9px] border border-indigo-800/40">
                                    Ver
                                  </span>
                                )}
                                {member.permissions?.actions?.create && (
                                  <span className="px-1.5 py-0.2 bg-emerald-950/40 text-emerald-300 rounded text-[9px] border border-emerald-800/40">
                                    Criar
                                  </span>
                                )}
                                {member.permissions?.actions?.edit && (
                                  <span className="px-1.5 py-0.2 bg-cyan-950/40 text-cyan-300 rounded text-[9px] border border-cyan-800/40">
                                    Editar
                                  </span>
                                )}
                                {member.permissions?.actions?.export && (
                                  <span className="px-1.5 py-0.2 bg-amber-950/40 text-amber-300 rounded text-[9px] border border-amber-800/40">
                                    Exportar
                                  </span>
                                )}
                                {member.permissions?.canManageSprints && (
                                  <span
                                    className="px-1.5 py-0.2 bg-violet-950/60 text-violet-300 rounded text-[9px] border border-violet-700/50 font-semibold"
                                    title="Permissão delegada para gerenciar e mover sprints em lote"
                                  >
                                    Sprints (Lote)
                                  </span>
                                )}
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
                                  title={
                                    member.uid
                                      ? `UID: ${member.uid} (Clique para alterar)`
                                      : 'Vincular UID informado pelo colaborador'
                                  }
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
                                title="Copiar orientações de acesso"
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

      {/* TAB 2: AUTHENTICATED ACCESS REQUESTS & PASSWORD HELP QUEUE */}
      {activeTab === 'recovery' && (
        <div className="space-y-4 flex-1 flex flex-col animate-fade-in">
          {requestsError && (
            <div className="p-3.5 rounded-2xl bg-rose-950/60 border border-rose-500/50 text-xs text-rose-200">
              {requestsError}
            </div>
          )}

          {/* Section 1: Authenticated Dev Access Requests (UID-bound & Verified Email) */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl">
            <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <IconUsers className="w-4 h-4 text-emerald-400" />
                  <span>Solicitações Autenticadas de Acesso (E-mail Verificado & UID)</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Contas já existentes no Firebase Auth aguardando vinculação e liberação de demandas sem alterar suas senhas.
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800 shrink-0">
                {accessRequests.length} solicitação(ões)
              </span>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/60 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">E-mail Verificado & UID</th>
                    <th className="py-3 px-3">Nome / Dev Sugerido</th>
                    <th className="py-3 px-3">Data</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {accessRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        Nenhuma solicitação autenticada pendente na fila.
                      </td>
                    </tr>
                  ) : (
                    accessRequests.map(reqItem => (
                      <tr key={reqItem.uid} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-mono text-white font-medium">{reqItem.email}</p>
                          <p className="text-[10px] text-indigo-300 font-mono">UID: {reqItem.uid}</p>
                        </td>
                        <td className="py-3 px-3 text-slate-300">
                          <p className="font-medium text-white">{reqItem.name || 'Não informado'}</p>
                          {reqItem.devNameHint && (
                            <p className="text-[10px] text-emerald-400">Dev: {reqItem.devNameHint}</p>
                          )}
                        </td>
                        <td className="py-3 px-3 text-slate-400 font-mono text-[11px]">
                          {new Date(reqItem.requestedAt).toLocaleString('pt-BR')}
                        </td>
                        <td className="py-3 px-3">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              reqItem.status === 'resolved'
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                                : reqItem.status === 'rejected'
                                ? 'bg-rose-950/60 text-rose-300 border-rose-500/40'
                                : 'bg-amber-950/60 text-amber-300 border-amber-500/40 animate-pulse'
                            }`}
                          >
                            {reqItem.status === 'resolved'
                              ? 'Aprovado'
                              : reqItem.status === 'rejected'
                              ? 'Rejeitado'
                              : 'Pendente'}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleAuthorizeFromAccessRequest(reqItem)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
                            >
                              <IconCheck className="w-3.5 h-3.5" />
                              <span>Vincular & Liberar</span>
                            </button>
                            {reqItem.status === 'pending' && (
                              <button
                                type="button"
                                onClick={() => handleUpdateAccessRequestStatus(reqItem.uid, 'rejected')}
                                className="p-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 transition-colors cursor-pointer"
                                title="Rejeitar solicitação"
                              >
                                <IconX className="w-3.5 h-3.5" />
                              </button>
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

          {/* Section 2: Password / Account Help Queue */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden shadow-xl flex-1 flex flex-col">
            <div className="p-4 bg-slate-950/80 border-b border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <IconShieldCheck className="w-4 h-4 text-amber-400" />
                  <span>Fila de Ajuda e Recuperação de Credenciais</span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Pedidos enviados pelo formulário público de ajuda ("Esqueci a senha / Solicitar ajuda ao administrador").
                </p>
              </div>
              <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-3 py-1 rounded-lg border border-slate-800 shrink-0">
                {recoveryRequests.length} registro(s)
              </span>
            </div>

            <div className="overflow-x-auto flex-1 custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-950/80 border-b border-slate-800 text-slate-400 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3.5 px-4">E-mail Solicitante</th>
                    <th className="py-3.5 px-3">Nome / Detalhes</th>
                    <th className="py-3.5 px-3">Data / Hora</th>
                    <th className="py-3.5 px-3">Status</th>
                    <th className="py-3.5 px-4 text-right">Ações do Administrador</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/80">
                  {recoveryRequests.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-slate-500">
                        Nenhuma solicitação de suporte ou recuperação registrada na fila.
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
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                              reqItem.status === 'resolved'
                                ? 'bg-emerald-950/60 text-emerald-300 border-emerald-500/40'
                                : reqItem.status === 'rejected'
                                ? 'bg-rose-950/60 text-rose-300 border-rose-500/40'
                                : 'bg-amber-950/60 text-amber-300 border-amber-500/40 animate-pulse'
                            }`}
                          >
                            {reqItem.status === 'resolved'
                              ? 'Atendido'
                              : reqItem.status === 'rejected'
                              ? 'Rejeitado'
                              : 'Pendente'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              type="button"
                              onClick={() => handleAuthorizeFromRecovery(reqItem)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-[11px] shadow-sm transition-colors cursor-pointer flex items-center gap-1.5"
                              title="Provisionar ou editar este usuário"
                            >
                              <IconCheck className="w-3.5 h-3.5" />
                              <span>Provisionar</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleGenerateResetLink(reqItem)}
                              className="px-2.5 py-1 rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-300 text-[11px] font-semibold transition-colors cursor-pointer"
                            >
                              Gerar Link
                            </button>
                            {reqItem.status === 'pending' && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateRecoveryStatus(reqItem.id, 'resolved')}
                                  className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer"
                                >
                                  Concluir
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleUpdateRecoveryStatus(reqItem.id, 'rejected')}
                                  className="p-1 rounded-lg bg-rose-950/60 hover:bg-rose-900 border border-rose-800/60 text-rose-300 transition-colors cursor-pointer"
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
        </div>
      )}

      {/* PROVISION / EDIT MODAL */}
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
                    {editingMember
                      ? `Editar Permissões e Demandas: ${editingMember.name}`
                      : 'Provisionar Acesso de Desenvolvedor'}
                  </h3>
                  <p className="text-xs text-slate-400">
                    {editingMember
                      ? 'Atualize módulos, perfil e demandas autorizadas sem alterar a senha atual do usuário.'
                      : 'Crie o login no servidor com senha temporária ou vincule uma conta Firebase Auth já existente.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={closeAndScrubModal}
                className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <IconX className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Scrollable Body */}
            <form
              onSubmit={handleSaveMember}
              className="p-4 sm:p-6 space-y-5 overflow-y-auto custom-scrollbar flex-1"
            >
              {/* Mode selector when creating */}
              {!editingMember && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 p-1.5 bg-slate-950/90 border border-slate-800 rounded-2xl">
                  <button
                    type="button"
                    onClick={() => {
                      setProvisionMode('create-with-temp-password');
                      setModalError(null);
                      if (!formTempPassword) setFormTempPassword(generateRandomTempPassword());
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      provisionMode === 'create-with-temp-password'
                        ? 'bg-gradient-to-r from-indigo-600 to-emerald-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Criar Login + Senha Temporária
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setProvisionMode('link-existing');
                      setFormTempPassword('');
                      setModalError(null);
                    }}
                    className={`py-2 px-3 rounded-xl text-xs font-bold transition-all cursor-pointer ${
                      provisionMode === 'link-existing'
                        ? 'bg-indigo-600 text-white shadow-md'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Vincular Conta Existente (Sem Resetar Senha)
                  </button>
                </div>
              )}

              {modalError && (
                <div className="bg-rose-950/70 border border-rose-500/60 p-3.5 rounded-2xl text-xs text-rose-200 space-y-2">
                  <p className="font-semibold leading-relaxed">{modalError.message}</p>
                  {modalError.existingUid && !editingMember && provisionMode === 'create-with-temp-password' && (
                    <button
                      type="button"
                      onClick={() => {
                        setProvisionMode('link-existing');
                        setFormLinkedUid(modalError.existingUid || '');
                        setFormTempPassword('');
                        setModalError(null);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-[11px] transition-colors cursor-pointer"
                    >
                      Alternar para "Vincular Conta Existente" (UID: {modalError.existingUid})
                    </button>
                  )}
                </div>
              )}

              {/* Link to existing Dashboard Dev */}
              <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-2xl space-y-2">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                    Vincular ao Cadastro de Dev Existente
                  </label>
                  {selectedDevObj && matchingDevTasksCount > 0 && formRole === 'Colaborador' && (
                    <button
                      type="button"
                      onClick={() => {
                        const ids = getTasksMatchingDevName(selectedDevObj.name);
                        setFormAssignedTasks(prev => Array.from(new Set([...prev, ...ids])));
                      }}
                      className="text-[11px] text-emerald-400 hover:text-emerald-300 font-bold underline cursor-pointer"
                    >
                      + Selecionar {matchingDevTasksCount} demanda(s) de {selectedDevObj.name}
                    </button>
                  )}
                </div>
                <select
                  value={formSelectedDevId}
                  onChange={(e) => handleSelectDevInModal(e.target.value, true)}
                  className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white outline-none focus:border-indigo-500 cursor-pointer"
                >
                  <option value="">-- Selecionar Dev do Dashboard (opcional) --</option>
                  {devs.map(d => (
                    <option key={d.id} value={d.id}>
                      {d.name} {d.linkedUid ? `(UID vinculado)` : '(Sem login vinculado)'}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] text-slate-400">
                  Ao selecionar um Dev existente, o UID criado será gravado no cadastro do Dev e suas demandas atribuídas podem ser pré-selecionadas abaixo.
                </p>
              </div>

              {/* Basic Info: Email & Name */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                    E-mail de Login <span className="text-rose-400">*</span>
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    disabled={Boolean(editingMember)}
                    placeholder="ex: dev@empresa.com"
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
                    placeholder="ex: Arthur Faria Santos"
                    className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              {/* Server-Side Temporary Password Section (ONLY when creating new login) */}
              {!editingMember && provisionMode === 'create-with-temp-password' && (
                <div className="bg-amber-950/30 border border-amber-500/40 p-4 rounded-2xl space-y-2.5">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <label className="block text-[11px] font-bold text-amber-300 uppercase tracking-wider">
                      Senha Temporária Inicial <span className="text-rose-400">*</span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setFormTempPassword(generateRandomTempPassword());
                          setTempCredsCopied(false);
                        }}
                        className="text-[10px] px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 font-bold cursor-pointer"
                      >
                        Gerar Aleatória
                      </button>
                      <button
                        type="button"
                        onClick={handleCopyTempCredentials}
                        disabled={!formEmail.trim() || formTempPassword.length < 6}
                        className="text-[10px] px-2 py-1 rounded-lg bg-indigo-600/80 hover:bg-indigo-500 text-white font-bold cursor-pointer disabled:opacity-40"
                      >
                        {tempCredsCopied ? 'Copiado!' : 'Copiar E-mail + Senha Temp.'}
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <input
                      type={showTempPassword ? 'text' : 'password'}
                      value={formTempPassword}
                      onChange={(e) => {
                        setFormTempPassword(e.target.value);
                        setTempCredsCopied(false);
                      }}
                      placeholder="Mínimo 6 caracteres"
                      minLength={6}
                      required
                      autoComplete="new-password"
                      className="flex-1 bg-dark-900 border border-amber-500/40 rounded-xl px-3.5 py-2 text-xs text-white font-mono placeholder-slate-500 outline-none focus:border-amber-400"
                    />
                    <button
                      type="button"
                      onClick={() => setShowTempPassword(v => !v)}
                      className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-[11px] text-slate-300 cursor-pointer"
                    >
                      {showTempPassword ? 'Ocultar' : 'Mostrar'}
                    </button>
                  </div>

                  <p className="text-[11px] text-amber-200/90 leading-relaxed">
                    Esta senha temporária é enviada somente ao servidor para criar o usuário via Firebase Admin SDK, <strong>nunca é salva no banco ou logs</strong>, e o dev será obrigado a trocá-la antes de visualizar qualquer demanda. Copie-a antes de salvar caso precise entregá-la ao dev.
                  </p>
                </div>
              )}

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
                    <option value="Colaborador">Colaborador (Somente demandas autorizadas)</option>
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
                    <option value="active">Ativo (Liberado após eventual troca de senha)</option>
                    <option value="pending">Pendente (Bloqueado aguardando liberação)</option>
                    <option value="inactive">Inativo (Acesso bloqueado)</option>
                  </select>
                </div>
              </div>

              {/* UID field when linking existing or editing */}
              {(editingMember || provisionMode === 'link-existing') && (
                <div className="bg-slate-950/60 border border-slate-800/80 p-3.5 rounded-2xl space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider">
                      UID Firebase Auth{' '}
                      <span className="text-[10px] text-slate-500 font-normal font-sans">
                        (Opcional — localizado automaticamente por e-mail se omitido)
                      </span>
                    </label>
                    {formLinkedUid && (
                      <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-500/20 text-indigo-300 font-mono border border-indigo-500/30">
                        UID Definido
                      </span>
                    )}
                  </div>
                  <input
                    type="text"
                    value={formLinkedUid}
                    onChange={(e) => setFormLinkedUid(e.target.value)}
                    placeholder="ex: devUid123... (deixe em branco para buscar pelo e-mail no Auth)"
                    className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-indigo-300 placeholder-slate-500 outline-none focus:border-indigo-500 font-mono"
                  />
                  <p className="text-[10px] text-slate-400">
                    Vincular uma conta existente preserva a senha atual do usuário sem redefinição automática.
                  </p>
                </div>
              )}

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
                    Excluir, Importar e Gerenciar Usuários são exclusivas do ADM
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

              {/* Privileged Delegated Permissions */}
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
                        Permite selecionar múltiplas demandas na visualização em Lista e alterar a Sprint de destino em lote (requer edição e autorização por demanda).
                      </p>
                    </div>
                  </label>
                </div>
              </div>

              {/* Specific Demands Assignment Selector */}
              {formRole === 'Colaborador' && (
                <div className="bg-dark-850/80 border border-slate-800 rounded-2xl p-4 space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2 gap-2 flex-wrap">
                    <div>
                      <h4 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <IconProject className="w-3.5 h-3.5 text-amber-400" />
                        <span>Demandas Autorizadas ({formAssignedTasks.length})</span>
                      </h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        O servidor gravará o UID deste colaborador na ACL (`allowedUids`) apenas das demandas selecionadas abaixo.
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
                      placeholder="Pesquisar demanda pelo ID, resumo ou Dev..."
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
                                onChange={() => {}}
                                className="rounded text-indigo-600 focus:ring-0 pointer-events-none"
                              />
                              <span className="font-mono font-bold text-[11px] text-indigo-300 shrink-0">
                                {task.id}
                              </span>
                              <span className="truncate text-[11px] font-medium">{task.summary}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {task.assignee && (
                                <span className="text-[10px] text-emerald-300/90 hidden sm:inline">
                                  {task.assignee}
                                </span>
                              )}
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
                  onClick={closeAndScrubModal}
                  disabled={isSubmittingModal}
                  className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingModal}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white text-xs font-bold shadow-md shadow-indigo-950/50 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmittingModal
                    ? 'Provisionando no Servidor...'
                    : editingMember
                    ? 'Salvar Permissões e Demandas'
                    : provisionMode === 'create-with-temp-password'
                    ? 'Criar Login + Senha Temporária'
                    : 'Vincular Conta Existente'}
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
                  <p className="text-xs text-slate-400 truncate">
                    {linkUidModalMember.name} ({linkUidModalMember.email})
                  </p>
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
                Insira o <strong>UID do Firebase</strong> do colaborador. A vinculação atualizará a ACL das demandas atribuídas e ativará o acesso às telas permitidas.
              </p>

              <div>
                <label className="block text-[11px] font-bold text-slate-300 uppercase tracking-wider mb-1">
                  UID do Firebase <span className="text-rose-400">*</span>
                </label>
                <input
                  type="text"
                  value={linkUidInput}
                  onChange={(e) => setLinkUidInput(e.target.value)}
                  placeholder="ex: devUid..."
                  required
                  className="w-full bg-dark-900 border border-slate-700/80 rounded-xl px-3.5 py-2.5 text-xs text-indigo-300 placeholder-slate-500 outline-none focus:border-indigo-500 font-mono"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setLinkUidModalMember(null)}
                  disabled={isLinkingUid}
                  className="px-4 py-2 rounded-xl border border-slate-700 hover:bg-slate-800 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isLinkingUid}
                  className="px-5 py-2 rounded-xl bg-gradient-to-r from-indigo-600 to-emerald-600 hover:from-indigo-500 hover:to-emerald-500 text-white text-xs font-bold shadow-md shadow-indigo-950/50 transition-all cursor-pointer disabled:opacity-50"
                >
                  {isLinkingUid ? 'Vinculando...' : 'Vincular e Ativar'}
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
                Política de segurança: O administrador utiliza provisionamento no servidor com senha temporária de uso único ou orienta o usuário pelo canal corporativo oficial.
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
