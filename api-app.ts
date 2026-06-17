import express from "express";

const app = express();

// Middleware to support JSON request bodies
app.use(express.json());

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

// API Route: Create Task (Incident / Improvement)
app.post("/api/devops/create-task", async (req: express.Request, res: express.Response) => {
  try {
    const { organization, project, pat, userStoryId, title, estimate, tag } = req.body;

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
      const errText = await response.text();
      res.status(400).json({ error: "Resposta inesperada do Azure DevOps (não-JSON). Provavelmente suas credenciais estão incorretas ou o projeto é inacessível." });
      return;
    }

    const data = await response.json() as { id: number };
    res.json({ success: true, id: data.id, title });
  } catch (error: any) {
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

// API Route: Create Complete Feature Lifecycle Structure for New Automation
app.post("/api/devops/create-structure", async (req: express.Request, res: express.Response) => {
  try {
    const { organization, project, pat, epicId, projectName } = req.body;

    if (!organization || !project || !pat || !epicId || !projectName) {
      res.status(400).json({ error: "Missing required DevOps fields (organization, project, pat, epicId, projectName)" });
      return;
    }

    const org = String(organization).trim();
    const proj = String(project).trim();
    const token = String(pat).trim();
    const epic = String(epicId).trim();
    const name = String(projectName).trim();

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

      if (parentId) {
        body.push({
          "op": "add",
          "path": "/relations/-",
          "value": {
            "rel": "System.LinkTypes.Hierarchy-Reverse",
            "url": `https://dev.azure.com/${org}/${proj}/_apis/wit/workItems/${parentId}`
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
          throw new Error("Erro de Autenticação com o Azure DevOps: O seu Token de Acesso Pessoal (PAT) está incorreto ou expirou, ou a Organização/Projeto inseridos estão inválidos.");
        }
        throw new Error(`Erro ao criar ${type} (${title}): ${errText}`);
      }

      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        throw new Error("Resposta inesperada do Azure DevOps (dados corrompidos ou HTML recebido). Verifique e renove seu Token PAT!");
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

export default app;
