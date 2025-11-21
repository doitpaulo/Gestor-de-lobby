
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
import { Task, Developer, User, TaskType, Priority, HistoryEntry, Comment } from './types';
import { IconHome, IconKanban, IconList, IconUpload, IconDownload, IconUsers, IconClock, IconChevronLeft, IconPlus } from './components/Icons';

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

// --- Filter Component ---

const FilterBar = ({ filters, setFilters, devs }: { filters: any, setFilters: any, devs?: Developer[] }) => {
  const handleChange = (key: string, value: string) => {
    setFilters((prev: any) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col md:flex-row gap-3 bg-slate-800 p-3 rounded-xl border border-slate-700 mb-4 items-center">
       <div className="flex-1 w-full md:w-auto relative">
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
       <select 
          className="w-full md:w-auto bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
          value={filters.type}
          onChange={(e) => handleChange('type', e.target.value)}
       >
          <option value="All">Todos Tipos</option>
          <option value="Incidente">Incidente</option>
          <option value="Melhoria">Melhoria</option>
          <option value="Nova Automação">Nova Automação</option>
       </select>
       <select 
          className="w-full md:w-auto bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
          value={filters.priority}
          onChange={(e) => handleChange('priority', e.target.value)}
       >
          <option value="All">Todas Prioridades</option>
          <option value="1 - Crítica">1 - Crítica</option>
          <option value="2 - Alta">2 - Alta</option>
          <option value="3 - Moderada">3 - Moderada</option>
          <option value="4 - Baixa">4 - Baixa</option>
       </select>
       <select 
          className="w-full md:w-auto bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
          value={filters.status}
          onChange={(e) => handleChange('status', e.target.value)}
       >
          <option value="All">Todos Status</option>
          <option value="Novo">Novo</option>
          <option value="Pendente">Pendente</option>
          <option value="Em Atendimento">Em Atendimento</option>
          <option value="Em Progresso">Em Progresso</option>
          <option value="Aguardando">Aguardando</option>
          <option value="Resolvido">Resolvido</option>
          <option value="Fechado">Fechado</option>
       </select>
       {devs && (
           <select 
              className="w-full md:w-auto bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
              value={filters.assignee || 'All'}
              onChange={(e) => handleChange('assignee', e.target.value)}
           >
              <option value="All">Todos Devs</option>
              {devs.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
              <option value="Unassigned">Não Atribuído</option>
           </select>
       )}
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

const GanttView = ({ tasks }: { tasks: Task[] }) => {
  const timelineData = useMemo(() => {
    return tasks
      .filter(t => t.startDate && t.endDate)
      .map(t => ({
        ...t,
        start: new Date(t.startDate!).getTime(),
        end: new Date(t.endDate!).getTime()
      }))
      .sort((a, b) => a.start - b.start);
  }, [tasks]);

  if (timelineData.length === 0) {
    return (
        <div className="flex flex-col items-center justify-center h-96 text-slate-500 gap-4">
            <IconClock className="w-12 h-12 opacity-20" />
            <p>Adicione datas de início e fim às tarefas para visualizar o Gantt.</p>
        </div>
    );
  }

  const minDate = Math.min(...timelineData.map(t => t.start));
  const maxDate = Math.max(...timelineData.map(t => t.end));
  const dayMs = 86400000;
  const totalDays = Math.ceil((maxDate - minDate) / dayMs) + 7; // +7 buffer

  return (
    <Card className="overflow-hidden h-full flex flex-col bg-slate-800/90">
      <div className="flex justify-between items-center mb-6">
        <div>
            <h3 className="text-xl font-bold text-white">Cronograma (Gantt)</h3>
            <p className="text-xs text-slate-400 mt-1">Visualização temporal das demandas. (1d = 8h de esforço)</p>
        </div>
        <div className="flex gap-2 text-xs">
             <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-rose-500"></span> Incidente</div>
             <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500"></span> Melhoria</div>
             <div className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-indigo-500"></span> Automação</div>
        </div>
      </div>

      <div className="overflow-x-auto pb-4 custom-scrollbar flex-1 border border-slate-700 rounded-lg bg-slate-900/50">
        <div className="relative min-w-[800px]" style={{ width: `${Math.max(totalDays * 48, 800)}px` }}>
          {/* Header Dates */}
          <div className="flex border-b border-slate-700 mb-2 sticky top-0 bg-slate-800 z-20 shadow-md">
             {Array.from({ length: totalDays }).map((_, i) => {
                 const d = new Date(minDate + i * dayMs);
                 const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                 return (
                     <div key={i} className={`w-12 flex flex-col items-center justify-center border-l border-slate-700/50 py-2 ${isWeekend ? 'bg-slate-900/40' : ''}`}>
                         <span className="text-[10px] text-slate-500 font-bold">{d.getDate()}</span>
                         <span className="text-[9px] text-slate-600 uppercase">{d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.','')}</span>
                     </div>
                 )
             })}
          </div>
          
          {/* Task Bars */}
          <div className="space-y-3 px-0 pb-10">
            {timelineData.map((task, index) => {
               const durationDays = Math.floor((task.end - task.start) / dayMs) + 1; // Calendar duration
               const offsetDays = Math.floor((task.start - minDate) / dayMs);
               
               // Calculate Effort in Days (8h base)
               const hours = parseDuration(task.estimatedTime);
               const effortDays = hours > 0 ? (hours / 8) : 0;
               const effortDisplay = effortDays > 0 
                   ? (Number.isInteger(effortDays) ? `${effortDays}d` : `${effortDays.toFixed(1)}d`) 
                   : '';

               let colorClass = "bg-slate-600";
               if (task.type === 'Incidente') colorClass = "bg-rose-600";
               if (task.type === 'Melhoria') colorClass = "bg-emerald-600";
               if (task.type === 'Nova Automação') colorClass = "bg-indigo-600";

               return (
                   <div key={task.id} className="relative h-10 hover:bg-white/5 flex items-center group transition-colors">
                       {/* Full width row line */}
                       <div className="absolute inset-0 border-b border-slate-800/30 pointer-events-none"></div>
                       
                       <div 
                          className={`absolute h-7 rounded-md shadow-lg ${colorClass} hover:brightness-110 border border-white/10 cursor-pointer flex items-center px-3 overflow-hidden whitespace-nowrap text-xs text-white font-medium transition-all z-10`}
                          style={{ left: `${offsetDays * 48}px`, width: `${Math.max(durationDays * 48, 48)}px` }}
                          title={`Tarefa: ${task.summary}
Dev: ${task.assignee || 'N/A'}
Início: ${new Date(task.start).toLocaleDateString()}
Fim: ${new Date(task.end).toLocaleDateString()}
Duração (Cal): ${durationDays} dias
Esforço Est.: ${task.estimatedTime || '-'} (${effortDisplay || '-'})`}
                       >
                           <div className="flex justify-between items-center w-full gap-2">
                               <span className="truncate drop-shadow-md">{task.summary}</span>
                               {effortDisplay && (
                                   <span className="bg-black/30 px-1.5 py-0.5 rounded text-[10px] font-mono border border-white/10 shadow-sm flex-shrink-0 text-emerald-200">
                                       {effortDisplay}
                                   </span>
                               )}
                           </div>
                       </div>
                   </div>
               )
            })}
          </div>
        </div>
      </div>
    </Card>
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
    { id: 'w1', type: 'cards', title: 'KPIs Gerais', size: 'full', visible: true },
    { id: 'w2', type: 'priority', title: 'Demandas por Prioridade', size: 'half', visible: true },
    { id: 'w3', type: 'status', title: 'Distribuição por Status', size: 'half', visible: true },
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
  const [filterDev, setFilterDev] = useState<string>('All');

  useEffect(() => {
      localStorage.setItem('nexus_dashboard_widgets', JSON.stringify(widgets));
  }, [widgets]);

  const filteredTasks = useMemo(() => {
    return filterDev === 'All' ? tasks : tasks.filter(t => t.assignee === filterDev);
  }, [tasks, filterDev]);

  // --- Metrics Calculation ---
  const metrics = useMemo(() => ({
    incidents: filteredTasks.filter(t => t.type === 'Incidente').length,
    features: filteredTasks.filter(t => t.type === 'Melhoria').length,
    automations: filteredTasks.filter(t => t.type === 'Nova Automação').length,
    total: filteredTasks.length
  }), [filteredTasks]);

  const priorityData = useMemo(() => {
    const counts: any = { '1 - Crítica': 0, '2 - Alta': 0, '3 - Moderada': 0, '4 - Baixa': 0 };
    filteredTasks.forEach(t => { counts[t.priority] = (counts[t.priority] || 0) + 1; });
    return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredTasks]);
  
  const statusData = useMemo(() => {
      const counts: any = {};
      filteredTasks.forEach(t => { counts[t.status] = (counts[t.status] || 0) + 1; });
      return Object.entries(counts).map(([name, value]) => ({ name, value }));
  }, [filteredTasks]);

  const devTypeData = useMemo(() => {
    const data = devs.map(dev => {
        const devTasks = tasks.filter(t => t.assignee === dev.name);
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
  }, [tasks, devs]);

  // --- Capacity Logic (Time Based & Availability) ---
  const capacityData = useMemo(() => {
    const data = devs.map(dev => {
        // Filter tasks that are NOT done/resolved/closed
        const activeTasks = tasks.filter(t => 
            t.assignee === dev.name && 
            !['Concluído', 'Resolvido', 'Fechado'].includes(t.status)
        );
        
        // Sum estimated time (Calculate workload time)
        const totalHours = activeTasks.reduce((acc, t) => {
            return acc + parseDuration(t.estimatedTime);
        }, 0);

        return {
            name: dev.name,
            activeTasksCount: activeTasks.length,
            totalHours: totalHours
        };
    });
    
    // Sort by totalHours Ascending (Least busy first -> Available First)
    return data.sort((a, b) => a.totalHours - b.totalHours);
  }, [tasks, devs]);

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
    slide.addText(`Gerado em: ${new Date().toLocaleDateString()} - Visão Geral`, { x: 1, y: 3, w: '80%', fontSize: 18, color: '94a3b8', align: 'center' });

    // Slide 2: KPIs (Text Based)
    slide = pres.addSlide();
    slide.background = { color: "0f172a" };
    slide.addText("Métricas Gerais (KPIs)", { x: 0.5, y: 0.5, fontSize: 24, color: 'FFFFFF', bold: true });
    
    const stats = [
      { label: "Total", val: metrics.total, color: "FFFFFF" },
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
        s.addChart(type, data, { x: 1, y: 1.5, w: '80%', h: '70%', ...opts });
        return s;
    };

    // Slide 3: Priority (Bar)
    addChartSlide("Demandas por Prioridade", pres.ChartType.bar, priorityData.map(p => ({
        name: p.name,
        labels: [p.name],
        values: [p.value]
    })), { barDir: 'col', chartColors: ['8b5cf6'], valAxisMinVal: 0, valAxisLabelColor: '94a3b8', catAxisLabelColor: '94a3b8' });

    // Slide 4: Status (Pie)
    addChartSlide("Distribuição por Status", pres.ChartType.pie, statusData.map(s => ({
        name: s.name,
        labels: [s.name],
        values: [s.value]
    })), { showLegend: true, legendPos: 'r', legendColor: 'FFFFFF' });

    // Slide 5: Dev Workload (Stacked Bar) - New Slide requested implicitly by "all charts"
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
        s.addText(`Sugestão de Atribuição: ${bestDev.name} (Livre em ~${formatDuration(bestDev.totalHours)})`, { 
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
                            <span className="text-slate-400 text-xs uppercase font-bold">Total</span>
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
                        <PieChart>
                            <Pie
                                data={statusData}
                                cx="50%"
                                cy="50%"
                                innerRadius={60}
                                outerRadius={80}
                                paddingAngle={5}
                                dataKey="value"
                                label={({ name, value }) => `${name}: ${value}`} 
                            >
                                {statusData.map((entry, index) => (
                                    <Cell key={`cell-${index}`} fill={['#f43f5e', '#10b981', '#6366f1', '#eab308', '#0ea5e9', '#8b5cf6', '#64748b'][index % 7]} />
                                ))}
                            </Pie>
                            <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#fff' }} />
                            <Legend />
                        </PieChart>
                     </ResponsiveContainer>
                 )}
                 {widget.type === 'devType' && (
                     <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart 
                            data={devTypeData} 
                            layout="vertical" 
                            margin={{ top: 5, right: 60, left: 30, bottom: 5 }} 
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
                                tickLine={false}
                                axisLine={false}
                                interval={0}
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
          <select 
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none w-full md:w-auto"
            value={filterDev}
            onChange={(e) => setFilterDev(e.target.value)}
          >
            <option value="All">Filtrar: Todos</option>
            {devs.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
          
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

// --- Kanban View ---
const KanbanView = ({ tasks, onUpdateStatus }: { tasks: Task[], onUpdateStatus: (t: Task, s: string) => void }) => {
  const columns = ['Novo', 'Pendente', 'Em Progresso', 'Resolvido', 'Fechado'];
  
  return (
    <div className="h-full flex gap-4 overflow-x-auto pb-4">
      {columns.map(col => {
        const colTasks = tasks.filter(t => t.status === col);
        return (
          <div key={col} className="min-w-[280px] w-80 bg-slate-800/50 rounded-xl border border-slate-700 flex flex-col max-h-full">
             <div className={`p-3 border-b border-slate-700 font-bold text-sm flex justify-between items-center sticky top-0 bg-slate-800/90 backdrop-blur rounded-t-xl z-10
                ${col === 'Novo' ? 'text-blue-400' : ''}
                ${col === 'Em Progresso' ? 'text-indigo-400' : ''}
                ${col === 'Resolvido' ? 'text-emerald-400' : ''}
             `}>
               {col}
               <span className="bg-slate-700 text-slate-300 text-xs px-2 py-0.5 rounded-full">{colTasks.length}</span>
             </div>
             <div className="p-3 space-y-3 overflow-y-auto custom-scrollbar flex-1">
               {colTasks.map(task => (
                 <div key={task.id} className="bg-slate-700/40 p-3 rounded-lg border border-slate-600/50 hover:bg-slate-700 transition-colors shadow-sm group cursor-pointer">
                    <div className="flex justify-between items-start mb-2">
                       <span className="text-xs font-mono text-slate-500">{task.id}</span>
                       <Badge type={task.type} />
                    </div>
                    <p className="text-sm text-slate-200 font-medium mb-3 line-clamp-2">{task.summary}</p>
                    <div className="flex justify-between items-center text-xs text-slate-400">
                       <div className="flex items-center gap-1">
                          <IconUsers className="w-3 h-3" /> {task.assignee?.split(' ')[0] || 'N/A'}
                       </div>
                       <Badge type={task.priority} className="scale-90 origin-right" />
                    </div>
                    
                    {/* Quick Actions */}
                    {col !== 'Fechado' && (
                        <div className="mt-3 pt-2 border-t border-white/5 flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                           {col !== 'Resolvido' && <button onClick={() => onUpdateStatus(task, 'Em Progresso')} className="text-[10px] bg-indigo-600 hover:bg-indigo-500 text-white px-2 py-1 rounded">Progresso</button>}
                           {col !== 'Resolvido' && <button onClick={() => onUpdateStatus(task, 'Resolvido')} className="text-[10px] bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded">Resolver</button>}
                        </div>
                    )}
                 </div>
               ))}
             </div>
          </div>
        )
      })}
    </div>
  )
};

// --- Task List View ---
const TaskListView = ({ tasks, onImport }: { tasks: Task[], onImport: (f: File) => void }) => {
    const fileRef = useRef<HTMLInputElement>(null);

    const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) onImport(e.target.files[0]);
    };

    return (
        <Card className="h-full flex flex-col overflow-hidden">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-bold text-white">Lista de Demandas</h3>
                <div className="flex gap-2">
                    <input type="file" ref={fileRef} hidden accept=".xlsx,.xls" onChange={handleFile} />
                    <Button onClick={() => fileRef.current?.click()} variant="primary">
                        <IconUpload className="w-4 h-4" /> Importar Excel
                    </Button>
                </div>
            </div>
            <div className="flex-1 overflow-auto custom-scrollbar border border-slate-700 rounded-lg">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-slate-900 text-slate-400 text-xs uppercase sticky top-0 z-10">
                        <tr>
                            <th className="p-3 font-medium border-b border-slate-700">ID</th>
                            <th className="p-3 font-medium border-b border-slate-700">Tipo</th>
                            <th className="p-3 font-medium border-b border-slate-700 w-1/3">Resumo</th>
                            <th className="p-3 font-medium border-b border-slate-700">Prioridade</th>
                            <th className="p-3 font-medium border-b border-slate-700">Status</th>
                            <th className="p-3 font-medium border-b border-slate-700">Resp.</th>
                            <th className="p-3 font-medium border-b border-slate-700">Criado Em</th>
                        </tr>
                    </thead>
                    <tbody className="text-sm divide-y divide-slate-700/50">
                        {tasks.map(t => (
                            <tr key={t.id} className="hover:bg-slate-700/30 transition-colors">
                                <td className="p-3 font-mono text-slate-500 text-xs">{t.id}</td>
                                <td className="p-3"><Badge type={t.type} /></td>
                                <td className="p-3 text-slate-200 font-medium">{t.summary}</td>
                                <td className="p-3"><Badge type={t.priority} /></td>
                                <td className="p-3 text-slate-300">{t.status}</td>
                                <td className="p-3 text-slate-400">{t.assignee || '-'}</td>
                                <td className="p-3 text-slate-500 text-xs">{new Date(t.createdAt).toLocaleDateString()}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </Card>
    )
};

// --- Layout Components ---

const SidebarItem = ({ icon: Icon, label, to, active }: any) => (
    <button 
      onClick={() => window.location.hash = to}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group ${active ? 'bg-indigo-600 text-white shadow-indigo-500/25 shadow-lg' : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'}`}
    >
        <Icon className={`w-5 h-5 ${active ? 'text-white' : 'text-slate-500 group-hover:text-indigo-400'}`} />
        <span className="font-medium">{label}</span>
    </button>
);

const Sidebar = ({ currentPath, onLogout, user }: any) => {
    return (
        <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col p-4 hidden md:flex">
            <div className="flex items-center gap-3 px-2 mb-10 mt-2">
                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-lg">N</div>
                <h1 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">Nexus</h1>
            </div>

            <nav className="space-y-2 flex-1">
                <SidebarItem icon={IconHome} label="Dashboard" to="/" active={currentPath === '/'} />
                <SidebarItem icon={IconKanban} label="Kanban" to="#/kanban" active={currentPath === '/kanban'} />
                <SidebarItem icon={IconList} label="Lista" to="#/list" active={currentPath === '/list'} />
                <SidebarItem icon={IconClock} label="Cronograma" to="#/gantt" active={currentPath === '/gantt'} />
            </nav>

            <div className="pt-6 border-t border-slate-800">
                 <button onClick={() => window.location.hash = '#/profile'} className="flex items-center gap-3 px-2 py-2 w-full hover:bg-slate-800 rounded-lg transition-colors group text-left">
                     <div className="w-8 h-8 rounded-full bg-slate-700 overflow-hidden border border-slate-600 group-hover:border-indigo-500">
                         {user.avatar ? <img src={user.avatar} className="w-full h-full object-cover" /> : <div className="w-full h-full flex items-center justify-center text-xs">{user.name[0]}</div>}
                     </div>
                     <div className="flex-1 overflow-hidden">
                         <p className="text-sm font-medium text-white truncate">{user.name}</p>
                         <p className="text-xs text-slate-500 truncate">{user.email}</p>
                     </div>
                 </button>
                 <button onClick={onLogout} className="mt-4 w-full flex items-center justify-center gap-2 text-xs text-slate-500 hover:text-rose-400 py-2">
                    Sair do Sistema
                 </button>
            </div>
        </aside>
    );
};

// --- Login View ---
const LoginView = ({ onLogin }: { onLogin: (u: User) => void }) => {
    const [isRegister, setIsRegister] = useState(false);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [name, setName] = useState('');
    const [error, setError] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        
        if (isRegister) {
            const success = StorageService.registerUser({ id: Date.now().toString(), email, password, name });
            if (success) {
                alert("Conta criada! Faça login.");
                setIsRegister(false);
            } else {
                setError("Email já cadastrado.");
            }
        } else {
            const user = StorageService.authenticateUser(email, password);
            if (user) onLogin(user);
            else setError("Credenciais inválidas.");
        }
    };

    return (
        <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4 relative overflow-hidden">
            {/* Background Effects */}
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] bg-indigo-900/20 blur-[120px] rounded-full" />
                <div className="absolute top-[40%] right-[0%] w-[40%] h-[40%] bg-rose-900/10 blur-[100px] rounded-full" />
            </div>

            <div className="w-full max-w-md relative z-10">
                <div className="text-center mb-8">
                    <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4 shadow-lg shadow-indigo-500/30">N</div>
                    <h1 className="text-3xl font-bold text-white mb-2">Bem-vindo ao Nexus</h1>
                    <p className="text-slate-400">Gerenciamento Inteligente de Projetos</p>
                </div>

                <Card className="bg-slate-900/90 backdrop-blur border-slate-800">
                    <form onSubmit={handleSubmit} className="space-y-4">
                        {isRegister && (
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Nome</label>
                                <input type="text" required className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none" value={name} onChange={e => setName(e.target.value)} />
                            </div>
                        )}
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Email</label>
                            <input type="email" required className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none" value={email} onChange={e => setEmail(e.target.value)} />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Senha</label>
                            <input type="password" required className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-white focus:ring-2 focus:ring-indigo-500 outline-none" value={password} onChange={e => setPassword(e.target.value)} />
                        </div>
                        
                        {error && <p className="text-rose-500 text-sm text-center">{error}</p>}

                        <Button type="submit" className="w-full mt-2">{isRegister ? 'Criar Conta' : 'Entrar'}</Button>
                    </form>

                    <div className="mt-6 text-center text-sm">
                        <button onClick={() => setIsRegister(!isRegister)} className="text-indigo-400 hover:text-indigo-300">
                            {isRegister ? 'Já tem conta? Faça Login' : 'Não tem conta? Cadastre-se'}
                        </button>
                    </div>
                </Card>
            </div>
        </div>
    );
};

// --- Main Application ---

const App = () => {
  const [user, setUser] = useState<User | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [devs, setDevs] = useState<Developer[]>([]);
  const [filters, setFilters] = useState({ search: '', type: 'All', priority: 'All', status: 'All', assignee: 'All' });

  // Initial Load
  useEffect(() => {
      const session = StorageService.getUser();
      if (session) {
          setUser(session);
          loadData();
      }
  }, []);

  const loadData = () => {
      setTasks(StorageService.getTasks());
      setDevs(StorageService.getDevs());
  };

  const handleLogin = (u: User) => {
      setUser(u);
      loadData();
  };

  const handleLogout = () => {
      StorageService.logout();
      setUser(null);
      setTasks([]);
  };
  
  const handleImport = async (file: File) => {
      try {
          const newTasks = await ExcelService.parseFile(file);
          const merged = StorageService.mergeTasks(newTasks);
          setTasks(merged);
          alert(`${newTasks.length} tarefas importadas/atualizadas com sucesso!`);
      } catch (e) {
          alert("Erro ao importar arquivo.");
          console.error(e);
      }
  };

  const handleStatusUpdate = (task: Task, newStatus: string) => {
      const updated = { ...task, status: newStatus };
      // In a real app, we would update history here
      const merged = StorageService.mergeTasks([updated]);
      setTasks(merged);
  };

  const handleReset = () => {
      StorageService.clearTasks();
      setTasks([]);
  };

  // Filtering Logic
  const filteredTasks = useMemo(() => {
      return tasks.filter(t => {
          const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || t.id.toLowerCase().includes(filters.search.toLowerCase());
          const matchesType = filters.type === 'All' || t.type === filters.type;
          const matchesPriority = filters.priority === 'All' || t.priority === filters.priority;
          const matchesStatus = filters.status === 'All' || t.status === filters.status;
          const matchesAssignee = filters.assignee === 'All' || (filters.assignee === 'Unassigned' ? !t.assignee : t.assignee === filters.assignee);
          return matchesSearch && matchesType && matchesPriority && matchesStatus && matchesAssignee;
      });
  }, [tasks, filters]);

  if (!user) return <LoginView onLogin={handleLogin} />;

  return (
    <HashRouter>
      <div className="flex h-screen bg-slate-950 text-slate-200 font-sans selection:bg-indigo-500 selection:text-white overflow-hidden">
        <RouteRenderWrapper> 
            {(path) => <Sidebar currentPath={path} onLogout={handleLogout} user={user} />}
        </RouteRenderWrapper>
        
        <div className="flex-1 flex flex-col h-full overflow-hidden relative">
            {/* Mobile Header */}
            <div className="md:hidden h-14 border-b border-slate-800 flex items-center justify-between px-4 bg-slate-900">
                <span className="font-bold text-white">Nexus</span>
                <button onClick={handleLogout} className="text-xs text-rose-400">Sair</button>
            </div>

            <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6 scroll-smooth">
               <div className="max-w-[1600px] mx-auto h-full flex flex-col">
                   <Routes>
                       <Route path="/" element={
                           <div className="animate-fade-in">
                               <FilterBar filters={filters} setFilters={setFilters} devs={devs} />
                               <DashboardView tasks={filteredTasks} devs={devs} />
                           </div>
                       } />
                       <Route path="/kanban" element={
                           <div className="h-[calc(100vh-140px)] animate-fade-in flex flex-col">
                               <div className="mb-4">
                                   <FilterBar filters={filters} setFilters={setFilters} devs={devs} />
                               </div>
                               <div className="flex-1 min-h-0">
                                   <KanbanView tasks={filteredTasks} onUpdateStatus={handleStatusUpdate} />
                               </div>
                           </div>
                       } />
                       <Route path="/list" element={
                           <div className="h-[calc(100vh-140px)] animate-fade-in flex flex-col">
                               <div className="mb-4">
                                   <FilterBar filters={filters} setFilters={setFilters} devs={devs} />
                               </div>
                               <div className="flex-1 min-h-0">
                                   <TaskListView tasks={filteredTasks} onImport={handleImport} />
                               </div>
                           </div>
                       } />
                       <Route path="/gantt" element={
                           <div className="h-[calc(100vh-140px)] animate-fade-in">
                               <GanttView tasks={filteredTasks} />
                           </div>
                       } />
                       <Route path="/profile" element={<UserProfile user={user} setUser={setUser} onResetData={handleReset} />} />
                       <Route path="*" element={<Navigate to="/" />} />
                   </Routes>
               </div>
            </main>
        </div>
      </div>
    </HashRouter>
  );
};

// Wrapper to get current path for sidebar highlighting
const RouteRenderWrapper = ({ children }: { children: (path: string) => React.ReactNode }) => {
    const location = useLocation();
    return <>{children(location.pathname)}</>;
};

export default App;
