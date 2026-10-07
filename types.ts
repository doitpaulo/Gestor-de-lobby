
export type TaskType = 'Incidente' | 'Melhoria' | 'Nova Automação';
export type Priority = '1 - Crítica' | '2 - Alta' | '3 - Moderada' | '4 - Baixa';
export type Status = 'Novo' | 'Pendente' | 'Em Atendimento' | 'Em Progresso' | 'Resolvido' | 'Fechado' | 'Aguardando' | 'Concluído' | 'Backlog' | 'Cancelado';

export const ALL_STATUSES: Status[] = [
  'Novo',
  'Backlog',
  'Pendente',
  'Em Atendimento',
  'Em Progresso',
  'Resolvido',
  'Fechado',
  'Aguardando',
  'Concluído',
  'Cancelado'
];

export interface HistoryEntry {
  id: string;
  date: string; // ISO String
  user: string;
  action: string;
}

export interface WorkflowPhase {
    id: string;
    name: string;
    statuses: string[];
    activities: string[];
}

export interface ProjectLifecycleData {
    currentPhaseId: string;
    phaseStatus: string;
    completedActivities: string[]; // List of Activity Names/IDs
}

export interface DocumentConfig {
    id: string;
    label: string;
    active: boolean;
}

export interface Task {
  id: string;
  type: TaskType;
  summary: string; // Mapped from 'Descrição resumida'
  description?: string;
  requester?: string; 
  assignee: string | null; // Mapped from 'Atribuído a'
  priority: Priority;
  status: string; // Mapped from 'Estado'
  createdAt: string; // Mapped from 'Criação de'
  category?: string;
  subcategory?: string; // Mapped from 'Subcategoria'
  
  // Local persistence fields (Manual inputs)
  startDate?: string;
  endDate?: string;
  estimatedTime?: string; 
  actualTime?: string;
  manualFields?: string[];
  
  // New Field for Project Path
  projectPath?: string;
  
  // New Field specifically for Automation Name
  automationName?: string;

  // New KPI Fields
  fteValue?: number; // Valor FTE
  managementArea?: string; // Gerencia

  // Blockers
  blocker?: string; // Motivo de bloqueio/pendência

  // Kanban Ordering
  boardPosition?: number;
  
  // Project Lifecycle
  projectData?: ProjectLifecycleData;

  // Esteira Documental
  docStatuses?: Record<string, 'Pendente' | 'Em andamento' | 'Concluído'>;

  // Audit Log
  history?: HistoryEntry[];

  // Sub-tasks
  subTasks?: SubTask[];

  // Azure DevOps Integration fields
  devopsEpicId?: string;
  devopsUserStoryId?: string;
  devopsFeatureId?: string;
}

export interface SubTask {
  id: string;
  title: string;
  assignee: string | null;
  estimatedHours: number;
  actualHours: number;
  status: 'Pendente' | 'Em Andamento' | 'Concluído';
  phase: string;
}

export interface Robot {
    id: string;
    name: string;      // NOME DO ROBÔ
    folder: string;    // PASTA QUE ESTÁ ARMAZENADO
    status: string;    // SITUAÇÃO (ATIVO/DESATIVO)
    developer: string; // DESENVOLVEDOR
    owners: string;    // OWNERS
    area: string;      // ÁREA
    // New fields
    fte?: number;      // FTE
    ticketNumber?: string; // NÚMERO DO CHAMADO
}

export interface SprintTask {
  taskId: string;
  plannedHours: number;
  actualHours: number;
  status: string;
}

export interface Sprint {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: 'Planejada' | 'Em Execução' | 'Concluída';
  tasks: SprintTask[];
  goals?: string;
  notes?: string;
}

export interface Developer {
  id: string;
  name: string;
  email?: string;
}

export interface User {
  id: string;
  email: string;
  name: string;
  password?: string; // Added for auth
  avatar?: string;   // Base64 string for profile picture
}

