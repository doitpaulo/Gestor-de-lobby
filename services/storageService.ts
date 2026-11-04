import { 
  Task, 
  Developer, 
  User, 
  WorkflowPhase, 
  Robot, 
  DocumentConfig, 
  Sprint, 
  SprintTask,
  HistoryEntry,
  getTaskSprintId,
  DevOpsConfig, 
  WorkspaceMember,
  UserRole,
  UserStatus,
  UserPermissions,
  AccountRecoveryRequest,
  NEXUS_OWNER_UID,
  DEFAULT_ADM_PERMISSIONS,
  DEFAULT_COLLABORATOR_PERMISSIONS,
  normalizeStatus, 
  normalizeTaskType 
} from '../types';
import { BackupService } from './backupService';
import { FirebaseService } from './firebase';

// Confirmed owner identity for Nexus ADM (authoritative UID: pM6ApHmKYfW2nMFRmUFGCtfjCEx1)
export const OWNER_UID = NEXUS_OWNER_UID;
// Maintain OWNER_EMAIL alias for backward-compatibility with display badges
export const OWNER_EMAIL = 'paulo.mmartinio@gmail.com';

// Security Helper: verify if user is the immutable root workspace owner
export const isOwnerUser = (user?: User | null): boolean => {
  if (!user || !user.id) return false;
  return user.id === NEXUS_OWNER_UID;
};

// Security Helper: verify if user is confirmed ADM (Owner or active delegated ADM)
export const isUserAdmin = (user?: User | null): boolean => {
  if (!user || !user.id) return false;
  if (user.id === NEXUS_OWNER_UID) return true;
  return user.role === 'ADM' && user.status === 'active';
};

// Security Helper: verify if a task is authorized for a specific user
export const isTaskAuthorized = (task: Task, user?: User | null): boolean => {
  if (!user) return false;
  if (isUserAdmin(user)) return true;

  const targetUserId = user.id ? String(user.id).trim() : '';

  // 1. Direct assigned UID
  if (task.assignedUid && task.assignedUid === targetUserId) return true;

  // 2. Explicitly authorized UIDs array
  if (Array.isArray(task.allowedUids) && task.allowedUids.includes(targetUserId)) return true;

  // 3. User's explicit authorized demands list
  if (Array.isArray(user.assignedTaskIds) && user.assignedTaskIds.includes(task.id)) return true;

  // 4. Assignee name / email match
  if (task.assignee) {
    const cleanAssignee = task.assignee.trim().toLowerCase();
    if (user.name && cleanAssignee === user.name.trim().toLowerCase()) return true;
    if (user.email && cleanAssignee === user.email.trim().toLowerCase()) return true;
  }

  return false;
};

// Resolve effective permissions for a user
export const getUserPermissions = (user?: User | null): UserPermissions => {
  if (!user) return DEFAULT_COLLABORATOR_PERMISSIONS;
  if (isUserAdmin(user)) return DEFAULT_ADM_PERMISSIONS;
  return user.permissions || DEFAULT_COLLABORATOR_PERMISSIONS;
};

// Purge all legacy localStorage data so that nothing is read from or saved to client disk
try {
  const legacyKeys = [
    'nexus_tasks_v2',
    'nexus_devs_v2',
    'nexus_robots_v1',
    'nexus_sprints_v1',
    'nexus_workflow_config_v4',
    'nexus_docs_config_v1',
    'nexus_devops_config_v1',
    'nexus_users_registry',
    'nexus_backup_snapshots_v1',
    'nexus_tasks',
    'nexus_devs'
  ];
  legacyKeys.forEach(k => localStorage.removeItem(k));
} catch (e) {
  console.warn('Error purging legacy localStorage:', e);
}

// Safe persistent workspace cache key for seamless offline & reload survival
const WORKSPACE_CACHE_KEY = 'nexus_workspace_cache_v4';
const MEMBERS_PERSISTENT_KEY = 'nexus_workspace_members_v2';

interface WorkspaceCachePayload {
  tasks: Task[];
  devs: Developer[];
  robots: Robot[];
  sprints: Sprint[];
  workflow: WorkflowPhase[];
  docs: DocumentConfig[];
  devops: DevOpsConfig;
  user: User | null;
  apiKey: string | null;
  members?: WorkspaceMember[];
}

const loadLocalCache = (): WorkspaceCachePayload | null => {
  try {
    const raw = localStorage.getItem(WORKSPACE_CACHE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    console.warn('Could not read workspace cache:', e);
    return null;
  }
};

const saveLocalCache = () => {
  try {
    const payload: WorkspaceCachePayload = {
      tasks: inMemoryTasks,
      devs: inMemoryDevs,
      robots: inMemoryRobots,
      sprints: inMemorySprints,
      workflow: inMemoryWorkflow,
      docs: inMemoryDocs,
      devops: inMemoryDevOps,
      user: inMemoryUser,
      apiKey: inMemoryApiKey,
      members: inMemoryMembers
    };
    localStorage.setItem(WORKSPACE_CACHE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn('Could not save workspace cache:', e);
  }
};

// Initialize from local cache if present
const initialCache = loadLocalCache();
let currentUserId: string | null = initialCache?.user?.id || null;
let inMemoryTasks: Task[] = initialCache?.tasks || [];
let inMemoryDevs: Developer[] = initialCache?.devs || [];
const DEVOPS_PERSISTENT_KEY = 'nexus_devops_config_saved_v2';

const getSavedDevOpsConfig = (): DevOpsConfig => {
  try {
    const raw = localStorage.getItem(DEVOPS_PERSISTENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          organization: parsed.organization || '',
          project: parsed.project || '',
          pat: parsed.pat || '',
          isActive: Boolean(parsed.isActive),
          defaultIterationPath: parsed.defaultIterationPath || ''
        };
      }
    }
  } catch (e) {
    console.warn('Error reading persistent DevOps config:', e);
  }
  return initialCache?.devops || { organization: '', project: '', pat: '', isActive: false, defaultIterationPath: '' };
};

const DELETED_TASKS_KEY = 'nexus_deleted_task_ids_v2';

const getStoredDeletedTaskIds = (): Set<string> => {
  try {
    const raw = localStorage.getItem(DELETED_TASKS_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        return new Set(arr.map(id => String(id).trim().toLowerCase()));
      }
    }
  } catch (e) {
    console.warn('Error reading deleted task IDs:', e);
  }
  return new Set();
};

let inMemoryDeletedTaskIds: Set<string> = getStoredDeletedTaskIds();

const saveDeletedTaskIds = () => {
  try {
    localStorage.setItem(DELETED_TASKS_KEY, JSON.stringify(Array.from(inMemoryDeletedTaskIds)));
  } catch (e) {
    console.warn('Error saving deleted task IDs:', e);
  }
};

// Filter out deleted tasks from cache
if (inMemoryTasks.length > 0 && inMemoryDeletedTaskIds.size > 0) {
  inMemoryTasks = inMemoryTasks.filter(t => !inMemoryDeletedTaskIds.has(String(t.id).trim().toLowerCase()));
}

