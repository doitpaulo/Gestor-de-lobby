

import * as XLSX from 'xlsx';
import { Task, TaskType, Priority, Robot, normalizeStatus, normalizeTaskType } from '../types';

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
  },

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
                
                const robots: Robot[] = json.map((row: any) => {
                     return {
                         id: `rpa-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
                         name: row['NOME DO ROBÔ'] || row['Nome'] || 'Robô Sem Nome',
                         folder: row['PASTA QUE ESTÁ ARMAZENADO'] || row['Pasta'] || '',
                         status: (row['SITUAÇÃO'] || row['Status'] || 'DESATIVO').toUpperCase(),
                         developer: row['DESENVOLVEDOR'] || row['Desenvolvedor'] || 'N/A',
                         owners: row['OWNERS'] || row['Owners'] || 'N/A',
                         area: row['ÁREA'] || row['Area'] || 'N/A',
                         fte: parseFloat(row['FTE'] || row['fte'] || '0'),
                         ticketNumber: row['NÚMERO DO CHAMADO'] || row['CHAMADO'] || row['Ticket'] || ''
                     };
                });
                resolve(robots);
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
          if (obj[k] !== undefined && obj[k] !== null && String(obj[k]).trim() !== '') return obj[k];
          const found = Object.keys(obj).find(ok => ok.trim().toLowerCase() === k.trim().toLowerCase());
          if (found && obj[found] !== undefined && obj[found] !== null && String(obj[found]).trim() !== '') return obj[found];
      }
      return null;
  }

  const id = findKey(row, ['Número', 'Numero', 'ID', 'Number']) || `TASK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
  const summary = findKey(row, ['Descrição resumida', 'Resumo', 'Summary', 'Short Description', 'Título', 'Titulo']) || 'Sem descrição';
  const statusRaw = findKey(row, ['Estado', 'State', 'Status', 'Situação', 'Situacao']) || 'Novo';
  const assigneeRaw = findKey(row, ['Atribuído a', 'Atribuido a', 'Assigned to', 'Responsável', 'Responsavel']) || null;
  const createdRaw = findKey(row, ['Criação de', 'Criação em', 'Criado em', 'Created', 'Opened']) || new Date().toISOString();
  const subcategory = findKey(row, ['Subcategoria', 'Subcategory']) || '';
  
  const requester = findKey(row, ['Criado por', 'Solicitante', 'Requester', 'Caller']) || 'Sistema'; 
  const rawPriority = findKey(row, ['Prioridade', 'Priority']) || '4 - Baixa';

  // Determine Type:
  // 1. First, check if the Excel row explicitly defines the demand type
  const rawTypeCol = findKey(row, ['Tipo', 'Type', 'Tipo de Demanda', 'Tipo de Tarefa', 'Task Type', 'Classificação', 'Classification']);
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
      const textToScan = `${summary} ${subcategory} ${row['Categoria'] || ''}`.toLowerCase();
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
  if (assignee === 'N/A' || assignee === '-' || assignee === 'None' || assignee === 'null') assignee = null;

  return {
    id: String(id).trim(),
    type: normalizeTaskType(type),
    summary: String(summary).trim(),
    requester: String(requester).trim(),
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