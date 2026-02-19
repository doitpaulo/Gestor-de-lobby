
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell, LabelList, ComposedChart, Line, AreaChart, Area, LineChart 
} from 'recharts';
import * as XLSX from 'xlsx';
import pptxgen from 'pptxgenjs';
import { StorageService } from './services/storageService';
import { ExcelService } from './services/excelService';
import { Task, Developer, User, TaskType, Priority, HistoryEntry, WorkflowPhase, Robot, DocumentConfig, Sprint, SprintTask } from './types';
import { IconHome, IconKanban, IconList, IconUpload, IconDownload, IconUsers, IconClock, IconChevronLeft, IconPlus, IconProject, IconCheck, IconChartBar, IconRobot, IconDocument, IconSprint } from './components/Icons';

// --- Constants ---
const TASK_TYPES = ['Incidente', 'Melhoria', 'Nova Automação'];
const PRIORITIES = ['1 - Crítica', '2 - Alta', '3 - Moderada', '4 - Baixa'];
const STATUSES = ['Novo', 'Pendente', 'Em Atendimento', 'Em Progresso', 'Resolvido', 'Fechado', 'Aguardando', 'Concluído', 'Backlog'];

const DEFAULT_DOCS: DocumentConfig[] = [
    { id: 'doc1', label: 'Planilha BC', active: true },
    { id: 'doc2', label: 'Desenho Macro', active: true },
    { id: 'doc3', label: 'Requisito Funcional e Técnico', active: true },
    { id: 'doc4', label: 'Estudo de Viabilidade / Comitê', active: true },
    { id: 'doc5', label: 'Informativo de Kick Off', active: true },
    { id: 'doc6', label: 'Desenho AS-IS', active: true },
    { id: 'doc7', label: 'Template DOR', active: true },
    { id: 'doc8', label: 'Desenho TO-BE', active: true },
    { id: 'doc9', label: 'PDD', active: true },
    { id: 'doc10', label: 'SDD', active: true },
    { id: 'doc11', label: 'Plano de Teste Homologação (QA)', active: true },
    { id: 'doc12', label: 'Plano de Teste Produção (QA)', active: true },
    { id: 'doc13', label: 'DoD', active: true },
    { id: 'doc14', label: 'Informativo Go Live', active: true },
];

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
        id: 'phase_backlog',
        name: 'Backlog',
        statuses: [
            'Não iniciado',
            'Backlog',
            'Priorizado',
            'Em Refinamento',
            'Concluído'
        ],
        activities: ['Priorização', 'Refinamento Técnico', 'Estimativa Macro']
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

// --- Widget Interface ---

interface Widget {
    id: string;
    type: string;
    title: string;
    size: 'half' | 'full';
    visible: boolean;
    visualStyle?: 'bar' | 'pie' | 'line' | 'area';
}

const DEFAULT_WIDGETS: Widget[] = [
    { id: 'w1', type: 'cards', title: 'Visão Geral', size: 'full', visible: true },
    { id: 'w2', type: 'priority', title: 'Demandas por Prioridade', size: 'half', visible: true, visualStyle: 'bar' },
    { id: 'w3', type: 'status', title: 'Status por Tipo', size: 'half', visible: true },
    { id: 'w4', type: 'devType', title: 'Volume por Desenvolvedor', size: 'full', visible: true },
    { id: 'w5', type: 'capacity', title: 'Capacidade & Sugestões', size: 'full', visible: true },
    { id: 'w6', type: 'incidentByAuto', title: 'Top Incidentes por Sistema', size: 'half', visible: true, visualStyle: 'bar' },
    { id: 'w7', type: 'automationsByManager', title: 'Automações por Gerência', size: 'half', visible: true },
    { id: 'w8', type: 'completedKPIs', title: 'KPIs de Entrega (Concluídos)', size: 'full', visible: true },
    { id: 'w9', type: 'fteByManager', title: 'Valor FTE por Área', size: 'full', visible: true, visualStyle: 'bar' },
];

// --- Helper: Time Parser ---
const parseDuration = (durationStr: string | undefined): number => {
    if (!durationStr) return 0;
    const str = durationStr.toLowerCase().replace(/\s/g, '');
    
    if (str.includes('h') && str.includes('m')) {
        const parts = str.split('h');
        const h = parseFloat(parts[0]) || 0;
        const m = parseFloat(parts[1].replace('m', '')) || 0;
        return h + (m / 60);
    }

    if (str.includes('h')) return parseFloat(str.replace('h', '')) || 0;
    if (str.includes('m')) return (parseFloat(str.replace('m', '')) || 0) / 60;
    
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

// --- Consolidated Report Logic ---

const ConsolidatedReportService = {
  exportExcel: (tasks: Task[], robots: Robot[], workflowConfig: WorkflowPhase[], docsConfig: DocumentConfig[], devs: Developer[]) => {
    const wb = XLSX.utils.book_new();

    // 1. Dashboard Summary
    const activeTasks = tasks.filter(t => !['Concluído', 'Resolvido', 'Fechado'].includes(t.status));
    const dashData = [
      { Métrica: 'Total de Demandas Ativas', Valor: activeTasks.length },
      { Métrica: 'Incidentes Ativos', Valor: activeTasks.filter(t => t.type === 'Incidente').length },
      { Métrica: 'Melhorias Ativas', Valor: activeTasks.filter(t => t.type === 'Melhoria').length },
      { Métrica: 'Novas Automações Ativas', Valor: activeTasks.filter(t => t.type === 'Nova Automação').length },
      { Métrica: 'Total de Robôs Cadastrados', Valor: robots.length },
      { Métrica: 'Robôs Ativos', Valor: robots.filter(r => r.status === 'ATIVO').length }
    ];
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(dashData), "Resumo Dashboard");

    // 2. Projetos & Status Global
    const projectsData = tasks.map(t => ({
      'ID': t.id,
      'Tipo': t.type,
      'Resumo': t.summary,
      'Status Global': t.status,
      'Prioridade': t.priority,
      'Responsável': t.assignee || 'Não Atribuído',
      'Solicitante': t.requester || 'N/A',
      'Data Início': t.startDate || '-',
      'Data Fim Prevista': t.endDate || '-',
      'Gerência': t.managementArea || 'N/A',
      'FTE': t.fteValue || 0,
      'Bloqueio': t.blocker || '-'
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(projectsData), "Base de Projetos");

    // 3. Esteira Documental
    const activeDocs = docsConfig.filter(d => d.active);
    const docPipelineData = tasks.filter(t => t.type === 'Melhoria' || t.type === 'Nova Automação').map(t => {
      const row: any = { 'Projeto': t.summary, 'Responsável': t.assignee || '-' };
      activeDocs.forEach(d => {
        row[d.label] = (t.docStatuses || {})[d.id] || 'Pendente';
      });
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(docPipelineData), "Esteira Documental");

    // 4. Fluxo de Fases (Workflow)
    const flowData = tasks.filter(t => t.type === 'Melhoria' || t.type === 'Nova Automação').map(t => {
      const row: any = { 'Projeto': t.summary };
      workflowConfig.forEach(phase => {
        const isCurrent = t.projectData?.currentPhaseId === phase.id;
        row[phase.name] = isCurrent ? (t.projectData?.phaseStatus || 'Não Iniciado') : 'Aguardando/Concluído';
      });
      return row;
    });
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flowData), "Fluxo de Fases");

    // 5. Inventário de Robôs
    const robotData = robots.map(r => ({
      'Robô': r.name,
      'Status': r.status,
      'Área': r.area,
      'Desenvolvedor': r.developer,
      'FTE Gerado': r.fte || 0,
      'Ticket Origem': r.ticketNumber || '-',
      'Pasta': r.folder
    }));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(robotData), "Inventário RPA");

    XLSX.writeFile(wb, `Nexus_Consolidado_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.xlsx`);
  },

  exportPPT: async (tasks: Task[], robots: Robot[], workflowConfig: WorkflowPhase[], docsConfig: DocumentConfig[], devs: Developer[]) => {
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE';
    
    // Theme colors
    const BG_COLOR = '0f172a';
    const ACCENT_COLOR = '6366f1';
    const TEXT_COLOR = 'FFFFFF';
    const SUBTEXT_COLOR = '94a3b8';

    // Slide 1: Cover
    let slide = pres.addSlide();
    slide.background = { color: BG_COLOR };
    slide.addText("Nexus Project", { x: 0.5, y: 2.5, w: '90%', fontSize: 44, color: TEXT_COLOR, bold: true, align: 'center' });
    slide.addText("Relatório Consolidado de Gestão Semanal", { x: 0.5, y: 3.5, w: '90%', fontSize: 24, color: ACCENT_COLOR, align: 'center' });
    slide.addText(`Gerado em: ${new Date().toLocaleDateString('pt-BR')}`, { x: 0.5, y: 4.5, w: '90%', fontSize: 14, color: SUBTEXT_COLOR, align: 'center' });

    // Slide 2: Executive Dashboard
    const activeTasks = tasks.filter(t => !['Concluído', 'Resolvido', 'Fechado'].includes(t.status));
    slide = pres.addSlide();
    slide.background = { color: BG_COLOR };
    slide.addText("Visão Executiva do Portfólio", { x: 0.5, y: 0.5, fontSize: 24, color: TEXT_COLOR, bold: true });
    
    const drawKPI = (x: number, y: number, label: string, val: string, color: string) => {
      slide.addShape(pres.ShapeType.roundRect, { x, y, w: 2.8, h: 1.5, fill: { color: '1e293b' }, line: { color, width: 2 } });
      slide.addText(label, { x, y: y + 0.2, w: 2.8, fontSize: 12, color: SUBTEXT_COLOR, align: 'center' });
      slide.addText(val, { x, y: y + 0.6, w: 2.8, fontSize: 32, color: TEXT_COLOR, bold: true, align: 'center' });
    };

    drawKPI(0.5, 1.5, "Total Ativos", activeTasks.length.toString(), ACCENT_COLOR);
    drawKPI(3.6, 1.5, "Incidentes", activeTasks.filter(t => t.type === 'Incidente').length.toString(), 'e11d48');
    drawKPI(6.7, 1.5, "Melhorias", activeTasks.filter(t => t.type === 'Melhoria').length.toString(), '10b981');
    drawKPI(9.8, 1.5, "Novas Auto.", activeTasks.filter(t => t.type === 'Nova Automação').length.toString(), '8b5cf6');

    // Slide 3: Status da Esteira Documental (Top 10 Projetos)
    slide = pres.addSlide();
    slide.background = { color: BG_COLOR };
    slide.addText("Status da Esteira Documental (Projetos em Andamento)", { x: 0.5, y: 0.5, fontSize: 20, color: TEXT_COLOR, bold: true });
    
    const projectDocs = tasks.filter(t => (t.type === 'Melhoria' || t.type === 'Nova Automação') && !['Concluído', 'Resolvido', 'Fechado'].includes(t.status)).slice(0, 10);
    const activeDocs = docsConfig.filter(d => d.active).slice(0, 5); // Limit columns for PPT visibility
    
    const docTableHeader = ['Projeto', ...activeDocs.map(d => d.label)];
    const docTableRows = projectDocs.map(p => [
      p.summary.substring(0, 30),
      ...activeDocs.map(d => (p.docStatuses || {})[d.id] || 'Pendente')
    ]);

    slide.addTable([docTableHeader, ...docTableRows] as any, { 
      x: 0.5, y: 1.2, w: 12, 
      color: 'cbd5e1', fill: { color: '1e293b' }, fontSize: 10, 
      border: { type: 'solid', color: '334155', pt: 0.5 } 
    });

    // Slide 4: Fluxo de Projetos (Gantt Simplificado)
    slide = pres.addSlide();
    slide.background = { color: BG_COLOR };
    slide.addText("Cronograma e Marcos de Entrega", { x: 0.5, y: 0.5, fontSize: 20, color: TEXT_COLOR, bold: true });
    
    const ganttData = tasks.filter(t => t.startDate && t.endDate && !['Concluído', 'Resolvido', 'Fechado'].includes(t.status)).slice(0, 12);
    if (ganttData.length > 0) {
      const tableData = [['ID', 'Projeto', 'Início', 'Fim', 'Status'], ...ganttData.map(t => [t.id, t.summary, t.startDate, t.endDate, t.status])];
      slide.addTable(tableData as any, { x: 0.5, y: 1.2, w: 12, fontSize: 10, color: 'cbd5e1', fill: { color: '1e293b' } });
    }

    // Slide 5: Inventário RPA
    slide = pres.addSlide();
    slide.background = { color: BG_COLOR };
    slide.addText("Inventário de Robôs e Geração de Valor", { x: 0.5, y: 0.5, fontSize: 20, color: TEXT_COLOR, bold: true });
    const rpaSummary = [
      ['Robô', 'Área', 'Status', 'FTE'],
      ...robots.slice(0, 15).map(r => [r.name, r.area, r.status, (r.fte || 0).toString()])
    ];
    slide.addTable(rpaSummary as any, { x: 0.5, y: 1.2, w: 12, fontSize: 10, color: 'cbd5e1', fill: { color: '1e293b' } });

    pres.writeFile({ fileName: `Nexus_Report_Consolidado_${new Date().toLocaleDateString('pt-BR').replace(/\//g, '-')}.pptx` });
  }
};

// --- Components Helpers ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, type = 'button', title='' }: any) => {
  const baseClass = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md justify-center text-sm";
  const variants: any = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/30",
    secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
    danger: "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/30",
    success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/30",
    warning: "bg-amber-500 hover:bg-amber-600 text-black shadow-amber-500/30"
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} title={title} className={`${baseClass} ${variants[variant]} ${className}`}>
      {children}
    </button>
  );
};

