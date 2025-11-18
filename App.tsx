
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, 
  PieChart, Pie, Cell 
} from 'recharts';
import * as XLSX from 'xlsx';
import pptxgen from 'pptxgenjs';
import { StorageService } from './services/storageService';
import { ExcelService } from './services/excelService';
import { Task, Developer, User, TaskType, Priority } from './types';
import { IconHome, IconKanban, IconList, IconUpload, IconDownload, IconUsers, IconClock } from './components/Icons';

// --- Components Helpers ---

const Button = ({ children, onClick, variant = 'primary', className = '', disabled = false, type = 'button' }: any) => {
  const baseClass = "px-4 py-2 rounded-lg font-medium transition-all duration-200 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-md justify-center";
  const variants: any = {
    primary: "bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-500/30",
    secondary: "bg-slate-700 hover:bg-slate-600 text-slate-200 border border-slate-600",
    danger: "bg-rose-600 hover:bg-rose-700 text-white shadow-rose-500/30",
    success: "bg-emerald-600 hover:bg-emerald-700 text-white shadow-emerald-500/30"
  };
  return (
    <button type={type} onClick={onClick} disabled={disabled} className={`${baseClass} ${variants[variant]} ${className}`}>
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

const FilterBar = ({ filters, setFilters }: { filters: any, setFilters: any }) => {
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
    </div>
  )
};

// --- User Profile View ---

const UserProfile = ({ user, setUser }: { user: User, setUser: (u: User) => void }) => {
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

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in">
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
    </div>
  );
};

// --- Gantt View ---

