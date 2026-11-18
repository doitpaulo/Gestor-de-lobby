import { DevOpsConfig, Sprint, Task, isTerminalStatus } from '../types';

const PT_MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const MONTH_INDEX_MAP: Record<string, number> = {
  jan: 0,
  fev: 1,
  feb: 1,
  mar: 2,
  abr: 3,
  apr: 3,
  mai: 4,
  may: 4,
  jun: 5,
  jul: 6,
  ago: 7,
  aug: 7,
  set: 8,
  sep: 8,
  out: 9,
  oct: 9,
  nov: 10,
  dez: 11,
  dec: 11
};

export interface ParsedDevOpsSprint {
  fullPath: string;
  projectPrefix: string;
  sprintLeaf: string;
}

export function normalizeIterationPath(raw?: string | null): string {
  if (!raw) return '';
  return String(raw)
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\{2,}/g, '\\')
    .replace(/^\\+|\\+$/g, '')
    .trim();
}

export function extractDevOpsProjectPrefix(
  devOpsContext?: Partial<DevOpsConfig> | string | null
): string {
  if (!devOpsContext) return '';
  if (typeof devOpsContext === 'string') {
    const clean = normalizeIterationPath(devOpsContext);
    if (!clean) return '';
    if (clean.includes('\\')) {
      return clean.split('\\')[0].trim();
    }
    return clean;
  }
  const explicitProject = String(devOpsContext.project || '').trim();
  if (explicitProject) return explicitProject;

  const defaultIter = normalizeIterationPath(devOpsContext.defaultIterationPath);
  if (defaultIter.includes('\\')) {
    return defaultIter.split('\\')[0].trim();
  }
  return '';
}

export function parseDevOpsSprintParts(pathOrName?: string | null): ParsedDevOpsSprint {
  const fullPath = normalizeIterationPath(pathOrName);
  if (!fullPath) {
    return { fullPath: '', projectPrefix: '', sprintLeaf: '' };
  }
  const parts = fullPath.split('\\').filter(Boolean);
  if (parts.length <= 1) {
    return { fullPath, projectPrefix: '', sprintLeaf: fullPath };
  }
  return {
    fullPath,
    projectPrefix: parts[0],
    sprintLeaf: parts.slice(1).join('\\')
  };
}

