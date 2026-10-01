import * as XLSX from 'xlsx';
import { 
  Task, TaskType, Priority, Robot, Developer,
  normalizeStatus, normalizeTaskType, HistoryEntry, SubTask, ProjectLifecycleData 
} from '../types';

export interface ExcelBackupParseResult {
  tasks: Task[];
  robots: Robot[];
  devs: Developer[];
  sheetNames: string[];
  stats: {
    tasksCount: number;
    incidentsCount: number;
    improvementsCount: number;
    automationsCount: number;
    devsCount: number;
    robotsCount: number;
  };
}

// Remove accents and trim lowercase for loose matching
const cleanKey = (key: string): string => {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

// Safe date string extractor (e.g. "2025-11-17" even if "2025-11-174" or ISO string or Excel serial number)
const extractSafeDate = (val: any): string | undefined => {
  if (val === undefined || val === null) return undefined;
  
  // Handle Excel serial date numbers (e.g. 45200)
  if (typeof val === 'number') {
    if (val > 30000 && val < 60000) {
      try {
        const dateObj = new Date(Math.round((val - 25569) * 86400 * 1000));
        if (!isNaN(dateObj.getTime())) {
          return dateObj.toISOString().split('T')[0];
        }
      } catch {}
    }
  }

  const str = String(val).trim();
  if (!str || str === '-' || str === 'N/A' || str === 'null' || str === 'undefined') return undefined;

  // Match YYYY-MM-DD
  const matchISO = str.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (matchISO) return matchISO[0];

  // Match DD/MM/YYYY
  const matchBR = str.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
  if (matchBR) {
    const day = matchBR[1].padStart(2, '0');
    const month = matchBR[2].padStart(2, '0');
    const year = matchBR[3];
    return `${year}-${month}-${day}`;
  }

  // Fallback if long date string
  try {
    const parsed = new Date(str);
    if (!isNaN(parsed.getTime()) && parsed.getFullYear() > 2000 && parsed.getFullYear() < 2100) {
      return parsed.toISOString().split('T')[0];
    }
  } catch {}

  return str.length >= 10 ? str.substring(0, 10) : undefined;
};

// Safe JSON parser helper
const safeJsonParse = <T = any>(val: any, fallback: T): T => {
  if (!val) return fallback;
  if (typeof val === 'object') return val;
  try {
    const trimmed = String(val).trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      return JSON.parse(trimmed);
    }
    return fallback;
  } catch {
    return fallback;
  }
};

// Flexible property finder that checks exact and normalized keys
const getRowVal = (row: any, aliases: string[]): any => {
  if (!row || typeof row !== 'object') return null;

  // 1. Exact match
  for (const alias of aliases) {
    if (row[alias] !== undefined && row[alias] !== null && String(row[alias]).trim() !== '') {
      return row[alias];
    }
  }

  // 2. Normalized alphanumeric match
  const rowNormalizedMap = new Map<string, string>();
  for (const k of Object.keys(row)) {
    rowNormalizedMap.set(cleanKey(k), k);
  }

  for (const alias of aliases) {
    const cleanedAlias = cleanKey(alias);
    const originalKey = rowNormalizedMap.get(cleanedAlias);
    if (originalKey) {
      const val = row[originalKey];
      if (val !== undefined && val !== null && String(val).trim() !== '') {
        return val;
      }
    }
  }

  // 3. Substring match
  for (const alias of aliases) {
    const cleanedAlias = cleanKey(alias);
    if (cleanedAlias.length < 3) continue;
    for (const [cKey, oKey] of rowNormalizedMap.entries()) {
      if (cKey.includes(cleanedAlias) || cleanedAlias.includes(cKey)) {
        const val = row[oKey];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return val;
        }
      }
    }
  }

  return null;
};

