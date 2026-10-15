import React, { useState } from 'react';
import { Task, User } from '../types';
import { NotificationService } from '../services/notificationService';
import { IconBell, IconCalendar, IconClock, IconAlertCircle } from './Icons';

interface TodayNotificationBannerProps {
  tasks: Task[];
  user?: User;
  onOpenNotificationCenter: () => void;
  onEditTask?: (task: Task) => void;
}

export const TodayNotificationBanner: React.FC<TodayNotificationBannerProps> = ({
  tasks,
  user,
  onOpenNotificationCenter,
  onEditTask
}) => {
  const [isDismissed, setIsDismissed] = useState(false);

  const notifications = React.useMemo(() => {
    return NotificationService.calculateNotifications(tasks);
  }, [tasks]);

  const todaySchedules = notifications.filter(n => n.category === 'SCHEDULE_TODAY');
  const todayDeadlines = notifications.filter(n => n.category === 'DEADLINE_TODAY');
  const overdues = notifications.filter(n => n.category === 'OVERDUE');
  const upcomingDeadlines = notifications.filter(n => n.category === 'DEADLINE_TOMORROW' || n.category === 'DEADLINE_APPROACHING');

  const totalUrgent = todaySchedules.length + todayDeadlines.length + overdues.length;
  const totalUpcoming = upcomingDeadlines.length;

  if (isDismissed || (totalUrgent === 0 && totalUpcoming === 0)) {
    return null;
  }

  const hasCritical = todayDeadlines.length > 0 || overdues.length > 0;
  const hasSchedule = todaySchedules.length > 0;

  return (
    <div className={`p-4 rounded-2xl border transition-all animate-fade-in shadow-xl flex flex-col md:flex-row items-start md:items-center justify-between gap-3 relative overflow-hidden ${
      hasCritical 
        ? 'bg-gradient-to-r from-rose-950/70 via-slate-900 to-amber-950/40 border-rose-500/50 shadow-rose-950/30'
        : hasSchedule
        ? 'bg-gradient-to-r from-amber-950/70 via-slate-900 to-indigo-950/40 border-amber-500/50 shadow-amber-950/30'
        : 'bg-gradient-to-r from-indigo-950/70 via-slate-900 to-slate-900 border-indigo-500/40 shadow-indigo-950/20'
    }`}>
      {/* Ambient background glow */}
      <div className={`absolute -right-10 -bottom-10 w-40 h-40 rounded-full blur-3xl pointer-events-none opacity-20 ${
        hasCritical ? 'bg-rose-500' : hasSchedule ? 'bg-amber-500' : 'bg-indigo-500'
      }`} />

      {/* Left info */}
      <div className="flex items-start gap-3 min-w-0 z-10">
        <div className={`p-2.5 rounded-xl border flex-shrink-0 mt-0.5 ${
          hasCritical
            ? 'bg-rose-600/20 text-rose-300 border-rose-500/40'
            : hasSchedule
            ? 'bg-amber-600/20 text-amber-300 border-amber-500/40'
            : 'bg-indigo-600/20 text-indigo-300 border-indigo-500/40'
        }`}>
          <IconBell className="w-5 h-5 animate-bounce" />
        </div>

        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-bold text-white flex items-center gap-1.5">
              <span>Lembrete Operacional do Dia</span>
            </h4>

            {hasSchedule && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40 flex items-center gap-1">
                <IconCalendar className="w-3 h-3" />
                {todaySchedules.length} agendamento{todaySchedules.length === 1 ? '' : 's'} hoje
              </span>
            )}

            {todayDeadlines.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 flex items-center gap-1">
                <IconClock className="w-3 h-3" />
                {todayDeadlines.length} vence{todayDeadlines.length === 1 ? '' : 'm'} hoje!
              </span>
            )}

            {overdues.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-600/30 text-rose-200 border border-rose-500/50 flex items-center gap-1">
                <IconAlertCircle className="w-3 h-3" />
                {overdues.length} atrasada{overdues.length === 1 ? '' : 's'}
              </span>
            )}

            {upcomingDeadlines.length > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-800 text-slate-300 border border-slate-700">
                {upcomingDeadlines.length} em breve (1-3 dias)
              </span>
            )}
          </div>

          <p className="text-xs text-slate-300 mt-1 line-clamp-1 leading-relaxed">
            {todaySchedules.length > 0 && (
              <span>
                Robôs programados para hoje: <strong className="text-white">{todaySchedules.map(s => s.task.automationName || s.title).slice(0, 3).join(', ')}{todaySchedules.length > 3 ? '...' : ''}</strong>.
              </span>
            )}
            {todayDeadlines.length > 0 && (
              <span className="ml-1 text-rose-200">
                Atenção ao prazo final de: <strong className="text-white">{todayDeadlines.map(d => d.title).slice(0, 2).join(', ')}</strong>.
              </span>
            )}
            {todaySchedules.length === 0 && todayDeadlines.length === 0 && overdues.length > 0 && (
              <span className="text-rose-200">
                Existem {overdues.length} demandas com prazos vencidos que requerem atualização ou conclusão imediata.
              </span>
            )}
            {todaySchedules.length === 0 && todayDeadlines.length === 0 && overdues.length === 0 && (
              <span className="text-indigo-200">
                Você possui {upcomingDeadlines.length} demandas com prazos vencendo nos próximos dias.
              </span>
            )}
          </p>
        </div>
      </div>

      {/* Right buttons */}
      <div className="flex items-center gap-2 self-end md:self-center shrink-0 z-10 w-full md:w-auto justify-end">
        <button
          type="button"
          onClick={onOpenNotificationCenter}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer hover:scale-105 active:scale-95 ${
            hasCritical
              ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-950/40'
              : hasSchedule
              ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-amber-950/40'
              : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-indigo-950/40'
          }`}
        >
          <IconBell className="w-3.5 h-3.5" />
          <span>Ver Lembretes & Detalhes ({notifications.length})</span>
        </button>

        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-slate-800/60 rounded-lg transition-colors cursor-pointer text-xs"
          title="Dispensar aviso por agora"
        >
          ✕
        </button>
      </div>
    </div>
  );
};
