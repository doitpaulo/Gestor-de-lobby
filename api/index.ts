import express from "express";
import fs from "fs";
import path from "path";
import { PowerBIService } from "../services/powerbiService.js";
import { powerBiBasicKey } from "../services/powerbiAuth.js";

const app = express();

// Enable CORS
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Nexus-API-Key, X-API-Key");
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

// Middleware to support JSON request bodies
app.use(express.json({ limit: "25mb" }));

// -------------------------------------------------------------
// Server Data Persistence Helpers (Disk-based Store in /data)
// -------------------------------------------------------------
const DATA_DIR = path.join(process.cwd(), "data");
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (e) {
    console.warn("Could not create data directory:", e);
  }
}

const STORE_FILE = path.join(DATA_DIR, "nexus-store.json");
const DEVOPS_FILE = path.join(DATA_DIR, "nexus-devops.json");
const AGENT_CONFIG_FILE = path.join(DATA_DIR, "nexus-agent-config.json");

interface ServerStore {
  tasks: any[];
  devs: any[];
  robots: any[];
  lastSyncAt: string;
}

const readServerStore = (): ServerStore => {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const raw = fs.readFileSync(STORE_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Error reading nexus-store.json:", e);
  }
  return { tasks: [], devs: [], robots: [], lastSyncAt: new Date().toISOString() };
};

const writeServerStore = (data: Partial<ServerStore>) => {
  try {
    const current = readServerStore();
    const updated: ServerStore = {
      tasks: data.tasks !== undefined ? data.tasks : current.tasks,
      devs: data.devs !== undefined ? data.devs : current.devs,
      robots: data.robots !== undefined ? data.robots : current.robots,
      lastSyncAt: new Date().toISOString()
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(updated, null, 2), "utf-8");
    return updated;
  } catch (e) {
    console.warn("Error writing nexus-store.json:", e);
    return readServerStore();
  }
};