export interface DevOpsConfig {
  organization: string;
  project: string;
  pat: string;
  isActive: boolean;
}

export interface BackupConfig {
  autoBackupEnabled: boolean;
  backupFolder: string;
  backupOnDataChange: boolean;
  dailyBackupEnabled: boolean;
  maxSnapshotsRetention: number;
  lastDailyBackupDate?: string;
  lastBackupTimestamp?: string;
}

export interface BackupSnapshot {
  id: string;
  timestamp: string;
  dateFormatted: string;
  triggerReason: string;
  dataHash: string;
  stats: {
    tasksCount: number;
    robotsCount: number;
    sprintsCount: number;
    devsCount: number;
    workflowPhasesCount: number;
    documentsCount: number;
  };
  sizeKb: number;
  dataPayload: Record<string, any>;
}

// Helper utilities for status and task type normalization
export const isCancelledStatus = (status?: string | null): boolean => {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return (
    s === 'cancelado' ||
    s === 'cancelada' ||
    s === 'cancelled' ||
    s === 'canceled'
  );
};

export const isDeliveredStatus = (status?: string | null): boolean => {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return (
    s === 'concluído' ||
    s === 'concluido' ||
    s === 'conclído' ||
    s === 'resolvido' ||
    s === 'resolvida' ||
    s === 'fechado' ||
    s === 'fechada' ||
    s === 'encerrado' ||
    s === 'encerrada' ||
    s === 'finalizado' ||
    s === 'finalizada' ||
    s === 'closed' ||
    s === 'resolved' ||
    s === 'completed' ||
    s === 'done'
  );
};

// isCompletedStatus returns true ONLY for delivered/resolved tasks (does NOT include cancelled tasks)
export const isCompletedStatus = (status?: string | null): boolean => {
  return isDeliveredStatus(status);
};

// isTerminalStatus returns true for any finished state (delivered OR cancelled)
export const isTerminalStatus = (status?: string | null): boolean => {
  return isDeliveredStatus(status) || isCancelledStatus(status);
};

// Safe civil date parser & formatter (prevents 1-day timezone offset)
export const formatCivilDate = (dateStr?: string | null, options?: { includeYear?: boolean }): string => {
  if (!dateStr) return '';
  const clean = String(dateStr).split('T')[0].trim();
  const parts = clean.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    if (year.length === 4 && month.length === 2 && day.length === 2) {
      return options?.includeYear ? `${day}/${month}/${year}` : `${day}/${month}`;
    }
  }
  return clean;
};

export const parseCivilDate = (dateStr?: string | null): Date | null => {
  if (!dateStr) return null;
  const clean = String(dateStr).split('T')[0].trim();
  const parts = clean.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    if (!isNaN(year) && !isNaN(month) && !isNaN(day)) {
      return new Date(year, month, day, 12, 0, 0); // Noon local prevents UTC/DST date jumps
    }
  }
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
};

// Safe duration parser (returns strictly positive finite number in hours, never NaN or negative)
export const parseDuration = (timeStr?: string | number | null): number => {
  if (timeStr === undefined || timeStr === null) return 0;
  if (typeof timeStr === 'number') return Math.max(0, isFinite(timeStr) ? timeStr : 0);
  
  const raw = String(timeStr).trim().toLowerCase();
  if (!raw || raw === '0') return 0;
  if (raw.startsWith('-')) return 0;

  // HH:mm format (e.g. "02:30", "1:45", "08:00")
  const timeMatch = raw.match(/^(\d{1,3}):([0-5]\d)$/);
  if (timeMatch) {
    const hours = parseInt(timeMatch[1], 10);
    const mins = parseInt(timeMatch[2], 10);
    return Math.max(0, hours + (mins / 60));
  }

  // Handle format "16h", "2.5h", "2d", "1w", "30m"
  if (raw.endsWith('d') || raw.includes('dia')) {
    const numStr = raw.replace(/[^0-9.]/g, '');
    const days = parseFloat(numStr);
    return Math.max(0, isFinite(days) ? days * 8 : 0);
  }
  if (raw.endsWith('w') || raw.includes('sem')) {
    const numStr = raw.replace(/[^0-9.]/g, '');
    const weeks = parseFloat(numStr);
    return Math.max(0, isFinite(weeks) ? weeks * 40 : 0);
  }
  if ((raw.endsWith('m') || raw.includes('min')) && !raw.includes('h')) {
    const numStr = raw.replace(/[^0-9.]/g, '');
    const mins = parseFloat(numStr);
    return Math.max(0, isFinite(mins) ? mins / 60 : 0);
  }

  // Pure hours or with "h", "hrs", "horas"
  const cleanHoursStr = raw.replace(/h(rs|r|oras?)?$/i, '').trim();
  const numeric = parseFloat(cleanHoursStr);
  return Math.max(0, isFinite(numeric) ? numeric : 0);
};

