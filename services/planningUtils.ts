export interface PlanningConfig {
  hoursPerDay: number;
  workingDays: number[]; // 0 = Sunday ... 6 = Saturday (default: Mon-Fri [1,2,3,4,5])
  holidays: string[];    // YYYY-MM-DD
}

export const DEFAULT_PLANNING_CONFIG: PlanningConfig = {
  hoursPerDay: 8,
  workingDays: [1, 2, 3, 4, 5],
  holidays: []
};

export interface CivilDateParts {
  year: number;
  month: number; // 1-12
  day: number;   // 1-31
  iso: string;   // YYYY-MM-DD
  utcMs: number; // Date.UTC(year, month - 1, day)
  dayOfWeek: number; // 0-6 (UTC)
}

export type PlanningDriver = 'dates' | 'hours';

export interface PlanningFieldState {
  startDate?: string;
  endDate?: string;
  estimatedTime?: string;
  actualTime?: string;
}

export interface PlanningCalculationResult {
  hours: number;
  businessDays: number;
  valid: boolean;
  error?: string;
}

export interface EndDateCalculationResult {
  endDate: string | null;
  businessDays: number;
  valid: boolean;
  error?: string;
}

export interface PlanningChangeOutcome {
  nextState: PlanningFieldState;
  driver?: PlanningDriver;
  errors: {
    startDate?: string;
    endDate?: string;
    estimatedTime?: string;
    actualTime?: string;
  };
  notice?: {
    type: 'info' | 'warning';
    message: string;
  } | null;
}

export interface TaskPlanningMetrics {
  businessDays: number;
  estimatedHours: number;
  actualHours: number;
  isOverdue: boolean;
}

const MS_PER_DAY = 86_400_000;

export function roundPlanningHours(hours: number): number {
  if (!Number.isFinite(hours) || hours <= 0) return 0;
  return Math.round(hours * 100) / 100;
}

export function formatHoursAsDuration(hours: number): string {
  const rounded = roundPlanningHours(hours);
  if (rounded <= 0) return '';
  return `${Number(rounded.toFixed(2))}h`;
}

export function normalizePlanningConfig(config?: Partial<PlanningConfig>): PlanningConfig {
  const hoursPerDay =
    typeof config?.hoursPerDay === 'number' && Number.isFinite(config.hoursPerDay) && config.hoursPerDay > 0
      ? config.hoursPerDay
      : DEFAULT_PLANNING_CONFIG.hoursPerDay;

  const validWorkingDays = Array.isArray(config?.workingDays)
    ? Array.from(new Set(config.workingDays.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6)))
    : [];

  const workingDays = validWorkingDays.length > 0 ? validWorkingDays : [...DEFAULT_PLANNING_CONFIG.workingDays];

  const holidays = Array.isArray(config?.holidays)
    ? config.holidays
        .map((h) => parseCivilDateStrict(h)?.iso)
        .filter((h): h is string => Boolean(h))
    : [];

  return { hoursPerDay, workingDays, holidays };
}

export function parseCivilDateStrict(dateStr?: string | null): CivilDateParts | null {
  if (!dateStr) return null;
  const clean = String(dateStr).split('T')[0].trim();
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const utcMs = Date.UTC(year, month - 1, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    iso: `${match[1]}-${match[2]}-${match[3]}`,
    utcMs,
    dayOfWeek: check.getUTCDay()
  };
}