const mapRowToRobot = (row: any): Robot => {
  const name = getRowVal(row, ['NOME DO ROBÔ', 'Nome do Robô', 'Nome', 'Robô', 'Robo', 'Name', 'Nome da Automação', 'Automação']) || 'Robô RPA';
  const folder = getRowVal(row, ['PASTA QUE ESTÁ ARMAZENADO', 'Pasta', 'Folder', 'projectPath', 'Caminho', 'SharePoint']) || '';
  const status = String(getRowVal(row, ['SITUAÇÃO', 'Situacao', 'Status', 'Estado']) || 'ATIVO').toUpperCase();
  const developer = getRowVal(row, ['DESENVOLVEDOR', 'Desenvolvedor', 'assignee', 'Responsável', 'Dev', 'Autor']) || 'N/A';
  const owners = getRowVal(row, ['OWNERS', 'Owners', 'requester', 'Solicitante', 'Owner', 'Responsável Negócio']) || 'N/A';
  const area = getRowVal(row, ['ÁREA', 'Area', 'Gerência', 'Gerencia', 'managementArea', 'Departamento']) || 'N/A';
  
  const fteRaw = getRowVal(row, ['FTE', 'fte', 'fteValue', 'Valor FTE']);
  const fte = fteRaw ? parseFloat(String(fteRaw).replace(',', '.')) || 0 : 0;
  
  const ticketNumber = String(getRowVal(row, ['NÚMERO DO CHAMADO', 'CHAMADO', 'Ticket', 'ticketNumber', 'id', 'Número']) || '');

  return {
    id: `rpa-${Date.now()}-${Math.floor(Math.random() * 100000)}`,
    name: String(name).trim(),
    folder: String(folder).trim(),
    status: status.includes('DES') || status.includes('INAT') ? 'DESATIVO' : 'ATIVO',
    developer: String(developer).trim(),
    owners: String(owners).trim(),
    area: String(area).trim(),
    fte,
    ticketNumber
  };
};

