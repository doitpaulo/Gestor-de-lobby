import { StorageService } from './storageService';
import { BackupConfig, BackupSnapshot } from '../types';
import { FirebaseService } from './firebase';

const CONFIG_KEY = 'nexus_backup_config_v1';
const SNAPSHOTS_KEY = 'nexus_backup_snapshots_v1';

const DEFAULT_CONFIG: BackupConfig = {
  autoBackupEnabled: true,
  backupFolder: 'Nexus_AutoBackups',
  backupOnDataChange: true,
  dailyBackupEnabled: true,
  maxSnapshotsRetention: 30,
};

let dirHandleInMemory: any = null;
let snapshotsInMemory: BackupSnapshot[] = [];

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
    return snapshotsInMemory;
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

      // 5. Atomic save to memory history with Retention Limit
      let updatedSnapshots = [newSnapshot, ...snapshots];
      const maxRetention = config.maxSnapshotsRetention || 30;
      if (updatedSnapshots.length > maxRetention) {
        updatedSnapshots = updatedSnapshots.slice(0, maxRetention);
      }

      snapshotsInMemory = updatedSnapshots;

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

      // 8. Write to Firebase Cloud Firestore Backups collection
      FirebaseService.saveCloudBackup(payload, triggerReason).catch(e => {
        console.warn('[BackupService] Cloud backup sync notice:', e);
      });

      // 9. Dispatch notification event
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

  // Export full backup directly to Excel (.xlsx) with all demand columns
  exportBackupToExcel: (): void => {
    const payload = StorageService.getFullBackup();
    import('./excelService').then(({ ExcelService }) => {
      ExcelService.exportBackupExcel(
        payload.TASKS || [],
        payload.ROBOTS || [],
        payload.DEVS || []
      );
    });
  },

  // Parse and recognize Excel spreadsheet as backup snapshot
  importSnapshotFromExcel: async (file: File): Promise<{ 
    success: boolean; 
    snapshot?: BackupSnapshot; 
    stats?: any;
    error?: string; 
  }> => {
    try {
      const { ExcelService } = await import('./excelService');
      const parsedResult = await ExcelService.parseBackupExcel(file);

      if (!parsedResult.tasks || parsedResult.tasks.length === 0) {
        return { 
          success: false, 
          error: 'Nenhuma demanda válida foi encontrada na planilha Excel. Verifique se a planilha possui colunas como ID, Tipo, Resumo ou Status.' 
        };
      }

      const payload = {
        TASKS: parsedResult.tasks,
        DEVS: parsedResult.devs.length > 0 ? parsedResult.devs : StorageService.getDevs(),
        ROBOTS: parsedResult.robots.length > 0 ? parsedResult.robots : StorageService.getRobots(),
        SPRINTS: StorageService.getSprints(),
        WORKFLOW: StorageService.getWorkflowConfig([]),
        DOCUMENTS: StorageService.getDocumentsConfig([]),
        DEVOPS_CONFIG: StorageService.getDevOpsConfig()
      };

      const jsonString = JSON.stringify(payload);
      const dataHash = BackupService.computeHash(jsonString);
      const now = new Date();
      const snapshot: BackupSnapshot = {
        id: `snap-excel-${now.getTime()}`,
        timestamp: now.toISOString(),
        dateFormatted: now.toLocaleString('pt-BR'),
        triggerReason: `Planilha Excel Reconhecida como Backup (${file.name})`,
        dataHash,
        stats: {
          tasksCount: parsedResult.tasks.length,
          robotsCount: parsedResult.robots.length,
          sprintsCount: 0,
          devsCount: parsedResult.devs.length,
          workflowPhasesCount: 0,
          documentsCount: 0
        },
        sizeKb: Math.round((new Blob([jsonString]).size / 1024) * 10) / 10,
        dataPayload: payload
      };

      const snapshots = BackupService.getSnapshots();
      snapshotsInMemory = [snapshot, ...snapshots];

      window.dispatchEvent(new CustomEvent('nexus-auto-backup-completed', { detail: snapshot }));

      return { 
        success: true, 
        snapshot, 
        stats: parsedResult.stats 
      };
    } catch (err: any) {
      console.error("Error importing Excel backup:", err);
      return { 
        success: false, 
        error: `Erro ao processar planilha Excel: ${err.message || 'Arquivo corrompido ou formato incompatível.'}` 
      };
    }
  },

  importSnapshotFromFile: async (file: File): Promise<{ success: boolean; snapshot?: BackupSnapshot; error?: string }> => {
    // Check if uploaded file is an Excel file
    const lowerName = file.name.toLowerCase();
    if (lowerName.endsWith('.xlsx') || lowerName.endsWith('.xls')) {
      const excelRes = await BackupService.importSnapshotFromExcel(file);
      return {
        success: excelRes.success,
        snapshot: excelRes.snapshot,
        error: excelRes.error
      };
    }

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
          snapshotsInMemory = [snapshot, ...snapshots];

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
    snapshotsInMemory = snapshotsInMemory.filter(s => s.id !== snapshotId);
  },

  clearAllSnapshots: (): void => {
    snapshotsInMemory = [];
  }
};
