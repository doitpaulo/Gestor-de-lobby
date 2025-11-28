
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, LabelList, ComposedChart, Line, AreaChart, Area, LineChart 
} from 'recharts';
import * as XLSX from 'xlsx';
import pptxgen from 'pptxgenjs';
import { StorageService } from './services/storageService';
import { ExcelService } from './services/excelService';
import { Task, Developer, User, TaskType, Priority, HistoryEntry, WorkflowPhase } from './types';
import { IconHome, IconKanban, IconList, IconUpload, IconDownload, IconUsers, IconClock, IconChevronLeft, IconPlus, IconProject, IconCheck, IconChartBar } from './components/Icons';

// --- Constants ---
const TASK_TYPES = ['Incidente', 'Melhoria', 'Nova Automação'];
const PRIORITIES = ['1 - Crítica', '2 - Alta', '3 - Moderada', '4 - Baixa'];
const STATUSES = ['Novo', 'Pendente', 'Em Atendimento', 'Em Progresso', 'Resolvido', 'Fechado', 'Aguardando', 'Concluído', 'Backlog'];

const DEFAULT_WORKFLOW: WorkflowPhase[] = [
    {
        id: '1',
        name: 'Assessment',
        statuses: [
            'Não iniciado', 
            'Concluído', 
            'Aguardando Aprovação CoE', 
            'Em andamento', 
            'Despriorizado CoE', 
            'Cancelado',
            'Validar Business Case',
            'Elaborar Business Case'
        ],
        activities: ['Validar Business Case', 'Elaborar Business Case']
    },
    {
        id: '2',
        name: 'Fluxograma do Processo',
        statuses: [
            'Não iniciado', 
            'Concluído', 
            'Em andamento',
            'Elaborar desenho AS-IS',
            'Validar desenho AS-IS',
            'Elaborar desenho TO-BE',
            'Validar desenho TO-BE'
        ],
        activities: ['Elaborar desenho AS-IS', 'Validar desenho AS-IS', 'Elaborar desenho TO-BE', 'Validar desenho TO-BE']
    },
    {
        id: '3',
        name: 'Especificação do Processo',
        statuses: [
            'Não iniciado', 
            'Concluído',
            'Elaborar PDD/BA',
            'Validar PDD/BA + DEV',
            'Elaborar DoR/BA',
            'Validar DoR/BA + DEV',
            'Elaborar SDD/DEV',
            'Validar SDD/DEV'
        ],
        activities: ['Elaborar PDD/BA', 'Validar PDD/BA + DEV', 'Elaborar DoR/BA', 'Validar DoR/BA + DEV', 'Elaborar SDD/DEV', 'Validar SDD/DEV']
    },
    {
        id: '4',
        name: 'Desenvolvimento',
        statuses: [
            'Não iniciado', 
            'Concluído',
            'Elaborar DoD – BA',
            'Validar DoD – BA / DEV / DEV SR',
            'Elaborar Plano de Teste QA/DEV'
        ],
        activities: ['Elaborar DoD – BA', 'Validar DoD – BA / DEV / DEV SR', 'Elaborar Plano de Teste QA/DEV']
    },
    {
        id: '5',
        name: 'QA | Homologação | Prod',
        statuses: [
            'Não iniciado', 
            'Concluído',
            'Executar QA',
            'Executar Homologação',
            'Executar Produção',
            'Acompanhar Primeiras Execuções',
            'Validar QA / Homologação / Produção'
        ],
        activities: ['Executar QA', 'Executar Homologação', 'Executar Produção', 'Acompanhar Primeiras Execuções', 'Validar QA / Homologação / Produção']
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
    const textFields = ['summary', 'requester', 'estimatedTime', 'actualTime', 'startDate', 'endDate', 'category', 'subcategory', 'type', 'projectPath'];
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

// --- Widget Interface ---

interface Widget {
    id: string;
    type: string;
    title: string;
    size: 'half' | 'full';
    visible: boolean;
    visualStyle?: 'bar' | 'pie' | 'line' | 'area';
}

// --- Project Report View ---

const DEFAULT_REPORT_WIDGETS: Widget[] = [
    { id: 'rw1', type: 'kpis', title: 'KPIs do Portfólio', size: 'full', visible: true },
    { id: 'rw2', type: 'phaseChart', title: 'Projetos Ativos por Fase', size: 'half', visible: true, visualStyle: 'bar' },
    { id: 'rw3', type: 'healthChart', title: 'Saúde do Portfólio', size: 'half', visible: true, visualStyle: 'pie' },
    { id: 'rw4', type: 'detailChart', title: 'Progresso Detalhado por Projeto', size: 'full', visible: true, visualStyle: 'bar' },
];

const ProjectReportView = ({ tasks, workflowConfig, devs }: { tasks: Task[], workflowConfig: WorkflowPhase[], devs: Developer[] }) => {
    
    const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], status: string[], assignee: string[]}>({ 
        search: '', 
        type: [], 
        priority: [], 
        status: [], 
        assignee: [] 
    });

    const [widgets, setWidgets] = useState<Widget[]>(() => {
        const saved = localStorage.getItem('nexus_report_widgets');
        return saved ? JSON.parse(saved) : DEFAULT_REPORT_WIDGETS;
    });
    const [isEditMode, setIsEditMode] = useState(false);

    useEffect(() => {
        localStorage.setItem('nexus_report_widgets', JSON.stringify(widgets));
    }, [widgets]);

    // 1. Filter Projects (Improvements / Automations) & Apply Filters
    const filteredProjects = useMemo(() => {
        return tasks.filter(t => {
            const isProjectType = t.type === 'Melhoria' || t.type === 'Nova Automação';
            if (!isProjectType) return false;

            const isCompleted = ['Concluído', 'Resolvido', 'Fechado'].includes(t.status);
            if (filters.status.length === 0 && isCompleted) return false;

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

    // 2. Metrics Calculation
    const metrics = useMemo(() => {
        const total = filteredProjects.length;
        
        const getProgress = (task: Task) => {
            if (['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) return 100;
            const currentId = task.projectData?.currentPhaseId;
            let index = workflowConfig.findIndex(w => w.id === currentId);
            if (index === -1) index = 0;
            const status = task.projectData?.phaseStatus?.toLowerCase() || '';
            const isCompleted = status.includes('concluído') || status.includes('concluido') || status.includes('finalizado');
            const completedPhases = index + (isCompleted ? 1 : 0);
            return Math.min(100, Math.round((completedPhases / workflowConfig.length) * 100));
        };

        const completedProjects = filteredProjects.filter(p => p.status === 'Concluído' || p.status === 'Resolvido').length;
        const totalProgress = filteredProjects.reduce((acc, p) => acc + getProgress(p), 0);
        const avgProgress = total > 0 ? Math.round(totalProgress / total) : 0;
        const stuckProjects = filteredProjects.filter(p => {
             const s = (p.projectData?.phaseStatus || '').toLowerCase();
             return s.includes('aguardando') || s.includes('despriorizado') || s.includes('cancelado');
        }).length;
        const activeProjects = total - completedProjects - stuckProjects;

        return { total, avgProgress, stuckProjects, activeProjects, completedProjects, getProgress };
    }, [filteredProjects, workflowConfig]);

    // 3. Chart Data
    const phaseData = useMemo(() => {
        return workflowConfig.map(phase => {
            const count = filteredProjects.filter(p => {
                const isProjectDone = ['Concluído', 'Resolvido', 'Fechado'].includes(p.status);
                if (isProjectDone) return false; 
                return (p.projectData?.currentPhaseId || '1') === phase.id;
            }).length;
            return { name: phase.name, value: count };
        });
    }, [filteredProjects, workflowConfig]);

    const projectProgressData = useMemo(() => {
        return filteredProjects.map(p => {
             const currentId = p.projectData?.currentPhaseId;
             const phase = workflowConfig.find(w => w.id === currentId) || workflowConfig[0];
             return {
                 name: p.summary,
                 phase: phase.name,
                 progress: metrics.getProgress(p),
                 dev: p.assignee || 'N/A'
             }
        }).sort((a,b) => b.progress - a.progress);
    }, [filteredProjects, workflowConfig, metrics]);

    const healthData = useMemo(() => {
        return [
            { name: 'Em Andamento', value: metrics.activeProjects, color: '#10b981' }, 
            { name: 'Travados / Aguardando', value: metrics.stuckProjects, color: '#f59e0b' }, 
            { name: 'Concluídos', value: metrics.completedProjects, color: '#6366f1' } 
        ].filter(d => d.value > 0);
    }, [metrics]);

    const handleExportReportPPT = () => {
        const pres = new pptxgen();
        pres.layout = 'LAYOUT_WIDE';
        let slide = pres.addSlide();
        slide.background = { color: "0f172a" };
        slide.addText("Report Detalhado de Projetos", { x: 1, y: 0.5, fontSize: 24, color: 'FFFFFF', bold: true });
        
        slide.addText("Total: " + metrics.total, { x: 1, y: 1.5, fontSize: 18, color: 'FFFFFF' });
        slide.addText("Média Conclusão: " + metrics.avgProgress + "%", { x: 4, y: 1.5, fontSize: 18, color: 'FFFFFF' });
        slide.addText("Travados: " + metrics.stuckProjects, { x: 7, y: 1.5, fontSize: 18, color: 'FFFFFF' });

        if (phaseData.length > 0) {
             slide.addChart(pres.ChartType.bar, [
                 { name: 'Fases', labels: phaseData.map(p => p.name), values: phaseData.map(p => p.value) }
             ], { x: 1, y: 2.5, w: '45%', h: '60%', chartColors: ['6366f1'], barDir: 'col', title: 'Distribuição por Fase' });
        }

        if (healthData.length > 0) {
             slide.addChart(pres.ChartType.doughnut, [
                 { name: 'Saúde', labels: healthData.map(h => h.name), values: healthData.map(h => h.value) }
             ], { 
                 x: 7, y: 2.5, w: '40%', h: '60%', 
                 showLegend: true, 
                 chartColors: healthData.map(h => h.color.replace('#', '')) 
             });
        }

        slide = pres.addSlide();
        slide.background = { color: "0f172a" };
        slide.addText("Progresso Detalhado por Projeto", { x: 0.5, y: 0.5, fontSize: 20, color: 'FFFFFF', bold: true });

        const projNames = projectProgressData.map(p => p.name.substring(0, 20) + (p.name.length > 20 ? '...' : ''));
        const projVals = projectProgressData.map(p => p.progress);

        if (projNames.length > 0) {
            slide.addChart(pres.ChartType.bar, [{
                name: '% Conclusão',
                labels: projNames,
                values: projVals
            }], { 
                x: 0.5, y: 1, w: '90%', h: '85%', 
                barDir: 'bar', 
                valAxisMaxVal: 100, 
                chartColors: ['10b981'],
                catAxisLabelColor: '94a3b8',
                valAxisLabelColor: '94a3b8'
            });
        } else {
             slide.addText("Nenhum projeto ativo encontrado.", { x: 1, y: 3, fontSize: 14, color: '94a3b8' });
        }
        pres.writeFile({ fileName: "Nexus_ProjectReport_Detail.pptx" });
    }

    const toggleSize = (id: string) => {
        setWidgets(prev => prev.map(w => w.id === id ? { ...w, size: w.size === 'full' ? 'half' : 'full' } : w));
    };
    const toggleVisibility = (id: string) => {
        setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w));
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
    const changeVisualStyle = (id: string, style: any) => {
        setWidgets(prev => prev.map(w => w.id === id ? { ...w, visualStyle: style } : w));
    };

    const renderWidget = (widget: Widget) => {
        const ChartContainer = ResponsiveContainer;
        
        if (widget.type === 'kpis') {
            return (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 h-full">
                    <Card className="bg-indigo-900/10 border-indigo-500/30 flex flex-col justify-center">
                        <span className="text-indigo-400 text-xs font-bold uppercase">Total</span>
                        <span className="text-3xl text-white font-bold">{metrics.total}</span>
                    </Card>
                    <Card className="bg-emerald-900/10 border-emerald-500/30 flex flex-col justify-center">
                        <span className="text-emerald-400 text-xs font-bold uppercase">Média Avanço</span>
                        <span className="text-3xl text-white font-bold">{metrics.avgProgress}%</span>
                    </Card>
                    <Card className="bg-amber-900/10 border-amber-500/30 flex flex-col justify-center">
                        <span className="text-amber-400 text-xs font-bold uppercase">Travados</span>
                        <span className="text-3xl text-white font-bold">{metrics.stuckProjects}</span>
                    </Card>
                    <Card className="bg-rose-900/10 border-rose-500/30 flex flex-col justify-center">
                        <span className="text-rose-400 text-xs font-bold uppercase">Ativos</span>
                        <span className="text-3xl text-white font-bold">{metrics.activeProjects}</span>
                    </Card>
                </div>
            );
        }

        const renderChart = () => {
            const style = widget.visualStyle || 'bar';
            
            if (widget.type === 'phaseChart') {
                if (style === 'pie') return (
                    <PieChart>
                         <Pie data={phaseData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#6366f1" label>
                            {phaseData.map((entry, index) => <Cell key={`cell-${index}`} fill={['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'][index % 5]} />)}
                         </Pie>
                         <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                         <Legend />
                    </PieChart>
                );
                if (style === 'line') return (
                    <LineChart data={phaseData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                        <XAxis dataKey="name" stroke="#94a3b8" />
                        <YAxis stroke="#94a3b8" />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                        <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={3} />
                    </LineChart>
                );
                if (style === 'area') return (
                    <AreaChart data={phaseData}>
                         <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                         <XAxis dataKey="name" stroke="#94a3b8" />
                         <YAxis stroke="#94a3b8" />
                         <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                         <Area type="monotone" dataKey="value" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                    </AreaChart>
                );
                // Default Bar
                return (
                    <BarChart data={phaseData} layout="vertical" margin={{ left: 40 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
                        <XAxis type="number" stroke="#94a3b8" />
                        <YAxis type="category" dataKey="name" stroke="#94a3b8" width={120} tick={{fontSize: 10}} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                        <Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={30}>
                             <LabelList dataKey="value" position="right" fill="#fff" />
                        </Bar>
                    </BarChart>
                );
            }

            if (widget.type === 'healthChart') {
                 // Logic for Health Chart types... similar structure
                 if (style === 'bar') return (
                     <BarChart data={healthData}>
                         <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                         <XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} />
                         <YAxis stroke="#94a3b8" />
                         <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                         <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {healthData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}
                         </Bar>
                     </BarChart>
                 );
                 // Default Pie
                 return (
                    <PieChart>
                        <Pie data={healthData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value" label>
                            {healthData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />)}
                        </Pie>
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                        <Legend />
                    </PieChart>
                 );
            }
            
            if (widget.type === 'detailChart') {
                return (
                    <BarChart data={projectProgressData} layout="vertical" margin={{ left: 20 }} barSize={20}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
                        <XAxis type="number" domain={[0, 100]} stroke="#94a3b8" />
                        <YAxis dataKey="name" type="category" width={150} stroke="#94a3b8" tick={{ fontSize: 10 }} />
                        <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} formatter={(val: number) => [`${val}%`, 'Conclusão']} />
                        <Bar dataKey="progress" fill="#10b981" radius={[0, 4, 4, 0]}>
                             <LabelList dataKey="progress" position="right" fill="#fff" fontSize={10} formatter={(val: any) => `${val}%`} />
                        </Bar>
                    </BarChart>
                )
            }
            return null;
        };

        return (
            <div className="h-full flex flex-col">
                 <div className="flex justify-between items-center mb-4">
                     <h3 className="text-lg font-bold text-white">{widget.title}</h3>
                     {isEditMode && widget.type !== 'kpis' && (
                         <select 
                            className="bg-slate-900 border border-slate-600 text-xs text-white rounded px-2 py-1 outline-none"
                            value={widget.visualStyle || 'bar'}
                            onChange={(e) => changeVisualStyle(widget.id, e.target.value)}
                         >
                             <option value="bar">Barras</option>
                             <option value="pie">Pizza</option>
                             <option value="line">Linha</option>
                             <option value="area">Área</option>
                         </select>
                     )}
                 </div>
                 <div className="flex-1 min-h-[300px]">
                     <ResponsiveContainer width="100%" height="100%">
                         {renderChart() as any}
                     </ResponsiveContainer>
                 </div>
            </div>
        )
    };

    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex justify-between items-center">
                <div>
                    <h2 className="text-2xl font-bold text-white">Report de Fluxo de Projetos</h2>
                    <p className="text-sm text-slate-400">Visão consolidada de Melhorias e Automações</p>
                </div>
                <div className="flex gap-2">
                     <Button onClick={() => setIsEditMode(!isEditMode)} variant={isEditMode ? "success" : "secondary"}>
                        {isEditMode ? 'Salvar Layout' : 'Editar Layout'}
                     </Button>
                    <Button onClick={handleExportReportPPT} variant="primary">
                        <IconDownload /> Exportar PPT
                    </Button>
                </div>
            </div>
            
            <FilterBar filters={filters} setFilters={setFilters} devs={devs} />

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 {widgets.filter(w => w.visible).map((widget, index) => (
                     <div key={widget.id} className={`${widget.size === 'full' ? 'md:col-span-2 lg:col-span-4' : 'md:col-span-1 lg:col-span-2'} relative group`}>
                         <Card className="h-full min-h-[350px]">
                             {renderWidget(widget)}
                         </Card>
                         {isEditMode && (
                             <div className="absolute top-2 right-2 flex flex-col gap-1 bg-slate-900/90 p-1 rounded z-20 opacity-0 group-hover:opacity-100 transition-opacity">
                                 {index > 0 && <button onClick={() => moveWidget(index, 'up')} className="p-1 text-white hover:text-indigo-400">↑</button>}
                                 {index < widgets.length - 1 && <button onClick={() => moveWidget(index, 'down')} className="p-1 text-white hover:text-indigo-400">↓</button>}
                                 <button onClick={() => toggleSize(widget.id)} className="p-1 text-white hover:text-emerald-400">↔</button>
                                 <button onClick={() => toggleVisibility(widget.id)} className="p-1 text-white hover:text-rose-400">✕</button>
                             </div>
                         )}
                     </div>
                 ))}
            </div>
            {isEditMode && widgets.some(w => !w.visible) && (
                <div className="bg-slate-800 p-4 rounded flex gap-2">
                    {widgets.filter(w => !w.visible).map(w => (
                        <button key={w.id} onClick={() => toggleVisibility(w.id)} className="bg-slate-700 px-3 py-1 rounded text-white text-xs">+ {w.title}</button>
                    ))}
                </div>
            )}
        </div>
    );
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
                let currentIndex = workflowConfig.findIndex(w => w.id === currentPhaseId);
                
                // Fallback to first if not found
                if (currentIndex === -1) currentIndex = 0;

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
    }
    
    const handleUpdatePhase = (updatedPhase: WorkflowPhase) => {
        const updated = workflowConfig.map(p => p.id === updatedPhase.id ? updatedPhase : p);
        setWorkflowConfig(updated);
        StorageService.saveWorkflowConfig(updated);
    }

    const handleDeletePhase = (phaseId: string) => {
        const updated = workflowConfig.filter(p => p.id !== phaseId);
        setWorkflowConfig(updated);
        StorageService.saveWorkflowConfig(updated);
    }

    // Helper to calculate progress accounting for completion
    const getProgress = (task: Task) => {
        // Logic: 100% if status is Completed
        if (['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) return 100;

        const currentId = task.projectData?.currentPhaseId;
        let index = workflowConfig.findIndex(w => w.id === currentId);
        
        // Fallback if phase ID not found (e.g. workflow config changed)
        if (index === -1) index = 0;

        const status = task.projectData?.phaseStatus?.toLowerCase() || '';
        const isCompleted = status.includes('concluído') || status.includes('concluido') || status.includes('finalizado');

        // If completed, we count this phase as done (index + 1)
        // If not, we count up to previous phase (index)
        const completedPhases = index + (isCompleted ? 1 : 0);
        
        // Cap at 100% just in case
        const percentage = Math.min(100, Math.round((completedPhases / workflowConfig.length) * 100));
        return percentage;
    };

    const handleExportExcel = () => {
        const exportData = filteredTasks.map(t => {
            const row: any = {
                'ID': t.id,
                'Projeto': t.summary,
                'Tipo': t.type,
                'Desenvolvedor': t.assignee || 'Não Atribuído',
                'Status Global': t.status
            };

            const progress = getProgress(t);
            let currentTaskPhaseIndex = workflowConfig.findIndex(w => w.id === (t.projectData?.currentPhaseId || '1'));
            if (currentTaskPhaseIndex === -1) currentTaskPhaseIndex = 0;

            // Add columns for each phase
            workflowConfig.forEach((phase, idx) => {
                const isActive = (t.projectData?.currentPhaseId || '1') === phase.id;
                const isPast = idx < currentTaskPhaseIndex;
                const isDone = progress === 100; // If 100%, all past phases + current are logically done

                let val = '';
                if (isActive) {
                    val = t.projectData?.phaseStatus || 'Não Iniciado';
                } else if (isPast || isDone) {
                    val = 'Concluído';
                } else {
                    val = 'Não Iniciado';
                }
                
                row[phase.name] = val;
            });
            
            // Add completion %
            row['% Conclusão'] = `${progress}%`;

            return row;
        });

        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Fluxo de Projetos");
        XLSX.writeFile(wb, "Nexus_FluxoProjetos.xlsx");
    }

    return (
        <div className="h-full flex flex-col space-y-4">
            <div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div>
                     <h2 className="text-xl font-bold text-white">Fluxo de Projetos</h2>
                     <p className="text-sm text-slate-400">Acompanhamento detalhado das fases de Melhorias e Automações</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleExportExcel} variant="success">
                        <IconDownload className="w-4 h-4" /> Excel
                    </Button>
                    <Button variant="secondary" onClick={() => setIsConfigOpen(true)}>
                        <IconPlus className="w-4 h-4" /> Configurar Fases
                    </Button>
                </div>
            </div>
            
            <FilterBar filters={filters} setFilters={setFilters} devs={devs} />

            <div className="flex-1 overflow-auto bg-slate-900/50 rounded-xl border border-slate-700 p-4 custom-scrollbar">
                <table className="w-full text-left text-sm border-separate border-spacing-y-2">
                    <thead>
                        <tr className="text-slate-400 font-medium text-xs uppercase tracking-wider">
                            <th className="pb-2 pl-2">Projeto</th>
                            {workflowConfig.map(phase => (
                                <th key={phase.id} className="pb-2 px-2 text-center min-w-[140px]">{phase.name}</th>
                            ))}
                            <th className="pb-2 text-center">% Conclusão</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredTasks.map(task => {
                             // Robust Index finding
                             let currentPhaseIndex = workflowConfig.findIndex(w => w.id === (task.projectData?.currentPhaseId || '1'));
                             if (currentPhaseIndex === -1) currentPhaseIndex = 0; // fallback

                             const progress = getProgress(task);
                             const isGlobalDone = ['Concluído', 'Resolvido', 'Fechado'].includes(task.status);

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
                                         const isCurrentPhase = (task.projectData?.currentPhaseId || '1') === phase.id || (task.projectData?.currentPhaseId === undefined && idx === 0);
                                         
                                         // If global done, everything is visually past/done
                                         const isActive = isCurrentPhase && !isGlobalDone; 
                                         const isPast = idx < currentPhaseIndex || isGlobalDone;
                                         const phaseStatus = isActive ? (task.projectData?.phaseStatus || 'Não Iniciado') : isPast ? 'Concluído' : 'Não iniciado';
                                         
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
                                         const statusLower = phaseStatus.toLowerCase();

                                         if (statusLower.includes('concluído') || statusLower.includes('concluido')) statusColor = "text-emerald-400";
                                         else if (statusLower.includes('andamento') || statusLower.includes('progresso')) statusColor = "text-indigo-400";
                                         else if (statusLower.includes('cancelado')) statusColor = "text-rose-400";
                                         else if (statusLower.includes('despriorizado')) statusColor = "text-rose-400 font-bold";
                                         else if (statusLower.includes('aguardando')) statusColor = "text-orange-400 font-bold";
                                         else if (statusLower.includes('validar')) statusColor = "text-blue-400";
                                         else if (statusLower.includes('elaborar') || statusLower.includes('executar')) statusColor = "text-yellow-400";

                                         return (
                                             <td key={phase.id} className={`p-2 border-y first:border-l last:border-r border-slate-700/50 text-center relative`}>
                                                 <div className={`w-full h-full p-2 rounded flex flex-col items-center justify-center border ${bgClass} min-h-[90px]`}>
                                                      <span className={`text-[10px] uppercase mb-1 leading-tight ${statusColor}`}>{phaseStatus}</span>
                                                      {isActive && (
                                                          <>
                                                            <select 
                                                                className="bg-slate-900 text-xs border border-slate-600 rounded px-1 py-0.5 max-w-[130px] outline-none mb-2"
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
                    <WorkflowEditor 
                        currentConfig={workflowConfig} 
                        onSave={handleAddPhase} 
                        onUpdate={handleUpdatePhase}
                        onDelete={handleDeletePhase}
                        onClose={() => setIsConfigOpen(false)} 
                    />
                </div>
            )}
        </div>
    )
};

const WorkflowEditor = ({ currentConfig, onSave, onUpdate, onDelete, onClose }: any) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [statuses, setStatuses] = useState('');
    const [activities, setActivities] = useState('');

    useEffect(() => {
        if (editingId) {
            const phase = currentConfig.find((p: WorkflowPhase) => p.id === editingId);
            if (phase) {
                setName(phase.name);
                setStatuses(phase.statuses.join(', '));
                setActivities(phase.activities.join(', '));
            }
        } else {
            setName('');
            setStatuses('Não Iniciado, Concluído');
            setActivities('');
        }
    }, [editingId, currentConfig]);

    const handleSubmit = () => {
        if (!name) return;
        const phaseData: WorkflowPhase = {
            id: editingId || `ph-${Date.now()}`,
            name,
            statuses: statuses.split(',').map(s => s.trim()).filter(Boolean),
            activities: activities.split(',').map(a => a.trim()).filter(Boolean)
        };
        
        if (editingId) {
            onUpdate(phaseData);
            setEditingId(null);
        } else {
            onSave(phaseData);
            setName('');
            setStatuses('Não Iniciado, Concluído');
            setActivities('');
        }
    };

    const handleDelete = (id: string) => {
        if (window.confirm('Tem certeza? Isso removerá a visualização desta fase de todos os projetos.')) {
            onDelete(id);
            if (editingId === id) setEditingId(null);
        }
    }

    return (
        <div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 max-w-4xl w-full flex flex-col md:flex-row gap-6 max-h-[90vh] overflow-hidden">
            {/* List of Phases */}
            <div className="flex-1 overflow-y-auto custom-scrollbar border-r border-slate-700 pr-4">
                 <h3 className="text-lg font-bold mb-4 text-white">Etapas Existentes</h3>
                 <div className="space-y-2">
                     {currentConfig.map((phase: WorkflowPhase, idx: number) => (
                         <div key={phase.id} className={`p-3 rounded border flex justify-between items-center ${editingId === phase.id ? 'bg-indigo-900/30 border-indigo-500' : 'bg-slate-900/50 border-slate-700'}`}>
                             <div>
                                 <span className="text-xs text-slate-500 font-mono mr-2">{idx + 1}.</span>
                                 <span className="font-medium text-slate-200">{phase.name}</span>
                                 <p className="text-[10px] text-slate-500 mt-1">{phase.statuses.length} status, {phase.activities.length} atividades</p>
                             </div>
                             <div className="flex gap-1">
                                 <button onClick={() => setEditingId(phase.id)} className="p-1.5 hover:bg-slate-700 rounded text-indigo-400">
                                     <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" /></svg>
                                 </button>
                                 <button onClick={() => handleDelete(phase.id)} className="p-1.5 hover:bg-slate-700 rounded text-rose-400">
                                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" /></svg>
                                 </button>
                             </div>
                         </div>
                     ))}
                 </div>
                 <div className="mt-4">
                     <Button variant="secondary" onClick={() => setEditingId(null)} className="w-full text-xs">
                         <IconPlus className="w-3 h-3" /> Adicionar Nova Fase
                     </Button>
                 </div>
            </div>

            {/* Form */}
            <div className="flex-1 flex flex-col">
                <h3 className="text-lg font-bold mb-4 text-white">{editingId ? 'Editar Fase' : 'Nova Fase'}</h3>
                <div className="space-y-4 flex-1">
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Nome da Fase</label>
                        <input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Validação Final" />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Status Possíveis (separados por vírgula)</label>
                        <textarea className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" value={statuses} onChange={e => setStatuses(e.target.value)} rows={3} placeholder="Não Iniciado, Em Andamento, Concluído..." />
                    </div>
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Atividades (separadas por vírgula)</label>
                        <textarea className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" value={activities} onChange={e => setActivities(e.target.value)} rows={3} placeholder="Criar Documento, Validar com Cliente..." />
                    </div>
                </div>
                <div className="flex justify-end gap-2 mt-6">
                    <Button variant="secondary" onClick={onClose}>Fechar</Button>
                    <Button onClick={handleSubmit}>{editingId ? 'Atualizar' : 'Adicionar'}</Button>
                </div>
            </div>
        </div>
    );
};

// --- Dashboard View ---

const DEFAULT_WIDGETS: Widget[] = [
    { id: 'w1', type: 'cards', title: 'KPIs Gerais (Ativos)', size: 'full', visible: true },
    { id: 'w2', type: 'priority', title: 'Demandas por Prioridade', size: 'half', visible: true, visualStyle: 'bar' },
    { id: 'w3', type: 'status', title: 'Status x Tipo de Demanda', size: 'half', visible: true, visualStyle: 'bar' },
    { id: 'w4', type: 'devType', title: 'Demanda por Desenvolvedor', size: 'half', visible: true, visualStyle: 'bar' },
    { id: 'w5', type: 'capacity', title: 'Capacidade & Disponibilidade', size: 'half', visible: true },
    { id: 'w6', type: 'completedKPIs', title: 'Total Concluído', size: 'full', visible: true },
    { id: 'w7', type: 'incidentByAuto', title: 'Top Automações com Incidentes', size: 'full', visible: true, visualStyle: 'bar' }
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
        {total > 0 && (
            <div className="border-t border-slate-700 mt-2 pt-1 flex justify-between items-center">
                <span className="text-slate-400 text-xs">Total</span>
                <span className="text-white font-bold">{total}</span>
            </div>
        )}
      </div>
    );
  }
  return null;
};

const DashboardView = ({ tasks, devs }: { tasks: Task[], devs: Developer[] }) => {
  const [widgets, setWidgets] = useState<Widget[]>(() => {
      const saved = localStorage.getItem('nexus_dashboard_widgets');
      // Merge default if new widget is not in saved
      if (saved) {
          const parsed = JSON.parse(saved);
          const hasIncidentAuto = parsed.find((w: Widget) => w.type === 'incidentByAuto');
          const hasCompletedKPIs = parsed.find((w: Widget) => w.type === 'completedKPIs');
          
          let merged = [...parsed];
          if (!hasCompletedKPIs) merged.push(DEFAULT_WIDGETS.find(w => w.type === 'completedKPIs'));
          if (!hasIncidentAuto) merged.push(DEFAULT_WIDGETS.find(w => w.type === 'incidentByAuto'));
          
          return merged;
      }
      return DEFAULT_WIDGETS;
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

  // Completed Tasks for new KPI Widget
  const completedMetrics = useMemo(() => {
    const completed = tasks.filter(t => ['Concluído', 'Resolvido', 'Fechado'].includes(t.status));
    
    // Apply filters to completed items as well if needed, or keep global. 
    // Usually KPIs follow dashboard filters.
    const filteredCompleted = completed.filter(t => {
        const matchesDev = filterDev.length === 0 || filterDev.includes(t.assignee || '');
        const matchesType = filterType.length === 0 || filterType.includes(t.type);
        return matchesDev && matchesType;
    });

    return {
        incidents: filteredCompleted.filter(t => t.type === 'Incidente').length,
        features: filteredCompleted.filter(t => t.type === 'Melhoria').length,
        automations: filteredCompleted.filter(t => t.type === 'Nova Automação').length,
        total: filteredCompleted.length
    };
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

  // --- Incident by Automation Logic ---
  const incidentByAutoData = useMemo(() => {
    // For analysis of incidents, we usually want to see where the pain points are, 
    // including potentially closed tickets if we are looking for patterns.
    // However, Dashboard usually reflects current state. 
    // To be useful as "Analysis", we should probably include closed tickets if they match the filter criteria.
    // Let's use 'tasks' filtered by Dev, but specifically filtering for Type=Incidente.
    const relevantTasks = tasks.filter(t => {
         const matchesDev = filterDev.length === 0 || filterDev.includes(t.assignee || '');
         return t.type === 'Incidente' && matchesDev;
    });

    const counts: Record<string, number> = {};
    relevantTasks.forEach(t => {
        // Use subcategory as automation name, fallback to category or summary
        const name = t.subcategory || t.category || 'Não Classificado';
        counts[name] = (counts[name] || 0) + 1;
    });

    return Object.entries(counts)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10); // Top 10
  }, [tasks, filterDev]);

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

  const changeVisualStyle = (id: string, style: any) => {
      setWidgets(prev => prev.map(w => w.id === id ? { ...w, visualStyle: style } : w));
  };

  const exportPPT = () => {
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE';
    
    // Slide 1: Title
    let slide = pres.addSlide();
    slide.background = { color: "0f172a" };
    slide.addText("Relatório One Page Project", { x: 1, y: 2, w: '80%', fontSize: 36, color: 'FFFFFF', bold: true, align: 'center' });
    slide.addText(`Gerado em: ${new Date().toLocaleDateString()} - Visão Geral`, { x: 1, y: 3, w: '80%', fontSize: 18, color: '94a3b8', align: 'center' });

    // Slide 2: KPIs
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

    addChartSlide("Demandas por Prioridade", pres.ChartType.bar, priorityData.map(p => ({
        name: p.name, labels: [p.name], values: [p.value]
    })), { barDir: 'col', chartColors: ['8b5cf6'], valAxisMinVal: 0, valAxisLabelColor: '94a3b8', catAxisLabelColor: '94a3b8' });

    if (statusByTypeData.length > 0) {
        const statusLabels = statusByTypeData.map(s => s.name);
        addChartSlide("Distribuição de Status por Tipo", pres.ChartType.bar, [
            { name: 'Incidentes', labels: statusLabels, values: statusByTypeData.map(s => s.Incidente) },
            { name: 'Melhorias', labels: statusLabels, values: statusByTypeData.map(s => s.Melhoria) },
            { name: 'Automações', labels: statusLabels, values: statusByTypeData.map(s => s['Nova Automação']) }
        ], { barDir: 'col', barGrouping: 'stacked', showLegend: true, legendPos: 'b', valAxisLabelColor: '94a3b8', catAxisLabelColor: '94a3b8', chartColors: ['f43f5e', '10b981', '6366f1'] });
    }

    // Incident by Automation Slide
    if (incidentByAutoData.length > 0) {
         addChartSlide("Top Automações com Incidentes", pres.ChartType.bar, [{
             name: 'Incidentes',
             labels: incidentByAutoData.map(d => d.name),
             values: incidentByAutoData.map(d => d.value)
         }], { barDir: 'bar', chartColors: ['f43f5e'], valAxisLabelColor: '94a3b8', catAxisLabelColor: '94a3b8' });
    }

    pres.writeFile({ fileName: "Nexus_OnePageReport.pptx" });
  };

  const renderWidget = (widget: Widget) => {
      const style = widget.visualStyle || 'bar';

      const renderChartContent = () => {
          if (widget.type === 'priority') {
             if (style === 'pie') return (
                 <PieChart>
                     <Pie data={priorityData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                        {priorityData.map((entry, index) => <Cell key={`cell-${index}`} fill={['#8b5cf6', '#a855f7', '#d8b4fe', '#ddd6fe'][index % 4]} />)}
                     </Pie>
                     <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                 </PieChart>
             );
             return (
                <BarChart data={priorityData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#fff' }} cursor={{fill: '#334155', opacity: 0.4}} />
                    <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={40} />
                </BarChart>
             );
          }

          if (widget.type === 'incidentByAuto') {
              if (style === 'pie') return (
                  <PieChart>
                      <Pie data={incidentByAutoData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#f43f5e" label>
                          {incidentByAutoData.map((entry, index) => <Cell key={index} fill={['#f43f5e', '#fb7185', '#fda4af', '#e11d48'][index % 4]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                  </PieChart>
              );
              // Default Bar
              return (
                <BarChart data={incidentByAutoData} layout="vertical" margin={{ left: 40 }}>
                    <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" />
                    <XAxis type="number" stroke="#94a3b8" />
                    <YAxis type="category" dataKey="name" width={150} stroke="#94a3b8" tick={{fontSize: 10}} />
                    <Tooltip contentStyle={{ backgroundColor: '#1e293b' }} />
                    <Bar dataKey="value" fill="#f43f5e" radius={[0, 4, 4, 0]} barSize={20}>
                        <LabelList dataKey="value" position="right" fill="#fff" />
                    </Bar>
                </BarChart>
              );
          }

          if (widget.type === 'status') {
             // Stacked Bar (Default) or Area/Line
             return (
                 <BarChart data={statusByTypeData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }} barSize={40}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                    <XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} />
                    <YAxis stroke="#94a3b8" />
                    <Tooltip content={<CustomTooltip />} cursor={{fill: '#334155', opacity: 0.2}} />
                    <Legend wrapperStyle={{paddingTop: '10px'}} />
                    <Bar dataKey="Incidente" stackId="a" fill="#f43f5e"><LabelList dataKey="Incidente" content={renderCustomBarLabel} /></Bar>
                    <Bar dataKey="Melhoria" stackId="a" fill="#10b981"><LabelList dataKey="Melhoria" content={renderCustomBarLabel} /></Bar>
                    <Bar dataKey="Nova Automação" stackId="a" fill="#6366f1" radius={[4, 4, 0, 0]}><LabelList dataKey="Nova Automação" content={renderCustomBarLabel} /></Bar>
                </BarChart>
             );
          }

          if (widget.type === 'devType') {
              return (
                <ComposedChart data={devTypeData} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }} barSize={32}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} vertical={true} opacity={0.2} />
                    <XAxis type="number" stroke="#64748b" tick={{fontSize: 10}} hide />
                    <YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{fontSize: 12, fill: '#cbd5e1', fontWeight: 500}} width={150} interval={0} tickLine={false} axisLine={false} />
                    <Tooltip content={<CustomTooltip />} cursor={{fill: '#334155', opacity: 0.2}} />
                    <Legend wrapperStyle={{paddingTop: '10px'}} />
                    <Bar dataKey="Incidente" stackId="a" fill="#f43f5e" radius={[4, 0, 0, 4]}><LabelList dataKey="Incidente" content={renderCustomBarLabel} /></Bar>
                    <Bar dataKey="Melhoria" stackId="a" fill="#10b981"><LabelList dataKey="Melhoria" content={renderCustomBarLabel} /></Bar>
                    <Bar dataKey="Nova Automação" stackId="a" fill="#6366f1" radius={[0, 4, 4, 0]}><LabelList dataKey="Nova Automação" content={renderCustomBarLabel} /></Bar>
                    <Line dataKey="total" stroke="none" isAnimationActive={false}><LabelList dataKey="total" position="right" style={{ fill: "#94a3b8", fontSize: "12px", fontWeight: "bold" }} formatter={(val: any) => `Total: ${val}`} /></Line>
                </ComposedChart>
              );
          }
          return null;
      };

      return (
          <div className="h-full flex flex-col">
             <div className="flex justify-between items-center mb-4">
                 <h3 className="text-lg font-semibold text-slate-200">{widget.title}</h3>
                 <div className="flex items-center gap-2">
                     {isEditMode && ['priority', 'status', 'incidentByAuto'].includes(widget.type) && (
                         <select 
                            className="bg-slate-900 border border-slate-600 text-xs text-white rounded px-2 py-1 outline-none"
                            value={widget.visualStyle || 'bar'}
                            onChange={(e) => changeVisualStyle(widget.id, e.target.value)}
                         >
                             <option value="bar">Barras</option>
                             <option value="pie">Pizza</option>
                         </select>
                     )}
                     {isEditMode && (
                         <div className="flex items-center gap-1 bg-slate-900 rounded p-1">
                             <button onClick={() => toggleSize(widget.id)} className="p-1 hover:text-indigo-400 text-slate-400">↔</button>
                             <button onClick={() => toggleVisibility(widget.id)} className="p-1 hover:text-rose-400 text-slate-400">✕</button>
                         </div>
                     )}
                 </div>
             </div>
             
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
                 {widget.type === 'completedKPIs' && (
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4 h-full">
                        <div className="bg-indigo-900/10 p-4 rounded-lg border-t-2 border-indigo-500 flex flex-col justify-between">
                            <span className="text-indigo-300 text-xs uppercase font-bold">Total Concluído</span>
                            <span className="text-3xl font-bold text-white">{completedMetrics.total}</span>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-rose-800 flex flex-col justify-between opacity-80">
                            <span className="text-rose-300 text-xs uppercase font-bold">Incid. Fechados</span>
                            <span className="text-3xl font-bold text-slate-300">{completedMetrics.incidents}</span>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-emerald-800 flex flex-col justify-between opacity-80">
                            <span className="text-emerald-300 text-xs uppercase font-bold">Melhorias Entregues</span>
                            <span className="text-3xl font-bold text-slate-300">{completedMetrics.features}</span>
                        </div>
                        <div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-indigo-800 flex flex-col justify-between opacity-80">
                            <span className="text-indigo-300 text-xs uppercase font-bold">Automações Entregues</span>
                            <span className="text-3xl font-bold text-slate-300">{completedMetrics.automations}</span>
                        </div>
                     </div>
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
                 
                 {(widget.type === 'priority' || widget.type === 'status' || widget.type === 'devType' || widget.type === 'incidentByAuto') && (
                     <ResponsiveContainer width="100%" height="100%">
                         {renderChartContent() as any}
                     </ResponsiveContainer>
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

          <Button onClick={() => setIsEditMode(!isEditMode)} variant={isEditMode ? "success" : "secondary"}>
              {isEditMode ? 'Salvar Layout' : 'Editar Layout'}
          </Button>
          
          <Button onClick={exportPPT} variant="primary">
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
// ... (ListView remains same) ...
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

const GanttView = ({ tasks, devs }: { tasks: Task[], devs: Developer[] }) => {
  const ganttTasks = useMemo(() => {
      return tasks.filter(t => t.startDate && t.endDate && !['Concluído', 'Resolvido', 'Fechado'].includes(t.status))
          .sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());
  }, [tasks]);

  if (ganttTasks.length === 0) {
      return (
          <div className="h-full flex items-center justify-center text-slate-500">
              <div className="text-center">
                  <IconClock className="w-12 h-12 mx-auto mb-4 opacity-50" />
                  <p>Nenhuma tarefa ativa com datas definidas.</p>
                  <p className="text-sm">Defina Início e Fim nas tarefas para visualizar aqui.</p>
              </div>
          </div>
      );
  }

  // Calculate timeline bounds
  const dates = ganttTasks.flatMap(t => [new Date(t.startDate!), new Date(t.endDate!)]);
  const minDate = new Date(Math.min(...dates.map(d => d.getTime())));
  const maxDate = new Date(Math.max(...dates.map(d => d.getTime())));
  
  // Add padding (2 days before, 5 days after)
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 5);

  const totalTime = maxDate.getTime() - minDate.getTime();

  const getPos = (d: string) => {
      const diff = new Date(d).getTime() - minDate.getTime();
      return (diff / totalTime) * 100;
  }

  const getWidth = (start: string, end: string) => {
      const s = new Date(start).getTime();
      const e = new Date(end).getTime();
      return ((e - s) / totalTime) * 100;
  }

  return (
      <div className="h-full flex flex-col space-y-4">
           <div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div>
                   <h2 className="text-xl font-bold text-white">Cronograma (Gantt)</h2>
                   <p className="text-sm text-slate-400">Linha do tempo das demandas ativas</p>
              </div>
          </div>
          
          <div className="flex-1 bg-slate-900/50 rounded-xl border border-slate-700 p-4 overflow-hidden flex flex-col">
               {/* Header Dates */}
               <div className="flex justify-between text-xs text-slate-500 border-b border-slate-700 pb-2 mb-2">
                   <span>{minDate.toLocaleDateString()}</span>
                   <span>{maxDate.toLocaleDateString()}</span>
               </div>
               
               <div className="flex-1 overflow-y-auto custom-scrollbar relative space-y-3 pr-2">
                   {/* Grid Lines (Approximate) */}
                   <div className="absolute inset-0 flex pointer-events-none">
                       {[0, 25, 50, 75, 100].map(p => (
                           <div key={p} className="h-full border-l border-slate-800/50 absolute top-0 bottom-0" style={{ left: `${p}%` }}></div>
                       ))}
                   </div>

                   {ganttTasks.map(task => {
                       const left = getPos(task.startDate!);
                       const width = Math.max(getWidth(task.startDate!, task.endDate!), 0.5); // Min width
                       
                       let color = "bg-indigo-600";
                       if (task.type === 'Incidente') color = "bg-rose-600";
                       if (task.type === 'Melhoria') color = "bg-emerald-600";
                       if (task.priority === '1 - Crítica') color = "bg-red-600";

                       return (
                           <div key={task.id} className="relative h-10 flex items-center group">
                               <div className="absolute left-0 right-0 h-8 bg-slate-800/30 rounded flex items-center px-2">
                                    <span className="text-xs text-slate-400 w-32 truncate mr-2">{task.assignee || 'N/A'}</span>
                               </div>
                               <div 
                                    className={`absolute h-6 rounded shadow-lg flex items-center px-2 cursor-pointer hover:brightness-110 transition-all ${color}`}
                                    style={{ left: `${left}%`, width: `${width}%`, minWidth: '4px' }}
                                    title={`${task.summary} \n${new Date(task.startDate!).toLocaleDateString()} - ${new Date(task.endDate!).toLocaleDateString()}`}
                               >
                                   <span className="text-[10px] font-bold text-white truncate sticky left-0">{task.summary}</span>
                               </div>
                           </div>
                       )
                   })}
               </div>
          </div>
      </div>
  )
}

const UserProfile = ({ user, setUser, onResetData }: { user: User, setUser: (u: User) => void, onResetData: () => void }) => {
    const [name, setName] = useState(user.name);
    const [avatar, setAvatar] = useState(user.avatar || '');
    const [password, setPassword] = useState(user.password || '');
    
    const handleSave = () => {
        const updated = { ...user, name, avatar, password };
        setUser(updated);
        StorageService.updateUser(updated);
        alert('Perfil atualizado com sucesso!');
    }

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (ev) => {
                if(ev.target?.result) setAvatar(ev.target.result as string);
            }
            reader.readAsDataURL(file);
        }
    }

    return (
        <div className="max-w-3xl mx-auto space-y-6">
             <h2 className="text-2xl font-bold text-white">Meu Perfil</h2>
             <Card className="space-y-6">
                 <div className="flex flex-col md:flex-row gap-6 items-center md:items-start">
                      <div className="relative group">
                          <div className="w-24 h-24 rounded-full bg-slate-700 border-2 border-indigo-500 overflow-hidden flex items-center justify-center">
                              {avatar ? <img src={avatar} alt="Avatar" className="w-full h-full object-cover" /> : <span className="text-2xl font-bold text-indigo-300">{user.name.substring(0,2).toUpperCase()}</span>}
                          </div>
                          <label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full cursor-pointer">
                              <IconUpload className="w-6 h-6 text-white" />
                              <input type="file" className="hidden" accept="image/*" onChange={handleFile} />
                          </label>
                      </div>
                      <div className="flex-1 space-y-4 w-full">
                          <div>
                              <label className="block text-xs text-slate-400 mb-1">Nome Completo</label>
                              <input value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" />
                          </div>
                          <div>
                              <label className="block text-xs text-slate-400 mb-1">Email</label>
                              <input value={user.email} disabled className="w-full bg-slate-900/50 border border-slate-700 rounded p-2 text-slate-500 cursor-not-allowed" />
                          </div>
                          <div>
                              <label className="block text-xs text-slate-400 mb-1">Senha</label>
                              <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" placeholder="Nova senha..." />
                          </div>
                      </div>
                 </div>
                 <div className="flex justify-end pt-4 border-t border-slate-700">
                     <Button onClick={handleSave}>Salvar Alterações</Button>
                 </div>
             </Card>

             <div className="border-t border-slate-800 pt-8">
                 <h3 className="text-lg font-bold text-rose-500 mb-2">Zona de Perigo</h3>
                 <div className="bg-rose-900/10 border border-rose-900/30 p-4 rounded-lg flex items-center justify-between">
                     <div>
                         <p className="text-slate-300 font-medium">Resetar Dados</p>
                         <p className="text-xs text-slate-500">Apaga todas as tarefas e restaura configurações padrão. Irreversível.</p>
                     </div>
                     <Button variant="danger" onClick={() => { if(window.confirm("Tem certeza absoluta?")) onResetData(); }}>Resetar Tudo</Button>
                 </div>
             </div>
        </div>
    )
}

const Layout = ({ children, user, onLogout, headerContent }: any) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);

  const menuItems = [
    { path: '/', icon: <IconHome className="w-5 h-5" />, label: 'Dashboard' },
    { path: '/projects', icon: <IconProject className="w-5 h-5" />, label: 'Projetos' },
    { path: '/project-report', icon: <IconChartBar className="w-5 h-5" />, label: 'Report Projetos' },
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
// ... AuthPage ...
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
        requester: '',
        priority: '3 - Moderada',
        status: 'Novo',
        assignee: null,
        estimatedTime: '',
        actualTime: '',
        startDate: '',
        endDate: '',
        projectPath: '', // Init new field
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
                                <option value="Concluído">Concluído</option>
                            </select>
                        </div>
                    </div>
                    
                    {/* NEW: Project Path Field */}
                    <div>
                         <label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Caminho da Pasta do Projeto (Drive/Rede)</label>
                         <input 
                            name="projectPath" 
                            value={formData.projectPath || ''} 
                            onChange={handleChange} 
                            placeholder="Ex: G:\Projetos\ClienteX\AutomacaoFinanceira"
                            className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-xs"
                         />
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
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                        {currentPhase.activities.map((activity: string) => {
                                            const isChecked = formData.projectData?.completedActivities.includes(activity);
                                            return (
                                                <div key={activity} className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-700/50 hover:border-slate-500 transition-colors cursor-pointer" onClick={() => toggleActivity(activity)}>
                                                    <div className={`w-4 h-4 rounded-sm border flex-shrink-0 flex items-center justify-center transition-colors ${isChecked ? 'bg-indigo-500 border-indigo-500' : 'border-slate-500'}`}>
                                                        {isChecked && <IconCheck className="w-3 h-3 text-white" />}
                                                    </div>
                                                    <span className={`text-xs ${isChecked ? 'text-slate-200' : 'text-slate-400'} break-words`}>{activity}</span>
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
        projectPath: '',
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
          <Route path="/project-report" element={<ProjectReportView tasks={tasks} workflowConfig={workflowConfig} devs={devs} />} />
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
