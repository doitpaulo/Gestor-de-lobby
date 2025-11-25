
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, LabelList, ComposedChart, Line 
} from 'recharts';
import * as XLSX from 'xlsx';
import pptxgen from 'pptxgenjs';
import { StorageService } from './services/storageService';
import { ExcelService } from './services/excelService';
import { Task, Developer, User, TaskType, Priority, HistoryEntry, WorkflowPhase } from './types';
import { IconHome, IconKanban, IconList, IconUpload, IconDownload, IconUsers, IconClock, IconChevronLeft, IconPlus, IconProject, IconCheck } from './components/Icons';

// --- Constants ---
const TASK_TYPES = ['Incidente', 'Melhoria', 'Nova Automação'];
const PRIORITIES = ['1 - Crítica', '2 - Alta', '3 - Moderada', '4 - Baixa'];
const STATUSES = ['Novo', 'Pendente', 'Em Atendimento', 'Em Progresso', 'Resolvido', 'Fechado', 'Aguardando', 'Concluído', 'Backlog'];

const DEFAULT_WORKFLOW: WorkflowPhase[] = [
    {
        id: '1',
        name: 'Avaliação',
        statuses: ['Não Iniciado', 'Concluído', 'Aguardando Aprovação CoE', 'Em Andamento', 'Despriorizado pelo CoE', 'Cancelado'],
        activities: ['Validar Business Case', 'Criar Business Case']
    },
    {
        id: '2',
        name: 'Fluxograma',
        statuses: ['Não Iniciado', 'Concluído', 'Em Andamento'],
        activities: ['Criar Desenho AS-IS', 'Validar Desenho AS-IS', 'Criar Desenho TO-BE', 'Validar Desenho TO-BE']
    },
    {
        id: '3',
        name: 'Especificação',
        statuses: ['Não Iniciado', 'Concluído'],
        activities: ['Criar PDD/BA', 'Validar PDD/BA + DEV', 'Criar DoR/BA', 'Validar DoR/BA + DEV', 'Criar SDD/DEV', 'Validar SDD/DEV']
    },
    {
        id: '4',
        name: 'Desenvolvimento',
        statuses: ['Não Iniciado', 'Concluído'],
        activities: ['Criar DoD – BA', 'Validar DoD – BA / DEV / Senior DEV', 'Criar Plano de Teste QA/DEV']
    },
    {
        id: '5',
        name: 'QA / Homolog / Prod',
        statuses: ['Não Iniciado', 'Concluído'],
        activities: ['Executar QA', 'Executar Homologação', 'Executar Produção', 'Monitorar Primeiras Execuções', 'Validar QA / Homologação / Produção']
    }
];

// --- Helper: Time Parser ---
const parseDuration = (durationStr: string | undefined): number => {
    if (!durationStr) return 0;
    const str = durationStr.toLowerCase().replace(/\s/g, '');
    
    // Handle '2h 30m' format if simple concatenation
    if (str.includes('h') && str.includes('m')) {
        const parts = str.split('h');
        const h = parseFloat(parts[0]) || 0;
        const m = parseFloat(parts[1].replace('m', '')) || 0;
        return h + (m / 60);
    }

    if (str.includes('h')) return parseFloat(str.replace('h', '')) || 0;
    if (str.includes('m')) return (parseFloat(str.replace('m', '')) || 0) / 60;
    
    // Default assume hours if just a number
    const val = parseFloat(str);
    return isNaN(val) ? 0 : val;
};

const formatDuration = (hours: number): string => {
    if (hours === 0) return "0h";
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h > 0 && m > 0) return `${h}h ${m}m`;
    if (h > 0) return `${h}h`;
    return `${m}m`;
};

// --- Helper: Dev Workload Calculator ---
const getDevWorkload = (devName: string, tasks: Task[], excludeTaskId?: string): number => {
    if (!devName) return 0;
    return tasks
        .filter(t => 
            t.assignee === devName && 
            t.id !== excludeTaskId && 
            !['Concluído', 'Resolvido', 'Fechado'].includes(t.status)
        )
        .reduce((acc, t) => acc + parseDuration(t.estimatedTime), 0);
};

// --- Components Helpers ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, type = 'button', title='' }: any) => {
  const baseClass = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md justify-center text-sm";
  const variants: any = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/30",
    secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
    danger: "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/30",
    success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/30"
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${baseClass} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Card = ({ children, className = '' }: any) => (
  <div className={`bg-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6 shadow-xl ${className}`}>
    {children}
  </div>
);

