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
  sampleTasks: Task[];
  stats: {
    tasksCount: number;
    incidentsCount: number;
    improvementsCount: number;
    automationsCount: number;
    devsCount: number;
    robotsCount: number;
  };
}

// Remove accents and trim lowercase for fuzzy key comparison
const cleanKey = (key: string): string => {
  return String(key || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
};

// Safe date string extractor
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

  // Fallback if valid ISO or Date string
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

  // 3. Substring match (ensure cleaned token has minimum 3 chars to prevent collisions)
  for (const alias of aliases) {
    const cleanedAlias = cleanKey(alias);
    if (cleanedAlias.length < 3) continue;
    for (const [cKey, oKey] of rowNormalizedMap.entries()) {
      if (cKey.includes(cleanedAlias) || (cKey.length >= 4 && cleanedAlias.includes(cKey))) {
        const val = row[oKey];
        if (val !== undefined && val !== null && String(val).trim() !== '') {
          return val;
        }
      }
    }
  }

  return null;
};

// Read workbook from file with support for XLSX, XLS, and Brazilian CSV (semicolon ;)
const readWorkbookFromFile = async (file: File): Promise<XLSX.WorkBook> => {
  const isCsv = file.name.toLowerCase().endsWith('.csv');
  if (isCsv) {
    const text = await file.text();
    // Detect delimiter: semicolon ';' or comma ',' or tab '\t'
    const firstLines = text.split(/\r?\n/).slice(0, 10).join('\n');
    const semicolonCount = (firstLines.match(/;/g) || []).length;
    const commaCount = (firstLines.match(/,/g) || []).length;
    const tabCount = (firstLines.match(/\t/g) || []).length;

    if (semicolonCount > commaCount && semicolonCount > tabCount) {
      return XLSX.read(text, { type: 'string', FS: ';' });
    }
    return XLSX.read(text, { type: 'string' });
  }

  const arrayBuf = await file.arrayBuffer();
  return XLSX.read(arrayBuf, { type: 'array', cellDates: true });
};