const Card = ({ children, className = '', ...props }: any) => (
  <div className={`bg-slate-800/80 backdrop-blur-sm border border-slate-700/50 rounded-xl p-6 shadow-xl ${className}`} {...props}>
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
                                {selected.includes(opt) && <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                            </div>
                            <span className="text-sm text-slate-300">{opt}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
};

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
    
    if (original.projectData?.currentPhaseId !== updated.projectData?.currentPhaseId) {
         changes.push({
            id: Math.random().toString(36).substr(2, 9),
            date: timestamp,
            user: user.name,
            action: `Alterou fase do projeto`
        });
    }

    if (original.blocker !== updated.blocker) {
         changes.push({
            id: Math.random().toString(36).substr(2, 9),
            date: timestamp,
            user: user.name,
            action: `Atualizou motivo de bloqueio`
        });
    }
    
    const textFields = ['summary', 'requester', 'estimatedTime', 'actualTime', 'startDate', 'endDate', 'category', 'subcategory', 'type', 'projectPath', 'automationName', 'managementArea', 'fteValue'];
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

const CustomTooltip = ({ active, payload, label }: any) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-slate-900 border border-slate-700 p-3 rounded shadow-xl text-xs z-50">
        <p className="font-bold text-slate-200 mb-2 border-b border-slate-700 pb-1">{label}</p>
        {payload.map((p: any, idx: number) => (
          <div key={idx} className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color || p.fill }}></div>
            <span className="text-slate-400 capitalize">{p.name}:</span>
            <span className="text-slate-200 font-mono font-bold">{
                typeof p.value === 'number' ? (Number.isInteger(p.value) ? p.value : p.value.toFixed(2)) : p.value
            }</span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

const renderCustomBarLabel = (props: any) => {
  const { x, y, width, height, value } = props;
  if (!value || value === 0) return null;
  return (
    <text x={x + width / 2} y={y + height / 2} fill="#fff" textAnchor="middle" dominantBaseline="middle" fontSize={10} fontWeight="bold" style={{ pointerEvents: 'none' }}>
      {value}
    </text>
  );
};

// --- NEW SESSION: DocumentPipelineView ---
const DocumentPipelineView = ({ tasks, setTasks, devs, documentsConfig, setDocumentsConfig, user }: any) => {
    const [filters, setFilters] = useState<{search: string, assignee: string[]}>({ search: '', assignee: [] });
    const [isAddDocOpen, setIsAddDocOpen] = useState(false);
    const [newDocLabel, setNewDocLabel] = useState('');

    const activeDocs = useMemo(() => documentsConfig.filter((d: any) => d.active), [documentsConfig]);

    const filteredProjects = useMemo(() => {
        return tasks.filter((t: Task) => {
            const isProjectType = t.type === 'Melhoria' || t.type === 'Nova Automação';
            if (!isProjectType) return false;
            const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || t.id.toLowerCase().includes(filters.search.toLowerCase());
            const matchesAssignee = filters.assignee.length === 0 || (t.assignee && filters.assignee.includes(t.assignee));
            return matchesSearch && matchesAssignee;
        });
    }, [tasks, filters]);

    const toggleDocStatus = (taskId: string, docId: string) => {
        const statuses: ('Pendente' | 'Em andamento' | 'Concluído')[] = ['Pendente', 'Em andamento', 'Concluído'];
        const updatedTasks = tasks.map((t: Task) => {
            if (t.id === taskId) {
                const currentStatuses = t.docStatuses || {};
                const current = currentStatuses[docId] || 'Pendente';
                const next = statuses[(statuses.indexOf(current) + 1) % statuses.length];
                return { ...t, docStatuses: { ...currentStatuses, [docId]: next } };
            }
            return t;
        });
        setTasks(updatedTasks);
        StorageService.saveTasks(updatedTasks);
    };

    const handleAddDocument = () => {
        if (!newDocLabel) return;
        const newDoc: DocumentConfig = {
            id: `custom-doc-${Date.now()}`,
            label: newDocLabel,
            active: true
        };
        const updatedConfig = [...documentsConfig, newDoc];
        setDocumentsConfig(updatedConfig);
        StorageService.saveDocumentsConfig(updatedConfig);
        setNewDocLabel('');
        setIsAddDocOpen(false);
    };

    const handleDeleteDocument = (docId: string) => {
        if (window.confirm('Tem certeza que deseja remover este documento da esteira?')) {
            const updatedConfig = documentsConfig.map((d: any) => d.id === docId ? { ...d, active: false } : d);
            setDocumentsConfig(updatedConfig);
            StorageService.saveDocumentsConfig(updatedConfig);
        }
    };

    const handleExportExcel = () => {
        const exportData = filteredProjects.map((t: Task) => {
            const row: any = {
                'ID': t.id,
                'Projeto': t.summary,
                'Tipo': t.type,
                'Responsável': t.assignee || 'Não Atribuído'
            };
            activeDocs.forEach((doc: any) => {
                row[doc.label] = (t.docStatuses || {})[doc.id] || 'Pendente';
            });
            return row;
        });
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Esteira Documental");
        XLSX.writeFile(wb, "Nexus_Esteira_Documental.xlsx");
    };

    const getStatusStyle = (status: string) => {
        if (status === 'Concluído') return 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30';
        if (status === 'Em andamento') return 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30';
        return 'bg-amber-500/20 text-amber-400 border-amber-500/30'; // Pendente
    };

    return (
        <div className="h-full flex flex-col space-y-4 animate-fade-in">
            <div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div>
                    <h2 className="text-xl font-bold text-white">Esteira Documental</h2>
                    <p className="text-sm text-slate-400">Controle dinâmico de entregáveis por projeto</p>
                </div>
                <div className="flex gap-2">
                    <Button onClick={handleExportExcel} variant="success"><IconDownload className="w-4 h-4" /> Exportar</Button>
                    <Button onClick={() => setIsAddDocOpen(true)} variant="primary"><IconPlus className="w-4 h-4" /> Adicionar Documento</Button>
                </div>
            </div>

            <div className="flex gap-4 bg-slate-800 p-3 rounded-xl border border-slate-700 items-center">
                <div className="flex-1 relative">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                    </svg>
                    <input 
                        type="text" 
                        placeholder="Buscar projeto..." 
                        className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 outline-none"
                        value={filters.search}
                        onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value }))}
                    />
                </div>
                <MultiSelect 
                    placeholder="Desenvolvedores"
                    options={devs.map((d: any) => d.name)}
                    selected={filters.assignee}
                    onChange={(val) => setFilters(prev => ({ ...prev, assignee: val }))}
                />
            </div>

            <div className="flex-1 overflow-x-auto bg-slate-900/50 rounded-xl border border-slate-700 custom-scrollbar">
                <table className="w-full text-left text-xs border-collapse min-w-max">
                    <thead className="bg-slate-800 sticky top-0 z-20 shadow-md">
                        <tr>
                            <th className="p-4 border-b border-slate-700 sticky left-0 bg-slate-800 z-30 min-w-[250px]">Projeto</th>
                            {activeDocs.map((doc: any) => (
                                <th key={doc.id} className="p-4 border-b border-slate-700 text-center min-w-[150px] group relative">
                                    <div className="flex items-center justify-center gap-2">
                                        <span>{doc.label}</span>
                                        <button onClick={() => handleDeleteDocument(doc.id)} className="opacity-0 group-hover:opacity-100 text-rose-500 hover:text-rose-400 p-1" title="Excluir documento">🗑️</button>
                                    </div>
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filteredProjects.map((p: Task) => (
                            <tr key={p.id} className="hover:bg-slate-800/40 border-b border-slate-800/50 transition-colors">
                                <td className="p-4 sticky left-0 bg-slate-900/95 z-10 border-r border-slate-800">
                                    <div className="flex flex-col">
                                        <span className="font-bold text-slate-200 truncate max-w-[200px]" title={p.summary}>{p.summary}</span>
                                        <div className="flex gap-2 items-center mt-1">
                                            <span className="text-[10px] font-mono text-slate-500">{p.id}</span>
                                            <span className="text-[10px] text-indigo-400 font-medium">{p.assignee || 'Sem Dev'}</span>
                                        </div>
                                    </div>
                                </td>
                                {activeDocs.map((doc: any) => {
                                    const status = (p.docStatuses || {})[doc.id] || 'Pendente';
                                    return (
                                        <td key={doc.id} className="p-2 text-center">
                                            <button 
                                                onClick={() => toggleDocStatus(p.id, doc.id)}
                                                className={`w-full py-2 px-3 rounded-lg border text-[10px] font-bold uppercase transition-all hover:brightness-125 ${getStatusStyle(status)}`}
                                            >
                                                {status}
                                            </button>
                                        </td>
                                    );
                                })}
                            </tr>
                        ))}
                    </tbody>
                </table>
                {filteredProjects.length === 0 && (
                    <div className="p-20 text-center text-slate-500 flex flex-col items-center gap-4">
                        <IconProject className="w-12 h-12 opacity-20" />
                        <p>Nenhum projeto encontrado para os filtros selecionados.</p>
                    </div>
                )}
            </div>

            {isAddDocOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-md shadow-2xl">
                        <div className="p-6 border-b border-slate-700"><h3 className="text-xl font-bold text-white">Novo Documento</h3></div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Nome do Documento</label>
                                <input 
                                    className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-indigo-500"
                                    value={newDocLabel}
                                    onChange={e => setNewDocLabel(e.target.value)}
                                    placeholder="Ex: PDD V2, Evidências..."
                                    autoFocus
                                />
                            </div>
                            <div className="flex justify-end gap-3 pt-4">
                                <Button variant="secondary" onClick={() => setIsAddDocOpen(false)}>Cancelar</Button>
                                <Button onClick={handleAddDocument} disabled={!newDocLabel}>Adicionar</Button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- NEW SESSION: SprintsView ---
const SprintsView = ({ tasks, sprints, setSprints, devs, user }: any) => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingSprint, setEditingSprint] = useState<Sprint | null>(null);
    const [selectedSprint, setSelectedSprint] = useState<Sprint | null>(null);
    const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false);

    const handleSaveSprint = (e: React.FormEvent) => {
        e.preventDefault();
        const form = e.target as HTMLFormElement;
        const formData = new FormData(form);
        
        const sprintData: Sprint = {
            id: editingSprint?.id || `sprint-${Date.now()}`,
            name: formData.get('name') as string,
            startDate: formData.get('startDate') as string,
            endDate: formData.get('endDate') as string,
            status: formData.get('status') as any,
            goals: formData.get('goals') as string,
            notes: formData.get('notes') as string,
            tasks: editingSprint?.tasks || []
        };

        let updatedSprints;
        if (editingSprint) {
            updatedSprints = sprints.map((s: Sprint) => s.id === editingSprint.id ? sprintData : s);
        } else {
            updatedSprints = [...sprints, sprintData];
        }

        setSprints(updatedSprints);
        StorageService.saveSprints(updatedSprints);
        setIsModalOpen(false);
        setEditingSprint(null);
    };

    const handleDeleteSprint = (id: string) => {
        if (window.confirm('Tem certeza que deseja excluir esta Sprint?')) {
            const updated = sprints.filter((s: Sprint) => s.id !== id);
            setSprints(updated);
            StorageService.saveSprints(updated);
            if (selectedSprint?.id === id) setSelectedSprint(null);
        }
    };

    const handleAddTaskToSprint = (taskId: string) => {
        if (!selectedSprint) return;
        if (selectedSprint.tasks.find(t => t.taskId === taskId)) return;

        const newTask: SprintTask = {
            taskId,
            plannedHours: 0,
            actualHours: 0,
            status: 'Pendente'
        };

        const updatedSprint = {
            ...selectedSprint,
            tasks: [...selectedSprint.tasks, newTask]
        };

        const updatedSprints = sprints.map((s: Sprint) => s.id === selectedSprint.id ? updatedSprint : s);
        setSprints(updatedSprints);
        StorageService.saveSprints(updatedSprints);
        setSelectedSprint(updatedSprint);
        setIsAddTaskModalOpen(false);
    };

    const handleUpdateSprintTask = (taskId: string, field: string, value: any) => {
        if (!selectedSprint) return;
        const updatedTasks = selectedSprint.tasks.map((t: SprintTask) => 
            t.taskId === taskId ? { ...t, [field]: value } : t
        );
        const updatedSprint = { ...selectedSprint, tasks: updatedTasks };
        const updatedSprints = sprints.map((s: Sprint) => s.id === selectedSprint.id ? updatedSprint : s);
        setSprints(updatedSprints);
        StorageService.saveSprints(updatedSprints);
        setSelectedSprint(updatedSprint);
    };

    const handleRemoveTaskFromSprint = (taskId: string) => {
        if (!selectedSprint) return;
        const updatedTasks = selectedSprint.tasks.filter((t: SprintTask) => t.taskId !== taskId);
        const updatedSprint = { ...selectedSprint, tasks: updatedTasks };
        const updatedSprints = sprints.map((s: Sprint) => s.id === selectedSprint.id ? updatedSprint : s);
        setSprints(updatedSprints);
        StorageService.saveSprints(updatedSprints);
        setSelectedSprint(updatedSprint);
    };

    const exportSprintPPT = (type: 'opening' | 'closing') => {
        if (!selectedSprint) return;
        const pres = new pptxgen();
        pres.layout = 'LAYOUT_WIDE';
        const BG_COLOR = '0f172a';
        const ACCENT_COLOR = '6366f1';
        const TEXT_COLOR = 'FFFFFF';

        // Cover
        let slide = pres.addSlide();
        slide.background = { color: BG_COLOR };
        slide.addText(type === 'opening' ? "Abertura de Sprint CoE" : "Fechamento de Sprint CoE", { x: 0.5, y: 2, w: '90%', fontSize: 44, color: TEXT_COLOR, bold: true, align: 'center' });
        slide.addText(selectedSprint.name, { x: 0.5, y: 3, w: '90%', fontSize: 32, color: ACCENT_COLOR, align: 'center' });
        slide.addText(`${selectedSprint.startDate} até ${selectedSprint.endDate}`, { x: 0.5, y: 4, w: '90%', fontSize: 18, color: '94a3b8', align: 'center' });

        // Goals
        slide = pres.addSlide();
        slide.background = { color: BG_COLOR };
        slide.addText("Objetivos da Sprint", { x: 0.5, y: 0.5, fontSize: 24, color: TEXT_COLOR, bold: true });
        slide.addText(selectedSprint.goals || "Nenhum objetivo definido", { x: 0.5, y: 1.2, w: 12, fontSize: 18, color: 'cbd5e1' });

        // Tasks Table
        slide = pres.addSlide();
        slide.background = { color: BG_COLOR };
        slide.addText(type === 'opening' ? "Planejamento de Atividades" : "Resultado de Atividades", { x: 0.5, y: 0.5, fontSize: 24, color: TEXT_COLOR, bold: true });
        
        const tableHeader = ['ID', 'Tarefa', 'Responsável', 'Horas Planejadas'];
        if (type === 'closing') tableHeader.push('Horas Reais', 'Status');

        const tableRows = selectedSprint.tasks.map(st => {
            const task = tasks.find((t: any) => t.id === st.taskId);
            const row = [
                st.taskId,
                task?.summary || 'N/A',
                task?.assignee || 'N/A',
                st.plannedHours.toString()
            ];
            if (type === 'closing') {
                row.push(st.actualHours.toString(), st.status);
            }
            return row;
        });

        slide.addTable([tableHeader, ...tableRows] as any, { 
            x: 0.5, y: 1.2, w: 12, 
            fontSize: 10, color: 'cbd5e1', fill: { color: '1e293b' },
            border: { type: 'solid', color: '334155', pt: 0.5 }
        });

        // Summary Slide
        slide = pres.addSlide();
        slide.background = { color: BG_COLOR };
        slide.addText("Resumo da Sprint", { x: 0.5, y: 0.5, fontSize: 24, color: TEXT_COLOR, bold: true });
        
        const totalPlanned = selectedSprint.tasks.reduce((acc, t) => acc + t.plannedHours, 0);
        const totalActual = selectedSprint.tasks.reduce((acc, t) => acc + t.actualHours, 0);
        const completedCount = selectedSprint.tasks.filter(t => t.status === 'Concluído').length;

        const summaryData = [
            ["Métrica", "Valor"],
            ["Total de Tarefas", selectedSprint.tasks.length.toString()],
            ["Total de Horas Planejadas", `${totalPlanned}h`],
        ];
        if (type === 'closing') {
            summaryData.push(["Total de Horas Reais", `${totalActual}h`]);
            summaryData.push(["Tarefas Concluídas", completedCount.toString()]);
            summaryData.push(["Produtividade", `${((totalActual / totalPlanned) * 100 || 0).toFixed(1)}%`]);
        }

        slide.addTable(summaryData as any, { x: 0.5, y: 1.2, w: 6, fontSize: 14, color: 'cbd5e1', fill: { color: '1e293b' } });

        if (type === 'closing' && selectedSprint.notes) {
            slide.addText("Observações / Lições Aprendidas", { x: 7, y: 0.5, fontSize: 20, color: TEXT_COLOR, bold: true });
            slide.addText(selectedSprint.notes, { x: 7, y: 1.2, w: 5.5, fontSize: 12, color: 'cbd5e1' });
        }

        pres.writeFile({ fileName: `Sprint_${selectedSprint.name.replace(/\s/g, '_')}_${type}.pptx` });
    };

    return (
        <div className="h-full flex flex-col space-y-4 animate-fade-in">
            <div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700">
                <div>
                    <h2 className="text-xl font-bold text-white">Gestão de Sprints</h2>
                    <p className="text-sm text-slate-400">Planejamento e acompanhamento de ciclos CoE</p>
                </div>
                <Button onClick={() => { setEditingSprint(null); setIsModalOpen(true); }} variant="primary">
                    <IconPlus className="w-4 h-4" /> Nova Sprint
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 flex-1 overflow-hidden">
                {/* Sprint List */}
                <Card className="lg:col-span-1 flex flex-col h-full overflow-hidden">
                    <h3 className="text-lg font-bold text-white mb-4">Sprints</h3>
                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                        {sprints.length === 0 ? (
                            <div className="text-center py-10 text-slate-500">Nenhuma sprint cadastrada.</div>
                        ) : (
                            sprints.map((s: Sprint) => (
                                <div 
                                    key={s.id} 
                                    onClick={() => setSelectedSprint(s)}
                                    className={`p-4 rounded-xl border cursor-pointer transition-all ${selectedSprint?.id === s.id ? 'bg-indigo-600/20 border-indigo-500 shadow-lg shadow-indigo-500/10' : 'bg-slate-900/50 border-slate-700 hover:border-slate-500'}`}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <h4 className="font-bold text-white">{s.name}</h4>
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${s.status === 'Concluída' ? 'bg-emerald-500/20 text-emerald-400' : s.status === 'Em Execução' ? 'bg-indigo-500/20 text-indigo-400' : 'bg-amber-500/20 text-amber-400'}`}>
                                            {s.status}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-slate-400 mb-3">
                                        <IconClock className="w-3 h-3" />
                                        <span>{s.startDate} - {s.endDate}</span>
                                    </div>
                                    <div className="flex justify-between items-center">
                                        <span className="text-xs text-slate-500">{s.tasks.length} tarefas</span>
                                        <div className="flex gap-2">
                                            <button onClick={(e) => { e.stopPropagation(); setEditingSprint(s); setIsModalOpen(true); }} className="text-slate-400 hover:text-white p-1">✏️</button>
                                            <button onClick={(e) => { e.stopPropagation(); handleDeleteSprint(s.id); }} className="text-rose-500 hover:text-rose-400 p-1">🗑️</button>
                                        </div>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </Card>

                {/* Sprint Detail */}
                <Card className="lg:col-span-2 flex flex-col h-full overflow-hidden">
                    {selectedSprint ? (
                        <div className="flex flex-col h-full">
                            <div className="flex justify-between items-start border-b border-slate-700 pb-4 mb-4">
                                <div>
                                    <h3 className="text-2xl font-bold text-white">{selectedSprint.name}</h3>
                                    <p className="text-sm text-slate-400">{selectedSprint.startDate} até {selectedSprint.endDate}</p>
                                </div>
                                <div className="flex gap-2">
                                    <Button onClick={() => exportSprintPPT('opening')} variant="secondary" className="text-xs">
                                        <IconDownload className="w-3 h-3" /> PPT Abertura
                                    </Button>
                                    <Button onClick={() => exportSprintPPT('closing')} variant="primary" className="text-xs">
                                        <IconDownload className="w-3 h-3" /> PPT Fechamento
                                    </Button>
                                </div>
                            </div>

                            <div className="grid grid-cols-3 gap-4 mb-6">
                                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Horas Planejadas</p>
                                    <p className="text-xl font-bold text-indigo-400">{selectedSprint.tasks.reduce((acc, t) => acc + t.plannedHours, 0)}h</p>
                                </div>
                                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Horas Reais</p>
                                    <p className="text-xl font-bold text-emerald-400">{selectedSprint.tasks.reduce((acc, t) => acc + t.actualHours, 0)}h</p>
                                </div>
                                <div className="bg-slate-900/50 p-3 rounded-lg border border-slate-700">
                                    <p className="text-[10px] text-slate-500 uppercase font-bold mb-1">Conclusão</p>
                                    <p className="text-xl font-bold text-white">
                                        {selectedSprint.tasks.length > 0 ? Math.round((selectedSprint.tasks.filter(t => t.status === 'Concluído').length / selectedSprint.tasks.length) * 100) : 0}%
                                    </p>
                                </div>
                            </div>

                            <div className="flex justify-between items-center mb-4">
                                <h4 className="font-bold text-white">Tarefas da Sprint</h4>
                                <Button onClick={() => setIsAddTaskModalOpen(true)} variant="success" className="text-xs py-1">
                                    <IconPlus className="w-3 h-3" /> Adicionar Tarefa
                                </Button>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar">
                                <table className="w-full text-left text-xs">
                                    <thead className="bg-slate-900 sticky top-0 z-10">
                                        <tr>
                                            <th className="p-3 border-b border-slate-700">Tarefa</th>
                                            <th className="p-3 border-b border-slate-700 w-24 text-center">Planejado</th>
                                            <th className="p-3 border-b border-slate-700 w-24 text-center">Real</th>
                                            <th className="p-3 border-b border-slate-700 w-32">Status</th>
                                            <th className="p-3 border-b border-slate-700 w-10"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {selectedSprint.tasks.map(st => {
                                            const task = tasks.find((t: any) => t.id === st.taskId);
                                            return (
                                                <tr key={st.taskId} className="border-b border-slate-800 hover:bg-slate-800/30">
                                                    <td className="p-3">
                                                        <div className="flex flex-col">
                                                            <span className="font-bold text-slate-200">{task?.summary || 'Tarefa não encontrada'}</span>
                                                            <span className="text-[10px] text-slate-500">{st.taskId} | {task?.assignee || 'Sem Dev'}</span>
                                                        </div>
                                                    </td>
                                                    <td className="p-3">
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-center text-white"
                                                            value={st.plannedHours}
                                                            onChange={(e) => handleUpdateSprintTask(st.taskId, 'plannedHours', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </td>
                                                    <td className="p-3">
                                                        <input 
                                                            type="number" 
                                                            className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-center text-white"
                                                            value={st.actualHours}
                                                            onChange={(e) => handleUpdateSprintTask(st.taskId, 'actualHours', parseFloat(e.target.value) || 0)}
                                                        />
                                                    </td>
                                                    <td className="p-3">
                                                        <select 
                                                            className="w-full bg-slate-900 border border-slate-700 rounded p-1 text-white"
                                                            value={st.status}
                                                            onChange={(e) => handleUpdateSprintTask(st.taskId, 'status', e.target.value)}
                                                        >
                                                            <option value="Pendente">Pendente</option>
                                                            <option value="Em Progresso">Em Progresso</option>
                                                            <option value="Concluído">Concluído</option>
                                                            <option value="Cancelado">Cancelado</option>
                                                        </select>
                                                    </td>
                                                    <td className="p-3">
                                                        <button onClick={() => handleRemoveTaskFromSprint(st.taskId)} className="text-rose-500 hover:text-rose-400">✕</button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                                {selectedSprint.tasks.length === 0 && (
                                    <div className="text-center py-20 text-slate-600">Nenhuma tarefa adicionada a esta sprint.</div>
                                )}
                            </div>
                        </div>
                    ) : (
                        <div className="h-full flex flex-col items-center justify-center text-slate-500 space-y-4">
                            <IconSprint className="w-16 h-16 opacity-10" />
                            <p>Selecione uma sprint para ver os detalhes</p>
                        </div>
                    )}
                </Card>
            </div>

            {/* Sprint Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <form onSubmit={handleSaveSprint} className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg shadow-2xl">
                        <div className="p-6 border-b border-slate-700"><h3 className="text-xl font-bold text-white">{editingSprint ? 'Editar Sprint' : 'Nova Sprint'}</h3></div>
                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Nome da Sprint</label>
                                <input name="name" defaultValue={editingSprint?.name} required className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-indigo-500" placeholder="Ex: Sprint 01 - Janeiro" />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Data Início</label>
                                    <input type="date" name="startDate" defaultValue={editingSprint?.startDate} required className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-indigo-500" />
                                </div>
                                <div>
                                    <label className="block text-xs text-slate-400 mb-1">Data Fim</label>
                                    <input type="date" name="endDate" defaultValue={editingSprint?.endDate} required className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-indigo-500" />
                                </div>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Status</label>
                                <select name="status" defaultValue={editingSprint?.status || 'Planejada'} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-indigo-500">
                                    <option value="Planejada">Planejada</option>
                                    <option value="Em Execução">Em Execução</option>
                                    <option value="Concluída">Concluída</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Objetivos</label>
                                <textarea name="goals" defaultValue={editingSprint?.goals} rows={3} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-indigo-500 resize-none" placeholder="O que pretendemos entregar nesta sprint?" />
                            </div>
                            <div>
                                <label className="block text-xs text-slate-400 mb-1">Observações (Fechamento)</label>
                                <textarea name="notes" defaultValue={editingSprint?.notes} rows={2} className="w-full bg-slate-900 border border-slate-600 rounded p-3 text-white outline-none focus:border-indigo-500 resize-none" placeholder="Lições aprendidas, motivos de atraso, etc." />
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-700 flex justify-end gap-3">
                            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
                            <Button type="submit">Salvar Sprint</Button>
                        </div>
                    </form>
                </div>
            )}

            {/* Add Task Modal */}
            {isAddTaskModalOpen && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
                    <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]">
                        <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                            <h3 className="text-xl font-bold text-white">Adicionar Tarefa à Sprint</h3>
                            <button onClick={() => setIsAddTaskModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
                        </div>
                        <div className="p-4 bg-slate-900/50 border-b border-slate-700">
                            <input 
                                type="text" 
                                placeholder="Filtrar tarefas..." 
                                className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-sm text-white outline-none"
                                onChange={(e) => {
                                    const val = e.target.value.toLowerCase();
                                    const rows = document.querySelectorAll('.task-row');
                                    rows.forEach((row: any) => {
                                        const text = row.innerText.toLowerCase();
                                        row.style.display = text.includes(val) ? '' : 'none';
                                    });
                                }}
                            />
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2 custom-scrollbar">
                            {tasks.filter((t: Task) => !selectedSprint?.tasks.find(st => st.taskId === t.id)).map((t: Task) => (
                                <div 
                                    key={t.id} 
                                    onClick={() => handleAddTaskToSprint(t.id)}
                                    className="task-row p-3 bg-slate-900 border border-slate-700 rounded-lg hover:border-indigo-500 cursor-pointer flex justify-between items-center group transition-all"
                                >
                                    <div>
                                        <p className="text-sm font-bold text-white">{t.summary}</p>
                                        <p className="text-xs text-slate-500">{t.id} | {t.assignee || 'Sem Dev'} | {t.status}</p>
                                    </div>
                                    <IconPlus className="w-4 h-4 text-slate-500 group-hover:text-indigo-400" />
                                </div>
                            ))}
                        </div>
                        <div className="p-4 border-t border-slate-700 flex justify-end">
                            <Button variant="secondary" onClick={() => setIsAddTaskModalOpen(false)}>Fechar</Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const KanbanView = ({ tasks, setTasks, devs, onEditTask, user }: { tasks: Task[], setTasks: any, devs: Developer[], onEditTask: (task: Task) => void, user: User }) => {
  const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], assignee: string[]}>({ search: '', type: [], priority: [], assignee: [] });
  const [kanbanMode, setKanbanMode] = useState<'assignee' | 'status'>('assignee');
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null);
  
  const columns = useMemo(() => {
      if (kanbanMode === 'assignee') {
        let cols = [ { id: 'unassigned', title: 'Não Atribuídos', type: 'unassigned' }, ...devs.map(d => ({ id: d.name, title: d.name, type: 'dev' })), { id: 'completed', title: 'Concluídos', type: 'completed' } ];
        if (filters.assignee.length > 0) {
             const showUnassigned = filters.assignee.includes('Não Atribuído');
             cols = cols.filter(c => {
                 if (c.type === 'completed') return true;
                 if (c.type === 'unassigned') return showUnassigned;
                 return filters.assignee.includes(c.id);
             });
        }
        return cols;
      } else {
        return [
            { id: 'col-backlog', title: 'Backlog / Prioridades', type: 'status_group', statuses: ['Novo', 'Backlog', 'Pendente'], targetStatus: 'Backlog' },
            { id: 'col-doing', title: 'Em Produção', type: 'status_group', statuses: ['Em Atendimento', 'Em Progresso'], targetStatus: 'Em Progresso' },
            { id: 'col-blocked', title: 'Com Bloqueio', type: 'status_group', statuses: ['Aguardando'], targetStatus: 'Aguardando' },
            { id: 'col-done', title: 'Concluído', type: 'status_group', statuses: ['Resolvido', 'Fechado', 'Concluído'], targetStatus: 'Concluído' }
        ];
      }
  }, [devs, filters.assignee, kanbanMode]);

  const onDragStart = (e: React.DragEvent, taskId: string) => { 
      e.dataTransfer.setData("taskId", taskId); 
  };
  
  const onDrop = (e: React.DragEvent, colId: string, colType: string, targetStatus?: string, dropOnTaskId?: string) => {
    e.preventDefault(); 
    e.stopPropagation();
    setDragOverTaskId(null);
    const taskId = e.dataTransfer.getData("taskId");
    const updatedTasks = [...tasks];
    const taskIndex = updatedTasks.findIndex(t => t.id === taskId);
    if (taskIndex === -1) return;
    
    const task = { ...updatedTasks[taskIndex] };
    let historyAction = '';
    
    // 1. Handle Logic for Modifying Task State (Assignee/Status)
    if (kanbanMode === 'assignee') {
        if (colType === 'unassigned') {
            if (task.assignee) { historyAction = `Removeu atribuição (Estava com ${task.assignee})`; task.assignee = null; }
            if (['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) { task.status = 'Pendente'; historyAction += (historyAction ? '. ' : '') + "Reabriu tarefa (Status: Pendente)"; }
        } 
        else if (colType === 'dev') {
            const targetDev = colId;
            const currentWorkload = getDevWorkload(targetDev, tasks, task.id);
            if (currentWorkload > 40) { if(!window.confirm(`ALERTA: ${targetDev} já tem ${formatDuration(currentWorkload)} de carga. Deseja atribuir mesmo assim?`)) { return; } }
            if (task.assignee !== targetDev) { historyAction = `Atribuiu para ${targetDev}`; task.assignee = targetDev; }
            if (['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) { task.status = 'Em Progresso'; historyAction += (historyAction ? '. ' : '') + "Reabriu tarefa (Status: Em Progresso)"; } 
            else if (task.status === 'Novo' || task.status === 'Backlog') { task.status = 'Em Atendimento'; }
        }
        else if (colType === 'completed') {
            if (!['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) { task.status = 'Concluído'; historyAction = `Concluiu tarefa`; }
        }
    } else {
        if (targetStatus && task.status !== targetStatus) {
            historyAction = `Alterou status para ${targetStatus}`;
            task.status = targetStatus;
        }
    }

    if (historyAction) {
        const entry: HistoryEntry = { id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString(), user: user.name, action: historyAction };
        task.history = [...(task.history || []), entry];
    }

    // 2. Handle Logic for Reordering within the Column
    updatedTasks[taskIndex] = task;

    // Filter tasks that belong to the SAME column after state update
    const columnTasks = updatedTasks.filter(t => {
        if (kanbanMode === 'assignee') {
            const isCompleted = ['Concluído', 'Resolvido', 'Fechado'].includes(t.status);
            if (colType === 'completed') return isCompleted;
            if (isCompleted) return false;
            if (colType === 'unassigned') return !t.assignee;
            if (colType === 'dev') return t.assignee === colId;
            return false;
        } else {
            const col = columns.find(c => c.id === colId);
            return col && col.statuses.includes(t.status);
        }
    }).sort((a, b) => (a.boardPosition || 0) - (b.boardPosition || 0));

    // Remove the dragged task from the current list to re-insert it
    const others = columnTasks.filter(t => t.id !== task.id);
    
    let targetIdx = others.length; // Default to end
    if (dropOnTaskId) {
        targetIdx = others.findIndex(t => t.id === dropOnTaskId);
        if (targetIdx === -1) targetIdx = others.length;
    }

    // Splice in the dragged task
    others.splice(targetIdx, 0, task);

    // Re-assign board positions AND Update priority based on rank
    others.forEach((t, i) => {
        const originalTask = updatedTasks.find(ot => ot.id === t.id);
        if (originalTask) {
            originalTask.boardPosition = i;
            
            // AUTOMATIC PRIORITY BASED ON RANK
            let autoPriority: Priority = '4 - Baixa';
            if (i === 0) autoPriority = '1 - Crítica';
            else if (i === 1) autoPriority = '2 - Alta';
            else if (i === 2) autoPriority = '3 - Moderada';
            
            if (originalTask.priority !== autoPriority) {
                const rankEntry: HistoryEntry = {
                    id: Math.random().toString(36).substr(2, 9),
                    date: new Date().toISOString(),
                    user: 'Sistema',
                    action: `Prioridade ajustada para '${autoPriority}' devido à posição na lista`
                };
                originalTask.priority = autoPriority;
                originalTask.history = [...(originalTask.history || []), rankEntry];
            }
        }
    });

    setTasks(updatedTasks);
    StorageService.saveTasks(updatedTasks);
  };
  
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
        const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || t.id.toLowerCase().includes(filters.search.toLowerCase()) || (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
        const matchesType = filters.type.length === 0 || filters.type.includes(t.type);
        const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
        let matchesAssignee = true;
        if (filters.assignee.length > 0) {
            const hasUnassigned = filters.assignee.includes('Não Atribuído');
            if (hasUnassigned) { matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee); } 
            else { matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee); }
        }
        return matchesSearch && matchesType && matchesPriority && matchesAssignee;
    });
  }, [tasks, filters]);

  const getTasksForColumn = (col: any) => {
      return filteredTasks.filter(t => {
          if (kanbanMode === 'assignee') {
            const isCompleted = ['Concluído', 'Resolvido', 'Fechado'].includes(t.status);
            if (col.type === 'completed') return isCompleted;
            if (isCompleted) return false;
            if (col.type === 'unassigned') return !t.assignee;
            if (col.type === 'dev') return t.assignee === col.id;
            return false;
          } else {
            return col.statuses.includes(t.status);
          }
      }).sort((a, b) => (a.boardPosition || 0) - (b.boardPosition || 0));
  };

  const getDeadlineInfo = (task: Task) => {
      if (!task.endDate) return null;
      const start = task.startDate ? new Date(task.startDate).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'}) : 'Inicio?';
      const endFormatted = new Date(task.endDate).toLocaleDateString('pt-BR', {day:'2-digit', month:'2-digit'});
      const endDate = new Date(task.endDate);
      endDate.setHours(23,59,59,999);
      const today = new Date();
      const diffTime = endDate.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      const isDone = ['Concluído', 'Resolvido', 'Fechado'].includes(task.status);
      let statusColor = "bg-slate-800/50 text-slate-400 border-slate-700";
      let label = "No Prazo";
      if (isDone) {
          statusColor = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
          label = "Entregue";
      } else if (diffDays < 0) {
          statusColor = "bg-rose-500/10 text-rose-400 border-rose-500/30";
          label = `${Math.abs(diffDays)}d Atraso`;
      } else if (diffDays <= 3) {
          statusColor = "bg-orange-500/10 text-orange-400 border-orange-500/30";
          label = `${diffDays}d Restantes`;
      }
      return { range: `${start} - ${endFormatted}`, statusColor, label };
  };

  return (
    <div className="h-full flex flex-col">
      <div className="flex justify-between items-center bg-slate-800 p-2 rounded-xl border border-slate-700 mb-4">
          <FilterBar filters={filters} setFilters={setFilters} devs={devs} />
          <div className="flex bg-slate-900/50 p-1 rounded-lg border border-slate-700 mr-4">
              <button onClick={() => setKanbanMode('assignee')} className={`px-3 py-1 text-xs rounded transition-colors ${kanbanMode === 'assignee' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>Por Responsável</button>
              <button onClick={() => setKanbanMode('status')} className={`px-3 py-1 text-xs rounded transition-colors ${kanbanMode === 'status' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}>Por Status</button>
          </div>
      </div>
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex gap-4 h-full min-w-max px-2 items-start">
          {columns.map((col: any) => {
            const colTasks = getTasksForColumn(col);
            const isCompletedCol = col.type === 'completed' || (col.type === 'status_group' && col.id === 'col-done');
            const isUnassignedCol = col.type === 'unassigned';
            const isBlockedCol = col.type === 'status_group' && col.id === 'col-blocked';
            let headerColor = "border-slate-700 bg-slate-800/80";
            let icon = null;

            if (isCompletedCol) { 
                headerColor = "border-emerald-900/50 bg-emerald-900/20";
                icon = <div className="w-6 h-6 rounded-full bg-emerald-500 flex items-center justify-center text-xs text-white font-bold">✓</div>;
            } else if (isUnassignedCol) {
                headerColor = "border-slate-700 bg-slate-800/50 dashed";
                icon = <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-xs text-white font-bold">?</div>;
            } else if (isBlockedCol) {
                headerColor = "border-rose-900/50 bg-rose-900/20";
                icon = <div className="w-6 h-6 rounded-full bg-rose-500 flex items-center justify-center text-xs text-white font-bold">!</div>;
            } else if (col.type === 'dev') {
                icon = <div className="w-6 h-6 rounded-full bg-indigo-500 flex items-center justify-center text-xs text-white font-bold">{col.title.substring(0,2).toUpperCase()}</div>;
            } else {
                icon = <div className="w-6 h-6 rounded-full bg-slate-600 flex items-center justify-center text-xs text-white font-bold">{col.title.substring(0,1)}</div>;
            }

            return (
                <div key={col.id} className={`flex-1 min-w-[320px] w-[320px] rounded-xl border flex flex-col transition-colors bg-slate-800/30 border-slate-700`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => onDrop(e, col.id, col.type, col.targetStatus)}>
                <div className={`p-3 border-b rounded-t-xl sticky top-0 backdrop-blur-md z-10 flex justify-between items-center ${headerColor}`}>
                    <div className="flex items-center gap-2">
                         {icon}
                        <h3 className="font-semibold text-white truncate max-w-[200px]">{col.title}</h3>
                    </div>
                    <span className="bg-slate-900/50 text-xs px-2 py-1 rounded text-slate-400 font-mono">{colTasks.length}</span>
                </div>
                <div className="p-3 space-y-3 overflow-y-auto flex-1 custom-scrollbar h-full min-h-[100px]">
                    {colTasks.map(task => {
                        const deadline = getDeadlineInfo(task);
                        const isBeingDraggedOver = dragOverTaskId === task.id;

                        return (
                            <div 
                                key={task.id} 
                                draggable 
                                onDragStart={(e) => onDragStart(e, task.id)} 
                                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverTaskId(task.id); }}
                                onDragLeave={() => setDragOverTaskId(null)}
                                onDrop={(e) => onDrop(e, col.id, col.type, col.targetStatus, task.id)}
                                onClick={() => onEditTask(task)} 
                                className={`p-4 rounded-lg border hover:shadow-lg cursor-pointer active:cursor-grabbing group relative overflow-hidden transition-all 
                                ${isBeingDraggedOver ? 'border-t-4 border-t-indigo-500 border-indigo-500/50 bg-indigo-900/10' : ''}
                                ${isCompletedCol ? 'bg-slate-800/50 border-slate-700 opacity-70 hover:opacity-100' : 'bg-slate-700 border-slate-600 hover:border-indigo-500'}`}
                            >
                            <div className={`absolute left-0 top-0 bottom-0 w-1 ${task.type === 'Incidente' ? 'bg-rose-500' : task.type === 'Melhoria' ? 'bg-emerald-500' : 'bg-indigo-500'}`}></div>
                            <div className="flex justify-between items-start mb-2 pl-2"><span className="text-[10px] text-slate-400 font-mono tracking-wide uppercase">{task.id}</span><Badge type={task.priority} /></div>
                            <h4 className={`text-sm font-medium mb-2 pl-2 line-clamp-3 ${isCompletedCol ? 'text-slate-400 line-through' : 'text-slate-100'}`}>{task.summary}</h4>
                            
                            {deadline && (
                                <div className={`ml-2 mb-3 flex items-center justify-between px-2 py-1 rounded border text-[10px] ${deadline.statusColor}`}>
                                    <div className="flex items-center gap-1">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" /></svg>
                                        <span className="font-mono">{deadline.range}</span>
                                    </div>
                                    <span className="font-bold uppercase tracking-wide">{deadline.label}</span>
                                </div>
                            )}

                            <div className="flex justify-between items-end pl-2 mt-auto">
                                <div className="flex flex-col gap-1">
                                    <Badge type={task.type} />
                                    <span className="text-[10px] text-slate-500 mt-1">{task.status}</span>
                                    {kanbanMode === 'status' && <span className="text-[10px] text-indigo-400 font-bold">{task.assignee || 'Sem Dev'}</span>}
                                </div>
                                {task.estimatedTime && (<div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded"><IconClock className="w-3 h-3" /> {task.estimatedTime}</div>)}
                            </div>
                            </div>
                        )
                    })}
                    {colTasks.length === 0 && (<div className="h-20 flex items-center justify-center text-slate-600 text-xs italic border-2 border-dashed border-slate-700/50 rounded-lg">Arraste tarefas aqui</div>)}
                </div>
                </div>
            )
          })}
        </div>
      </div>
    </div>
  );
};

const ListView = ({ tasks, setTasks, devs, onEditTask, user }: { tasks: Task[], setTasks: any, devs: Developer[], onEditTask: (task: Task) => void, user: User }) => {
  const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], status: string[], assignee: string[]}>({ search: '', type: [], priority: [], status: [], assignee: [] });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filtered = tasks.filter(t => {
      const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || t.id.toLowerCase().includes(filters.search.toLowerCase()) || (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
      const matchesType = filters.type.length === 0 || filters.type.includes(t.type);
      const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
      const matchesStatus = filters.status.length === 0 || filters.status.includes(t.status);
      let matchesAssignee = true;
      if (filters.assignee.length > 0) {
          const hasUnassigned = filters.assignee.includes('Não Atribuído');
          if (hasUnassigned) { matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee); } 
          else { matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee); }
      }
      return matchesSearch && matchesType && matchesPriority && matchesStatus && matchesAssignee;
  });

  const toggleSelect = (id: string) => { const newSelected = new Set(selected); if (newSelected.has(id)) newSelected.delete(id); else newSelected.add(id); setSelected(newSelected); };
  const handleBulkAction = (action: string, payload?: any) => {
      if (selected.size === 0) return;
      if (action === 'assign' && payload) { const currentHours = getDevWorkload(payload, tasks); if (currentHours > 40) { if (!window.confirm(`ALERTA DE SOBRECARGA: ${payload} já possui ${formatDuration(currentHours)} em tarefas pendentes. \n\nDeseja atribuir mais ${selected.size} tarefas mesmo assim?`)) { return; } } }
      const updated = tasks.map(t => {
          if (selected.has(t.id)) {
              if (action === 'delete') return null;
              let updatedTask = { ...t }; let actionName = '';
              if (action === 'status') { updatedTask.status = payload; actionName = `Alterou Status (Em massa) para ${payload}`; }
              if (action === 'priority') { updatedTask.priority = payload; actionName = `Alterou Prioridade (Em massa) para ${payload}`; }
              if (action === 'assign') { updatedTask.assignee = payload; actionName = `Atribuiu (Em massa) para ${payload}`; }
              if (actionName) { const entry: HistoryEntry = { id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString(), user: user.name, action: actionName }; updatedTask.history = [...(t.history || []), entry]; }
              return updatedTask;
          }
          return t;
      }).filter(Boolean) as Task[];
      setTasks(updated); StorageService.saveTasks(updated); setSelected(new Set());
  };
  const exportToExcel = () => { const ws = XLSX.utils.json_to_sheet(filtered); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Demandas"); XLSX.writeFile(wb, "Nexus_Demandas.xlsx"); };

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
                        <option value="Backlog">Backlog</option>
                        <option value="Em Atendimento">Em Atendimento</option>
                        <option value="Resolvido">Resolvido</option>
                    </select>
                    <select className="bg-slate-700 text-xs rounded px-2 py-2 outline-none" onChange={(e) => handleBulkAction('assign', e.target.value)}><option value="">Atribuir Dev</option>{devs.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}</select>
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
            <thead className="bg-slate-900 text-slate-400 font-medium sticky top-0 z-10 shadow-md"><tr><th className="p-4 w-10 bg-slate-900"><input type="checkbox" onChange={(e) => setSelected(e.target.checked ? new Set(filtered.map(t => t.id)) : new Set())} /></th><th className="p-4 bg-slate-900">ID</th><th className="p-4 bg-slate-900">Tipo</th><th className="p-4 w-1/3 bg-slate-900">Título</th><th className="p-4 bg-slate-900">Prioridade</th><th className="p-4 bg-slate-900">Status</th><th className="p-4 bg-slate-900">Atribuído</th><th className="p-4 text-right bg-slate-900">Ações</th></tr></thead>
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
                    <td className="p-4 text-right"><button onClick={() => onEditTask(task)} className="text-indigo-400 hover:text-indigo-300 text-xs font-medium px-2 py-1 rounded border border-indigo-900/50 hover:bg-indigo-900/20">Editar</button></td>
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
    const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], status: string[], assignee: string[]}>({ search: '', type: [], priority: [], status: [], assignee: [] });
    const [viewMode, setViewMode] = useState<'Day' | 'Week' | 'Month'>('Day');
    const [startDate, setStartDate] = useState(new Date());

    const ganttTasks = useMemo(() => {
        return tasks.filter(t => {
             if(!t.startDate || !t.endDate) return false;
             const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || t.id.toLowerCase().includes(filters.search.toLowerCase());
             const matchesType = filters.type.length === 0 || filters.type.includes(t.type);
             const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
             const matchesStatus = filters.status.length === 0 || filters.status.includes(t.status);
             let matchesAssignee = true;
             if (filters.assignee.length > 0) {
                 const hasUnassigned = filters.assignee.includes('Não Atribuído');
                 if (hasUnassigned) { matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee); } 
                 else { matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee); }
             }
             return matchesSearch && matchesType && matchesPriority && matchesStatus && matchesAssignee;
        }).sort((a, b) => new Date(a.startDate!).getTime() - new Date(b.startDate!).getTime());
    }, [tasks, filters]);

    const { dates, columnWidth, totalWidth } = useMemo(() => {
        const d = new Date(startDate); const datesArr: Date[] = []; let colW = 50;
        let count = 30; if (viewMode === 'Week') { count = 12; colW = 150; } else if (viewMode === 'Month') { count = 12; colW = 200; } else { count = 45; colW = 40; }
        const startOffset = viewMode === 'Day' ? 5 : 1; 
        if (viewMode === 'Day') d.setDate(d.getDate() - startOffset); if (viewMode === 'Week') d.setDate(d.getDate() - (startOffset * 7)); if (viewMode === 'Month') d.setMonth(d.getMonth() - startOffset);
        for (let i = 0; i < count; i++) {
            const next = new Date(d);
            if (viewMode === 'Day') next.setDate(d.getDate() + i); if (viewMode === 'Week') next.setDate(d.getDate() + (i * 7)); if (viewMode === 'Month') next.setMonth(d.getMonth() + i);
            datesArr.push(next);
        }
        return { dates: datesArr, columnWidth: colW, totalWidth: datesArr.length * colW };
    }, [startDate, viewMode]);

    const handleShiftDate = (dir: number) => { const newDate = new Date(startDate); if (viewMode === 'Day') newDate.setDate(newDate.getDate() + (dir * 7)); if (viewMode === 'Week') newDate.setDate(newDate.getDate() + (dir * 28)); if (viewMode === 'Month') newDate.setMonth(newDate.getMonth() + (dir * 3)); setStartDate(newDate); }
    const getTaskPosition = (task: Task) => {
        if (!task.startDate || !task.endDate || dates.length === 0) return { left: 0, width: 0 };
        const timelineStart = dates[0].getTime();
        const timelineEnd = viewMode === 'Month' ? new Date(dates[dates.length-1].getFullYear(), dates[dates.length-1].getMonth() + 1, 0).getTime() : dates[dates.length-1].getTime() + (viewMode === 'Week' ? 7 : 1) * 86400000;
        const taskStart = new Date(task.startDate).getTime(); const taskEnd = new Date(task.endDate).getTime();
        if (taskEnd < timelineStart || taskStart > timelineEnd) return null;
        const oneDay = 86400000; let scaleFactor = 1; 
        if (viewMode === 'Day') scaleFactor = columnWidth / oneDay; if (viewMode === 'Week') scaleFactor = columnWidth / (oneDay * 7); if (viewMode === 'Month') scaleFactor = columnWidth / (oneDay * 30);
        const offsetTime = Math.max(0, taskStart - timelineStart); const left = offsetTime * scaleFactor;
        const duration = taskEnd - taskStart; const width = Math.max(4, duration * scaleFactor);
        return { left, width };
    }

    const handleExportExcel = () => {
        const exportData = ganttTasks.map((t: Task) => ({
            'ID': t.id,
            'Tipo': t.type,
            'Tarefa': t.summary,
            'Responsável': t.assignee || 'N/A',
            'Início': t.startDate ? new Date(t.startDate).toLocaleDateString() : '',
            'Fim': t.endDate ? new Date(t.endDate).toLocaleDateString() : '',
            'Status': t.status
        }));
        const ws = XLSX.utils.json_to_sheet(exportData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Cronograma Gantt");
        XLSX.writeFile(wb, "Nexus_Cronograma.xlsx");
    };

    const handleExportPPT = () => {
        const pres = new pptxgen();
        pres.layout = 'LAYOUT_WIDE';
        let slide = pres.addSlide();
        slide.background = { color: "0f172a" };
        slide.addText("Cronograma de Demandas", { x: 0.5, y: 0.5, fontSize: 24, color: 'FFFFFF', bold: true });
        slide.addText(`Gerado em: ${new Date().toLocaleDateString()}`, { x: 0.5, y: 1.0, fontSize: 14, color: '94a3b8' });

        const tableData: any[] = [
            ['ID', 'Tarefa', 'Início', 'Fim', 'Status'].map(h => ({ text: h, options: { bold: true, fill: '1e293b', color: 'ffffff' } })),
            ...ganttTasks.map(t => [
                t.id, 
                t.summary, 
                t.startDate ? new Date(t.startDate).toLocaleDateString() : '-', 
                t.endDate ? new Date(t.endDate).toLocaleDateString() : '-',
                t.status
            ])
        ];
        
        const ROWS_PER_SLIDE = 12;
        for (let i = 0; i < tableData.length - 1; i += ROWS_PER_SLIDE) {
            if (i > 0) {
                 slide = pres.addSlide();
                 slide.background = { color: "0f172a" };
                 slide.addText("Cronograma (Cont.)", { x: 0.5, y: 0.5, fontSize: 18, color: 'FFFFFF', bold: true });
            }
            const chunk = [tableData[0], ...tableData.slice(i + 1, i + 1 + ROWS_PER_SLIDE)];
            slide.addTable(chunk as any, { x: 0.5, y: 1.5, w: '90%', colW: [1.5, 5, 1.5, 1.5, 2], color: 'cbd5e1', fontSize: 10, border: { type: 'solid', color: '334155', pt: 0.5 } });
        }

        if (ganttTasks.length > 0) {
             const visualSlide = pres.addSlide();
             visualSlide.background = { color: "0f172a" };
             visualSlide.addText("Linha do Tempo (Visual - Top 15)", { x: 0.5, y: 0.5, fontSize: 20, color: 'FFFFFF', bold: true });
             const tasksToDraw = ganttTasks.slice(0, 15);
             const minDate = new Date(Math.min(...tasksToDraw.map(t => new Date(t.startDate!).getTime())));
             const maxDate = new Date(Math.max(...tasksToDraw.map(t => new Date(t.endDate!).getTime())));
             const buffer = (maxDate.getTime() - minDate.getTime()) * 0.1; 
             const totalDuration = (maxDate.getTime() - minDate.getTime()) + buffer || 1;
             const chartX = 0.5; const chartW = 12;
             tasksToDraw.forEach((task, idx) => {
                 const start = new Date(task.startDate!).getTime();
                 const end = new Date(task.endDate!).getTime();
                 const offset = start - minDate.getTime();
                 const duration = end - start;
                 const xPos = chartX + (offset / totalDuration) * chartW;
                 const width = Math.max(0.1, (duration / totalDuration) * chartW);
                 const yPos = 1.5 + (idx * 0.4);
                 let barColor = '6366f1';
                 if (task.type === 'Incidente') barColor = 'e11d48';
                 if (task.type === 'Melhoria') barColor = '10b981';
                 visualSlide.addShape(pres.ShapeType.rect, { x: xPos, y: yPos, w: width, h: 0.25, fill: { color: barColor }, line: { color: 'ffffff', width: 0.5 } });
                 visualSlide.addText(task.summary, { x: 0.5, y: yPos - 0.15, fontSize: 9, color: 'cbd5e1' });
             });
             visualSlide.addShape(pres.ShapeType.line, { x: 0.5, y: 1.2, w: 12, h: 0, line: { color: '94a3b8', width: 1 } });
             visualSlide.addText(minDate.toLocaleDateString(), { x: 0.5, y: 1.25, fontSize: 10, color: '94a3b8' });
             visualSlide.addText(maxDate.toLocaleDateString(), { x: 12, y: 1.25, fontSize: 10, color: '94a3b8' });
        }
        pres.writeFile({ fileName: "Nexus_Gantt_Presentation.pptx" });
    };

    return (
      <div className="h-full flex flex-col space-y-4">
           <div className="flex flex-col xl:flex-row justify-between xl:items-center gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700">
              <div><h2 className="text-xl font-bold text-white">Cronograma Interativo</h2><p className="text-sm text-slate-400">Linha do tempo dinâmica com filtros</p></div>
              <div className="flex gap-2 bg-slate-900/50 p-1 rounded-lg border border-slate-700">{['Day', 'Week', 'Month'].map((m) => (<button key={m} onClick={() => setViewMode(m as any)} className={`px-4 py-1.5 rounded text-xs font-medium transition-all ${viewMode === m ? 'bg-indigo-600 text-white shadow' : 'text-slate-400 hover:text-white'}`}>{m === 'Day' ? 'Dia' : m === 'Week' ? 'Semana' : 'Mês'}</button>))}</div>
              <div className="flex items-center gap-2">
                  <Button onClick={handleExportExcel} variant="success" className="px-3 py-1 text-xs"><IconDownload className="w-3 h-3" /> Excel</Button>
                  <Button onClick={handleExportPPT} variant="primary" className="px-3 py-1 text-xs"><IconDownload className="w-3 h-3" /> PPT</Button>
                  <div className="w-px h-6 bg-slate-600 mx-2"></div>
                  <button onClick={() => handleShiftDate(-1)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"><IconChevronLeft className="w-5 h-5" /></button><span className="text-sm font-mono text-slate-300 min-w-[100px] text-center">{startDate.toLocaleDateString()}</span><button onClick={() => handleShiftDate(1)} className="p-2 hover:bg-slate-700 rounded-lg text-slate-300 transition-colors"><IconChevronLeft className="w-5 h-5 rotate-180" /></button>
              </div>
          </div>
          <FilterBar filters={filters} setFilters={setFilters} devs={devs} />
          <div className="flex-1 bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden flex flex-col md:flex-row">
               <div className="w-64 flex-shrink-0 border-r border-slate-700 bg-slate-800/30 flex flex-col">
                   <div className="h-10 border-b border-slate-700 flex items-center px-4 bg-slate-800 text-xs font-bold text-slate-400 uppercase tracking-wider">Tarefas</div>
                   <div className="overflow-y-hidden flex-1 relative"><div className="absolute inset-0 overflow-y-auto custom-scrollbar no-scrollbar-vertical-sync"> 
                             {ganttTasks.map((task, i) => (<div key={task.id} className="h-10 border-b border-slate-700/50 flex items-center px-4 hover:bg-slate-800/50 transition-colors group cursor-pointer" title={task.summary}><div className="truncate text-xs font-medium text-slate-300 group-hover:text-white w-full"><span className="text-slate-500 mr-2 opacity-50">{i+1}.</span>{task.summary}</div></div>))}
                        </div></div>
               </div>
               <div className="flex-1 overflow-x-auto custom-scrollbar bg-slate-900 relative flex flex-col">
                    <div className="h-10 flex border-b border-slate-700 bg-slate-800 sticky top-0 z-10" style={{ width: totalWidth }}>
                        {dates.map((d, i) => (<div key={i} className="flex-shrink-0 border-r border-slate-700 flex items-center justify-center text-[10px] text-slate-400 font-mono uppercase" style={{ width: columnWidth }}>{viewMode === 'Day' && `${d.getDate()}/${d.getMonth()+1}`}{viewMode === 'Week' && `Sem ${getWeekNumber(d)}`}{viewMode === 'Month' && d.toLocaleDateString('pt-BR', { month: 'short' })}</div>))}
                    </div>
                    <div className="flex-1 relative" style={{ width: totalWidth }}>
                         <div className="absolute inset-0 flex pointer-events-none">{dates.map((_, i) => (<div key={i} className="flex-shrink-0 h-full border-r border-slate-800/40" style={{ width: columnWidth }}></div>))}</div>
                         <div className="absolute inset-0">
                             {ganttTasks.map((task) => {
                                 const pos = getTaskPosition(task);
                                 let color = "bg-indigo-600 border-indigo-500";
                                 if (['Concluído', 'Resolvido'].includes(task.status)) color = "bg-emerald-600 border-emerald-500 opacity-60";
                                 else if (task.priority === '1 - Crítica') color = "bg-rose-600 border-rose-500";
                                 else if (task.type === 'Melhoria') color = "bg-teal-600 border-teal-500";
                                 return (<div key={task.id} className="h-10 border-b border-slate-700/30 relative w-full group hover:bg-white/5 transition-colors">{pos && (<div className={`absolute top-2 h-6 rounded-md shadow-lg border ${color} bg-opacity-90 hover:bg-opacity-100 transition-all cursor-pointer z-10 flex items-center px-2 overflow-hidden`} style={{ left: pos.left, width: pos.width }}><span className="text-[10px] font-bold text-white whitespace-nowrap sticky left-2 drop-shadow-md">{task.assignee ? `${task.assignee.split(' ')[0]}: ` : ''}{task.summary}</span><div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-800 border border-slate-600 text-white text-xs p-2 rounded shadow-xl opacity-0 group-hover:opacity-100 pointer-events-none w-max z-50"><p className="font-bold">{task.summary}</p><p className="text-[10px] text-slate-400">{new Date(task.startDate!).toLocaleDateString()} - {new Date(task.endDate!).toLocaleDateString()}</p></div></div>)}</div>)
                             })}
                         </div>
                    </div>
               </div>
          </div>
          {ganttTasks.length === 0 && <div className="text-center p-8 text-slate-500 border border-dashed border-slate-700 rounded-xl">Nenhuma tarefa encontrada com data de início e fim definidos para os filtros selecionados.</div>}
      </div>
    )
}

function getWeekNumber(d: Date) { d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay()||7)); var yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1)); return Math.ceil(( ( (d.getTime() - yearStart.getTime()) / 86400000) + 1)/7); }

const ProjectReportView = ({ tasks, workflowConfig, devs }: { tasks: Task[], workflowConfig: WorkflowPhase[], devs: Developer[] }) => {
    const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], status: string[], assignee: string[]}>({ 
        search: '', 
        type: [], 
        priority: [], 
        status: [], 
        assignee: [] 
    });

    const [widgets, setWidgets] = useState<Widget[]>(() => {
        try {
            const saved = localStorage.getItem('nexus_report_widgets');
            const DEFAULT_REPORT_WIDGETS: Widget[] = [
                { id: 'rw1', type: 'kpis', title: 'KPIs do Portfólio', size: 'full', visible: true },
                { id: 'rw2', type: 'phaseChart', title: 'Projetos Ativos por Fase', size: 'half', visible: true, visualStyle: 'bar' },
                { id: 'rw3', type: 'healthChart', title: 'Saúde do Portfólio', size: 'half', visible: true, visualStyle: 'pie' },
                { id: 'rw4', type: 'detailChart', title: 'Progresso Detalhado por Projeto', size: 'full', visible: true, visualStyle: 'bar' },
                { id: 'rw5', type: 'deliveryForecast', title: 'Previsão de Entregas & Bloqueios', size: 'half', visible: true },
            ];
            
            if (saved) {
                const parsed = JSON.parse(saved);
                const hasForecast = parsed.find((w: Widget) => w.type === 'deliveryForecast');
                if (!hasForecast) {
                    parsed.push(DEFAULT_REPORT_WIDGETS.find(w => w.type === 'deliveryForecast'));
                } else {
                    const w = parsed.find((w: Widget) => w.type === 'deliveryForecast');
                    if (w) w.title = 'Previsão de Entregas & Bloqueios';
                }
                return parsed;
            }
            return DEFAULT_REPORT_WIDGETS;
        } catch (e) {
            return [
                { id: 'rw1', type: 'kpis', title: 'KPIs do Portfólio', size: 'full', visible: true },
                { id: 'rw2', type: 'phaseChart', title: 'Projetos Ativos por Fase', size: 'half', visible: true, visualStyle: 'bar' },
                { id: 'rw3', type: 'healthChart', title: 'Saúde do Portfólio', size: 'half', visible: true, visualStyle: 'pie' },
                { id: 'rw4', type: 'detailChart', title: 'Progresso Detalhado por Projeto', size: 'full', visible: true, visualStyle: 'bar' },
                { id: 'rw5', type: 'deliveryForecast', title: 'Previsão de Entregas & Bloqueios', size: 'half', visible: true },
            ];
        }
    });
    const [isEditMode, setIsEditMode] = useState(false);

    useEffect(() => {
        localStorage.setItem('nexus_report_widgets', JSON.stringify(widgets));
    }, [widgets]);

    const filteredProjects = useMemo(() => {
        return tasks.filter(t => {
            const isProjectType = t.type === 'Melhoria' || t.type === 'Nova Automação';
            if (!isProjectType) return false;
            const isCompleted = ['Concluído', 'Resolvido', 'Fechado'].includes(t.status);
            if (filters.status.length === 0 && isCompleted) return false;
            const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || t.id.toLowerCase().includes(filters.search.toLowerCase()) || (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
            const matchesType = filters.type.length === 0 || filters.type.includes(t.type);
            const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
            const matchesStatus = filters.status.length === 0 || filters.status.includes(t.status);
            let matchesAssignee = true;
            if (filters.assignee.length > 0) {
                const hasUnassigned = filters.assignee.includes('Não Atribuído');
                if (hasUnassigned) { matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee); } 
                else { matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee); }
            }
            return matchesSearch && matchesType && matchesPriority && matchesStatus && matchesAssignee;
        });
    }, [tasks, filters]);

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
             return { name: p.summary, phase: phase.name, progress: metrics.getProgress(p), dev: p.assignee || 'N/A' }
        }).sort((a,b) => b.progress - a.progress);
    }, [filteredProjects, workflowConfig, metrics]);

    const healthData = useMemo(() => {
        return [ { name: 'Em Andamento', value: metrics.activeProjects, color: '#10b981' }, { name: 'Travados / Aguardando', value: metrics.stuckProjects, color: '#f59e0b' }, { name: 'Concluídos', value: metrics.completedProjects, color: '#6366f1' } ].filter(d => d.value > 0);
    }, [metrics]);

    const handleExportReportPPT = () => {
         const pres = new pptxgen();
         pres.layout = 'LAYOUT_WIDE';
         let slide = pres.addSlide();
         slide.background = { color: "0f172a" };
         slide.addText("Report Detalhado de Projetos", { x: 1, y: 0.5, fontSize: 24, color: 'FFFFFF', bold: true });
         const drawKPI = (label: string, value: string, color: string, x: number) => {
             slide.addShape(pres.ShapeType.roundRect, { x, y: 1.2, w: 2.5, h: 1.2, fill: { color: '1e293b' }, line: { color, width: 2 } });
             slide.addText(label, { x, y: 1.4, w: 2.5, fontSize: 12, color: '94a3b8', align: 'center' });
             slide.addText(value, { x, y: 1.7, w: 2.5, fontSize: 24, color: 'FFFFFF', bold: true, align: 'center' });
         };
         drawKPI("Total", metrics.total.toString(), '6366f1', 0.5);
         drawKPI("Média Conclusão", `${metrics.avgProgress}%`, '10b981', 3.2);
         drawKPI("Travados", metrics.stuckProjects.toString(), 'f59e0b', 5.9);
         drawKPI("Ativos", metrics.activeProjects.toString(), 'e11d48', 8.6);
         if (phaseData.length > 0) { slide.addChart(pres.ChartType.bar, [ { name: 'Fases', labels: phaseData.map(p => p.name), values: phaseData.map(p => p.value) } ], { x: 0.5, y: 3, w: 5.5, h: 4, chartColors: ['6366f1'], barDir: 'col', title: 'Projetos por Fase', titleColor: 'ffffff' }); }
         if (healthData.length > 0) { const colors = healthData.map(h => h.color.replace('#', '')); slide.addChart(pres.ChartType.doughnut, [ { name: 'Saúde', labels: healthData.map(h => h.name), values: healthData.map(h => h.value) } ], { x: 6.5, y: 3, w: 5.5, h: 4, showLegend: true, title: 'Saúde do Portfólio', titleColor: 'ffffff', chartColors: colors }); }
         slide = pres.addSlide();
         slide.background = { color: "0f172a" };
         slide.addText("Progresso Detalhado por Projeto", { x: 0.5, y: 0.5, fontSize: 20, color: 'FFFFFF', bold: true });
         const tasksToShow = projectProgressData.slice(0, 20);
         const projNames = tasksToShow.map(p => p.name.substring(0, 25) + (p.name.length > 25 ? '...' : ''));
         const projVals = tasksToShow.map(p => p.progress);
         if (projNames.length > 0) { slide.addChart(pres.ChartType.bar, [{ name: '% Conclusão', labels: projNames, values: projVals }], { x: 0.5, y: 1, w: '90%', h: '85%', barDir: 'bar', valAxisMaxVal: 100, chartColors: ['10b981'], catAxisLabelColor: '94a3b8', valAxisLabelColor: '94a3b8' }); }
         pres.writeFile({ fileName: "Nexus_ProjectReport_Detail.pptx" });
     }

    const toggleSize = (id: string) => { setWidgets(prev => prev.map(w => w.id === id ? { ...w, size: w.size === 'full' ? 'half' : 'full' } : w)); };
    const toggleVisibility = (id: string) => { setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w)); };
    const moveWidget = (index: number, direction: 'up' | 'down') => {
        const newWidgets = [...widgets];
        if (direction === 'up' && index > 0) { [newWidgets[index], newWidgets[index - 1]] = [newWidgets[index - 1], newWidgets[index]]; } 
        else if (direction === 'down' && index < newWidgets.length - 1) { [newWidgets[index], newWidgets[index + 1]] = [newWidgets[index + 1], newWidgets[index]]; }
        setWidgets(newWidgets);
    };
    const changeVisualStyle = (id: string, style: any) => { setWidgets(prev => prev.map(w => w.id === id ? { ...w, visualStyle: style } : w)); };

    const renderWidget = (widget: Widget) => {
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

        if (widget.type === 'deliveryForecast') {
            const today = new Date();
            today.setHours(0,0,0,0);
            const forecastData = filteredProjects
                .filter(p => (p.endDate || p.blocker) && !['Concluído', 'Resolvido', 'Fechado'].includes(p.status))
                .map(p => {
                    let diffDays = 0; let statusColor = "bg-slate-500/20 text-slate-400 border border-slate-500/30"; let statusText = "Sem data";
                    if (p.endDate) {
                        const end = new Date(p.endDate!); end.setHours(0,0,0,0);
                        const diffTime = end.getTime() - today.getTime();
                        diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                        statusColor = "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"; statusText = "No Prazo";
                        if (diffDays < 0) { statusColor = "bg-rose-500/20 text-rose-400 border border-rose-500/30"; statusText = "Atrasado"; } 
                        else if (diffDays <= 7) { statusColor = "bg-orange-500/20 text-orange-400 border border-orange-500/30"; statusText = "Crítico"; } 
                        else if (diffDays <= 15) { statusColor = "bg-yellow-500/20 text-yellow-400 border border-yellow-500/30"; statusText = "Atenção"; }
                    }
                    if (p.status === 'Aguardando' || p.status === 'Pendente') { statusColor = "bg-rose-500/20 text-rose-400 border border-rose-500/30"; statusText = "Bloqueado"; }
                    return { ...p, diffDays, statusColor, statusText };
                })
                .sort((a, b) => { if (a.statusText === 'Bloqueado' && b.statusText !== 'Bloqueado') return -1; if (a.statusText !== 'Bloqueado' && b.statusText === 'Bloqueado') return 1; return a.diffDays - b.diffDays; });

            return (
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2 max-h-[300px]">
                    {forecastData.length === 0 ? (<div className="text-center text-slate-500 py-10">Nenhum projeto com data de entrega futura ou bloqueio.</div>) : (
                        <table className="w-full text-sm text-left">
                            <thead className="text-xs text-slate-400 uppercase bg-slate-900/50 sticky top-0"><tr><th className="p-2 rounded-l">Projeto</th><th className="p-2 text-center">Data Fim</th><th className="p-2 text-center">Dias Restantes</th><th className="p-2 text-center">Status</th><th className="p-2 rounded-r">Bloqueios</th></tr></thead>
                            <tbody className="divide-y divide-slate-700/50">
                                {forecastData.map(p => (
                                    <tr key={p.id} className="hover:bg-slate-700/30 transition-colors">
                                        <td className="p-2"><div className="font-medium text-slate-200 truncate max-w-[150px]" title={p.summary}>{p.summary}</div><div className="text-xs text-slate-500">{p.assignee || 'Sem Dev'}</div></td>
                                        <td className="p-2 text-center text-slate-400 font-mono text-xs">{p.endDate ? new Date(p.endDate).toLocaleDateString() : '-'}</td>
                                        <td className="p-2 text-center font-bold text-slate-300">{p.endDate ? `${p.diffDays}d` : '-'}</td>
                                        <td className="p-2 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${p.statusColor}`}>{p.statusText}</span></td>
                                        <td className="p-2 text-xs text-rose-300 max-w-[150px] truncate" title={p.blocker || ''}>{p.blocker || '-'}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            );
        }

        const renderChart = () => {
            const style = widget.visualStyle || 'bar';
            if (widget.type === 'phaseChart') {
                if (style === 'pie') return (<PieChart><Pie data={phaseData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#6366f1" label>{phaseData.map((entry, index) => <Cell key={`cell-${index}`} fill={['#6366f1', '#8b5cf6', '#a855f7', '#d946ef', '#ec4899'][index % 5]} />)}</Pie><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /><Legend /></PieChart>);
                return (<BarChart data={phaseData} layout="vertical" margin={{ left: 40 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" /><XAxis type="number" stroke="#94a3b8" /><YAxis type="category" dataKey="name" stroke="#94a3b8" width={120} tick={{fontSize: 10}} /><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /><Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={30}><LabelList dataKey="value" position="right" fill="#fff" /></Bar></BarChart>);
            }
            if (widget.type === 'healthChart') {
                 if (style === 'bar') return (<BarChart data={healthData}><CartesianGrid strokeDasharray="3 3" stroke="#334155" /><XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} /><YAxis stroke="#94a3b8" /><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /><Bar dataKey="value" radius={[4, 4, 0, 0]}>{healthData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} />)}</Bar></BarChart>);
                 return (<PieChart><Pie data={healthData} cx="50%" cy="50%" innerRadius={60} outerRadius={100} paddingAngle={5} dataKey="value" label>{healthData.map((entry, index) => <Cell key={`cell-${index}`} fill={entry.color} stroke="none" />)}</Pie><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /><Legend /></PieChart>);
            }
            if (widget.type === 'detailChart') {
                return (<BarChart data={projectProgressData} layout="vertical" margin={{ left: 20 }} barSize={20}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" /><XAxis type="number" domain={[0, 100]} stroke="#94a3b8" /><YAxis dataKey="name" type="category" width={150} stroke="#94a3b8" tick={{ fontSize: 10 }} /><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /><Bar dataKey="progress" fill="#10b981" radius={[0, 4, 4, 0]}><LabelList dataKey="progress" position="right" fill="#fff" fontSize={10} formatter={(val: any) => `${val}%`} /></Bar></BarChart>)
            }
            return null;
        };
        return (
            <div className="h-full flex flex-col">
                 <div className="flex justify-between items-center mb-4">
                     <h3 className="text-lg font-bold text-white">{widget.title}</h3>
                     {isEditMode && widget.type !== 'kpis' && widget.type !== 'deliveryForecast' && (<select className="bg-slate-900 border border-slate-600 text-xs text-white rounded px-2 py-1 outline-none" value={widget.visualStyle || 'bar'} onChange={(e) => changeVisualStyle(widget.id, e.target.value)}><option value="bar">Barras</option><option value="pie">Pizza</option></select>)}
                 </div>
                 <div className="flex-1 min-h-[300px]"><ResponsiveContainer width="100%" height="100%">{renderChart() as any}</ResponsiveContainer></div>
             </div>
        )
    };
    return (
        <div className="space-y-6 animate-fade-in pb-10">
            <div className="flex justify-between items-center"><div><h2 className="text-2xl font-bold text-white">Report de Fluxo de Projetos</h2><p className="text-sm text-slate-400">Visão consolidada de Melhorias e Automações</p></div><div className="flex gap-2"><Button onClick={() => setIsEditMode(!isEditMode)} variant={isEditMode ? "success" : "secondary"}>{isEditMode ? 'Salvar Layout' : 'Editar Layout'}</Button><Button onClick={handleExportReportPPT} variant="primary"><IconDownload /> Exportar PPT</Button></div></div>
            <FilterBar filters={filters} setFilters={setFilters} devs={devs} />
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                 {widgets.filter(w => w.visible).map((widget, index) => (
                     <div key={widget.id} className={`${widget.size === 'full' ? 'md:col-span-2 lg:col-span-4' : 'md:col-span-1 lg:col-span-2'} relative group`}><Card className="h-full min-h-[350px]">{renderWidget(widget)}</Card>
                         {isEditMode && (<div className="absolute top-2 right-2 flex flex-col gap-1 bg-slate-900/90 p-1 rounded z-20 opacity-0 group-hover:opacity-100 transition-opacity">{index > 0 && <button onClick={() => moveWidget(index, 'up')} className="p-1 text-white hover:text-indigo-400">↑</button>}{index < widgets.length - 1 && <button onClick={() => moveWidget(index, 'down')} className="p-1 text-white hover:text-indigo-400">↓</button>}<button onClick={() => toggleSize(widget.id)} className="p-1 text-white hover:text-emerald-400">↔</button><button onClick={() => toggleVisibility(widget.id)} className="p-1 text-white hover:text-rose-400">✕</button></div>)}
                     </div>
                 ))}
            </div>
            {isEditMode && widgets.some(w => !w.visible) && (<div className="bg-slate-800 p-4 rounded flex gap-2">{widgets.filter(w => !w.visible).map(w => (<button key={w.id} onClick={() => toggleVisibility(w.id)} className="bg-slate-700 px-3 py-1 rounded text-white text-xs">+ {w.title}</button>))}</div>)}
        </div>
    );
};

const ReportsView = ({ tasks, devs, robots, workflowConfig, docsConfig }: { tasks: Task[], devs: Developer[], robots: Robot[], workflowConfig: WorkflowPhase[], docsConfig: DocumentConfig[] }) => {
    const [apiKey, setApiKey] = useState<string | null>(StorageService.getApiKey());
    const [selectedModules, setSelectedModules] = useState<Set<string>>(new Set(['general', 'exec_summary', 'chart_status']));

    const toggleModule = (id: string) => {
        const next = new Set(selectedModules);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedModules(next);
    };

    const handleConsolidatedExport = async () => {
      // Calls both XLSX and PPT consolidated exports
      ConsolidatedReportService.exportExcel(tasks, robots, workflowConfig, docsConfig, devs);
      await ConsolidatedReportService.exportPPT(tasks, robots, workflowConfig, docsConfig, devs);
    };

    const handleCustomExportExcel = () => {
        if (selectedModules.size === 0) return alert('Selecione ao menos um módulo!');
        const wb = XLSX.utils.book_new();

        if (selectedModules.has('general')) {
            const data = tasks.map(t => ({ 'ID': t.id, 'Tipo': t.type, 'Resumo': t.summary, 'Prioridade': t.priority, 'Status': t.status, 'Responsável': t.assignee || 'Não Atribuído', 'Criado Em': t.createdAt ? new Date(t.createdAt).toLocaleDateString() : '', 'Solicitante': t.requester, 'Estimativa': t.estimatedTime || '', 'Tempo Real': t.actualTime || '', 'Início': t.startDate || '', 'Fim': t.endDate || '', 'Gerência': t.managementArea || '', 'FTE': t.fteValue || 0 }));
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, "Base Geral");
        }
        if (selectedModules.has('backlog')) {
            const backlog = tasks.filter(t => !['Concluído', 'Resolvido', 'Fechado', 'Cancelado'].includes(t.status));
            const data = backlog.map(t => ({ 'ID': t.id, 'Tipo': t.type, 'Resumo': t.summary, 'Status': t.status, 'Prioridade': t.priority, 'Responsável': t.assignee || 'Não Atribuído' }));
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, "Backlog");
        }
        if (selectedModules.has('robots')) {
            const data = robots.map(r => ({ 'Nome': r.name, 'Status': r.status, 'Área': r.area, 'Desenvolvedor': r.developer, 'FTE': r.fte, 'Pasta': r.folder }));
            const ws = XLSX.utils.json_to_sheet(data);
            XLSX.utils.book_append_sheet(wb, ws, "Inventário RPA");
        }
        if (selectedModules.has('capacity_table')) {
            const capacityData = devs.map(dev => {
                const myTasks = tasks.filter(t => t.assignee === dev.name && !['Concluído', 'Resolvido', 'Fechado'].includes(t.status));
                const totalHours = myTasks.reduce((acc, t) => acc + parseDuration(t.estimatedTime), 0);
                return { 'Desenvolvedor': dev.name, 'Demandas Ativas': myTasks.length, 'Carga Estimada (h)': totalHours.toFixed(1), 'Dias Úteis Est.': Math.ceil(totalHours / 8) };
            });
            const ws = XLSX.utils.json_to_sheet(capacityData);
            XLSX.utils.book_append_sheet(wb, ws, "Capacidade Equipe");
        }

        XLSX.writeFile(wb, "Nexus_Report_Personalizado.xlsx");
    };

    const handleCustomExportPPT = () => {
        if (selectedModules.size === 0) return alert('Selecione ao menos um módulo!');
        const pres = new pptxgen();
        pres.layout = 'LAYOUT_WIDE';

        // Slide de Capa
        let slide = pres.addSlide();
        slide.background = { color: "0f172a" };
        slide.addText("Relatório de Performance Nexus", { x: 1, y: 3, w: '80%', fontSize: 36, color: 'FFFFFF', bold: true });
        slide.addText(`Gerado em: ${new Date().toLocaleDateString()}`, { x: 1, y: 4, fontSize: 18, color: '94a3b8' });

        const activeTasks = tasks.filter(t => !['Concluído', 'Resolvido', 'Fechado'].includes(t.status));

        if (selectedModules.has('exec_summary')) {
            slide = pres.addSlide();
            slide.background = { color: "0f172a" };
            slide.addText("Resumo Executivo do Portfólio", { x: 0.5, y: 0.5, fontSize: 24, color: 'FFFFFF', bold: true });
            const metrics = {
                active: activeTasks.length,
                inc: activeTasks.filter(t => t.type === 'Incidente').length,
                mel: activeTasks.filter(t => t.type === 'Melhoria').length,
                aut: activeTasks.filter(t => t.type === 'Nova Automação').length
            };
            const drawCard = (x:number, title:string, val:number, color:string) => {
                slide.addShape(pres.ShapeType.roundRect, { x, y: 1.5, w: 2.5, h: 1.5, fill: { color: '1e293b' }, line: { color, width: 2 } });
                slide.addText(title, { x, y: 1.7, w: 2.5, fontSize: 14, color: '94a3b8', align: 'center' });
                slide.addText(val.toString(), { x, y: 2.2, w: 2.5, fontSize: 32, color: 'FFFFFF', bold: true, align: 'center' });
            };
            drawCard(0.5, "Total Ativos", metrics.active, '6366f1');
            drawCard(3.5, "Incidentes", metrics.inc, 'e11d48');
            drawCard(6.5, "Melhorias", metrics.mel, '10b981');
            drawCard(9.5, "Automações", metrics.aut, '8b5cf6');
        }

        if (selectedModules.has('chart_status')) {
            slide = pres.addSlide();
            slide.background = { color: "0f172a" };
            slide.addText("Distribuição por Status", { x: 0.5, y: 0.5, fontSize: 22, color: 'FFFFFF' });
            const grouped = ['Novo', 'Pendente', 'Em Progresso', 'Aguardando', 'Backlog'].map(s => {
                return { name: s, value: activeTasks.filter(t => t.status === s).length };
            }).filter(d => d.value > 0);
            if (grouped.length > 0) {
                slide.addChart(pres.ChartType.bar, [{ name: 'Status', labels: grouped.map(g => g.name), values: grouped.map(g => g.value) }], { x: 0.5, y: 1.5, w: 12, h: 4, barDir: 'col', chartColors: ['6366f1'], valAxisLabelColor: 'ffffff', catAxisLabelColor: 'ffffff' });
            }
        }

        if (selectedModules.has('table_capacity')) {
            slide = pres.addSlide();
            slide.background = { color: "0f172a" };
            slide.addText("Capacidade da Equipe (Backlog Ativo)", { x: 0.5, y: 0.5, fontSize: 22, color: 'FFFFFF' });
            const capData = devs.map(d => {
                const h = tasks.filter(t => t.assignee === d.name && !['Concluído', 'Resolvido', 'Fechado'].includes(t.status)).reduce((acc, t) => acc + parseDuration(t.estimatedTime), 0);
                return [d.name, formatDuration(h), `${Math.ceil(h / 8)}d`];
            });
            slide.addTable([['Dev', 'Horas', 'Dias Est.'], ...capData] as any, { x: 0.5, y: 1.5, w: 12, color: 'cbd5e1', fill: { color: '1e293b' }, fontSize: 12, border: { type: 'solid', color: '334155', pt: 0.5 } });
        }

        if (selectedModules.has('chart_fte')) {
            slide = pres.addSlide();
            slide.background = { color: "0f172a" };
            slide.addText("Geração de Valor (FTE) por Área", { x: 0.5, y: 0.5, fontSize: 22, color: 'FFFFFF' });
            const fteMap: Record<string, number> = {};
            activeTasks.forEach(t => { const area = t.managementArea || 'N/A'; fteMap[area] = (fteMap[area] || 0) + (Number(t.fteValue) || 0); });
            const fteData = Object.entries(fteMap).map(([name, value]) => ({ name, value }));
            if (fteData.length > 0) {
                slide.addChart(pres.ChartType.bar, [{ name: 'FTE', labels: fteData.map(d => d.name), values: fteData.map(d => d.value) }], { x: 0.5, y: 1.5, w: 12, h: 4, barDir: 'bar', chartColors: ['10b981'], valAxisLabelColor: 'ffffff', catAxisLabelColor: 'ffffff' });
            }
        }

        pres.writeFile({ fileName: `Nexus_Apresentacao_${Date.now()}.pptx` });
    };

    const handleGenerateKey = () => { const key = StorageService.generateApiKey(); setApiKey(key); };
    const powerBiUrl = useMemo(() => { if (!apiKey) return ''; return `${window.location.origin}${window.location.pathname}#/powerbi-data?key=${apiKey}`; }, [apiKey]);
    const copyToClipboard = () => { if (powerBiUrl) { navigator.clipboard.writeText(powerBiUrl); alert('URL copiada para a área de transferência!'); } };

    const exportOptions = [
        { id: 'general', label: 'Base Geral de Demandas', cat: 'Operacional', icon: <IconList className="w-4 h-4" /> },
        { id: 'backlog', label: 'Relatório de Backlog', cat: 'Operacional', icon: <IconClock className="w-4 h-4" /> },
        { id: 'robots', label: 'Inventário de Robôs', cat: 'Operacional', icon: <IconRobot className="w-4 h-4" /> },
        { id: 'capacity_table', label: 'Tabela de Capacidade', cat: 'Operacional', icon: <IconUsers className="w-4 h-4" /> },
        { id: 'exec_summary', label: 'KPIs do Portfólio (Cards)', cat: 'Gerencial', icon: <IconChartBar className="w-4 h-4" /> },
        { id: 'chart_status', label: 'Gráfico: Status por Tipo', cat: 'Gerencial', icon: <IconChartBar className="w-4 h-4" /> },
        { id: 'chart_fte', label: 'Gráfico: FTE por Área', cat: 'Gerencial', icon: <IconChartBar className="w-4 h-4" /> },
        { id: 'table_capacity', label: 'Tabela: Carga da Equipe', cat: 'Gerencial', icon: <IconUsers className="w-4 h-4" /> },
    ];

    return (
        <div className="space-y-6 pb-20 animate-fade-in">
            <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-white mb-2">Central de Relatórios</h2>
                    <p className="text-slate-400">Extração de dados personalizada para gestão e operações.</p>
                </div>
                <Button onClick={handleConsolidatedExport} variant="success" className="py-3 px-6 text-base animate-pulse hover:animate-none">
                    <IconDownload className="w-6 h-6" /> Exportar Report Semanal (PPT + Excel)
                </Button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <Card className="border-indigo-500/30 bg-indigo-900/5">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold text-white flex items-center gap-2">
                                <IconDocument className="w-6 h-6 text-indigo-400" /> Relatório Personalizado
                            </h3>
                            <div className="flex gap-2">
                                <button onClick={() => setSelectedModules(new Set(exportOptions.map(o => o.id)))} className="text-xs text-indigo-400 hover:underline">Selecionar Todos</button>
                                <button onClick={() => setSelectedModules(new Set())} className="text-xs text-slate-500 hover:underline">Limpar</button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                            <div>
                                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Módulos Operacionais</h4>
                                <div className="space-y-2">
                                    {exportOptions.filter(o => o.cat === 'Operacional').map(opt => (
                                        <label key={opt.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${selectedModules.has(opt.id) ? 'bg-indigo-600/10 border-indigo-500/50 text-white' : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                                            <input type="checkbox" className="hidden" checked={selectedModules.has(opt.id)} onChange={() => toggleModule(opt.id)} />
                                            <div className={`w-5 h-5 rounded flex items-center justify-center border ${selectedModules.has(opt.id) ? 'bg-indigo-500 border-indigo-500' : 'border-slate-600'}`}>
                                                {selectedModules.has(opt.id) && <IconCheck className="w-3 h-3 text-white" />}
                                            </div>
                                            <span className="text-sm font-medium">{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Módulos Gerenciais (PPT)</h4>
                                <div className="space-y-2">
                                    {exportOptions.filter(o => o.cat === 'Gerencial').map(opt => (
                                        <label key={opt.id} className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-all ${selectedModules.has(opt.id) ? 'bg-emerald-600/10 border-emerald-500/50 text-white' : 'bg-slate-900/50 border-slate-700 text-slate-400 hover:border-slate-600'}`}>
                                            <input type="checkbox" className="hidden" checked={selectedModules.has(opt.id)} onChange={() => toggleModule(opt.id)} />
                                            <div className={`w-5 h-5 rounded flex items-center justify-center border ${selectedModules.has(opt.id) ? 'bg-emerald-500 border-emerald-500' : 'border-slate-600'}`}>
                                                {selectedModules.has(opt.id) && <IconCheck className="w-3 h-3 text-white" />}
                                            </div>
                                            <span className="text-sm font-medium">{opt.label}</span>
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div className="flex flex-wrap gap-4 pt-6 border-t border-slate-700">
                            <Button variant="success" onClick={handleCustomExportExcel} className="flex-1 min-w-[200px] py-3">
                                <IconDownload className="w-5 h-5" /> Exportar para Excel (.xlsx)
                            </Button>
                            <Button variant="primary" onClick={handleCustomExportPPT} className="flex-1 min-w-[200px] py-3">
                                <IconDownload className="w-5 h-5" /> Exportar para PowerPoint (.pptx)
                            </Button>
                        </div>
                    </Card>
                </div>

                <div className="space-y-6">
                    <h3 className="text-xl font-bold text-yellow-500 flex items-center gap-2">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6"><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605" /></svg> Integração Power BI
                    </h3>
                    <Card className="border-yellow-500/30 bg-yellow-900/5">
                        <div className="flex justify-between items-start mb-4">
                            <div>
                                <h4 className="font-bold text-white">Chave de Conexão</h4>
                                <p className="text-sm text-slate-400 mt-1">Sincronização em tempo real via endpoint JSON.</p>
                            </div>
                            <div className={`px-2 py-1 rounded text-xs font-bold uppercase ${apiKey ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-700 text-slate-400'}`}>{apiKey ? 'Ativo' : 'Inativo'}</div>
                        </div>
                        {apiKey ? (
                            <div className="space-y-3">
                                <div className="bg-slate-900 border border-slate-700 rounded p-3 flex items-center justify-between">
                                    <code className="text-xs text-slate-300 font-mono break-all">{powerBiUrl}</code>
                                    <button onClick={copyToClipboard} className="ml-2 p-1 hover:bg-slate-700 rounded text-slate-400 hover:text-white">
                                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 01-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 011.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 00-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 01-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 00-3.375-3.375h-1.5" /></svg>
                                    </button>
                                </div>
                                <Button variant="warning" onClick={handleGenerateKey} className="w-full text-xs mt-2">Regerar Chave</Button>
                            </div>
                        ) : (
                            <Button variant="primary" onClick={handleGenerateKey} className="w-full">Gerar Chave de Acesso</Button>
                        )}
                    </Card>
                </div>
            </div>
        </div>
    );
};

const RobotManagementView = ({ robots, setRobots }: { robots: Robot[], setRobots: any }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('Todos');
    const [areaFilter, setAreaFilter] = useState('Todas');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingRobot, setEditingRobot] = useState<Robot | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const areas = useMemo(() => { const unique = new Set(robots.map(r => r.area).filter(Boolean)); return ['Todas', ...Array.from(unique).sort()]; }, [robots]);
    const statuses = ['Todos', 'ATIVO', 'DESATIVO', 'EM DESENVOLVIMENTO'];
    const filteredRobots = useMemo(() => { return robots.filter(r => { const matchSearch = r.name.toLowerCase().includes(searchTerm.toLowerCase()) || r.developer.toLowerCase().includes(searchTerm.toLowerCase()) || r.area.toLowerCase().includes(searchTerm.toLowerCase()); const matchStatus = statusFilter === 'Todos' || r.status === statusFilter; const matchArea = areaFilter === 'Todas' || r.area === areaFilter; return matchSearch && matchStatus && matchArea; }); }, [robots, searchTerm, statusFilter, areaFilter]);
    const statusData = useMemo(() => { const counts: Record<string, number> = {}; filteredRobots.forEach(r => { counts[r.status] = (counts[r.status] || 0) + 1; }); return Object.entries(counts).map(([name, value]) => ({ name, value })); }, [filteredRobots]);
    const areaData = useMemo(() => { const counts: Record<string, number> = {}; filteredRobots.forEach(r => { counts[r.area] = (counts[r.area] || 0) + 1; }); return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value); }, [filteredRobots]);
    const handleFileUpload = async () => { if (!file) return; try { const newRobots = await ExcelService.parseRobotFile(file); const merged = [...robots, ...newRobots]; setRobots(merged); StorageService.saveRobots(merged); alert(`${newRobots.length} robôs importados com sucesso.`); setFile(null); } catch (e) { alert('Erro ao importar arquivo.'); } };
    const handleSaveRobot = (robot: Robot) => { if (editingRobot) { const updated = robots.map(r => r.id === robot.id ? robot : r); setRobots(updated); StorageService.saveRobots(updated); } else { const newRobot = { ...robot, id: `rpa-${Date.now()}` }; const updated = [...robots, newRobot]; setRobots(updated); StorageService.saveRobots(updated); } setIsModalOpen(false); setEditingRobot(null); };
    const handleDeleteRobot = (id: string) => { if (window.confirm('Tem certeza que deseja excluir este robô?')) { const updated = robots.filter(r => r.id !== id); setRobots(updated); StorageService.saveRobots(updated); } };
    const handleExport = () => { const ws = XLSX.utils.json_to_sheet(filteredRobots.map(r => ({ 'NOME DO ROBÔ': r.name, 'PASTA QUE ESTÁ ARMAZENADO': r.folder, 'SITUAÇÃO': r.status, 'DESENVOLVEDOR': r.developer, 'OWNERS': r.owners, 'ÁREA': r.area, 'FTE': r.fte || 0, 'CHAMADO': r.ticketNumber || '' }))); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Robôs"); XLSX.writeFile(wb, "Nexus_Robots_Base.xlsx"); };
    return (<div className="space-y-6 h-full flex flex-col pb-20"><div className="flex flex-col xl:flex-row justify-between xl:items-center gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700"><div><h2 className="text-xl font-bold text-white">Gestão de RPAs</h2><p className="text-sm text-slate-400">Base de conhecimento e status dos robôs</p></div><div className="flex gap-2 items-center flex-wrap"><div className="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded px-2"><input type="file" id="robotUpload" className="hidden" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} /><label htmlFor="robotUpload" className="text-xs text-slate-400 cursor-pointer hover:text-white py-2 px-1">{file ? file.name : 'Selecionar Planilha...'}</label>{file && <button onClick={handleFileUpload} className="text-xs text-emerald-400 font-bold hover:underline px-2">Importar</button>}</div><Button variant="success" onClick={handleExport} className="text-xs py-2"><IconUpload className="w-4 h-4" /> Exportar</Button><Button onClick={() => { setEditingRobot(null); setIsModalOpen(true); }} className="text-xs py-2"><IconPlus className="w-4 h-4" /> Novo Robô</Button></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-6"><Card className="h-64 flex flex-col"><h3 className="text-sm font-bold text-slate-300 mb-2">Distribuição por Status</h3><div className="flex-1"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={70} label>{statusData.map((entry, index) => <Cell key={index} fill={entry.name === 'ATIVO' ? '#10b981' : entry.name === 'DESATIVO' ? '#f43f5e' : '#f59e0b'} />)}</Pie><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /><Legend layout="vertical" verticalAlign="middle" align="right" wrapperStyle={{fontSize:'10px'}} /></PieChart></ResponsiveContainer></div></Card><Card className="h-64 flex flex-col"><h3 className="text-sm font-bold text-slate-300 mb-2">Robôs por Área</h3><div className="flex-1"><ResponsiveContainer width="100%" height="100%"><BarChart data={areaData} layout="vertical" margin={{ left: 20 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" /><XAxis type="number" stroke="#94a3b8" hide /><YAxis type="category" dataKey="name" stroke="#94a3b8" width={100} tick={{fontSize: 10}} /><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /><Bar dataKey="value" fill="#6366f1" radius={[0, 4, 4, 0]} barSize={20}><LabelList dataKey="value" position="right" fill="#fff" fontSize={10} /></Bar></BarChart></ResponsiveContainer></div></Card></div><div className="flex flex-col md:flex-row gap-4 bg-slate-800 p-4 rounded-xl border border-slate-700"><div className="relative flex-1"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" /></svg><input type="text" placeholder="Buscar robô..." className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500" value={searchTerm} onChange={e => setSearchTerm(e.target.value)} /></div><select className="bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 outline-none" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>{statuses.map(s => <option key={s} value={s}>{s === 'Todos' ? 'Status: Todos' : s}</option>)}</select><select className="bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 outline-none max-w-[200px]" value={areaFilter} onChange={(e) => setAreaFilter(e.target.value)}>{areas.map(a => <option key={a} value={a}>{a === 'Todas' ? 'Área: Todas' : a}</option>)}</select></div><div className="flex-1 bg-slate-900/50 rounded-xl border border-slate-700 overflow-hidden flex flex-col"><div className="overflow-auto custom-scrollbar flex-1"><table className="w-full text-left text-sm"><thead className="bg-slate-900 text-slate-400 font-medium sticky top-0 z-10 shadow-md"><tr><th className="p-4">Nome do Robô</th><th className="p-4">Situação</th><th className="p-4">Área</th><th className="p-4">Chamado</th><th className="p-4">FTE</th><th className="p-4">Desenvolvedor</th><th className="p-4">Pasta</th><th className="p-4 text-right">Ações</th></tr></thead><tbody className="divide-y divide-slate-700">{filteredRobots.map(robot => (<tr key={robot.id} className="hover:bg-slate-800/50 transition-colors group"><td className="p-4 font-medium text-white">{robot.name}</td><td className="p-4"><span className={`px-2 py-0.5 text-[10px] rounded font-bold uppercase ${robot.status === 'ATIVO' ? 'bg-emerald-500/20 text-emerald-400' : robot.status === 'DESATIVO' ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-700 text-slate-400'}`}>{robot.status}</span></td><td className="p-4 text-slate-300">{robot.area}</td><td className="p-4 text-slate-400 font-mono text-xs">{robot.ticketNumber || '-'}</td><td className="p-4 text-slate-300">{robot.fte || '-'}</td><td className="p-4 text-slate-400">{robot.developer}</td><td className="p-4 text-xs text-slate-500 font-mono truncate max-w-[150px]" title={robot.folder}>{robot.folder}</td><td className="p-4 text-right"><button onClick={() => { setEditingRobot(robot); setIsModalOpen(true); }} className="text-indigo-400 hover:text-indigo-300 mr-3">Editar</button><button onClick={() => handleDeleteRobot(robot.id)} className="text-rose-400 hover:text-rose-300">Excluir</button></td></tr>))}</tbody></table>{filteredRobots.length === 0 && <div className="p-10 text-center text-slate-500">Nenhum robô encontrado.</div>}</div></div>{isModalOpen && (<div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"><div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-lg shadow-2xl"><div className="p-6 border-b border-slate-700"><h3 className="text-xl font-bold text-white">{editingRobot ? 'Editar Robô' : 'Novo Robô'}</h3></div><div className="p-6 space-y-4"><form id="robotForm" onSubmit={(e) => { e.preventDefault(); const form = e.target as HTMLFormElement; const data = new FormData(form); handleSaveRobot({ id: editingRobot?.id || '', name: data.get('name') as string, folder: data.get('folder') as string, status: data.get('status') as string, developer: data.get('developer') as string, owners: data.get('owners') as string, area: data.get('area') as string, fte: parseFloat(data.get('fte') as string) || undefined, ticketNumber: data.get('ticketNumber') as string }); }}><div className="space-y-4"><div><label className="block text-xs text-slate-400 mb-1">Nome do Robô</label><input name="name" defaultValue={editingRobot?.name} required className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" /></div><div className="grid grid-cols-2 gap-4"><div><label className="block text-xs text-slate-400 mb-1">Área</label><input name="area" defaultValue={editingRobot?.area} required className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" /></div><div><label className="block text-xs text-slate-400 mb-1">Situação</label><select name="status" defaultValue={editingRobot?.status || 'ATIVO'} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500"><option value="ATIVO">ATIVO</option><option value="DESATIVO">DESATIVO</option><option value="EM DESENVOLVIMENTO">EM DESENVOLVIMENTO</option></select></div></div><div className="grid grid-cols-2 gap-4"><div><label className="block text-xs text-slate-400 mb-1">Desenvolvedor</label><input name="developer" defaultValue={editingRobot?.developer} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" /></div><div><label className="block text-xs text-slate-400 mb-1">Owners</label><input name="owners" defaultValue={editingRobot?.owners} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" /></div></div><div className="grid grid-cols-2 gap-4 bg-slate-900/30 p-2 rounded"><div><label className="block text-xs text-slate-400 mb-1">Nº Chamado</label><input name="ticketNumber" defaultValue={editingRobot?.ticketNumber} placeholder="Ex: R12345" className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" /></div><div><label className="block text-xs text-slate-400 mb-1">FTE</label><input type="number" step="0.01" name="fte" defaultValue={editingRobot?.fte} placeholder="0.00" className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" /></div></div><div><label className="block text-xs text-slate-400 mb-1">Pasta de Armazenamento</label><input name="folder" defaultValue={editingRobot?.folder} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" /></div></div><div className="flex justify-end gap-3 mt-6"><Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancelar</Button><Button type="submit">Salvar</Button></div></form></div></div></div>)}</div>); };

const ProjectFlowView = ({ tasks, setTasks, devs, onEditTask, user, workflowConfig, setWorkflowConfig }: any) => {
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    const [filters, setFilters] = useState<{search: string, type: string[], priority: string[], status: string[], assignee: string[]}>({ search: '', type: [], priority: [], status: [], assignee: [] });
    const filteredTasks = useMemo(() => { return tasks.filter((t:Task) => { const isProjectType = t.type === 'Melhoria' || t.type === 'Nova Automação'; if (!isProjectType) return false; const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || t.id.toLowerCase().includes(filters.search.toLowerCase()) || (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase())); const matchesType = filters.type.length === 0 || filters.type.includes(t.type); const matchesPriority = filters.priority.length === 0 || filters.priority.includes(t.priority); const matchesStatus = filters.status.length === 0 || filters.status.includes(t.status); let matchesAssignee = true; if (filters.assignee.length > 0) { const hasUnassigned = filters.assignee.includes('Não Atribuído'); if (hasUnassigned) { matchesAssignee = !t.assignee || filters.assignee.includes(t.assignee); } else { matchesAssignee = !!t.assignee && filters.assignee.includes(t.assignee); } } return matchesSearch && matchesType && matchesPriority && matchesStatus && matchesAssignee; }); }, [tasks, filters]);
    const handlePhaseUpdate = (taskId: string, phaseId: string, status: string) => { const updated = tasks.map((t:Task) => { if (t.id === taskId) { const currentData = t.projectData || { currentPhaseId: '1', phaseStatus: 'Não Iniciado', completedActivities: [] }; t.projectData = { ...currentData, currentPhaseId: phaseId, phaseStatus: status }; const entry: HistoryEntry = { id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString(), user: user.name, action: `Atualizou status da fase para ${status}` }; t.history = [...(t.history || []), entry]; } return t; }); setTasks(updated); StorageService.saveTasks(updated); };
    const handleChangePhase = (taskId: string, direction: number) => { const updated = tasks.map((t:Task) => { if (t.id === taskId) { const currentPhaseId = t.projectData?.currentPhaseId || '1'; let currentIndex = workflowConfig.findIndex((w:any) => w.id === currentPhaseId); if (currentIndex === -1) currentIndex = 0; const newIndex = currentIndex + direction; if (newIndex >= 0 && newIndex < workflowConfig.length) { const newPhase = workflowConfig[newIndex]; t.projectData = { ...(t.projectData || { completedActivities: [] }), currentPhaseId: newPhase.id, phaseStatus: newPhase.statuses[0] }; const entry: HistoryEntry = { id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString(), user: user.name, action: `Alterou fase do projeto para ${newPhase.name}` }; t.history = [...(t.history || []), entry]; } } return t; }); setTasks(updated); StorageService.saveTasks(updated); };
    const handleAddPhase = (newPhase: WorkflowPhase) => { const updated = [...workflowConfig, newPhase]; setWorkflowConfig(updated); StorageService.saveWorkflowConfig(updated); };
    const handleUpdatePhase = (updatedPhase: WorkflowPhase) => { const updated = workflowConfig.map((p:any) => p.id === updatedPhase.id ? updatedPhase : p); setWorkflowConfig(updated); StorageService.saveWorkflowConfig(updated); };
    const handleDeletePhase = (phaseId: string) => { const updated = workflowConfig.filter((p:any) => p.id !== phaseId); setWorkflowConfig(updated); StorageService.saveWorkflowConfig(updated); };
    const getProgress = (task: Task) => { if (['Concluído', 'Resolvido', 'Fechado'].includes(task.status)) return 100; const currentId = task.projectData?.currentPhaseId; let index = workflowConfig.findIndex((w:any) => w.id === currentId); if (index === -1) index = 0; const status = task.projectData?.phaseStatus?.toLowerCase() || ''; const isCompleted = status.includes('concluído') || status.includes('concluido') || status.includes('finalizado'); const completedPhases = index + (isCompleted ? 1 : 0); return Math.min(100, Math.round((completedPhases / workflowConfig.length) * 100)); };
    const handleExportExcel = () => { const exportData = filteredTasks.map((t:Task) => { const row: any = { 'ID': t.id, 'Projeto': t.summary, 'Tipo': t.type, 'Desenvolvedor': t.assignee || 'Não Atribuído', 'Status Global': t.status }; const progress = getProgress(t); let currentTaskPhaseIndex = workflowConfig.findIndex((w:any) => w.id === (t.projectData?.currentPhaseId || '1')); if (currentTaskPhaseIndex === -1) currentTaskPhaseIndex = 0; workflowConfig.forEach((phase:any, idx:number) => { const isActive = (t.projectData?.currentPhaseId || '1') === phase.id; const isPast = idx < currentTaskPhaseIndex; const isDone = progress === 100; let val = ''; if (isActive) val = t.projectData?.phaseStatus || 'Não Iniciado'; else if (isPast || isDone) val = 'Concluído'; else val = 'Não Iniciado'; row[phase.name] = val; }); row['% Conclusão'] = `${progress}%`; return row; }); const ws = XLSX.utils.json_to_sheet(exportData); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "Fluxo de Projetos"); XLSX.writeFile(wb, "Nexus_FluxoProjetos.xlsx"); };
    return (<div className="h-full flex flex-col space-y-4"><div className="flex justify-between items-center bg-slate-800 p-4 rounded-xl border border-slate-700"><div><h2 className="text-xl font-bold text-white">Fluxo de Projetos</h2><p className="text-sm text-slate-400">Acompanhamento detalhado das fases de Melhorias e Automações</p></div><div className="flex gap-2"><Button onClick={handleExportExcel} variant="success"><IconDownload className="w-4 h-4" /> Excel</Button><Button variant="secondary" onClick={() => setIsConfigOpen(true)}><IconPlus className="w-4 h-4" /> Configurar Fases</Button></div></div><FilterBar filters={filters} setFilters={setFilters} devs={devs} /><div className="flex-1 overflow-auto bg-slate-900/50 rounded-xl border border-slate-700 p-4 custom-scrollbar"><table className="w-full text-left text-sm border-separate border-spacing-y-2"><thead><tr className="text-slate-400 font-medium text-xs uppercase tracking-wider"><th className="pb-2 pl-2">Projeto</th>{workflowConfig.map((phase:any) => <th key={phase.id} className="pb-2 px-2 text-center min-w-[140px]">{phase.name}</th>)}<th className="pb-2 text-center">% Conclusão</th></tr></thead><tbody>{filteredTasks.map((task:Task) => { let currentPhaseIndex = workflowConfig.findIndex((w:any) => w.id === (task.projectData?.currentPhaseId || '1')); if (currentPhaseIndex === -1) currentPhaseIndex = 0; const progress = getProgress(task); const isGlobalDone = ['Concluído', 'Resolvido', 'Fechado'].includes(task.status); return (<tr key={task.id} className="bg-slate-800 hover:bg-slate-700/50 transition-colors group"><td className="p-3 rounded-l-lg border-l-4 border-l-indigo-500 cursor-pointer" onClick={() => onEditTask(task)}><div className="flex flex-col gap-1"><div className="flex items-center gap-2"><span className="font-mono text-xs text-slate-500">{task.id}</span><Badge type={task.type} /></div><span className="font-medium text-white truncate max-w-[200px]" title={task.summary}>{task.summary}</span><span className="text-xs text-slate-400">{task.assignee || 'Sem Dev'}</span></div></td>{workflowConfig.map((phase:any, idx:number) => { const isCurrentPhase = (task.projectData?.currentPhaseId || '1') === phase.id || (task.projectData?.currentPhaseId === undefined && idx === 0); const isActive = isCurrentPhase && !isGlobalDone; const isPast = idx < currentPhaseIndex || isGlobalDone; const phaseStatus = isActive ? (task.projectData?.phaseStatus || 'Não Iniciado') : isPast ? 'Concluído' : 'Não iniciado'; let bgClass = "bg-slate-900/50 border-slate-700"; let textClass = "text-slate-500"; if (isPast) { bgClass = "bg-emerald-900/20 border-emerald-500/30"; textClass = "text-emerald-500"; } else if (isActive) { bgClass = "bg-indigo-900/20 border-indigo-500/50 shadow-[0_0_10px_rgba(99,102,241,0.2)]"; textClass = "text-indigo-400 font-bold"; } let statusColor = "text-slate-400"; const statusLower = phaseStatus.toLowerCase(); if (statusLower.includes('concluído') || statusLower.includes('concluido')) statusColor = "text-emerald-400"; else if (statusLower.includes('andamento') || statusLower.includes('progresso')) statusColor = "text-indigo-400"; else if (statusLower.includes('cancelado')) statusColor = "text-rose-400"; else if (statusLower.includes('despriorizado')) statusColor = "text-rose-400 font-bold"; else if (statusLower.includes('aguardando')) statusColor = "text-orange-400 font-bold"; else if (statusLower.includes('validar')) statusColor = "text-blue-400"; else if (statusLower.includes('elaborar') || statusLower.includes('executar')) statusColor = "text-yellow-400"; else if (statusLower.includes('backlog')) statusColor = "text-purple-400"; return (<td key={phase.id} className={`p-2 border-y first:border-l last:border-r border-slate-700/50 text-center relative`}><div className={`w-full h-full p-2 rounded flex flex-col items-center justify-center border ${bgClass} min-h-[90px]`}><span className={`text-[10px] uppercase mb-1 leading-tight ${statusColor}`}>{phaseStatus}</span>{isActive && (<><select className="bg-slate-900 text-xs border border-slate-600 rounded px-1 py-0.5 max-w-[130px] outline-none mb-2" value={phaseStatus} onChange={(e) => handlePhaseUpdate(task.id, phase.id, e.target.value)} onClick={(e) => e.stopPropagation()}>{phase.statuses.map((s:string) => <option key={s} value={s}>{s}</option>)}</select><div className="flex gap-2"><button onClick={(e) => { e.stopPropagation(); handleChangePhase(task.id, -1); }} disabled={currentPhaseIndex === 0} className="w-5 h-5 flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 disabled:opacity-30 disabled:cursor-not-allowed text-xs" title="Fase Anterior">&lt;</button><button onClick={(e) => { e.stopPropagation(); handleChangePhase(task.id, 1); }} disabled={currentPhaseIndex === workflowConfig.length - 1} className="w-5 h-5 flex items-center justify-center rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed text-xs text-white" title="Próxima Fase">&gt;</button></div></>)}{isPast && <IconCheck className="w-4 h-4 text-emerald-500 mt-1" />}</div></td>) })}<td className="p-3 rounded-r-lg text-center"><div className="flex items-center justify-center gap-2"><div className="w-10 h-1 bg-slate-700 rounded-full overflow-hidden"><div className="h-full bg-emerald-500" style={{ width: `${progress}%` }}></div></div><span className="text-xs font-bold text-slate-300">{progress}%</span></div></td></tr>) })}</tbody></table>{filteredTasks.length === 0 && <div className="p-10 text-center text-slate-500">Nenhum projeto encontrado com os filtros atuais.</div>}</div>{isConfigOpen && <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"><WorkflowEditor currentConfig={workflowConfig} onSave={handleAddPhase} onUpdate={handleUpdatePhase} onDelete={handleDeletePhase} onClose={() => setIsConfigOpen(false)} /></div>}</div>); };

const WorkflowEditor = ({ currentConfig, onSave, onUpdate, onDelete, onClose }: any) => {
    const [editingId, setEditingId] = useState<string | null>(null);
    const [name, setName] = useState('');
    const [statuses, setStatuses] = useState('');
    const [activities, setActivities] = useState('');
    useEffect(() => { if (editingId) { const phase = currentConfig.find((p: WorkflowPhase) => p.id === editingId); if (phase) { setName(phase.name); setStatuses(phase.statuses.join(', ')); setActivities(phase.activities.join(', ')); } } else { setName(''); setStatuses('Não Iniciado, Concluído'); setActivities(''); } }, [editingId, currentConfig]);
    const handleSubmit = () => { if (!name) return; const phaseData: WorkflowPhase = { id: editingId || `ph-${Date.now()}`, name, statuses: statuses.split(',').map(s => s.trim()).filter(Boolean), activities: activities.split(',').map(a => a.trim()).filter(Boolean) }; if (editingId) { onUpdate(phaseData); setEditingId(null); } else { onSave(phaseData); setName(''); setStatuses('Não Iniciado, Concluído'); setActivities(''); } };
    const handleDelete = (id: string) => { if (window.confirm('Tem certeza? Isso removerá a visualização desta fase de todos os projetos.')) { onDelete(id); if (editingId === id) setEditingId(null); } }
    return (<div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 max-w-4xl w-full flex flex-col md:flex-row gap-6 max-h-[90vh] overflow-hidden"><div className="flex-1 overflow-y-auto custom-scrollbar border-r border-slate-700 pr-4"><h3 className="text-lg font-bold mb-4 text-white">Etapas Existentes</h3><div className="space-y-2">{currentConfig.map((phase: WorkflowPhase, idx: number) => (<div key={phase.id} className={`p-3 rounded border flex justify-between items-center ${editingId === phase.id ? 'bg-indigo-900/30 border-indigo-500' : 'bg-slate-900/50 border-slate-700'}`}><div><span className="text-xs text-slate-500 font-mono mr-2">{idx + 1}.</span><span className="font-medium text-slate-200">{phase.name}</span><p className="text-[10px] text-slate-500 mt-1">{phase.statuses.length} status, {phase.activities.length} atividades</p></div><div className="flex gap-1"><button onClick={() => setEditingId(phase.id)} className="p-1.5 hover:bg-slate-700 rounded text-indigo-400">✏️</button><button onClick={() => handleDelete(phase.id)} className="p-1.5 hover:bg-slate-700 rounded text-rose-400">🗑️</button></div></div>))}</div><div className="mt-4"><Button variant="secondary" onClick={() => setEditingId(null)} className="w-full text-xs"><IconPlus className="w-3 h-3" /> Adicionar Nova Fase</Button></div></div><div className="flex-1 flex flex-col"><h3 className="text-lg font-bold mb-4 text-white">{editingId ? 'Editar Fase' : 'Nova Fase'}</h3><div className="space-y-4 flex-1"><div><label className="block text-xs text-slate-400 mb-1">Nome da Fase</label><input className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Validação Final" /></div><div><label className="block text-xs text-slate-400 mb-1">Status Possíveis (separados por vírgula)</label><textarea className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" value={statuses} onChange={e => setStatuses(e.target.value)} rows={3} placeholder="Não Iniciado, Em Andamento, Concluído..." /></div><div><label className="block text-xs text-slate-400 mb-1">Atividades (separadas por vírgula)</label><textarea className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" value={activities} onChange={e => setActivities(e.target.value)} rows={3} placeholder="Criar Documento, Validar com Cliente..." /></div></div><div className="flex justify-end gap-2 mt-6"><Button variant="secondary" onClick={onClose}>Fechar</Button><Button onClick={handleSubmit}>{editingId ? 'Atualizar' : 'Adicionar'}</Button></div></div></div>);
};

const DashboardView = ({ tasks, devs }: { tasks: Task[], devs: Developer[] }) => {
  const [widgets, setWidgets] = useState<Widget[]>(() => {
      try {
          const saved = localStorage.getItem('nexus_dashboard_widgets');
          if (saved) {
              const parsed = JSON.parse(saved);
              const hasIncidentAuto = parsed.find((w: Widget) => w.type === 'incidentByAuto');
              const hasCompletedKPIs = parsed.find((w: Widget) => w.type === 'completedKPIs');
              const hasAutoManager = parsed.find((w: Widget) => w.type === 'automationsByManager');
              let merged = [...parsed];
              if (!hasCompletedKPIs) merged.push(DEFAULT_WIDGETS.find(w => w.type === 'completedKPIs'));
              if (!hasIncidentAuto) merged.push(DEFAULT_WIDGETS.find(w => w.type === 'incidentByAuto'));
              if (!hasAutoManager) merged.push(DEFAULT_WIDGETS.find(w => w.type === 'automationsByManager'));
              if (!parsed.find((w: Widget) => w.type === 'fteByManager')) merged.push(DEFAULT_WIDGETS.find(w => w.type === 'fteByManager'));
              return merged;
          }
          return DEFAULT_WIDGETS;
      } catch (e) {
          return DEFAULT_WIDGETS;
      }
  });
  const [isEditMode, setIsEditMode] = useState(false);
  const [filterDev, setFilterDev] = useState<string[]>([]);
  const [filterType, setFilterType] = useState<string[]>([]);
  useEffect(() => { localStorage.setItem('nexus_dashboard_widgets', JSON.stringify(widgets)); }, [widgets]);
  const activeFilteredTasks = useMemo(() => { return tasks.filter(t => { if (['Concluído', 'Resolvido', 'Fechado'].includes(t.status)) return false; const matchesDev = filterDev.length === 0 || filterDev.includes(t.assignee || ''); const matchesType = filterType.length === 0 || filterType.includes(t.type); return matchesDev && matchesType; }); }, [tasks, filterDev, filterType]);
  const completedMetrics = useMemo(() => { const completed = tasks.filter(t => ['Concluído', 'Resolvido', 'Fechado'].includes(t.status)); const filteredCompleted = completed.filter(t => { const matchesDev = filterDev.length === 0 || filterDev.includes(t.assignee || ''); const matchesType = filterType.length === 0 || filterType.includes(t.type); return matchesDev && matchesType; }); return { incidents: filteredCompleted.filter(t => t.type === 'Incidente').length, features: filteredCompleted.filter(t => t.type === 'Melhoria').length, automations: filteredCompleted.filter(t => t.type === 'Nova Automação').length, total: filteredCompleted.length }; }, [tasks, filterDev, filterType]);
  const metrics = useMemo(() => { return { incidents: activeFilteredTasks.filter(t => t.type === 'Incidente').length, features: activeFilteredTasks.filter(t => t.type === 'Melhoria').length, automations: activeFilteredTasks.filter(t => t.type === 'Nova Automação').length, total: activeFilteredTasks.length }; }, [activeFilteredTasks]);
  const priorityData = useMemo(() => { const counts: Record<string, number> = { '1 - Crítica': 0, '2 - Alta': 0, '3 - Moderada': 0, '4 - Baixa': 0 }; activeFilteredTasks.forEach(t => { counts[t.priority] = (counts[t.priority] || 0) + 1; }); return Object.entries(counts).map(([name, value]) => ({ name, value })); }, [activeFilteredTasks]);
  const statusByTypeData = useMemo(() => { const STATUS_ORDER = ['Novo', 'Pendente', 'Em Atendimento', 'Em Progresso', 'Aguardando', 'Backlog']; return STATUS_ORDER.map(status => { const tasksInStatus = activeFilteredTasks.filter(t => t.status === status); return { name: status, Incidente: tasksInStatus.filter(t => t.type === 'Incidente').length, Melhoria: tasksInStatus.filter(t => t.type === 'Melhoria').length, 'Nova Automação': tasksInStatus.filter(t => t.type === 'Nova Automação').length, total: tasksInStatus.length }; }).filter(d => d.total > 0); }, [activeFilteredTasks]);
  const devTypeData = useMemo(() => { return devs.map(dev => { const devTasks = activeFilteredTasks.filter(t => t.assignee === dev.name); return { name: dev.name, Incidente: devTasks.filter(t => t.type === 'Incidente').length, Melhoria: devTasks.filter(t => t.type === 'Melhoria').length, 'Nova Automação': devTasks.filter(t => t.type === 'Nova Automação').length, total: devTasks.length }; }).filter(d => d.total > 0).sort((a, b) => b.total - a.total); }, [activeFilteredTasks, devs]);
  const capacityData = useMemo(() => { return devs.map(dev => { const myTasks = activeFilteredTasks.filter(t => t.assignee === dev.name); const totalHours = myTasks.reduce((acc, t) => acc + parseDuration(t.estimatedTime), 0); return { name: dev.name, activeTasksCount: myTasks.length, totalHours: totalHours }; }).sort((a, b) => a.totalHours - b.totalHours); }, [activeFilteredTasks, devs]);
  const incidentByAutoData = useMemo(() => { const relevantTasks = tasks.filter(t => { const matchesDev = filterDev.length === 0 || filterDev.includes(t.assignee || ''); const isTargetType = t.type === 'Incidente' || t.type === 'Melhoria'; return matchesDev && isTargetType; }); const grouped: Record<string, { name: string, Incidente: number, Melhoria: number, 'Nova Automação': number, total: number }> = {}; relevantTasks.forEach(t => { const name = t.automationName || t.subcategory || t.category || 'Não Classificado'; if (!grouped[name]) { grouped[name] = { name, Incidente: 0, Melhoria: 0, 'Nova Automação': 0, total: 0 }; } if (t.type === 'Incidente') grouped[name].Incidente++; else if (t.type === 'Melhoria') grouped[name].Melhoria++; grouped[name].total++; }); return Object.values(grouped).sort((a, b) => b.Incidente - a.Incidente || b.total - a.total).slice(0, 15); }, [tasks, filterDev]);
  const automationsByManagerData = useMemo(() => { const relevant = activeFilteredTasks.filter(t => t.type === 'Nova Automação'); const grouped: Record<string, number> = {}; relevant.forEach(t => { const area = t.managementArea || 'Sem Gerência'; grouped[area] = (grouped[area] || 0) + 1; }); return Object.entries(grouped).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value); }, [activeFilteredTasks]);
  const fteByManagerData = useMemo(() => { const grouped: Record<string, number> = {}; let total = 0; activeFilteredTasks.forEach(t => { const area = t.managementArea || 'Sem Gerência'; const fte = Number(t.fteValue) || 0; grouped[area] = (grouped[area] || 0) + fte; total += fte; }); const chartData = Object.entries(grouped).map(([name, value]) => ({ name, value })).sort((a,b) => b.value - a.value); return { chartData, total }; }, [activeFilteredTasks]);
  const toggleSize = (id: string) => { setWidgets(prev => prev.map(w => w.id === id ? { ...w, size: w.size === 'full' ? 'half' : 'full' } : w)); };
  const moveWidget = (index: number, direction: 'up' | 'down') => { const newWidgets = [...widgets]; if (direction === 'up' && index > 0) { [newWidgets[index], newWidgets[index - 1]] = [newWidgets[index - 1], newWidgets[index]]; } else if (direction === 'down' && index < newWidgets.length - 1) { [newWidgets[index], newWidgets[index + 1]] = [newWidgets[index + 1], newWidgets[index]]; } setWidgets(newWidgets); };
  const toggleVisibility = (id: string) => { setWidgets(prev => prev.map(w => w.id === id ? { ...w, visible: !w.visible } : w)); };
  const changeVisualStyle = (id: string, style: any) => { setWidgets(prev => prev.map(w => w.id === id ? { ...w, visualStyle: style } : w)); };
  const exportPPT = () => { const pres = new pptxgen(); pres.layout = 'LAYOUT_WIDE'; let slide = pres.addSlide(); slide.background = { color: "0f172a" }; slide.addText("Dashboard Nexus Project", { x: 0.5, y: 2, w: '90%', fontSize: 36, color: 'FFFFFF', bold: true, align: 'center' }); slide.addText(`Gerado em: ${new Date().toLocaleDateString()}`, { x: 0.5, y: 3, w: '90%', fontSize: 18, color: '94a3b8', align: 'center' }); slide = pres.addSlide(); slide.background = { color: "0f172a" }; slide.addText("Visão Geral do Portfólio (Demandas Ativas)", { x: 0.5, y: 0.5, fontSize: 18, color: 'FFFFFF', bold: true }); const drawCard = (label: string, value: string, color: string, x: number) => { slide.addShape(pres.ShapeType.roundRect, { x, y: 1.5, w: 2.5, h: 1.5, fill: { color: '1e293b' }, line: { color, width: 3 } }); slide.addText(label, { x, y: 1.8, w: 2.5, fontSize: 14, color: '94a3b8', align: 'center' }); slide.addText(value, { x, y: 2.3, w: 2.5, fontSize: 32, color: 'FFFFFF', bold: true, align: 'center' }); }; drawCard("Total Ativos", metrics.total.toString(), 'ffffff', 0.5); drawCard("Incidentes", metrics.incidents.toString(), 'f43f5e', 3.5); drawCard("Melhorias", metrics.features.toString(), '10b981', 6.5); drawCard("Automações", metrics.automations.toString(), '6366f1', 9.5); slide = pres.addSlide(); slide.background = { color: "0f172a" }; slide.addText("Volume por Status e Prioridade", { x: 0.5, y: 0.5, fontSize: 18, color: 'FFFFFF', bold: true }); if (priorityData.length > 0) { slide.addChart(pres.ChartType.bar, [ { name: 'Prioridade', labels: priorityData.map(d => d.name), values: priorityData.map(d => d.value) } ], { x: 0.5, y: 1.5, w: 5, h: 4, chartColors: ['8b5cf6'], title: 'Por Prioridade', titleColor: 'ffffff' }); } if (statusByTypeData.length > 0) { const statusLabels = statusByTypeData.map(d => d.name); const incVals = statusByTypeData.map(d => d.Incidente); const melVals = statusByTypeData.map(d => d.Melhoria); const autoVals = statusByTypeData.map(d => d['Nova Automação']); slide.addChart(pres.ChartType.bar, [ { name: 'Incidentes', labels: statusLabels, values: incVals }, { name: 'Melhorias', labels: statusLabels, values: melVals }, { name: 'Automações', labels: statusLabels, values: autoVals } ], { x: 6, y: 1.5, w: 7, h: 4, showLegend: true, barDir: 'col', title: 'Por Status', titleColor: 'ffffff', chartColors: ['f43f5e', '10b981', '6366f1'] }); } slide = pres.addSlide(); slide.background = { color: "0f172a" }; slide.addText("Capacidade da Equipe & Sugestões", { x: 0.5, y: 0.5, fontSize: 18, color: 'FFFFFF', bold: true }); const tableHeader = ['Desenvolvedor', 'Tarefas', 'Horas Estimadas', 'Dias Estimados', 'Status'].map(t => ({ text: t, options: { bold: true, fill: '334155', color: 'ffffff' } })); const tableRows = capacityData.map(d => { const estimatedDays = Math.ceil(d.totalHours / 8); let statusText = 'Livre'; if (d.totalHours > 40) statusText = 'Sobrecarga'; else if (d.totalHours > 24) statusText = 'Ocupado'; else if (d.totalHours > 8) statusText = 'Moderado'; return [d.name, d.activeTasksCount, formatDuration(d.totalHours), `${estimatedDays}d`, statusText]; }); slide.addTable([tableHeader, ...tableRows] as any, { x: 0.5, y: 1.5, w: 12, color: 'cbd5e1', border: { type: 'solid', color: '475569', pt: 0.5 } }); pres.writeFile({ fileName: "Nexus_Dashboard.pptx" }); };

  const renderWidget = (widget: Widget) => {
      const style = widget.visualStyle || 'bar';
      const renderChartContent = () => {
          if (widget.type === 'priority') {
             if (style === 'pie') return <PieChart><Pie data={priorityData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>{priorityData.map((entry, index) => <Cell key={`cell-${index}`} fill={['#8b5cf6', '#a855f7', '#d8b4fe', '#ddd6fe'][index % 4]} />)}</Pie><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /></PieChart>;
             return <BarChart data={priorityData}><CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} /><XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} /><YAxis stroke="#94a3b8" /><Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#fff' }} cursor={{fill: '#334155', opacity: 0.4}} /><Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={40} /></BarChart>;
          }
          if (widget.type === 'incidentByAuto') {
              if (style === 'pie') return <PieChart><Pie data={incidentByAutoData} dataKey="total" nameKey="name" cx="50%" cy="50%" outerRadius={80} fill="#f43f5e" label>{incidentByAutoData.map((entry, index) => <Cell key={index} fill={['#f43f5e', '#10b981', '#6366f1'][index % 3]} />)}</Pie><Tooltip contentStyle={{ backgroundColor: '#1e293b' }} /></PieChart>;
              return <BarChart data={incidentByAutoData} layout="vertical" margin={{ left: 10, right: 30, top: 10 }}><CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#334155" /><XAxis type="number" stroke="#94a3b8" hide /><YAxis type="category" dataKey="name" width={180} stroke="#94a3b8" tick={{fontSize: 11, fill: '#cbd5e1'}} interval={0} tickLine={false} axisLine={false} /><Tooltip content={<CustomTooltip />} cursor={{fill: '#334155', opacity: 0.2}} /><Legend wrapperStyle={{fontSize: '12px', paddingTop: '10px'}} /><Bar dataKey="Incidente" name="Incidentes" stackId="a" fill="#f43f5e"><LabelList dataKey="Incidente" position="center" fill="#fff" fontSize={10} formatter={(val:number) => val > 0 ? val : ''} /></Bar><Bar dataKey="Melhoria" name="Melhorias" stackId="a" fill="#10b981"><LabelList dataKey="Melhoria" position="center" fill="#fff" fontSize={10} formatter={(val:number) => val > 0 ? val : ''} /></Bar><Bar dataKey="Nova Automação" name="Novas Auto." stackId="a" fill="#6366f1" radius={[0, 4, 4, 0]}><LabelList dataKey="Nova Automação" position="center" fill="#fff" fontSize={10} formatter={(val:number) => val > 0 ? val : ''} /></Bar></BarChart>;
          }
          if (widget.type === 'status') {
             return <BarChart data={statusByTypeData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }} barSize={40}><CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} /><XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} /><YAxis stroke="#94a3b8" /><Tooltip content={<CustomTooltip />} cursor={{fill: '#334155', opacity: 0.2}} /><Legend wrapperStyle={{paddingTop: '10px'}} /><Bar dataKey="Incidente" stackId="a" fill="#f43f5e"><LabelList dataKey="Incidente" content={renderCustomBarLabel} /></Bar><Bar dataKey="Melhoria" stackId="a" fill="#10b981"><LabelList dataKey="Melhoria" content={renderCustomBarLabel} /></Bar><Bar dataKey="Nova Automação" stackId="a" fill="#6366f1" radius={[4, 4, 0, 0]}><LabelList dataKey="Nova Automação" content={renderCustomBarLabel} /></Bar></BarChart>;
          }
          if (widget.type === 'devType') {
              return <ComposedChart data={devTypeData} layout="vertical" margin={{ top: 5, right: 60, left: 10, bottom: 5 }} barSize={32}><CartesianGrid strokeDasharray="3 3" stroke="#334155" horizontal={false} vertical={true} opacity={0.2} /><XAxis type="number" stroke="#64748b" tick={{fontSize: 10}} hide /><YAxis dataKey="name" type="category" stroke="#94a3b8" tick={{fontSize: 12, fill: '#cbd5e1', fontWeight: 500}} width={150} interval={0} tickLine={false} axisLine={false} /><Tooltip content={<CustomTooltip />} cursor={{fill: '#334155', opacity: 0.2}} /><Legend wrapperStyle={{paddingTop: '10px'}} /><Bar dataKey="Incidente" stackId="a" fill="#f43f5e" radius={[4, 0, 0, 4]}><LabelList dataKey="Incidente" content={renderCustomBarLabel} /></Bar><Bar dataKey="Melhoria" stackId="a" fill="#10b981"><LabelList dataKey="Melhoria" content={renderCustomBarLabel} /></Bar><Bar dataKey="Nova Automação" stackId="a" fill="#6366f1" radius={[0, 4, 4, 0]}><LabelList dataKey="Nova Automação" content={renderCustomBarLabel} /></Bar><Line dataKey="total" stroke="none" isAnimationActive={false}><LabelList dataKey="total" position="right" style={{ fill: "#94a3b8", fontSize: "12px", fontWeight: "bold" }} formatter={(val: any) => `Total: ${val}`} /></Line></ComposedChart>;
          }
          if (widget.type === 'automationsByManager') {
             return <BarChart data={automationsByManagerData}><CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} /><XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} /><YAxis stroke="#94a3b8" allowDecimals={false} /><Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#fff' }} cursor={{fill: '#334155', opacity: 0.4}} /><Bar dataKey="value" name="Automações" fill="#6366f1" radius={[4, 4, 0, 0]} barSize={40}><LabelList dataKey="value" position="top" fill="#fff" /></Bar></BarChart>;
          }
          if (widget.type === 'fteByManager') {
             return (
                 <div className="h-full flex flex-col relative">
                     <div className="absolute top-0 right-0 bg-slate-700/50 px-2 py-1 rounded text-xs text-white z-10">Total: {fteByManagerData.total.toFixed(2)}</div>
                     <ResponsiveContainer width="100%" height="100%"><BarChart data={fteByManagerData.chartData}><CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} /><XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 10}} /><YAxis stroke="#94a3b8" /><Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#fff' }} cursor={{fill: '#334155', opacity: 0.4}} /><Bar dataKey="value" name="Valor FTE" fill="#10b981" radius={[4, 4, 0, 0]} barSize={40}><LabelList dataKey="value" position="top" fill="#fff" formatter={(val:number) => val.toFixed(2)} /></Bar></BarChart></ResponsiveContainer>
                 </div>
             );
          }
          return null;
      };
      return (
          <div className="h-full flex flex-col">
             <div className="flex justify-between items-center mb-4"><h3 className="text-lg font-semibold text-slate-200">{widget.title}</h3><div className="flex items-center gap-2">{isEditMode && ['priority', 'status', 'incidentByAuto', 'automationsByManager', 'fteByManager'].includes(widget.type) && (<select className="bg-slate-900 border border-slate-600 text-xs text-white rounded px-2 py-1 outline-none" value={widget.visualStyle || 'bar'} onChange={(e) => changeVisualStyle(widget.id, e.target.value)}><option value="bar">Barras</option><option value="pie">Pizza</option></select>)}{isEditMode && (<div className="flex items-center gap-1 bg-slate-900 rounded p-1"><button onClick={() => toggleSize(widget.id)} className="p-1 hover:text-indigo-400 text-slate-400">↔</button><button onClick={() => toggleVisibility(widget.id)} className="p-1 hover:text-rose-400 text-slate-400">✕</button></div>)}</div></div>
             <div className="flex-1 min-h-[250px]">
                 {widget.type === 'cards' && (<div className="grid grid-cols-2 md:grid-cols-4 gap-4 h-full"><div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-slate-500 flex flex-col justify-between"><span className="text-slate-400 text-xs uppercase font-bold">Total (Ativos)</span><span className="text-3xl font-bold text-white">{metrics.total}</span></div><div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-rose-500 flex flex-col justify-between"><span className="text-rose-400 text-xs uppercase font-bold">Incidentes</span><span className="text-3xl font-bold text-white">{metrics.incidents}</span></div><div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-emerald-500 flex flex-col justify-between"><span className="text-emerald-400 text-xs uppercase font-bold">Melhorias</span><span className="text-3xl font-bold text-white">{metrics.features}</span></div><div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-indigo-500 flex flex-col justify-between"><span className="text-indigo-400 text-xs uppercase font-bold">Automações</span><span className="text-3xl font-bold text-white">{metrics.automations}</span></div></div>)}
                 {widget.type === 'completedKPIs' && (<div className="grid grid-cols-2 md:grid-cols-4 gap-4 h-full"><div className="bg-indigo-900/10 p-4 rounded-lg border-t-2 border-indigo-500 flex flex-col justify-between"><span className="text-indigo-300 text-xs uppercase font-bold">Total Concluído</span><span className="text-3xl font-bold text-white">{completedMetrics.total}</span></div><div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-rose-800 flex flex-col justify-between opacity-80"><span className="text-rose-300 text-xs uppercase font-bold">Incid. Fechados</span><span className="text-3xl font-bold text-slate-300">{completedMetrics.incidents}</span></div><div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-emerald-800 flex flex-col justify-between opacity-80"><span className="text-emerald-300 text-xs uppercase font-bold">Melhorias Entregues</span><span className="text-3xl font-bold text-slate-300">{completedMetrics.features}</span></div><div className="bg-slate-900/50 p-4 rounded-lg border-t-2 border-indigo-800 flex flex-col justify-between opacity-80"><span className="text-indigo-300 text-xs uppercase font-bold">Automações Entregues</span><span className="text-3xl font-bold text-slate-300">{completedMetrics.automations}</span></div></div>)}
                 {widget.type === 'capacity' && (<div className="h-full flex flex-col">{capacityData.length > 0 && (<div className="bg-emerald-900/20 border border-emerald-700/50 px-4 py-4 rounded-lg mb-4 flex items-center gap-4"><div className="w-12 h-12 rounded-full bg-emerald-500/20 border border-emerald-500 flex items-center justify-center text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)]"><IconClock className="w-6 h-6" /></div><div><p className="text-[11px] text-emerald-400 font-bold uppercase tracking-widest mb-1">Sugestão (Disponível 1º)</p><p className="text-xl text-white font-bold leading-none">{capacityData[0].name}</p><p className="text-xs text-slate-400 mt-1">Livre em aprox. <span className="text-white font-mono">{formatDuration(capacityData[0].totalHours)}</span></p></div></div>)}<div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-2"><table className="w-full text-sm"><thead className="text-xs text-slate-400 uppercase bg-slate-900/50"><tr><th className="text-left p-2 rounded-l">Dev</th><th className="text-center p-2">Qtd</th><th className="text-center p-2">Backlog</th><th className="text-center p-2">Dias Est.</th><th className="text-center p-2 rounded-r">Saúde</th></tr></thead><tbody className="divide-y divide-slate-700/50">{capacityData.map((dev, idx) => { const estimatedDays = Math.ceil(dev.totalHours / 8); let statusColor = 'bg-emerald-500 text-white'; let statusText = 'Livre'; let barColor = 'bg-emerald-500'; if (dev.totalHours > 40) { statusColor = 'bg-rose-500 text-white'; statusText = 'Sobrecarga'; barColor = 'bg-rose-500'; } else if (dev.totalHours > 24) { statusColor = 'bg-orange-500 text-white'; statusText = 'Ocupado'; barColor = 'bg-orange-500'; } else if (dev.totalHours > 8) { statusColor = 'bg-yellow-500 text-black'; statusText = 'Moderado'; barColor = 'bg-yellow-500'; } return (<tr key={dev.name} className="group hover:bg-slate-700/30"><td className="p-2"><div className="font-medium text-slate-200">{dev.name}</div><div className="w-full h-1.5 bg-slate-800 rounded-full mt-1 overflow-hidden"><div className={`h-full ${barColor}`} style={{ width: `${Math.min((dev.totalHours / 60) * 100, 100)}%` }}></div></div></td><td className="p-2 text-center text-slate-300 font-bold">{dev.activeTasksCount}</td><td className="p-2 text-center font-mono text-slate-300">{formatDuration(dev.totalHours)}</td><td className="p-2 text-center text-slate-400">{estimatedDays}d</td><td className="p-2 text-center"><span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${statusColor}`}>{statusText}</span></td></tr>) })}</tbody></table></div></div>)}
                 {['priority', 'status', 'devType', 'incidentByAuto', 'automationsByManager'].includes(widget.type) && (<ResponsiveContainer width="100%" height="100%">{renderChartContent() as any}</ResponsiveContainer>)}
                 {widget.type === 'fteByManager' && renderChartContent()}
             </div>
          </div>
      )
  }
  return (<div className="space-y-6 animate-fade-in pb-20"><div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4"><div><h2 className="text-2xl font-bold text-white">One Page Report</h2><p className="text-slate-400 text-sm">Visão executiva e operacional do projeto</p></div><div className="flex flex-wrap gap-4 w-full md:w-auto items-center"><div className="flex gap-2 w-full md:w-auto"><MultiSelect options={TASK_TYPES} selected={filterType} onChange={setFilterType} placeholder="Tipos: Todos" /><MultiSelect options={devs.map(d => d.name)} selected={filterDev} onChange={setFilterDev} placeholder="Devs: Todos" /></div><Button onClick={() => setIsEditMode(!isEditMode)} variant={isEditMode ? "success" : "secondary"}>{isEditMode ? 'Salvar Layout' : 'Editar Layout'}</Button><Button onClick={exportPPT} variant="primary"><IconDownload /> Exportar PPT</Button></div></div>{isEditMode && widgets.some(w => !w.visible) && (<div className="bg-slate-800 p-4 rounded-xl border border-slate-600 flex gap-4 items-center overflow-x-auto animate-slide-in"><span className="text-sm text-slate-400 font-medium whitespace-nowrap">Widgets Disponíveis:</span>{widgets.filter(w => !w.visible).map(w => (<button key={w.id} onClick={() => toggleVisibility(w.id)} className="bg-slate-700 hover:bg-indigo-600 px-3 py-1 rounded text-xs text-white transition-colors border border-slate-600 flex items-center gap-2"><IconPlus className="w-3 h-3" /> {w.title}</button>))}</div>)}<div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6">{widgets.filter(w => w.visible).map((widget, index) => (<div key={widget.id} className={`${widget.size === 'full' ? 'md:col-span-2 xl:col-span-4' : 'md:col-span-1 xl:col-span-2'} relative group transition-all duration-300`}><Card className="h-full min-h-[340px] flex flex-col">{renderWidget(widget)}</Card>{isEditMode && (<div className="absolute top-2 right-2 flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-slate-900/90 p-1.5 rounded border border-slate-700 shadow-xl z-20">{index > 0 && (<button onClick={() => moveWidget(index, 'up')} className="p-1.5 bg-slate-800 hover:bg-indigo-600 rounded text-white transition-colors" title="Mover para Cima/Esquerda"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg></button>)}{index < widgets.filter(w => w.visible).length - 1 && (<button onClick={() => moveWidget(index, 'down')} className="p-1.5 bg-slate-800 hover:bg-indigo-600 rounded text-white transition-colors" title="Mover para Baixo/Direita"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg></button>)}</div>)}</div>))}</div></div>);
};

const UserProfile = ({ user, setUser, onResetData }: { user: User, setUser: (u: User) => void, onResetData: () => void }) => {
    const [name, setName] = useState(user.name); const [avatar, setAvatar] = useState(user.avatar || ''); const [password, setPassword] = useState(user.password || '');
    const handleSave = () => { const updated = { ...user, name, avatar, password }; setUser(updated); StorageService.updateUser(updated); alert('Perfil atualizado com sucesso!'); }
    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => { const file = e.target.files?.[0]; if (file) { const reader = new FileReader(); reader.onload = (ev) => { if(ev.target?.result) setAvatar(ev.target.result as string); }; reader.readAsDataURL(file); } }
    return (<div className="max-w-3xl mx-auto space-y-6"><h2 className="text-2xl font-bold text-white">Meu Perfil</h2><Card className="space-y-6"><div className="flex flex-col md:flex-row gap-6 items-center md:items-start"><div className="relative group"><div className="w-24 h-24 rounded-full bg-slate-700 border-2 border-indigo-500 overflow-hidden flex items-center justify-center">{avatar ? <img src={avatar} alt="Avatar" className="w-full h-full object-cover" /> : <span className="text-2xl font-bold text-indigo-300">{user.name.substring(0,2).toUpperCase()}</span>}</div><label className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity rounded-full cursor-pointer"><IconUpload className="w-6 h-6 text-white" /><input type="file" className="hidden" accept="image/*" onChange={handleFile} /></label></div><div className="flex-1 space-y-4 w-full"><div><label className="block text-xs text-slate-400 mb-1">Nome Completo</label><input value={name} onChange={e => setName(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" /></div><div><label className="block text-xs text-slate-400 mb-1">Email</label><input value={user.email} disabled className="w-full bg-slate-900/50 border border-slate-700 rounded p-2 text-slate-500 cursor-not-allowed" /></div><div><label className="block text-xs text-slate-400 mb-1">Senha</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-white outline-none focus:border-indigo-500" placeholder="Nova senha..." /></div></div></div><div className="flex justify-end pt-4 border-t border-slate-700"><Button onClick={handleSave}>Salvar Alterações</Button></div></Card><div className="border-t border-slate-800 pt-8"><h3 className="text-lg font-bold text-rose-500 mb-2">Zona de Perigo</h3><div className="bg-rose-900/10 border border-rose-900/30 p-4 rounded-lg flex items-center justify-between"><div><p className="text-slate-300 font-medium">Resetar Dados</p><p className="text-xs text-slate-500">Apaga todas as tarefas e restaura configurações padrão. Irreversível.</p></div><Button variant="danger" onClick={() => { if(window.confirm("Tem certeza absoluta?")) onResetData(); }}>Resetar Tudo</Button></div></div></div>)
}

const Layout = ({ children, user, onLogout, headerContent }: any) => {
  const navigate = useNavigate(); const location = useLocation(); const [isCollapsed, setIsCollapsed] = useState(false);
  if (location.pathname === '/powerbi-data') return <>{children}</>;
  const menuItems = [ 
    { path: '/', icon: <IconHome className="w-5 h-5" />, label: 'Dashboard' }, 
    { path: '/projects', icon: <IconProject className="w-5 h-5" />, label: 'Projetos' }, 
    { path: '/esteira', icon: <IconDocument className="w-5 h-5" />, label: 'Esteira Documental' }, 
    { path: '/sprints', icon: <IconSprint className="w-5 h-5" />, label: 'Sprints (CoE)' },
    { path: '/project-report', icon: <IconChartBar className="w-5 h-5" />, label: 'Report Projetos' }, 
    { path: '/kanban', icon: <IconKanban className="w-5 h-5" />, label: 'Kanban' }, 
    { path: '/list', icon: <IconList className="w-5 h-5" />, label: 'Lista' }, 
    { path: '/gantt', icon: <IconClock className="w-5 h-5" />, label: 'Gantt' }, 
    { path: '/robots', icon: <IconRobot className="w-5 h-5" />, label: 'Robôs (RPA)' }, 
    { path: '/reports', icon: <IconDocument className="w-5 h-5" />, label: 'Relatórios' } 
  ];
  return (<div className="flex h-screen bg-dark-900 text-slate-200 font-sans"><aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-slate-800/50 backdrop-blur-lg border-r border-slate-700 flex flex-col z-50 transition-all duration-300 ease-in-out relative`}><button onClick={() => setIsCollapsed(!isCollapsed)} className="absolute -right-3 top-9 bg-indigo-600 text-white p-1 rounded-full shadow-lg hover:bg-indigo-700 transition-colors z-50"><IconChevronLeft className={`w-3 h-3 transform transition-transform duration-300 ${isCollapsed ? 'rotate-180' : ''}`} /></button><div className={`p-6 border-b border-slate-700 flex items-center gap-3 h-20 ${isCollapsed ? 'justify-center px-0' : ''}`}><div className="w-8 h-8 flex-shrink-0 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-lg shadow-lg shadow-indigo-500/50"></div><h1 className={`text-xl font-bold tracking-tight text-white overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>Nexus</h1></div><nav className="flex-1 p-4 space-y-2 mt-4">{menuItems.map(item => (<button key={item.path} onClick={() => navigate(item.path)} title={isCollapsed ? item.label : ''} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group ${location.pathname === item.path ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'} ${isCollapsed ? 'justify-center px-0' : ''}`}>{item.icon}<span className={`font-medium transition-all duration-300 overflow-hidden ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>{item.label}</span></button>))}</nav><div className="p-4 border-t border-slate-700 bg-slate-900/30"><div onClick={() => navigate('/profile')} className={`flex items-center gap-3 mb-4 cursor-pointer hover:bg-slate-800 p-2 rounded-lg transition-colors ${isCollapsed ? 'justify-center' : ''}`}><div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-indigo-300 border border-slate-600 overflow-hidden flex-shrink-0">{user.avatar ? (<img src={user.avatar} alt="avatar" className="w-full h-full object-cover" />) : (user.name.substring(0, 2).toUpperCase())}</div><div className={`overflow-hidden transition-all duration-300 ${isCollapsed ? 'w-0 opacity-0 hidden' : 'w-auto opacity-100'}`}>{!isCollapsed && <><p className="text-sm font-medium text-white truncate">{user.name}</p><p className="text-xs text-slate-500 truncate">{user.email}</p></>}</div></div><Button variant="danger" onClick={onLogout} className={`w-full justify-center text-xs py-2 ${isCollapsed ? 'px-0' : ''}`} title={isCollapsed ? 'Sair' : ''}>{isCollapsed ? (<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15M12 9l-3 3m0 0l3 3m-3-3h12.75" /></svg>) : 'Sair'}</Button></div></aside><main className="flex-1 overflow-hidden relative flex flex-col"><header className="h-16 bg-dark-900/90 backdrop-blur-sm flex items-center justify-end px-6 lg:px-10 z-30 sticky top-0 border-b border-slate-800"><div className="pointer-events-auto">{headerContent}</div></header><div className="absolute inset-0 bg-gradient-to-br from-indigo-900/10 via-dark-900 to-emerald-900/10 pointer-events-none" /><div className="flex-1 overflow-auto p-6 lg:p-10 z-10 relative">{children}</div></main></div>);
};

const AuthPage = ({ onLogin }: { onLogin: (user: User) => void }) => {
    const [isRegister, setIsRegister] = useState(false); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [name, setName] = useState(''); const [error, setError] = useState('');
    const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); setError(''); if (isRegister) { if (!email || !password || !name) { setError('Todos os campos são obrigatórios'); return; } const newUser: User = { id: Date.now().toString(), email, name, password }; const success = StorageService.registerUser(newUser); if (success) { alert('Conta criada com sucesso! Faça login.'); setIsRegister(false); } else setError('Email já cadastrado.'); } else { if (!email || !password) { setError('Preencha email e senha'); return; } const user = StorageService.authenticateUser(email, password); if (user) onLogin(user); else setError('Credenciais inválidas.'); } };
    return (<div className="h-screen flex items-center justify-center bg-dark-900 relative overflow-hidden"><div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20"></div><div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px]"></div><div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-emerald-600/10 rounded-full blur-[120px]"></div><div className="w-full max-w-md p-10 bg-slate-800/60 backdrop-blur-xl border border-slate-700/50 rounded-2xl shadow-2xl z-10 relative"><div className="flex justify-center mb-6"><div className="w-16 h-16 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-2xl shadow-2xl shadow-indigo-500/40 flex items-center justify-center"><span className="text-3xl text-white font-bold">N</span></div></div><h2 className="text-3xl font-bold text-center mb-2 text-white">Nexus Project</h2><p className="text-center text-slate-400 mb-8 text-sm">{isRegister ? 'Crie sua conta para começar' : 'Acesse sua conta'}</p><form onSubmit={handleSubmit} className="space-y-5">{isRegister && (<div><label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Nome Completo</label><input type="text" value={name} onChange={(e) => setName(e.target.value)} className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all" placeholder="Seu nome" /></div>)}<div><label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Email Corporativo</label><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all" placeholder="nome@empresa.com" /></div><div><label className="block text-xs font-medium text-slate-400 uppercase tracking-wider mb-2">Senha</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="w-full bg-slate-900/80 border border-slate-600 rounded-xl px-4 py-3 text-slate-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition-all" placeholder="••••••••" /></div>{error && <p className="text-rose-500 text-sm text-center">{error}</p>}<Button type="submit" className="w-full justify-center py-3 text-lg shadow-lg shadow-indigo-500/40 hover:shadow-indigo-500/60">{isRegister ? 'Cadastrar' : 'Entrar'}</Button><div className="text-center"><button type="button" onClick={() => { setIsRegister(!isRegister); setError(''); }} className="text-sm text-slate-500 hover:text-indigo-400 transition-colors">{isRegister ? 'Já tem conta? Entrar' : 'Criar nova conta'}</button></div></form></div></div>);
};

const TaskModal = ({ task, developers, allTasks, onClose, onSave, onDelete, workflowConfig }: any) => {
    const [formData, setFormData] = useState<Task>(task || { id: '', type: 'Incidente', summary: '', description: '', requester: '', priority: '3 - Moderada', status: 'Novo', assignee: null, estimatedTime: '', actualTime: '', startDate: '', endDate: '', projectPath: '', automationName: '', managementArea: '', fteValue: undefined, blocker: '', projectData: { currentPhaseId: '1', phaseStatus: 'Não Iniciado', completedActivities: [] } });
    useEffect(() => { if (!formData.projectData) setFormData(prev => ({ ...prev, projectData: { currentPhaseId: '1', phaseStatus: 'Não Iniciado', completedActivities: [] } })); }, []);
    useEffect(() => { if (formData.startDate && formData.estimatedTime) { const hours = parseDuration(formData.estimatedTime); if (hours > 0) { const daysToAdd = Math.floor((hours - 0.1) / 8); const start = new Date(formData.startDate); const end = new Date(start); end.setDate(start.getDate() + daysToAdd); const endDateStr = end.toISOString().split('T')[0]; if (endDateStr !== formData.endDate) setFormData(prev => ({ ...prev, endDate: endDateStr })); } } }, [formData.startDate, formData.estimatedTime]);
    const handleChange = (e: any) => { const { name, value } = e.target; if (name === 'assignee' && value && allTasks) { const currentHours = getDevWorkload(value, allTasks, task.id); if (currentHours > 40) alert(`NOTA: ${value} já possui ${formatDuration(currentHours)} em tarefas pendentes (Acima de 40h).`); } let finalValue = value; if (name === 'fteValue') finalValue = value === '' ? undefined : parseFloat(value); setFormData(prev => ({ ...prev, [name]: finalValue })); };
    const handleProjectDataChange = (key: string, value: any) => { setFormData(prev => ({ ...prev, projectData: { ...prev.projectData!, [key]: value } })); };
    const toggleActivity = (activity: string) => { const currentActivities = formData.projectData?.completedActivities || []; if (currentActivities.includes(activity)) handleProjectDataChange('completedActivities', currentActivities.filter(a => a !== activity)); else handleProjectDataChange('completedActivities', [...currentActivities, activity]); };
    const isNewTask = !task.createdAt || task.id === ''; const isProject = formData.type === 'Melhoria' || formData.type === 'Nova Automação'; const currentPhase = workflowConfig.find((w: WorkflowPhase) => w.id === formData.projectData?.currentPhaseId) || workflowConfig[0];
    return (<div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4"><div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]"><div className="p-6 border-b border-slate-700 flex justify-between items-center bg-slate-900 rounded-t-2xl"><h3 className="text-xl font-bold text-white">{isNewTask ? 'Nova Demanda' : 'Editar Demanda'}</h3><button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">✕</button></div><div className="p-6 overflow-y-auto space-y-6 custom-scrollbar"><div className="space-y-4"><div className="grid grid-cols-2 gap-4"><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Número do Chamado (ID)</label><input name="id" value={formData.id} onChange={handleChange} placeholder="Ex: INC0012345" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono" /></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Solicitante</label><input name="requester" value={formData.requester || ''} onChange={handleChange} placeholder="Nome do Solicitante" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all" /></div></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Descrição da Solicitação</label><textarea name="summary" value={formData.summary} onChange={handleChange} rows={3} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all resize-none" /></div></div><div className="grid grid-cols-2 gap-4"><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Tipo</label><select name="type" value={formData.type} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500"><option value="Incidente">Incidente</option><option value="Melhoria">Melhoria</option><option value="Nova Automação">Nova Automação</option></select></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Prioridade</label><select name="priority" value={formData.priority} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500"><option value="1 - Crítica">1 - Crítica</option><option value="2 - Alta">2 - Alta</option><option value="3 - Moderada">3 - Moderada</option><option value="4 - Baixa">4 - Baixa</option></select></div></div><div className="grid grid-cols-2 gap-4"><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Desenvolvedor</label><select name="assignee" value={formData.assignee || ''} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500"><option value="">Sem Atribuição</option>{developers.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}</select></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Status</label><select name="status" value={formData.status} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500"><option value="Novo">Novo</option><option value="Backlog">Backlog</option><option value="Pendente">Pendente</option><option value="Em Atendimento">Em Atendimento</option><option value="Em Progresso">Em Progresso</option><option value="Resolvido">Resolvido</option><option value="Fechado">Fechado</option><option value="Aguardando">Aguardando</option><option value="Concluído">Concluído</option></select></div></div>{(formData.status === 'Aguardando' || formData.status === 'Pendente') && (<div className="col-span-2 bg-rose-900/20 border border-rose-500/30 p-4 rounded-lg animate-fade-in"><label className="block text-xs text-rose-300 mb-1 font-bold uppercase tracking-wider">Motivo do Bloqueio / Pendência</label><input name="blocker" value={formData.blocker || ''} onChange={handleChange} placeholder="Descreva o que está impedindo o avanço..." className="w-full bg-slate-900 border border-rose-500/50 rounded-lg p-3 text-white focus:ring-2 focus:ring-rose-500 outline-none transition-all" /></div>)}<div className="grid grid-cols-2 gap-4 bg-slate-900/30 p-2 rounded"><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Gerência / Área</label><input name="managementArea" value={formData.managementArea || ''} onChange={handleChange} placeholder="Ex: Financeiro, RH" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-xs" /></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Valor FTE (Nº)</label><input type="number" step="0.01" name="fteValue" value={formData.fteValue || ''} onChange={handleChange} placeholder="0.00" className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-xs" /></div></div><div className="grid grid-cols-1 md:grid-cols-2 gap-4"><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Nome da Automação / Sistema</label><input name="automationName" value={formData.automationName || ''} onChange={handleChange} placeholder="Ex: Robô Financeiro, SAP..." className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-xs" /></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Caminho da Pasta (Drive/Rede)</label><input name="projectPath" value={formData.projectPath || ''} onChange={handleChange} placeholder="Ex: G:\Projetos\ClienteX..." className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all font-mono text-xs" /></div></div><div className="grid grid-cols-2 gap-4 bg-slate-900/50 p-4 rounded-lg border border-slate-700"><div className="col-span-2 flex items-center gap-2 mb-2"><IconClock className="w-4 h-4 text-indigo-400" /><span className="text-xs text-indigo-300 font-bold">Planejamento Automático</span><span className="text-[10px] text-slate-500">(Data Fim calculada baseada no tempo estimado)</span></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Data Início</label><input type="date" name="startDate" value={formData.startDate || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Data Fim (Prevista)</label><input type="date" name="endDate" value={formData.endDate || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" /></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Tempo Estimado</label><input name="estimatedTime" value={formData.estimatedTime || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300 focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="ex: 8h, 16h, 2d" /></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider text-emerald-400">Tempo Real (Usado)</label><input name="actualTime" value={formData.actualTime || ''} onChange={handleChange} className="w-full bg-slate-800 border-emerald-500/50 border rounded p-2 text-slate-300 focus:ring-2 focus:ring-emerald-500 outline-none" placeholder="ex: 2h" /></div></div>{isProject && (<div className="bg-indigo-900/10 border border-indigo-500/30 p-4 rounded-lg"><h4 className="text-sm font-bold text-indigo-300 mb-4 flex items-center gap-2"><IconProject className="w-4 h-4" /> Ciclo de Vida do Projeto</h4><div className="grid grid-cols-2 gap-4 mb-4"><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Fase Atual</label><select className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500" value={formData.projectData?.currentPhaseId} onChange={(e) => { handleProjectDataChange('currentPhaseId', e.target.value); const newPhase = workflowConfig.find((w:any) => w.id === e.target.value); if (newPhase) handleProjectDataChange('phaseStatus', newPhase.statuses[0]); }}>{workflowConfig.map((p: WorkflowPhase) => (<option key={p.id} value={p.id}>{p.name}</option>))}</select></div><div><label className="block text-xs text-slate-400 mb-1 font-medium uppercase tracking-wider">Status da Fase</label><select className="w-full bg-slate-900 border border-slate-600 rounded p-2 text-slate-300 outline-none focus:ring-2 focus:ring-indigo-500" value={formData.projectData?.phaseStatus} onChange={(e) => handleProjectDataChange('phaseStatus', e.target.value)}>{currentPhase.statuses.map((s: string) => (<option key={s} value={s}>{s}</option>))}</select></div></div>{currentPhase.activities.length > 0 && (<div><label className="block text-xs text-slate-400 mb-2 font-medium uppercase tracking-wider">Atividades da Fase</label><div className="grid grid-cols-1 md:grid-cols-2 gap-2">{currentPhase.activities.map((activity: string) => { const isChecked = formData.projectData?.completedActivities.includes(activity); return (<div key={activity} className="flex items-center gap-2 bg-slate-900 p-2 rounded border border-slate-700/50 hover:border-slate-500 transition-colors cursor-pointer" onClick={() => toggleActivity(activity)}><div className={`w-4 h-4 rounded-sm border flex-shrink-0 flex items-center justify-center transition-colors ${isChecked ? 'bg-indigo-500 border-indigo-500' : 'border-slate-500'}`}>{isChecked && <IconCheck className="w-3 h-3 text-white" />}</div><span className={`text-xs ${isChecked ? 'text-slate-200' : 'text-slate-400'} break-words`}>{activity}</span></div>)})}</div></div>)}</div>)}{formData.history && formData.history.length > 0 && (<div className="mt-6 border-t border-slate-700 pt-4"><h4 className="text-sm font-bold text-white mb-3 flex items-center gap-2"><IconClock className="w-4 h-4 text-indigo-400" /> Histórico de Alterações</h4><div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">{formData.history.slice().reverse().map((entry: HistoryEntry) => (<div key={entry.id} className="text-xs bg-slate-900/60 p-3 rounded border border-slate-700/50 hover:border-slate-600 transition-colors"><div className="flex justify-between text-slate-500 mb-1"><span className="font-mono">{new Date(entry.date).toLocaleString()}</span><span className="font-medium text-indigo-400">{entry.user}</span></div><p className="text-slate-300">{entry.action}</p></div>))}</div></div>)}</div><div className="p-6 border-t border-slate-700 flex justify-between bg-slate-900 rounded-b-2xl"><Button variant="danger" onClick={() => onDelete(formData.id)}>Excluir</Button><div className="flex gap-3"><Button variant="secondary" onClick={onClose}>Cancelar</Button><Button onClick={() => onSave(formData)}>Salvar Alterações</Button></div></div></div></div>)
}

const PowerBIDataView = () => {
    const [searchParams] = useSearchParams(); const key = searchParams.get('key'); const storedKey = StorageService.getApiKey(); if (!storedKey || key !== storedKey) return (<div className="flex items-center justify-center h-screen bg-slate-900 text-slate-400 font-mono flex-col p-4"><div className="text-4xl font-bold text-rose-500 mb-4">403</div><p>Acesso Negado</p><p className="text-sm mt-2 opacity-75">Chave de integração inválida ou não configurada.</p></div>);
    const data = { generatedAt: new Date().toISOString(), metadata: { app: "Nexus Project", version: "1.0", endpoint: "powerbi-integration" }, tasks: StorageService.getTasks(), robots: StorageService.getRobots(), developers: StorageService.getDevs() };
    return (<pre className="p-4 bg-white text-black font-mono text-xs whitespace-pre-wrap h-full overflow-auto">{JSON.stringify(data, null, 2)}</pre>);
};

export default function App() {
  const [user, setUser] = useState<User | null>(StorageService.getUser());
  const [tasks, setTasks] = useState<Task[]>(StorageService.getTasks());
  const [devs, setDevs] = useState<Developer[]>(StorageService.getDevs());
  const [robots, setRobots] = useState<Robot[]>(StorageService.getRobots());
  const [sprints, setSprints] = useState<Sprint[]>(StorageService.getSprints());
  const [workflowConfig, setWorkflowConfig] = useState<WorkflowPhase[]>(StorageService.getWorkflowConfig(DEFAULT_WORKFLOW));
  const [documentsConfig, setDocumentsConfig] = useState<DocumentConfig[]>(StorageService.getDocumentsConfig(DEFAULT_DOCS));
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [isManageDevsOpen, setIsManageDevsOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);
  const [uploadFiles, setUploadFiles] = useState<{ [key: string]: File | null }>({ 'Incidente': null, 'Melhoria': null, 'Nova Automação': null });
  const handleLogin = (loggedInUser: User) => setUser(loggedInUser);
  const handleLogout = () => { StorageService.logout(); setUser(null); };
  const processNewTasks = (newTasks: Task[], typeName: string) => { const merged = StorageService.mergeTasks(newTasks); setTasks(merged); const uniqueAssignees = new Set(newTasks.map(t => t.assignee).filter(Boolean)); const currentDevNames = new Set(devs.map(d => d.name)); const newDevsToAdd: Developer[] = []; uniqueAssignees.forEach(name => { if (name && !currentDevNames.has(name as string)) newDevsToAdd.push({ id: `dev-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`, name: name as string }); }); if (newDevsToAdd.length > 0) { const updatedDevs = [...devs, ...newDevsToAdd]; setDevs(updatedDevs); StorageService.saveDevs(updatedDevs); } };
  const handleProcessAllUploads = async () => { let allNewTasks: Task[] = []; try { if (uploadFiles['Incidente']) allNewTasks = [...allNewTasks, ...await ExcelService.parseFile(uploadFiles['Incidente'], 'Incidente')]; if (uploadFiles['Melhoria']) allNewTasks = [...allNewTasks, ...await ExcelService.parseFile(uploadFiles['Melhoria'], 'Melhoria')]; if (uploadFiles['Nova Automação']) allNewTasks = [...allNewTasks, ...await ExcelService.parseFile(uploadFiles['Nova Automação'], 'Nova Automação')]; processNewTasks(allNewTasks, 'Todas'); setIsUploadModalOpen(false); alert(`${allNewTasks.length} demandas processadas.`); } catch (e) { alert("Erro ao processar arquivos."); } };
  const handleProcessSingleUpload = async (type: TaskType) => { const file = uploadFiles[type]; if (!file) return; try { const newTasks = await ExcelService.parseFile(file, type); processNewTasks(newTasks, type); alert(`${newTasks.length} demandas de ${type} processadas.`); setUploadFiles(prev => ({ ...prev, [type]: null })); } catch (e) { alert(`Erro ao processar ${type}.`); } };
  const handleAddDev = (name: string) => { if (name && !devs.find(d => d.name === name)) { const newDevs = [...devs, { id: `dev-${Date.now()}`, name }]; setDevs(newDevs); StorageService.saveDevs(newDevs); } };
  const handleRemoveDev = (id: string) => { const newDevs = devs.filter(d => d.id !== id); setDevs(newDevs); StorageService.saveDevs(newDevs); };
  const handleCreateTask = () => setEditingTask({ id: '', type: 'Incidente', summary: '', description: '', priority: '3 - Moderada', status: 'Novo', assignee: null, estimatedTime: '', actualTime: '', startDate: '', endDate: '', projectPath: '', automationName: '', managementArea: '', fteValue: undefined, createdAt: new Date().toISOString(), requester: user?.name || 'Manual', projectData: { currentPhaseId: '1', phaseStatus: 'Não Iniciado', completedActivities: [] }, blocker: '' });
  const handleTaskUpdate = (updatedTask: Task) => { if (!user) return; if (!updatedTask.id) { alert("O número do chamado é obrigatório."); return; } const taskExists = tasks.some(t => t.id === updatedTask.id); let finalTask = updatedTask; if (taskExists) { const oldTask = tasks.find(t => t.id === updatedTask.id); if (oldTask) { const history = detectChanges(oldTask, updatedTask, user); if (history.length > 0) finalTask.history = [...(oldTask.history || []), ...history]; const isAutomation = updatedTask.type === 'Nova Automação'; const isDone = ['Concluído', 'Resolvido', 'Fechado'].includes(updatedTask.status); const wasNotDone = !['Concluído', 'Resolvido', 'Fechado'].includes(oldTask.status); if (isAutomation && isDone && wasNotDone) { const robotName = updatedTask.automationName || updatedTask.summary; if (!robots.some(r => r.name.toLowerCase() === robotName.toLowerCase()) && robotName) { const newRobot: Robot = { id: `rpa-auto-${Date.now()}`, name: robotName, area: updatedTask.managementArea || 'N/A', developer: updatedTask.assignee || 'N/A', folder: updatedTask.projectPath || 'N/A', owners: updatedTask.requester || 'N/A', status: 'ATIVO', ticketNumber: updatedTask.id, fte: updatedTask.fteValue || 0 }; const updatedRobots = [...robots, newRobot]; setRobots(updatedRobots); StorageService.saveRobots(updatedRobots); finalTask.history = [...(finalTask.history || []), { id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString(), user: 'Sistema', action: `Robô '${robotName}' cadastrado automaticamente na base RPA.` }]; } } } const newTasks = tasks.map(t => t.id === finalTask.id ? finalTask : t); setTasks(newTasks); StorageService.saveTasks(newTasks); } else { finalTask.history = [{ id: Math.random().toString(36).substr(2, 9), date: new Date().toISOString(), user: user.name, action: 'Tarefa criada manualmente' }]; const newTasks = [...tasks, finalTask]; setTasks(newTasks); StorageService.saveTasks(newTasks); } setEditingTask(null); };
  const handleTaskDelete = (id: string) => { if (window.confirm("Tem certeza?")) { const newTasks = tasks.filter(t => t.id !== id); setTasks(newTasks); StorageService.saveTasks(newTasks); setEditingTask(null); } };
  const handleResetData = () => { StorageService.clearTasks(); setTasks([]); alert("Todas as demandas foram apagadas."); };
  const isPowerBiRoute = window.location.hash.includes('powerbi-data');
  if (!user && !isPowerBiRoute) return <AuthPage onLogin={handleLogin} />;
  const headerActions = (<div className="flex gap-3 bg-slate-800/80 p-1 rounded-lg backdrop-blur-md border border-slate-700"><Button onClick={handleCreateTask} variant="primary" className="text-xs py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white border-none"><IconPlus className="w-4 h-4" /> Nova Demanda</Button><div className="w-px bg-slate-700 h-6 self-center"></div><Button onClick={() => setIsManageDevsOpen(true)} variant="secondary" className="text-xs py-1.5 bg-transparent border-none hover:bg-slate-700 text-slate-300"><IconUsers className="w-4 h-4" /> Devs</Button><Button onClick={() => setIsUploadModalOpen(true)} className="text-xs py-1.5"><IconUpload className="w-4 h-4" /> Upload</Button></div>);
  return (<HashRouter><Layout user={user || {id:'0',name:'Guest',email:''}} onLogout={handleLogout} headerContent={headerActions}>{isUploadModalOpen && (<div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"><div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 max-w-xl w-full shadow-2xl"><h3 className="text-xl font-bold mb-6 text-white">Importar Planilhas</h3><div className="space-y-6">{['Incidente', 'Melhoria', 'Nova Automação'].map(type => (<div key={type} className="flex items-end gap-3"><div className="flex-1"><label className="block text-sm text-slate-400 mb-1">{type}</label><input type="file" accept=".xlsx, .xls" onChange={(e) => setUploadFiles({...uploadFiles, [type]: e.target.files?.[0] || null})} className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-slate-700 file:text-white hover:file:bg-slate-600 cursor-pointer border border-slate-600 rounded-lg" /></div><Button onClick={() => handleProcessSingleUpload(type as TaskType)} disabled={!uploadFiles[type]} className="h-10 text-xs" variant="secondary">Processar</Button></div>))}</div><div className="mt-8 flex justify-end gap-3 border-t border-slate-700 pt-4"><Button variant="secondary" onClick={() => setIsUploadModalOpen(false)}>Cancelar</Button><Button onClick={handleProcessAllUploads} disabled={!Object.values(uploadFiles).some(f => f !== null)}>Processar Tudo</Button></div></div></div>)}{isManageDevsOpen && (<div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50"><div className="bg-slate-800 p-6 rounded-2xl border border-slate-600 max-w-md w-full"><h3 className="text-lg font-bold mb-4 text-white">Gerenciar Desenvolvedores</h3><ul className="space-y-2 mb-4 max-h-60 overflow-y-auto custom-scrollbar">{devs.map(d => (<li key={d.id} className="flex justify-between items-center bg-slate-900 p-2 rounded border border-slate-700"><span className="text-sm text-white">{d.name}</span><button onClick={() => handleRemoveDev(d.id)} className="text-rose-500 hover:text-rose-400">✕</button></li>))}</ul><div className="flex gap-2"><input id="newDevInput" type="text" placeholder="Nome..." className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 text-sm text-white outline-none" /><Button onClick={() => { const input = document.getElementById('newDevInput') as HTMLInputElement; handleAddDev(input.value); input.value = ''; }} variant="success" className="py-1">+</Button></div><div className="mt-4 flex justify-end"><Button variant="secondary" onClick={() => setIsManageDevsOpen(false)}>Fechar</Button></div></div></div>)}{editingTask && (<TaskModal task={editingTask} developers={devs} allTasks={tasks} workflowConfig={workflowConfig} onClose={() => setEditingTask(null)} onSave={handleTaskUpdate} onDelete={handleTaskDelete} />)}<Routes><Route path="/" element={<DashboardView tasks={tasks} devs={devs} />} /><Route path="/projects" element={<ProjectFlowView tasks={tasks} setTasks={setTasks} devs={devs} onEditTask={setEditingTask} user={user!} workflowConfig={workflowConfig} setWorkflowConfig={setWorkflowConfig} />} /><Route path="/esteira" element={<DocumentPipelineView tasks={tasks} setTasks={setTasks} devs={devs} documentsConfig={documentsConfig} setDocumentsConfig={setDocumentsConfig} user={user!} />} /><Route path="/sprints" element={<SprintsView tasks={tasks} sprints={sprints} setSprints={setSprints} devs={devs} user={user!} />} /><Route path="/project-report" element={<ProjectReportView tasks={tasks} workflowConfig={workflowConfig} devs={devs} />} /><Route path="/kanban" element={<KanbanView tasks={tasks} setTasks={setTasks} devs={devs} onEditTask={setEditingTask} user={user!} />} /><Route path="/list" element={<ListView tasks={tasks} setTasks={setTasks} devs={devs} onEditTask={setEditingTask} user={user!} />} /><Route path="/gantt" element={<GanttView tasks={tasks} devs={devs} />} /><Route path="/robots" element={<RobotManagementView robots={robots} setRobots={setRobots} />} /><Route path="/reports" element={<ReportsView tasks={tasks} devs={devs} robots={robots} workflowConfig={workflowConfig} docsConfig={documentsConfig} />} /><Route path="/profile" element={<UserProfile user={user!} setUser={setUser} onResetData={handleResetData} />} /><Route path="/powerbi-data" element={<PowerBIDataView />} /><Route path="*" element={<Navigate to="/" />} /></Routes></Layout></HashRouter>);
}