const Badge = ({ type, className='' }: { type: string, className?: string }) => {
  let color = "bg-slate-700 text-slate-300 border-slate-600";
  if (type === 'Incidente') color = "bg-rose-500/10 text-rose-400 border-rose-500/20";
  if (type === 'Melhoria') color = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
  if (type === 'Nova Automação') color = "bg-indigo-500/10 text-indigo-400 border-indigo-500/20";
  if (type === '1 - Crítica') color = "bg-red-600 text-white border-red-600";
  if (type === '2 - Alta') color = "bg-orange-500 text-white border-orange-500";
  if (type === '3 - Moderada') color = "bg-yellow-500 text-black border-yellow-500";
  if (type === '4 - Baixa') color = "bg-blue-500 text-white border-blue-500";
  
  return <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${color} ${className}`}>{type}</span>;
};

// --- MultiSelect Component ---

const MultiSelect = ({ label, options, selected, onChange, placeholder }: { label?: string, options: string[], selected: string[], onChange: (val: string[]) => void, placeholder: string }) => {
    const [isOpen, setIsOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleOption = (option: string) => {
        if (selected.includes(option)) {
            onChange(selected.filter(s => s !== option));
        } else {
            onChange([...selected, option]);
        }
    };

    const toggleAll = () => {
        if (selected.length === options.length) {
            onChange([]);
        } else {
            onChange([...options]);
        }
    };

    return (
        <div className="relative w-full md:w-auto min-w-[160px]" ref={containerRef}>
            {label && <label className="block text-xs text-slate-400 mb-1">{label}</label>}
            <div 
                onClick={() => setIsOpen(!isOpen)} 
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 cursor-pointer flex justify-between items-center hover:border-slate-500 transition-colors"
            >
                <span className="truncate max-w-[140px]">
                    {selected.length === 0 ? placeholder : selected.length === options.length ? `Todos (${options.length})` : `${selected.length} selecionados`}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                </svg>
            </div>
            {isOpen && (
                <div className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-600 rounded-lg shadow-2xl z-50 max-h-60 overflow-y-auto custom-scrollbar p-2">
                    <div 
                        onClick={toggleAll}
                        className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700 rounded cursor-pointer border-b border-slate-700 mb-1 pb-2"
                    >
                         <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.length === options.length ? 'bg-indigo-600 border-indigo-600' : 'border-slate-500'}`}>
                             {selected.length === options.length && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                         </div>
                         <span className="text-xs font-bold text-slate-300">Selecionar Todos</span>
                    </div>
                    {options.map(opt => (
                        <div 
                            key={opt} 
                            onClick={() => toggleOption(opt)}
                            className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700 rounded cursor-pointer"
                        >
                            <div className={`w-4 h-4 rounded border flex items-center justify-center ${selected.includes(opt) ? 'bg-indigo-600 border-indigo-600' : 'border-slate-500'}`}>
                                {selected.includes(opt) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                            </div>
                            <span className="text-sm text-slate-300">{opt}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
};

// --- Filter Component ---

const FilterBar = ({ filters, setFilters, devs }: { filters: any, setFilters: any, devs?: Developer[] }) => {
  const handleChange = (key: string, value: any) => {
    setFilters((prev: any) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col xl:flex-row gap-3 bg-slate-800 p-3 rounded-xl border border-slate-700 mb-4 items-start xl:items-center">
       <div className="flex-1 w-full xl:w-auto relative">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input 
            type="text" 
            placeholder="Buscar (ID, Resumo, Solicitante)..." 
            className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none"
            value={filters.search}
            onChange={(e) => handleChange('search', e.target.value)}
          />
       </div>
       
       <div className="flex flex-wrap gap-2 w-full xl:w-auto">
           <MultiSelect 
               placeholder="Tipos"
               options={TASK_TYPES}
               selected={filters.type}
               onChange={(val) => handleChange('type', val)}
           />
           
           <MultiSelect 
               placeholder="Prioridades"
               options={PRIORITIES}
               selected={filters.priority}
               onChange={(val) => handleChange('priority', val)}
           />

           {filters.status !== undefined && (
               <MultiSelect 
                   placeholder="Status"
                   options={STATUSES}
                   selected={filters.status}
                   onChange={(val) => handleChange('status', val)}
               />
           )}
           
           {devs && (
               <MultiSelect 
                   placeholder="Desenvolvedores"
                   options={['Não Atribuído', ...devs.map(d => d.name)]}
                   selected={filters.assignee}
                   onChange={(val) => handleChange('assignee', val)}
               />
           )}
       </div>
    </div>
  )
};

// --- Helper: Detect Changes ---

const detectChanges = (original: Task, updated: Task, user: User): HistoryEntry[] => {
    const changes: HistoryEntry[] = [];
    const timestamp = new Date().toISOString();

    if (original.status !== updated.status) {
        changes.push({
            id: Math.random().toString(36).substr(2, 9),
            date: timestamp,
            user: user.name,
            action: `Alterou Status de '${original.status}' para '${updated.status}'`
        });
    }

    if (original.priority !== updated.priority) {
        changes.push({
            id: Math.random().toString(36).substr(2, 9),
            date: timestamp,
            user: user.name,
            action: `Alterou Prioridade de '${original.priority}' para '${updated.priority}'`
        });
    }

    if (original.assignee !== updated.assignee) {
        const oldAssignee = original.assignee || 'Sem atribuição';
        const newAssignee = updated.assignee || 'Sem atribuição';
        changes.push({
            id: Math.random().toString(36).substr(2, 9),
            date: timestamp,
            user: user.name,
            action: `Alterou Responsável de '${oldAssignee}' para '${newAssignee}'`
        });
    }
    
    // Detect Phase Change
    if (original.projectData?.currentPhaseId !== updated.projectData?.currentPhaseId) {
         changes.push({
            id: Math.random().toString(36).substr(2, 9),
            date: timestamp,
            user: user.name,
            action: `Alterou fase do projeto`
        });
    }
    
    // Check for generic text changes
    const textFields = ['summary', 'requester', 'estimatedTime', 'actualTime', 'startDate', 'endDate', 'category', 'subcategory', 'type'];
    const hasTextChanged = textFields.some(field => (original as any)[field] !== (updated as any)[field]);
    
    if (hasTextChanged && changes.length === 0) { 
         changes.push({
            id: Math.random().toString(36).substr(2, 9),
            date: timestamp,
            user: user.name,
            action: `Editou detalhes da tarefa`
        });
    }

    return changes;
};

// --- Project Lifecycle Flow View ---

const ProjectFlowView = ({ tasks, setTasks, devs, onEditTask, user, workflowConfig, setWorkflowConfig }: { tasks: Task[], setTasks: any, devs: Developer[], onEditTask: (t: Task) => void, user: User, workflowConfig: WorkflowPhase[], setWorkflowConfig: any }) => {
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], status: string[], assignee: string[]}>({ 
        search: '', 
        type: [], 
        priority: [], 
        status: [], 
        assignee: [] 
    });
    
    // Filter only Automations and Improvements AND apply filters
    const filteredTasks = useMemo(() => {
        return tasks.filter(t => {
            const isProjectType = t.type === 'Melhoria' || t.type === 'Nova Automação';
            if (!isProjectType) return false;

            const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) ||
                                  t.id.toLowerCase().includes(filters.search.toLowerCase()) ||
                                  (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
            
            const matchesType = filters.type.length === 0 || filters.type.includes(t.type);
            const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
            const matchesStatus = filters.status.length === 0 || filters.status.includes(t.status);
            
            let matchesAssignee = true;
            if (filters.assignee.length > 0) {
                const hasUnassigned = filters.assignee.includes('Não Atribuído');
                if (hasUnassigned) {
                    matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee);
                } else {
                    matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee);
                }
            }

            return matchesSearch && matchesType && matchesPriority && matchesStatus && matchesAssignee;
        });
    }, [tasks, filters]);

    const handlePhaseUpdate = (taskId: string, phaseId: string, status: string) => {
        const updated = tasks.map(t => {
            if (t.id === taskId) {
                const currentData = t.projectData || { currentPhaseId: '1', phaseStatus: 'Não Iniciado', completedActivities: [] };
                
                t.projectData = {
                    ...currentData,
                    currentPhaseId: phaseId,
                    phaseStatus: status
                };
                
                 const entry: HistoryEntry = {
                    id: Math.random().toString(36).substr(2, 9),
                    date: new Date().toISOString(),
                    user: user.name,
                    action: `Atualizou status da fase para ${status}`
                };
                t.history = [...(t.history || []), entry];
            }
            return t;
        });
        setTasks(updated);
        StorageService.saveTasks(updated);
    };

    const handleChangePhase = (taskId: string, direction: number) => {
        const updated = tasks.map(t => {
            if (t.id === taskId) {
                const currentPhaseId = t.projectData?.currentPhaseId || '1';
                const currentIndex = workflowConfig.findIndex(w => w.id === currentPhaseId);
                const newIndex = currentIndex + direction;

                if (newIndex >= 0 && newIndex < workflowConfig.length) {
                    const newPhase = workflowConfig[newIndex];
                    t.projectData = {
                        ...t.projectData!,
                        currentPhaseId: newPhase.id,
                        phaseStatus: newPhase.statuses[0] // Default to first status (e.g., Not Started)
                    };
                    const entry: HistoryEntry = {
                        id: Math.random().toString(36).substr(2, 9),
                        date: new Date().toISOString(),
                        user: user.name,
                        action: `Alterou fase do projeto para ${newPhase.name}`
                    };
                    t.history = [...(t.history || []), entry];
                }
            }
            return t;
        });
        setTasks(updated);
        StorageService.saveTasks(updated);
    }

    const handleAddPhase = (newPhase: WorkflowPhase) => {
        const updated = [...workflowConfig, newPhase];
        setWorkflowConfig(updated);
        StorageService.saveWorkflowConfig(updated);
        setIsConfigOpen(false);
    }

    return (
        <div className="h-full flex flex-col space-y-4">
            <div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div>
                     <h2 className="text-xl font-bold text-white">Fluxo de Projetos</h2>
                     <p className="text-sm text-slate-400">Acompanhamento detalhado das fases de Melhorias e Automações</p>
                </div>
                <Button variant="secondary" onClick={() => setIsConfigOpen(true)}>
                    <IconPlus className="w-4 h-4" /> Configurar Fases
                </Button>
            </div>
            
            <FilterBar filters={filters} setFilters={setFilters} devs={devs} />

            <div className="flex-1 overflow-auto bg-slate-900/50 rounded-xl border border-slate-700 p-4 custom-scrollbar">
                <table className="w-full text-left text-sm border-separate border-spacing-y-2">
                    <thead>
                        <tr className="text-slate-400 font-medium text-xs uppercase tracking-wider">
                            <th className="pb-2 pl-2">Projeto</th>
                            {workflowConfig.map(phase => (
                                <th key={phase.id} className="pb-2 px-2 text-center">{phase.name}</th>
                            ))}
                            <th className="pb-2 text-center">% Conclusão</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredTasks.map(task => {
                             const currentPhaseIndex = workflowConfig.findIndex(w => w.id === (task.projectData?.currentPhaseId || '1'));
                             const progress = Math.round(((currentPhaseIndex) / workflowConfig.length) * 100);

                             return (
                                 <tr key={task.id} className="bg-slate-800 hover:bg-slate-700/50 transition-colors group">
                                     <td className="p-3 rounded-l-lg border-l-4 border-l-indigo-500 cursor-pointer" onClick={() => onEditTask(task)}>
                                         <div className="flex flex-col gap-1">
                                             <div className="flex items-center gap-2">
                                                 <span className="font-mono text-xs text-slate-500">{task.id}</span>
                                                 <Badge type={task.type} />
                                             </div>
                                             <span className="font-medium text-white truncate max-w-[200px]" title={task.summary}>{task.summary}</span>
                                             <span className="text-xs text-slate-400">{task.assignee || 'Sem Dev'}</span>
                                         </div>
                                     </td>
                                     {workflowConfig.map((phase, idx) => {
                                         const isActive = (task.projectData?.currentPhaseId || '1') === phase.id;
                                         const isPast = idx < currentPhaseIndex;
                                         const phaseStatus = isActive ? (task.projectData?.phaseStatus || 'Não Iniciado') : isPast ? 'Concluído' : 'Não Iniciado';
                                         
                                         let bgClass = "bg-slate-900/50 border-slate-700";
                                         let textClass = "text-slate-500";
                                         
                                         if (isPast) {
                                             bgClass = "bg-emerald-900/20 border-emerald-500/30";
                                             textClass = "text-emerald-500";
                                         } else if (isActive) {
                                             bgClass = "bg-indigo-900/20 border-indigo-500/50 shadow-[0_0_10px_rgba(99,102,241,0.2)]";
                                             textClass = "text-indigo-400 font-bold";
                                         }

                                         // Determine status color
                                         let statusColor = "text-slate-400";
                                         if (phaseStatus === 'Concluído' || phaseStatus === 'Completed') statusColor = "text-emerald-400";
                                         if (phaseStatus === 'Em Andamento' || phaseStatus === 'In Progress') statusColor = "text-indigo-400";
                                         if (phaseStatus === 'Cancelado' || phaseStatus === 'Canceled') statusColor = "text-rose-400";
                                         if (phaseStatus.includes('Despriorizado')) statusColor = "text-orange-400";

                                         return (
                                             <td key={phase.id} className={`p-2 border-y first:border-l last:border-r border-slate-700/50 text-center relative`}>
                                                 <div className={`w-full h-full p-2 rounded flex flex-col items-center justify-center border ${bgClass} min-h-[80px]`}>
                                                      <span className={`text-[10px] uppercase mb-1 ${statusColor}`}>{phaseStatus}</span>
                                                      {isActive && (
                                                          <>
                                                            <select 
                                                                className="bg-slate-900 text-xs border border-slate-600 rounded px-1 py-0.5 max-w-[120px] outline-none mb-2"
                                                                value={phaseStatus}
                                                                onChange={(e) => handlePhaseUpdate(task.id, phase.id, e.target.value)}
                                                                onClick={(e) => e.stopPropagation()}
                                                            >
                                                                {phase.statuses.map(s => <option key={s} value={s}>{s}</option>)}
                                                            </select>
                                                            <div className="flex gap-2">
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); handleChangePhase(task.id, -1); }}
                                                                    disabled={currentPhaseIndex === 0}
                                                                    className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                                                                    title="Fase Anterior"
                                                                >
                                                                    &lt;
                                                                </button>
                                                                <button 
                                                                    onClick={(e) => { e.stopPropagation(); handleChangePhase(task.id, 1); }}
                                                                    disabled={currentPhaseIndex === workflowConfig.length - 1}
                                                                    className="w-5 h-5 flex items-center justify-center rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-xs text-white"
                                                                    title="Próxima Fase"
                                                                >
                                                                    &gt;
                                                                </button>
                                                            </div>
                                                          </>
                                                      )}
                                                      {isPast && <IconCheck className="w-4 h-4 text-emerald-500 mt-1" />}
                                                 </div>
                                                 {/* Connector Line */}
                                                 {idx < workflowConfig.length - 1 && (
                                                     <div className="absolute top-1/2 right-0 w-full h-[1px] bg-slate-700 -z-10 translate-x-[50%] hidden"></div>
                                                 )}
                                             </td>
                                         )
                                     })}
                                     <td className="p-3 rounded-r-lg text-center">
                                         <div className="flex items-center justify-center gap-2">
                                             <div className="w-10 h-1 bg-slate-700 rounded-full overflow-hidden">
                                                 <div className="h-full bg-emerald-500" style={{ width: `${progress}%` }}></div>
                                             </div>
                                             <span className="text-xs font-bold text-slate-300">{progress}%</span>
                                         </div>
                                     </td>
                                 </tr>
                             )
                        })}
                    </tbody>
                </table>
                {filteredTasks.length === 0 && (
                    <div className="p-10 text-center text-slate-500">
                        Nenhum projeto encontrado com os filtros atuais.
                    </div>
                )}
            </div>

            {/* Workflow Config Modal */}
            {isConfigOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
                    <WorkflowEditor currentConfig={workflowConfig} onSave={handleAddPhase} onClose={() => setIsConfigOpen(false)} />
                </div>
            )}
        </div>
    )
};

const WorkflowEditor = ({ currentConfig, onSave, onClose }: any) => {
    const [name, setName] = useState('');
    const [statuses, setStatuses] = useState('Não Iniciado, Concluído');
    const [activities, setActivities] = useState('');

    const handleSubmit = () => {
        if (!name) return;
        const newPhase: WorkflowPhase = {
            id: `ph-${Date.now()}`,
            name,
            statuses: statuses.split(',').map(s => s.trim()).filter(Boolean),
            activities: activities.split(',').map(a => a.trim()).filter(Boolean)
        };
        onSave(newPhase);
    };

    return (
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 max-w-md w-full">
            <h3 className="text-lg font-bold mb-4 text-white">Adicionar Nova Fase</h3>
            <div className="space-y-4">
                <div>
                    <label className="block text-xs text-slate-400 mb-1">Nome da Fase</label>
                    <input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Validação Final" />
                </div>
                <div>
                    <label className="block text-xs text-slate-400 mb-1">Status Possíveis (separados por vírgula)</label>
                    <input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" value={statuses} onChange={e => setStatuses(e.target.value)} />
                </div>
                <div>
                    <label className="block text-xs text-slate-400 mb-1">Atividades (separadas por vírgula)</label>
                    <textarea className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white" value={activities} onChange={e => setActivities(e.target.value)} rows={3} />
                </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
                <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                <Button onClick={handleSubmit}>Adicionar</Button>
            </div>
        </div>
    );
};

// --- User Profile View ---

const UserProfile = ({ user, setUser, onResetData }: { user: User, setUser: (u: User) => void, onResetData: () => void }) => {
  const [formData, setFormData] = useState({
    name: user.name,
    email: user.email,
    password: user.password || '',
    newPassword: ''
  });
  const [avatar, setAvatar] = useState<string | undefined>(user.avatar);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatar(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const updatedUser: User = {
      ...user,
      name: formData.name,
      email: formData.email,
      avatar: avatar,
      password: formData.newPassword ? formData.newPassword : user.password
    };

    StorageService.updateUser(updatedUser);
    setUser(updatedUser);
    alert('Perfil atualizado com sucesso!');
  };

  const handleReset = () => {
      if (window.confirm("ATENÇÃO: Isso apagará TODAS as demandas cadastradas (incidentes, melhorias, automações). Essa ação é irreversível. Deseja continuar?")) {
          onResetData();
      }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in pb-10">
      <h2 className="text-2xl font-bold text-white mb-6">Gerenciar Perfil</h2>
      
      <Card>
        <div className="flex flex-col items-center mb-8">
          <div className="relative group cursor-pointer" onClick={() => fileInputRef.current?.click()}>
            <div className="w-32 h-32 rounded-full bg-slate-700 flex items-center justify-center text-4xl text-indigo-300 overflow-hidden border-4 border-slate-600 group-hover:border-indigo-500 transition-all">
               {avatar ? (
                 <img src={avatar} alt="Avatar" className="w-full h-full object-cover" />
               ) : (
                 user.name.substring(0, 2).toUpperCase()
               )}
            </div>
            <div className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
               <span className="text-xs text-white font-medium">Alterar Foto</span>
            </div>
            <input type="file" ref={fileInputRef} className="hidden" accept="image/*" onChange={handleFileChange} />
          </div>
          <p className="text-slate-400 text-xs mt-2">Clique para alterar a foto</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
             <label className="block text-sm font-medium text-slate-400 mb-1">Nome Completo</label>
             <input 
                type="text"
                value={formData.name}
                onChange={(e) => setFormData({...formData, name: e.target.value})}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
             />
          </div>
          
          <div>
             <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
             <input 
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({...formData, email: e.target.value})}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
             />
          </div>

          <div className="pt-4 border-t border-slate-700 mt-4">
             <h4 className="text-lg font-medium text-white mb-4">Alterar Senha</h4>
             <div className="space-y-4">
                <div>
                   <label className="block text-sm font-medium text-slate-400 mb-1">Nova Senha (deixe em branco para manter)</label>
                   <input 
                      type="password"
                      value={formData.newPassword}
                      onChange={(e) => setFormData({...formData, newPassword: e.target.value})}
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="Nova senha"
                   />
                </div>
             </div>
          </div>

          <div className="flex justify-end mt-6">
             <Button type="submit" variant="primary" className="w-full md:w-auto">Salvar Alterações</Button>
          </div>
        </form>
      </Card>

      <Card className="border-rose-900/50 bg-rose-950/10">
          <h3 className="text-lg font-bold text-rose-500 mb-2">Zona de Perigo</h3>
          <p className="text-sm text-slate-400 mb-4">Ações irreversíveis que afetam os dados da aplicação.</p>
          <div className="flex justify-start">
               <Button variant="danger" onClick={handleReset}>Resetar Todas as Demandas</Button>
          </div>
      </Card>
    </div>
  );
};

