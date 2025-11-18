import { Task, Developer, User } from '../types';

const KEYS = {
  TASKS: 'nexus_tasks_v2',
  DEVS: 'nexus_devs_v2',
  USER: 'nexus_user_v2'
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

  getUser: (): User | null => {
    const data = localStorage.getItem(KEYS.USER);
    return data ? JSON.parse(data) : null;
  },

  login: (email: string): User => {
    const user: User = { id: Date.now().toString(), email, name: email.split('@')[0] };
    localStorage.setItem(KEYS.USER, JSON.stringify(user));
    return user;
  },

  logout: () => {
    localStorage.removeItem(KEYS.USER);
  },
  
  // Intelligent Merge Logic (The Core Requirement)
  mergeTasks: (newTasks: Task[]) => {
    const currentTasks = StorageService.getTasks();
    const taskMap = new Map(currentTasks.map(t => [t.id, t]));

    newTasks.forEach(newTask => {
      if (taskMap.has(newTask.id)) {
        const existing = taskMap.get(newTask.id)!;
        
        // LOGIC:
        // 1. Update basic fields from Excel (Summary, Status, Subcategory, etc.) because Excel is the source of truth for tickets.
        // 2. PRESERVE internal fields that only exist in the App (Dates, Times).
        // 3. Assignee Logic: If Excel has a value, use it. If Excel is empty, KEEP the existing assignee (don't unassign if manually assigned).
        
        const mergedTask: Task = {
          ...existing, // Base is existing to keep props not in Excel
          
          // Overwrite with Excel data
          summary: newTask.summary,
          type: newTask.type, // Keep Excel type categorization
          status: newTask.status, 
          subcategory: newTask.subcategory,
          category: newTask.category || existing.category,
          priority: newTask.priority, // Assuming Excel priority is up to date
          createdAt: newTask.createdAt,
          requester: newTask.requester,

          // Assignee logic: Use Excel if present, otherwise keep existing
          assignee: newTask.assignee ? newTask.assignee : existing.assignee,
          
          // STRICTLY PRESERVE LOCAL FIELDS (These are never in the simple Excel import)
          startDate: existing.startDate,
          endDate: existing.endDate,
          estimatedTime: existing.estimatedTime,
          actualTime: existing.actualTime,
        };

        taskMap.set(newTask.id, mergedTask);
      } else {
        // New task entirely
        taskMap.set(newTask.id, newTask);
      }
    });

    const merged = Array.from(taskMap.values());
    StorageService.saveTasks(merged);
    return merged;
  }
};