// Robust header detection across the first 25 non-empty rows of any worksheet
const extractRowsWithHeaderDetection = (worksheet: XLSX.WorkSheet): any[] => {
  if (!worksheet) return [];

  // Convert worksheet to 2D array of all cells
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: false, defval: '' }) as any[][];
  if (!matrix || matrix.length === 0) return [];

  // Filter out rows that are entirely blank
  const nonEmptyRows: { rowIndex: number; cells: string[] }[] = [];
  matrix.forEach((row, rowIndex) => {
    if (Array.isArray(row)) {
      const stringCells = row.map(c => String(c ?? '').trim());
      if (stringCells.some(c => c.length > 0)) {
        nonEmptyRows.push({ rowIndex, cells: stringCells });
      }
    }
  });

  if (nonEmptyRows.length === 0) return [];

  // Recognizable header keywords (Portuguese and English)
  const headerTokens = [
    'id', 'cod', 'codigo', 'num', 'numero', 'chamado', 'ticket', 'chave', 'key', 'item', 'seq', 'protocolo', 'registro',
    'resumo', 'summary', 'desc', 'descricao', 'titulo', 'title', 'assunto', 'subject', 'nome', 'name', 'tarefa', 'task', 'demanda', 'projeto', 'atividade',
    'tipo', 'type', 'class', 'classificacao', 'natureza', 'categoria', 'subcategoria',
    'status', 'situacao', 'estado', 'state', 'fase', 'etapa', 'condicao',
    'resp', 'responsavel', 'assignee', 'atribuido', 'dev', 'desenvolvedor', 'analista', 'tecnico', 'recurso', 'dono', 'owner',
    'solicitante', 'requester', 'aberto', 'criado', 'autor', 'abertopor',
    'prio', 'prioridade', 'priority', 'criticidade', 'urgencia', 'severidade',
    'data', 'inicio', 'fim', 'abertura', 'fechamento', 'entrega', 'prazo', 'created', 'start', 'end',
    'tempo', 'horas', 'estimativa', 'estimado', 'real', 'realizado', 'fte', 'robo', 'robot', 'bot', 'automacao', 'area', 'gerencia'
  ];

  // Score candidate header rows (scan up to first 25 non-empty rows)
  let bestRowIdx = 0;
  let maxScore = -1;

  const scanLimit = Math.min(nonEmptyRows.length, 25);
  for (let i = 0; i < scanLimit; i++) {
    const { cells } = nonEmptyRows[i];
    let score = 0;
    let textCellsCount = 0;

    cells.forEach(cell => {
      const clean = cleanKey(cell);
      if (!clean) return;
      textCellsCount++;

      // Check if cell matches known header tokens
      if (headerTokens.some(t => clean === t || clean.includes(t) || (t.length >= 4 && t.includes(clean)))) {
        score += 3;
      }
    });

    // Score combines header token hits + text columns
    const totalScore = score + Math.min(textCellsCount, 8);
    if (totalScore > maxScore) {
      maxScore = totalScore;
      bestRowIdx = i;
    }
  }

  // The identified header row
  const headerRowInfo = nonEmptyRows[bestRowIdx];
  const rawHeaders = headerRowInfo.cells;

  // Sanitize headers & ensure uniqueness
  const headers: string[] = [];
  const seenHeaderCounts = new Map<string, number>();

  rawHeaders.forEach((h, colIdx) => {
    let cleanName = h.trim();
    if (!cleanName) {
      cleanName = `Coluna_${colIdx + 1}`;
    }
    const count = (seenHeaderCounts.get(cleanName.toLowerCase()) || 0) + 1;
    seenHeaderCounts.set(cleanName.toLowerCase(), count);
    if (count > 1) {
      headers.push(`${cleanName}_${count}`);
    } else {
      headers.push(cleanName);
    }
  });

  // Extract data rows below the header row
  const dataRows: any[] = [];
  for (let i = bestRowIdx + 1; i < nonEmptyRows.length; i++) {
    const { cells } = nonEmptyRows[i];
    if (!cells.some(c => c.length > 0)) continue;

    // Check if row is a footer summary/total (e.g. "Total Geral", "Soma")
    const firstCell = (cells[0] || '').toLowerCase();
    if (firstCell.startsWith('total') || firstCell.startsWith('soma') || firstCell.startsWith('contagem')) {
      continue;
    }

    const rowObj: any = {};
    headers.forEach((headerName, colIdx) => {
      if (colIdx < cells.length) {
        rowObj[headerName] = cells[colIdx];
      } else {
        rowObj[headerName] = '';
      }
    });

    // Only include if row has at least one cell with real content
    const hasContent = Object.values(rowObj).some(v => String(v || '').trim().length > 0);
    if (hasContent) {
      dataRows.push(rowObj);
    }
  }

  return dataRows;
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
  // 1. ID - Look for explicit ID columns first
  const idRaw = getRowVal(row, [
    'id', 'ID', 'Número do Chamado', 'Numero do Chamado', 'Numero Chamado', 'Número Chamado',
    'Chamado', 'Ticket', 'Código', 'Codigo', 'Cod', 'Number', 'Número', 'Numero', 'Nº', 'No',
    'Chave', 'Key', 'Protocolo', 'Registro', 'Item', 'Seq'
  ]);

  let id = idRaw ? String(idRaw).trim() : '';

  // If no explicit ID column, check if any cell matches standard ID patterns (e.g. INC123, REQ123, TASK123)
  if (!id) {
    for (const val of Object.values(row)) {
      const s = String(val || '').trim();
      const matchPattern = s.match(/\b(INC|RITM|REQ|TASK|US|BUG|CH|DEM)[-_0-9A-Z]+\b/i);
      if (matchPattern) {
        id = matchPattern[0].toUpperCase();
        break;
      }
    }
  }

  // Fallback sequential ID if none found
  if (!id) {
    id = `DEM-${String(indexFallback + 1).padStart(4, '0')}`;
  }

  // 2. Summary / Description
  const summaryRaw = getRowVal(row, [
    'summary', 'Descrição resumida', 'Descricao resumida', 'Resumo', 'Título', 'Titulo',
    'Title', 'Assunto', 'Subject', 'Nome', 'Nome da Demanda', 'Demanda', 'Tarefa', 'Task',
    'Projeto', 'Atividade', 'Short Description', 'Descrição', 'Descricao', 'Description'
  ]);

  let summary = summaryRaw ? String(summaryRaw).trim() : '';

  // If summary not found, pick the longest descriptive text cell in the row
  if (!summary) {
    let longestText = '';
    for (const [k, v] of Object.entries(row)) {
      const s = String(v || '').trim();
      if (s !== id && s.length > longestText.length && !s.match(/^\d+$/) && !s.match(/^\d{4}-\d{2}-\d{2}$/)) {
        longestText = s;
      }
    }
    summary = longestText || `Demanda ${id}`;
  }

  // 3. Status
  const statusRaw = getRowVal(row, [
    'status', 'Status', 'Status Global', 'Estado', 'State', 'Situação', 'Situacao', 'Fase Atual', 'Fase', 'Etapa'
  ]) || 'Novo';
  const status = normalizeStatus(String(statusRaw));

  // 4. Assignee / Responsável
  const assigneeRaw = getRowVal(row, [
    'assignee', 'Atribuído a', 'Atribuido a', 'Assigned to', 'Responsável', 'Responsavel',
    'Desenvolvedor', 'Dev', 'Analista', 'Técnico', 'Tecnico', 'Recurso', 'Dono'
  ]);
  let assignee: string | null = assigneeRaw && String(assigneeRaw).trim().length > 0 ? String(assigneeRaw).trim() : null;
  if (assignee && ['n/a', '-', 'none', 'null', 'não atribuído', 'nao atribuido', 'sem dev', 'não atribuida'].includes(assignee.toLowerCase())) {
    assignee = null;
  }

  // 5. Requester / Solicitante
  const requesterRaw = getRowVal(row, [
    'requester', 'Criado por', 'Aberto por', 'Solicitante', 'Requester', 'Caller', 'Opened by', 'Autor', 'Emissor', 'Cliente', 'Usuário', 'Usuario'
  ]) || 'Sistema';
  const requester = String(requesterRaw).trim();

  // 6. Created At
  const createdRaw = getRowVal(row, [
    'createdAt', 'Criação de', 'Criação em', 'Criado em', 'Created', 'Opened', 'Data Abertura', 'Abertura', 'Data Criação'
  ]);
  const createdAt = extractSafeDate(createdRaw) || new Date().toISOString();

  // 7. Category & Subcategory
  const category = String(getRowVal(row, ['category', 'Categoria', 'Area', 'Área', 'Gerência', 'Gerencia']) || '').trim();
  const subcategory = String(getRowVal(row, ['subcategory', 'Subcategoria', 'Sub-categoria', 'Sub categoria']) || '').trim();

  // 8. Priority
  const rawPriority = getRowVal(row, ['priority', 'Prioridade', 'Priority', 'Criticidade', 'Urgência', 'Urgencia', 'Severidade']) || '3 - Moderada';
  let priority: Priority = '3 - Moderada';
  const pLower = String(rawPriority).toLowerCase();
  if (pLower.includes('1') || pLower.includes('crítica') || pLower.includes('critica') || pLower.includes('urgent')) priority = '1 - Crítica';
  else if (pLower.includes('2') || pLower.includes('alta') || pLower.includes('high')) priority = '2 - Alta';
  else if (pLower.includes('3') || pLower.includes('moderada') || pLower.includes('média') || pLower.includes('media') || pLower.includes('medium')) priority = '3 - Moderada';
  else if (pLower.includes('4') || pLower.includes('baixa') || pLower.includes('low')) priority = '4 - Baixa';

  // 9. Determine Type
  const rawTypeCol = getRowVal(row, [
    'type', 'Tipo', 'Tipo de Demanda', 'Tipo de Tarefa', 'Task Type', 'Classificação', 'Classificacao', 'Natureza'
  ]);
  let explicitType: TaskType | null = null;
  if (rawTypeCol) {
    const et = String(rawTypeCol).toLowerCase().trim();
    if (et.includes('melhoria') || et.includes('enhancement') || et.includes('feature') || et.includes('evolutiva')) explicitType = 'Melhoria';
    else if (et.includes('auto') || et.includes('rpa') || et.includes('bot') || et.includes('robo') || et.includes('robô') || et.includes('projeto')) explicitType = 'Nova Automação';
    else if (et.includes('incid') || et.includes('bug') || et.includes('defeito') || et.includes('erro') || et.includes('falha') || et.includes('corretiva') || et.includes('suporte')) explicitType = 'Incidente';
  }

  let type: TaskType = explicitType || defaultType || 'Incidente';
  if (!explicitType && !defaultType) {
    const idLower = String(id).toLowerCase().trim();
    if (idLower.startsWith('inc') || idLower.startsWith('bug') || idLower.startsWith('err')) {
      type = 'Incidente';
    } else if (idLower.startsWith('ritm') || idLower.startsWith('req') || idLower.startsWith('aut') || idLower.startsWith('rpa')) {
      type = 'Nova Automação';
    } else {
      const textToScan = `${summary} ${subcategory} ${category}`.toLowerCase();
      if (textToScan.includes('melhoria') || textToScan.includes('feature')) type = 'Melhoria';
      else if (textToScan.includes('automação') || textToScan.includes('automacao') || textToScan.includes('rpa') || textToScan.includes('robô') || textToScan.includes('robo') || textToScan.includes('bot')) type = 'Nova Automação';
      else type = 'Incidente';
    }
  }

  // 10. Dates
  const startDateRaw = getRowVal(row, ['startDate', 'Data Início', 'Data Inicio', 'Inicio', 'Dt Inicio', 'Start Date', 'Previsão Início']);
  const endDateRaw = getRowVal(row, ['endDate', 'Data Fim', 'Data Fim Prevista', 'Fim', 'Dt Fim', 'End Date', 'Conclusão', 'Prazo']);
  const startDate = extractSafeDate(startDateRaw);
  const endDate = extractSafeDate(endDateRaw);

  // 11. Time metrics
  const estimatedTimeRaw = getRowVal(row, ['estimatedTime', 'Tempo Estimado', 'Horas Estimadas', 'Estimativa', 'Est']);
  const actualTimeRaw = getRowVal(row, ['actualTime', 'Tempo Real', 'Horas Reais', 'Realizado', 'Act']);
  const estimatedTime = estimatedTimeRaw !== null && estimatedTimeRaw !== undefined ? String(estimatedTimeRaw).trim() : undefined;
  const actualTime = actualTimeRaw !== null && actualTimeRaw !== undefined ? String(actualTimeRaw).trim() : undefined;

  // 12. Automation / RPA details
  const automationName = getRowVal(row, ['automationName', 'Nome da Automação', 'Nome da Automacao', 'Robô', 'Robo', 'Bot']);
  const managementArea = getRowVal(row, ['managementArea', 'Gerência', 'Gerencia', 'Área', 'Area', 'Departamento']);
  const projectPath = getRowVal(row, ['projectPath', 'Link SharePoint', 'SharePoint', 'Caminho Projeto', 'Pasta']);
  const blocker = getRowVal(row, ['blocker', 'Bloqueio', 'Motivo Bloqueio', 'Pendência', 'Pendencia', 'Impedimento']);
  const description = getRowVal(row, ['description', 'Descrição', 'Descricao', 'Detalhes', 'Observações', 'Observacoes', 'Comments']);

  // 13. FTE Value
  const fteRaw = getRowVal(row, ['fteValue', 'FTE', 'Valor FTE', 'fte', 'Economia FTE']);
  let fteValue: number | undefined = undefined;
  if (fteRaw !== null && fteRaw !== undefined) {
    const parsedFte = parseFloat(String(fteRaw).replace(',', '.'));
    if (!isNaN(parsedFte)) fteValue = parsedFte;
  }

  // 14. Board position
  const boardPosRaw = getRowVal(row, ['boardPosition', 'Posição Kanban', 'Posicao Kanban', 'Ordem']);
  let boardPosition: number | undefined = undefined;
  if (boardPosRaw !== null && boardPosRaw !== undefined) {
    const num = parseInt(String(boardPosRaw), 10);
    if (!isNaN(num)) boardPosition = num;
  }

  // 15. Complex JSON or object fields
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

  // 16. DevOps IDs
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