function toIsoDate(year: number, monthIndex0: number, day: number): string {
  const y = String(year).padStart(4, '0');
  const m = String(monthIndex0 + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function getLastDayOfMonth(year: number, monthIndex0: number): number {
  return new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
}

function getBiweeklyWindowForDate(date: Date): { startDate: string; endDate: string } {
  const year = date.getFullYear();
  const monthIdx = date.getMonth();
  const day = date.getDate();
  if (day <= 15) {
    return {
      startDate: toIsoDate(year, monthIdx, 1),
      endDate: toIsoDate(year, monthIdx, 15)
    };
  }
  return {
    startDate: toIsoDate(year, monthIdx, 16),
    endDate: toIsoDate(year, monthIdx, getLastDayOfMonth(year, monthIdx))
  };
}

/**
 * Formats a sprint name using Azure DevOps biweekly convention:
 *   - Days 1..15  -> "{Project}\\Sprint Semana 1 e 2 - Mmm-AAAA"
 *   - Days 16..31 -> "{Project}\\Sprint Semana 3 e 4 - Mmm-AAAA"
 * When no DevOps project prefix is configured, omits the leading "{Project}\\".
 */
export function formatDevOpsSprintName(
  dateStr?: string | null,
  devOpsContext?: Partial<DevOpsConfig> | string | null
): string {
  if (!dateStr) return '';
  const cleanDate = String(dateStr).split('T')[0].trim();
  const date = new Date(`${cleanDate}T12:00:00`);
  if (isNaN(date.getTime())) return '';

  const day = date.getDate();
  const weekBand = day <= 15 ? '1 e 2' : '3 e 4';
  const month = PT_MONTHS[date.getMonth()];
  const year = date.getFullYear();
  const leaf = `Sprint Semana ${weekBand} - ${month}-${year}`;

  const projectPrefix = extractDevOpsProjectPrefix(devOpsContext);
  return projectPrefix ? `${projectPrefix}\\${leaf}` : leaf;
}

/**
 * Derives startDate and endDate from a DevOps sprint name like:
 *   "Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026" -> { startDate: "2026-11-16", endDate: "2026-11-30" }
 *   "Hyperautomation\\Sprint Semana 1 e 2 - Nov-2026" -> { startDate: "2026-11-01", endDate: "2026-11-15" }
 */
export function deriveDatesFromDevOpsSprintName(
  name?: string | null,
  fallbackDateIso?: string
): { startDate: string; endDate: string } {
  const { sprintLeaf } = parseDevOpsSprintParts(name);
  const targetText = sprintLeaf || normalizeIterationPath(name);

  // Match biweekly: "Sprint Semana 1 e 2 - Nov-2026" or "Sprint Semana 3 e 4 - Nov-2026"
  const biweeklyMatch = targetText.match(
    /Sprint\s+Semana\s+(1\s*(?:e|a|-)\s*2|3\s*(?:e|a|-)\s*4(?:\s*e\s*5)?)\s*[-/]\s*([A-Za-z]{3})[-/\s]+(\d{4})/i
  );
  if (biweeklyMatch) {
    const bandRaw = biweeklyMatch[1].replace(/\s+/g, '');
    const monthKey = biweeklyMatch[2].toLowerCase();
    const year = parseInt(biweeklyMatch[3], 10);
    const monthIdx = MONTH_INDEX_MAP[monthKey];
    if (monthIdx !== undefined && year >= 2000 && year <= 2100) {
      const isFirstHalf = bandRaw.startsWith('1');
      return isFirstHalf
        ? { startDate: toIsoDate(year, monthIdx, 1), endDate: toIsoDate(year, monthIdx, 15) }
        : {
            startDate: toIsoDate(year, monthIdx, 16),
            endDate: toIsoDate(year, monthIdx, getLastDayOfMonth(year, monthIdx))
          };
    }
  }

  // Match single-week legacy format: "Sprint Semana 3 - Nov-2026"
  const singleWeekMatch = targetText.match(
    /Sprint\s+Semana\s+(\d)\s*[-/]\s*([A-Za-z]{3})[-/\s]+(\d{4})/i
  );
  if (singleWeekMatch) {
    const weekNum = parseInt(singleWeekMatch[1], 10);
    const monthKey = singleWeekMatch[2].toLowerCase();
    const year = parseInt(singleWeekMatch[3], 10);
    const monthIdx = MONTH_INDEX_MAP[monthKey];
    if (monthIdx !== undefined && year >= 2000 && year <= 2100) {
      return weekNum <= 2
        ? { startDate: toIsoDate(year, monthIdx, 1), endDate: toIsoDate(year, monthIdx, 15) }
        : {
            startDate: toIsoDate(year, monthIdx, 16),
            endDate: toIsoDate(year, monthIdx, getLastDayOfMonth(year, monthIdx))
          };
    }
  }

  const refDate =
    fallbackDateIso && !isNaN(new Date(`${fallbackDateIso}T12:00:00`).getTime())
      ? new Date(`${fallbackDateIso}T12:00:00`)
      : new Date();
  return getBiweeklyWindowForDate(refDate);
}

/**
 * Converts a legacy Nexus sprint name (e.g. "Sprint Semana 3 - Nov-2026" or "Sprint Semana 3 e 4 - Nov-2026")
 * into canonical Azure DevOps Iteration Path format (e.g. "Hyperautomation\\Sprint Semana 3 e 4 - Nov-2026").
 */
export function convertLegacySprintNameToDevOps(
  sprint: Pick<Sprint, 'name' | 'iterationPath' | 'startDate' | 'endDate'>,
  devOpsContext?: Partial<DevOpsConfig> | string | null
): string {
  const configuredPrefix = extractDevOpsProjectPrefix(devOpsContext);
  const currentRaw = normalizeIterationPath(sprint.iterationPath || sprint.name);
  if (!currentRaw) {
    return formatDevOpsSprintName(sprint.endDate || sprint.startDate, devOpsContext) || '';
  }

  const { projectPrefix, sprintLeaf } = parseDevOpsSprintParts(currentRaw);
  const effectivePrefix = projectPrefix || configuredPrefix;

  // Check if leaf is legacy single-week ("Sprint Semana 3 - Nov-2026")
  const singleWeekMatch = sprintLeaf.match(
    /^Sprint\s+Semana\s+(\d)\s*[-/]\s*([A-Za-z]{3})[-/\s]+(\d{4})$/i
  );
  if (singleWeekMatch) {
    const weekNum = parseInt(singleWeekMatch[1], 10);
    const band = weekNum <= 2 ? '1 e 2' : '3 e 4';
    const monthKey = singleWeekMatch[2].toLowerCase();
    const monthIdx = MONTH_INDEX_MAP[monthKey];
    const monthLabel = monthIdx !== undefined ? PT_MONTHS[monthIdx] : singleWeekMatch[2];
    const year = singleWeekMatch[3];
    const formattedLeaf = `Sprint Semana ${band} - ${monthLabel}-${year}`;
    return effectivePrefix ? `${effectivePrefix}\\${formattedLeaf}` : formattedLeaf;
  }

  // Already uses a DevOps path with backslash (or custom name); attach prefix if missing
  if (projectPrefix) {
    return `${projectPrefix}\\${sprintLeaf}`;
  }
  return effectivePrefix ? `${effectivePrefix}\\${sprintLeaf}` : sprintLeaf;
}

export function resolveInitialSprintStatus(
  startDate: string,
  endDate: string,
  todayIso?: string
): Sprint['status'] {
  const today =
    todayIso ||
    (() => {
      const now = new Date();
      return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
    })();

  if (endDate && endDate < today) return 'Concluída';
  if (startDate && startDate <= today && (!endDate || endDate >= today)) return 'Em Execução';
  return 'Planejada';
}

export function upsertDevOpsSprintInList(
  sprints: Sprint[],
  iterationPath: string,
  options?: {
    startDate?: string;
    endDate?: string;
    status?: Sprint['status'];
    goals?: string;
    todayIso?: string;
  }
): {
  nextSprints: Sprint[];
  sprint: Sprint | null;
  created: boolean;
  updated: boolean;
} {
  const cleanPath = normalizeIterationPath(iterationPath);
  if (!cleanPath) {
    return { nextSprints: sprints, sprint: null, created: false, updated: false };
  }

  const lowerClean = cleanPath.toLowerCase();
  const { sprintLeaf } = parseDevOpsSprintParts(cleanPath);
  const lowerLeaf = sprintLeaf.toLowerCase();

  // 1. Exact match on iterationPath or name
  let existingIndex = sprints.findIndex(
    (s) =>
      normalizeIterationPath(s.iterationPath).toLowerCase() === lowerClean ||
      normalizeIterationPath(s.name).toLowerCase() === lowerClean
  );

  // 2. Fallback match on unprefixed sprint with exact same leaf name (e.g. "Sprint Semana 3 e 4 - Nov-2026")
  if (existingIndex === -1 && lowerLeaf) {
    existingIndex = sprints.findIndex((s) => {
      const existingParts = parseDevOpsSprintParts(s.iterationPath || s.name);
      return !existingParts.projectPrefix && existingParts.sprintLeaf.toLowerCase() === lowerLeaf;
    });
  }

  if (existingIndex >= 0) {
    const existing = sprints[existingIndex];
    const derived = deriveDatesFromDevOpsSprintName(cleanPath, options?.todayIso);
    const nextStart = options?.startDate || existing.startDate || derived.startDate;
    const nextEnd = options?.endDate || existing.endDate || derived.endDate;
    const nextStatus = options?.status || existing.status;

    const needsUpdate =
      existing.name !== cleanPath ||
      existing.iterationPath !== cleanPath ||
      existing.startDate !== nextStart ||
      existing.endDate !== nextEnd ||
      existing.status !== nextStatus ||
      (options?.goals !== undefined && existing.goals !== options.goals);

    if (!needsUpdate) {
      return { nextSprints: sprints, sprint: existing, created: false, updated: false };
    }

    const updatedSprint: Sprint = {
      ...existing,
      name: cleanPath,
      iterationPath: cleanPath,
      startDate: nextStart,
      endDate: nextEnd,
      status: nextStatus,
      ...(options?.goals !== undefined ? { goals: options.goals } : {})
    };
    const nextSprints = sprints.map((s, idx) => (idx === existingIndex ? updatedSprint : s));
    return { nextSprints, sprint: updatedSprint, created: false, updated: true };
  }

  const derived = deriveDatesFromDevOpsSprintName(cleanPath, options?.todayIso);
  const startDate = options?.startDate || derived.startDate;
  const endDate = options?.endDate || derived.endDate;
  const status = options?.status || resolveInitialSprintStatus(startDate, endDate, options?.todayIso);

  const newSprint: Sprint = {
    id: `sprint-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    name: cleanPath,
    iterationPath: cleanPath,
    startDate,
    endDate,
    status,
    goals: options?.goals || '',
    tasks: []
  };

  return {
    nextSprints: [...sprints, newSprint],
    sprint: newSprint,
    created: true,
    updated: false
  };
}

export function collectRegisteredIterationPaths(
  devopsConfig?: Partial<DevOpsConfig> | null,
  sprints: Sprint[] = []
): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  const pushUnique = (raw?: string | null) => {
    const clean = normalizeIterationPath(raw);
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(clean);
    }
  };

  pushUnique(devopsConfig?.defaultIterationPath);
  if (Array.isArray(devopsConfig?.registeredIterationPaths)) {
    devopsConfig!.registeredIterationPaths.forEach((p) => pushUnique(p));
  }
  sprints.forEach((s) => {
    const path = s.iterationPath || s.name;
    if (path && path.includes('\\')) {
      pushUnique(path);
    }
  });

  return ordered;
}

export function isOpenTask(task: Pick<Task, 'status'>): boolean {
  return !isTerminalStatus(task.status);
}