// --- Gantt View ---

const GanttView = ({ tasks, devs }: { tasks: Task[], devs: Developer[] }) => {
  const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], status: string[], assignee: string[]}>({ 
      search: '', 
      type: [], 
      priority: [], 
      status: [], 
      assignee: [] 
  });

  const filteredTasks = useMemo(() => {
      return tasks.filter(t => {
          const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) ||
                                t.id.toLowerCase().includes(filters.search.toLowerCase()) ||
                                (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
          
          const matchesType = filters.type.length === 0 || filters.type.includes(t.type);
          const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
          const matchesStatus = filters.status.length === 0 || filters.status.includes(t.status);
          
          let matchesAssignee = true;
          if (filters.assignee.length > 0) {
              const hasUnassigned = filters.assignee.includes('Não Atribuído');
              if (hasUnassigned) {
                  matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee);
              } else {
                  matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee);
              }
          }

          // Must have dates to show in Gantt
          return matchesSearch && matchesType && matchesPriority && matchesStatus && matchesAssignee && t.startDate && t.endDate;
      });
  }, [tasks, filters]);

  const timelineData = useMemo(() => {
    return filteredTasks
      .map(t => ({
        ...t,
        start: new Date(t.startDate!).getTime(),
        end: new Date(t.endDate!).getTime()
      }))
      .sort((a, b) => a.start - b.start);
  }, [filteredTasks]);

  if (timelineData.length === 0) {
    return (
        <div className="h-full flex flex-col">
             <FilterBar filters={filters} setFilters={setFilters} devs={devs} />
             <div className="flex-1 flex items-center justify-center text-slate-500 bg-slate-800/30 rounded-xl border border-slate-700/50">
                 Adicione datas de início e fim às tarefas e verifique os filtros para visualizar o cronograma.
             </div>
         </div>
    );
  }

  const minDate = Math.min(...timelineData.map(t => t.start));
  const maxDate = Math.max(...timelineData.map(t => t.end));
  const dayMs = 86400000;
  const totalDays = Math.ceil((maxDate - minDate) / dayMs) + 10; // Padding
  const cellWidth = 50; // Width per day

  const today = new Date();
  today.setHours(0,0,0,0);
  const todayMs = today.getTime();
  const isTodayVisible = todayMs >= minDate && todayMs <= (minDate + (totalDays * dayMs));
  const todayOffset = Math.floor((todayMs - minDate) / dayMs);

  return (
    <div className="h-full flex flex-col space-y-4">
      <FilterBar filters={filters} setFilters={setFilters} devs={devs} />
      
      <Card className="flex-1 p-0 overflow-hidden flex flex-col bg-slate-900 border-slate-700">
         {/* Header + Scroll Area */}
         <div className="flex-1 flex overflow-hidden">
             
             {/* Fixed Left Column (Task Info) */}
             <div className="w-80 flex-shrink-0 bg-slate-800/80 border-r border-slate-700 z-20 shadow-lg">
                 <div className="h-12 bg-slate-800 border-b border-slate-700 flex items-center px-4 font-bold text-slate-300 text-sm">
                     Tarefas
                 </div>
                 <div className="overflow-y-hidden">
                     {timelineData.map((task, idx) => (
                         <div key={task.id} className="h-12 border-b border-slate-700/50 flex flex-col justify-center px-4 group hover:bg-slate-700/30">
                             <div className="flex justify-between items-center">
                                 <span className="text-sm font-medium text-slate-200 truncate w-48" title={task.summary}>{task.summary}</span>
                                 <Badge type={task.status} className="text-[9px] px-1" />
                             </div>
                             <span className="text-xs text-slate-500 truncate">{task.assignee || 'Sem atribuição'}</span>
                         </div>
                     ))}
                 </div>
             </div>

             {/* Scrollable Timeline */}
             <div className="flex-1 overflow-auto custom-scrollbar relative bg-slate-900/50">
                 <div style={{ width: `${totalDays * cellWidth}px` }}>
                     {/* Calendar Header */}
                     <div className="h-12 bg-slate-800 border-b border-slate-700 flex sticky top-0 z-10">
                         {Array.from({ length: totalDays }).map((_, i) => {
                             const d = new Date(minDate + i * dayMs);
                             const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                             const isToday = d.getTime() === todayMs;
                             return (
                                 <div key={i} className={`flex-shrink-0 text-center border-r border-slate-700 py-2 text-[10px] ${isWeekend ? 'bg-slate-800/50' : ''} ${isToday ? 'bg-indigo-900/30' : ''}`} style={{ width: `${cellWidth}px` }}>
                                     <div className="font-bold text-slate-400">{d.getDate()}</div>
                                     <div className="text-slate-600">{d.toLocaleDateString('pt-BR', { weekday: 'narrow' })}</div>
                                 </div>
                             )
                         })}
                     </div>

                     {/* Grid Lines & Today Line */}
                     <div className="absolute inset-0 top-12 z-0 pointer-events-none flex">
                         {Array.from({ length: totalDays }).map((_, i) => {
                             const d = new Date(minDate + i * dayMs);
                             const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                             return (
                                 <div key={i} className={`h-full border-r border-slate-700/30 flex-shrink-0 ${isWeekend ? 'bg-black/20' : ''}`} style={{ width: `${cellWidth}px` }}></div>
                             )
                         })}
                         {isTodayVisible && (
                            <div 
                                className="absolute top-0 bottom-0 w-px bg-rose-500 z-10 shadow-[0_0_10px_rgba(244,63,94,0.5)]" 
                                style={{ left: `${todayOffset * cellWidth + (cellWidth/2)}px` }}
                            >
                                <div className="absolute -top-1 -left-1 w-2 h-2 bg-rose-500 rounded-full"></div>
                            </div>
                         )}
                     </div>

                     {/* Bars */}
                     <div className="relative z-10">
                        {timelineData.map((task, idx) => {
                           const durationMs = task.end - task.start;
                           const durationDays = Math.floor(durationMs / dayMs) + 1; // +1 to include start day
                           const offsetDays = Math.floor((task.start - minDate) / dayMs);
                           
                           let colorClass = "bg-slate-600";
                           if (task.type === 'Incidente') colorClass = "bg-rose-500";
                           if (task.type === 'Melhoria') colorClass = "bg-emerald-500";
                           if (task.type === 'Nova Automação') colorClass = "bg-indigo-500";

                           const isDone = ['Concluído', 'Resolvido', 'Fechado'].includes(task.status);

                           return (
                               <div key={task.id} className="h-12 flex items-center relative border-b border-transparent">
                                   <div 
                                      className={`absolute h-7 rounded-lg shadow-lg ${colorClass} ${isDone ? 'opacity-60 saturate-0' : 'opacity-90'} hover:opacity-100 transition-all cursor-pointer flex items-center px-2 overflow-hidden whitespace-nowrap text-xs text-white font-medium group border border-white/10`}
                                      style={{ 
                                          left: `${offsetDays * cellWidth + 2}px`, 
                                          width: `${Math.max(durationDays * cellWidth - 4, 40)}px` 
                                      }}
                                      title={`${task.summary} (${new Date(task.start).toLocaleDateString()} - ${new Date(task.end).toLocaleDateString()})`}
                                   >
                                       {/* Striped pattern overlay */}
                                       <div className="absolute inset-0 opacity-10 bg-[linear-gradient(45deg,rgba(255,255,255,.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.15)_50%,rgba(255,255,255,.15)_75%,transparent_75%,transparent)] bg-[length:10px_10px]"></div>
                                       
                                       <span className="relative z-10 drop-shadow-md flex justify-between w-full items-center">
                                           <span className="truncate mr-2">{task.summary}</span>
                                           {task.estimatedTime && (
                                               <span className="bg-black/30 px-1 rounded text-[9px]">{Math.ceil(parseDuration(task.estimatedTime)/8)}d</span>
                                           )}
                                       </span>
                                   </div>
                               </div>
                           )
                        })}
                     </div>
                 </div>
             </div>
         </div>
      </Card>
    </div>
  );
};

// --- Dashboard Widget System ---

interface Widget {
    id: string;
    type: 'cards' | 'priority' | 'status' | 'devType' | 'capacity';
    title: string;
    size: 'half' | 'full';
    visible: boolean;
}

const DEFAULT_WIDGETS: Widget[] = [
    { id: 'w1', type: 'cards', title: 'KPIs Gerais (Ativos)', size: 'full', visible: true },
    { id: 'w2', type: 'priority', title: 'Demandas por Prioridade', size: 'half', visible: true },
    { id: 'w3', type: 'status', title: 'Status x Tipo de Demanda', size: 'half', visible: true },
    { id: 'w4', type: 'devType', title: 'Demanda por Desenvolvedor', size: 'half', visible: true },
    { id: 'w5', type: 'capacity', title: 'Capacidade & Disponibilidade', size: 'half', visible: true },
];

const renderCustomBarLabel = ({ x, y, width, height, value }: any) => {
    if (!value || value === 0 || width < 15) return null;
    return (
        <text x={x + width / 2} y={y + height / 2 + 3} fill="#ffffff" textAnchor="middle" fontSize="10" fontWeight="bold">
            {value}
        </text>
    );
};

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    const total = payload.reduce((acc: number, p: any) => {
        return p.dataKey !== 'total' ? acc + p.value : acc;
    }, 0);

    return (
      <div className="bg-slate-800 border border-slate-600 p-3 rounded shadow-xl z-50">
        <p className="text-slate-200 font-bold mb-2">{label}</p>
        {payload.filter((p:any) => p.dataKey !== 'total').map((p: any) => (
          <div key={p.name} className="flex items-center gap-2 text-xs mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }}></div>
            <span className="text-slate-400">{p.name}:</span>
            <span className="text-white font-mono">{p.value}</span>
          </div>
        ))}
        <div className="border-t border-slate-700 mt-2 pt-1 flex justify-between items-center">
             <span className="text-slate-400 text-xs">Total</span>
             <span className="text-white font-bold">{total}</span>
        </div>
      </div>
    );
  }
  return null;
};