const mapRowToTask = (row: any, defaultType?: TaskType, indexFallback = 0): Task => {
  // ID
  const idRaw = getRowVal(row, [
    'id', 'ID', 'Número', 'Numero', 'Numero do Chamado', 'Chamado', 'Ticket', 'Number',
    'Nº', 'No', 'Cod', 'Codigo', 'Demanda'
  ]);
  const id = idRaw ? String(idRaw).trim() : `TASK-${Date.now()}-${indexFallback}`;

  // Summary / Description
  const summaryRaw = getRowVal(row, [
    'summary', 'Descrição resumida', 'Descricao resumida', 'Resumo', 'Projeto', 'Summary',
    'Short Description', 'Título', 'Titulo', 'Assunto', 'Nome', 'Nome da Demanda', 'Tarefa',
    'Descrição', 'Descricao', 'Demanda'
  ]);
  const summary = summaryRaw ? String(summaryRaw).trim() : `Demanda ${id}`;

  // Status
  const statusRaw = getRowVal(row, [
    'status', 'Status', 'Status Global', 'Estado', 'State', 'Situação', 'Situacao', 'Fase Atual'
  ]) || 'Novo';
  const status = normalizeStatus(String(statusRaw));

  // Assignee / Responsável
  const assigneeRaw = getRowVal(row, [
    'assignee', 'Atribuído a', 'Atribuido a', 'Assigned to', 'Responsável', 'Responsavel',
    'Desenvolvedor', 'Dev', 'Analista', 'Técnico', 'Tecnico'
  ]);
  let assignee: string | null = assigneeRaw && String(assigneeRaw).trim().length > 0 ? String(assigneeRaw).trim() : null;
  if (assignee && ['n/a', '-', 'none', 'null', 'não atribuído', 'nao atribuido', 'sem dev'].includes(assignee.toLowerCase())) {
    assignee = null;
  }

  // Requester / Solicitante
  const requesterRaw = getRowVal(row, [
    'requester', 'Criado por', 'Solicitante', 'Requester', 'Caller', 'Opened by', 'Autor', 'Emissor', 'Aberto por'
  ]) || 'Sistema';
  const requester = String(requesterRaw).trim();

  // Created At
  const createdRaw = getRowVal(row, [
    'createdAt', 'Criação de', 'Criação em', 'Criado em', 'Created', 'Opened', 'Data Abertura', 'Abertura'
  ]);
  const createdAt = extractSafeDate(createdRaw) || new Date().toISOString();

  // Category & Subcategory
  const category = String(getRowVal(row, ['category', 'Categoria', 'Area', 'Área', 'Gerência']) || '').trim();
  const subcategory = String(getRowVal(row, ['subcategory', 'Subcategoria', 'Sub-categoria']) || '').trim();

  // Priority
  const rawPriority = getRowVal(row, ['priority', 'Prioridade', 'Priority', 'Criticidade', 'Urgência', 'Urgencia']) || '4 - Baixa';
  let priority: Priority = '4 - Baixa';
  const pLower = String(rawPriority).toLowerCase();
  if (pLower.includes('1') || pLower.includes('crítica') || pLower.includes('critica')) priority = '1 - Crítica';
  else if (pLower.includes('2') || pLower.includes('alta')) priority = '2 - Alta';
  else if (pLower.includes('3') || pLower.includes('moderada') || pLower.includes('média') || pLower.includes('media')) priority = '3 - Moderada';
  else if (pLower.includes('4') || pLower.includes('baixa')) priority = '4 - Baixa';

  // Determine Type
  const rawTypeCol = getRowVal(row, [
    'type', 'Tipo', 'Tipo de Demanda', 'Tipo de Tarefa', 'Task Type', 'Classificação', 'Classification', 'Natureza'
  ]);
  let explicitType: TaskType | null = null;
  if (rawTypeCol) {
    const et = String(rawTypeCol).toLowerCase().trim();
    if (et.includes('melhoria') || et.includes('enhancement') || et.includes('feature')) explicitType = 'Melhoria';
    else if (et.includes('auto') || et.includes('rpa') || et.includes('bot') || et.includes('robo')) explicitType = 'Nova Automação';
    else if (et.includes('incid') || et.includes('bug') || et.includes('defeito') || et.includes('erro')) explicitType = 'Incidente';
  }

  let type: TaskType = explicitType || defaultType || 'Incidente';
  if (!explicitType && !defaultType) {
    const idLower = String(id).toLowerCase().trim();
    if (idLower.startsWith('inc')) {
      type = 'Incidente';
    } else if (idLower.startsWith('ritm') || idLower.startsWith('req')) {
      type = 'Nova Automação';
    } else {
      const textToScan = `${summary} ${subcategory} ${category}`.toLowerCase();
      if (textToScan.includes('melhoria')) type = 'Melhoria';
      else if (textToScan.includes('automação') || textToScan.includes('automacao') || textToScan.includes('rpa') || textToScan.includes('bot')) type = 'Nova Automação';
      else type = 'Incidente';
    }
  }

  // Dates
  const startDateRaw = getRowVal(row, ['startDate', 'Data Início', 'Data Inicio', 'Inicio', 'Dt Inicio', 'Start Date']);
  const endDateRaw = getRowVal(row, ['endDate', 'Data Fim', 'Data Fim Prevista', 'Fim', 'Dt Fim', 'End Date', 'Conclusão']);
  const startDate = extractSafeDate(startDateRaw);
  const endDate = extractSafeDate(endDateRaw);

  // Time metrics
  const estimatedTimeRaw = getRowVal(row, ['estimatedTime', 'Tempo Estimado', 'Horas Estimadas', 'Estimativa', 'Est']);
  const actualTimeRaw = getRowVal(row, ['actualTime', 'Tempo Real', 'Horas Reais', 'Realizado', 'Act']);
  const estimatedTime = estimatedTimeRaw !== null && estimatedTimeRaw !== undefined ? String(estimatedTimeRaw).trim() : undefined;
  const actualTime = actualTimeRaw !== null && actualTimeRaw !== undefined ? String(actualTimeRaw).trim() : undefined;

  // Automation / RPA details
  const automationName = getRowVal(row, ['automationName', 'Nome da Automação', 'Nome da Automacao', 'Robô', 'Robo', 'Bot']);
  const managementArea = getRowVal(row, ['managementArea', 'Gerência', 'Gerencia', 'Área', 'Area', 'Departamento']);
  const projectPath = getRowVal(row, ['projectPath', 'Link SharePoint', 'SharePoint', 'Caminho Projeto', 'Pasta']);
  const blocker = getRowVal(row, ['blocker', 'Bloqueio', 'Motivo Bloqueio', 'Pendência', 'Pendencia', 'Impedimento']);
  const description = getRowVal(row, ['description', 'Descrição', 'Descricao', 'Detalhes', 'Observações', 'Observacoes']);

  // FTE Value
  const fteRaw = getRowVal(row, ['fteValue', 'FTE', 'Valor FTE', 'fte', 'Economia FTE']);
  let fteValue: number | undefined = undefined;
  if (fteRaw !== null && fteRaw !== undefined) {
    const parsedFte = parseFloat(String(fteRaw).replace(',', '.'));
    if (!isNaN(parsedFte)) fteValue = parsedFte;
  }

  // Board position
  const boardPosRaw = getRowVal(row, ['boardPosition', 'Posição Kanban', 'Posicao Kanban', 'Ordem']);
  let boardPosition: number | undefined = undefined;
  if (boardPosRaw !== null && boardPosRaw !== undefined) {
    const num = parseInt(String(boardPosRaw), 10);
    if (!isNaN(num)) boardPosition = num;
  }

  // Complex JSON or object fields
  const historyRaw = getRowVal(row, ['history', 'Histórico', 'Historico']);
  let history: HistoryEntry[] | undefined = undefined;
  if (historyRaw) {
    const parsedH = safeJsonParse<HistoryEntry[] | null>(historyRaw, null);
    if (Array.isArray(parsedH)) history = parsedH;
  }

  const projectDataRaw = getRowVal(row, ['projectData', 'Dados do Projeto', 'Fase', 'Ciclo de Vida']);
  let projectData: ProjectLifecycleData | undefined = undefined;
  if (projectDataRaw) {
    const parsedPD = safeJsonParse<ProjectLifecycleData | null>(projectDataRaw, null);
    if (parsedPD && typeof parsedPD === 'object') projectData = parsedPD;
  }

  const docStatusesRaw = getRowVal(row, ['docStatuses', 'Status Documentos', 'Esteira Documental']);
  let docStatuses: Record<string, 'Pendente' | 'Em andamento' | 'Concluído'> | undefined = undefined;
  if (docStatusesRaw) {
    const parsedDocs = safeJsonParse<Record<string, any> | null>(docStatusesRaw, null);
    if (parsedDocs && typeof parsedDocs === 'object') docStatuses = parsedDocs;
  }

  const subTasksRaw = getRowVal(row, ['subTasks', 'Subtarefas', 'Checklist']);
  let subTasks: SubTask[] | undefined = undefined;
  if (subTasksRaw) {
    const parsedST = safeJsonParse<SubTask[] | null>(subTasksRaw, null);
    if (Array.isArray(parsedST)) subTasks = parsedST;
  }

  // DevOps IDs
  const devopsUserStoryId = getRowVal(row, ['devopsUserStoryId', 'User Story ID', 'ID User Story', 'DevOps Story']);
  const devopsFeatureId = getRowVal(row, ['devopsFeatureId', 'Feature ID', 'ID Feature', 'DevOps Feature']);

  return {
    id,
    type: normalizeTaskType(type),
    summary,
    requester,
    assignee,
    priority,
    status,
    createdAt: String(createdAt),
    category,
    subcategory,
    description: description ? String(description).trim() : undefined,
    startDate,
    endDate,
    estimatedTime,
    actualTime,
    automationName: automationName ? String(automationName).trim() : undefined,
    managementArea: managementArea ? String(managementArea).trim() : undefined,
    projectPath: projectPath ? String(projectPath).trim() : undefined,
    blocker: blocker ? String(blocker).trim() : undefined,
    fteValue,
    boardPosition,
    history,
    projectData,
    docStatuses,
    subTasks,
    devopsUserStoryId: devopsUserStoryId ? String(devopsUserStoryId).trim() : undefined,
    devopsFeatureId: devopsFeatureId ? String(devopsFeatureId).trim() : undefined
  };
};