let inMemoryRobots: Robot[] = initialCache?.robots || [];
let inMemorySprints: Sprint[] = initialCache?.sprints || [];

const WORKFLOW_PERSISTENT_KEY = 'nexus_workflow_phases_saved_v2';
const DOCUMENTS_PERSISTENT_KEY = 'nexus_documents_config_saved_v2';

const getSavedWorkflowConfig = (): WorkflowPhase[] => {
  try {
    const raw = localStorage.getItem(WORKFLOW_PERSISTENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error reading persistent workflow config:', e);
  }
  if (initialCache?.workflow && Array.isArray(initialCache.workflow) && initialCache.workflow.length > 0) {
    return initialCache.workflow;
  }
  return [];
};

const getSavedDocumentsConfig = (): DocumentConfig[] => {
  try {
    const raw = localStorage.getItem(DOCUMENTS_PERSISTENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch (e) {
    console.warn('Error reading persistent documents config:', e);
  }
  if (initialCache?.docs && Array.isArray(initialCache.docs) && initialCache.docs.length > 0) {
    return initialCache.docs;
  }
  return [];
};

let inMemoryWorkflow: WorkflowPhase[] = getSavedWorkflowConfig();
let inMemoryDocs: DocumentConfig[] = getSavedDocumentsConfig();
let inMemoryDevOps: DevOpsConfig = getSavedDevOpsConfig();
let inMemoryUser: User | null = initialCache?.user || null;
let inMemoryApiKey: string | null = initialCache?.apiKey || null;

const RECOVERY_PERSISTENT_KEY = 'nexus_recovery_requests';

const getInitialMembers = (): WorkspaceMember[] => {
  try {
    const raw = localStorage.getItem(MEMBERS_PERSISTENT_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {}
  if (initialCache?.members && Array.isArray(initialCache.members)) {
    return initialCache.members;
  }
  return [
    {
      id: 'member_owner_paulo',
      uid: NEXUS_OWNER_UID,
      email: 'paulo.mmartinio@gmail.com',
      name: 'Paulo Martinio (Proprietário)',
      role: 'ADM',
      status: 'active',
      permissions: DEFAULT_ADM_PERMISSIONS,
      assignedTaskIds: [],
      workspaceOwnerUid: NEXUS_OWNER_UID,
      invitedAt: new Date().toISOString()
    }
  ];
};

let inMemoryMembers: WorkspaceMember[] = getInitialMembers();
let inMemoryRecoveryRequests: AccountRecoveryRequest[] = [];

export const StorageService = {
  // --- Workspace Members & Roles ---
  getMembers: (): WorkspaceMember[] => {
    return inMemoryMembers;
  },

  setMembersInMemory: (members: WorkspaceMember[]) => {
    inMemoryMembers = members;
    try {
      localStorage.setItem(MEMBERS_PERSISTENT_KEY, JSON.stringify(members));
    } catch {}
    saveLocalCache();
  },

  saveMember: (member: WorkspaceMember, ownerUid?: string) => {
    const cleanEmail = member.email.trim().toLowerCase();
    const existingIdx = inMemoryMembers.findIndex(m => 
      (m.id && m.id === member.id) || 
      (m.email && m.email.trim().toLowerCase() === cleanEmail) ||
      (member.uid && m.uid && m.uid === member.uid)
    );

    let updatedList: WorkspaceMember[];
    if (existingIdx >= 0) {
      updatedList = [...inMemoryMembers];
      updatedList[existingIdx] = { ...updatedList[existingIdx], ...member };
    } else {
      updatedList = [...inMemoryMembers, member];
    }

    inMemoryMembers = updatedList;
    try {
      localStorage.setItem(MEMBERS_PERSISTENT_KEY, JSON.stringify(updatedList));
    } catch {}
    saveLocalCache();

    const targetOwner = ownerUid || NEXUS_OWNER_UID;
    FirebaseService.saveMember(targetOwner, member).catch(e => console.warn('Firebase saveMember error:', e));
  },

  deleteMember: (memberId: string, ownerUid?: string) => {
    const updated = inMemoryMembers.filter(m => m.id !== memberId && m.email !== memberId);
    inMemoryMembers = updated;
    try {
      localStorage.setItem(MEMBERS_PERSISTENT_KEY, JSON.stringify(updated));
    } catch {}
    saveLocalCache();

    const targetOwner = ownerUid || NEXUS_OWNER_UID;
    FirebaseService.deleteMember(targetOwner, memberId).catch(e => console.warn('Firebase deleteMember error:', e));
  },

  getMemberByEmail: (email: string): WorkspaceMember | null => {
    if (!email) return null;
    const clean = email.trim().toLowerCase();
    return inMemoryMembers.find(m => m.email.trim().toLowerCase() === clean) || null;
  },

  getMemberByUid: (uid: string): WorkspaceMember | null => {
    if (!uid) return null;
    return inMemoryMembers.find(m => m.uid === uid || m.id === uid) || null;
  },

  resolveUserMembership: (rawUser: User): User => {
    if (!rawUser) return rawUser;

    // 1. Root Workspace Owner verified by exact immutable UID
    if (rawUser.id === NEXUS_OWNER_UID) {
      return {
        ...rawUser,
        role: 'ADM',
        status: 'active',
        permissions: DEFAULT_ADM_PERMISSIONS,
        assignedTaskIds: [],
        workspaceOwnerUid: NEXUS_OWNER_UID
      };
    }

    // 2. Guest demo mode
    const cleanEmail = (rawUser.email || '').trim().toLowerCase();
    if (rawUser.id.startsWith('guest-') || cleanEmail.includes('convidado')) {
      return {
        ...rawUser,
        role: 'Colaborador',
        status: 'active',
        permissions: DEFAULT_COLLABORATOR_PERMISSIONS,
        assignedTaskIds: [],
        workspaceOwnerUid: NEXUS_OWNER_UID
      };
    }

    // 3. Match against member registry by UID first (most secure & definitive)
    const memberByUid = rawUser.id ? StorageService.getMemberByUid(rawUser.id) : null;
    if (memberByUid) {
      return {
        ...rawUser,
        role: memberByUid.role,
        status: memberByUid.status,
        permissions: memberByUid.permissions || (memberByUid.role === 'ADM' ? DEFAULT_ADM_PERMISSIONS : DEFAULT_COLLABORATOR_PERMISSIONS),
        assignedTaskIds: memberByUid.assignedTaskIds || [],
        workspaceOwnerUid: NEXUS_OWNER_UID
      };
    }

    // 4. If UID not yet linked, match against pre-authorized member by clean email
    const memberByEmail = cleanEmail ? StorageService.getMemberByEmail(cleanEmail) : null;
    if (memberByEmail) {
      // Security Policy: Only auto-link UID if the email is cryptographically verified (e.g., Google OAuth).
      // Unverified email/password registrations remain pending for manual identity confirmation by ADM.
      const isEmailVerified = Boolean(rawUser.emailVerified);

      if (isEmailVerified && !memberByEmail.uid && rawUser.id) {
        memberByEmail.uid = rawUser.id;
        StorageService.saveMember(memberByEmail, NEXUS_OWNER_UID);
        return {
          ...rawUser,
          role: memberByEmail.role,
          status: memberByEmail.status,
          permissions: memberByEmail.permissions || (memberByEmail.role === 'ADM' ? DEFAULT_ADM_PERMISSIONS : DEFAULT_COLLABORATOR_PERMISSIONS),
          assignedTaskIds: memberByEmail.assignedTaskIds || [],
          workspaceOwnerUid: NEXUS_OWNER_UID
        };
      }

      // If email is not yet verified or UID binding awaits ADM confirmation:
      return {
        ...rawUser,
        role: memberByEmail.role,
        status: 'pending',
        permissions: memberByEmail.permissions || DEFAULT_COLLABORATOR_PERMISSIONS,
        assignedTaskIds: memberByEmail.assignedTaskIds || [],
        workspaceOwnerUid: NEXUS_OWNER_UID,
        pendingReason: 'UID_UNLINKED'
      };
    }

    // 5. External registration / cadastro avulso: strictly defaults to pending access!
    // Never auto-promoted to ADM, never given isolated workspace.
    return {
      ...rawUser,
      role: 'Colaborador',
      status: 'pending',
      permissions: DEFAULT_COLLABORATOR_PERMISSIONS,
      assignedTaskIds: [],
      workspaceOwnerUid: NEXUS_OWNER_UID,
      pendingReason: 'UNAUTHORIZED'
    };
  },

  // Manual UID binding by ADM after confirming collaborator identity
  linkMemberUid: (memberIdOrEmail: string, uid: string, activate: boolean = true): WorkspaceMember | null => {
    const clean = memberIdOrEmail.trim().toLowerCase();
    const cleanUid = uid.trim();
    if (!cleanUid) return null;

    let targetUpdated: WorkspaceMember | null = null;
    inMemoryMembers = inMemoryMembers.map(m => {
      if (m.id === memberIdOrEmail || m.email.trim().toLowerCase() === clean) {
        const updated: WorkspaceMember = {
          ...m,
          uid: cleanUid,
          status: activate ? 'active' : m.status,
          activatedAt: activate ? (m.activatedAt || new Date().toISOString()) : m.activatedAt
        };
        targetUpdated = updated;
        return updated;
      }
      return m;
    });

    if (targetUpdated) {
      try {
        localStorage.setItem(MEMBERS_PERSISTENT_KEY, JSON.stringify(inMemoryMembers));
      } catch {}
      saveLocalCache();
      FirebaseService.saveMember(NEXUS_OWNER_UID, targetUpdated).catch(e => console.warn('Firebase saveMember notice:', e));
    }

    return targetUpdated;
  },

  // --- Account Recovery Requests ---
  getRecoveryRequests: (): AccountRecoveryRequest[] => {
    return inMemoryRecoveryRequests;
  },

  setRecoveryRequestsInMemory: (requests: AccountRecoveryRequest[]) => {
    inMemoryRecoveryRequests = requests;
    try {
      localStorage.setItem(RECOVERY_PERSISTENT_KEY, JSON.stringify(requests));
    } catch {}
  },

  saveRecoveryRequest: (req: AccountRecoveryRequest) => {
    const existingIdx = inMemoryRecoveryRequests.findIndex(r => r.id === req.id || (r.email === req.email && r.status === 'pending'));
    if (existingIdx >= 0) {
      inMemoryRecoveryRequests[existingIdx] = req;
    } else {
      inMemoryRecoveryRequests.unshift(req);
    }
    try {
      localStorage.setItem(RECOVERY_PERSISTENT_KEY, JSON.stringify(inMemoryRecoveryRequests));
    } catch {}
    FirebaseService.saveRecoveryRequest(NEXUS_OWNER_UID, req).catch(() => {});
  },

  updateRecoveryRequestStatus: (id: string, status: 'resolved' | 'rejected', adminUid?: string) => {
    const target = inMemoryRecoveryRequests.find(r => r.id === id);
    if (target) {
      target.status = status;
      target.resolvedAt = new Date().toISOString();
      target.resolvedByUid = adminUid;
      try {
        localStorage.setItem(RECOVERY_PERSISTENT_KEY, JSON.stringify(inMemoryRecoveryRequests));
      } catch {}
      FirebaseService.saveRecoveryRequest(NEXUS_OWNER_UID, target).catch(() => {});
    }
  },

  setCurrentUserId: (uid: string | null) => {
    currentUserId = uid;
  },

  getCurrentUserId: () => currentUserId,

  // --- Deleted Tasks Tombstones ---
  getDeletedTaskIds: (): Set<string> => {
    return inMemoryDeletedTaskIds;
  },

  isTaskDeleted: (id: string): boolean => {
    if (!id) return false;
    return inMemoryDeletedTaskIds.has(String(id).trim().toLowerCase());
  },

  addDeletedTaskId: (id: string) => {
    if (!id) return;
    const clean = String(id).trim().toLowerCase();
    inMemoryDeletedTaskIds.add(clean);
    saveDeletedTaskIds();
  },

  // Reset user session state in memory (keeps persistent tool credentials like DevOps safe)
  clearAllMemory: () => {
    currentUserId = null;
    inMemoryTasks = [];
    inMemoryDevs = [];
    inMemoryRobots = [];
    inMemorySprints = [];
    // Do NOT wipe inMemoryWorkflow - workflow phases must survive logins, logouts, and reloads!
    // Do NOT wipe inMemoryDocs - document config must survive logins, logouts, and reloads!
    // Do NOT wipe inMemoryDevOps - it must survive logins, logouts, and reloads!
    // Do NOT wipe inMemoryDeletedTaskIds - deleted tasks must stay deleted across logins!
    inMemoryUser = null;
    inMemoryApiKey = null;
    try {
      localStorage.removeItem(WORKSPACE_CACHE_KEY);
    } catch {}
  },

  // --- Tasks ---
  getTasks: (): Task[] => {
    return inMemoryTasks.filter(t => !inMemoryDeletedTaskIds.has(String(t.id).trim().toLowerCase()));
  },

  setTasksInMemory: (tasks: Task[]) => {
    inMemoryTasks = tasks
      .filter(t => !inMemoryDeletedTaskIds.has(String(t.id).trim().toLowerCase()))
      .map(t => ({
        ...t,
        status: normalizeStatus(t.status),
        type: normalizeTaskType(t.type)
      }));
    saveLocalCache();
  },

  saveTasks: (tasks: Task[], reconcileWithFirestore: boolean = false) => {
    const sanitized = tasks
      .filter(t => !inMemoryDeletedTaskIds.has(String(t.id).trim().toLowerCase()))
      .map(t => ({
        ...t,
        status: normalizeStatus(t.status),
        type: normalizeTaskType(t.type)
      }));
    inMemoryTasks = sanitized;
    saveLocalCache();
    BackupService.triggerAutoBackup("Alteração em Demandas / Tarefas");
    FirebaseService.saveTasksBatch(sanitized, currentUserId || undefined, reconcileWithFirestore).catch(e => console.warn('Firebase saveTasksBatch error:', e));
  },

  deleteTask: (id: string, userId?: string): Task[] => {
    const cleanId = String(id || '').trim();
    const cleanLower = cleanId.toLowerCase();
    if (!cleanId) return inMemoryTasks;

    // 1. Mark permanently in deleted set
    inMemoryDeletedTaskIds.add(cleanLower);
    saveDeletedTaskIds();

    // 2. Remove from in-memory tasks
    inMemoryTasks = inMemoryTasks.filter(t => String(t.id).trim().toLowerCase() !== cleanLower);
    
    // 3. Remove from in-memory sprints
    inMemorySprints = inMemorySprints.map(s => ({
      ...s,
      tasks: s.tasks.filter(st => String(st.taskId).trim().toLowerCase() !== cleanLower)
    }));
    
    saveLocalCache();
    BackupService.triggerAutoBackup(`Exclusão da Demanda ${cleanId}`);

    // 4. Trigger Firestore deletion across all collections
    const uid = userId || currentUserId || undefined;
    FirebaseService.deleteTask(cleanId, uid).catch(e => console.warn('Firebase deleteTask error:', e));

    return inMemoryTasks;
  },
  
  clearTasks: () => {
    inMemoryTasks.forEach(t => inMemoryDeletedTaskIds.add(String(t.id).trim().toLowerCase()));
    saveDeletedTaskIds();
    inMemoryTasks = [];
    inMemoryRobots = [];
    saveLocalCache();
    BackupService.triggerAutoBackup("Reset / Limpeza de Dados");
    FirebaseService.deleteAllTasks(currentUserId || undefined).catch(e => console.warn('Firebase deleteAllTasks error:', e));
  },

  // --- Developers (starts empty - no pre-seeded default developers) ---
  getDevs: (): Developer[] => {
    return inMemoryDevs;
  },

  setDevsInMemory: (devs: Developer[]) => {
    inMemoryDevs = devs;
    saveLocalCache();
  },

  saveDevs: (devs: Developer[]) => {
    inMemoryDevs = devs;
    saveLocalCache();
    BackupService.triggerAutoBackup("Alteração na Equipe de Desenvolvedores");
    FirebaseService.saveDevs(devs, currentUserId || undefined).catch(e => console.warn('Firebase saveDevs error:', e));
  },

  updateDev: (id: string, newName: string) => {
    const targetClean = String(id || '').trim().toLowerCase();
    inMemoryDevs = inMemoryDevs.map(d => 
      (String(d.id || '').trim() === String(id || '').trim() || d.name.trim().toLowerCase() === targetClean) 
        ? { ...d, name: newName.trim() } 
        : d
    );
    saveLocalCache();
    BackupService.triggerAutoBackup("Atualização de Desenvolvedor");
    FirebaseService.saveDevs(inMemoryDevs, currentUserId || undefined).catch(e => console.warn('Firebase saveDevs error:', e));
    return inMemoryDevs;
  },

  deleteDev: (id: string) => {
    const targetClean = String(id || '').trim().toLowerCase();
    inMemoryDevs = inMemoryDevs.filter(d => 
      String(d.id || '').trim() !== String(id || '').trim() && 
      d.name.trim().toLowerCase() !== targetClean
    );
    saveLocalCache();
    BackupService.triggerAutoBackup("Exclusão de Desenvolvedor");
    FirebaseService.deleteDev(id, currentUserId || undefined).catch(e => console.warn('Firebase deleteDev error:', e));
    FirebaseService.saveDevs(inMemoryDevs, currentUserId || undefined).catch(e => console.warn('Firebase saveDevs error:', e));
    return inMemoryDevs;
  },

  // --- Robots ---
  getRobots: (): Robot[] => {
    return inMemoryRobots;
  },

  setRobotsInMemory: (robots: Robot[]) => {
    inMemoryRobots = robots;
    saveLocalCache();
  },

  saveRobots: (robots: Robot[]) => {
    inMemoryRobots = robots;
    saveLocalCache();
    BackupService.triggerAutoBackup("Alteração nos Robôs RPA");
    FirebaseService.saveRobots(robots, currentUserId || undefined).catch(e => console.warn('Firebase saveRobots error:', e));
  },

  // --- Workflow Config ---
  getWorkflowConfig: (defaultConfig: WorkflowPhase[]): WorkflowPhase[] => {
    if (inMemoryWorkflow && inMemoryWorkflow.length > 0) return inMemoryWorkflow;
    const saved = getSavedWorkflowConfig();
    if (saved && saved.length > 0) {
      inMemoryWorkflow = saved;
      return saved;
    }
    return inMemoryWorkflow.length > 0 ? inMemoryWorkflow : defaultConfig;
  },

  setWorkflowConfigInMemory: (config: WorkflowPhase[]) => {
    if (!config || !Array.isArray(config) || config.length === 0) return;
    inMemoryWorkflow = config;
    try {
      localStorage.setItem(WORKFLOW_PERSISTENT_KEY, JSON.stringify(config));
    } catch {}
    saveLocalCache();
  },

  saveWorkflowConfig: async (config: WorkflowPhase[], userId?: string): Promise<boolean> => {
    if (!config || !Array.isArray(config) || config.length === 0) return false;
    inMemoryWorkflow = config;
    const nowIso = new Date().toISOString();

    // 1. Save locally in dedicated key and metadata
    try {
      localStorage.setItem(WORKFLOW_PERSISTENT_KEY, JSON.stringify(config));
      localStorage.setItem('nexus_workflow_meta_v2', JSON.stringify({
        updatedAt: nowIso,
        count: config.length,
        isCustom: true
      }));
    } catch (e) {
      console.warn('Error saving persistent workflow config to localStorage:', e);
    }
    saveLocalCache();
    window.dispatchEvent(new CustomEvent('nexus-workflow-config-updated', { detail: config }));
    BackupService.triggerAutoBackup("Alteração nas Fases de Projetos / Workflow");

    // 2. Persist to backend server disk for node/server resilience across restarts
    try {
      await fetch('/api/workflow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: config, updatedAt: nowIso })
      });
    } catch (e) {
      console.warn('Notice saving workflow to server disk:', e);
    }

    // 3. Persist to Firestore under both targetUid and NEXUS_OWNER_UID so any device/browser loads it
    const targetUid = userId || currentUserId || undefined;
    try {
      await FirebaseService.saveSetting('workflow', config, NEXUS_OWNER_UID);
      if (targetUid && targetUid !== NEXUS_OWNER_UID) {
        await FirebaseService.saveSetting('workflow', config, targetUid);
      }
    } catch (e) {
      console.warn('Firebase saveSetting workflow notice:', e);
    }

    return true;
  },

  // Smart 3-way synchronization (Local Storage + Node Disk + Cloud Firestore)
  // Guarantees user created/edited phases are NEVER overwritten by older/empty defaults!
  syncWorkflowFromServerAndCloud: async (workspaceUid?: string): Promise<WorkflowPhase[] | null> => {
    let localPhases = StorageService.getWorkflowConfig([]);
    let localUpdatedAt = 0;
    try {
      const metaRaw = localStorage.getItem('nexus_workflow_meta_v2');
      if (metaRaw) {
        const parsed = JSON.parse(metaRaw);
        if (parsed?.updatedAt) localUpdatedAt = new Date(parsed.updatedAt).getTime();
      }
    } catch {}

    // A. Check Node Server store
    try {
      const res = await fetch('/api/workflow');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.workflow) && data.workflow.length > 0) {
          const serverUpdatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
          if (serverUpdatedAt > localUpdatedAt || localPhases.length === 0) {
            localPhases = data.workflow;
            inMemoryWorkflow = data.workflow;
            localUpdatedAt = serverUpdatedAt;
            try {
              localStorage.setItem(WORKFLOW_PERSISTENT_KEY, JSON.stringify(data.workflow));
              localStorage.setItem('nexus_workflow_meta_v2', JSON.stringify({
                updatedAt: data.updatedAt || new Date().toISOString(),
                count: data.workflow.length,
                isCustom: true
              }));
            } catch {}
            saveLocalCache();
            window.dispatchEvent(new CustomEvent('nexus-workflow-config-updated', { detail: data.workflow }));
          }
        }
      }
    } catch (e) {
      console.warn('Notice syncing workflow from server:', e);
    }

    // B. Check Cloud Firestore with timestamp metadata
    const targetUid = workspaceUid || currentUserId || NEXUS_OWNER_UID;
    try {
      const remoteMeta = await FirebaseService.getSettingWithMeta<WorkflowPhase[]>('workflow', targetUid);
      if (remoteMeta && Array.isArray(remoteMeta.value) && remoteMeta.value.length > 0) {
        const remoteUpdatedAt = remoteMeta.updatedAt ? new Date(remoteMeta.updatedAt).getTime() : 0;
        if (remoteUpdatedAt > localUpdatedAt) {
          // Cloud is strictly newer
          localPhases = remoteMeta.value;
          inMemoryWorkflow = remoteMeta.value;
          try {
            localStorage.setItem(WORKFLOW_PERSISTENT_KEY, JSON.stringify(remoteMeta.value));
            localStorage.setItem('nexus_workflow_meta_v2', JSON.stringify({
              updatedAt: remoteMeta.updatedAt || new Date().toISOString(),
              count: remoteMeta.value.length,
              isCustom: true
            }));
          } catch {}
          saveLocalCache();
          window.dispatchEvent(new CustomEvent('nexus-workflow-config-updated', { detail: remoteMeta.value }));
          // Also sync to server disk
          fetch('/api/workflow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workflow: remoteMeta.value, updatedAt: remoteMeta.updatedAt })
          }).catch(() => {});
        } else if (localUpdatedAt > remoteUpdatedAt && localPhases.length > 0) {
          // Local is newer -> push local to Firestore to heal cloud
          FirebaseService.saveSetting('workflow', localPhases, NEXUS_OWNER_UID).catch(() => {});
          if (targetUid !== NEXUS_OWNER_UID) {
            FirebaseService.saveSetting('workflow', localPhases, targetUid).catch(() => {});
          }
        }
      } else if (localPhases.length > 0) {
        // Cloud has nothing -> push current local phases to Firestore
        FirebaseService.saveSetting('workflow', localPhases, NEXUS_OWNER_UID).catch(() => {});
        if (targetUid !== NEXUS_OWNER_UID) {
          FirebaseService.saveSetting('workflow', localPhases, targetUid).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Notice syncing workflow from Firestore:', e);
    }

    return localPhases.length > 0 ? localPhases : null;
  },

  // --- Documents Config ---
  getDocumentsConfig: (defaults: DocumentConfig[]): DocumentConfig[] => {
    if (inMemoryDocs && inMemoryDocs.length > 0) return inMemoryDocs;
    const saved = getSavedDocumentsConfig();
    if (saved && saved.length > 0) {
      inMemoryDocs = saved;
      return saved;
    }
    return inMemoryDocs.length > 0 ? inMemoryDocs : defaults;
  },

  setDocumentsConfigInMemory: (config: DocumentConfig[]) => {
    if (!config || !Array.isArray(config) || config.length === 0) return;
    inMemoryDocs = config;
    try {
      localStorage.setItem(DOCUMENTS_PERSISTENT_KEY, JSON.stringify(config));
    } catch {}
    saveLocalCache();
  },

  saveDocumentsConfig: async (config: DocumentConfig[], userId?: string): Promise<boolean> => {
    if (!config || !Array.isArray(config) || config.length === 0) return false;
    inMemoryDocs = config;
    const nowIso = new Date().toISOString();

    // 1. Local storage
    try {
      localStorage.setItem(DOCUMENTS_PERSISTENT_KEY, JSON.stringify(config));
      localStorage.setItem('nexus_documents_meta_v2', JSON.stringify({
        updatedAt: nowIso,
        count: config.length,
        isCustom: true
      }));
    } catch (e) {
      console.warn('Error saving persistent documents config to localStorage:', e);
    }
    saveLocalCache();
    window.dispatchEvent(new CustomEvent('nexus-documents-config-updated', { detail: config }));
    BackupService.triggerAutoBackup("Alteração nos Documentos da Esteira");

    // 2. Server disk
    try {
      await fetch('/api/documents-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: config, updatedAt: nowIso })
      });
    } catch (e) {
      console.warn('Notice saving documents config to server:', e);
    }

    // 3. Firestore
    const targetUid = userId || currentUserId || undefined;
    try {
      await FirebaseService.saveSetting('documents', config, NEXUS_OWNER_UID);
      if (targetUid && targetUid !== NEXUS_OWNER_UID) {
        await FirebaseService.saveSetting('documents', config, targetUid);
      }
    } catch (e) {
      console.warn('Firebase saveSetting documents notice:', e);
    }

    return true;
  },

  syncDocumentsFromServerAndCloud: async (workspaceUid?: string): Promise<DocumentConfig[] | null> => {
    let localDocs = StorageService.getDocumentsConfig([]);
    let localUpdatedAt = 0;
    try {
      const metaRaw = localStorage.getItem('nexus_documents_meta_v2');
      if (metaRaw) {
        const parsed = JSON.parse(metaRaw);
        if (parsed?.updatedAt) localUpdatedAt = new Date(parsed.updatedAt).getTime();
      }
    } catch {}

    // A. Check Node Server store
    try {
      const res = await fetch('/api/documents-config');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.documents) && data.documents.length > 0) {
          const serverUpdatedAt = data.updatedAt ? new Date(data.updatedAt).getTime() : 0;
          if (serverUpdatedAt > localUpdatedAt || localDocs.length === 0) {
            localDocs = data.documents;
            inMemoryDocs = data.documents;
            localUpdatedAt = serverUpdatedAt;
            try {
              localStorage.setItem(DOCUMENTS_PERSISTENT_KEY, JSON.stringify(data.documents));
              localStorage.setItem('nexus_documents_meta_v2', JSON.stringify({
                updatedAt: data.updatedAt || new Date().toISOString(),
                count: data.documents.length,
                isCustom: true
              }));
            } catch {}
            saveLocalCache();
            window.dispatchEvent(new CustomEvent('nexus-documents-config-updated', { detail: data.documents }));
          }
        }
      }
    } catch (e) {
      console.warn('Notice syncing documents from server:', e);
    }

    // B. Check Cloud Firestore
    const targetUid = workspaceUid || currentUserId || NEXUS_OWNER_UID;
    try {
      const remoteMeta = await FirebaseService.getSettingWithMeta<DocumentConfig[]>('documents', targetUid);
      if (remoteMeta && Array.isArray(remoteMeta.value) && remoteMeta.value.length > 0) {
        const remoteUpdatedAt = remoteMeta.updatedAt ? new Date(remoteMeta.updatedAt).getTime() : 0;
        if (remoteUpdatedAt > localUpdatedAt) {
          localDocs = remoteMeta.value;
          inMemoryDocs = remoteMeta.value;
          try {
            localStorage.setItem(DOCUMENTS_PERSISTENT_KEY, JSON.stringify(remoteMeta.value));
            localStorage.setItem('nexus_documents_meta_v2', JSON.stringify({
              updatedAt: remoteMeta.updatedAt || new Date().toISOString(),
              count: remoteMeta.value.length,
              isCustom: true
            }));
          } catch {}
          saveLocalCache();
          window.dispatchEvent(new CustomEvent('nexus-documents-config-updated', { detail: remoteMeta.value }));
          fetch('/api/documents-config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ documents: remoteMeta.value, updatedAt: remoteMeta.updatedAt })
          }).catch(() => {});
        } else if (localUpdatedAt > remoteUpdatedAt && localDocs.length > 0) {
          FirebaseService.saveSetting('documents', localDocs, NEXUS_OWNER_UID).catch(() => {});
          if (targetUid !== NEXUS_OWNER_UID) {
            FirebaseService.saveSetting('documents', localDocs, targetUid).catch(() => {});
          }
        }
      } else if (localDocs.length > 0) {
        FirebaseService.saveSetting('documents', localDocs, NEXUS_OWNER_UID).catch(() => {});
        if (targetUid !== NEXUS_OWNER_UID) {
          FirebaseService.saveSetting('documents', localDocs, targetUid).catch(() => {});
        }
      }
    } catch (e) {
      console.warn('Notice syncing documents from Firestore:', e);
    }

    return localDocs.length > 0 ? localDocs : null;
  },

  // --- Azure DevOps Configuration ---
  getDevOpsConfig: (): DevOpsConfig => {
    if (inMemoryDevOps && (inMemoryDevOps.organization || inMemoryDevOps.pat)) {
      return inMemoryDevOps;
    }
    const saved = getSavedDevOpsConfig();
    if (saved && (saved.organization || saved.pat)) {
      inMemoryDevOps = saved;
      return saved;
    }
    return inMemoryDevOps;
  },

  setDevOpsConfigInMemory: (config: DevOpsConfig) => {
    if (!config) return;
    inMemoryDevOps = {
      organization: String(config.organization || '').trim(),
      project: String(config.project || '').trim(),
      pat: String(config.pat || '').trim(),
      isActive: Boolean(config.isActive),
      defaultIterationPath: String(config.defaultIterationPath || '').trim()
    };
    try {
      localStorage.setItem(DEVOPS_PERSISTENT_KEY, JSON.stringify(inMemoryDevOps));
    } catch {}
    saveLocalCache();
    window.dispatchEvent(new CustomEvent('nexus-devops-config-updated', { detail: inMemoryDevOps }));
  },

  saveDevOpsConfig: async (config: DevOpsConfig, userId?: string): Promise<{ success: boolean; error?: string }> => {
    inMemoryDevOps = {
      organization: String(config.organization || '').trim(),
      project: String(config.project || '').trim(),
      pat: String(config.pat || '').trim(),
      isActive: Boolean(config.isActive),
      defaultIterationPath: String(config.defaultIterationPath || '').trim()
    };

    // 1. Save locally for instantaneous offline availability
    try {
      localStorage.setItem(DEVOPS_PERSISTENT_KEY, JSON.stringify(inMemoryDevOps));
    } catch (e) {
      console.warn('Error saving persistent DevOps config to localStorage:', e);
    }
    saveLocalCache();
    window.dispatchEvent(new CustomEvent('nexus-devops-config-updated', { detail: inMemoryDevOps }));
    BackupService.triggerAutoBackup("Alteração nas Configurações do Azure DevOps");

    // 2. Persist to Firestore cloud database under both targetUid and NEXUS_OWNER_UID so any device/browser loads it
    const targetUid = userId || currentUserId || undefined;
    try {
      await FirebaseService.saveDevOpsConfig(inMemoryDevOps, NEXUS_OWNER_UID);
      await FirebaseService.saveSetting('devops', inMemoryDevOps, NEXUS_OWNER_UID);
      if (targetUid && targetUid !== NEXUS_OWNER_UID) {
        await FirebaseService.saveDevOpsConfig(inMemoryDevOps, targetUid);
        await FirebaseService.saveSetting('devops', inMemoryDevOps, targetUid);
      }
    } catch (e: any) {
      console.warn('Firebase saveDevOpsConfig notice:', e);
    }

    // 3. Persist to backend server store for complete node resilience
    try {
      await fetch('/api/devops/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(inMemoryDevOps)
      });
    } catch {}

    return { success: true };
  },

  // Synchronizes Azure DevOps config from Firestore cloud storage across devices
  syncDevOpsFromCloud: async (userId?: string): Promise<DevOpsConfig | null> => {
    const targetUid = userId || currentUserId || NEXUS_OWNER_UID;

    try {
      // 1. Query Firestore cloud storage (try targetUid first, then NEXUS_OWNER_UID canonical)
      let remote = await FirebaseService.getDevOpsConfig(targetUid);
      if (!remote || (!remote.organization && !remote.pat && !remote.project)) {
        remote = await FirebaseService.getDevOpsConfig(NEXUS_OWNER_UID);
      }
      if (remote && (remote.organization || remote.pat || remote.project)) {
        inMemoryDevOps = remote;
        try {
          localStorage.setItem(DEVOPS_PERSISTENT_KEY, JSON.stringify(remote));
        } catch {}
        saveLocalCache();
        window.dispatchEvent(new CustomEvent('nexus-devops-config-updated', { detail: remote }));
        // Keep backend in sync
        fetch('/api/devops/config', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(remote)
        }).catch(() => {});
        return remote;
      }

      // 2. If remote is not yet populated, but local session has credentials, upload to Firestore!
      if (inMemoryDevOps && (inMemoryDevOps.organization || inMemoryDevOps.pat)) {
        await FirebaseService.saveDevOpsConfig(inMemoryDevOps, targetUid);
        return inMemoryDevOps;
      }

      // 3. Fallback: check backend server endpoint
      const res = await fetch('/api/devops/config').catch(() => null);
      if (res && res.ok) {
        const srv = await res.json().catch(() => null);
        if (srv && (srv.organization || srv.pat)) {
          const cfg: DevOpsConfig = {
            organization: srv.organization || '',
            project: srv.project || '',
            pat: srv.pat || '',
            isActive: Boolean(srv.isActive),
            defaultIterationPath: srv.defaultIterationPath || ''
          };
          inMemoryDevOps = cfg;
          try {
            localStorage.setItem(DEVOPS_PERSISTENT_KEY, JSON.stringify(cfg));
          } catch {}
          saveLocalCache();
          window.dispatchEvent(new CustomEvent('nexus-devops-config-updated', { detail: cfg }));
          await FirebaseService.saveDevOpsConfig(cfg, targetUid);
          return cfg;
        }
      }
    } catch (e) {
      console.warn('Error during syncDevOpsFromCloud:', e);
    }
    return inMemoryDevOps;
  },

  // --- API Key / Power BI ---
  getApiKey: (): string | null => {
    return inMemoryApiKey;
  },

  saveApiKey: (key: string) => {
    inMemoryApiKey = key;
    saveLocalCache();
    FirebaseService.saveSetting('apiKey', key, currentUserId || undefined).catch(e => console.warn('Firebase saveSetting apiKey error:', e));
  },

  generateApiKey: (): string => {
    const key = 'nx-' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    StorageService.saveApiKey(key);
    return key;
  },

  // --- User Session ---
  getUser: (): User | null => {
    return inMemoryUser;
  },

  updateUser: (updatedUser: User) => {
    inMemoryUser = updatedUser;
    currentUserId = updatedUser.id;
    saveLocalCache();
  },

  logout: () => {
    StorageService.clearAllMemory();
    FirebaseService.logout().catch(e => console.warn('Firebase logout warning:', e));
  },

  // --- Sprints ---
  getSprints: (): Sprint[] => {
    return inMemorySprints;
  },

  setSprintsInMemory: (sprints: Sprint[]) => {
    inMemorySprints = sprints;
    saveLocalCache();
  },

  saveSprints: (sprints: Sprint[]) => {
    inMemorySprints = sprints;
    saveLocalCache();
    BackupService.triggerAutoBackup("Alteração nas Sprints");
    FirebaseService.saveSprints(sprints, currentUserId || undefined).catch(e => console.warn('Firebase saveSprints error:', e));
  },

  // Mass Sprint assignment or removal: async, pre-validated, atomic batch, zero unwanted mutations
  updateTasksSprint: async (
    taskIds: string[], 
    targetSprintId: string | null, 
    actorUser: User,
    options?: {
      allowConcludedSprint?: boolean;
    }
  ): Promise<{ updatedTasks: Task[]; updatedSprints: Sprint[] }> => {
    // 1. Validate actor presence and authentication
    if (!actorUser || !actorUser.id) {
      throw new Error('Operação rejeitada: Usuário não autenticado.');
    }

    // 2. Resolve effective user permissions and status
    const effectiveUser = StorageService.resolveUserMembership(actorUser);
    const isOwner = isOwnerUser(actorUser);
    const isAdmin = isUserAdmin(effectiveUser);
    const permissions = getUserPermissions(effectiveUser);

    if (!isOwner && effectiveUser.status !== 'active') {
      throw new Error(`Operação rejeitada: Usuário ${actorUser.email || actorUser.id} não possui acesso ativo na workspace.`);
    }

    const hasSprintPermission = isAdmin || (Boolean(permissions.canManageSprints) && Boolean(permissions.actions?.edit));
    if (!hasSprintPermission) {
      throw new Error('Operação rejeitada: Permissão insuficiente para gerenciar sprints (requer perfil ADM ou permissão delegada canManageSprints com edição).');
    }

    // 3. Validate taskIds parameter & batch size limits
    if (!Array.isArray(taskIds) || taskIds.length === 0) {
      throw new Error('Nenhuma demanda selecionada para alteração de sprint.');
    }
    if (taskIds.length > 250) {
      throw new Error('Limite de lote excedido: máximo de 250 demandas por operação.');
    }

    // 4. Validate existence of ALL tasks and verify per-record ACL before any write
    const taskIdSet = new Set(taskIds);
    const missingIds: string[] = [];
    const unauthorizedIds: string[] = [];
    const tasksToProcess: Task[] = [];

    for (const id of taskIds) {
      const task = inMemoryTasks.find(t => t.id === id);
      if (!task) {
        missingIds.push(id);
      } else {
        tasksToProcess.push(task);
        if (!isTaskAuthorized(task, effectiveUser)) {
          unauthorizedIds.push(task.id);
        }
      }
    }

    if (missingIds.length > 0) {
      throw new Error(`Operação abortada sem alterações: as seguintes demandas não foram encontradas no workspace: ${missingIds.join(', ')}.`);
    }

    if (unauthorizedIds.length > 0) {
      throw new Error(`Operação abortada sem alterações (zero writes): você não possui autorização para editar as demandas: ${unauthorizedIds.join(', ')}.`);
    }

    // 5. Validate target sprint existence & status
    let targetSprint: Sprint | null = null;
    let targetSprintName = 'Sem sprint';

    if (targetSprintId !== null && targetSprintId !== '__none__') {
      targetSprint = inMemorySprints.find(s => s.id === targetSprintId) || null;
      if (!targetSprint) {
        throw new Error(`Operação abortada sem alterações: a sprint de destino "${targetSprintId}" não foi encontrada no workspace.`);
      }
      targetSprintName = targetSprint.name;

      if (targetSprint.status === 'Concluída' && !options?.allowConcludedSprint) {
        throw new Error(`Operação abortada sem alterações: a sprint "${targetSprint.name}" está com status Concluída e exige confirmação explícita de administrador.`);
      }
    }

    const finalTargetSprintId = (targetSprintId === '__none__' || targetSprintId === null) ? null : targetSprintId;

    // 6. Check for NO-OP: if ALL selected tasks already have the target sprint as canonical, do nothing!
    const tasksActuallyChanging = tasksToProcess.filter(task => {
      const currentCanonical = getTaskSprintId(task, inMemorySprints) || null;
      return currentCanonical !== finalTargetSprintId;
    });

    if (tasksActuallyChanging.length === 0) {
      // 100% complete NO-OP: no cloud writes, no memory mutation, no history pollution!
      return { updatedTasks: inMemoryTasks, updatedSprints: inMemorySprints };
    }

    const nowIso = new Date().toISOString();
    const actorRole = isAdmin ? 'ADM' : 'Colaborador';
    const auditUserName = `${actorUser.name || actorUser.email || 'Usuário'} (${actorRole})`;

    // 7. Prepare atomic task patches and updated in-memory projections (WITHOUT mutating memory yet!)
    const taskPatches: Array<{
      id: string;
      sprintId: string | null;
      historyEntry: HistoryEntry;
    }> = [];

    const updatedTasksProjection = inMemoryTasks.map(task => {
      if (!taskIdSet.has(task.id)) return task;
      const currentCanonical = getTaskSprintId(task, inMemorySprints) || null;
      if (currentCanonical === finalTargetSprintId) return task; // unchanged

      const actionText = finalTargetSprintId 
        ? `Alterou Sprint para "${targetSprintName}"` 
        : 'Removido da Sprint';

      const entry: HistoryEntry = {
        id: 'hist_' + Math.random().toString(36).substring(2, 11),
        date: nowIso,
        user: auditUserName,
        action: actionText
      };

      taskPatches.push({
        id: task.id,
        sprintId: finalTargetSprintId,
        historyEntry: entry
      });

      // Patch sprintId and append history ONLY. Preserve all other fields!
      const updatedTask: Task = {
        ...task,
        sprintId: finalTargetSprintId || undefined,
        history: [...(task.history || []), entry]
      };
      if (finalTargetSprintId === null) {
        updatedTask.sprintId = null as any;
      }

      return updatedTask;
    });

    // 8. Prepare Sprints projection
    // Preserves historical records in previous sprints; adds or retains records in destination sprint
    let updatedSprintsProjection = inMemorySprints;
    let targetSprintPatch: { id: string; tasks: SprintTask[] } | null = null;

    if (finalTargetSprintId && targetSprint) {
      const existingTaskMap = new Map((targetSprint.tasks || []).map(st => [st.taskId, st]));
      const newSprintTasks: SprintTask[] = [...(targetSprint.tasks || [])];

      tasksActuallyChanging.forEach(task => {
        if (!existingTaskMap.has(task.id)) {
          const planned = task.estimatedTime ? parseFloat(task.estimatedTime) || 0 : 0;
          const actual = task.actualTime ? parseFloat(task.actualTime) || 0 : 0;
          const newEntry: SprintTask = {
            taskId: task.id,
            plannedHours: planned,
            actualHours: actual,
            status: task.status || 'Novo'
          };
          newSprintTasks.push(newEntry);
          existingTaskMap.set(task.id, newEntry);
        }
      });

      targetSprintPatch = {
        id: targetSprint.id,
        tasks: newSprintTasks
      };

      updatedSprintsProjection = inMemorySprints.map(s => {
        if (s.id === finalTargetSprintId) {
          return {
            ...s,
            tasks: newSprintTasks
          };
        }
        return s;
      });
    }

    // 9. Commit atomic batch to Firestore Cloud Storage FIRST
    const targetOwnerUid = effectiveUser.workspaceOwnerUid || NEXUS_OWNER_UID;
    await FirebaseService.updateTasksSprintBatch(targetOwnerUid, taskPatches, targetSprintPatch);

    // 10. Only upon confirmed cloud commit: commit to in-memory state and local cache!
    inMemoryTasks = updatedTasksProjection;
    inMemorySprints = updatedSprintsProjection;
    saveLocalCache();
    BackupService.triggerAutoBackup(`Alteração em Massa de Sprints (${taskPatches.length} demandas)`);

    return { updatedTasks: inMemoryTasks, updatedSprints: inMemorySprints };
  },

  // --- Backup & Restore (Full Payload from Database memory) ---
  getFullBackup: () => {
    return {
      TASKS: inMemoryTasks,
      DEVS: inMemoryDevs,
      ROBOTS: inMemoryRobots,
      SPRINTS: inMemorySprints,
      WORKFLOW: inMemoryWorkflow,
      DOCUMENTS: inMemoryDocs,
      DEVOPS_CONFIG: inMemoryDevOps
    };
  },

  restoreBackup: (backup: Record<string, any>) => {
    try {
      if (backup.TASKS && Array.isArray(backup.TASKS)) {
        StorageService.saveTasks(backup.TASKS);
      }
      if (backup.DEVS && Array.isArray(backup.DEVS)) {
        StorageService.saveDevs(backup.DEVS);
      }
      if (backup.ROBOTS && Array.isArray(backup.ROBOTS)) {
        StorageService.saveRobots(backup.ROBOTS);
      }
      if (backup.SPRINTS && Array.isArray(backup.SPRINTS)) {
        StorageService.saveSprints(backup.SPRINTS);
      }
      if (backup.WORKFLOW && Array.isArray(backup.WORKFLOW)) {
        StorageService.saveWorkflowConfig(backup.WORKFLOW);
      }
      if (backup.DOCUMENTS && Array.isArray(backup.DOCUMENTS)) {
        StorageService.saveDocumentsConfig(backup.DOCUMENTS);
      }
      if (backup.DEVOPS_CONFIG && typeof backup.DEVOPS_CONFIG === 'object') {
        StorageService.saveDevOpsConfig(backup.DEVOPS_CONFIG);
      }
      return true;
    } catch (e) {
      console.error("Error restoring backup", e);
      return false;
    }
  },
  
  // Intelligent Merge Logic directly into in-memory store and Firestore
  mergeTasks: (newTasks: Task[]) => {
    const currentTasks = StorageService.getTasks();
    const taskMap = new Map(currentTasks.map(t => [t.id, t]));

    newTasks.forEach(newTask => {
      if (taskMap.has(newTask.id)) {
        const existing = taskMap.get(newTask.id)!;
        
        const mergedTask: Task = {
          ...existing,
          summary: newTask.summary,
          type: normalizeTaskType(newTask.type || existing.type),
          status: normalizeStatus(newTask.status || existing.status), 
          subcategory: newTask.subcategory,
          category: newTask.category || existing.category,
          priority: newTask.priority,
          createdAt: newTask.createdAt,
          requester: newTask.requester,
          assignee: newTask.assignee ? newTask.assignee : existing.assignee,
          
          startDate: existing.startDate,
          endDate: existing.endDate,
          estimatedTime: existing.estimatedTime,
          actualTime: existing.actualTime,
          projectData: existing.projectData,
          projectPath: existing.projectPath,
          automationName: newTask.automationName || existing.automationName,
          fteValue: existing.fteValue,
          managementArea: existing.managementArea,
          blocker: existing.blocker,
          docStatuses: existing.docStatuses,
          subTasks: existing.subTasks
        };

        taskMap.set(newTask.id, mergedTask);
      } else {
        taskMap.set(newTask.id, {
          ...newTask,
          status: normalizeStatus(newTask.status),
          type: normalizeTaskType(newTask.type)
        });
      }
    });

    const merged = Array.from(taskMap.values());
    StorageService.saveTasks(merged);
    return merged;
  },

  // Completely wipe all data across tool and database
  resetEverything: async () => {
    const uid = currentUserId;
    StorageService.clearAllMemory();
    await FirebaseService.resetAllUserData(uid || undefined);
  }
};
