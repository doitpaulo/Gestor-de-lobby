import { Task, Developer, User, WorkflowPhase, Robot, DocumentConfig, Sprint, DevOpsConfig, normalizeStatus, normalizeTaskType } from '../types';
import { BackupService } from './backupService';
import { FirebaseService } from './firebase';

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
const WORKSPACE_CACHE_KEY = 'nexus_workspace_cache_v3';

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
      apiKey: inMemoryApiKey
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
let inMemoryRobots: Robot[] = initialCache?.robots || [];
let inMemorySprints: Sprint[] = initialCache?.sprints || [];
let inMemoryWorkflow: WorkflowPhase[] = initialCache?.workflow || [];
let inMemoryDocs: DocumentConfig[] = initialCache?.docs || [];
let inMemoryDevOps: DevOpsConfig = initialCache?.devops || { organization: '', project: '', pat: '', isActive: false };
let inMemoryUser: User | null = initialCache?.user || null;
let inMemoryApiKey: string | null = initialCache?.apiKey || null;

export const StorageService = {
  setCurrentUserId: (uid: string | null) => {
    currentUserId = uid;
  },

  getCurrentUserId: () => currentUserId,

  // Reset all state in memory to clean zero slate
  clearAllMemory: () => {
    currentUserId = null;
    inMemoryTasks = [];
    inMemoryDevs = [];
    inMemoryRobots = [];
    inMemorySprints = [];
    inMemoryWorkflow = [];
    inMemoryDocs = [];
    inMemoryDevOps = { organization: '', project: '', pat: '', isActive: false };
    inMemoryUser = null;
    inMemoryApiKey = null;
    try {
      localStorage.removeItem(WORKSPACE_CACHE_KEY);
    } catch {}
  },

  // --- Tasks ---
  getTasks: (): Task[] => {
    return inMemoryTasks;
  },

  setTasksInMemory: (tasks: Task[]) => {
    inMemoryTasks = tasks.map(t => ({
      ...t,
      status: normalizeStatus(t.status),
      type: normalizeTaskType(t.type)
    }));
    saveLocalCache();
  },

  saveTasks: (tasks: Task[]) => {
    const sanitized = tasks.map(t => ({
      ...t,
      status: normalizeStatus(t.status),
      type: normalizeTaskType(t.type)
    }));
    inMemoryTasks = sanitized;
    saveLocalCache();
    BackupService.triggerAutoBackup("Alteração em Demandas / Tarefas");
    FirebaseService.saveTasksBatch(sanitized, currentUserId || undefined).catch(e => console.warn('Firebase saveTasksBatch error:', e));
  },
  
  clearTasks: () => {
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
    return inMemoryWorkflow.length > 0 ? inMemoryWorkflow : defaultConfig;
  },

  setWorkflowConfigInMemory: (config: WorkflowPhase[]) => {
    inMemoryWorkflow = config;
    saveLocalCache();
  },

  saveWorkflowConfig: (config: WorkflowPhase[]) => {
    inMemoryWorkflow = config;
    saveLocalCache();
    BackupService.triggerAutoBackup("Alteração nas Fases de Projetos / Workflow");
    FirebaseService.saveSetting('workflow', config, currentUserId || undefined).catch(e => console.warn('Firebase saveSetting workflow error:', e));
  },

  // --- Documents Config ---
  getDocumentsConfig: (defaults: DocumentConfig[]): DocumentConfig[] => {
    return inMemoryDocs.length > 0 ? inMemoryDocs : defaults;
  },

  setDocumentsConfigInMemory: (config: DocumentConfig[]) => {
    inMemoryDocs = config;
    saveLocalCache();
  },

  saveDocumentsConfig: (config: DocumentConfig[]) => {
    inMemoryDocs = config;
    saveLocalCache();
    BackupService.triggerAutoBackup("Alteração nos Documentos da Esteira");
    FirebaseService.saveSetting('documents', config, currentUserId || undefined).catch(e => console.warn('Firebase saveSetting documents error:', e));
  },

  // --- Azure DevOps Configuration ---
  getDevOpsConfig: (): DevOpsConfig => {
    return inMemoryDevOps;
  },

  setDevOpsConfigInMemory: (config: DevOpsConfig) => {
    inMemoryDevOps = config;
    saveLocalCache();
  },

  saveDevOpsConfig: (config: DevOpsConfig) => {
    inMemoryDevOps = config;
    saveLocalCache();
    BackupService.triggerAutoBackup("Alteração nas Configurações do Azure DevOps");
    FirebaseService.saveSetting('devops', config, currentUserId || undefined).catch(e => console.warn('Firebase saveSetting devops error:', e));
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