// Extracts JSON rows from a worksheet, auto-detecting the header row if preceded by titles/blank rows
const extractRowsWithHeaderDetection = (worksheet: XLSX.WorkSheet): any[] => {
  // First attempt: standard sheet_to_json
  const rawRows = XLSX.utils.sheet_to_json(worksheet, { raw: false, defval: '' }) as any[];
  if (!rawRows || rawRows.length === 0) return [];

  // Check if first row has recognizable column names
  const sampleRow = rawRows[0];
  const sampleKeys = Object.keys(sampleRow).map(cleanKey);
  const knownTokens = ['id', 'numero', 'chamado', 'ticket', 'resumo', 'summary', 'descricao', 'tipo', 'type', 'status', 'responsavel', 'assignee', 'prioridade'];
  const hasGoodHeaders = sampleKeys.some(k => knownTokens.some(t => k.includes(t)));

  if (hasGoodHeaders) {
    return rawRows;
  }

  // If first row looks bad (e.g. __EMPTY columns or title banner), inspect 2D array to find header row
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false }) as any[][];
  if (!matrix || matrix.length < 2) return rawRows;

  let bestHeaderRowIndex = 0;
  let maxScore = 0;

  // Scan first 10 rows
  const maxScan = Math.min(matrix.length, 10);
  for (let r = 0; r < maxScan; r++) {
    const row = matrix[r];
    if (!Array.isArray(row)) continue;
    let score = 0;
    row.forEach(cell => {
      const cellClean = cleanKey(String(cell || ''));
      if (knownTokens.some(t => cellClean.includes(t))) {
        score++;
      }
    });
    if (score > maxScore) {
      maxScore = score;
      bestHeaderRowIndex = r;
    }
  }

  if (maxScore > 0 && bestHeaderRowIndex > 0) {
    // Re-parse with the detected header row
    const headers = matrix[bestHeaderRowIndex].map(h => String(h || '').trim());
    const dataRows = matrix.slice(bestHeaderRowIndex + 1);
    const result: any[] = [];
    dataRows.forEach(rowArr => {
      if (!Array.isArray(rowArr) || rowArr.every(c => c === '' || c === undefined || c === null)) return;
      const obj: any = {};
      headers.forEach((h, colIdx) => {
        if (h && colIdx < rowArr.length) {
          obj[h] = rowArr[colIdx];
        }
      });
      result.push(obj);
    });
    return result;
  }

  return rawRows;
};

