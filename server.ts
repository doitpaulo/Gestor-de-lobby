import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware to support JSON request bodies
  app.use(express.json());

  // Helper to generate Base64 Basic auth header for Azure DevOps
  function getDevOpsHeaders(pat: string) {
    const auth = ":" + pat;
    const encoded = Buffer.from(auth).toString("base64");
    return {
      "Content-Type": "application/json-patch+json",
      "Authorization": `Basic ${encoded}`,
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

      const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/$Task?api-version=7.0`;
      
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
          "url": `https://dev.azure.com/${organization}/_apis/wit/workItems/${userStoryId}`
        }
      });

      const response = await fetch(url, {
        method: "POST",
        headers: getDevOpsHeaders(pat),
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

      const headers = getDevOpsHeaders(pat);

      // Helper function to create standard work item
      async function createWorkItem(type: string, title: string, parentId?: string | number, tag?: string) {
        const typeFormatted = encodeURIComponent(type);
        const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/$${typeFormatted}?api-version=7.0`;

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
              "url": `https://dev.azure.com/${organization}/${project}/_apis/wit/workItems/${parentId}`
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
      const featureId = await createWorkItem("Feature", `N/A | ${projectName}`, epicId);

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

  // Serve Vite in development environment
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production env
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server fully operational on http://localhost:${PORT}`);
  });
}

startServer();
