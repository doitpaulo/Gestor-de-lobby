import { Task, AppNotification, isTerminalStatus, getTodayCivilString, getDaysDifferenceFromToday, formatCivilDate } from '../types';

const STORAGE_PREFIX = 'nexus_read_notifications_';

export const NotificationService = {
  /**
   * Retrieves the set of notification IDs that the user has already acknowledged/read.
   */
  getReadNotificationIds(userId?: string): Set<string> {
    try {
      const key = `${STORAGE_PREFIX}${userId || 'default'}`;
      const saved = localStorage.getItem(key);
      if (saved) {
        const arr = JSON.parse(saved);
        if (Array.isArray(arr)) {
          return new Set<string>(arr);
        }
      }
    } catch (e) {
      console.warn('Failed to read notification IDs from localStorage', e);
    }
    return new Set<string>();
  },

  /**
   * Marks a specific notification as read.
   */
  markAsRead(notificationId: string, userId?: string): Set<string> {
    const current = this.getReadNotificationIds(userId);
    current.add(notificationId);
    try {
      const key = `${STORAGE_PREFIX}${userId || 'default'}`;
      localStorage.setItem(key, JSON.stringify(Array.from(current)));
    } catch (e) {
      console.warn('Failed to save read notification ID to localStorage', e);
    }
    return current;
  },

  /**
   * Marks all given notification IDs as read.
   */
  markAllAsRead(notificationIds: string[], userId?: string): Set<string> {
    const current = this.getReadNotificationIds(userId);
    notificationIds.forEach(id => current.add(id));
    try {
      const key = `${STORAGE_PREFIX}${userId || 'default'}`;
      localStorage.setItem(key, JSON.stringify(Array.from(current)));
    } catch (e) {
      console.warn('Failed to save read notification IDs to localStorage', e);
    }
    return current;
  },

  /**
   * Clears all marked read notifications.
   */
  clearReadHistory(userId?: string): void {
    try {
      const key = `${STORAGE_PREFIX}${userId || 'default'}`;
      localStorage.removeItem(key);
    } catch (e) {
      console.warn('Failed to clear read notifications', e);
    }
  },

  /**
   * Calculates all relevant active notifications from tasks:
   * 1. Execution schedulings programmed for today (or tomorrow/overdue)
   * 2. Tasks close to deadline (expiring today, tomorrow, or in 2-3 days)
   * 3. Overdue tasks (expired deadline)
   */
  calculateNotifications(tasks: Task[], readIds: Set<string> = new Set()): AppNotification[] {
    const notifications: AppNotification[] = [];
    const todayStr = getTodayCivilString();

    tasks.forEach(task => {
      // Ignore delivered/cancelled tasks
      if (isTerminalStatus(task.status)) return;

      const isScheduling = task.type === 'Agendamento de Execução';

      if (isScheduling) {
        // Evaluate scheduling date
        const targetDate = task.startDate || task.endDate;
        const diff = targetDate ? getDaysDifferenceFromToday(targetDate) : null;

        if (diff === 0 || (!targetDate && task.status !== 'Concluído')) {
          // Programmed for today!
          const notifId = `sched-today-${task.id}`;
          notifications.push({
            id: notifId,
            taskId: task.id,
            task,
            category: 'SCHEDULE_TODAY',
            severity: 'warning',
            title: task.summary || 'Agendamento de Execução',
            subtitle: targetDate 
              ? `Execução programada para HOJE (${formatCivilDate(targetDate, { includeYear: false })})`
              : 'Agendamento ativo sem data definida programado para execução hoje',
            dateStr: targetDate || todayStr,
            diffDays: 0,
            isSchedule: true,
            isRead: readIds.has(notifId)
          });
        } else if (diff === 1) {
          // Programmed for tomorrow
          const notifId = `sched-tmrw-${task.id}`;
          notifications.push({
            id: notifId,
            taskId: task.id,
            task,
            category: 'SCHEDULE_UPCOMING',
            severity: 'info',
            title: task.summary || 'Agendamento de Execução',
            subtitle: `Execução programada para amanhã (${formatCivilDate(targetDate, { includeYear: false })})`,
            dateStr: targetDate!,
            diffDays: 1,
            isSchedule: true,
            isRead: readIds.has(notifId)
          });
        } else if (diff !== null && diff < 0) {
          // Overdue scheduling
          const notifId = `sched-overdue-${task.id}`;
          notifications.push({
            id: notifId,
            taskId: task.id,
            task,
            category: 'OVERDUE',
            severity: 'danger',
            title: task.summary || 'Agendamento de Execução',
            subtitle: `Agendamento pendente atrasado há ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'dia' : 'dias'} (${formatCivilDate(targetDate, { includeYear: true })})`,
            dateStr: targetDate!,
            diffDays: diff,
            isSchedule: true,
            isRead: readIds.has(notifId)
          });
        }
      } else {
        // Standard demands (Melhoria, Nova Automação, Incidente, etc.)
        if (task.endDate) {
          const diff = getDaysDifferenceFromToday(task.endDate);
          if (diff !== null) {
            if (diff < 0) {
              // Overdue
              const notifId = `overdue-${task.id}`;
              notifications.push({
                id: notifId,
                taskId: task.id,
                task,
                category: 'OVERDUE',
                severity: 'danger',
                title: task.summary || 'Demanda Sem Título',
                subtitle: `Prazo expirado há ${Math.abs(diff)} ${Math.abs(diff) === 1 ? 'dia' : 'dias'} (${formatCivilDate(task.endDate, { includeYear: true })})`,
                dateStr: task.endDate,
                diffDays: diff,
                isSchedule: false,
                isRead: readIds.has(notifId)
              });
            } else if (diff === 0) {
              // Due today!
              const notifId = `due-today-${task.id}`;
              notifications.push({
                id: notifId,
                taskId: task.id,
                task,
                category: 'DEADLINE_TODAY',
                severity: 'danger',
                title: task.summary || 'Demanda Sem Título',
                subtitle: `Prazo final encerra HOJE! (${formatCivilDate(task.endDate, { includeYear: true })})`,
                dateStr: task.endDate,
                diffDays: 0,
                isSchedule: false,
                isRead: readIds.has(notifId)
              });
            } else if (diff === 1) {
              // Due tomorrow
              const notifId = `due-tomorrow-${task.id}`;
              notifications.push({
                id: notifId,
                taskId: task.id,
                task,
                category: 'DEADLINE_TOMORROW',
                severity: 'warning',
                title: task.summary || 'Demanda Sem Título',
                subtitle: `Prazo vence amanhã (${formatCivilDate(task.endDate, { includeYear: true })})`,
                dateStr: task.endDate,
                diffDays: 1,
                isSchedule: false,
                isRead: readIds.has(notifId)
              });
            } else if (diff >= 2 && diff <= 3) {
              // Approaching in 2-3 days
              const notifId = `due-soon-${task.id}`;
              notifications.push({
                id: notifId,
                taskId: task.id,
                task,
                category: 'DEADLINE_APPROACHING',
                severity: 'warning',
                title: task.summary || 'Demanda Sem Título',
                subtitle: `Prazo próximo: vence em ${diff} dias (${formatCivilDate(task.endDate, { includeYear: false })})`,
                dateStr: task.endDate,
                diffDays: diff,
                isSchedule: false,
                isRead: readIds.has(notifId)
              });
            }
          }
        }
      }
    });

    // Sort order:
    // 1. Unread first
    // 2. Scheduled for today & Deadline today at top
    // 3. Overdue tasks
    // 4. Upcoming deadlines
    return notifications.sort((a, b) => {
      if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;

      // Group urgency weights
      const getWeight = (n: AppNotification) => {
        if (n.category === 'DEADLINE_TODAY') return 1;
        if (n.category === 'SCHEDULE_TODAY') return 2;
        if (n.category === 'OVERDUE') return 3;
        if (n.category === 'DEADLINE_TOMORROW') return 4;
        if (n.category === 'SCHEDULE_UPCOMING') return 5;
        return 6;
      };

      const diffWeight = getWeight(a) - getWeight(b);
      if (diffWeight !== 0) return diffWeight;

      return a.diffDays - b.diffDays;
    });
  },

  /**
   * Browser Desktop Notifications API support
   */
  isBrowserNotificationSupported(): boolean {
    return typeof window !== 'undefined' && 'Notification' in window;
  },

  getBrowserNotificationPermission(): NotificationPermission | 'unsupported' {
    if (!this.isBrowserNotificationSupported()) return 'unsupported';
    return Notification.permission;
  },

  async requestBrowserPermission(): Promise<NotificationPermission | 'unsupported'> {
    if (!this.isBrowserNotificationSupported()) return 'unsupported';
    try {
      const result = await Notification.requestPermission();
      return result;
    } catch (e) {
      console.warn('Failed to request notification permission', e);
      return 'denied';
    }
  },

  sendBrowserNotification(title: string, options?: NotificationOptions): boolean {
    if (!this.isBrowserNotificationSupported()) return false;
    if (Notification.permission !== 'granted') return false;

    try {
      new Notification(title, {
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        ...options
      });
      return true;
    } catch (e) {
      console.warn('Failed to send browser notification', e);
      return false;
    }
  }
};