export const ExcelService = {
  // Legacy / single sheet parser - Now upgraded to auto-detect if the file is actually a consolidated sheet!
  parseFile: async (file: File, defaultType?: TaskType): Promise<Task[]> => {
    // If the file looks like a consolidated backup or contains multiple sheets, route directly to parseBackupExcel
    try {
      const backupResult = await ExcelService.parseBackupExcel(file);
      if (backupResult.tasks.length > 0) {
        // If defaultType was passed and the task didn't specify an explicit type, apply it
        return backupResult.tasks.map(t => ({
          ...t,
          type: defaultType && t.type === 'Incidente' && !t.id.toLowerCase().startsWith('inc') ? defaultType : t.type
        }));
      }
    } catch {
      // Fallback to standard sheet parsing
    }

    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          const rows = extractRowsWithHeaderDetection(worksheet);
          const tasks: Task[] = rows.map((row: any, idx: number) => mapRowToTask(row, defaultType, idx));
          resolve(tasks);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  },

  // Parse robots file
  parseRobotFile: async (file: File): Promise<Robot[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          const rows = extractRowsWithHeaderDetection(worksheet);
          const robots: Robot[] = rows.map((row: any) => mapRowToRobot(row));
          resolve(robots);
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  },

  // Comprehensive Excel Backup Parser
  // Recognizes full backup spreadsheets with all columns and sheets
  // Scans all workbook sheets and extracts tasks, robots, and developers
  parseBackupExcel: async (file: File): Promise<ExcelBackupParseResult> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const sheetNames = workbook.SheetNames;
          
          let parsedTasks: Task[] = [];
          let parsedRobots: Robot[] = [];
          const discoveredDevNames = new Set<string>();

          for (const sheetName of sheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const rows = extractRowsWithHeaderDetection(worksheet);
            if (!rows || rows.length === 0) continue;

            const lowerSheet = sheetName.toLowerCase().trim();

            // 1. Robots / RPA sheet
            if (lowerSheet.includes('robô') || lowerSheet.includes('robo') || lowerSheet.includes('rpa') || lowerSheet.includes('totem')) {
              rows.forEach(row => {
                const r = mapRowToRobot(row);
                if (r.name && r.name !== 'Robô RPA') {
                  parsedRobots.push(r);
                }
              });
              continue;
            }

            // 2. Developers sheet
            if (lowerSheet.includes('dev') || lowerSheet.includes('equipe') || lowerSheet.includes('desenvolvedor')) {
              rows.forEach(row => {
                const devName = getRowVal(row, ['nome', 'name', 'desenvolvedor', 'dev']);
                if (devName && String(devName).trim().length > 1) {
                  discoveredDevNames.add(String(devName).trim());
                }
              });
              continue;
            }

            // 3. Task / Demands sheet (or any generic sheet)
            // Determine default type based on sheet name if applicable
            let sheetDefaultType: TaskType | undefined = undefined;
            if (lowerSheet.includes('incid')) sheetDefaultType = 'Incidente';
            else if (lowerSheet.includes('melhoria') || lowerSheet.includes('enhancement')) sheetDefaultType = 'Melhoria';
            else if (lowerSheet.includes('auto') || lowerSheet.includes('projeto')) sheetDefaultType = 'Nova Automação';

            rows.forEach((row, idx) => {
              const task = mapRowToTask(row, sheetDefaultType, idx);
              // Ensure row has at least an ID or summary with content
              if (task.id && task.summary && task.summary !== 'Sem descrição') {
                parsedTasks.push(task);
                if (task.assignee && task.assignee.trim().length > 1) {
                  discoveredDevNames.add(task.assignee.trim());
                }

                // If task has automationName, also capture potential robot
                if (task.automationName && task.automationName.trim().length > 1) {
                  const rName = task.automationName.trim();
                  if (!parsedRobots.some(r => r.name.toLowerCase() === rName.toLowerCase())) {
                    parsedRobots.push({
                      id: `rpa-task-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                      name: rName,
                      folder: task.projectPath || '',
                      status: 'ATIVO',
                      developer: task.assignee || 'N/A',
                      owners: task.requester || 'N/A',
                      area: task.managementArea || 'N/A',
                      fte: task.fteValue || 0,
                      ticketNumber: task.id
                    });
                  }
                }
              }
            });
          }

          // Fallback: If no tasks found, parse first sheet aggressively
          if (parsedTasks.length === 0 && sheetNames.length > 0) {
            const worksheet = workbook.Sheets[sheetNames[0]];
            const rows = extractRowsWithHeaderDetection(worksheet);
            rows.forEach((r, idx) => {
              const t = mapRowToTask(r, undefined, idx);
              if (t.id) {
                parsedTasks.push(t);
                if (t.assignee) discoveredDevNames.add(t.assignee.trim());
              }
            });
          }

          // Build developer entities
          const devs: Developer[] = Array.from(discoveredDevNames).map((name, index) => ({
            id: `dev-excel-${Date.now()}-${index}`,
            name
          }));

          const stats = {
            tasksCount: parsedTasks.length,
            incidentsCount: parsedTasks.filter(t => t.type === 'Incidente').length,
            improvementsCount: parsedTasks.filter(t => t.type === 'Melhoria').length,
            automationsCount: parsedTasks.filter(t => t.type === 'Nova Automação').length,
            devsCount: devs.length,
            robotsCount: parsedRobots.length
          };

          resolve({
            tasks: parsedTasks,
            robots: parsedRobots,
            devs,
            sheetNames,
            stats
          });
        } catch (error) {
          reject(error);
        }
      };
      reader.onerror = (error) => reject(error);
      reader.readAsArrayBuffer(file);
    });
  },

  // Export full backup spreadsheet matching the user's complete schema
  exportBackupExcel: (tasks: Task[], robots: Robot[] = [], devs: Developer[] = []): void => {
    const wb = XLSX.utils.book_new();

    // 1. Sheet Demandas (matching exact user columns)
    const exportTasksData = tasks.map(t => ({
      id: t.id,
      type: t.type,
      summary: t.summary,
      requester: t.requester || 'Sistema',
      assignee: t.assignee || '',
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      category: t.category || '',
      subcategory: t.subcategory || '',
      history: t.history && t.history.length > 0 ? JSON.stringify(t.history) : '',
      startDate: t.startDate || '',
      estimatedTime: t.estimatedTime || '',
      endDate: t.endDate || '',
      projectData: t.projectData ? JSON.stringify(t.projectData) : '',
      automationName: t.automationName || '',
      boardPosition: t.boardPosition !== undefined ? t.boardPosition : '',
      managementArea: t.managementArea || '',
      fteValue: t.fteValue !== undefined ? t.fteValue : '',
      projectPath: t.projectPath || '',
      blocker: t.blocker || '',
      docStatuses: t.docStatuses ? JSON.stringify(t.docStatuses) : '',
      description: t.description || '',
      actualTime: t.actualTime || '',
      subTasks: t.subTasks && t.subTasks.length > 0 ? JSON.stringify(t.subTasks) : '',
      devopsUserStoryId: t.devopsUserStoryId || '',
      devopsFeatureId: t.devopsFeatureId || ''
    }));

    const wsTasks = XLSX.utils.json_to_sheet(exportTasksData);
    XLSX.utils.book_append_sheet(wb, wsTasks, "Demandas");

    // 2. Sheet Robôs
    if (robots && robots.length > 0) {
      const robotsData = robots.map(r => ({
        'NOME DO ROBÔ': r.name,
        'PASTA QUE ESTÁ ARMAZENADO': r.folder,
        'SITUAÇÃO': r.status,
        'DESENVOLVEDOR': r.developer,
        'OWNERS': r.owners,
        'ÁREA': r.area,
        'FTE': r.fte || 0,
        'NÚMERO DO CHAMADO': r.ticketNumber || ''
      }));
      const wsRobots = XLSX.utils.json_to_sheet(robotsData);
      XLSX.utils.book_append_sheet(wb, wsRobots, "Robôs");
    }

    // 3. Sheet Desenvolvedores
    if (devs && devs.length > 0) {
      const devsData = devs.map(d => ({
        'ID': d.id,
        'Nome': d.name
      }));
      const wsDevs = XLSX.utils.json_to_sheet(devsData);
      XLSX.utils.book_append_sheet(wb, wsDevs, "Desenvolvedores");
    }

    const safeDate = new Date().toISOString().split('T')[0];
    XLSX.writeFile(wb, `Nexus_Backup_Demandas_${safeDate}.xlsx`);
  }
};
