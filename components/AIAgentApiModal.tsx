import React, { useState, useEffect } from 'react';
import { IconBot, IconKey, IconCopy, IconCode, IconCheck, IconX, IconAlertCircle } from './Icons';

interface AIAgentApiModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRefreshData?: () => void;
}

export const AIAgentApiModal: React.FC<AIAgentApiModalProps> = ({ isOpen, onClose, onRefreshData }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'endpoints' | 'tools' | 'snippets' | 'console'>('overview');
  const [apiKey, setApiKey] = useState('nexus_agent_sk_live_coe_2025');
  const [showKey, setShowKey] = useState(false);
  const [copiedKey, setCopiedKey] = useState(false);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [apiStatus, setApiStatus] = useState<any>(null);

  // Live Console state
  const [consoleAction, setConsoleAction] = useState<'metrics' | 'list' | 'create'>('metrics');
  const [consoleResult, setConsoleResult] = useState<any>(null);
  const [consoleLoading, setConsoleLoading] = useState(false);

  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const baseUrl = `${origin}/api/ai`;

  useEffect(() => {
    if (isOpen) {
      fetch('/api/ai/config')
        .then(res => res.json())
        .then(data => {
          if (data.apiKey) setApiKey(data.apiKey);
        })
        .catch(() => {});

      fetch('/api/ai/status')
        .then(res => res.json())
        .then(data => setApiStatus(data))
        .catch(() => {});
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopyKey = () => {
    navigator.clipboard.writeText(apiKey);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2500);
  };

  const handleCopyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(id);
    setTimeout(() => setCopiedSnippet(null), 2500);
  };

  const handleRegenerateKey = async () => {
    if (!window.confirm('Tem certeza de que deseja gerar uma nova Chave de API? Agentes que utilizam a chave atual precisarão ser atualizados.')) {
      return;
    }
    setIsRegenerating(true);
    try {
      const res = await fetch('/api/ai/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regenerate: true })
      });
      const data = await res.json();
      if (data.success && data.config?.apiKey) {
        setApiKey(data.config.apiKey);
        alert('Nova chave de API gerada e armazenada com sucesso!');
      }
    } catch (e: any) {
      alert('Erro ao gerar nova chave: ' + (e.message || e));
    } finally {
      setIsRegenerating(false);
    }
  };

  const executeConsoleTest = async (action: 'metrics' | 'list' | 'create') => {
    setConsoleAction(action);
    setConsoleLoading(true);
    setConsoleResult(null);

    try {
      const headers = {
        'Content-Type': 'application/json',
        'X-Nexus-API-Key': apiKey
      };

      let res: Response;
      if (action === 'metrics') {
        res = await fetch('/api/ai/metrics', { headers });
      } else if (action === 'list') {
        res = await fetch('/api/ai/tasks?limit=5', { headers });
      } else {
        res = await fetch('/api/ai/tasks', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            summary: `Demanda de Teste Automatizada - Agente IA (${new Date().toLocaleTimeString('pt-BR')})`,
            type: 'Nova Automação',
            priority: 'Alta',
            status: 'Novo',
            requester: 'Console de Testes Nexus IA',
            estimatedTime: '16h',
            iterationPath: 'Hyperautomation\\Sprint Atual'
          })
        });
        if (onRefreshData) onRefreshData();
      }

      const json = await res.json();
      setConsoleResult({ status: res.status, ok: res.ok, data: json });
    } catch (err: any) {
      setConsoleResult({ status: 500, ok: false, error: err.message || 'Erro de conexão' });
    } finally {
      setConsoleLoading(false);
    }
  };

  const curlExample = `curl -X GET "${baseUrl}/tasks" \\
  -H "X-Nexus-API-Key: ${apiKey}" \\
  -H "Accept: application/json"`;

  const curlCreateExample = `curl -X POST "${baseUrl}/tasks" \\
  -H "X-Nexus-API-Key: ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "summary": "Automação de Conciliação Bancária SAP",
    "type": "Nova Automação",
    "priority": "Alta",
    "status": "Novo",
    "requester": "Área Financeira",
    "estimatedTime": "40h",
    "iterationPath": "Hyperautomation\\\\Sprint 1",
    "syncDevOps": true
  }'`;

  const pythonExample = `import requests

API_KEY = "${apiKey}"
BASE_URL = "${baseUrl}"

headers = {
    "X-Nexus-API-Key": API_KEY,
    "Content-Type": "application/json"
}

# 1. Consultar métricas executivas
metrics = requests.get(f"{BASE_URL}/metrics", headers=headers).json()
print("Total de demandas:", metrics.get("summary", {}).get("totalDemands"))

# 2. Criar uma nova demanda
payload = {
    "summary": "Processamento de Faturas RPA",
    "type": "Nova Automação",
    "priority": "Alta",
    "status": "Novo",
    "iterationPath": "Hyperautomation\\\\Sprint 1",
    "syncDevOps": True
}
response = requests.post(f"{BASE_URL}/tasks", json=payload, headers=headers)
print("Demanda criada:", response.json())`;

  const openAiToolsJson = `[
  {
    "type": "function",
    "function": {
      "name": "nexus_list_tasks",
      "description": "Lista demandas cadastradas no Nexus Project com filtros opcionais.",
      "parameters": {
        "type": "object",
        "properties": {
          "status": { "type": "string", "description": "Filtro de status (ex: Novo, Em Atendimento, Concluído)" },
          "type": { "type": "string", "description": "Incidente, Melhoria, Nova Automação" },
          "iterationPath": { "type": "string", "description": "Sprint ou Iteration Path" },
          "search": { "type": "string", "description": "Termo de busca" }
        }
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "nexus_create_task",
      "description": "Cria uma nova demanda na plataforma Nexus.",
      "parameters": {
        "type": "object",
        "required": ["summary"],
        "properties": {
          "summary": { "type": "string", "description": "Título da demanda" },
          "type": { "type": "string", "enum": ["Nova Automação", "Incidente", "Melhoria"] },
          "priority": { "type": "string", "enum": ["Baixa", "Média", "Alta", "Crítica"] },
          "assignee": { "type": "string", "description": "Nome do desenvolvedor" },
          "iterationPath": { "type": "string", "description": "Iteration Path no DevOps" },
          "syncDevOps": { "type": "boolean", "description": "Sincronizar no Azure DevOps" }
        }
      }
    }
  }
]`;

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center z-50 p-2 sm:p-4 animate-fade-in">
      <div className="bg-slate-900 border border-slate-700/80 max-w-4xl w-full rounded-2xl shadow-2xl shadow-black/80 flex flex-col max-h-[92vh] overflow-hidden">
        {/* Header */}
        <div className="p-4 sm:p-6 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-tr from-indigo-600 to-sky-500 text-white shadow-lg shadow-indigo-500/20">
              <IconBot className="w-6 h-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-lg sm:text-xl font-bold text-white">API para Agentes de IA</h3>
                <span className="text-[10px] font-mono bg-emerald-950/90 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-bold uppercase tracking-wider flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                  REST & Tool Calling
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Integre e opere o Nexus Project de forma autônoma através de agentes de Inteligência Artificial.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-2 rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
            title="Fechar modal"
          >
            <IconX className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-4 sm:px-6 pt-3 border-b border-slate-800 bg-slate-900/50 overflow-x-auto custom-scrollbar">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-all whitespace-nowrap border-b-2 ${
              activeTab === 'overview'
                ? 'border-indigo-500 text-white bg-slate-800/80'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            🔑 Visão Geral & Chave
          </button>
          <button
            onClick={() => setActiveTab('endpoints')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-all whitespace-nowrap border-b-2 ${
              activeTab === 'endpoints'
                ? 'border-indigo-500 text-white bg-slate-800/80'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            📡 Endpoints REST
          </button>
          <button
            onClick={() => setActiveTab('tools')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-all whitespace-nowrap border-b-2 ${
              activeTab === 'tools'
                ? 'border-indigo-500 text-white bg-slate-800/80'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            🧠 Esquema para LLMs (Tools)
          </button>
          <button
            onClick={() => setActiveTab('snippets')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-all whitespace-nowrap border-b-2 ${
              activeTab === 'snippets'
                ? 'border-indigo-500 text-white bg-slate-800/80'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            💻 Exemplos (Python / cURL)
          </button>
          <button
            onClick={() => setActiveTab('console')}
            className={`px-3 py-2 text-xs font-semibold rounded-t-xl transition-all whitespace-nowrap border-b-2 ${
              activeTab === 'console'
                ? 'border-indigo-500 text-white bg-slate-800/80'
                : 'border-transparent text-slate-400 hover:text-slate-200 hover:bg-slate-800/30'
            }`}
          >
            ⚡ Console de Testes
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto custom-scrollbar space-y-6 flex-1">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* API Credentials Box */}
              <div className="bg-slate-950/80 border border-slate-800 p-4 sm:p-5 rounded-2xl space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
                  <div>
                    <h4 className="text-sm font-bold text-white flex items-center gap-2">
                      <IconKey className="w-4 h-4 text-amber-400" />
                      Credenciais de Acesso do Agente
                    </h4>
                    <p className="text-xs text-slate-400">
                      Utilize a Chave de API no cabeçalho <code className="text-sky-300 font-mono">X-Nexus-API-Key</code> de todas as requisições.
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleRegenerateKey}
                      disabled={isRegenerating}
                      className="text-xs px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 font-medium transition-colors cursor-pointer"
                    >
                      {isRegenerating ? 'Gerando...' : '🔄 Nova Chave'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Endpoint Base
                    </label>
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 font-mono text-xs text-indigo-300 select-all">
                      <span className="truncate">{baseUrl}</span>
                      <button
                        onClick={() => handleCopyText(baseUrl, 'baseUrl')}
                        className="ml-auto text-slate-400 hover:text-white shrink-0"
                        title="Copiar URL Base"
                      >
                        {copiedSnippet === 'baseUrl' ? <IconCheck className="w-4 h-4 text-emerald-400" /> : <IconCopy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Nexus API Key (Chave Secreta)
                    </label>
                    <div className="flex items-center gap-2 bg-slate-900 border border-slate-700/80 rounded-xl px-3 py-2 font-mono text-xs text-amber-300">
                      <span className="truncate">
                        {showKey ? apiKey : apiKey.substring(0, 12) + '••••••••••••••••'}
                      </span>
                      <button
                        onClick={() => setShowKey(!showKey)}
                        className="text-[11px] text-slate-400 hover:text-slate-200 shrink-0 ml-auto"
                      >
                        {showKey ? 'Ocultar' : 'Mostrar'}
                      </button>
                      <button
                        onClick={handleCopyKey}
                        className="text-slate-400 hover:text-white shrink-0 ml-1 cursor-pointer"
                        title="Copiar Chave de API"
                      >
                        {copiedKey ? <IconCheck className="w-4 h-4 text-emerald-400" /> : <IconCopy className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </div>

                {copiedKey && (
                  <p className="text-xs text-emerald-400 font-medium flex items-center gap-1.5">
                    <IconCheck className="w-4 h-4" /> Chave copiada para a área de transferência!
                  </p>
                )}
              </div>

              {/* Status and Capability Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">Status da API</span>
                  <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Ativa & Pronta para Agentes
                  </span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">Formato de Ferramentas</span>
                  <span className="text-xs font-mono text-sky-300 font-medium">
                    OpenAI / Claude / OpenAPI 3.0
                  </span>
                </div>
                <div className="bg-slate-950/60 border border-slate-800 p-3.5 rounded-xl">
                  <span className="text-[11px] text-slate-400 uppercase font-semibold block mb-1">Integração DevOps</span>
                  <span className="text-xs font-semibold text-indigo-400">
                    Iteration Path & Work Items
                  </span>
                </div>
              </div>

              {/* Ready prompt for LLM Agents */}
              <div className="bg-indigo-950/20 border border-indigo-500/30 p-4 rounded-2xl space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-2">
                    <IconBot className="w-4 h-4 text-indigo-400" />
                    Prompt Pronto para Configurar seu Agente de IA (ChatGPT / Claude)
                  </span>
                  <button
                    onClick={() => handleCopyText(`Você é um agente autônomo conectado à plataforma Nexus Project (Hyperautomation & RPA). Sua URL base da API é ${baseUrl} e sua chave é ${apiKey}. Ao receber pedidos de novos chamados, incidentes ou automações, consulte as demandas existentes via GET /tasks ou crie novas demandas via POST /tasks incluindo o título, prioridade, responsável e o Iteration Path correspondente no Azure DevOps.`, 'agentPrompt')}
                    className="text-xs px-2.5 py-1 rounded bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-200 border border-indigo-500/30 font-medium flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSnippet === 'agentPrompt' ? <IconCheck className="w-3.5 h-3.5 text-emerald-400" /> : <IconCopy className="w-3.5 h-3.5" />}
                    Copiar Prompt
                  </button>
                </div>
                <p className="text-xs text-slate-300 font-mono bg-slate-950/70 p-3 rounded-xl border border-indigo-900/40 select-all leading-relaxed">
                  {`Você é um agente autônomo conectado à plataforma Nexus Project. Sua URL base da API é ${baseUrl} e sua chave de autenticação é ${apiKey}. Use os cabeçalhos 'X-Nexus-API-Key' para consultar métricas (/metrics), listar tarefas (/tasks), criar novas demandas (/tasks) ou atualizar o status e Iteration Path das demandas.`}
                </p>
              </div>
            </div>
          )}

          {activeTab === 'endpoints' && (
            <div className="space-y-4">
              <p className="text-xs text-slate-400">
                Abaixo estão os endpoints REST oficiais disponíveis para agentes autônomos realizarem consultas, criação e atualizações:
              </p>

              <div className="space-y-3">
                {/* GET /tasks */}
                <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-sky-950 text-sky-400 border border-sky-500/30">
                      GET
                    </span>
                    <span className="font-mono text-xs text-white font-bold">/api/ai/tasks</span>
                    <span className="text-[11px] text-slate-400 ml-auto">Listar e filtrar demandas</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Parâmetros de busca (Query): <code className="text-indigo-300 font-mono">status</code>, <code className="text-indigo-300 font-mono">type</code>, <code className="text-indigo-300 font-mono">assignee</code>, <code className="text-indigo-300 font-mono">priority</code>, <code className="text-indigo-300 font-mono">iterationPath</code>, <code className="text-indigo-300 font-mono">search</code>.
                  </p>
                </div>

                {/* POST /tasks */}
                <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-emerald-950 text-emerald-400 border border-emerald-500/30">
                      POST
                    </span>
                    <span className="font-mono text-xs text-white font-bold">/api/ai/tasks</span>
                    <span className="text-[11px] text-slate-400 ml-auto">Criar nova demanda</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Cria uma nova demanda no Nexus. Suporta envio automático de <code className="text-indigo-300 font-mono">iterationPath</code> e criação automática no Azure DevOps com <code className="text-indigo-300 font-mono">syncDevOps: true</code>.
                  </p>
                  <pre className="text-[11px] font-mono bg-slate-900 p-2.5 rounded-lg text-slate-300 overflow-x-auto">
{`{
  "summary": "Título da demanda",
  "type": "Nova Automação" | "Incidente" | "Melhoria",
  "priority": "Alta" | "Média" | "Baixa" | "Crítica",
  "status": "Novo",
  "assignee": "Desenvolvedor",
  "iterationPath": "Hyperautomation\\\\Sprint 1",
  "syncDevOps": true
}`}
                  </pre>
                </div>

                {/* PATCH /tasks/:id */}
                <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-amber-950 text-amber-400 border border-amber-500/30">
                      PATCH
                    </span>
                    <span className="font-mono text-xs text-white font-bold">/api/ai/tasks/:id</span>
                    <span className="text-[11px] text-slate-400 ml-auto">Atualizar demanda existente</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Atualiza status, responsável, horas gastas, Iteration Path ou registra comentários de auditoria.
                  </p>
                </div>

                {/* GET /metrics */}
                <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-purple-950 text-purple-400 border border-purple-500/30">
                      GET
                    </span>
                    <span className="font-mono text-xs text-white font-bold">/api/ai/metrics</span>
                    <span className="text-[11px] text-slate-400 ml-auto">Métricas Executivas & KPIs</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Retorna indicadores consolidados: total de demandas, em andamento, atrasadas, ganho de FTE e alocação de equipe.
                  </p>
                </div>

                {/* POST /execute-tool */}
                <div className="bg-slate-950/80 border border-slate-800 p-4 rounded-xl space-y-2">
                  <div className="flex items-center gap-2.5">
                    <span className="px-2 py-0.5 rounded font-mono text-[11px] font-bold bg-indigo-950 text-indigo-400 border border-indigo-500/30">
                      POST
                    </span>
                    <span className="font-mono text-xs text-white font-bold">/api/ai/execute-tool</span>
                    <span className="text-[11px] text-slate-400 ml-auto">Despachante Unificado de Ferramentas</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Endpoint único para motores de IA que invocam ferramentas passando <code className="text-indigo-300 font-mono">&#123; tool: "nome", arguments: &#123;...&#125; &#125;</code>.
                  </p>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'tools' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-sm font-bold text-white">Esquema de Ferramentas (Tool Calling Schema)</h4>
                  <p className="text-xs text-slate-400">
                    Compatível com GPT-4o, Claude 3.5 Sonnet, Gemini 1.5/2.5, LangChain e AutoGen.
                  </p>
                </div>
                <button
                  onClick={() => handleCopyText(openAiToolsJson, 'toolsJson')}
                  className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  {copiedSnippet === 'toolsJson' ? <IconCheck className="w-4 h-4" /> : <IconCopy className="w-4 h-4" />}
                  Copiar JSON de Ferramentas
                </button>
              </div>

              <div className="relative">
                <pre className="bg-slate-950 border border-slate-800 p-4 rounded-xl font-mono text-xs text-slate-200 overflow-x-auto custom-scrollbar max-h-96">
                  {openAiToolsJson}
                </pre>
              </div>

              <div className="p-3 bg-slate-950/50 border border-slate-800 rounded-xl text-xs text-slate-400 flex items-center justify-between">
                <span>Especificação OpenAPI 3.0 completa:</span>
                <a
                  href="/api/ai/openapi.json"
                  target="_blank"
                  rel="noreferrer"
                  className="text-indigo-400 hover:text-indigo-300 font-mono underline"
                >
                  /api/ai/openapi.json ↗
                </a>
              </div>
            </div>
          )}

          {activeTab === 'snippets' && (
            <div className="space-y-6">
              {/* Python */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-sky-400 flex items-center gap-1.5 font-mono">
                    <IconCode className="w-4 h-4" /> Python (requests)
                  </span>
                  <button
                    onClick={() => handleCopyText(pythonExample, 'pySnippet')}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSnippet === 'pySnippet' ? <IconCheck className="w-3.5 h-3.5 text-emerald-400" /> : <IconCopy className="w-3.5 h-3.5" />}
                    Copiar
                  </button>
                </div>
                <pre className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl font-mono text-xs text-slate-200 overflow-x-auto">
                  {pythonExample}
                </pre>
              </div>

              {/* cURL List */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-400 flex items-center gap-1.5 font-mono">
                    <IconCode className="w-4 h-4" /> cURL (Listar Demandas)
                  </span>
                  <button
                    onClick={() => handleCopyText(curlExample, 'curlSnippet')}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSnippet === 'curlSnippet' ? <IconCheck className="w-3.5 h-3.5 text-emerald-400" /> : <IconCopy className="w-3.5 h-3.5" />}
                    Copiar
                  </button>
                </div>
                <pre className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl font-mono text-xs text-slate-200 overflow-x-auto">
                  {curlExample}
                </pre>
              </div>

              {/* cURL Create with Iteration Path */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 font-mono">
                    <IconCode className="w-4 h-4" /> cURL (Criar Demanda com Iteration Path & Azure DevOps)
                  </span>
                  <button
                    onClick={() => handleCopyText(curlCreateExample, 'curlCreateSnippet')}
                    className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
                  >
                    {copiedSnippet === 'curlCreateSnippet' ? <IconCheck className="w-3.5 h-3.5 text-emerald-400" /> : <IconCopy className="w-3.5 h-3.5" />}
                    Copiar
                  </button>
                </div>
                <pre className="bg-slate-950 border border-slate-800 p-3.5 rounded-xl font-mono text-xs text-slate-200 overflow-x-auto">
                  {curlCreateExample}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'console' && (
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-bold text-white">Console Interativo de Teste da API</h4>
                <p className="text-xs text-slate-400">
                  Execute requisições reais agora mesmo para validar a comunicação e ver o retorno JSON formatado:
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => executeConsoleTest('metrics')}
                  disabled={consoleLoading}
                  className={`text-xs px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    consoleAction === 'metrics'
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  📊 Testar GET /metrics
                </button>
                <button
                  onClick={() => executeConsoleTest('list')}
                  disabled={consoleLoading}
                  className={`text-xs px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    consoleAction === 'list'
                      ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-600/30'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  📋 Testar GET /tasks
                </button>
                <button
                  onClick={() => executeConsoleTest('create')}
                  disabled={consoleLoading}
                  className={`text-xs px-3 py-2 rounded-xl font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                    consoleAction === 'create'
                      ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/30'
                      : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                  }`}
                >
                  🤖 Testar POST /tasks (Criar via IA)
                </button>
              </div>

              {consoleLoading && (
                <div className="p-8 text-center bg-slate-950 border border-slate-800 rounded-xl">
                  <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mx-auto mb-2"></div>
                  <span className="text-xs text-slate-400">Executando requisição na API...</span>
                </div>
              )}

              {consoleResult && !consoleLoading && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs font-mono">
                    <span className="flex items-center gap-2">
                      <span className={`px-2 py-0.5 rounded font-bold ${consoleResult.ok ? 'bg-emerald-950 text-emerald-400 border border-emerald-500/30' : 'bg-rose-950 text-rose-400 border border-rose-500/30'}`}>
                        Status {consoleResult.status}
                      </span>
                      <span className="text-slate-400">Resposta da API:</span>
                    </span>
                    <button
                      onClick={() => handleCopyText(JSON.stringify(consoleResult.data || consoleResult, null, 2), 'consoleResult')}
                      className="text-slate-400 hover:text-white flex items-center gap-1"
                    >
                      {copiedSnippet === 'consoleResult' ? <IconCheck className="w-3.5 h-3.5 text-emerald-400" /> : <IconCopy className="w-3.5 h-3.5" />}
                      Copiar JSON
                    </button>
                  </div>
                  <pre className="bg-slate-950 border border-slate-800 p-4 rounded-xl font-mono text-xs text-emerald-300 overflow-x-auto custom-scrollbar max-h-80">
                    {JSON.stringify(consoleResult.data || consoleResult, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/80 flex items-center justify-between text-xs text-slate-400">
          <span>Versão da API: 2.5.0 • Automação e Governança CoE</span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold transition-colors cursor-pointer"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