const DashboardView = ({ tasks, devs }: { tasks: Task[], devs: Developer[] }) => {
  const [widgets, setWidgets] = useState<Widget[]>(() => {
      const saved = localStorage.getItem('nexus_dashboard_widgets');
      return saved ? JSON.parse(saved) : DEFAULT_WIDGETS;
  });
  const [isEditMode, setIsEditMode] = useState(false);
  const [filterDev, setFilterDev] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);

  useEffect(() => {
      localStorage.setItem('nexus_dashboard_widgets', JSON.stringify(widgets));
  }, [widgets]);

  // Tasks filtered by UI controls (Dev & Type) AND EXCLUDING COMPLETED
  const activeFilteredTasks = useMemo(() => {
    return tasks.filter(t => {
        // Global Dashboard Rule: Don't count completed tasks
        if (['Concluído', 'Resolvido', 'Fechado'].includes(t.status)) return false;

        const matchesDev = filterDev.length === 0 || filterDev.includes(t.assignee || '');
        const matchesType = filterType.length === 0 || filterType.includes(t.type);
        return matchesDev && matchesType;
    });
  }, [tasks, filterDev, filterType]);

  // --- Metrics Calculation (KPIs) ---
  const metrics = useMemo(() => {
    // activeFilteredTasks already excludes completed
    return {
        incidents: activeFilteredTasks.filter(t => t.type === 'Incidente').length,
        features: activeFilteredTasks.filter(t => t.type === 'Melhoria').length,
        automations: activeFilteredTasks.filter(t => t.type === 'Nova Automação').length,
        total: activeFilteredTasks.length
    };
  }, [activeFilteredTasks]);

  const priorityData = useMemo(() => {
    const counts: Record<string, number> = { '1 - Crítica': 0, '2 - Alta': 0, '3 - Moderada': 0, '4 - Baixa': 0 };
    activeFilteredTasks.forEach(t => { counts[t.priority] = (counts[t.priority] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [activeFilteredTasks]);
  
  // Improved Status Data: Status vs Type Breakdown
  const statusByTypeData = useMemo(() => {
      const STATUS_ORDER = ['Novo', 'Pendente', 'Em Atendimento', 'Em Progresso', 'Aguardando', 'Backlog'];
      
      const data: { name: string; Incidente: number; Melhoria: number; 'Nova Automação': number; total: number }[] = STATUS_ORDER.map(status => {
          const tasksInStatus = activeFilteredTasks.filter(t => t.status === status);
          return {
              name: status,
              Incidente: tasksInStatus.filter(t => t.type === 'Incidente').length,
              Melhoria: tasksInStatus.filter(t => t.type === 'Melhoria').length,
              'Nova Automação': tasksInStatus.filter(t => t.type === 'Nova Automação').length,
              total: tasksInStatus.length
          };
      }).filter(d => d.total > 0); // Only show statuses that have tasks

      return data;
  }, [activeFilteredTasks]);

  const devTypeData = useMemo(() => {
    const data = devs.map(dev => {
        const devTasks = activeFilteredTasks.filter(t => t.assignee === dev.name);
        return {
            name: dev.name,
            Incidente: devTasks.filter(t => t.type === 'Incidente').length,
            Melhoria: devTasks.filter(t => t.type === 'Melhoria').length,
            'Nova Automação': devTasks.filter(t => t.type === 'Nova Automação').length,
            total: devTasks.length
        };
    }).filter(d => d.total > 0);
    
    // Sort by Total Descending for better visualization ("Bater o olho")
    return data.sort((a, b) => b.total - a.total);
  }, [activeFilteredTasks, devs]);

  // --- Capacity Logic (Time Based & Availability) ---
  const capacityData = useMemo(() => {
    const data = devs.map(dev => {
        // Filter active tasks for this specific dev from the already filtered list
        // This means if "Type: Incident" is selected on dashboard, we calculate capacity based on incidents only.
        const myTasks = activeFilteredTasks.filter(t => t.assignee === dev.name);
        
        // Sum estimated time (Calculate workload time)
        const totalHours = myTasks.reduce((acc, t) => {
            return acc + parseDuration(t.estimatedTime);
        }, 0);

        return {
            name: dev.name,
            activeTasksCount: myTasks.length,
            totalHours: totalHours
        };
    });
    
    // Sort by totalHours Ascending (Least busy first -> Available First)
    return data.sort((a, b) => a.totalHours - b.totalHours);
  }, [activeFilteredTasks, devs]);

  // --- Widget Actions ---
  const toggleSize = (id: string) => {
      setWidgets(prev => prev.map(w => w.id === id ? { ...w, size: w.size === 'full' ? 'half' : 'full' } : w));
  };

  const moveWidget = (index: number, direction: 'up' | 'down') => {
      const newWidgets = [...widgets];
      if (direction === 'up' && index > 0) {
          [newWidgets[index], newWidgets[index - 1]] = [newWidgets[index - 1], newWidgets[index]];
      } else if (direction === 'down' && index < newWidgets.length - 1) {
          [newWidgets[index], newWidgets[index + 1]] = [newWidgets[index + 1], newWidgets[index]];
      }
      setWidgets(newWidgets);
  };
  
  const toggleVisibility = (id: string) => {
      setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
  };

  const exportPPT = () => {
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE';
    pres.author = 'Nexus Project';
    pres.company = 'Nexus';
    pres.subject = 'Relatório de Projetos';
    pres.title = 'One Page Project Report';
    
    // Slide 1: Title
    let slide = pres.addSlide();
    slide.background = { color: "0f172a" };
    slide.addText("Relatório One Page Project", { x: 1, y: 2, w: '80%', fontSize: 36, color: 'FFFFFF', bold: true, align: 'center' });
    slide.addText(`Gerado em: ${new Date().toLocaleDateString()} - Visão Geral (Projetos Ativos)`, { x: 1, y: 3, w: '80%', fontSize: 18, color: '94a3b8', align: 'center' });

    // Slide 2: KPIs (Text Based)
    slide = pres.addSlide();
    slide.background = { color: "0f172a" };
    slide.addText("Métricas Gerais (KPIs - Projetos Ativos)", { x: 0.5, y: 0.5, fontSize: 24, color: 'FFFFFF', bold: true });
    
    const stats = [
      { label: "Total Ativo", val: metrics.total, color: "FFFFFF" },
      { label: "Incidentes", val: metrics.incidents, color: "F43F5E" },
      { label: "Melhorias", val: metrics.features, color: "10B981" },
      { label: "Automações", val: metrics.automations, color: "6366F1" }
    ];
    stats.forEach((stat, i) => {
        slide.addShape(pres.ShapeType.rect, { x: 1 + (i * 2.5), y: 2, w: 2.2, h: 2, fill: { color: "1e293b" }, line: { color: "334155", width: 1 } });
        slide.addText(stat.label, { x: 1 + (i * 2.5), y: 2.2, w: 2.2, h: 0.5, color: '94a3b8', align: 'center', fontSize: 14 });
        slide.addText(String(stat.val), { x: 1 + (i * 2.5), y: 2.8, w: 2.2, h: 1, color: stat.color, align: 'center', fontSize: 32, bold: true });
    });

    // Helper for Chart Slides
    const addChartSlide = (title: string, type: any, data: any, opts: any) => {
        const s = pres.addSlide();
        s.background = { color: "0f172a" };
        s.addText(title, { x: 0.5, y: 0.5, fontSize: 20, color: 'FFFFFF', bold: true });
        s.addChart(type as any, data, { x: 1, y: 1.5, w: '80%', h: '70%', ...opts });
        return s;
    };

    // Slide 3: Priority (Bar)
    addChartSlide("Demandas por Prioridade", pres.ChartType.bar, priorityData.map(p => ({
        name: p.name,
        labels: [p.name],
        values: [p.value]
    })), { barDir: 'col', chartColors: ['8b5cf6'], valAxisMinVal: 0, valAxisLabelColor: '94a3b8', catAxisLabelColor: '94a3b8' });

    // Slide 4: Status (Stacked Bar by Type)
    if (statusByTypeData.length > 0) {
        const statusLabels = statusByTypeData.map(s => s.name);
        const incData = statusByTypeData.map(s => s.Incidente);
        const featData = statusByTypeData.map(s => s.Melhoria);
        const autoData = statusByTypeData.map(s => s['Nova Automação']);

        addChartSlide("Distribuição de Status por Tipo", pres.ChartType.bar, [
            { name: 'Incidentes', labels: statusLabels, values: incData },
            { name: 'Melhorias', labels: statusLabels, values: featData },
            { name: 'Automações', labels: statusLabels, values: autoData }
        ], { 
            barDir: 'col', 
            barGrouping: 'stacked', 
            showLegend: true, 
            legendPos: 'b', 
            valAxisLabelColor: '94a3b8', 
            catAxisLabelColor: '94a3b8', 
            chartColors: ['f43f5e', '10b981', '6366f1'] 
        });
    }

    // Slide 5: Dev Workload (Stacked Bar)
    if (devTypeData.length > 0) {
        const devNames = devTypeData.map(d => d.name);
        const incData = devTypeData.map(d => d.Incidente);
        const featData = devTypeData.map(d => d.Melhoria);
        const autoData = devTypeData.map(d => d['Nova Automação']);

        addChartSlide("Demandas por Desenvolvedor (Tipo)", pres.ChartType.bar, [
            { name: 'Incidentes', labels: devNames, values: incData },
            { name: 'Melhorias', labels: devNames, values: featData },
            { name: 'Automações', labels: devNames, values: autoData }
        ], { barDir: 'bar', showLegend: true, legendPos: 'b', valAxisLabelColor: '94a3b8', catAxisLabelColor: '94a3b8', chartColors: ['f43f5e', '10b981', '6366f1'] });
    }

    // Slide 6: Capacity (Bar) - Time Based
    // Sorted by availability (least hours first)
    const capLabels = capacityData.map(d => d.name);
    const capValues = capacityData.map(d => d.totalHours);
    const s = addChartSlide("Capacidade & Disponibilidade (Horas Estimadas)", pres.ChartType.bar, [
        {
            name: 'Horas Estimadas Pendentes',
            labels: capLabels,
            values: capValues
        }
    ], { 
        barDir: 'bar', 
        chartColors: ['10b981'], 
        valAxisLabelColor: '94a3b8', 
        catAxisLabelColor: '94a3b8',
        valAxisTitle: 'Horas'
    });
    
    // Add suggestion text to slide
    if (capacityData.length > 0) {
        const bestDev = capacityData[0];
        const bestDevName = bestDev ? bestDev.name : "";
        const bestDevHours = bestDev ? bestDev.totalHours : 0;
        s.addText(`Sugestão de Atribuição: ${bestDevName} (Livre em ~${formatDuration(bestDevHours)})`, { 
            x: 1, y: 1, w: '80%', h: 0.5, color: '10b981', fontSize: 14, bold: true 
        });
    }

    pres.writeFile({ fileName: "Nexus_OnePageReport.pptx" });
  };

  const renderWidget = (widget: Widget) => {
      return (
          <div className="h-full flex flex-col">
             {/* Widget Header */}
             <div className="flex justify-between items-center mb-4">
                 <h3 className="text-lg font-semibold text-slate-200">{widget.title}</h3>
                 {isEditMode && (
                     <div className="flex items-center gap-1 bg-slate-900 rounded p-1">
                         <button onClick={() => toggleSize(widget.id)} className="p-1 hover:text-indigo-400 text-slate-400" title="Alterar Tamanho">
                             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                                 {widget.size === 'full' ? <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5M15 15l5.25 5.25" /> : <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />}
                             </svg>
                         </button>
                         <button onClick={() => toggleVisibility(widget.id)} className="p-1 hover:text-rose-400 text-slate-400" title="Ocultar">
                             <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                         </button>
                     </div>
                 )}
             </div>
             
             {/* Widget Content */}
             <div className="flex-1 min-h-[250px]">
                 {widget.type === 'cards' && (
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4 h-full">
                        <div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-slate-500 flex flex-col justify-between">
                            <span className="text-slate-400 text-xs uppercase font-bold">Total (Ativos)</span>
                            <span className="text-3xl font-bold text-white">{metrics.total}</span>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-rose-500 flex flex-col justify-between">
                            <span className="text-rose-400 text-xs uppercase font-bold">Incidentes</span>
                            <span className="text-3xl font-bold text-white">{metrics.incidents}</span>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-emerald-500 flex flex-col justify-between">
                            <span className="text-emerald-400 text-xs uppercase font-bold">Melhorias</span>
                            <span className="text-3xl font-bold text-white">{metrics.features}</span>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-indigo-500 flex flex-col justify-between">
                            <span className="text-indigo-400 text-xs uppercase font-bold">Automações</span>
                            <span className="text-3xl font-bold text-white">{metrics.automations}</span>
                        </div>
                     </div>
                 )}
                 {widget.type === 'priority' && (
                    <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={priorityData}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#fff' }} cursor={{fill: '#334155', opacity: 0.4}} />
                            <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={40} />
                        </BarChart>
                    </ResponsiveContainer>
                 )}
                 {widget.type === 'status' && (
                     <ResponsiveContainer width="100%" height="100%">
                         <BarChart 
                            data={statusByTypeData} 
                            margin={{ top: 5, right: 30, left: 20, bottom: 5 }} 
                            barSize={40}
                         >
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                            <XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} />
                            <YAxis stroke="#94a3b8" />
                            <Tooltip content={<CustomTooltip />} cursor={{fill: '#334155', opacity: 0.2}} />
                            <Legend wrapperStyle={{paddingTop: '10px'}} />
                            
                            <Bar dataKey="Incidente" stackId="a" fill="#f43f5e">
                                <LabelList dataKey="Incidente" content={renderCustomBarLabel} />
                            </Bar>
                            <Bar dataKey="Melhoria" stackId="a" fill="#10b981">
                                <LabelList dataKey="Melhoria" content={renderCustomBarLabel} />
                            </Bar>
                            <Bar dataKey="Nova Automação" stackId="a" fill="#6366f1" radius={[4, 4, 0, 0]}>
                                <LabelList dataKey="Nova Automação" content={renderCustomBarLabel} />
                            </Bar>
                        </BarChart>
                     </ResponsiveContainer>
                 )}
                 {widget.type === 'devType' && (
                     <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                            data={devTypeData} 
                            layout="vertical" 
                            margin={{ top: 5, right: 60, left: 10, bottom: 5 }} 
                            barSize={32}
                        >
                            <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} vertical={true} opacity={0.2} />
                            <XAxis type="number" stroke="#64748b" tick={{fontSize: 10}} hide />
                            <YAxis 
                                dataKey="name" 
                                type="category" 
                                stroke="#94a3b8" 
                                tick={{fontSize: 12, fill: '#cbd5e1', fontWeight: 500}} 
                                width={150} 
                                interval={0}
                                tickLine={false}
                                axisLine={false}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={{fill: '#334155', opacity: 0.2}} />
                            <Legend wrapperStyle={{paddingTop: '10px'}} />
                            
                            <Bar dataKey="Incidente" stackId="a" fill="#f43f5e" radius={[4, 0, 0, 4]}>
                                <LabelList dataKey="Incidente" content={renderCustomBarLabel} />
                            </Bar>
                            <Bar dataKey="Melhoria" stackId="a" fill="#10b981">
                                <LabelList dataKey="Melhoria" content={renderCustomBarLabel} />
                            </Bar>
                            <Bar dataKey="Nova Automação" stackId="a" fill="#6366f1" radius={[0, 4, 4, 0]}>
                                <LabelList dataKey="Nova Automação" content={renderCustomBarLabel} />
                            </Bar>

                            {/* Invisible Line to Anchor the Total Label at the end of the bars */}
                            <Line dataKey="total" stroke="none" isAnimationActive={false}>
                                <LabelList 
                                    dataKey="total" 
                                    position="right" 
                                    style={{ fill: "#94a3b8", fontSize: "12px", fontWeight: "bold" }}
                                    formatter={(val: any) => `Total: ${val}`} 
                                />
                            </Line>
                        </ComposedChart>
                    </ResponsiveContainer>
                 )}
                 {widget.type === 'capacity' && (
                     <div className="h-full flex flex-col">
                        {capacityData.length > 0 && (
                            <div className="bg-emerald-900/20 border border-emerald-700/50 px-4 py-4 rounded-lg mb-4 flex items-center gap-4">
                                <div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]">
                                    <IconClock className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="text-[11px] text-emerald-400 font-bold uppercase tracking-widest mb-1">Sugestão (Disponível 1º)</p>
                                    <p className="text-xl text-white font-bold leading-none">{capacityData[0].name}</p>
                                    <p className="text-xs text-slate-400 mt-1">
                                        Livre em aprox. <span className="text-white font-mono">{formatDuration(capacityData[0].totalHours)}</span>
                                    </p>
                                </div>
                            </div>
                        )}
                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2">
                             <table className="w-full text-sm">
                                 <thead className="text-xs text-slate-400 uppercase bg-slate-900/50">
                                     <tr>
                                         <th className="text-left p-2 rounded-l">Dev</th>
                                         <th className="text-center p-2">Qtd</th>
                                         <th className="text-center p-2">Backlog</th>
                                         <th className="text-center p-2">Dias Est.</th>
                                         <th className="text-center p-2 rounded-r">Saúde</th>
                                     </tr>
                                 </thead>
                                 <tbody className="divide-y divide-slate-700/50">
                                     {capacityData.map((dev, idx) => {
                                         const estimatedDays = Math.ceil(dev.totalHours / 8);
                                         let statusColor = 'bg-emerald-500 text-white';
                                         let statusText = 'Livre';
                                         let barColor = 'bg-emerald-500';

                                         if (dev.totalHours > 40) {
                                             statusColor = 'bg-rose-500 text-white';
                                             statusText = 'Sobrecarga';
                                             barColor = 'bg-rose-500';
                                         } else if (dev.totalHours > 24) {
                                             statusColor = 'bg-orange-500 text-white';
                                             statusText = 'Ocupado';
                                             barColor = 'bg-orange-500';
                                         } else if (dev.totalHours > 8) {
                                             statusColor = 'bg-yellow-500 text-black';
                                             statusText = 'Moderado';
                                             barColor = 'bg-yellow-500';
                                         }

                                         return (
                                            <tr key={dev.name} className="group hover:bg-slate-700/30">
                                                <td className="p-2">
                                                    <div className="font-medium text-slate-200">{dev.name}</div>
                                                    <div className="w-full h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden">
                                                        <div className={`h-full ${barColor}`} style={{ width: `${Math.min((dev.totalHours / 60) * 100, 100)}%` }}></div>
                                                    </div>
                                                </td>
                                                <td className="p-2 text-center text-slate-300 font-bold">{dev.activeTasksCount}</td>
                                                <td className="p-2 text-center font-mono text-slate-300">{formatDuration(dev.totalHours)}</td>
                                                <td className="p-2 text-center text-slate-400">{estimatedDays}d</td>
                                                <td className="p-2 text-center">
                                                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusColor}`}>
                                                        {statusText}
                                                    </span>
                                                </td>
                                            </tr>
                                         )
                                     })}
                                 </tbody>
                             </table>
                        </div>
                     </div>
                 )}
             </div>
          </div>
      )
  }

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
             <h2 className="text-2xl font-bold text-white">One Page Report</h2>
             <p className="text-slate-400 text-sm">Visão executiva e operacional do projeto</p>
        </div>
        <div className="flex flex-wrap gap-4 w-full md:w-auto items-center">
          {/* Filter for just the dashboard view */}
          <div className="flex gap-2 w-full md:w-auto">
              <MultiSelect 
                options={TASK_TYPES}
                selected={filterType}
                onChange={setFilterType}
                placeholder="Tipos: Todos"
              />
              <MultiSelect 
                options={devs.map(d => d.name)}
                selected={filterDev}
                onChange={setFilterDev}
                placeholder="Devs: Todos"
              />
          </div>

          <Button onClick={() => setIsEditMode(!isEditMode)} variant={isEditMode ? "success" : "secondary"} className="whitespace-nowrap">
              {isEditMode ? 'Salvar Layout' : 'Editar Layout'}
          </Button>
          
          <Button onClick={exportPPT} variant="primary" className="whitespace-nowrap bg-indigo-600 hover:bg-indigo-700">
              <IconDownload /> Exportar PPT
          </Button>
        </div>
      </div>
      
      {/* Hidden Widgets Menu */}
      {isEditMode && widgets.some(w => !w.visible) && (
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-600 flex gap-4 items-center overflow-x-auto animate-slide-in">
              <span className="text-sm text-slate-400 font-medium whitespace-nowrap">Widgets Disponíveis:</span>
              {widgets.filter(w => !w.visible).map(w => (
                  <button key={w.id} onClick={() => toggleVisibility(w.id)} className="bg-slate-700 hover:bg-indigo-600 px-3 py-1 rounded text-xs text-white transition-colors border border-slate-600 flex items-center gap-2">
                      <IconPlus className="w-3 h-3" /> {w.title}
                  </button>
              ))}
          </div>
      )}

      {/* Dynamic Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">
         {widgets.filter(w => w.visible).map((widget, index) => (
             <div 
                key={widget.id} 
                className={`${widget.size === 'full' ? 'md:col-span-2 xl:col-span-4' : 'md:col-span-1 xl:col-span-2'} relative group transition-all duration-300`}
             >
                 <Card className="h-full min-h-[340px] flex flex-col">
                     {renderWidget(widget)}
                 </Card>
                 
                 {/* Floating Move Buttons for Edit Mode */}
                 {isEditMode && (
                     <div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/90 p-1.5 rounded border border-slate-700 shadow-xl z-20">
                         {index > 0 && (
                            <button onClick={() => moveWidget(index, 'up')} className="p-1.5 bg-slate-800 hover:bg-indigo-600 rounded text-white transition-colors" title="Mover para Cima/Esquerda">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                            </button>
                         )}
                         {index < widgets.filter(w => w.visible).length - 1 && (
                            <button onClick={() => moveWidget(index, 'down')} className="p-1.5 bg-slate-800 hover:bg-indigo-600 rounded text-white transition-colors" title="Mover para Baixo/Direita">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                            </button>
                         )}
                     </div>
                 )}
             </div>
         ))}
      </div>

    </div>
  );
};

// --- Kanban View (Updated: Developer Based) ---

const KanbanView = ({ tasks, setTasks, devs, onEditTask, user }: { tasks: Task[], setTasks: any, devs: Developer[], onEditTask: (task: Task) => void, user: User }) => {
  const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], assignee: string[]}>({ 
      search: '', 
      type: [], 
      priority: [], 
      assignee: [] 
  });

  // --- Columns Definition ---
  // 1. Unassigned
  // 2. Developer Columns
  // 3. Completed Column
  const columns = useMemo(() => {
      let cols = [
          { id: 'unassigned', title: 'Não Atribuídos', type: 'unassigned' },
          ...devs.map(d => ({ id: d.name, title: d.name, type: 'dev' })),
          { id: 'completed', title: 'Concluídos', type: 'completed' }
      ];

      // Filter columns if specific dev is selected
      if (filters.assignee.length > 0) {
           // If 'Não Atribuído' is selected, show unassigned column
           const showUnassigned = filters.assignee.includes('Não Atribuído');
           
           cols = cols.filter(c => {
               if (c.type === 'completed') return true;
               if (c.type === 'unassigned') return showUnassigned;
               return filters.assignee.includes(c.id);
           });
      }
      return cols;
  }, [devs, filters.assignee]);

  const onDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("taskId", taskId);
  };

  const onDrop = (e: React.DragEvent, colId: string, colType: string) => {
    e.preventDefault();
    e.stopPropagation();
    const taskId = e.dataTransfer.getData("taskId");

    const updatedTasks = tasks.map(t => t); // shallow copy
    const taskIndex = updatedTasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    const task = updatedTasks[taskIndex];
    let historyAction = '';
    
    // --- Logic for Different Column Types ---

    if (colType === 'unassigned') {
        if (task.assignee) {
            historyAction = `Removeu atribuição (Estava com ${task.assignee})`;
            task.assignee = null;
        }
        // If moving from completed back to active, reset status
        if (['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) {
            task.status = 'Pendente';
            historyAction += (historyAction ? '. ' : '') + "Reabriu tarefa (Status: Pendente)";
        }
    } 
    else if (colType === 'dev') {
        // Target Developer Name is the colId
        const targetDev = colId;
        
        // Check Overload
        const currentWorkload = getDevWorkload(targetDev, tasks, task.id);
        if (currentWorkload > 40) {
             if(!window.confirm(`ALERTA: ${targetDev} já tem ${formatDuration(currentWorkload)} de carga. Deseja atribuir mesmo assim?`)) {
                 return;
             }
        }

        if (task.assignee !== targetDev) {
            historyAction = `Atribuiu para ${targetDev}`;
            task.assignee = targetDev;
        }

        // If moving from completed back to active
        if (['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) {
            task.status = 'Em Progresso'; // Reactive
            historyAction += (historyAction ? '. ' : '') + "Reabriu tarefa (Status: Em Progresso)";
        } else if (task.status === 'Novo' || task.status === 'Backlog') {
             task.status = 'Em Atendimento'; // Auto-start
        }
    }
    else if (colType === 'completed') {
        if (!['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) {
            task.status = 'Concluído';
            historyAction = `Concluiu tarefa`;
        }
    }

    if (historyAction) {
        const entry: HistoryEntry = {
            id: Math.random().toString(36).substr(2, 9),
            date: new Date().toISOString(),
            user: user.name,
            action: historyAction
        };
        task.history = [...(task.history || []), entry];
        setTasks([...updatedTasks]);
        StorageService.saveTasks(updatedTasks);
    }
  };
  
  // --- Filtering ---
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
        const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || 
                              t.id.toLowerCase().includes(filters.search.toLowerCase()) ||
                              (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
        
        const matchesType = filters.type.length === 0 || filters.type.includes(t.type);
        const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
        
        // Assignee matching is handled by columns visualization generally, but for search/count consistency:
        let matchesAssignee = true;
        if (filters.assignee.length > 0) {
            const hasUnassigned = filters.assignee.includes('Não Atribuído');
            if (hasUnassigned) {
                matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee);
            } else {
                matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee);
            }
        }

        return matchesSearch && matchesType && matchesPriority && matchesAssignee;
    });
  }, [tasks, filters]);

  // Helper to get tasks for a specific column
  const getTasksForColumn = (colId: string, colType: string) => {
      return filteredTasks.filter(t => {
          const isCompleted = ['Concluído', 'Resolvido', 'Fechado'].includes(t.status);
          
          if (colType === 'completed') {
              return isCompleted;
          }
          
          // For Unassigned and Dev columns, we ONLY show active tasks
          if (isCompleted) return false;

          if (colType === 'unassigned') {
              return !t.assignee;
          }
          
          if (colType === 'dev') {
              return t.assignee === colId;
          }
          
          return false;
      }).sort((a, b) => (a.boardPosition || 0) - (b.boardPosition || 0));
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center">
          <FilterBar filters={filters} setFilters={setFilters} devs={devs} /> 
      </div>
      
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex gap-4 h-full min-w-max px-2 items-start">
          {columns.map(col => {
            const colTasks = getTasksForColumn(col.id, col.type);
            const isCompletedCol = col.type === 'completed';
            const isUnassignedCol = col.type === 'unassigned';

            let headerColor = "border-slate-700 bg-slate-800/80";
            if (isCompletedCol) headerColor = "border-emerald-900/50 bg-emerald-900/20";
            if (isUnassignedCol) headerColor = "border-slate-700 bg-slate-800/50 dashed";

            return (
                <div 
                key={col.id}
                className={`flex-1 min-w-[320px] w-[320px] rounded-xl border flex flex-col transition-colors bg-slate-800/30 border-slate-700`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, col.id, col.type)}
                >
                <div className={`p-3 border-b rounded-t-xl sticky top-0 backdrop-blur-md z-10 flex justify-between items-center ${headerColor}`}>
                    <div className="flex items-center gap-2">
                         {col.type === 'dev' && <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-xs text-white font-bold">{col.title.substring(0,2).toUpperCase()}</div>}
                         {col.type === 'unassigned' && <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-xs text-white font-bold">?</div>}
                         {col.type === 'completed' && <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-xs text-white font-bold">✓</div>}
                        <h3 className="font-semibold text-white truncate max-w-[200px]">{col.title}</h3>
                    </div>
                    <span className="bg-slate-900/50 text-xs px-2 py-1 rounded text-slate-400 font-mono">
                        {colTasks.length}
                    </span>
                </div>
                
                <div className="p-3 space-y-3 overflow-y-auto flex-1 custom-scrollbar h-full min-h-[100px]">
                    {colTasks.map(task => (
                        <div
                        key={task.id}
                        draggable
                        onDragStart={(e) => onDragStart(e, task.id)}
                        onClick={() => onEditTask(task)}
                        className={`p-4 rounded-lg border hover:shadow-lg cursor-pointer active:cursor-grabbing group relative overflow-hidden transition-all 
                            ${isCompletedCol ? 'bg-slate-800/50 border-slate-700 opacity-70 hover:opacity-100' : 'bg-slate-700 border-slate-600 hover:border-indigo-500'}
                        `}
                        >
                        <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                            task.type === 'Incidente' ? 'bg-rose-500' : task.type === 'Melhoria' ? 'bg-emerald-500' : 'bg-indigo-500'
                        }`}></div>

                        <div className="flex justify-between items-start mb-2 pl-2">
                            <span className="text-[10px] text-slate-400 font-mono tracking-wide uppercase">{task.id}</span>
                            <Badge type={task.priority} />
                        </div>
                        
                        <h4 className={`text-sm font-medium mb-3 pl-2 line-clamp-3 ${isCompletedCol ? 'text-slate-400 line-through' : 'text-slate-100'}`}>{task.summary}</h4>
                        
                        <div className="flex justify-between items-end pl-2 mt-auto">
                            <div className="flex flex-col gap-1">
                                <Badge type={task.type} />
                                <span className="text-[10px] text-slate-500 mt-1">{task.status}</span>
                            </div>
                            {task.estimatedTime && (
                                <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded">
                                    <IconClock className="w-3 h-3" /> {task.estimatedTime}
                                </div>
                            )}
                        </div>
                        </div>
                    ))}
                    {colTasks.length === 0 && (
                        <div className="h-20 flex items-center justify-center text-slate-600 text-xs italic border-2 border-dashed border-slate-700/50 rounded-lg">
                            Arraste tarefas aqui
                        </div>
                    )}
                </div>
                </div>
            )
          })}
        </div>
      </div>
    </div>
  );
};