export const isValidDurationString = (timeStr?: string | number | null): boolean => {
  if (timeStr === undefined || timeStr === null) return true;
  if (typeof timeStr === 'number') return isFinite(timeStr) && timeStr >= 0;

  const clean = String(timeStr).trim().toLowerCase();
  if (!clean || clean === '0') return true; // empty or 0 is allowed

  // Disallow negative values
  if (clean.startsWith('-')) return false;

  // HH:mm clock format, e.g. "02:30", "1:30", "08:00"
  if (/^(\d{1,3}):([0-5]\d)$/.test(clean)) {
    return true;
  }

  // Explicit duration regex:
  // Requires numbers (e.g. "8", "8h", "2.5h", "8 hrs", "2d", "1.5 dias", "1w", "30m", "45min")
  // Rejects arbitrary text like "abc", "10xyz", "test"
  const match = clean.match(/^(\d+(\.\d+)?)\s*(h|hrs|hr|horas?|d|dias?|w|sem|semanas?|m|min|minutos?)?$/);
  if (!match) return false;

  const num = parseFloat(match[1]);
  return isFinite(num) && num >= 0;
};

export const normalizeStatus = (status?: string | null): string => {
  if (!status) return 'Novo';
  const s = status.trim();
  const lower = s.toLowerCase();
  if (lower === 'conclído' || lower === 'concluido' || lower === 'concluído' || lower === 'completed' || lower === 'done') return 'Concluído';
  if (lower === 'fechado' || lower === 'fechada' || lower === 'closed' || lower === 'encerrado' || lower === 'encerrada' || lower === 'finalizado' || lower === 'finalizada') return 'Fechado';
  if (lower === 'resolvido' || lower === 'resolvida' || lower === 'resolved') return 'Resolvido';
  if (lower === 'cancelado' || lower === 'cancelada' || lower === 'cancelled' || lower === 'canceled') return 'Cancelado';
  if (lower === 'em progresso' || lower === 'em andamento' || lower === 'in progress') return 'Em Progresso';
  if (lower === 'em atendimento') return 'Em Atendimento';
  if (lower === 'aguardando' || lower === 'waiting' || lower === 'on hold') return 'Aguardando';
  if (lower === 'pendente' || lower === 'pending') return 'Pendente';
  if (lower === 'backlog') return 'Backlog';
  if (lower === 'novo' || lower === 'new') return 'Novo';
  return s;
};

export const normalizeTaskType = (type?: string | null): TaskType => {
  if (!type) return 'Incidente';
  const s = type.trim().toLowerCase();
  if (s === 'nova automação' || s.includes('auto') || s.includes('rpa') || s.includes('bot')) return 'Nova Automação';
  if (s === 'melhoria' || s.includes('melhoria') || s.includes('feature') || s.includes('enhancement')) return 'Melhoria';
  if (s === 'incidente' || s.includes('incid') || s.includes('bug') || s.includes('defeito') || s.includes('erro')) return 'Incidente';
  return 'Nova Automação';
};

