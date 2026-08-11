import { StorageService } from './storageService';
import { BackupConfig, BackupSnapshot } from '../types';

const CONFIG_KEY = 'nexus_backup_config_v1';
const SNAPSHOTS_KEY = 'nexus_backup_snapshots_v1';

const DEFAULT_CONFIG: BackupConfig = {
  autoBackupEnabled: true,
  backupFolder: 'Nexus_AutoBackups',
  backupOnDataChange: true,
  dailyBackupEnabled: true,
  maxSnapshotsRetention: 30,
};

// Global FileSystemDirectoryHandle reference in memory for current session if granted
let dirHandleInMemory: any = null;

export const BackupService = {
  getDirHandleInMemory: () => dirHandleInMemory,
  setDirHandleInMemory: (handle: any) => { dirHandleInMemory = handle; },

  getConfig: (): BackupConfig => {
    try {
      const data = localStorage.getItem(CONFIG_KEY);
      return data ? { ...DEFAULT_CONFIG, ...JSON.parse(data) } : DEFAULT_CONFIG;
    } catch (e) {
      console.error("Error reading backup config", e);
      return DEFAULT_CONFIG;
    }
  },

  saveConfig: (config: BackupConfig): void => {
    try {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
    } catch (e) {
      console.error("Error saving backup config", e);
    }
  },

  getSnapshots: (): BackupSnapshot[] => {
    try {
      const data = localStorage.getItem(SNAPSHOTS_KEY);
      if (!data) return [];
      const parsed = JSON.parse(data);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      console.error("Error loading backup snapshots", e);
      return [];
    }
  },

  computeHash: (data: any): string => {
    const str = typeof data === 'string' ? data : JSON.stringify(data);
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return hash.toString(16);
  },

  validatePayload: (payload: any): { valid: boolean; error?: string } => {
    if (!payload || typeof payload !== 'object') {
      return { valid: false, error: 'Payload de backup inválido (não é um objeto).' };
    }
    // Check if at least one recognizable key exists
    const recognizedKeys = ['TASKS', 'DEVS', 'WORKFLOW', 'ROBOTS', 'SPRINTS', 'DOCUMENTS', 'DEVOPS_CONFIG', 'REGISTRY'];
    const hasKeys = Object.keys(payload).some(k => recognizedKeys.includes(k));
    if (!hasKeys) {
      return { valid: false, error: 'O payload de backup não contém dados reconhecidos do Nexus Project.' };
    }
    return { valid: true };
  },

  createSnapshot: (triggerReason: string, isManual: boolean = false): BackupSnapshot | null => {
    try {
      const config = BackupService.getConfig();
      if (!isManual && !config.autoBackupEnabled) {
        return null;
      }

      // 1. Get complete payload
      const payload = StorageService.getFullBackup();

      // 2. Integrity Validation
      const validation = BackupService.validatePayload(payload);
      if (!validation.valid) {
        console.error("Backup failed validation:", validation.error);
        return null;
      }

      // 3. Hash computation & Change Detection
      const jsonString = JSON.stringify(payload);
      const dataHash = BackupService.computeHash(jsonString);
      const snapshots = BackupService.getSnapshots();

      // Skip duplicate auto-backups if nothing changed
      if (!isManual && snapshots.length > 0) {
        const latest = snapshots[0];
        if (latest.dataHash === dataHash) {
          // Data is identical to latest snapshot, skip creating redundant copy
          return latest;
        }
      }

      // 4. Calculate Stats & Size
      const tasks = Array.isArray(payload.TASKS) ? payload.TASKS : [];
      const robots = Array.isArray(payload.ROBOTS) ? payload.ROBOTS : [];
      const sprints = Array.isArray(payload.SPRINTS) ? payload.SPRINTS : [];
      const devs = Array.isArray(payload.DEVS) ? payload.DEVS : [];
      const workflow = Array.isArray(payload.WORKFLOW) ? payload.WORKFLOW : [];
      const docs = Array.isArray(payload.DOCUMENTS) ? payload.DOCUMENTS : [];

      const sizeKb = Math.round((new Blob([jsonString]).size / 1024) * 10) / 10;
      const now = new Date();
      const timestamp = now.toISOString();
      const dateFormatted = now.toLocaleString('pt-BR');

      const newSnapshot: BackupSnapshot = {
        id: `snap-${now.getTime()}`,
        timestamp,
        dateFormatted,
        triggerReason,
        dataHash,
        stats: {
          tasksCount: tasks.length,
          robotsCount: robots.length,
          sprintsCount: sprints.length,
          devsCount: devs.length,
          workflowPhasesCount: workflow.length,
          documentsCount: docs.length
        },
        sizeKb,
        dataPayload: payload
      };

      // 5. Atomic save to storage history with Retention Limit
      let updatedSnapshots = [newSnapshot, ...snapshots];
      const maxRetention = config.maxSnapshotsRetention || 30;
      if (updatedSnapshots.length > maxRetention) {
        updatedSnapshots = updatedSnapshots.slice(0, maxRetention);
      }

      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(updatedSnapshots));

      // 6. Update config metadata
      const today = now.toISOString().split('T')[0];
      const updatedConfig: BackupConfig = {
        ...config,
        lastBackupTimestamp: timestamp,
        ...(triggerReason.includes('Diário') ? { lastDailyBackupDate: today } : {})
      };
      BackupService.saveConfig(updatedConfig);

      // 7. Write to Local Directory Handle if available in session
      if (dirHandleInMemory) {
        (async () => {
          try {
            const fileName = `nexus_backup_${now.toISOString().replace(/[:.]/g, '-')}.json`;
            const fileHandle = await dirHandleInMemory.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(JSON.stringify(payload, null, 2));
            await writable.close();
            console.log(`[BackupService] Snapshot gravado na pasta local: ${fileName}`);
          } catch (fileErr) {
            console.warn("[BackupService] Erro ao gravar arquivo na pasta local selecionada:", fileErr);
          }
        })();
      }

      // 8. Dispatch notification event
      window.dispatchEvent(new CustomEvent('nexus-auto-backup-completed', { detail: newSnapshot }));

      return newSnapshot;
    } catch (e) {
      console.error("Critical error in createSnapshot", e);
      return null;
    }
  },

  checkAndRunDailyBackup: (): void => {
    try {
      const config = BackupService.getConfig();
      if (!config.autoBackupEnabled || !config.dailyBackupEnabled) return;

      const today = new Date().toISOString().split('T')[0];
      if (config.lastDailyBackupDate !== today) {
        BackupService.createSnapshot("Backup Diário Automático (Agendado)", false);
      }
    } catch (e) {
      console.error("Error checking daily backup", e);
    }
  },

  // Debounced auto-backup trigger
  autoBackupTimeout: null as any,
  triggerAutoBackup: (reason: string): void => {
    const config = BackupService.getConfig();
    if (!config.autoBackupEnabled || !config.backupOnDataChange) return;

    if (BackupService.autoBackupTimeout) {
      clearTimeout(BackupService.autoBackupTimeout);
    }

    BackupService.autoBackupTimeout = setTimeout(() => {
      BackupService.createSnapshot(reason, false);
    }, 1200); // 1.2s debounce to accumulate rapid edits
  },

  restoreSnapshot: (snapshot: BackupSnapshot): boolean => {
    try {
      // Create a safety snapshot of current state before restoring
      BackupService.createSnapshot("Cópia de Segurança Pré-Restauração", true);

      // Restore data into StorageService
      const success = StorageService.restoreBackup(snapshot.dataPayload);
      if (success) {
        BackupService.createSnapshot(`Restauração efetuada para o ponto: ${snapshot.dateFormatted}`, true);
      }
      return success;
    } catch (e) {
      console.error("Error restoring snapshot", e);
      return false;
    }
  },

  exportSnapshotToFile: (snapshot: BackupSnapshot): void => {
    const jsonStr = JSON.stringify(snapshot.dataPayload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeDate = snapshot.timestamp.split('T')[0];
    link.download = `nexus_backup_${safeDate}_${snapshot.id}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  },

  importSnapshotFromFile: async (file: File): Promise<{ success: boolean; snapshot?: BackupSnapshot; error?: string }> => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const content = ev.target?.result as string;
          const parsed = JSON.parse(content);

          // Support either full payload or wrapped snapshot
          let payload = parsed;
          let triggerReason = `Importação de Arquivo (${file.name})`;
          
          if (parsed.dataPayload && typeof parsed.dataPayload === 'object') {
            payload = parsed.dataPayload;
            if (parsed.triggerReason) triggerReason = `Importado: ${parsed.triggerReason}`;
          }

          const validation = BackupService.validatePayload(payload);
          if (!validation.valid) {
            resolve({ success: false, error: validation.error || 'Arquivo de backup inválido.' });
            return;
          }

          // Generate snapshot from imported data
          const jsonString = JSON.stringify(payload);
          const dataHash = BackupService.computeHash(jsonString);
          const tasks = Array.isArray(payload.TASKS) ? payload.TASKS : [];
          const robots = Array.isArray(payload.ROBOTS) ? payload.ROBOTS : [];
          const sprints = Array.isArray(payload.SPRINTS) ? payload.SPRINTS : [];
          const devs = Array.isArray(payload.DEVS) ? payload.DEVS : [];
          const workflow = Array.isArray(payload.WORKFLOW) ? payload.WORKFLOW : [];
          const docs = Array.isArray(payload.DOCUMENTS) ? payload.DOCUMENTS : [];

          const now = new Date();
          const snapshot: BackupSnapshot = {
            id: `snap-imp-${now.getTime()}`,
            timestamp: now.toISOString(),
            dateFormatted: now.toLocaleString('pt-BR'),
            triggerReason,
            dataHash,
            stats: {
              tasksCount: tasks.length,
              robotsCount: robots.length,
              sprintsCount: sprints.length,
              devsCount: devs.length,
              workflowPhasesCount: workflow.length,
              documentsCount: docs.length
            },
            sizeKb: Math.round((new Blob([jsonString]).size / 1024) * 10) / 10,
            dataPayload: payload
          };

          const snapshots = BackupService.getSnapshots();
          const updated = [snapshot, ...snapshots];
          localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(updated));

          resolve({ success: true, snapshot });
        } catch (err: any) {
          resolve({ success: false, error: 'Falha ao processar o arquivo JSON. Certifique-se de que é um JSON válido.' });
        }
      };
      reader.onerror = () => resolve({ success: false, error: 'Erro ao ler o arquivo.' });
      reader.readAsText(file);
    });
  },

  deleteSnapshot: (snapshotId: string): void => {
    try {
      const snapshots = BackupService.getSnapshots().filter(s => s.id !== snapshotId);
      localStorage.setItem(SNAPSHOTS_KEY, JSON.stringify(snapshots));
    } catch (e) {
      console.error("Error deleting snapshot", e);
    }
  },

  clearAllSnapshots: (): void => {
    try {
      localStorage.removeItem(SNAPSHOTS_KEY);
    } catch (e) {
      console.error("Error clearing snapshots", e);
    }
  }
};
