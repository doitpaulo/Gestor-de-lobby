
export type TaskType = 'Incidente' | 'Melhoria' | 'Nova Automação';
export type Priority = '1 - Crítica' | '2 - Alta' | '3 - Moderada' | '4 - Baixa';
export type Status = 'Novo' | 'Pendente' | 'Em Atendimento' | 'Em Progresso' | 'Resolvido' | 'Fechado' | 'Aguardando' | 'Concluído' | 'Backlog';

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
