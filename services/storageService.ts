
import { Task, Developer, User, WorkflowPhase } from '../types';

const KEYS = {
  TASKS: 'nexus_tasks_v2',
  DEVS: 'nexus_devs_v2',
  USER: 'nexus_user_active', // Active session
  REGISTRY: 'nexus_users_registry', // All registered users
  WORKFLOW: 'nexus_workflow_config_v3'
};

export const StorageService = {
  getTasks: (): Task[] => {
    try {
      const data = localStorage.getItem(KEYS.TASKS);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error("Error loading tasks", e);
      return [];
    }
  },

  saveTasks: (tasks: Task[]) => {
    try {
      localStorage.setItem(KEYS.TASKS, JSON.stringify(tasks));
    } catch (e) {
      console.error("Error saving tasks", e);
    }
  },
  
  clearTasks: () => {
    try {
        localStorage.removeItem(KEYS.TASKS);
    } catch (e) {
        console.error("Error clearing tasks", e);
    }
  },

  getDevs: (): Developer[] => {
    try {
      const data = localStorage.getItem(KEYS.DEVS);
      if (!data) {
          const defaults = [
              { id: '1', name: 'Ana Silva' },
              { id: '2', name: 'Carlos Souza' },
              { id: '3', name: 'Beatriz Costa' }
          ];
          localStorage.setItem(KEYS.DEVS, JSON.stringify(defaults));
          return defaults;
      }
      return JSON.parse(data);
    } catch (e) {
      return [];
    }
  },

  saveDevs: (devs: Developer[]) => {
    localStorage.setItem(KEYS.DEVS, JSON.stringify(devs));
  },

  // --- Workflow Config ---
  getWorkflowConfig: (defaultConfig: WorkflowPhase[]): WorkflowPhase[] => {
      try {
          const data = localStorage.getItem(KEYS.WORKFLOW);
          return data ? JSON.parse(data) : defaultConfig;
      } catch {
          return defaultConfig;
      }
  },

  saveWorkflowConfig: (config: WorkflowPhase[]) => {
      localStorage.setItem(KEYS.WORKFLOW, JSON.stringify(config));
  },

  // --- Authentication Logic ---

  getRegistry: (): User[] => {
    const data = localStorage.getItem(KEYS.REGISTRY);
    return data ? JSON.parse(data) : [];
  },

  registerUser: (user: User): boolean => {
    const registry = StorageService.getRegistry();
    if (registry.find(u => u.email === user.email)) {
      return false; // User already exists
    }
    registry.push(user);
    localStorage.setItem(KEYS.REGISTRY, JSON.stringify(registry));
    return true;
  },

  authenticateUser: (email: string, password: string): User | null => {
    const registry = StorageService.getRegistry();
    const user = registry.find(u => u.email === email && u.password === password);
    if (user) {
      localStorage.setItem(KEYS.USER, JSON.stringify(user));
      return user;
    }
    return null;
  },

  getUser: (): User | null => {
    const data = localStorage.getItem(KEYS.USER);
    return data ? JSON.parse(data) : null;
  },

  logout: () => {
    localStorage.removeItem(KEYS.USER);
  },

  updateUser: (updatedUser: User) => {
    // 1. Update Active Session
    localStorage.setItem(KEYS.USER, JSON.stringify(updatedUser));

    // 2. Update Registry
    const registry = StorageService.getRegistry();
    const index = registry.findIndex(u => u.id === updatedUser.id);
    if (index !== -1) {
      registry[index] = updatedUser;
      localStorage.setItem(KEYS.REGISTRY, JSON.stringify(registry));
    }
  },
  
  // Intelligent Merge Logic
  mergeTasks: (newTasks: Task[]) => {
    const currentTasks = StorageService.getTasks();
    const taskMap = new Map(currentTasks.map(t => [t.id, t]));

    newTasks.forEach(newTask => {
      if (taskMap.has(newTask.id)) {
        const existing = taskMap.get(newTask.id)!;
        
        const mergedTask: Task = {
          ...existing,
          summary: newTask.summary,
          type: newTask.type,
          status: newTask.status, 
          subcategory: newTask.subcategory,
          category: newTask.category || existing.category,
          priority: newTask.priority,
          createdAt: newTask.createdAt,
          requester: newTask.requester,
          assignee: newTask.assignee ? newTask.assignee : existing.assignee,
          
          // STRICTLY PRESERVE LOCAL FIELDS
          startDate: existing.startDate,
          endDate: existing.endDate,
          estimatedTime: existing.estimatedTime,
          actualTime: existing.actualTime,
          projectData: existing.projectData, // Preserve project lifecycle
          projectPath: existing.projectPath, // Preserve project path
          automationName: newTask.automationName || existing.automationName // Preserve automation name
        };

        taskMap.set(newTask.id, mergedTask);
      } else {
        taskMap.set(newTask.id, newTask);
      }
    });

    const merged = Array.from(taskMap.values());
    StorageService.saveTasks(merged);
    return merged;
  }
};