const GanttView = ({ tasks }: { tasks: Task[] }) => {
  const timelineData = useMemo(() => {
    // Filter tasks with dates and valid assignee
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
    return <div className="flex items-center justify-center h-96 text-slate-500">Adicione datas de início e fim às tarefas para visualizar o Gantt.</div>;
  }

  const minDate = Math.min(...timelineData.map(t => t.start));
  const maxDate = Math.max(...timelineData.map(t => t.end));
  const dayMs = 86400000;
  const totalDays = Math.ceil((maxDate - minDate) / dayMs) + 5; // Padding

  return (
    <Card className="overflow-hidden">
      <h3 className="text-lg font-bold text-white mb-4">Linha do Tempo</h3>
      <div className="overflow-x-auto pb-4">
        <div className="relative min-w-[800px]" style={{ width: `${totalDays * 40}px` }}>
          {/* Dates Header */}
          <div className="flex border-b border-slate-700 mb-2">
             {Array.from({ length: totalDays }).map((_, i) => {
                 const d = new Date(minDate + i * dayMs);
                 return (
                     <div key={i} className="w-10 text-[10px] text-slate-500 text-center border-l border-slate-800 py-1">
                         {d.getDate()}/{d.getMonth() + 1}
                     </div>
                 )
             })}
          </div>
          {/* Bars */}
          <div className="space-y-2">
            {timelineData.map(task => {
               const duration = Math.ceil((task.end - task.start) / dayMs) + 1;
               const offset = Math.ceil((task.start - minDate) / dayMs);
               let colorClass = "bg-slate-600";
               if (task.type === 'Incidente') colorClass = "bg-rose-500";
               if (task.type === 'Melhoria') colorClass = "bg-emerald-500";
               if (task.type === 'Nova Automação') colorClass = "bg-indigo-500";

               return (
                   <div key={task.id} className="relative h-8 hover:bg-slate-700/30 rounded flex items-center group">
                       <div 
                          className={`absolute h-5 rounded shadow-lg ${colorClass} opacity-80 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center px-2 overflow-hidden whitespace-nowrap text-xs text-white font-medium`}
                          style={{ left: `${offset * 40}px`, width: `${duration * 40}px` }}
                          title={`${task.summary} (${new Date(task.start).toLocaleDateString()} - ${new Date(task.end).toLocaleDateString()})`}
                       >
                           {task.assignee && <span className="mr-2 opacity-75">[{task.assignee}]</span>}
                           {task.summary}
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

// --- Dashboard View ---

const DashboardView = ({ tasks, devs }: { tasks: Task[], devs: Developer[] }) => {
  const [filterDev, setFilterDev] = useState<string>('All');

  const filteredTasks = useMemo(() => {
    return filterDev === 'All' ? tasks : tasks.filter(t => t.assignee === filterDev);
  }, [tasks, filterDev]);

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

  const capacityData = useMemo(() => {
    // Calculate for all devs to show global capacity
    const data = devs.map(dev => ({
        name: dev.name,
        tasks: tasks.filter(t => t.assignee === dev.name && t.status !== 'Concluído' && t.status !== 'Resolvido').length
    }));
    // Sort ascending: least busy first
    return data.sort((a, b) => a.tasks - b.tasks);
  }, [tasks, devs]);

  const exportPPT = () => {
    const pres = new pptxgen();
    pres.layout = 'LAYOUT_WIDE';
    
    // Slide 1: Title
    let slide = pres.addSlide();
    slide.background = { color: "0f172a" };
    slide.addText("Relatório Nexus Project", { x: 1, y: 2, fontSize: 36, color: 'FFFFFF', bold: true, align: 'center' });
    slide.addText(`Gerado em: ${new Date().toLocaleDateString()}`, { x: 1, y: 3, fontSize: 18, color: '94a3b8', align: 'center' });

    // Slide 2: Metrics
    slide = pres.addSlide();
    slide.background = { color: "0f172a" };
    slide.addText("Métricas Gerais", { x: 0.5, y: 0.5, fontSize: 24, color: 'FFFFFF', bold: true });
    
    const stats = [
      { label: "Total", val: metrics.total, color: "FFFFFF" },
      { label: "Incidentes", val: metrics.incidents, color: "F43F5E" },
      { label: "Melhorias", val: metrics.features, color: "10B981" },
      { label: "Automações", val: metrics.automations, color: "6366F1" }
    ];
    
    stats.forEach((stat, i) => {
        slide.addText(`${stat.label}\n${stat.val}`, { 
            x: 1 + (i * 2.5), y: 2, w: 2, h: 1.5, 
            fill: "1e293b", color: stat.color, align: 'center', fontSize: 20, bold: true 
        });
    });

    pres.writeFile({ fileName: "Nexus_Report.pptx" });
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Bar */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
             <h2 className="text-2xl font-bold text-white">Dashboard</h2>
             <p className="text-slate-400 text-sm">Visão geral de performance e demandas</p>
        </div>
        <div className="flex gap-4 w-full md:w-auto">
          <select 
            className="bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-200 focus:ring-2 focus:ring-indigo-500 outline-none w-full md:w-auto"
            value={filterDev}
            onChange={(e) => setFilterDev(e.target.value)}
          >
            <option value="All">Todos Desenvolvedores</option>
            {devs.map(d => <option key={d.id} value={d.name}>{d.name}</option>)}
          </select>
          <Button onClick={exportPPT} variant="secondary" className="whitespace-nowrap"><IconDownload /> PPT</Button>
        </div>
      </div>

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <Card className="border-t-4 border-t-slate-500">
          <h3 className="text-slate-400 text-xs uppercase font-bold tracking-wider">Total</h3>
          <div className="flex justify-between items-end mt-2">
            <p className="text-4xl font-bold text-white">{metrics.total}</p>
            <IconList />
          </div>
        </Card>
        <Card className="border-t-4 border-t-rose-500 bg-gradient-to-br from-slate-800 to-rose-900/20">
          <h3 className="text-rose-400 text-xs uppercase font-bold tracking-wider">Incidentes</h3>
           <div className="flex justify-between items-end mt-2">
             <p className="text-4xl font-bold text-white">{metrics.incidents}</p>
           </div>
        </Card>
        <Card className="border-t-4 border-t-emerald-500 bg-gradient-to-br from-slate-800 to-emerald-900/20">
          <h3 className="text-emerald-400 text-xs uppercase font-bold tracking-wider">Melhorias</h3>
           <div className="flex justify-between items-end mt-2">
              <p className="text-4xl font-bold text-white">{metrics.features}</p>
           </div>
        </Card>
        <Card className="border-t-4 border-t-indigo-500 bg-gradient-to-br from-slate-800 to-indigo-900/20">
          <h3 className="text-indigo-400 text-xs uppercase font-bold tracking-wider">Automações</h3>
           <div className="flex justify-between items-end mt-2">
             <p className="text-4xl font-bold text-white">{metrics.automations}</p>
           </div>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <h3 className="text-lg font-semibold mb-6 text-slate-200">Demandas por Prioridade</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={priorityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" vertical={false} />
                <XAxis dataKey="name" stroke="#94a3b8" tick={{fontSize: 12}} />
                <YAxis stroke="#94a3b8" />
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#fff' }} cursor={{fill: '#334155', opacity: 0.4}} />
                <Bar dataKey="value" fill="#8b5cf6" radius={[4, 4, 0, 0]} barSize={50} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <h3 className="text-lg font-semibold mb-6 text-slate-200">Distribuição de Tipos</h3>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={[
                      { name: 'Incidente', value: metrics.incidents },
                      { name: 'Melhoria', value: metrics.features },
                      { name: 'Automação', value: metrics.automations }
                  ]}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={80}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ value }) => `${value}`} 
                >
                  <Cell fill="#f43f5e" />
                  <Cell fill="#10b981" />
                  <Cell fill="#6366f1" />
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#fff' }} />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

       {/* Capacity Chart - Revised */}
       <Card>
          <div className="flex justify-between items-start mb-6">
            <div>
                <h3 className="text-lg font-bold text-slate-200">Capacidade & Disponibilidade</h3>
                <p className="text-sm text-slate-400">Ranking do menos ocupado para o mais ocupado</p>
            </div>
            {capacityData.length > 0 && (
                <div className="bg-emerald-900/30 border border-emerald-700/50 px-3 py-2 rounded-lg">
                     <p className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider mb-0.5">Sugestão de Atribuição</p>
                     <p className="text-sm text-white font-semibold">{capacityData[0].name}</p>
                </div>
            )}
          </div>
          
          <div className="space-y-4 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
              {capacityData.map((dev, idx) => {
                  const max = Math.max(...capacityData.map(d => d.tasks), 10); 
                  let barColor = 'bg-emerald-500'; 
                  let loadText = 'Livre';
                  let textColor = 'text-emerald-400';

                  if (dev.tasks >= 5) {
                      barColor = 'bg-yellow-500';
                      loadText = 'Moderado';
                      textColor = 'text-yellow-400';
                  }
                  if (dev.tasks > 8) {
                      barColor = 'bg-rose-500';
                      loadText = 'Crítico';
                      textColor = 'text-rose-500';
                  }

                  return (
                    <div key={dev.name} className="flex items-center gap-4 group">
                        <div className="w-8 text-slate-500 text-xs font-mono">#{idx + 1}</div>
                        <div className="w-32 text-sm text-slate-300 truncate font-medium">{dev.name}</div>
                        <div className="flex-1 h-3 bg-slate-700 rounded-full overflow-hidden relative">
                            <div 
                                className={`h-full rounded-full transition-all duration-1000 ${barColor}`} 
                                style={{ width: `${(dev.tasks / max) * 100}%`, minWidth: '4px' }}
                            ></div>
                        </div>
                        <div className="text-right w-20">
                            <span className={`text-sm font-bold ${textColor} mr-2`}>{dev.tasks}</span>
                            <span className="text-[10px] text-slate-500 uppercase">{loadText}</span>
                        </div>
                    </div>
                  );
              })}
              {capacityData.length === 0 && <p className="text-sm text-slate-500 text-center">Nenhum desenvolvedor encontrado.</p>}
          </div>
       </Card>
    </div>
  );
};

// --- Kanban View ---

const KanbanView = ({ tasks, setTasks, devs, onEditTask }: { tasks: Task[], setTasks: any, devs: Developer[], onEditTask: (task: Task) => void }) => {
  const [filters, setFilters] = useState({ search: '', type: 'All', priority: 'All', status: 'All' });

  const onDrop = (e: React.DragEvent, newStatus: string, newAssignee: string | null) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    const updatedTasks = tasks.map(t => {
      if (t.id === taskId) {
        let status = t.status;
        if (newStatus === 'Concluído') status = 'Resolvido';
        else if (t.status === 'Resolvido' || t.status === 'Concluído') status = 'Em Atendimento'; 

        return { ...t, status: status, assignee: newAssignee };
      }
      return t;
    });
    setTasks(updatedTasks);
    StorageService.saveTasks(updatedTasks);
  };

  const onDragStart = (e: React.DragEvent, taskId: string) => {
    e.dataTransfer.setData("taskId", taskId);
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
        const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) || 
                              t.id.toLowerCase().includes(filters.search.toLowerCase()) ||
                              (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
        const matchesType = filters.type === 'All' || t.type === filters.type;
        const matchesPriority = filters.priority === 'All' || t.priority === filters.priority;
        const matchesStatus = filters.status === 'All' || t.status === filters.status;
        return matchesSearch && matchesType && matchesPriority && matchesStatus;
    });
  }, [tasks, filters]);

  const columns = [
    { id: 'unassigned', title: 'Sem Atribuição', assignee: null, status: 'Backlog', isDone: false },
    ...devs.map(d => ({ id: d.id, title: d.name, assignee: d.name, status: 'In Progress', isDone: false })),
    { id: 'done', title: 'Concluído', assignee: null, status: 'Concluído', isDone: true }
  ];

  return (
    <div className="h-full flex flex-col">
      <FilterBar filters={filters} setFilters={setFilters} />
      
      <div className="flex-1 overflow-x-auto pb-2">
        <div className="flex gap-4 h-full min-w-max px-2">
          {columns.map(col => (
            <div 
              key={col.id}
              className={`flex-1 min-w-[320px] rounded-xl border flex flex-col ${col.isDone ? 'bg-emerald-900/20 border-emerald-800' : 'bg-slate-800/50 border-slate-700'}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => onDrop(e, col.status, col.assignee)}
            >
              <div className={`p-3 border-b rounded-t-xl sticky top-0 backdrop-blur-md z-10 flex justify-between items-center ${col.isDone ? 'bg-emerald-900/50 border-emerald-800' : 'bg-slate-800/80 border-slate-700'}`}>
                <h3 className="font-semibold text-white">{col.title}</h3>
                <span className="bg-slate-900/50 text-xs px-2 py-1 rounded text-slate-400 font-mono">
                  {filteredTasks.filter(t => {
                      if (col.isDone) return t.status === 'Resolvido' || t.status === 'Concluído';
                      if (col.id === 'unassigned') return !t.assignee && t.status !== 'Resolvido' && t.status !== 'Concluído';
                      return t.assignee === col.assignee && t.status !== 'Resolvido' && t.status !== 'Concluído';
                  }).length}
                </span>
              </div>
              
              <div className="p-3 space-y-3 overflow-y-auto flex-1 custom-scrollbar">
                {filteredTasks
                  .filter(t => {
                      if (col.isDone) return t.status === 'Resolvido' || t.status === 'Concluído';
                      if (col.id === 'unassigned') return !t.assignee && t.status !== 'Resolvido' && t.status !== 'Concluído';
                      return t.assignee === col.assignee && t.status !== 'Resolvido' && t.status !== 'Concluído';
                  })
                  .map(task => (
                    <div
                      key={task.id}
                      draggable
                      onDragStart={(e) => onDragStart(e, task.id)}
                      onClick={() => onEditTask(task)}
                      className="bg-slate-700 p-4 rounded-lg border border-slate-600 hover:border-indigo-500 hover:shadow-lg cursor-pointer active:cursor-grabbing group relative overflow-hidden transition-all"
                    >
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${
                          task.type === 'Incidente' ? 'bg-rose-500' : task.type === 'Melhoria' ? 'bg-emerald-500' : 'bg-indigo-500'
                      }`}></div>

                      <div className="flex justify-between items-start mb-2 pl-2">
                        <span className="text-[10px] text-slate-400 font-mono tracking-wide uppercase">{task.id}</span>
                        <Badge type={task.priority} />
                      </div>
                      
                      <h4 className="text-sm font-medium text-slate-100 mb-3 pl-2 line-clamp-3">{task.summary}</h4>
                      
                      <div className="flex justify-between items-center pl-2 mt-auto">
                          <Badge type={task.type} />
                          {task.estimatedTime && (
                              <div className="flex items-center gap-1 text-xs text-slate-400 bg-slate-800 px-2 py-1 rounded">
                                  <IconClock /> {task.estimatedTime}
                              </div>
                          )}
                      </div>
                    </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

// --- List View ---

const ListView = ({ tasks, setTasks, devs, onEditTask }: { tasks: Task[], setTasks: any, devs: Developer[], onEditTask: (task: Task) => void }) => {
  const [filters, setFilters] = useState({ search: '', type: 'All', priority: 'All', status: 'All' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  
  const filtered = tasks.filter(t => {
      const matchesSearch = t.summary.toLowerCase().includes(filters.search.toLowerCase()) ||
                            t.id.toLowerCase().includes(filters.search.toLowerCase()) ||
                            (t.requester && t.requester.toLowerCase().includes(filters.search.toLowerCase()));
      const matchesType = filters.type === 'All' || t.type === filters.type;
      const matchesPriority = filters.priority === 'All' || t.priority === filters.priority;
      const matchesStatus = filters.status === 'All' || t.status === filters.status;
      return matchesSearch && matchesType && matchesPriority && matchesStatus;
  });

  const toggleSelect = (id: string) => {
      const newSelected = new Set(selected);
      if (newSelected.has(id)) newSelected.delete(id);
      else newSelected.add(id);
      setSelected(newSelected);
  };

  const handleBulkAction = (action: string, payload?: any) => {
      if (selected.size === 0) return;
      const updated = tasks.map(t => {
          if (selected.has(t.id)) {
              if (action === 'delete') return null;
              if (action === 'status') return { ...t, status: payload };
              if (action === 'priority') return { ...t, priority: payload };
              if (action === 'assign') return { ...t, assignee: payload };
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
      <FilterBar filters={filters} setFilters={setFilters} />

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

const Layout = ({ children, user, onLogout }: any) => {
  const navigate = useNavigate();
  const location = useLocation();

  const menuItems = [
    { path: '/', icon: <IconHome />, label: 'Dashboard' },
    { path: '/kanban', icon: <IconKanban />, label: 'Kanban' },
    { path: '/list', icon: <IconList />, label: 'Lista' },
    { path: '/gantt', icon: <IconClock />, label: 'Gantt' },
  ];

  return (
    <div className="flex h-screen bg-dark-900 text-slate-200 font-sans">
      <aside className="w-64 bg-slate-800/50 backdrop-blur-lg border-r border-slate-700 flex flex-col z-20">
        <div className="p-6 border-b border-slate-700 flex items-center gap-3">
          <div className="w-8 h-8 bg-gradient-to-tr from-indigo-500 to-emerald-500 rounded-lg shadow-lg shadow-indigo-500/50"></div>
          <h1 className="text-xl font-bold tracking-tight text-white">Nexus</h1>
        </div>
        <nav className="flex-1 p-4 space-y-2 mt-4">
          {menuItems.map(item => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-300 group ${
                location.pathname === item.path 
                  ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50' 
                  : 'text-slate-400 hover:bg-slate-700/50 hover:text-white'
              }`}
            >
              {item.icon}
              <span className="font-medium">{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="p-4 border-t border-slate-700 bg-slate-900/30">
            <div 
              onClick={() => navigate('/profile')}
              className="flex items-center gap-3 mb-4 cursor-pointer hover:bg-slate-800 p-2 rounded-lg transition-colors"
            >
                <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-sm font-bold text-indigo-300 border border-slate-600 overflow-hidden">
                    {user.avatar ? (
                        <img src={user.avatar} alt="avatar" className="w-full h-full object-cover" />
                    ) : (
                        user.name.substring(0, 2).toUpperCase()
                    )}
                </div>
                <div className="overflow-hidden">
                    <p className="text-sm font-medium text-white truncate">{user.name}</p>
                    <p className="text-xs text-slate-500 truncate">{user.email}</p>
                </div>
            </div>
            <Button variant="danger" onClick={onLogout} className="w-full justify-center text-xs py-2">Sair</Button>
        </div>
      </aside>
      <main className="flex-1 overflow-hidden relative flex flex-col">
         <div className="absolute inset-0 bg-gradient-to-br from-indigo-900/10 via-dark-900 to-emerald-900/10 pointer-events-none" />
         <div className="flex-1 overflow-auto p-6 lg:p-10 z-10 relative">
             {children}
         </div>
      </main>
    </div>
  );
};

// --- Authentication Page ---

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

const TaskModal = ({ task, developers, onClose, onSave, onDelete }: any) => {
    const [formData, setFormData] = useState<Task>(task || {
        id: `TASK-${Date.now()}`,
        type: 'Incidente',
        summary: '',
        description: '',
        priority: '3 - Moderada',
        status: 'Novo',
        assignee: null,
        estimatedTime: '',
        actualTime: '',
        startDate: '',
        endDate: ''
    });

    const handleChange = (e: any) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-slate-800 rounded-2xl border border-slate-700 w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
                <div className="p-6 border-b border-slate-700 flex justify-between items-center">
                    <h3 className="text-xl font-bold text-white">Editar Demanda</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
                </div>
                <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar">
                    <div>
                        <label className="block text-xs text-slate-400 mb-1">Título / Resumo</label>
                        <input name="summary" value={formData.summary} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-3 text-white focus:ring-2 focus:ring-indigo-500 outline-none" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                         <div>
                            <label className="block text-xs text-slate-400 mb-1">Tipo</label>
                            <select name="type" value={formData.type} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none">
                                <option value="Incidente">Incidente</option>
                                <option value="Melhoria">Melhoria</option>
                                <option value="Nova Automação">Nova Automação</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs text-slate-400 mb-1">Prioridade</label>
                            <select name="priority" value={formData.priority} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none">
                                <option value="1 - Crítica">1 - Crítica</option>
                                <option value="2 - Alta">2 - Alta</option>
                                <option value="3 - Moderada">3 - Moderada</option>
                                <option value="4 - Baixa">4 - Baixa</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                             <label className="block text-xs text-slate-400 mb-1">Desenvolvedor</label>
                             <select name="assignee" value={formData.assignee || ''} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none">
                                <option value="">Sem Atribuição</option>
                                {developers.map((d: any) => <option key={d.id} value={d.name}>{d.name}</option>)}
                            </select>
                        </div>
                        <div>
                             <label className="block text-xs text-slate-400 mb-1">Status</label>
                             <select name="status" value={formData.status} onChange={handleChange} className="w-full bg-slate-900 border border-slate-600 rounded-lg p-2 text-slate-300 outline-none">
                                <option value="Novo">Novo</option>
                                <option value="Pendente">Pendente</option>
                                <option value="Em Atendimento">Em Atendimento</option>
                                <option value="Resolvido">Resolvido</option>
                            </select>
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4 bg-slate-900/50 p-4 rounded-lg border border-slate-700">
                        <div>
                             <label className="block text-xs text-slate-400 mb-1">Data Início</label>
                             <input type="date" name="startDate" value={formData.startDate || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300" />
                        </div>
                         <div>
                             <label className="block text-xs text-slate-400 mb-1">Data Fim</label>
                             <input type="date" name="endDate" value={formData.endDate || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300" />
                        </div>
                        <div>
                             <label className="block text-xs text-slate-400 mb-1">Tempo Estimado</label>
                             <input name="estimatedTime" value={formData.estimatedTime || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300" placeholder="ex: 2h" />
                        </div>
                        <div>
                             <label className="block text-xs text-slate-400 mb-1">Tempo Real</label>
                             <input name="actualTime" value={formData.actualTime || ''} onChange={handleChange} className="w-full bg-slate-800 border border-slate-600 rounded p-2 text-slate-300" placeholder="ex: 2h" />
                        </div>
                    </div>
                </div>
                <div className="p-6 border-t border-slate-700 flex justify-between">
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

  const handleProcessUpload = async () => {
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

        const merged = StorageService.mergeTasks(allNewTasks);
        setTasks(merged);

        const uniqueAssignees = new Set(allNewTasks.map(t => t.assignee).filter(Boolean));
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

        setIsUploadModalOpen(false);
        alert(`${allNewTasks.length} demandas processadas.`);
     } catch (e) {
         console.error(e);
         alert("Erro ao processar arquivos.");
     }
  };

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

  const handleTaskUpdate = (updatedTask: Task) => {
      const newTasks = tasks.map(t => t.id === updatedTask.id ? updatedTask : t);
      setTasks(newTasks);
      StorageService.saveTasks(newTasks);
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

  if (!user) return <AuthPage onLogin={handleLogin} />;

  return (
    <HashRouter>
      <Layout user={user} onLogout={handleLogout}>
        {/* Header Actions - Only visible on dashboard pages */}
        <div className="absolute top-6 right-10 flex gap-3 z-20 pointer-events-none">
            <div className="pointer-events-auto flex gap-3">
                <Button onClick={() => setIsManageDevsOpen(true)} variant="secondary" className="text-xs py-1.5"><IconUsers /> Devs</Button>
                <Button onClick={() => setIsUploadModalOpen(true)} className="text-xs py-1.5"><IconUpload /> Upload</Button>
            </div>
        </div>

        {/* Modals */}
        {isUploadModalOpen && (
             <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
                 <div className="bg-slate-800 p-8 rounded-2xl border border-slate-600 max-w-lg w-full shadow-2xl">
                     <h3 className="text-xl font-bold mb-6 text-white">Importar Planilhas</h3>
                     <div className="space-y-4">
                         {['Incidente', 'Melhoria', 'Nova Automação'].map(type => (
                             <div key={type}>
                                 <label className="block text-sm text-slate-400 mb-1">{type}</label>
                                 <input 
                                    type="file" 
                                    accept=".xlsx, .xls"
                                    onChange={(e) => setUploadFiles({...uploadFiles, [type]: e.target.files?.[0] || null})} 
                                    className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-slate-700 file:text-white hover:file:bg-slate-600 cursor-pointer border border-slate-600 rounded-lg"
                                 />
                             </div>
                         ))}
                     </div>
                     <div className="mt-8 flex justify-end gap-3">
                         <Button variant="secondary" onClick={() => setIsUploadModalOpen(false)}>Cancelar</Button>
                         <Button onClick={handleProcessUpload}>Processar Tudo</Button>
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
                onClose={() => setEditingTask(null)} 
                onSave={handleTaskUpdate}
                onDelete={handleTaskDelete}
            />
        )}

        <Routes>
          <Route path="/" element={<DashboardView tasks={tasks} devs={devs} />} />
          <Route path="/kanban" element={<KanbanView tasks={tasks} setTasks={setTasks} devs={devs} onEditTask={setEditingTask} />} />
          <Route path="/list" element={<ListView tasks={tasks} setTasks={setTasks} devs={devs} onEditTask={setEditingTask} />} />
          <Route path="/gantt" element={<GanttView tasks={tasks} />} />
          <Route path="/profile" element={<UserProfile user={user} setUser={setUser} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </Layout>
    </HashRouter>
  );
}