export function formatUtcMsAsIso(utcMs: number): string {
  const d = new Date(utcMs);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function addCalendarDaysIso(dateStr: string, deltaDays: number): string | null {
  const parsed = parseCivilDateStrict(dateStr);
  if (!parsed || !Number.isFinite(deltaDays)) return null;
  return formatUtcMsAsIso(parsed.utcMs + Math.trunc(deltaDays) * MS_PER_DAY);
}

export function isBusinessDay(dateStr: string, config?: Partial<PlanningConfig>): boolean {
  const parsed = parseCivilDateStrict(dateStr);
  if (!parsed) return false;
  const cfg = normalizePlanningConfig(config);
  if (!cfg.workingDays.includes(parsed.dayOfWeek)) return false;
  if (cfg.holidays.includes(parsed.iso)) return false;
  return true;
}

export function countBusinessDaysBetween(
  startDate?: string | null,
  endDate?: string | null,
  config?: Partial<PlanningConfig>
): { businessDays: number; valid: boolean; error?: string } {
  const start = parseCivilDateStrict(startDate);
  const end = parseCivilDateStrict(endDate);

  if (!start || !end) {
    return {
      businessDays: 0,
      valid: false,
      error: 'Datas inválidas. Informe datas válidas no formato DD/MM/AAAA.'
    };
  }

  if (end.utcMs < start.utcMs) {
    return {
      businessDays: 0,
      valid: false,
      error: 'A data final (prevista) não pode ser anterior à data de início.'
    };
  }

  const cfg = normalizePlanningConfig(config);
  const holidaySet = new Set(cfg.holidays);
  let count = 0;

  for (let ms = start.utcMs; ms <= end.utcMs; ms += MS_PER_DAY) {
    const d = new Date(ms);
    if (!cfg.workingDays.includes(d.getUTCDay())) continue;
    if (holidaySet.size > 0 && holidaySet.has(formatUtcMsAsIso(ms))) continue;
    count++;
  }

  return { businessDays: count, valid: true };
}

export function calculateBusinessHoursBetween(
  startDate?: string | null,
  endDate?: string | null,
  config?: Partial<PlanningConfig>
): PlanningCalculationResult {
  const cfg = normalizePlanningConfig(config);
  const dayRes = countBusinessDaysBetween(startDate, endDate, cfg);
  if (!dayRes.valid) {
    return { hours: 0, businessDays: 0, valid: false, error: dayRes.error };
  }
  return {
    hours: roundPlanningHours(dayRes.businessDays * cfg.hoursPerDay),
    businessDays: dayRes.businessDays,
    valid: true
  };
}

export function calculateEndDateFromHours(
  startDate?: string | null,
  estimatedHours?: number | null,
  config?: Partial<PlanningConfig>
): EndDateCalculationResult {
  const start = parseCivilDateStrict(startDate);
  if (!start) {
    return {
      endDate: null,
      businessDays: 0,
      valid: false,
      error: 'Informe uma Data de Início válida para calcular a Data Fim prevista.'
    };
  }

  if (estimatedHours === undefined || estimatedHours === null || !Number.isFinite(estimatedHours)) {
    return {
      endDate: null,
      businessDays: 0,
      valid: false,
      error: 'Tempo estimado inválido.'
    };
  }

  if (estimatedHours < 0) {
    return {
      endDate: null,
      businessDays: 0,
      valid: false,
      error: 'O tempo estimado não pode ser negativo.'
    };
  }

  if (estimatedHours === 0) {
    return {
      endDate: null,
      businessDays: 0,
      valid: true
    };
  }

  const cfg = normalizePlanningConfig(config);
  const holidaySet = new Set(cfg.holidays);
  const requiredBusinessDays = Math.max(1, Math.ceil((estimatedHours - 1e-9) / cfg.hoursPerDay));

  let counted = 0;
  let cursorMs = start.utcMs;
  // Guard against misconfigured workingDays/holidays exhausting all days
  const maxIterations = Math.max(requiredBusinessDays * 10 + 366, 3650);

  for (let i = 0; i < maxIterations; i++) {
    const d = new Date(cursorMs);
    const isWorkday = cfg.workingDays.includes(d.getUTCDay());
    const iso = formatUtcMsAsIso(cursorMs);
    if (isWorkday && !holidaySet.has(iso)) {
      counted++;
      if (counted === requiredBusinessDays) {
        return {
          endDate: iso,
          businessDays: requiredBusinessDays,
          valid: true
        };
      }
    }
    cursorMs += MS_PER_DAY;
  }

  return {
    endDate: null,
    businessDays: 0,
    valid: false,
    error: 'Não foi possível calcular a data fim com os parâmetros de dias úteis configurados.'
  };
}

export function parsePlanningDurationInput(rawValue?: string | number | null): {
  hours: number;
  valid: boolean;
  empty: boolean;
  error?: string;
} {
  if (rawValue === undefined || rawValue === null) {
    return { hours: 0, valid: true, empty: true };
  }
  if (typeof rawValue === 'number') {
    if (!Number.isFinite(rawValue)) return { hours: 0, valid: false, empty: false, error: 'Valor numérico inválido.' };
    if (rawValue < 0) return { hours: 0, valid: false, empty: false, error: 'O valor de horas não pode ser negativo.' };
    return { hours: roundPlanningHours(rawValue), valid: true, empty: rawValue === 0 };
  }

  const raw = String(rawValue).trim().toLowerCase().replace(',', '.');
  if (!raw) return { hours: 0, valid: true, empty: true };
  if (raw.startsWith('-')) {
    return { hours: 0, valid: false, empty: false, error: 'O valor de horas não pode ser negativo.' };
  }
  if (raw === '0') {
    return { hours: 0, valid: true, empty: false };
  }

  const hhmm = raw.match(/^(\d{1,3}):([0-5]\d)$/);
  if (hhmm) {
    const h = parseInt(hhmm[1], 10);
    const m = parseInt(hhmm[2], 10);
    return { hours: roundPlanningHours(h + m / 60), valid: true, empty: false };
  }

  const match = raw.match(/^(\d+(\.\d+)?)\s*(h|hrs|hr|horas?|d|dias?|w|sem|semanas?|m|min|minutos?)?$/);
  if (!match) {
    return {
      hours: 0,
      valid: false,
      empty: false,
      error: 'Formato inválido. Use horas decimais ou inteiras (ex: 8h, 12.5h, 2d ou 02:30).'
    };
  }

  const num = parseFloat(match[1]);
  const unit = match[3] || 'h';
  if (!Number.isFinite(num) || num < 0) {
    return { hours: 0, valid: false, empty: false, error: 'O valor de horas não pode ser negativo.' };
  }

  if (unit.startsWith('d')) return { hours: roundPlanningHours(num * 8), valid: true, empty: false };
  if (unit.startsWith('w') || unit.startsWith('sem')) return { hours: roundPlanningHours(num * 40), valid: true, empty: false };
  if (unit === 'm' || unit.startsWith('min')) return { hours: roundPlanningHours(num / 60), valid: true, empty: false };
  return { hours: roundPlanningHours(num), valid: true, empty: false };
}

/**
 * Deterministic, single-pass bidirectional planning transition.
 * Guarantees no circular loops and never mutates actualTime from date/estimate edits.
 */
export function applyPlanningFieldChange(
  currentState: PlanningFieldState,
  changedField: keyof PlanningFieldState,
  newValue: string,
  config?: Partial<PlanningConfig>,
  currentDriver?: PlanningDriver
): PlanningChangeOutcome {
  const cfg = normalizePlanningConfig(config);
  const nextState: PlanningFieldState = { ...currentState, [changedField]: newValue };
  const errors: PlanningChangeOutcome['errors'] = {};
  let notice: PlanningChangeOutcome['notice'] = null;
  let driver = currentDriver;

  // Scenario C: Actual Time never alters startDate, endDate, or estimatedTime
  if (changedField === 'actualTime') {
    const parsedActual = parsePlanningDurationInput(newValue);
    if (!parsedActual.valid) {
      errors.actualTime = parsedActual.error || 'Tempo real inválido.';
      notice = { type: 'warning', message: errors.actualTime };
    } else {
      notice = parsedActual.hours > 0
        ? { type: 'info', message: `Tempo real (${formatHoursAsDuration(parsedActual.hours)}) atualizado sem alterar prazo ou estimativa.` }
        : null;
    }
    return { nextState, driver, errors, notice };
  }

  // Normalize comma decimal if user typed "12,5h" or "12,5"
  if (changedField === 'estimatedTime') {
    driver = 'hours';
    const parsedEst = parsePlanningDurationInput(newValue);
    if (!parsedEst.valid) {
      errors.estimatedTime = parsedEst.error || 'Tempo estimado inválido.';
      notice = { type: 'warning', message: errors.estimatedTime };
      return { nextState, driver, errors, notice };
    }

    if (parsedEst.empty || parsedEst.hours === 0) {
      return { nextState, driver, errors, notice: null };
    }

    if (!nextState.startDate || !String(nextState.startDate).trim()) {
      notice = {
        type: 'info',
        message: `Informe a Data de Início para calcular automaticamente a Data Fim prevista (${cfg.hoursPerDay}h/dia útil).`
      };
      return { nextState, driver, errors, notice };
    }

    const endRes = calculateEndDateFromHours(nextState.startDate, parsedEst.hours, cfg);
    if (!endRes.valid) {
      errors.startDate = endRes.error;
      notice = { type: 'warning', message: endRes.error || 'Não foi possível calcular a Data Fim.' };
      return { nextState, driver, errors, notice };
    }

    if (endRes.endDate) {
      nextState.endDate = endRes.endDate;
      notice = {
        type: 'info',
        message: `Prazo calculado: ${endRes.businessDays} dia(s) útil(eis) (${cfg.hoursPerDay}h/dia).`
      };
    }
    return { nextState, driver, errors, notice };
  }

  if (changedField === 'endDate') {
    driver = 'dates';
    const endRaw = String(newValue || '').trim();
    if (!endRaw) {
      return { nextState, driver, errors, notice: null };
    }
    if (!parseCivilDateStrict(endRaw)) {
      errors.endDate = 'Data de fim inválida.';
      notice = { type: 'warning', message: errors.endDate };
      return { nextState, driver, errors, notice };
    }

    const startRaw = String(nextState.startDate || '').trim();
    if (!startRaw) {
      notice = {
        type: 'info',
        message: 'Informe a Data de Início para calcular as horas úteis automaticamente.'
      };
      return { nextState, driver, errors, notice };
    }

    const calc = calculateBusinessHoursBetween(startRaw, endRaw, cfg);
    if (!calc.valid) {
      errors.endDate = calc.error;
      notice = { type: 'warning', message: calc.error || 'Intervalo de datas inválido.' };
      return { nextState, driver, errors, notice };
    }

    nextState.estimatedTime = calc.hours > 0 ? formatHoursAsDuration(calc.hours) : '0h';
    notice = {
      type: 'info',
      message: `${calc.businessDays} dia(s) útil(eis) × ${cfg.hoursPerDay}h/dia = ${nextState.estimatedTime} estimadas.`
    };
    return { nextState, driver, errors, notice };
  }

  // changedField === 'startDate'
  const startRaw = String(newValue || '').trim();
  if (!startRaw) {
    return { nextState, driver, errors, notice: null };
  }
  if (!parseCivilDateStrict(startRaw)) {
    errors.startDate = 'Data de início inválida.';
    notice = { type: 'warning', message: errors.startDate };
    return { nextState, driver, errors, notice };
  }

  const endRaw = String(nextState.endDate || '').trim();
  const estParsed = parsePlanningDurationInput(nextState.estimatedTime);

  // If user is planning by hours (driver === 'hours' or only estimatedTime is set without endDate), compute endDate
  if ((driver === 'hours' || (!endRaw && estParsed.valid && estParsed.hours > 0)) && estParsed.valid && estParsed.hours > 0) {
    const endRes = calculateEndDateFromHours(startRaw, estParsed.hours, cfg);
    if (endRes.valid && endRes.endDate) {
      nextState.endDate = endRes.endDate;
      notice = {
        type: 'info',
        message: `Data Fim recalculada para ${endRes.businessDays} dia(s) útil(eis) (${cfg.hoursPerDay}h/dia).`
      };
    } else if (!endRes.valid) {
      errors.startDate = endRes.error;
      notice = { type: 'warning', message: endRes.error || 'Não foi possível calcular a Data Fim.' };
    }
    return { nextState, driver: 'hours', errors, notice };
  }

  // If endDate is filled (planning by dates), recalculate estimatedTime from startDate..endDate
  if (endRaw) {
    const calc = calculateBusinessHoursBetween(startRaw, endRaw, cfg);
    if (!calc.valid) {
      errors.endDate = calc.error;
      notice = { type: 'warning', message: calc.error || 'A data final não pode ser anterior à data de início.' };
      return { nextState, driver: 'dates', errors, notice };
    }
    nextState.estimatedTime = calc.hours > 0 ? formatHoursAsDuration(calc.hours) : '0h';
    notice = {
      type: 'info',
      message: `${calc.businessDays} dia(s) útil(eis) × ${cfg.hoursPerDay}h/dia = ${nextState.estimatedTime} estimadas.`
    };
    return { nextState, driver: 'dates', errors, notice };
  }

  return { nextState, driver, errors, notice };
}

function isTerminalStatusLabel(status?: string | null): boolean {
  if (!status) return false;
  const s = status.trim().toLowerCase();
  return [
    'concluído',
    'concluido',
    'conclído',
    'resolvido',
    'resolvida',
    'fechado',
    'fechada',
    'encerrado',
    'encerrada',
    'finalizado',
    'finalizada',
    'closed',
    'resolved',
    'completed',
    'done',
    'cancelado',
    'cancelada',
    'cancelled',
    'canceled'
  ].includes(s);
}

export function isTaskOverdue(
  task: { endDate?: string | null; status?: string | null },
  todayIso?: string
): boolean {
  if (isTerminalStatusLabel(task.status)) return false;
  const end = parseCivilDateStrict(task.endDate);
  if (!end) return false;

  let refIso = todayIso ? parseCivilDateStrict(todayIso)?.iso : undefined;
  if (!refIso) {
    const now = new Date();
    refIso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }
  return end.iso < refIso;
}

export function getTaskPlanningMetrics(
  task: {
    startDate?: string | null;
    endDate?: string | null;
    estimatedTime?: string | null;
    actualTime?: string | null;
    status?: string | null;
  },
  todayIso?: string,
  config?: Partial<PlanningConfig>
): TaskPlanningMetrics {
  const daysRes =
    task.startDate && task.endDate
      ? countBusinessDaysBetween(task.startDate, task.endDate, config)
      : { businessDays: 0, valid: false };

  const estParsed = parsePlanningDurationInput(task.estimatedTime);
  const actParsed = parsePlanningDurationInput(task.actualTime);

  return {
    businessDays: daysRes.valid ? daysRes.businessDays : 0,
    estimatedHours: estParsed.valid ? estParsed.hours : 0,
    actualHours: actParsed.valid ? actParsed.hours : 0,
    isOverdue: isTaskOverdue(task, todayIso)
  };
}