// --- List View ---

const ListView = ({ tasks, setTasks, devs, onEditTask, user }: { tasks: Task[], setTasks: any, devs: Developer[], onEditTask: (task: Task) => void, user: User }) => {
  const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], status: string[], assignee: string[]}>({ 
      search: '', 
      type: [], 
      priority: [], 
      status: [], 
      assignee: [] 
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  
  const filtered = tasks.filter(t => {
      const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) ||
                            t.id.toLowerCase().includes(filters.search.toLowerCase()) ||
                            (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
      
      const matchesType = filters.type.length === 0 || filters.type.includes(t.type);
      const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
      const matchesStatus = filters.status.length === 0 || filters.status.includes(t.status);
      
      let matchesAssignee = true;
      if (filters.assignee.length > 0) {
          const hasUnassigned = filters.assignee.includes('Não Atribuído');
          if (hasUnassigned) {
              matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee);
          } else {
              matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee);
          }
      }

      return matchesSearch && matchesType && matchesPriority && matchesStatus && matchesAssignee;
  });

  const toggleSelect = (id: string) => {
      const newSelected = new Set(selected);
      if (newSelected.has(id)) newSelected.delete(id);
      else newSelected.add(id);
      setSelected(newSelected);
  };

  const handleBulkAction = (action: string, payload?: any) => {
      if (selected.size === 0) return;

      // --- Overload Check for Bulk Assign ---
      if (action === 'assign' && payload) {
          const currentHours = getDevWorkload(payload, tasks);
          if (currentHours > 40) {
               if (!window.confirm(`ALERTA DE SOBRECARGA: ${payload} já possui ${formatDuration(currentHours)} em tarefas pendentes. \n\nDeseja atribuir mais ${selected.size} tarefas mesmo assim?`)) {
                   return;
               }
          }
      }

      const updated = tasks.map(t => {
          if (selected.has(t.id)) {
              if (action === 'delete') return null;
              
              let updatedTask = { ...t };
              let actionName = '';

              if (action === 'status') {
                   updatedTask.status = payload;
                   actionName = `Alterou Status (Em massa) para ${payload}`;
              }
              if (action === 'priority') {
                  updatedTask.priority = payload;
                  actionName = `Alterou Prioridade (Em massa) para ${payload}`;
              }
              if (action === 'assign') {
                   updatedTask.assignee = payload;
                   actionName = `Atribuiu (Em massa) para ${payload}`;
              }
              
              if (actionName) {
                  const entry: HistoryEntry = {
                      id: Math.random().toString(36).substr(2, 9),
                      date: new Date().toISOString(),
                      user: user.name,
                      action: actionName
                  };
                  updatedTask.history = [...(t.history || []), entry];
              }

              return updatedTask;
          }
          return t;
      }).filter(Boolean) as Task[];
      
      setTasks(updated);
      StorageService.saveTasks(updated);
      setSelected(new Set());
  };

  const exportToExcel = () => {
    const ws = XLSX.utils.json_to_sheet(filtered);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Demandas");
    XLSX.writeFile(wb, "Nexus_Demandas.xlsx");
  };

  return (
    <div className="space-y-4 h-full flex flex-col">
      <FilterBar filters={filters} setFilters={setFilters} devs={devs} />

      <div className="flex flex-wrap justify-between items-center gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
        <div className="flex gap-2 items-center w-full">
             {selected.size > 0 ? (
                 <>
                    <span className="text-sm text-slate-300 mr-2">{selected.size} selecionados</span>
                    <select className="bg-slate-700 text-xs rounded px-2 py-2 outline-none" onChange={(e) => handleBulkAction('status', e.target.value)}>
                        <option value="">Mudar Status</option>
                        <option value="Novo">Novo</option>
                        <option value="Em Atendimento">Em Atendimento</option>
                        <option value="Resolvido">Resolvido</option>
                    </select>
                    <select className="bg-slate-700 text-xs rounded px-2 py-2 outline-none" onChange={(e) => handleBulkAction('assign', e.target.value)}>
                        <option value="">Atribuir Dev</option>
                        {devs.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
                    </select>
                    <Button variant="danger" onClick={() => handleBulkAction('delete')} className="text-xs py-2 px-3">Excluir</Button>
                 </>
             ) : <div className="text-sm text-slate-500">Selecione itens para ações em massa</div>}
             <div className="flex-1"></div>
             <Button onClick={exportToExcel} variant="success" className="text-sm py-2"><IconDownload /> Excel</Button>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex-1">
        <div className="overflow-auto h-full">
            <table className="w-full text-left text-sm">
            <thead className="bg-slate-900 text-slate-400 font-medium sticky top-0 z-10 shadow-md">
                <tr>
                <th className="p-4 w-10 bg-slate-900"><input type="checkbox" onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map(t => t.id)) : new Set())} /></th>
                <th className="p-4 bg-slate-900">ID</th>
                <th className="p-4 bg-slate-900">Tipo</th>
                <th className="p-4 w-1/3 bg-slate-900">Título</th>
                <th className="p-4 bg-slate-900">Prioridade</th>
                <th className="p-4 bg-slate-900">Status</th>
                <th className="p-4 bg-slate-900">Atribuído</th>
                <th className="p-4 text-right bg-slate-900">Ações</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-slate-700">
                {filtered.map(task => (
                <tr key={task.id} className="hover:bg-slate-700/30 transition-colors group">
                    <td className="p-4"><input type="checkbox" checked={selected.has(task.id)} onChange={() => toggleSelect(task.id)} /></td>
                    <td className="p-4 font-mono text-slate-500 group-hover:text-slate-300">{task.id}</td>
                    <td className="p-4"><Badge type={task.type} /></td>
                    <td className="p-4 font-medium text-slate-200">{task.summary}</td>
                    <td className="p-4"><Badge type={task.priority} /></td>
                    <td className="p-4 text-slate-300">{task.status}</td>
                    <td className="p-4 text-slate-400">{task.assignee || '-'}</td>
                    <td className="p-4 text-right">
                         <button 
                            onClick={() => onEditTask(task)} 
                            className="text-indigo-400 hover:text-indigo-300 text-xs font-medium px-2 py-1 rounded border border-indigo-900/50 hover:bg-indigo-900/20"
                         >
                             Editar
                         </button>
                    </td>
                </tr>
                ))}
            </tbody>
            </table>
        </div>
      </div>
    </div>
  );
};