export const ExcelService = {
  // Parse single file or single sheet
  parseFile: async (file: File, defaultType?: TaskType): Promise<Task[]> => {
    try {
      const backupResult = await ExcelService.parseBackupExcel(file);
      if (backupResult.tasks.length > 0) {
        return backupResult.tasks.map(t => ({
          ...t,
          type: defaultType && t.type === 'Incidente' && !t.id.toLowerCase().startsWith('inc') ? defaultType : t.type
        }));
      }
    } catch {
      // Fallback
    }

    const workbook = await readWorkbookFromFile(file);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = extractRowsWithHeaderDetection(worksheet);
    return rows.map((row: any, idx: number) => mapRowToTask(row, defaultType, idx));
  },

  // Parse robots file
  parseRobotFile: async (file: File): Promise<Robot[]> => {
    const workbook = await readWorkbookFromFile(file);
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const rows = extractRowsWithHeaderDetection(worksheet);
    return rows.map((row: any) => mapRowToRobot(row));
  },

  // Comprehensive Excel/CSV Backup Parser
  // Scans all workbook sheets and auto-recognizes tasks, robots, and developers
  parseBackupExcel: async (file: File): Promise<ExcelBackupParseResult> => {
    const workbook = await readWorkbookFromFile(file);
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

      // 3. Task / Demands sheet (or generic sheet)
      let sheetDefaultType: TaskType | undefined = undefined;
      if (lowerSheet.includes('incid')) sheetDefaultType = 'Incidente';
      else if (lowerSheet.includes('melhoria') || lowerSheet.includes('enhancement')) sheetDefaultType = 'Melhoria';
      else if (lowerSheet.includes('auto') || lowerSheet.includes('projeto')) sheetDefaultType = 'Nova Automação';

      rows.forEach((row, idx) => {
        const task = mapRowToTask(row, sheetDefaultType, idx);
        if (task.id && task.summary) {
          parsedTasks.push(task);
          if (task.assignee && task.assignee.trim().length > 1) {
            discoveredDevNames.add(task.assignee.trim());
          }

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

    // Fallback: If no tasks found across all sheets, parse first sheet aggressively
    if (parsedTasks.length === 0 && sheetNames.length > 0) {
      const worksheet = workbook.Sheets[sheetNames[0]];
      const rows = extractRowsWithHeaderDetection(worksheet);
      rows.forEach((r, idx) => {
        const t = mapRowToTask(r, undefined, idx);
        if (t.id && t.summary) {
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

    return {
      tasks: parsedTasks,
      robots: parsedRobots,
      devs,
      sheetNames,
      sampleTasks: parsedTasks.slice(0, 5),
      stats
    };
  },

  // Export full backup spreadsheet matching the user's complete schema
  exportBackupExcel: (tasks: Task[], robots: Robot[] = [], devs: Developer[] = []): void => {
    const wb = XLSX.utils.book_new();

    // 1. Sheet Demandas (matching exact user columns)
    const exportTasksData = tasks.map(t => ({
      'ID': t.id,
      'Tipo': t.type,
      'Resumo': t.summary,
      'Status': t.status,
      'Responsável': t.assignee || '',
      'Solicitante': t.requester || 'Sistema',
      'Prioridade': t.priority,
      'Data Abertura': t.createdAt,
      'Data Início': t.startDate || '',
      'Data Fim': t.endDate || '',
      'Horas Estimadas': t.estimatedTime || '',
      'Horas Reais': t.actualTime || '',
      'Categoria': t.category || '',
      'Subcategoria': t.subcategory || '',
      'Área / Gerência': t.managementArea || '',
      'Nome da Automação': t.automationName || '',
      'Valor FTE': t.fteValue !== undefined ? t.fteValue : '',
      'Link SharePoint / Pasta': t.projectPath || '',
      'Bloqueio / Pendência': t.blocker || '',
      'Descrição Detalhada': t.description || '',
      'User Story ID': t.devopsUserStoryId || '',
      'Feature ID': t.devopsFeatureId || '',
      'Histórico': t.history && t.history.length > 0 ? JSON.stringify(t.history) : '',
      'Ciclo de Vida': t.projectData ? JSON.stringify(t.projectData) : '',
      'Status Documentos': t.docStatuses ? JSON.stringify(t.docStatuses) : '',
      'Subtarefas': t.subTasks && t.subTasks.length > 0 ? JSON.stringify(t.subTasks) : ''
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
  },

  // Generate and download a blank template Excel file
  downloadTemplateExcel: (): void => {
    const wb = XLSX.utils.book_new();

    const sampleRows = [
      {
        'ID': 'INC001234',
        'Tipo': 'Incidente',
        'Resumo': 'Falha na autenticação do robô no portal fiscal',
        'Status': 'Em Atendimento',
        'Responsável': 'Carlos Dev',
        'Solicitante': 'Maria Fiscal',
        'Prioridade': '2 - Alta',
        'Data Abertura': '2025-01-15',
        'Data Início': '2025-01-16',
        'Data Fim': '',
        'Horas Estimadas': '8h',
        'Horas Reais': '4h',
        'Categoria': 'Sustentação',
        'Subcategoria': 'Robótica RPA',
        'Área / Gerência': 'Financeiro',
        'Nome da Automação': 'RPA Fiscal SEFAZ',
        'Valor FTE': 1.5,
        'Link SharePoint / Pasta': 'https://sharepoint.com/projetos/rpa_fiscal',
        'Bloqueio / Pendência': '',
        'Descrição Detalhada': 'Robô parou de emitir guias fiscais devido à alteração no certificado digital.'
      },
      {
        'ID': 'RITM005678',
        'Tipo': 'Nova Automação',
        'Resumo': 'Automação do processo de conciliação bancária',
        'Status': 'Em Progresso',
        'Responsável': 'Ana Silva',
        'Solicitante': 'João Contábil',
        'Prioridade': '3 - Moderada',
        'Data Abertura': '2025-01-10',
        'Data Início': '2025-01-12',
        'Data Fim': '2025-02-28',
        'Horas Estimadas': '40h',
        'Horas Reais': '12h',
        'Categoria': 'Inovação',
        'Subcategoria': 'Automação',
        'Área / Gerência': 'Contabilidade',
        'Nome da Automação': 'RPA Conciliação Bancos',
        'Valor FTE': 2.0,
        'Link SharePoint / Pasta': 'https://sharepoint.com/projetos/conciliacao',
        'Bloqueio / Pendência': '',
        'Descrição Detalhada': 'Desenvolvimento de fluxo automatizado para extração de extratos bancários e conciliação no ERP.'
      }
    ];

    const ws = XLSX.utils.json_to_sheet(sampleRows);
    XLSX.utils.book_append_sheet(wb, ws, "Modelo_Demandas");
    XLSX.writeFile(wb, "Nexus_Modelo_Planilha_Demandas.xlsx");
  }
};
