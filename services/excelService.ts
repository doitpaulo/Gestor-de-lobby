import * as XLSX from 'xlsx';
import { Task, TaskType, Priority } from '../types';

export const ExcelService = {
  parseFile: async (file: File, defaultType?: TaskType): Promise<Task[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const data = e.target?.result;
          const workbook = XLSX.read(data, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const worksheet = workbook.Sheets[firstSheetName];
          
          // Use raw: false to get formatted strings
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
  }
};

const mapRowToTask = (row: any, defaultType?: TaskType): Task => {
  // Helper to find key case-insensitive
  const findKey = (obj: any, keys: string[]) => {
      for (let k of keys) {
          if (obj[k] !== undefined) return obj[k];
          // Try uppercase match
          const found = Object.keys(obj).find(ok => ok.toLowerCase() === k.toLowerCase());
          if (found) return obj[found];
      }
      return null;
  }

  const id = findKey(row, ['Número', 'Numero', 'ID', 'Number']) || `TASK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const summary = findKey(row, ['Descrição resumida', 'Resumo', 'Summary', 'Short Description']) || 'Sem descrição';
  const statusRaw = findKey(row, ['Estado', 'State', 'Status']) || 'Novo';
  const assigneeRaw = findKey(row, ['Atribuído a', 'Atribuido a', 'Assigned to', 'Responsável']) || null;
  const createdRaw = findKey(row, ['Criação de', 'Criação em', 'Created', 'Opened']) || new Date().toISOString();
  const subcategory = findKey(row, ['Subcategoria', 'Subcategory']) || '';
  
  const requester = findKey(row, ['Criado por', 'Solicitante', 'Requester', 'Caller']) || 'Sistema'; 
  const rawPriority = findKey(row, ['Prioridade', 'Priority']) || '4 - Baixa';

  // Determine Type
  let type: TaskType = defaultType || 'Incidente';
  if (!defaultType) {
      const textToScan = JSON.stringify(row).toLowerCase();
      if (textToScan.includes('melhoria')) type = 'Melhoria';
      else if (textToScan.includes('automação') || textToScan.includes('rpa')) type = 'Nova Automação';
  }

  // Normalize Priority
  let priority: Priority = '4 - Baixa'; 
  const pLower = String(rawPriority).toLowerCase();
  if (pLower.includes('1') || pLower.includes('crítica') || pLower.includes('critica')) priority = '1 - Crítica';
  else if (pLower.includes('2') || pLower.includes('alta')) priority = '2 - Alta';
  else if (pLower.includes('3') || pLower.includes('moderada')) priority = '3 - Moderada';
  else if (pLower.includes('4') || pLower.includes('baixa')) priority = '4 - Baixa';

  let status = String(statusRaw).trim();
  
  // Clean Assignee
  let assignee = assigneeRaw && String(assigneeRaw).trim().length > 0 ? String(assigneeRaw).trim() : null;
  if (assignee === 'N/A' || assignee === '-') assignee = null;

  return {
    id: String(id),
    type,
    summary: String(summary),
    requester: String(requester),
    assignee: assignee,
    priority,
    status,
    createdAt: String(createdRaw),
    category: row['Categoria'] || '', 
    subcategory: String(subcategory),
    startDate: undefined,
    endDate: undefined,
    estimatedTime: undefined,
    actualTime: undefined
  };
};