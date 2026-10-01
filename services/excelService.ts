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

export const ExcelService = {
  // Legacy / single sheet parser
  parseFile: async (file: File, defaultType?: TaskType): Promise<Task[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          const json = XLSX.utils.sheet_to_json(worksheet, { raw: false });
          const tasks: Task[] = json.map((row: any) => mapRowToTask(row, defaultType));
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
          const json = XLSX.utils.sheet_to_json(worksheet, { raw: false });
          
          const robots: Robot[] = json.map((row: any) => mapRowToRobot(row));
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
  // Recognizes full backup spreadsheets with all columns (id, type, summary, assignee, requester, etc.)
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

          // Identify sheets
          for (const sheetName of sheetNames) {
            const worksheet = workbook.Sheets[sheetName];
            const rows = XLSX.utils.sheet_to_json(worksheet, { raw: false }) as any[];
            if (!rows || rows.length === 0) continue;

            const lowerSheetName = sheetName.toLowerCase().trim();

            // Check if this sheet is exclusively robots/RPA inventory
            if (lowerSheetName.includes('robô') || lowerSheetName.includes('robo') || lowerSheetName.includes('rpa')) {
              rows.forEach(row => {
                const r = mapRowToRobot(row);
                if (r.name && r.name !== 'Robô Sem Nome') {
                  parsedRobots.push(r);
                }
              });
              continue;
            }

            // Check if this sheet has tasks/demands
            const sampleRow = rows[0];
            const keys = Object.keys(sampleRow).map(k => k.trim().toLowerCase());
            const hasTaskColumns = keys.some(k => 
              k === 'id' || k === 'número' || k === 'numero' || k === 'summary' || 
              k === 'resumo' || k === 'descrição resumida' || k === 'projeto' || 
              k === 'type' || k === 'tipo' || k === 'status' || k === 'estado'
            );

            if (hasTaskColumns) {
              rows.forEach(row => {
                const task = mapRowToTask(row);
                if (task.id && (task.summary || task.type)) {
                  parsedTasks.push(task);
                  if (task.assignee && task.assignee.trim().length > 1) {
                    discoveredDevNames.add(task.assignee.trim());
                  }
                  // If task has automationName, we can also record it as a potential robot
                  if (task.automationName && task.automationName.trim().length > 1) {
                    const rName = task.automationName.trim();
                    if (!parsedRobots.some(r => r.name.toLowerCase() === rName.toLowerCase())) {
                      parsedRobots.push({
                        id: `rpa-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
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
          }

          // Fallback: If no tasks found yet, parse the very first sheet as tasks
          if (parsedTasks.length === 0 && sheetNames.length > 0) {
            const worksheet = workbook.Sheets[sheetNames[0]];
            const rows = XLSX.utils.sheet_to_json(worksheet, { raw: false }) as any[];
            parsedTasks = rows.map(r => mapRowToTask(r)).filter(t => t.id && t.summary);
            parsedTasks.forEach(t => {
              if (t.assignee) discoveredDevNames.add(t.assignee.trim());
            });
          }

          // Build developers list from discovered names
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

// Safe date string extractor (e.g. "2025-11-17" even if "2025-11-174" or ISO string)
const extractSafeDate = (val: any): string | undefined => {
  if (!val) return undefined;
  const str = String(val).trim();
  if (str === '-' || str === 'N/A' || str === 'null') return undefined;
  // Match YYYY-MM-DD
  const match = str.match(/\b\d{4}-\d{2}-\d{2}\b/);
  if (match) return match[0];
  // Match DD/MM/YYYY
  const matchBR = str.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (matchBR) {
    return `${matchBR[3]}-${matchBR[2]}-${matchBR[1]}`;
  }
  return str.length >= 10 ? str.substring(0, 10) : str;
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

const mapRowToRobot = (row: any): Robot => {
  const findKey = (obj: any, keys: string[]) => {
    for (let k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
      const found = Object.keys(obj).find(ok => ok.trim().toLowerCase() === k.trim().toLowerCase());
      if (found && obj[found] !== undefined && obj[found] !== null && String(obj[found]).trim() !== '') return obj[found];
    }
    return null;
  };

  return {
    id: `rpa-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    name: findKey(row, ['NOME DO ROBÔ', 'Nome', 'Robô', 'Robo', 'Name']) || 'Robô Sem Nome',
    folder: findKey(row, ['PASTA QUE ESTÁ ARMAZENADO', 'Pasta', 'Folder', 'projectPath']) || '',
    status: (findKey(row, ['SITUAÇÃO', 'Situacao', 'Status']) || 'DESATIVO').toUpperCase(),
    developer: findKey(row, ['DESENVOLVEDOR', 'Desenvolvedor', 'assignee', 'Responsável']) || 'N/A',
    owners: findKey(row, ['OWNERS', 'Owners', 'requester', 'Solicitante']) || 'N/A',
    area: findKey(row, ['ÁREA', 'Area', 'Gerência', 'managementArea']) || 'N/A',
    fte: parseFloat(String(findKey(row, ['FTE', 'fte', 'fteValue']) || '0').replace(',', '.')),
    ticketNumber: findKey(row, ['NÚMERO DO CHAMADO', 'CHAMADO', 'Ticket', 'ticketNumber', 'id']) || ''
  };
};

const mapRowToTask = (row: any, defaultType?: TaskType): Task => {
  // Helper to find key case-insensitive and whitespace-agnostic
  const findKey = (obj: any, keys: string[]) => {
    for (let k of keys) {
      if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
      const found = Object.keys(obj).find(ok => ok.trim().toLowerCase() === k.trim().toLowerCase());
      if (found && obj[found] !== undefined && obj[found] !== null && String(obj[found]).trim() !== '') return obj[found];
    }
    return null;
  };

  const id = findKey(row, ['id', 'ID', 'Número', 'Numero', 'Number', 'Chamado', 'Ticket']) || `TASK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const summary = findKey(row, ['summary', 'Descrição resumida', 'Resumo', 'Projeto', 'Summary', 'Short Description', 'Título', 'Titulo']) || 'Sem descrição';
  const statusRaw = findKey(row, ['status', 'Status', 'Status Global', 'Estado', 'State', 'Situação', 'Situacao']) || 'Novo';
  const assigneeRaw = findKey(row, ['assignee', 'Atribuído a', 'Atribuido a', 'Assigned to', 'Responsável', 'Responsavel', 'Desenvolvedor']) || null;
  const createdRaw = findKey(row, ['createdAt', 'Criação de', 'Criação em', 'Criado em', 'Created', 'Opened']) || new Date().toISOString();
  const subcategory = findKey(row, ['subcategory', 'Subcategoria', 'Subcategory']) || '';
  const category = findKey(row, ['category', 'Categoria']) || '';
  const requester = findKey(row, ['requester', 'Criado por', 'Solicitante', 'Requester', 'Caller', 'Opened by']) || 'Sistema'; 
  const rawPriority = findKey(row, ['priority', 'Prioridade', 'Priority']) || '4 - Baixa';

  // Determine Type
  const rawTypeCol = findKey(row, ['type', 'Tipo', 'Tipo de Demanda', 'Tipo de Tarefa', 'Task Type', 'Classificação', 'Classification']);
  let explicitType: TaskType | null = null;
  if (rawTypeCol) {
    const et = String(rawTypeCol).toLowerCase().trim();
    if (et.includes('melhoria') || et.includes('enhancement') || et.includes('feature')) explicitType = 'Melhoria';
    else if (et.includes('auto') || et.includes('rpa') || et.includes('bot')) explicitType = 'Nova Automação';
    else if (et.includes('incid') || et.includes('bug') || et.includes('defeito') || et.includes('erro')) explicitType = 'Incidente';
  }

  let type: TaskType = explicitType || defaultType || 'Incidente';
  if (!explicitType && !defaultType) {
    const idLower = String(id).toLowerCase().trim();
    if (idLower.startsWith('inc')) {
      type = 'Incidente';
    } else {
      const textToScan = `${summary} ${subcategory} ${category}`.toLowerCase();
      if (textToScan.includes('melhoria')) type = 'Melhoria';
      else if (textToScan.includes('automação') || textToScan.includes('automacao') || textToScan.includes('rpa')) type = 'Nova Automação';
      else type = idLower.startsWith('ritm') ? 'Nova Automação' : 'Incidente';
    }
  }

  // Normalize Priority
  let priority: Priority = '4 - Baixa'; 
  const pLower = String(rawPriority).toLowerCase();
  if (pLower.includes('1') || pLower.includes('crítica') || pLower.includes('critica')) priority = '1 - Crítica';
  else if (pLower.includes('2') || pLower.includes('alta')) priority = '2 - Alta';
  else if (pLower.includes('3') || pLower.includes('moderada')) priority = '3 - Moderada';
  else if (pLower.includes('4') || pLower.includes('baixa')) priority = '4 - Baixa';

  // Normalize Status
  let status = normalizeStatus(String(statusRaw));
  
  // Clean Assignee
  let assignee = assigneeRaw && String(assigneeRaw).trim().length > 0 ? String(assigneeRaw).trim() : null;
  if (assignee === 'N/A' || assignee === '-' || assignee === 'None' || assignee === 'null' || assignee === 'Não Atribuído' || assignee === 'Nao Atribuido') {
    assignee = null;
  }

  // Dates
  const startDateRaw = findKey(row, ['startDate', 'Data Início', 'Data Inicio', 'Inicio']);
  const endDateRaw = findKey(row, ['endDate', 'Data Fim', 'Data Fim Prevista', 'Fim']);
  const startDate = extractSafeDate(startDateRaw);
  const endDate = extractSafeDate(endDateRaw);

  // Time metrics
  const estimatedTimeRaw = findKey(row, ['estimatedTime', 'Tempo Estimado', 'Horas Estimadas']);
  const actualTimeRaw = findKey(row, ['actualTime', 'Tempo Real', 'Horas Reais']);
  const estimatedTime = estimatedTimeRaw !== null ? String(estimatedTimeRaw).trim() : undefined;
  const actualTime = actualTimeRaw !== null ? String(actualTimeRaw).trim() : undefined;

  // Additional fields from schema
  const automationName = findKey(row, ['automationName', 'Nome da Automação', 'Nome da Automacao', 'Robô', 'Robo']);
  const managementArea = findKey(row, ['managementArea', 'Gerência', 'Gerencia', 'Área', 'Area']);
  const projectPath = findKey(row, ['projectPath', 'Link SharePoint', 'SharePoint', 'Caminho Projeto', 'Pasta']);
  const blocker = findKey(row, ['blocker', 'Bloqueio', 'Motivo Bloqueio', 'Pendência', 'Pendencia']);
  const description = findKey(row, ['description', 'Descrição', 'Descricao', 'Detalhes']);
  
  // FTE
  const fteRaw = findKey(row, ['fteValue', 'FTE', 'Valor FTE', 'fte']);
  let fteValue: number | undefined = undefined;
  if (fteRaw !== null && fteRaw !== undefined) {
    const parsedFte = parseFloat(String(fteRaw).replace(',', '.'));
    if (!isNaN(parsedFte)) fteValue = parsedFte;
  }

  // Board position
  const boardPosRaw = findKey(row, ['boardPosition', 'Posição Kanban', 'Posicao Kanban']);
  let boardPosition: number | undefined = undefined;
  if (boardPosRaw !== null && boardPosRaw !== undefined) {
    const num = parseInt(String(boardPosRaw), 10);
    if (!isNaN(num)) boardPosition = num;
  }

  // Complex JSON or object fields
  const historyRaw = findKey(row, ['history', 'Histórico', 'Historico']);
  let history: HistoryEntry[] | undefined = undefined;
  if (historyRaw) {
    const parsedH = safeJsonParse<HistoryEntry[] | null>(historyRaw, null);
    if (Array.isArray(parsedH)) history = parsedH;
  }

  const projectDataRaw = findKey(row, ['projectData', 'Dados do Projeto', 'Fase']);
  let projectData: ProjectLifecycleData | undefined = undefined;
  if (projectDataRaw) {
    const parsedPD = safeJsonParse<ProjectLifecycleData | null>(projectDataRaw, null);
    if (parsedPD && typeof parsedPD === 'object') projectData = parsedPD;
  }

  const docStatusesRaw = findKey(row, ['docStatuses', 'Status Documentos', 'Esteira Documental']);
  let docStatuses: Record<string, 'Pendente' | 'Em andamento' | 'Concluído'> | undefined = undefined;
  if (docStatusesRaw) {
    const parsedDocs = safeJsonParse<Record<string, any> | null>(docStatusesRaw, null);
    if (parsedDocs && typeof parsedDocs === 'object') docStatuses = parsedDocs;
  }

  const subTasksRaw = findKey(row, ['subTasks', 'Subtarefas']);
  let subTasks: SubTask[] | undefined = undefined;
  if (subTasksRaw) {
    const parsedST = safeJsonParse<SubTask[] | null>(subTasksRaw, null);
    if (Array.isArray(parsedST)) subTasks = parsedST;
  }

  // Azure DevOps IDs
  const devopsUserStoryId = findKey(row, ['devopsUserStoryId', 'User Story ID', 'ID User Story']);
  const devopsFeatureId = findKey(row, ['devopsFeatureId', 'Feature ID', 'ID Feature']);

  return {
    id: String(id).trim(),
    type: normalizeTaskType(type),
    summary: String(summary).trim(),
    requester: String(requester).trim(),
    assignee,
    priority,
    status,
    createdAt: String(createdRaw),
    category: String(category).trim(), 
    subcategory: String(subcategory).trim(),
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