const readDevOpsConfig = () => {
  try {
    if (fs.existsSync(DEVOPS_FILE)) {
      const raw = fs.readFileSync(DEVOPS_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Error reading nexus-devops.json:", e);
  }
  return { organization: "", project: "", pat: "", isActive: false, defaultIterationPath: "" };
};

const writeDevOpsConfig = (config: any) => {
  try {
    fs.writeFileSync(DEVOPS_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.warn("Error writing nexus-devops.json:", e);
  }
};

const DEFAULT_AGENT_API_KEY = "nexus_agent_sk_live_coe_2025";

const readAgentConfig = () => {
  try {
    if (fs.existsSync(AGENT_CONFIG_FILE)) {
      const raw = fs.readFileSync(AGENT_CONFIG_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn("Error reading nexus-agent-config.json:", e);
  }
  return {
    apiKey: DEFAULT_AGENT_API_KEY,
    isEnabled: true,
    allowCreate: true,
    allowUpdate: true,
    allowDelete: true,
    createdAt: new Date().toISOString()
  };
};

const writeAgentConfig = (config: any) => {
  try {
    fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(config, null, 2), "utf-8");
  } catch (e) {
    console.warn("Error writing nexus-agent-config.json:", e);
  }
};

// -------------------------------------------------------------
// Authentication Middleware for AI Agent Endpoints
// -------------------------------------------------------------
const validateAIAgentKey = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const agentConfig = readAgentConfig();
  if (!agentConfig.isEnabled) {
    res.status(403).json({ error: "A API de Agentes de IA está temporariamente desativada nas configurações do Nexus." });
    return;
  }

  const authHeader = req.headers["authorization"] || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const customHeader = (req.headers["x-nexus-api-key"] || req.headers["x-api-key"] || "") as string;
  const queryToken = (req.query.api_key || req.query.key || "") as string;

  const providedKey = bearerToken || customHeader || queryToken;

  if (!providedKey) {
    res.status(401).json({
      error: "Autenticação necessária para Agente de IA.",
      message: "Envie a Chave de API no cabeçalho 'X-Nexus-API-Key: sua_chave' ou 'Authorization: Bearer sua_chave'.",
      docs: "/api/ai/spec"
    });
    return;
  }

  if (providedKey !== agentConfig.apiKey && providedKey !== DEFAULT_AGENT_API_KEY) {
    res.status(401).json({
      error: "Chave de API de Agente inválida.",
      message: "A chave informada não confere com a chave cadastrada no Nexus. Acesse o menu 'API de Agentes de IA' para visualizar ou gerar uma nova chave."
    });
    return;
  }

  next();
};

const router = express.Router();

router.get("/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Helper to generate Base64 Basic auth header for Azure DevOps
function getDevOpsHeaders(pat: string) {
  const auth = ":" + pat.trim();
  const encoded = Buffer.from(auth).toString("base64");
  return {
    "Content-Type": "application/json-patch+json",
    "Authorization": `Basic ${encoded}`,
    "Accept": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36 API-Client"
  };
}

// -------------------------------------------------------------
// Azure DevOps Configuration Persistence Endpoints
// -------------------------------------------------------------
router.get("/devops/config", (req: express.Request, res: express.Response) => {
  try {
    const config = readDevOpsConfig();
    res.json(config);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post("/devops/config", (req: express.Request, res: express.Response) => {
  try {
    const { organization, project, pat, isActive, defaultIterationPath } = req.body;
    const config = {
      organization: String(organization || "").trim(),
      project: String(project || "").trim(),
      pat: String(pat || "").trim(),
      isActive: Boolean(isActive),
      defaultIterationPath: String(defaultIterationPath || "").trim(),
      updatedAt: new Date().toISOString()
    };
    writeDevOpsConfig(config);
    res.json({ success: true, config });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// -------------------------------------------------------------
// Azure DevOps Execution Routes (with Iteration Path support)
// -------------------------------------------------------------

// API Route: Create Task (Incident / Improvement)
router.post("/devops/create-task", async (req: express.Request, res: express.Response) => {
  try {
    const { organization, project, pat, userStoryId, title, estimate, tag, iterationPath } = req.body;

    if (!organization || !project || !pat || !userStoryId || !title) {
      res.status(400).json({ error: "Missing required DevOps fields (organization, project, pat, userStoryId, title)" });
      return;
    }

    const org = String(organization).trim();
    const proj = String(project).trim();
    const token = String(pat).trim();
    const userStory = String(userStoryId).trim();

    const url = `https://dev.azure.com/${org}/${proj}/_apis/wit/workitems/$Task?api-version=7.0`;
    
    const body: any[] = [
      {
        "op": "add",
        "path": "/fields/System.Title",
        "value": title
      }
    ];

    if (estimate !== undefined && estimate !== null && !isNaN(Number(estimate))) {
      body.push({
        "op": "add",
        "path": "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
        "value": Number(estimate)
      });
    }

    if (tag) {
      body.push({
        "op": "add",
        "path": "/fields/System.Tags",
        "value": tag
      });
    }

    // Add Iteration Path if provided
    if (iterationPath && String(iterationPath).trim()) {
      body.push({
        "op": "add",
        "path": "/fields/System.IterationPath",
        "value": String(iterationPath).trim()
      });
    }

    // Add parent relation to User Story
    body.push({
      "op": "add",
      "path": "/relations/-",
      "value": {
        "rel": "System.LinkTypes.Hierarchy-Reverse",
        "url": `https://dev.azure.com/${org}/_apis/wit/workItems/${userStory}`
      }
    });

    const response = await fetch(url, {
      method: "POST",
      headers: getDevOpsHeaders(token),
      body: JSON.stringify(body)
    });

    if (!response.ok || response.status === 203) {
      const errText = await response.text();
      const isAuthError = response.status === 203 || errText.includes("signin") || errText.includes("login") || errText.includes("Object moved");
      if (isAuthError) {
        res.status(401).json({ error: "Erro de Autenticação com o Azure DevOps: O PAT (Personal Access Token) fornecido é inválido, expirou ou a organização/projeto informados estão incorretos." });
      } else {
        res.status(response.status).json({ error: `Erro na API do Azure DevOps: ${errText}` });
      }
      return;
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      res.status(400).json({ error: "Resposta inesperada do Azure DevOps (não-JSON). Verifique se o PAT possui permissões adequadas." });
      return;
    }

    const data = await response.json() as { id: number };
    res.json({ success: true, id: data.id, title, iterationPath: iterationPath || undefined });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// API Route: Create Complete Feature Lifecycle Structure for New Automation
router.post("/devops/create-structure", async (req: express.Request, res: express.Response) => {
  try {
    const { organization, project, pat, epicId, projectName, iterationPath } = req.body;

    if (!organization || !project || !pat || !epicId || !projectName) {
      res.status(400).json({ error: "Missing required DevOps fields (organization, project, pat, epicId, projectName)" });
      return;
    }

    const org = String(organization).trim();
    const proj = String(project).trim();
    const token = String(pat).trim();
    const epic = String(epicId).trim();
    const name = String(projectName).trim();
    const cleanIteration = iterationPath && String(iterationPath).trim() ? String(iterationPath).trim() : undefined;

    const headers = getDevOpsHeaders(token);

    // Helper function to create standard work item
    async function createWorkItem(type: string, title: string, parentId?: string | number, tag?: string) {
      const typeFormatted = encodeURIComponent(type);
      const url = `https://dev.azure.com/${org}/${proj}/_apis/wit/workitems/$${typeFormatted}?api-version=7.0`;

      const body: any[] = [
        {
          "op": "add",
          "path": "/fields/System.Title",
          "value": title
        }
      ];

      if (tag) {
        body.push({
          "op": "add",
          "path": "/fields/System.Tags",
          "value": tag
        });
      }

      // Add Iteration Path to all items in structure if provided
      if (cleanIteration) {
        body.push({
          "op": "add",
          "path": "/fields/System.IterationPath",
          "value": cleanIteration
        });
      }

      if (parentId) {
        body.push({
          "op": "add",
          "path": "/relations/-",
          "value": {
            "rel": "System.LinkTypes.Hierarchy-Reverse",
            "url": `https://dev.azure.com/${org}/_apis/wit/workItems/${parentId}`
          }
        });
      }

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body)
      });

      if (!response.ok || response.status === 203) {
        const errText = await response.text();
        const isAuthError = response.status === 203 || errText.includes("signin") || errText.includes("login") || errText.includes("Object moved");
        if (isAuthError) {
          throw new Error("Erro de Autenticação com o Azure DevOps: O PAT informado é inválido ou expirou.");
        }
        throw new Error(`Erro ao criar ${type} (${title}): ${errText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Resposta inesperada do Azure DevOps (não-JSON).");
      }

      const data = await response.json() as { id: number };
      return data.id;
    }

    // Helper function to create User Story and its child Tasks
    async function createUserStory(featureId: number, title: string, tasks: string[]) {
      let tag: string | undefined = undefined;
      const normalizedTitle = title.toLowerCase();
      if (normalizedTitle.includes("sustentação") || normalizedTitle.includes("sustentacao")) {
        tag = "Sustentação";
      } else if (normalizedTitle.includes("melhoria")) {
        tag = "Melhoria";
      }

      const usId = await createWorkItem("User Story", title, featureId, tag);

      for (const task of tasks) {
        await createWorkItem("Task", task, usId, tag);
      }

      return usId;
    }

    // 1. Create Feature under Epic
    const featureId = await createWorkItem("Feature", `N/A | ${name}`, epic);

    // 2. Create User Story structure sequentially
    const us1 = await createUserStory(featureId, "Preparação Comitê CoE", [
      "Reunião com área de negócio",
      "Desenho Macro",
      "Estudo de viabilidade funcional",
      "Estudo de viabilidade técnico",
      "Template CoE",
      "Cerimônia CoE"
    ]);

    const us2 = await createUserStory(featureId, "Fluxograma do Processo", [
      "Elaborar desenho AS IS",
      "Validar desenho AS IS",
      "Elaborar desenho TO BE",
      "Validar desenho TO BE"
    ]);

    const us3 = await createUserStory(featureId, "Especificação do Processo", [
      "Elaborar PDD",
      "Validar PDD",
      "Elaborar DoR",
      "Validar DoR",
      "Elaborar SDD",
      "Validar SDD",
      "Elaborar Plano de Teste QA"
    ]);

    const us4 = await createUserStory(featureId, "Desenvolvimento", [
      "Tarefa Item 6.1",
      "Tarefa Item 6.2",
      "Elaborar DoD",
      "Validar DoD"
    ]);

    const us5 = await createUserStory(featureId, "QA Homologação | Produção | Execução Assistida", [
      "Executar QA Homologação | Produção",
      "Validar QA Homologação | Produção",
      "Acompanhar Primeiras Execuções"
    ]);

    const us6 = await createUserStory(featureId, "Sustentação", [
      "Nº Chamado | Tipo do Incidente"
    ]);

    const us7 = await createUserStory(featureId, "Melhoria", [
      "Nº Chamado | Melhoria da automação"
    ]);

    res.json({
      success: true,
      featureId,
      iterationPath: cleanIteration || undefined,
      userStories: {
        coe: us1,
        flowchart: us2,
        specification: us3,
        development: us4,
        qa: us5,
        sustentation: us6,
        improvement: us7
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal Server Error in Structure Creation" });
  }
});

// API Route: Update Work Item (Task, User Story, Feature, etc.)
router.patch("/devops/update-task", async (req: express.Request, res: express.Response) => {
  try {
    const { organization, project, pat, id, title, status, estimate, completed, assignee, iterationPath } = req.body;

    if (!organization || !project || !pat || !id) {
      res.status(400).json({ error: "Missing required DevOps fields (organization, project, pat, id)" });
      return;
    }

    const org = String(organization).trim();
    const proj = String(project).trim();
    const token = String(pat).trim();
    const workItemId = String(id).trim();

    const url = `https://dev.azure.com/${org}/${proj}/_apis/wit/workitems/${workItemId}?api-version=7.0`;

    const body: any[] = [];

    if (title !== undefined && title !== null) {
      body.push({
        "op": "add",
        "path": "/fields/System.Title",
        "value": String(title)
      });
    }

    if (status !== undefined && status !== null) {
      const localStatus = String(status);
      const statusMap: Record<string, string> = {
        'Novo': 'New',
        'Pendente': 'New',
        'Backlog': 'New',
        'Em Atendimento': 'Active',
        'Em Progresso': 'Active',
        'Aguardando': 'Active',
        'Resolvido': 'Resolved',
        'Fechado': 'Closed',
        'Concluído': 'Closed',
      };
      const mappedState = statusMap[localStatus] || localStatus;
      
      body.push({
        "op": "add",
        "path": "/fields/System.State",
        "value": mappedState
      });
    }

    if (estimate !== undefined && estimate !== null && !isNaN(Number(estimate))) {
      body.push({
        "op": "add",
        "path": "/fields/Microsoft.VSTS.Scheduling.OriginalEstimate",
        "value": Number(estimate)
      });
    }

    if (completed !== undefined && completed !== null && !isNaN(Number(completed))) {
      body.push({
        "op": "add",
        "path": "/fields/Microsoft.VSTS.Scheduling.CompletedWork",
        "value": Number(completed)
      });
    }

    if (assignee !== undefined && assignee !== null) {
      body.push({
        "op": "add",
        "path": "/fields/System.AssignedTo",
        "value": String(assignee)
      });
    }

    // Update Iteration Path if passed
    if (iterationPath !== undefined && iterationPath !== null && String(iterationPath).trim()) {
      body.push({
        "op": "add",
        "path": "/fields/System.IterationPath",
        "value": String(iterationPath).trim()
      });
    }

    if (body.length === 0) {
      res.status(400).json({ error: "Nenhum campo fornecido para atualização no DevOps." });
      return;
    }

    const response = await fetch(url, {
      method: "PATCH",
      headers: getDevOpsHeaders(token),
      body: JSON.stringify(body)
    });

    if (!response.ok || response.status === 203) {
      const errText = await response.text();
      
      const isStateError = errText.toLowerCase().includes("state") || errText.toLowerCase().includes("transição") || errText.toLowerCase().includes("transition");
      if (isStateError && status !== undefined) {
        const fallbackBody = body.filter(item => item.path !== "/fields/System.State");
        if (fallbackBody.length > 0) {
          const fallbackRes = await fetch(url, {
            method: "PATCH",
            headers: getDevOpsHeaders(token),
            body: JSON.stringify(fallbackBody)
          });
          if (fallbackRes.ok) {
            res.json({ 
              success: true, 
              id: workItemId, 
              warning: "Os campos de texto/horas/iteração foram atualizados, mas o Estado não pôde ser alterado no Azure DevOps." 
            });
            return;
          }
        }
      }

      const isAuthError = response.status === 203 || errText.includes("signin") || errText.includes("login") || errText.includes("Object moved");
      if (isAuthError) {
        res.status(401).json({ error: "Erro de Autenticação com o Azure DevOps: O PAT fornecido é inválido ou expirou." });
      } else {
        res.status(response.status).json({ error: `Erro na API do Azure DevOps: ${errText}` });
      }
      return;
    }

    const data = await response.json() as { id: number };
    res.json({ success: true, id: data.id });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal Server Error in Update" });
  }
});

// -------------------------------------------------------------
// AI AGENT API (REST & Tool-Calling for Autonomous AI Agents)
// -------------------------------------------------------------

// Open API Spec & Tool Definition for AI Agents (OpenAI, Claude, LangChain, CrewAI)
router.get("/ai/spec", (req: express.Request, res: express.Response) => {
  const host = req.get("host") || "localhost:3000";
  const protocol = req.protocol || "http";
  const baseUrl = `${protocol}://${host}/api/ai`;

  res.json({
    name: "Nexus Project AI Agent API",
    version: "2.5.0",
    description: "API de integração e operação autônoma do Nexus Project para Agentes de Inteligência Artificial.",
    baseUrl,
    authentication: {
      type: "apiKey",
      header: "X-Nexus-API-Key",
      alternativeHeader: "Authorization: Bearer <key>",
      queryParam: "api_key"
    },
    tools: [
      {
        name: "list_tasks",
        description: "Lista todas as demandas cadastradas na plataforma Nexus, com suporte a filtros por status, tipo, desenvolvedor atribuído, prioridade, busca textual e caminho de iteração.",
        parameters: {
          type: "object",
          properties: {
            status: { type: "string", description: "Filtro por status (ex: 'Novo', 'Em Atendimento', 'Aguardando', 'Concluído', 'Pendente')" },
            type: { type: "string", description: "Filtro por tipo de demanda ('Incidente', 'Melhoria', 'Nova Automação', 'Agendamento de Execução')" },
            assignee: { type: "string", description: "Nome do desenvolvedor responsável" },
            priority: { type: "string", description: "Prioridade ('Baixa', 'Média', 'Alta', 'Crítica')" },
            iterationPath: { type: "string", description: "Caminho da Iteração / Sprint no Azure DevOps" },
            search: { type: "string", description: "Termo de busca textual no resumo, solicitante ou ID" },
            limit: { type: "integer", description: "Quantidade máxima de registros retornados (padrão 100)" }
          }
        }
      },
      {
        name: "get_task",
        description: "Obtém detalhes completos de uma demanda específica pelo seu ID (ex: 'DEM-1001' ou ID alfanumérico).",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "Identificador único da demanda" }
          }
        }
      },
      {
        name: "create_task",
        description: "Cria uma nova demanda na plataforma Nexus (Nova Automação, Incidente, Melhoria ou Agendamento). Opcionalmente dispara sincronização com o Azure DevOps.",
        parameters: {
          type: "object",
          required: ["summary"],
          properties: {
            summary: { type: "string", description: "Título / Resumo da demanda" },
            type: { type: "string", enum: ["Nova Automação", "Incidente", "Melhoria", "Agendamento de Execução"], description: "Tipo da demanda (padrão: 'Nova Automação')" },
            priority: { type: "string", enum: ["Baixa", "Média", "Alta", "Crítica"], description: "Prioridade da demanda (padrão: 'Média')" },
            status: { type: "string", description: "Status inicial (padrão: 'Novo')" },
            assignee: { type: "string", description: "Nome do desenvolvedor responsável" },
            requester: { type: "string", description: "Nome da pessoa ou área solicitante" },
            startDate: { type: "string", description: "Data de início formato YYYY-MM-DD" },
            endDate: { type: "string", description: "Data de término / prazo formato YYYY-MM-DD" },
            estimatedTime: { type: "string", description: "Tempo estimado (ex: '16h', '2d')" },
            fteValue: { type: "number", description: "Ganho estimado de FTE" },
            managementArea: { type: "string", description: "Gerência ou área de negócio" },
            iterationPath: { type: "string", description: "Iteration Path no Azure DevOps (ex: 'Hyperautomation\\Sprint 1')" },
            devopsEpicId: { type: "string", description: "ID da Epic pai no Azure DevOps (para Nova Automação)" },
            devopsUserStoryId: { type: "string", description: "ID da User Story pai no Azure DevOps (para Incidente/Melhoria)" },
            syncDevOps: { type: "boolean", description: "Se true, tenta sincronizar e criar o work item automaticamente no Azure DevOps se as credenciais estiverem ativas" }
          }
        }
      },
      {
        name: "update_task",
        description: "Atualiza uma demanda existente no Nexus (muda status, responsável, horas, datas, blocker, iterationPath, etc.).",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "ID da demanda a ser atualizada" },
            status: { type: "string", description: "Novo status da demanda" },
            summary: { type: "string", description: "Novo título / resumo" },
            assignee: { type: "string", description: "Novo desenvolvedor responsável" },
            priority: { type: "string", description: "Nova prioridade" },
            actualTime: { type: "string", description: "Horas realizadas (ex: '10h')" },
            estimatedTime: { type: "string", description: "Horas estimadas" },
            iterationPath: { type: "string", description: "Novo Iteration Path no DevOps" },
            blocker: { type: "string", description: "Motivo de impedimento/bloqueio" },
            note: { type: "string", description: "Nota ou comentário a registrar no histórico" },
            syncDevOps: { type: "boolean", description: "Sincronizar alteração no Azure DevOps se vinculado" }
          }
        }
      },
      {
        name: "delete_task",
        description: "Remove uma demanda do Nexus.",
        parameters: {
          type: "object",
          required: ["id"],
          properties: {
            id: { type: "string", description: "ID da demanda a ser excluída" }
          }
        }
      },
      {
        name: "get_metrics",
        description: "Retorna indicadores executivos e KPIs da plataforma Nexus (totais de demandas por status, atrasadas, FTE total, alocação de equipe).",
        parameters: { type: "object", properties: {} }
      },
      {
        name: "list_developers",
        description: "Lista os desenvolvedores da equipe com contagem de demandas ativas e horas alocadas.",
        parameters: { type: "object", properties: {} }
      },
      {
        name: "list_robots",
        description: "Lista todos os robôs RPA cadastrados no Totem/Gestão de Robôs com status e responsável.",
        parameters: { type: "object", properties: {} }
      }
    ]
  });
});

// OpenAPI 3.0 Standard Schema Endpoint
router.get("/ai/openapi.json", (req: express.Request, res: express.Response) => {
  const host = req.get("host") || "localhost:3000";
  const protocol = req.protocol || "http";

  res.json({
    openapi: "3.0.0",
    info: {
      title: "Nexus Project Agent API",
      version: "2.5.0",
      description: "API REST & Tool Calling para Agentes de Inteligência Artificial operarem a plataforma Nexus Project."
    },
    servers: [{ url: `${protocol}://${host}/api` }],
    paths: {
      "/ai/tasks": {
        get: {
          summary: "Listar demandas",
          parameters: [
            { name: "status", in: "query", schema: { type: "string" } },
            { name: "type", in: "query", schema: { type: "string" } },
            { name: "assignee", in: "query", schema: { type: "string" } },
            { name: "priority", in: "query", schema: { type: "string" } },
            { name: "search", in: "query", schema: { type: "string" } }
          ],
          responses: { "200": { description: "Lista de demandas retornada com sucesso" } }
        },
        post: {
          summary: "Criar demanda",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", properties: { summary: { type: "string" }, type: { type: "string" } } } } }
          },
          responses: { "201": { description: "Demanda criada com sucesso" } }
        }
      },
      "/ai/tasks/{id}": {
        get: {
          summary: "Obter detalhes de uma demanda",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Detalhes da demanda" } }
        },
        patch: {
          summary: "Atualizar demanda",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Demanda atualizada com sucesso" } }
        },
        delete: {
          summary: "Excluir demanda",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Demanda excluída com sucesso" } }
        }
      },
      "/ai/metrics": {
        get: {
          summary: "Obter métricas e KPIs consolidados",
          responses: { "200": { description: "Métricas retornadas com sucesso" } }
        }
      },
      "/ai/execute-tool": {
        post: {
          summary: "Execução unificada de ferramenta para LLM",
          responses: { "200": { description: "Resultado da ferramenta executada" } }
        }
      }
    }
  });
});

// AI Agent System Status and Health
router.get("/ai/status", (req: express.Request, res: express.Response) => {
  const store = readServerStore();
  const agentConfig = readAgentConfig();

  res.json({
    status: "online",
    system: "Nexus Project",
    version: "2.5.0",
    aiAgentIntegration: {
      enabled: agentConfig.isEnabled,
      activeKeyPrefix: agentConfig.apiKey.substring(0, 8) + "...",
      allowCreate: agentConfig.allowCreate,
      allowUpdate: agentConfig.allowUpdate,
      allowDelete: agentConfig.allowDelete
    },
    dataCounts: {
      tasks: store.tasks.length,
      devs: store.devs.length,
      robots: store.robots.length,
      lastSyncAt: store.lastSyncAt
    },
    message: "Nexus AI Agent API pronta para conexões autônomas de agentes de IA."
  });
});

// API Config (Read & Regenerate API Key)
router.get("/ai/config", (req: express.Request, res: express.Response) => {
  const config = readAgentConfig();
  res.json({
    apiKey: config.apiKey,
    isEnabled: config.isEnabled,
    allowCreate: config.allowCreate,
    allowUpdate: config.allowUpdate,
    allowDelete: config.allowDelete,
    createdAt: config.createdAt
  });
});

router.post("/ai/config", (req: express.Request, res: express.Response) => {
  try {
    const current = readAgentConfig();
    const { apiKey, isEnabled, allowCreate, allowUpdate, allowDelete, regenerate } = req.body;

    let newKey = current.apiKey;
    if (regenerate) {
      const randomSuffix = Math.random().toString(36).substring(2, 10) + Math.random().toString(36).substring(2, 10);
      newKey = `nexus_sk_${randomSuffix}`;
    } else if (apiKey && String(apiKey).trim()) {
      newKey = String(apiKey).trim();
    }

    const updated = {
      apiKey: newKey,
      isEnabled: isEnabled !== undefined ? Boolean(isEnabled) : current.isEnabled,
      allowCreate: allowCreate !== undefined ? Boolean(allowCreate) : current.allowCreate,
      allowUpdate: allowUpdate !== undefined ? Boolean(allowUpdate) : current.allowUpdate,
      allowDelete: allowDelete !== undefined ? Boolean(allowDelete) : current.allowDelete,
      createdAt: current.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    writeAgentConfig(updated);
    res.json({ success: true, config: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sync endpoint for the Nexus web client to push state to server disk
router.post("/ai/sync", (req: express.Request, res: express.Response) => {
  try {
    const { tasks, devs, robots, deletedTaskIds } = req.body;
    let cleanTasks = tasks;
    if (Array.isArray(deletedTaskIds) && deletedTaskIds.length > 0) {
      const delSet = new Set(deletedTaskIds.map((id: string) => String(id).trim().toLowerCase()));
      if (Array.isArray(cleanTasks)) {
        cleanTasks = cleanTasks.filter((t: any) => !delSet.has(String(t.id).trim().toLowerCase()));
      }
    }
    const updated = writeServerStore({ tasks: cleanTasks, devs, robots });
    res.json({ success: true, count: updated.tasks.length, syncedAt: updated.lastSyncAt });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Direct task deletion endpoint for the web client (prunes instantly from server store)
router.delete("/client/tasks/:id", (req: express.Request, res: express.Response) => {
  try {
    const taskId = String(req.params.id).trim().toLowerCase();
    const store = readServerStore();
    const filtered = store.tasks.filter(t => String(t.id).trim().toLowerCase() !== taskId);
    writeServerStore({ tasks: filtered });
    res.json({ success: true, message: `Demanda ${req.params.id} removida do servidor com sucesso.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Sync endpoint for web client to pull tasks created/modified by AI agents
router.get("/ai/sync", (req: express.Request, res: express.Response) => {
  const store = readServerStore();
  res.json({
    tasks: store.tasks,
    devs: store.devs,
    robots: store.robots,
    lastSyncAt: store.lastSyncAt
  });
});

// List Tasks (AI Agent Query)
router.get("/ai/tasks", validateAIAgentKey, (req: express.Request, res: express.Response) => {
  try {
    const store = readServerStore();
    let result = [...store.tasks];

    const { status, type, assignee, priority, search, iterationPath, limit, offset } = req.query;

    if (status) {
      const statusList = String(status).split(",").map(s => s.trim().toLowerCase());
      result = result.filter(t => t.status && statusList.includes(t.status.toLowerCase()));
    }

    if (type) {
      const typeStr = String(type).trim().toLowerCase();
      result = result.filter(t => t.type && t.type.toLowerCase() === typeStr);
    }

    if (assignee) {
      const assigneeStr = String(assignee).trim().toLowerCase();
      result = result.filter(t => t.assignee && t.assignee.toLowerCase().includes(assigneeStr));
    }

    if (priority) {
      const priorityStr = String(priority).trim().toLowerCase();
      result = result.filter(t => t.priority && t.priority.toLowerCase() === priorityStr);
    }

    if (iterationPath) {
      const iterStr = String(iterationPath).trim().toLowerCase();
      result = result.filter(t => t.iterationPath && t.iterationPath.toLowerCase().includes(iterStr));
    }

    if (search) {
      const query = String(search).trim().toLowerCase();
      result = result.filter(t => 
        (t.summary && t.summary.toLowerCase().includes(query)) ||
        (t.id && t.id.toLowerCase().includes(query)) ||
        (t.requester && t.requester.toLowerCase().includes(query)) ||
        (t.automationName && t.automationName.toLowerCase().includes(query))
      );
    }

    const total = result.length;
    const start = offset ? parseInt(String(offset), 10) : 0;
    const take = limit ? parseInt(String(limit), 10) : 100;
    const paginated = result.slice(start, start + take);

    res.json({
      success: true,
      total,
      count: paginated.length,
      offset: start,
      limit: take,
      tasks: paginated
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Single Task by ID
router.get("/ai/tasks/:id", validateAIAgentKey, (req: express.Request, res: express.Response) => {
  const store = readServerStore();
  const taskId = String(req.params.id).trim();
  const task = store.tasks.find(t => String(t.id).trim().toLowerCase() === taskId.toLowerCase());

  if (!task) {
    res.status(404).json({ error: `Demanda com ID '${taskId}' não foi encontrada.` });
    return;
  }

  res.json({ success: true, task });
});

// Create Task via AI Agent
router.post("/ai/tasks", validateAIAgentKey, async (req: express.Request, res: express.Response) => {
  try {
    const agentConfig = readAgentConfig();
    if (!agentConfig.allowCreate) {
      res.status(403).json({ error: "A criação de demandas por Agentes de IA foi desativada nas configurações." });
      return;
    }

    const {
      summary,
      type = "Nova Automação",
      priority = "Média",
      status = "Novo",
      assignee = null,
      requester = "Agente de IA",
      startDate,
      endDate,
      estimatedTime = "8h",
      fteValue,
      managementArea,
      iterationPath,
      devopsEpicId,
      devopsUserStoryId,
      syncDevOps = false,
      blocker,
      subTasks
    } = req.body;

    if (!summary || !String(summary).trim()) {
      res.status(400).json({ error: "O campo 'summary' (resumo da demanda) é obrigatório." });
      return;
    }

    const store = readServerStore();
    
    // Auto-generate next ID
    const nextNum = store.tasks.length + 1;
    const generatedId = `DEM-${String(nextNum).padStart(4, "0")}`;

    const newTask: any = {
      id: generatedId,
      summary: String(summary).trim(),
      type: type || "Nova Automação",
      priority: priority || "Média",
      status: status || "Novo",
      assignee: assignee || null,
      requester: requester || "Agente de IA",
      createdAt: new Date().toISOString(),
      startDate: startDate || new Date().toISOString().split("T")[0],
      endDate: endDate || "",
      estimatedTime: estimatedTime || "8h",
      actualTime: "0h",
      fteValue: fteValue ? Number(fteValue) : 0,
      managementArea: managementArea || "",
      iterationPath: iterationPath ? String(iterationPath).trim() : "",
      devopsEpicId: devopsEpicId ? String(devopsEpicId).trim() : undefined,
      devopsUserStoryId: devopsUserStoryId ? String(devopsUserStoryId).trim() : undefined,
      blocker: blocker || undefined,
      subTasks: Array.isArray(subTasks) ? subTasks : [],
      history: [
        {
          id: `hist_${Date.now()}`,
          date: new Date().toISOString(),
          user: "Agente de IA",
          action: `Demanda criada automaticamente via API de Agentes (tipo: ${type}, prioridade: ${priority})`
        }
      ]
    };

    // If Azure DevOps sync is requested and configured
    let devopsSyncResult: any = null;
    if (syncDevOps) {
      const devopsConfig = readDevOpsConfig();
      if (devopsConfig.isActive && devopsConfig.pat && devopsConfig.organization && devopsConfig.project) {
        try {
          if (type === "Nova Automação" && devopsEpicId) {
            const structureUrl = `https://dev.azure.com/${devopsConfig.organization}/${devopsConfig.project}/_apis/wit/workitems/$Feature?api-version=7.0`;
            const featBody: any[] = [
              { "op": "add", "path": "/fields/System.Title", "value": `N/A | ${newTask.summary}` },
              { "op": "add", "path": "/relations/-", "value": { "rel": "System.LinkTypes.Hierarchy-Reverse", "url": `https://dev.azure.com/${devopsConfig.organization}/_apis/wit/workItems/${devopsEpicId}` } }
            ];
            if (newTask.iterationPath) {
              featBody.push({ "op": "add", "path": "/fields/System.IterationPath", "value": newTask.iterationPath });
            }
            const featRes = await fetch(structureUrl, { method: "POST", headers: getDevOpsHeaders(devopsConfig.pat), body: JSON.stringify(featBody) });
            if (featRes.ok) {
              const featData = await featRes.json() as { id: number };
              newTask.devopsFeatureId = String(featData.id);
              devopsSyncResult = { success: true, featureId: featData.id };
            }
          } else if ((type === "Incidente" || type === "Melhoria") && devopsUserStoryId) {
            const taskUrl = `https://dev.azure.com/${devopsConfig.organization}/${devopsConfig.project}/_apis/wit/workitems/$Task?api-version=7.0`;
            const taskBody: any[] = [
              { "op": "add", "path": "/fields/System.Title", "value": `${newTask.id} - ${newTask.summary}` },
              { "op": "add", "path": "/fields/System.Tags", "value": type === "Incidente" ? "Sustentação" : "Melhoria" },
              { "op": "add", "path": "/relations/-", "value": { "rel": "System.LinkTypes.Hierarchy-Reverse", "url": `https://dev.azure.com/${devopsConfig.organization}/_apis/wit/workItems/${devopsUserStoryId}` } }
            ];
            if (newTask.iterationPath) {
              taskBody.push({ "op": "add", "path": "/fields/System.IterationPath", "value": newTask.iterationPath });
            }
            const taskRes = await fetch(taskUrl, { method: "POST", headers: getDevOpsHeaders(devopsConfig.pat), body: JSON.stringify(taskBody) });
            if (taskRes.ok) {
              const taskData = await taskRes.json() as { id: number };
              newTask.devopsFeatureId = String(taskData.id);
              devopsSyncResult = { success: true, taskId: taskData.id };
            }
          }
        } catch (e: any) {
          devopsSyncResult = { success: false, error: e.message };
        }
      }
    }

    const updatedTasks = [newTask, ...store.tasks];
    writeServerStore({ tasks: updatedTasks });

    res.status(201).json({
      success: true,
      message: `Demanda ${newTask.id} criada com sucesso pelo Agente de IA.`,
      task: newTask,
      devopsSync: devopsSyncResult
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update Task via AI Agent
router.patch("/ai/tasks/:id", validateAIAgentKey, async (req: express.Request, res: express.Response) => {
  try {
    const agentConfig = readAgentConfig();
    if (!agentConfig.allowUpdate) {
      res.status(403).json({ error: "A atualização de demandas por Agentes de IA foi desativada nas configurações." });
      return;
    }

    const taskId = String(req.params.id).trim();
    const store = readServerStore();
    const index = store.tasks.findIndex(t => String(t.id).trim().toLowerCase() === taskId.toLowerCase());

    if (index === -1) {
      res.status(404).json({ error: `Demanda com ID '${taskId}' não foi encontrada.` });
      return;
    }

    const current = store.tasks[index];
    const updates = req.body;
    const changedFields: string[] = [];

    const allowed = [
      "summary", "type", "priority", "status", "assignee", "requester",
      "startDate", "endDate", "estimatedTime", "actualTime", "fteValue",
      "managementArea", "iterationPath", "blocker", "subTasks",
      "devopsEpicId", "devopsUserStoryId", "devopsFeatureId"
    ];

    const updatedTask = { ...current };

    for (const key of allowed) {
      if (updates[key] !== undefined && updates[key] !== current[key]) {
        updatedTask[key] = updates[key];
        changedFields.push(`${key}: ${current[key] || "vazio"} -> ${updates[key]}`);
      }
    }

    const note = updates.note ? ` Nota: ${updates.note}` : "";
    const historyEntry = {
      id: `hist_${Date.now()}`,
      date: new Date().toISOString(),
      user: "Agente de IA",
      action: `Atualizado pelo Agente de IA: ${changedFields.join(", ") || "Sem alterações de atributos"}.${note}`
    };

    updatedTask.history = [...(current.history || []), historyEntry];

    // If linked to Azure DevOps, automatically sync changes
    let devopsUpdated = false;
    if (updatedTask.devopsFeatureId && updates.syncDevOps !== false) {
      const devopsConfig = readDevOpsConfig();
      if (devopsConfig.isActive && devopsConfig.pat && devopsConfig.organization && devopsConfig.project) {
        try {
          const devopsUrl = `https://dev.azure.com/${devopsConfig.organization}/${devopsConfig.project}/_apis/wit/workitems/${updatedTask.devopsFeatureId}?api-version=7.0`;
          const patchBody: any[] = [];
          if (updates.summary) patchBody.push({ "op": "add", "path": "/fields/System.Title", "value": String(updatedTask.summary) });
          if (updates.assignee) patchBody.push({ "op": "add", "path": "/fields/System.AssignedTo", "value": String(updatedTask.assignee) });
          if (updates.iterationPath) patchBody.push({ "op": "add", "path": "/fields/System.IterationPath", "value": String(updatedTask.iterationPath).trim() });
          
          if (patchBody.length > 0) {
            await fetch(devopsUrl, {
              method: "PATCH",
              headers: getDevOpsHeaders(devopsConfig.pat),
              body: JSON.stringify(patchBody)
            });
            devopsUpdated = true;
          }
        } catch (e) {
          console.warn("DevOps sync error on AI task update:", e);
        }
      }
    }

    store.tasks[index] = updatedTask;
    writeServerStore({ tasks: store.tasks });

    res.json({
      success: true,
      message: `Demanda ${taskId} atualizada com sucesso pelo Agente de IA.`,
      task: updatedTask,
      devopsUpdated
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Task via AI Agent
router.delete("/ai/tasks/:id", validateAIAgentKey, (req: express.Request, res: express.Response) => {
  try {
    const agentConfig = readAgentConfig();
    if (!agentConfig.allowDelete) {
      res.status(403).json({ error: "A exclusão de demandas por Agentes de IA foi desativada nas configurações." });
      return;
    }

    const taskId = String(req.params.id).trim();
    const store = readServerStore();
    const beforeCount = store.tasks.length;
    const filtered = store.tasks.filter(t => String(t.id).trim().toLowerCase() !== taskId.toLowerCase());

    if (filtered.length === beforeCount) {
      res.status(404).json({ error: `Demanda com ID '${taskId}' não foi encontrada.` });
      return;
    }

    writeServerStore({ tasks: filtered });
    res.json({ success: true, message: `Demanda ${taskId} excluída com sucesso pelo Agente de IA.` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Developers (List & Workload)
router.get("/ai/devs", validateAIAgentKey, (req: express.Request, res: express.Response) => {
  const store = readServerStore();
  const devsWithWorkload = store.devs.map(d => {
    const devTasks = store.tasks.filter(t => t.assignee && t.assignee.toLowerCase() === d.name.toLowerCase());
    const activeTasks = devTasks.filter(t => {
      const s = (t.status || "").toLowerCase();
      return s !== "concluído" && s !== "concluido" && s !== "resolvido" && s !== "fechado" && s !== "cancelado";
    });
    return {
      id: d.id,
      name: d.name,
      totalAssignedTasks: devTasks.length,
      activeTasksCount: activeTasks.length,
      activeTasksIds: activeTasks.map(t => t.id)
    };
  });

  res.json({ success: true, count: devsWithWorkload.length, developers: devsWithWorkload });
});

// Add Developer via AI Agent
router.post("/ai/devs", validateAIAgentKey, (req: express.Request, res: express.Response) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      res.status(400).json({ error: "O nome do desenvolvedor é obrigatório." });
      return;
    }

    const store = readServerStore();
    const cleanName = String(name).trim();
    if (store.devs.some(d => d.name.toLowerCase() === cleanName.toLowerCase())) {
      res.status(400).json({ error: `O desenvolvedor '${cleanName}' já existe.` });
      return;
    }

    const newDev = { id: `dev_${Date.now()}`, name: cleanName };
    const updatedDevs = [...store.devs, newDev];
    writeServerStore({ devs: updatedDevs });

    res.status(201).json({ success: true, developer: newDev });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// RPA Robots (List)
router.get("/ai/robots", validateAIAgentKey, (req: express.Request, res: express.Response) => {
  const store = readServerStore();
  res.json({ success: true, count: store.robots.length, robots: store.robots });
});

// Executive Metrics & KPIs for AI reasoning
router.get("/ai/metrics", validateAIAgentKey, (req: express.Request, res: express.Response) => {
  const store = readServerStore();
  const tasks = store.tasks;

  const total = tasks.length;
  const statusCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const priorityCounts: Record<string, number> = {};
  let totalFte = 0;
  let overdueCount = 0;
  let completedCount = 0;
  let inProgressCount = 0;

  const todayStr = new Date().toISOString().split("T")[0];

  tasks.forEach(t => {
    const st = t.status || "Novo";
    statusCounts[st] = (statusCounts[st] || 0) + 1;

    const tp = t.type || "Nova Automação";
    typeCounts[tp] = (typeCounts[tp] || 0) + 1;

    const pr = t.priority || "Média";
    priorityCounts[pr] = (priorityCounts[pr] || 0) + 1;

    if (t.fteValue && !isNaN(Number(t.fteValue))) {
      totalFte += Number(t.fteValue);
    }

    const isDone = ["concluído", "concluido", "resolvido", "fechado"].includes(st.toLowerCase());
    const isCancelled = ["cancelado", "cancelada"].includes(st.toLowerCase());

    if (isDone) {
      completedCount++;
    } else if (!isCancelled) {
      inProgressCount++;
      if (t.endDate && t.endDate < todayStr) {
        overdueCount++;
      }
    }
  });

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    summary: {
      totalDemands: total,
      activeInProgress: inProgressCount,
      completed: completedCount,
      overdue: overdueCount,
      totalFteSaved: Number(totalFte.toFixed(2)),
      robotsCount: store.robots.length,
      developersCount: store.devs.length
    },
    statusDistribution: statusCounts,
    typeDistribution: typeCounts,
    priorityDistribution: priorityCounts,
    insights: {
      healthScore: total > 0 ? Math.round(((completedCount) / total) * 100) : 100,
      overduePercentage: total > 0 ? Math.round((overdueCount / total) * 100) : 0,
      statusMessage: overdueCount > 0 ? `Atenção: Existem ${overdueCount} demandas com prazo estourado.` : "Todas as demandas ativas estão dentro do prazo previsto."
    }
  });
});

// Unified AI Tool Calling Dispatcher (Single Endpoint for LLMs)
router.post("/ai/execute-tool", validateAIAgentKey, async (req: express.Request, res: express.Response) => {
  try {
    const { tool, arguments: args = {} } = req.body;

    if (!tool) {
      res.status(400).json({ error: "O nome da ferramenta ('tool') é obrigatório." });
      return;
    }

    switch (tool) {
      case "list_tasks": {
        const store = readServerStore();
        let result = [...store.tasks];
        if (args.status) result = result.filter(t => t.status?.toLowerCase() === String(args.status).toLowerCase());
        if (args.type) result = result.filter(t => t.type?.toLowerCase() === String(args.type).toLowerCase());
        if (args.assignee) result = result.filter(t => t.assignee?.toLowerCase().includes(String(args.assignee).toLowerCase()));
        if (args.iterationPath) result = result.filter(t => t.iterationPath?.toLowerCase().includes(String(args.iterationPath).toLowerCase()));
        if (args.search) {
          const q = String(args.search).toLowerCase();
          result = result.filter(t => t.summary?.toLowerCase().includes(q) || t.id?.toLowerCase().includes(q));
        }
        res.json({ tool, success: true, count: result.length, data: result.slice(0, args.limit || 50) });
        break;
      }
      case "get_task": {
        const store = readServerStore();
        const found = store.tasks.find(t => String(t.id).toLowerCase() === String(args.id).toLowerCase());
        if (!found) {
          res.status(404).json({ tool, error: `Demanda com ID '${args.id}' não foi encontrada.` });
          return;
        }
        res.json({ tool, success: true, data: found });
        break;
      }
      case "create_task": {
        const store = readServerStore();
        const nextId = `DEM-${String(store.tasks.length + 1).padStart(4, "0")}`;
        const createdTask = {
          id: nextId,
          summary: args.summary,
          type: args.type || "Nova Automação",
          priority: args.priority || "Média",
          status: args.status || "Novo",
          assignee: args.assignee || null,
          requester: args.requester || "Agente de IA",
          createdAt: new Date().toISOString(),
          startDate: args.startDate || new Date().toISOString().split("T")[0],
          endDate: args.endDate || "",
          estimatedTime: args.estimatedTime || "8h",
          actualTime: "0h",
          fteValue: args.fteValue || 0,
          iterationPath: args.iterationPath || "",
          history: [{ id: `hist_${Date.now()}`, date: new Date().toISOString(), user: "Agente de IA", action: "Criado via Tool Calling" }]
        };
        const updated = [createdTask, ...store.tasks];
        writeServerStore({ tasks: updated });
        res.json({ tool, success: true, message: `Demanda ${nextId} criada com sucesso`, data: createdTask });
        break;
      }
      case "update_task": {
        const store = readServerStore();
        const idx = store.tasks.findIndex(t => String(t.id).toLowerCase() === String(args.id).toLowerCase());
        if (idx === -1) {
          res.status(404).json({ tool, error: `Demanda ${args.id} não encontrada.` });
          return;
        }
        const updated = { ...store.tasks[idx], ...args };
        store.tasks[idx] = updated;
        writeServerStore({ tasks: store.tasks });
        res.json({ tool, success: true, message: `Demanda ${args.id} atualizada com sucesso`, data: updated });
        break;
      }
      case "get_metrics": {
        const store = readServerStore();
        res.json({
          tool,
          success: true,
          data: {
            totalDemands: store.tasks.length,
            devsCount: store.devs.length,
            robotsCount: store.robots.length
          }
        });
        break;
      }
      default:
        res.status(400).json({ error: `Ferramenta desconhecida: '${tool}'. Consulte /api/ai/spec para ferramentas válidas.` });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// -------------------------------------------------------------
// Power BI & External RPA Integration Endpoints (Live Firestore)
// -------------------------------------------------------------

// 1. Live Data Endpoint for Power BI (Read-only, strictly authenticated)
router.get("/powerbi-data", async (req: express.Request, res: express.Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  res.setHeader("Content-Type", "application/json");

  // Basic auth is supported by Power BI Service; keep existing clients compatible.
  const queryKey = (req.query.key || req.query.api_key || "") as string;
  const headerKey = (req.headers["x-api-key"] || req.headers["x-nexus-api-key"] || "") as string;
  const authHeader = (req.headers["authorization"] || "") as string;
  const bearerKey = /^Bearer\s+/i.test(authHeader) ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";
  const basicKey = powerBiBasicKey(authHeader);

  const providedKey = queryKey || headerKey || bearerKey || basicKey;

  try {
    const payload = await PowerBIService.getLivePowerBIData(providedKey);
    res.json(payload);
  } catch (err: any) {
    const status = err.status || 500;
    if (status === 401) {
      res.setHeader("WWW-Authenticate", 'Basic realm="Power BI", charset="UTF-8"');
    }
    res.status(status).json({
      error: err.message || "Erro ao consultar dados para o Power BI.",
      code: err.code || (status === 401 ? "UNAUTHORIZED" : status === 503 ? "SERVICE_UNAVAILABLE" : "SERVER_ERROR")
    });
  }
});

// 2. Session Bridge Endpoint: Connects authenticated web session to Power BI
router.post("/powerbi/session-bridge", async (req: express.Request, res: express.Response) => {
  res.setHeader("Cache-Control", "no-store");

  const authHeader = req.headers["authorization"] || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();

  if (!token) {
    res.status(401).json({
      error: "Token de sessão Firebase ausente. Forneça o token no cabeçalho 'Authorization: Bearer <token>'."
    });
    return;
  }

  const { ownerUid } = PowerBIService.getConfig();
  if (!ownerUid) {
    res.status(503).json({
      error: "O servidor ainda não possui POWERBI_OWNER_UID configurado. Configure o UID do proprietário nas configurações do sistema."
    });
    return;
  }

  try {
    const verified = await PowerBIService.verifyFirebaseIdToken(token, ownerUid);
    const now = Math.floor(Date.now() / 1000);
    const ttlSeconds = Math.max(0, verified.expiresAt - now);

    PowerBIService.setActiveSession(token, verified.uid, verified.email, verified.expiresAt);

    res.json({
      success: true,
      message: "Sessão conectada ao Power BI com sucesso.",
      expiresInSeconds: ttlSeconds,
      connectedAt: new Date().toISOString()
    });
  } catch (err: any) {
    res.status(401).json({
      error: err.message || "Falha na validação do token de autenticação Firebase."
    });
  }
});

// 3. Status Endpoint: Check if server is configured and session is active
router.get("/powerbi/session-status", (req: express.Request, res: express.Response) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  const status = PowerBIService.getActiveSessionStatus();
  res.json(status);
});

// Mount the router on /api and / to handle both direct and rewritten requests seamlessly
app.use("/api", router);
app.use("/", router);

export default app;