// --- Layout ---

const Layout = ({ children, user, onLogout, headerContent }: any) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const menuItems = [
    { path: '/', icon: <IconHome className="w-5 h-5" />, label: 'Dashboard' },
    { path: '/projects', icon: <IconProject className="w-5 h-5" />, label: 'Projetos' },
    { path: '/kanban', icon: <IconKanban className="w-5 h-5" />, label: 'Kanban' },
    { path: '/list', icon: <IconList className="w-5 h-5" />, label: 'Lista' },
    { path: '/gantt', icon: <IconClock className="w-5 h-5" />, label: 'Gantt' },
  ];

  return (
    <div className="flex h-screen bg-dark-900 text-slate-200 font-sans">
      <aside 
        className={`${isCollapsed ? 'w-20' : 'w-64'} bg-slate-800/50 backdrop-blur-lg border-r border-slate-700 flex flex-col z-50 transition-all duration-300 ease-in-out relative`}
      >
        <button 
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="absolute -right-3 top-9 bg-indigo-600 text-white p-1 rounded-full shadow-lg hover:bg-indigo-700 transition-colors z-50"
        >
            <IconChevronLeft className={`w-3 h-3 transform transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} />
        </button>

        <div className={`p-6 border-b border-slate-700 flex items-center gap-3 h-20 ${isCollapsed ? 'justify-center px-0' : ''}`}>
          <div className="w-8 h-8 flex-shrink-0 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-lg shadow-lg shadow-indigo-500/50"></div>
          <h1 className={`text-xl font-bold tracking-tight text-white overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>Nexus</h1>
        </div>

        <nav className="flex-1 p-4 space-y-2 mt-4">
          {menuItems.map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              title={isCollapsed ? item.label : ''}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group ${
                location.pathname === item.path 
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' 
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
              } ${isCollapsed ? 'justify-center px-0' : ''}`}
            >
              {item.icon}
              <span className={`font-medium transition-all duration-300 overflow-hidden ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>
                  {item.label}
              </span>
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-slate-700 bg-slate-900/30">
            <div 
              onClick={() => navigate('/profile')}
              className={`flex items-center gap-3 mb-4 cursor-pointer hover:bg-slate-800 p-2 rounded-lg transition-colors ${isCollapsed ? 'justify-center' : ''}`}
            >
                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-indigo-300 border border-slate-600 overflow-hidden flex-shrink-0">
                    {user.avatar ? (
                        <img src={user.avatar} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                        user.name.substring(0, 2).toUpperCase()
                    )}
                </div>
                <div className={`overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>
                    <p className="text-sm font-medium text-white truncate">{user.name}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                </div>
            </div>
            <Button 
                variant="danger" 
                onClick={onLogout} 
                className={`w-full justify-center text-xs py-2 ${isCollapsed ? 'px-0' : ''}`}
                title={isCollapsed ? 'Sair' : ''}
            >
                {isCollapsed ? (
                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" />
                    </svg>
                ) : 'Sair'}
            </Button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden relative flex flex-col">
         <header className="h-16 bg-dark-900/90 backdrop-blur-sm flex items-center justify-end px-6 lg:px-10 z-30 sticky top-0 border-b border-slate-800">
             <div className="pointer-events-auto">
                 {headerContent}
             </div>
         </header>
         
         <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/10 via-dark-900 to-emerald-900/10 pointer-events-none" />
         <div className="flex-1 overflow-auto p-6 lg:p-10 z-10 relative">
             {children}
         </div>
      </main>
    </div>
  );
};

const AuthPage = ({ onLogin }: { onLogin: (user: User) => void }) => {
    const [isRegister, setIsRegister] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (isRegister) {
            if (!email || !password || !name) {
                setError('Todos os campos são obrigatórios');
                return;
            }
            const newUser: User = { id: Date.now().toString(), email, name, password };
            const success = StorageService.registerUser(newUser);
            if (success) {
                alert('Conta criada com sucesso! Faça login.');
                setIsRegister(false);
            } else {
                setError('Email já cadastrado.');
            }
        } else {
            if (!email || !password) {
                 setError('Preencha email e senha');
                 return;
            }
            const user = StorageService.authenticateUser(email, password);
            if (user) {
                onLogin(user);
            } else {
                setError('Credenciais inválidas.');
            }
        }
    };

    return (
        <div className="h-screen flex items-center justify-center bg-dark-900 relative overflow-hidden">
            <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div>
            <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px]"></div>
            <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-emerald-600/10 rounded-full blur-[120px]"></div>

            <div className="w-full max-w-md p-10 bg-slate-800/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl z-10 relative">
                <div className="flex justify-center mb-6">
                    <div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-2xl shadow-2xl shadow-indigo-500/40 flex items-center justify-center">
                        <span className="text-3xl text-white font-bold">N</span>
                    </div>
                </div>
                <h2 className="text-3xl font-bold text-center mb-2 text-white">Nexus Project</h2>
                <p className="text-center text-slate-400 mb-8 text-sm">{isRegister ? 'Crie sua conta para começar' : 'Acesse sua conta'}</p>
                
                <form onSubmit={handleSubmit} className="space-y-5">
                    {isRegister && (
                         <div>
                            <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Nome Completo</label>
                            <input 
                                type="text" 
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                                placeholder="Seu nome"
                            />
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Email Corporativo</label>
                        <input 
                            type="email" 
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                            placeholder="nome@empresa.com"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Senha</label>
                        <input 
                            type="password" 
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all"
                            placeholder="••••••••"
                        />
                    </div>
                    
                    {error && <p className="text-rose-500 text-sm text-center">{error}</p>}

                    <Button type="submit" className="w-full justify-center py-3 text-lg shadow-lg shadow-indigo-500/40 hover:shadow-indigo-500/60">
                        {isRegister ? 'Cadastrar' : 'Entrar'}
                    </Button>
                    <div className="text-center">
                        <button type="button" onClick={() => { setIsRegister(!isRegister); setError(''); }} className="text-sm text-slate-500 hover:text-indigo-400 transition-colors">
                            {isRegister ? 'Já tem conta? Entrar' : 'Criar nova conta'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

const TaskModal = ({ task, developers, allTasks, onClose, onSave, onDelete, workflowConfig }: any) => {
    const [formData, setFormData] = useState<Task>(task || {
        id: '',
        type: 'Incidente',
        summary: '',
        description: '',
        priority: '3 - Moderada',
        status: 'Novo',
        assignee: null,
        estimatedTime: '',
        actualTime: '',
        startDate: '',
        endDate: '',
        projectData: { currentPhaseId: '1', phaseStatus: 'Não Iniciado', completedActivities: [] }
    });

    // Ensure projectData exists
    useEffect(() => {
        if (!formData.projectData) {
            setFormData(prev => ({
                ...prev,
                projectData: { currentPhaseId: '1', phaseStatus: 'Não Iniciado', completedActivities: [] }
            }));
        }
    }, []);

    // --- Auto-Calculate End Date Logic ---
    useEffect(() => {
        if (formData.startDate && formData.estimatedTime) {
            const hours = parseDuration(formData.estimatedTime);
            if (hours > 0) {
                const daysToAdd = Math.floor((hours - 0.1) / 8);
                const start = new Date(formData.startDate);
                const end = new Date(start);
                end.setDate(start.getDate() + daysToAdd);
                
                const endDateStr = end.toISOString().split('T')[0];
                
                if (endDateStr !== formData.endDate) {
                    setFormData(prev => ({ ...prev, endDate: endDateStr }));
                }
            }
        }
    }, [formData.startDate, formData.estimatedTime]);

    const handleChange = (e: any) => {
        const { name, value } = e.target;
        
        // --- Overload Check in Modal ---
        if (name === 'assignee' && value && allTasks) {
            const currentHours = getDevWorkload(value, allTasks, task.id);
            if (currentHours > 40) {
                alert(`NOTA: ${value} já possui ${formatDuration(currentHours)} em tarefas pendentes (Acima de 40h).`);
            }
        }

        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleProjectDataChange = (key: string, value: any) => {
        setFormData(prev => ({
            ...prev,
            projectData: {
                ...prev.projectData!,
                [key]: value
            }
        }));
    };

    const toggleActivity = (activity: string) => {
        const currentActivities = formData.projectData?.completedActivities || [];
        if (currentActivities.includes(activity)) {
            handleProjectDataChange('completedActivities', currentActivities.filter(a => a !== activity));
        } else {
            handleProjectDataChange('completedActivities', [...currentActivities, activity]);
        }
    };

    const isNewTask = !task.createdAt || task.id === '';
    const isProject = formData.type === 'Melhoria' || formData.type === 'Nova Automação';
    const currentPhase = workflowConfig.find((w: WorkflowPhase) => w.id === formData.projectData?.currentPhaseId) || workflowConfig[0];

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-900 rounded-t-2xl">
                    <h3 className="text-xl font-bold text-white">{isNewTask ? 'Nova Demanda' : 'Editar Demanda'}</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button>
                </div>
                <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar">
                    <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                             <div>
                                <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Número do Chamado (ID)</label>
                                <input 
                                    name="id" 
                                    value={formData.id} 
                                    onChange={handleChange} 
                                    placeholder="Ex: INC0012345"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono"
                                />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Solicitante</label>
                                <input 
                                    name="requester" 
                                    value={formData.requester || ''} 
                                    onChange={handleChange} 
                                    placeholder="Nome do Solicitante"
                                    className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Descrição da Solicitação</label>
                            <textarea 
                                name="summary" 
                                value={formData.summary} 
                                onChange={handleChange} 
                                rows={3}
                                className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none" 
                            />
                        </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Tipo</label>
                            <select name="type" value={formData.type} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500">
                                <option value="Incidente">Incidente</option>
                                <option value="Melhoria">Melhoria</option>
                                <option value="Nova Automação">Nova Automação</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Prioridade</label>
                            <select name="priority" value={formData.priority} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500">
                                <option value="1 - Crítica">1 - Crítica</option>
                                <option value="2 - Alta">2 - Alta</option>
                                <option value="3 - Moderada">3 - Moderada</option>
                                <option value="4 - Baixa">4 - Baixa</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                             <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Desenvolvedor</label>
                             <select name="assignee" value={formData.assignee || ''} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500">
                                <option value="">Sem Atribuição</option>
                                {developers.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                             <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Status</label>
                             <select name="status" value={formData.status} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500">
                                <option value="Novo">Novo</option>
                                <option value="Pendente">Pendente</option>
                                <option value="Em Atendimento">Em Atendimento</option>
                                <option value="Em Progresso">Em Progresso</option>
                                <option value="Resolvido">Resolvido</option>
                                <option value="Fechado">Fechado</option>
                                <option value="Aguardando">Aguardando</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                        <div className="col-span-2 flex items-center gap-2 mb-2">
                             <IconClock className="w-4 h-4 text-indigo-400" />
                             <span className="text-xs text-indigo-300 font-bold">Planejamento Automático</span>
                             <span className="text-[10px] text-slate-500">(Data Fim calculada baseada no tempo estimado)</span>
                        </div>
                        <div>
                             <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Data Início</label>
                             <input type="date" name="startDate" value={formData.startDate || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                         <div>
                             <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Data Fim (Prevista)</label>
                             <input type="date" name="endDate" value={formData.endDate || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" />
                        </div>
                        <div>
                             <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Tempo Estimado</label>
                             <input name="estimatedTime" value={formData.estimatedTime || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="ex: 8h, 16h, 2d" />
                        </div>
                        <div>
                             <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider text-emerald-400">Tempo Real (Usado)</label>
                             <input name="actualTime" value={formData.actualTime || ''} onChange={handleChange} className="w-full bg-slate-800 border-emerald-500/50 border rounded p-2 text-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="ex: 2h" />
                        </div>
                    </div>

                    {/* Project Lifecycle Section - Only for Improvements/Automations */}
                    {isProject && (
                        <div className="bg-indigo-900/10 border border-indigo-500/30 p-4 rounded-lg">
                            <h4 className="text-sm font-bold text-indigo-300 mb-4 flex items-center gap-2">
                                <IconProject className="w-4 h-4" /> Ciclo de Vida do Projeto
                            </h4>
                            <div className="grid grid-cols-2 gap-4 mb-4">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Fase Atual</label>
                                    <select 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={formData.projectData?.currentPhaseId}
                                        onChange={(e) => {
                                            handleProjectDataChange('currentPhaseId', e.target.value);
                                            // Reset status when phase changes
                                            const newPhase = workflowConfig.find((w:any) => w.id === e.target.value);
                                            if (newPhase) handleProjectDataChange('phaseStatus', newPhase.statuses[0]);
                                        }}
                                    >
                                        {workflowConfig.map((p: WorkflowPhase) => (
                                            <option key={p.id} value={p.id}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Status da Fase</label>
                                    <select 
                                        className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500"
                                        value={formData.projectData?.phaseStatus}
                                        onChange={(e) => handleProjectDataChange('phaseStatus', e.target.value)}
                                    >
                                        {currentPhase.statuses.map((s: string) => (
                                            <option key={s} value={s}>{s}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                            
                            {currentPhase.activities.length > 0 && (
                                <div>
                                    <label className="block text-xs text-slate-400 mb-2 font-medium uppercase tracking-wider">Atividades da Fase</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {currentPhase.activities.map((activity: string) => {
                                            const isChecked = formData.projectData?.completedActivities.includes(activity);
                                            return (
                                                <div key={activity} className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-700/50 hover:border-slate-500 transition-colors cursor-pointer" onClick={() => toggleActivity(activity)}>
                                                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isChecked ? 'bg-indigo-500 border-indigo-500' : 'border-slate-500'}`}>
                                                        {isChecked && <IconCheck className="w-3 h-3 text-white" />}
                                                    </div>
                                                    <span className={`text-xs ${isChecked ? 'text-slate-200' : 'text-slate-400'}`}>{activity}</span>
                                                </div>
                                            )
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* History Section */}
                    {formData.history && formData.history.length > 0 && (
                        <div className="mt-6 border-t border-slate-700 pt-4">
                            <h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                                <IconClock className="w-4 h-4 text-indigo-400" /> Histórico de Alterações
                            </h4>
                            <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                                {formData.history.slice().reverse().map((entry: HistoryEntry) => (
                                    <div key={entry.id} className="text-xs bg-slate-900/60 p-3 rounded border border-slate-700/50 hover:border-slate-600 transition-colors">
                                        <div className="flex justify-between text-slate-500 mb-1">
                                            <span className="font-mono">{new Date(entry.date).toLocaleString()}</span>
                                            <span className="font-medium text-indigo-400">{entry.user}</span>
                                        </div>
                                        <p className="text-slate-300">{entry.action}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
                <div className="p-6 border-t border-slate-700 flex justify-between bg-slate-900 rounded-b-2xl">
                    <Button variant="danger" onClick={() => onDelete(formData.id)}>Excluir</Button>
                    <div className="flex gap-3">
                        <Button variant="secondary" onClick={onClose}>Cancelar</Button>
                        <Button onClick={() => onSave(formData)}>Salvar Alterações</Button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default function App() {
  const [user, setUser] = useState<User | null>(StorageService.getUser());
  const [tasks, setTasks] = useState<Task[]>(StorageService.getTasks());
  const [devs, setDevs] = useState<Developer[]>(StorageService.getDevs());
  
  // Workflow State
  const [workflowConfig, setWorkflowConfig] = useState<WorkflowPhase[]>(StorageService.getWorkflowConfig(DEFAULT_WORKFLOW));

  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManageDevsOpen, setIsManageDevsOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  const [uploadFiles, setUploadFiles] = useState<{ [key: string]: File | null }>({
      'Incidente': null,
      'Melhoria': null,
      'Nova Automação': null
  });

  const handleLogin = (loggedInUser: User) => {
    setUser(loggedInUser);
  };

  const handleLogout = () => {
    StorageService.logout();
    setUser(null);
  };

  const processNewTasks = (newTasks: Task[], typeName: string) => {
      const merged = StorageService.mergeTasks(newTasks);
      setTasks(merged);

      const uniqueAssignees = new Set(newTasks.map(t => t.assignee).filter(Boolean));
      const currentDevNames = new Set(devs.map(d => d.name));
      const newDevsToAdd: Developer[] = [];

      uniqueAssignees.forEach(name => {
          if (name && !currentDevNames.has(name as string)) {
              newDevsToAdd.push({ id: `dev-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name: name as string });
          }
      });

      if (newDevsToAdd.length > 0) {
          const updatedDevs = [...devs, ...newDevsToAdd];
          setDevs(updatedDevs);
          StorageService.saveDevs(updatedDevs);
      }
  };

  const handleProcessAllUploads = async () => {
     let allNewTasks: Task[] = [];
     
     try {
         if (uploadFiles['Incidente']) {
             const t = await ExcelService.parseFile(uploadFiles['Incidente'], 'Incidente');
             allNewTasks = [...allNewTasks, ...t];
         }
         if (uploadFiles['Melhoria']) {
            const t = await ExcelService.parseFile(uploadFiles['Melhoria'], 'Melhoria');
            allNewTasks = [...allNewTasks, ...t];
        }
        if (uploadFiles['Nova Automação']) {
            const t = await ExcelService.parseFile(uploadFiles['Nova Automação'], 'Nova Automação');
            allNewTasks = [...allNewTasks, ...t];
        }

        processNewTasks(allNewTasks, 'Todas');
        setIsUploadModalOpen(false);
        alert(`${allNewTasks.length} demandas processadas.`);
     } catch (e) {
         console.error(e);
         alert("Erro ao processar arquivos.");
     }
  };

  const handleProcessSingleUpload = async (type: TaskType) => {
      const file = uploadFiles[type];
      if (!file) return;

      try {
           const newTasks = await ExcelService.parseFile(file, type);
           processNewTasks(newTasks, type);
           alert(`${newTasks.length} demandas de ${type} processadas.`);
           setUploadFiles(prev => ({ ...prev, [type]: null }));
      } catch (e) {
          console.error(e);
          alert(`Erro ao processar ${type}.`);
      }
  }

  const handleAddDev = (name: string) => {
      if (name && !devs.find(d => d.name === name)) {
          const newDevs = [...devs, { id: `dev-${Date.now()}`, name }];
          setDevs(newDevs);
          StorageService.saveDevs(newDevs);
      }
  };

  const handleRemoveDev = (id: string) => {
      const newDevs = devs.filter(d => d.id !== id);
      setDevs(newDevs);
      StorageService.saveDevs(newDevs);
  };

  const handleCreateTask = () => {
      setEditingTask({
        id: '', // Empty to force manual input
        type: 'Incidente',
        summary: '',
        description: '',
        priority: '3 - Moderada',
        status: 'Novo',
        assignee: null,
        estimatedTime: '',
        actualTime: '',
        startDate: '',
        endDate: '',
        createdAt: new Date().toISOString(),
        requester: user?.name || 'Manual',
        projectData: { currentPhaseId: '1', phaseStatus: 'Não Iniciado', completedActivities: [] }
      });
  };

  const handleTaskUpdate = (updatedTask: Task) => {
      if (!user) return;
      
      if (!updatedTask.id) {
          alert("O número do chamado é obrigatório.");
          return;
      }

      const taskExists = tasks.some(t => t.id === updatedTask.id);

      if (taskExists) {
          const oldTask = tasks.find(t => t.id === updatedTask.id);
          if (oldTask) {
              const history = detectChanges(oldTask, updatedTask, user);
              if (history.length > 0) {
                  updatedTask.history = [...(oldTask.history || []), ...history];
              }
          }
          const newTasks = tasks.map(t => t.id === updatedTask.id ? updatedTask : t);
          setTasks(newTasks);
          StorageService.saveTasks(newTasks);
      } else {
          // Create new task
          const creationEntry: HistoryEntry = {
              id: Math.random().toString(36).substr(2, 9),
              date: new Date().toISOString(),
              user: user.name,
              action: 'Tarefa criada manualmente'
          };
          updatedTask.history = [creationEntry];
          const newTasks = [...tasks, updatedTask];
          setTasks(newTasks);
          StorageService.saveTasks(newTasks);
      }
      
      setEditingTask(null);
  };

  const handleTaskDelete = (id: string) => {
    if (window.confirm("Tem certeza?")) {
        const newTasks = tasks.filter(t => t.id !== id);
        setTasks(newTasks);
        StorageService.saveTasks(newTasks);
        setEditingTask(null);
    }
  };
  
  const handleResetData = () => {
      StorageService.clearTasks();
      setTasks([]);
      alert("Todas as demandas foram apagadas.");
  };

  if (!user) return <AuthPage onLogin={handleLogin} />;

  const headerActions = (
    <div className="flex gap-3 bg-slate-800/80 p-1 rounded-lg backdrop-blur-md border border-slate-700">
        <Button onClick={handleCreateTask} variant="primary" className="text-xs py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white border-none"><IconPlus className="w-4 h-4" /> Nova Demanda</Button>
        <div className="w-px bg-slate-700 h-6 self-center"></div>
        <Button onClick={() => setIsManageDevsOpen(true)} variant="secondary" className="text-xs py-1.5 bg-transparent border-none hover:bg-slate-700 text-slate-300"><IconUsers className="w-4 h-4" /> Devs</Button>
        <Button onClick={() => setIsUploadModalOpen(true)} className="text-xs py-1.5"><IconUpload className="w-4 h-4" /> Upload</Button>
    </div>
  );

  return (
    <HashRouter>
      <Layout user={user} onLogout={handleLogout} headerContent={headerActions}>
        
        {/* Modals */}
        {isUploadModalOpen && (
             <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
                 <div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 max-w-xl w-full shadow-2xl">
                     <h3 className="text-xl font-bold mb-6 text-white">Importar Planilhas</h3>
                     <div className="space-y-6">
                         {['Incidente', 'Melhoria', 'Nova Automação'].map(type => (
                             <div key={type} className="flex items-end gap-3">
                                 <div className="flex-1">
                                     <label className="block text-sm text-slate-400 mb-1">{type}</label>
                                     <input 
                                        type="file" 
                                        accept=".xlsx, .xls"
                                        onChange={(e) => setUploadFiles({...uploadFiles, [type]: e.target.files?.[0] || null})} 
                                        className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-slate-700 file:text-white hover:file:bg-slate-600 cursor-pointer border border-slate-600 rounded-lg"
                                     />
                                 </div>
                                 <Button 
                                    onClick={() => handleProcessSingleUpload(type as TaskType)} 
                                    disabled={!uploadFiles[type]} 
                                    className="h-10 text-xs"
                                    variant="secondary"
                                 >
                                     Processar
                                 </Button>
                             </div>
                         ))}
                     </div>
                     <div className="mt-8 flex justify-end gap-3 border-t border-slate-700 pt-4">
                         <Button variant="secondary" onClick={() => setIsUploadModalOpen(false)}>Cancelar</Button>
                         <Button onClick={handleProcessAllUploads} disabled={!Object.values(uploadFiles).some(f => f !== null)}>Processar Tudo</Button>
                     </div>
                 </div>
             </div>
        )}

        {isManageDevsOpen && (
            <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
                <div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 max-w-md w-full">
                    <h3 className="text-lg font-bold mb-4 text-white">Gerenciar Desenvolvedores</h3>
                    <ul className="space-y-2 mb-4 max-h-60 overflow-y-auto custom-scrollbar">
                        {devs.map(d => (
                            <li key={d.id} className="flex justify-between items-center bg-slate-900 p-2 rounded border border-slate-700">
                                <span className="text-sm text-white">{d.name}</span>
                                <button onClick={() => handleRemoveDev(d.id)} className="text-rose-500 hover:text-rose-400">✕</button>
                            </li>
                        ))}
                    </ul>
                    <div className="flex gap-2">
                        <input id="newDevInput" type="text" placeholder="Nome..." className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 text-sm text-white outline-none" />
                        <Button onClick={() => {
                            const input = document.getElementById('newDevInput') as HTMLInputElement;
                            handleAddDev(input.value);
                            input.value = '';
                        }} variant="success" className="py-1">+</Button>
                    </div>
                    <div className="mt-4 flex justify-end">
                         <Button variant="secondary" onClick={() => setIsManageDevsOpen(false)}>Fechar</Button>
                    </div>
                </div>
            </div>
        )}

        {editingTask && (
            <TaskModal 
                task={editingTask} 
                developers={devs} 
                allTasks={tasks}
                workflowConfig={workflowConfig}
                onClose={() => setEditingTask(null)} 
                onSave={handleTaskUpdate} 
                onDelete={handleTaskDelete} 
            />
        )}

        <Routes>
          <Route path="/" element={<DashboardView tasks={tasks} devs={devs} />} />
          <Route path="/projects" element={<ProjectFlowView tasks={tasks} setTasks={setTasks} devs={devs} onEditTask={setEditingTask} user={user} workflowConfig={workflowConfig} setWorkflowConfig={setWorkflowConfig} />} />
          <Route path="/kanban" element={<KanbanView tasks={tasks} setTasks={setTasks} devs={devs} onEditTask={setEditingTask} user={user} />} />
          <Route path="/list" element={<ListView tasks={tasks} setTasks={setTasks} devs={devs} onEditTask={setEditingTask} user={user} />} />
          <Route path="/gantt" element={<GanttView tasks={tasks} devs={devs} />} />
          <Route path="/profile" element={<UserProfile user={user} setUser={setUser} onResetData={handleResetData} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
