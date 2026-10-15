import React, { useState, useMemo } from 'react';
import { Task, User, AppNotification, formatCivilDate } from '../types';
import { NotificationService } from '../services/notificationService';
import { IconBell, IconCalendar, IconClock, IconAlertCircle, IconCheck, IconX } from './Icons';

interface NotificationCenterProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: Task[];
  user: User;
  onEditTask?: (task: Task) => void;
  readNotificationIds: Set<string>;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
}

export const NotificationCenter: React.FC<NotificationCenterProps> = ({
  isOpen,
  onClose,
  tasks,
  user,
  onEditTask,
  readNotificationIds,
  onMarkAsRead,
  onMarkAllAsRead
}) => {
  const [filterCategory, setFilterCategory] = useState<'all' | 'schedule' | 'deadline' | 'overdue'>('all');
  const [onlyMine, setOnlyMine] = useState<boolean>(false);
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | 'unsupported'>(() => {
    return NotificationService.getBrowserNotificationPermission();
  });

  // Calculate all active notifications
  const allNotifications = useMemo(() => {
    return NotificationService.calculateNotifications(tasks, readNotificationIds);
  }, [tasks, readNotificationIds]);

  // Filter based on user assignment (mine vs team)
  const userFiltered = useMemo(() => {
    if (!onlyMine) return allNotifications;
    const userName = (user?.name || '').trim().toLowerCase();
    const userEmail = (user?.email || '').trim().toLowerCase();

    return allNotifications.filter(n => {
      const assignee = (n.task.assignee || '').trim().toLowerCase();
      if (!assignee) return false;
      return assignee.includes(userName) || (userEmail && assignee.includes(userEmail));
    });
  }, [allNotifications, onlyMine, user]);

  // Filter based on selected category tab
  const displayedNotifications = useMemo(() => {
    return userFiltered.filter(n => {
      if (filterCategory === 'all') return true;
      if (filterCategory === 'schedule') return n.isSchedule || n.category === 'SCHEDULE_TODAY' || n.category === 'SCHEDULE_UPCOMING';
      if (filterCategory === 'deadline') return n.category === 'DEADLINE_TODAY' || n.category === 'DEADLINE_TOMORROW' || n.category === 'DEADLINE_APPROACHING';
      if (filterCategory === 'overdue') return n.category === 'OVERDUE';
      return true;
    });
  }, [userFiltered, filterCategory]);

  // Statistics counters
  const stats = useMemo(() => {
    const todaySchedules = userFiltered.filter(n => n.category === 'SCHEDULE_TODAY').length;
    const todayDeadlines = userFiltered.filter(n => n.category === 'DEADLINE_TODAY').length;
    const approachingDeadlines = userFiltered.filter(n => n.category === 'DEADLINE_TOMORROW' || n.category === 'DEADLINE_APPROACHING').length;
    const overdues = userFiltered.filter(n => n.category === 'OVERDUE').length;
    const unreadCount = userFiltered.filter(n => !n.isRead).length;

    return {
      todaySchedules,
      todayDeadlines,
      approachingDeadlines,
      overdues,
      unreadCount,
      total: userFiltered.length
    };
  }, [userFiltered]);

  const handleEnableBrowserNotifications = async () => {
    const res = await NotificationService.requestBrowserPermission();
    setBrowserPermission(res);
    if (res === 'granted') {
      NotificationService.sendBrowserNotification('Nexus Project - Notificações Ativas', {
        body: `Você tem ${stats.todaySchedules} agendamentos para hoje e ${stats.todayDeadlines + stats.approachingDeadlines} demandas com prazo próximo.`
      });
    }
  };

  const handleItemClick = (task: Task) => {
    if (onEditTask) {
      onEditTask(task);
    }
    onClose();
  };

  if (!isOpen) return null;

  const todayFormatted = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  }).format(new Date());

  return (
    <div className="fixed inset-0 z-[120] flex items-start justify-end p-2 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
      <div 
        className="w-full max-w-xl bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl flex flex-col max-h-[94vh] overflow-hidden animate-slide-in relative"
        role="dialog"
        aria-label="Central de Notificações"
      >
        {/* Header */}
        <div className="p-4 sm:p-5 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-indigo-600/20 border border-indigo-500/40 text-indigo-400 flex items-center justify-center relative">
              <IconBell className="w-5 h-5" />
              {stats.unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-5 h-5 bg-rose-500 text-white font-bold text-[10px] rounded-full flex items-center justify-center shadow-lg border-2 border-slate-900 animate-pulse">
                  {stats.unreadCount > 9 ? '9+' : stats.unreadCount}
                </span>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base sm:text-lg font-bold text-white">Central de Notificações & Prazos</h3>
                {stats.unreadCount > 0 && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-950/80 text-rose-300 border border-rose-600/40 font-semibold">
                    {stats.unreadCount} não lida{stats.unreadCount === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 capitalize mt-0.5">
                {todayFormatted}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
              title="Fechar notificações"
            >
              <IconX className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Quick KPI Pillars for Today & Deadlines */}
        <div className="p-3.5 bg-slate-900/60 border-b border-slate-800 grid grid-cols-3 gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setFilterCategory('schedule')}
            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
              filterCategory === 'schedule'
                ? 'bg-amber-950/60 border-amber-500/60 text-amber-300 ring-1 ring-amber-500/30'
                : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 text-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-amber-400">Agendamentos</span>
              <IconCalendar className="w-3.5 h-3.5 text-amber-400" />
            </div>
            <div className="text-lg font-bold text-white mt-0.5">{stats.todaySchedules}</div>
            <div className="text-[10px] text-slate-400">programados para hoje</div>
          </button>

          <button
            type="button"
            onClick={() => setFilterCategory('deadline')}
            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
              filterCategory === 'deadline'
                ? 'bg-indigo-950/60 border-indigo-500/60 text-indigo-300 ring-1 ring-indigo-500/30'
                : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 text-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-indigo-400">Prazos Próximos</span>
              <IconClock className="w-3.5 h-3.5 text-indigo-400" />
            </div>
            <div className="text-lg font-bold text-white mt-0.5">{stats.todayDeadlines + stats.approachingDeadlines}</div>
            <div className="text-[10px] text-slate-400">
              {stats.todayDeadlines > 0 ? `${stats.todayDeadlines} hoje / ${stats.approachingDeadlines} em breve` : 'vencendo nos prox. 3 dias'}
            </div>
          </button>

          <button
            type="button"
            onClick={() => setFilterCategory('overdue')}
            className={`p-2.5 rounded-xl border text-left transition-all cursor-pointer ${
              filterCategory === 'overdue'
                ? 'bg-rose-950/60 border-rose-500/60 text-rose-300 ring-1 ring-rose-500/30'
                : 'bg-slate-800/40 border-slate-800 hover:border-slate-700 text-slate-300'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold tracking-wider text-rose-400">Atrasadas</span>
              <IconAlertCircle className="w-3.5 h-3.5 text-rose-400" />
            </div>
            <div className="text-lg font-bold text-white mt-0.5">{stats.overdues}</div>
            <div className="text-[10px] text-slate-400">prazo já expirado</div>
          </button>
        </div>

        {/* Toolbar: Scope Switcher (Mine vs All) & Filter Tabs */}
        <div className="p-3 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
          {/* Filter Categories */}
          <div className="flex items-center gap-1 overflow-x-auto custom-scrollbar">
            <button
              type="button"
              onClick={() => setFilterCategory('all')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer ${
                filterCategory === 'all'
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              Todos ({userFiltered.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('schedule')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                filterCategory === 'schedule'
                  ? 'bg-amber-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>📅 Agendamentos ({stats.todaySchedules})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('deadline')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                filterCategory === 'deadline'
                  ? 'bg-indigo-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>⏰ Prazos ({stats.todayDeadlines + stats.approachingDeadlines})</span>
            </button>
            <button
              type="button"
              onClick={() => setFilterCategory('overdue')}
              className={`px-2.5 py-1 text-xs rounded-lg font-medium transition-colors cursor-pointer flex items-center gap-1 ${
                filterCategory === 'overdue'
                  ? 'bg-rose-600 text-white font-semibold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <span>🚨 Atrasadas ({stats.overdues})</span>
            </button>
          </div>

          {/* Scope Toggle: Minhas vs Toda a Equipe */}
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg bg-slate-800 p-0.5 border border-slate-700/80">
              <button
                type="button"
                onClick={() => setOnlyMine(false)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                  !onlyMine ? 'bg-indigo-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Equipe
              </button>
              <button
                type="button"
                onClick={() => setOnlyMine(true)}
                className={`px-2 py-0.5 text-[11px] font-medium rounded-md transition-colors cursor-pointer ${
                  onlyMine ? 'bg-indigo-600 text-white font-bold shadow-sm' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Mostrar apenas demandas atribuídas a mim"
              >
                Minhas
              </button>
            </div>

            {stats.unreadCount > 0 && (
              <button
                type="button"
                onClick={onMarkAllAsRead}
                className="text-[11px] text-slate-400 hover:text-indigo-400 font-medium underline transition-colors cursor-pointer whitespace-nowrap"
                title="Marcar todos estes avisos como lidos"
              >
                Marcar lidas
              </button>
            )}
          </div>
        </div>

        {/* Notifications Scrollable List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 custom-scrollbar">
          {displayedNotifications.length === 0 ? (
            <div className="text-center py-12 px-4 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-950/60 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-inner">
                <IconCheck className="w-6 h-6 stroke-[2.5]" />
              </div>
              <h4 className="text-sm sm:text-base font-bold text-white">
                {filterCategory === 'schedule'
                  ? 'Nenhum agendamento programado para hoje'
                  : filterCategory === 'deadline'
                  ? 'Nenhuma demanda com prazo expirando em breve'
                  : filterCategory === 'overdue'
                  ? 'Parabéns! Nenhuma demanda com prazo atrasado'
                  : 'Tudo em dia! Sem alertas pendentes no momento'}
              </h4>
              <p className="text-xs text-slate-400 max-w-sm mx-auto leading-relaxed">
                {onlyMine 
                  ? 'Você não possui demandas com prazos críticos ou agendamentos agendados para hoje sob sua responsabilidade.'
                  : 'Todas as demandas e agendamentos estão dentro do cronograma esperado.'}
              </p>
            </div>
          ) : (
            displayedNotifications.map(item => {
              const isOverdue = item.category === 'OVERDUE';
              const isToday = item.category === 'DEADLINE_TODAY' || item.category === 'SCHEDULE_TODAY';
              const isTomorrow = item.category === 'DEADLINE_TOMORROW' || item.category === 'SCHEDULE_UPCOMING';

              return (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-xl border transition-all flex flex-col gap-2 relative group hover:shadow-lg ${
                    item.isRead 
                      ? 'bg-slate-900/40 border-slate-800/80 opacity-75 hover:opacity-100'
                      : isOverdue
                      ? 'bg-gradient-to-r from-rose-950/50 via-slate-900 to-slate-900 border-rose-500/50 shadow-sm shadow-rose-950/20'
                      : isToday && item.isSchedule
                      ? 'bg-gradient-to-r from-amber-950/50 via-slate-900 to-slate-900 border-amber-500/50 shadow-sm shadow-amber-950/20'
                      : isToday
                      ? 'bg-gradient-to-r from-rose-950/50 via-slate-900 to-slate-900 border-rose-500/60'
                      : isTomorrow
                      ? 'bg-gradient-to-r from-amber-950/30 via-slate-900 to-slate-900 border-amber-500/40'
                      : 'bg-slate-850/80 border-slate-700/80 hover:border-indigo-500/50'
                  }`}
                >
                  {/* Top row: Badges and Dismiss Action */}
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {/* Urgency Badge */}
                      {isOverdue && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse">
                          <span>🚨</span> ATRASADA ({Math.abs(item.diffDays)} {Math.abs(item.diffDays) === 1 ? 'dia' : 'dias'})
                        </span>
                      )}
                      {item.category === 'DEADLINE_TODAY' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1 animate-pulse">
                          <span>⏰</span> VENCE HOJE!
                        </span>
                      )}
                      {item.category === 'SCHEDULE_TODAY' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1 animate-pulse">
                          <span>📅</span> AGENDADO PARA HOJE
                        </span>
                      )}
                      {item.category === 'DEADLINE_TOMORROW' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                          <span>⏳</span> Vence Amanhã
                        </span>
                      )}
                      {item.category === 'SCHEDULE_UPCOMING' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-sky-500/15 text-sky-300 border border-sky-500/30">
                          <span>📅</span> Agendado para Amanhã
                        </span>
                      )}
                      {item.category === 'DEADLINE_APPROACHING' && (
                        <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                          <span>⏱️</span> Vence em {item.diffDays} dias
                        </span>
                      )}

                      {/* Task Type Badge */}
                      <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                        item.task.type === 'Agendamento de Execução'
                          ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                          : item.task.type === 'Incidente'
                          ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                          : item.task.type === 'Melhoria'
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                          : 'bg-indigo-500/10 border-indigo-500/30 text-indigo-300'
                      }`}>
                        {item.task.type}
                      </span>

                      {/* Status Badge */}
                      <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-800 text-slate-300 border border-slate-700 font-mono">
                        {item.task.status}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {!item.isRead ? (
                        <button
                          type="button"
                          onClick={() => onMarkAsRead(item.id)}
                          className="text-[10px] text-slate-400 hover:text-white px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors cursor-pointer"
                          title="Marcar como lida"
                        >
                          Dispensar
                        </button>
                      ) : (
                        <span className="text-[10px] text-slate-500 font-medium">Lida</span>
                      )}
                    </div>
                  </div>

                  {/* Middle row: Task Title & Subtitle */}
                  <div>
                    <h5 
                      onClick={() => handleItemClick(item.task)}
                      className="text-xs sm:text-sm font-bold text-white hover:text-indigo-400 transition-colors cursor-pointer leading-snug"
                    >
                      {item.title}
                    </h5>
                    <p className="text-[11px] text-slate-300 mt-1 flex items-center gap-1.5 flex-wrap">
                      <span className="text-slate-400">{item.subtitle}</span>
                      {item.task.automationName && (
                        <span className="text-indigo-300 font-semibold">• Robô: {item.task.automationName}</span>
                      )}
                      {item.task.hasCost && (
                        <span className="text-amber-300 font-mono font-semibold">
                          • {item.task.dispatchCount || 0} envios (R$ {Number(item.task.costValue || 0).toFixed(2)})
                        </span>
                      )}
                    </p>
                  </div>

                  {/* Bottom row: Meta & Action */}
                  <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[11px]">
                    <div className="flex items-center gap-3 text-slate-400">
                      <span>
                        👤 <strong className="text-slate-200">{item.task.assignee || 'Sem responsável'}</strong>
                      </span>
                      {item.dateStr && (
                        <span>
                          📅 {formatCivilDate(item.dateStr, { includeYear: true })}
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleItemClick(item.task)}
                      className="px-2.5 py-1 bg-indigo-600/30 hover:bg-indigo-600 border border-indigo-500/40 text-indigo-200 hover:text-white rounded-lg text-xs font-semibold transition-all cursor-pointer shadow-sm flex items-center gap-1"
                    >
                      <span>Abrir Demanda</span>
                      <span>→</span>
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer with Browser Notifications Toggle & Summary */}
        <div className="p-3 sm:p-4 border-t border-slate-800 bg-slate-950/90 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <div className="flex items-center gap-2">
            {browserPermission === 'granted' ? (
              <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-400 bg-emerald-950/60 border border-emerald-500/40 px-2.5 py-1 rounded-lg">
                <IconCheck className="w-3.5 h-3.5" />
                <span>Notificações no navegador ativas</span>
              </span>
            ) : browserPermission === 'unsupported' ? (
              <span className="text-[11px] text-slate-500">Notificações no navegador não suportadas neste ambiente</span>
            ) : (
              <button
                type="button"
                onClick={handleEnableBrowserNotifications}
                className="inline-flex items-center gap-1.5 text-[11px] text-indigo-300 hover:text-white bg-indigo-950/70 hover:bg-indigo-900/80 border border-indigo-500/40 px-2.5 py-1 rounded-lg font-medium transition-colors cursor-pointer"
                title="Receber avisos no desktop quando prazos e agendamentos forem atingidos"
              >
                <span>🔔 Ativar Notificações no Navegador</span>
              </button>
            )}
          </div>

          <div className="text-[11px] text-slate-400">
            Total de <strong className="text-slate-200">{stats.total}</strong> alerta{stats.total === 1 ? '' : 's'} monitorados
          </div>
        </div>
      </div>
    </div>
  );
};
