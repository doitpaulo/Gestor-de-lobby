
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
