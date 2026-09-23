
export type TaskType = 'Incidente' | 'Melhoria' | 'Nova Automação';
export type Priority = '1 - Crítica' | '2 - Alta' | '3 - Moderada' | '4 - Baixa';
export type Status = 'Novo' | 'Pendente' | 'Em Atendimento' | 'Em Progresso' | 'Resolvido' | 'Fechado' | 'Aguardando' | 'Concluído' | 'Backlog';

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
export const isCompletedStatus = (status?: string | null): boolean => {
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
    s === 'cancelado' ||
    s === 'cancelada' ||
    s === 'encerrado' ||
    s === 'encerrada' ||
    s === 'finalizado' ||
    s === 'finalizada' ||
    s === 'closed' ||
    s === 'resolved' ||
    s === 'completed' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'done'
  );
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

