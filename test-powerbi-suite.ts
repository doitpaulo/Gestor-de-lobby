import http from "http";
import crypto from "crypto";
import app from "./api/index";
import { PowerBIService, sanitizeTask, sanitizeRobot, sanitizeDeveloper } from "./services/powerbiService";
import firebaseConfig from "./firebase-applet-config.json";

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ PASSOU: ${testName}`);
  } else {
    console.error(`  ❌ FALHOU: ${testName}`, details || "");
  }
}

// Helper to make local HTTP requests to Express app
function makeRequest(
  server: http.Server,
  path: string,
  method: string,
  headers: Record<string, string> = {},
  body?: any
): Promise<{ status: number; headers: http.IncomingHttpHeaders; data: any }> {
  return new Promise((resolve, reject) => {
    const address = server.address() as any;
    const port = address.port;
    const postData = body ? JSON.stringify(body) : "";

    const reqHeaders: Record<string, string> = {
      ...headers
    };
    if (body) {
      reqHeaders["Content-Type"] = "application/json";
      reqHeaders["Content-Length"] = Buffer.byteLength(postData).toString();
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: reqHeaders
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => {
          raw += chunk;
        });
        res.on("end", () => {
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {
            // Keep string
          }
          resolve({
            status: res.statusCode || 500,
            headers: res.headers,
            data: parsed
          });
        });
      }
    );

    req.on("error", reject);
    if (body) {
      req.write(postData);
    }
    req.end();
  });
}

// Helper to create RS256 JWT tokens with custom claims for tests
function createTestJwt(
  payload: Record<string, any>,
  privateKey: string,
  kid: string = "test-kid-1"
): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
    kid
  };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString("base64url");
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const data = `${headerB64}.${payloadB64}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(data);
  const sigB64 = signer.sign(privateKey).toString("base64url");
  return `${data}.${sigB64}`;
}

async function runTests() {
  console.log("================================================================================");
  console.log("🧪 SUÍTE UNIFICADA DE TESTES: SEGURANÇA TOTAL + STATELESS VERCEL PRD + QA");
  console.log("================================================================================\n");

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const TEST_VALID_KEY = "nexus_powerbi_secure_key_live_2026_test_valid_string_32";
  const OWNER_UID = "owner_nexus_secure_uid_4dcf951c";
  const MOCK_REFRESH_TOKEN = "mock_firebase_refresh_token_secret_sample_val_123456789";

  // Generate test RSA KeyPair for JWT testing
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });

  const MOCK_KID = "test-cert-kid-nexus-prd-1";
  PowerBIService.__setMockCerts({
    [MOCK_KID]: publicKey
  });

  const originalKey = process.env.POWERBI_API_KEY;
  const originalUid = process.env.POWERBI_OWNER_UID;
  const originalRefreshToken = process.env.FIREBASE_REFRESH_TOKEN;
  const originalNodeEnv = process.env.NODE_ENV;

  const expectedProject = firebaseConfig.projectId;
  const expectedProjectNumber = firebaseConfig.messagingSenderId;

  const createValidIdToken = (uid = OWNER_UID) =>
    createTestJwt(
      {
        iss: `https://securetoken.google.com/${expectedProject}`,
        aud: expectedProject,
        sub: uid,
        iat: Math.floor(Date.now() / 1000) - 30,
        exp: Math.floor(Date.now() / 1000) + 3600,
        auth_time: Math.floor(Date.now() / 1000) - 30,
        email: "paulo.mmartinio@gmail.com"
      },
      privateKey,
      MOCK_KID
    );

  try {
    // =========================================================================
    // PARTE 1: REGRESSÃO DE SEGURANÇA COMPLETA (48 ASSERÇÕES PRESERVADAS)
    // =========================================================================

    // -------------------------------------------------------------------------
    // BLOCO 1: Bloqueio de Bootstrap e Rota Removida (POST /api/powerbi/config)
    // -------------------------------------------------------------------------
    console.log("👉 Bloco 1: Bloqueio de Bootstrap e Remoção de Rota Insegura");

    const resConfigPost = await makeRequest(server, "/api/powerbi/config", "POST", {}, {
      ownerUid: "attacker_uid",
      apiKey: "attacker_injected_api_key_1234567890"
    });
    assert(resConfigPost.status === 404, "POST /api/powerbi/config retorna 404 (rota completamente removida)");

    const resConfigGet = await makeRequest(server, "/api/powerbi/config", "GET");
    assert(resConfigGet.status === 404, "GET /api/powerbi/config retorna 404 (nenhuma leitura de configuração exposta)");

    // -------------------------------------------------------------------------
    // BLOCO 2: Validação de Chave de API & Timing Safe
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 2: Validação de Chave de API & Timing Safe");

    const r1 = PowerBIService.validateApiKey("");
    assert(!r1.valid && r1.status === 401, "Rejeita requisição sem chave com 401");

    process.env.POWERBI_API_KEY = "chave_insegura_menor_32_chars";
    const r2 = PowerBIService.validateApiKey("chave_insegura_menor_32_chars");
    assert(!r2.valid && r2.status === 503, "Rejeita chave no servidor < 32 caracteres com 503");

    process.env.POWERBI_API_KEY = TEST_VALID_KEY;
    process.env.POWERBI_OWNER_UID = OWNER_UID;

    const r3 = PowerBIService.validateApiKey("chave_totalmente_invalida_com_tamanho_32_chars!");
    assert(!r3.valid && r3.status === 401, "Rejeita chave incorreta com 401");

    const r4 = PowerBIService.validateApiKey(TEST_VALID_KEY);
    assert(r4.valid === true, "Aceita chave correta timing-safe");

    delete process.env.FIREBASE_REFRESH_TOKEN;
    PowerBIService.clearActiveSession();
    PowerBIService.__clearAutonomousTokenCache();

    const resHttpNoKey = await makeRequest(server, "/api/powerbi-data", "GET");
    assert(resHttpNoKey.status === 401, "GET /api/powerbi-data sem chave retorna 401");

    const resHttpQueryKey = await makeRequest(
      server,
      `/api/powerbi-data?key=${encodeURIComponent(TEST_VALID_KEY)}`,
      "GET"
    );
    assert(
      resHttpQueryKey.status === 503 && resHttpQueryKey.data.code === "POWERBI_SESSION_EXPIRED",
      "GET /api/powerbi-data com query param ?key aceita autenticação Web API do Power Query"
    );

    const resHttpHeaderKey = await makeRequest(server, "/api/powerbi-data", "GET", {
      "X-API-Key": TEST_VALID_KEY
    });
    assert(
      resHttpHeaderKey.status === 503 && resHttpHeaderKey.data.code === "POWERBI_SESSION_EXPIRED",
      "GET /api/powerbi-data aceita cabeçalho X-API-Key"
    );

    const resHttpBearerKey = await makeRequest(server, "/api/powerbi-data", "GET", {
      Authorization: `Bearer ${TEST_VALID_KEY}`
    });
    assert(
      resHttpBearerKey.status === 503 && resHttpBearerKey.data.code === "POWERBI_SESSION_EXPIRED",
      "GET /api/powerbi-data aceita cabeçalho Authorization: Bearer <key>"
    );

    // -------------------------------------------------------------------------
    // BLOCO 3: Allowlists Estritas e Projeção de Segredos Aninhados
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 3: Allowlists Estritas & Projeção de Segredos");

    const dirtyTaskDoc = {
      id: "TASK-SEC-001",
      type: "Incidente",
      summary: "Falha de Automação Contábil",
      status: "Em Progresso",
      priority: "1 - Crítica",
      assignee: "Paulo Martinio",
      requester: "Diretoria Financeira",
      startDate: "2026-10-20",
      endDate: "2026-10-27",
      estimatedTime: "16h",
      actualTime: "8h",
      fteValue: 2.5,
      automationName: "Robô Fechamento Fiscal SAP",
      managementArea: "Controladoria",
      iterationPath: "Sprint 42\\Nexus",
      createdAt: "2026-10-20T08:00:00Z",
      azureDevOpsPat: "super_secret_pat_token_abc123",
      password: "secret_db_password",
      history: [{ user: "admin", note: "Senha alterada", timestamp: "2026-10-21" }],
      internalNotes: "Informações sigilosas de infraestrutura",
      privateTokens: { refresh: "token_xyz" },
      subTasks: [
        {
          id: "ST-01",
          title: "Validação de certificados",
          status: "Concluído",
          estimatedHours: 4,
          actualHours: 3,
          assignee: "Paulo Martinio",
          secretApiKey: "should_be_stripped_from_subtask",
          rawLogs: "private log content"
        }
      ]
    };

    const sanitizedTask = sanitizeTask(dirtyTaskDoc);
    assert(sanitizedTask.id === "TASK-SEC-001", "Preserva ID aprovado");
    assert(sanitizedTask.automationName === "Robô Fechamento Fiscal SAP", "Preserva automationName para BI");
    assert(sanitizedTask.managementArea === "Controladoria", "Preserva managementArea para BI");
    assert(sanitizedTask.iterationPath === "Sprint 42\\Nexus", "Preserva iterationPath");
    assert(sanitizedTask.azureDevOpsPat === undefined, "Remove azureDevOpsPat com allowlist");
    assert(sanitizedTask.password === undefined, "Remove password com allowlist");
    assert(sanitizedTask.history === undefined, "Remove histórico privado");
    assert(sanitizedTask.internalNotes === undefined, "Remove internalNotes com allowlist");
    assert(sanitizedTask.privateTokens === undefined, "Remove objetos aninhados desconhecidos");
    assert(sanitizedTask.subTasks[0].secretApiKey === undefined && sanitizedTask.subTasks[0].rawLogs === undefined, "Remove campos desconhecidos de subTasks");
    assert(sanitizedTask.subTasks[0].title === "Validação de certificados" && sanitizedTask.subTasks[0].estimatedHours === 4, "Preserva campos limpos e necessários de subTasks");

    const dirtyRobotDoc = {
      id: "ROBOT-01",
      name: "Robô SAP",
      status: "Ativo",
      area: "Fiscal",
      developer: "Paulo",
      folder: "G:\\Robos",
      fte: 1.2,
      ticketNumber: "RITM001",
      secretCreds: "creds123",
      connectionString: "server=db.internal"
    };
    const sanitizedRobot = sanitizeRobot(dirtyRobotDoc);
    assert(sanitizedRobot.secretCreds === undefined && sanitizedRobot.connectionString === undefined, "Sanitiza entidade robot contra credenciais");
    assert(sanitizedRobot.name === "Robô SAP" && sanitizedRobot.fte === 1.2, "Preserva campos permitidos de robot");

    // -------------------------------------------------------------------------
    // BLOCO 4: Validação Criptográfica de JWT e Claims Estritas
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 4: Validação Criptográfica de JWT (Claims, Assinatura, Expiração)");

    const now = Math.floor(Date.now() / 1000);
    const validBasePayload = {
      iss: `https://securetoken.google.com/${expectedProject}`,
      aud: expectedProject,
      sub: OWNER_UID,
      iat: now - 60,
      exp: now + 3600,
      auth_time: now - 60,
      email: "paulo.mmartinio@gmail.com"
    };

    const validToken = createTestJwt(validBasePayload, privateKey, MOCK_KID);
    const verifyResult = await PowerBIService.verifyFirebaseIdToken(validToken, OWNER_UID);
    assert(verifyResult.uid === OWNER_UID && verifyResult.expiresAt === validBasePayload.exp, "Aceita e verifica token JWT Firebase válido com RS256 e claims corretas");

    const wrongUidToken = createTestJwt({ ...validBasePayload, sub: "attacker_uid_other" }, privateKey, MOCK_KID);
    let errWrongUid = false;
    try { await PowerBIService.verifyFirebaseIdToken(wrongUidToken, OWNER_UID); } catch { errWrongUid = true; }
    assert(errWrongUid, "Rejeita token quando sub/UID não coincide estritamente com POWERBI_OWNER_UID");

    const emptySubToken = createTestJwt({ ...validBasePayload, sub: "   " }, privateKey, MOCK_KID);
    let errEmptySub = false;
    try { await PowerBIService.verifyFirebaseIdToken(emptySubToken, OWNER_UID); } catch { errEmptySub = true; }
    assert(errEmptySub, "Rejeita token com sub vazio ou inválido");

    const longSubToken = createTestJwt({ ...validBasePayload, sub: "a".repeat(129) }, privateKey, MOCK_KID);
    let errLongSub = false;
    try { await PowerBIService.verifyFirebaseIdToken(longSubToken, OWNER_UID); } catch { errLongSub = true; }
    assert(errLongSub, "Rejeita token com sub > 128 caracteres");

    const expiredToken = createTestJwt({ ...validBasePayload, exp: now - 10 }, privateKey, MOCK_KID);
    let errExpired = false;
    try { await PowerBIService.verifyFirebaseIdToken(expiredToken, OWNER_UID); } catch { errExpired = true; }
    assert(errExpired, "Rejeita token expirado (exp <= now)");

    const futureIatToken = createTestJwt({ ...validBasePayload, iat: now + 600 }, privateKey, MOCK_KID);
    let errFutureIat = false;
    try { await PowerBIService.verifyFirebaseIdToken(futureIatToken, OWNER_UID); } catch { errFutureIat = true; }
    assert(errFutureIat, "Rejeita token com iat no futuro (> now + 300)");

    const futureAuthTimeToken = createTestJwt({ ...validBasePayload, auth_time: now + 500 }, privateKey, MOCK_KID);
    let errFutureAuth = false;
    try { await PowerBIService.verifyFirebaseIdToken(futureAuthTimeToken, OWNER_UID); } catch { errFutureAuth = true; }
    assert(errFutureAuth, "Rejeita token com auth_time no futuro");

    const forgedToken = validToken.slice(0, -6) + "xxxxxx";
    let errForged = false;
    try { await PowerBIService.verifyFirebaseIdToken(forgedToken, OWNER_UID); } catch { errForged = true; }
    assert(errForged, "Rejeita token com assinatura criptográfica adulterada");

    // -------------------------------------------------------------------------
    // BLOCO 5: Isolamento de Sessão Ativa QA & Status Público Seguro
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 5: Isolamento de Sessão Ativa QA & Status Seguro");

    const resBridge = await makeRequest(server, "/api/powerbi/session-bridge", "POST", {
      Authorization: `Bearer ${validToken}`
    });
    assert(resBridge.status === 200 && resBridge.data.success === true, "POST /api/powerbi/session-bridge ativa sessão com token válido");

    const resStatusQA = await makeRequest(server, "/api/powerbi/session-status", "GET");
    assert(resStatusQA.status === 200, "GET /api/powerbi/session-status retorna 200");
    assert(resStatusQA.data.sessionActive === true, "Indica sessão ativa");
    assert(resStatusQA.data.mode === "active-session-bridge", "Modo active-session-bridge ativado");
    assert(resStatusQA.data.ownerUid === undefined, "Status NÃO revela ownerUid");
    assert(resStatusQA.data.email === undefined, "Status NÃO revela email");
    assert(resStatusQA.data.idToken === undefined, "Status NÃO revela idToken");
    assert(resStatusQA.data.apiKey === undefined, "Status NÃO revela apiKey");

    process.env.POWERBI_OWNER_UID = "new_different_owner_uid_789";
    const statusWithDifferentOwner = PowerBIService.getActiveSessionStatus();
    assert(statusWithDifferentOwner.sessionActive === false, "Invalida imediatamente activeSession caso POWERBI_OWNER_UID mude no servidor");
    process.env.POWERBI_OWNER_UID = OWNER_UID;

    // -------------------------------------------------------------------------
    // BLOCO 6: Mock Firestore REST, Proteção de Paginação & Fallback QA
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 6: Mock Firestore REST, Proteção de Paginação & Fallback");

    PowerBIService.__setMockFirestoreFetch(async (url: string, init: any) => {
      if (JSON.parse(init.body).structuredQuery.from[0].collectionId === "tasks") {
        return {
          ok: true,
          status: 200,
          json: async () => [
              { document:
              {
                name: `projects/${expectedProject}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${OWNER_UID}/tasks/TASK-LIVE-01`,
                fields: {
                  summary: { stringValue: "Demanda de Fechamento" },
                  automationName: { stringValue: "Robô Balancete" },
                  managementArea: { stringValue: "Contabilidade" },
                  fteValue: { doubleValue: 1.5 },
                  iterationPath: { stringValue: "Sprint 42" },
                  azureDevOpsPat: { stringValue: "secret_leak_attempt" }
                }
              }
              }
            ]
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });

    const liveData = await PowerBIService.getLivePowerBIData(TEST_VALID_KEY);
    assert(liveData.metadata.source === "firestore-live", "Marca metadado source como firestore-live");
    assert(liveData.metadata.mode === "active-session-bridge", "Identifica modo de conexão active-session-bridge");
    assert(liveData.data.tasks.length === 1, "Retorna tarefas lidas do Firestore");
    assert(liveData.data.tasks[0].automationName === "Robô Balancete", "Preserva automationName");
    assert(liveData.data.tasks[0].managementArea === "Contabilidade", "Preserva managementArea");
    assert(liveData.data.tasks[0].azureDevOpsPat === undefined, "Garante ausência de vazamento de segredos nos dados entregues");

    // Ciclo de paginação
    PowerBIService.__setMockFirestoreFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => Array.from({ length: 100 }, (_, i) => ({ document: { name: `projects/${expectedProject}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${OWNER_UID}/tasks/${String(i).padStart(3, "0")}`, fields: {} } }))
    }));

    let cycleErrorCaught = false;
    try {
      await PowerBIService.fetchCollectionLive("tasks", OWNER_UID, validToken);
    } catch (e: any) {
      if (e.message && e.message.includes("Ciclo de paginação detectado")) cycleErrorCaught = true;
    }
    assert(cycleErrorCaught, "Detecta e aborta ciclo infinito de paginação com erro explícito");

    // Erro do Firestore
    PowerBIService.__setMockFirestoreFetch(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: "Internal Firestore Error" })
    }));

    let firestoreErrorCaught = false;
    try {
      await PowerBIService.fetchCollectionLive("tasks", OWNER_UID, validToken);
    } catch {
      firestoreErrorCaught = true;
    }
    assert(firestoreErrorCaught, "Erro no Firestore aborta a operação sem retornar dados parciais ou desatualizados");

    // Limpa estado QA
    PowerBIService.clearActiveSession();
    PowerBIService.__clearAutonomousTokenCache();

    // =========================================================================
    // PARTE 2: TESTES EXCLUSIVOS DE VERCEL PRD & STATELESS AUTÔNOMO
    // =========================================================================

    // -------------------------------------------------------------------------
    // BLOCO 7: Separação de "Configured" vs "Conectividade Comprovada" (Item 3)
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 7: Separação de Status Configured vs Conectividade Comprovada");

    // Configura a Secret FIREBASE_REFRESH_TOKEN sem ainda ter validado
    process.env.FIREBASE_REFRESH_TOKEN = MOCK_REFRESH_TOKEN;
    PowerBIService.__clearAutonomousTokenCache();

    const statusBeforeValidation = PowerBIService.getActiveSessionStatus();
    assert(statusBeforeValidation.configured === true, "Reporta configured: true quando as variáveis estão presentes");
    assert(statusBeforeValidation.sessionActive === false, "NÃO declara sessionActive: true antes da autenticação ser comprovada");
    assert(statusBeforeValidation.expiresInSeconds === 0, "NÃO inventa TTL falso (retorna 0 antes da validação)");
    assert(statusBeforeValidation.mode === "ready-to-test", "Define mode como 'ready-to-test' antes da primeira chamada bem-sucedida");

    // -------------------------------------------------------------------------
    // BLOCO 8: Execução Autônoma Vercel PRD - Instância 1 (Cold Start)
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 8: Execução Autônoma Vercel PRD (Instância 1 - Cold Start)");

    let refreshCallCount = 0;
    PowerBIService.__setMockRefreshTokenFetch(async () => {
      refreshCallCount++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          expires_in: "3600",
          token_type: "Bearer",
          refresh_token: "new_rotated_refresh_token_sample",
          id_token: createValidIdToken(),
          user_id: OWNER_UID,
          project_id: expectedProject
        })
      };
    });

    PowerBIService.__setMockFirestoreFetch(async (url: string, init: any) => {
      if (JSON.parse(init.body).structuredQuery.from[0].collectionId === "tasks") {
        return {
          ok: true,
          status: 200,
          json: async () => [
              { document:
              {
                name: `projects/${expectedProject}/databases/${firebaseConfig.firestoreDatabaseId}/documents/users/${OWNER_UID}/tasks/TASK-PRD-01`,
                fields: {
                  summary: { stringValue: "Automação Vercel PRD" },
                  automationName: { stringValue: "Robô Conciliação Vercel" },
                  managementArea: { stringValue: "Tesouraria" },
                  status: { stringValue: "Concluído" },
                  type: { stringValue: "Melhoria" },
                  fteValue: { doubleValue: 2.0 },
                  iterationPath: { stringValue: "Sprint 43\\PRD" }
                }
              }
              }
            ]
        };
      }
      return { ok: true, status: 200, json: async () => [] };
    });

    const resHttpInstance1 = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });

    assert(resHttpInstance1.status === 200, "Instância 1 retorna 200 OK sem nenhuma sessão de navegador aberta");
    assert(resHttpInstance1.data.metadata.mode === "refresh-token-autonomous", "Modo identificado como refresh-token-autonomous");
    assert(resHttpInstance1.data.data.tasks.length === 1, "Retorna tarefas lidas do Firestore em modo autônomo");
    assert(refreshCallCount === 1, "Chamou o endpoint do Google Secure Token para obter ID token no cold start");

    // Status após validação comprovada
    const statusAfterValidation = PowerBIService.getActiveSessionStatus();
    assert(statusAfterValidation.sessionActive === true, "Reporta sessionActive: true após conectividade comprovada");
    assert(statusAfterValidation.expiresInSeconds > 3000, "Informa TTL real (> 3000s) baseado na expiração do ID token verificado");
    assert(statusAfterValidation.mode === "refresh-token-autonomous", "Reporta mode: 'refresh-token-autonomous'");

    // -------------------------------------------------------------------------
    // BLOCO 9: Cache Fingerprint SHA256 & Vinculação de UID (Item 2)
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 9: Cache Fingerprint SHA256 & Vinculação com ownerUid");

    // Teste 9.1: Cache Hit na mesma instância com a mesma credencial
    const resHttpCacheHit = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });
    assert(resHttpCacheHit.status === 200, "Segunda requisição na mesma instância retorna 200 OK");
    assert(refreshCallCount === 1, "Cache hit: não chamou endpoint novamente");

    // Teste 9.2: Mudança de credencial no servidor invalida o cache imediatamente
    process.env.FIREBASE_REFRESH_TOKEN = "new_rotated_secret_refresh_token_value_987654";
    const resHttpRotatedSecret = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });
    assert(resHttpRotatedSecret.status === 200, "Requisição com nova credencial atualizada no servidor retorna 200 OK");
    assert(refreshCallCount === 2, "Fingerprint SHA256 detectou alteração da Secret e renovou o token de autenticação");

    // Teste 9.3: Mudança de proprietário no servidor invalida o cache imediatamente
    process.env.POWERBI_OWNER_UID = "new_owner_uid_isolated_123";
    let caughtOwnerChange = false;
    try {
      await PowerBIService.getLivePowerBIData(TEST_VALID_KEY);
    } catch (e: any) {
      if (e.code === "OWNER_UID_MISMATCH") caughtOwnerChange = true;
    }
    assert(caughtOwnerChange, "Mudança de POWERBI_OWNER_UID no servidor invalida imediatamente o cache e bloqueia mismatch");
    process.env.POWERBI_OWNER_UID = OWNER_UID;

    // -------------------------------------------------------------------------
    // BLOCO 10: Aceitação Realista do Project Number e Rejeição Estrita (Item 1)
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 10: Aceitação do Número do Projeto e Validação Criptográfica");

    // 10.1: Resposta numérica realista com projectNumber oficial (1078293181166)
    PowerBIService.__clearAutonomousTokenCache();
    PowerBIService.__setMockRefreshTokenFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        expires_in: "3600",
        token_type: "Bearer",
        refresh_token: "ref_tok",
        id_token: createValidIdToken(),
        user_id: OWNER_UID,
        project_id: expectedProjectNumber // "1078293181166"
      })
    }));

    const resNumericProject = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });
    assert(resNumericProject.status === 200, "Aceita projectNumber numérico oficial (1078293181166) com verificação RS256 de aud/iss");

    // 10.2: Rejeição de número de projeto errado (ex: 999999999999)
    PowerBIService.__clearAutonomousTokenCache();
    PowerBIService.__setMockRefreshTokenFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        expires_in: "3600",
        token_type: "Bearer",
        refresh_token: "ref_tok",
        id_token: createValidIdToken(),
        user_id: OWNER_UID,
        project_id: "999999999999" // Número incorreto de projeto
      })
    }));

    const resWrongProjectNumber = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });
    assert(
      resWrongProjectNumber.status === 503 && resWrongProjectNumber.data.code === "PROJECT_MISMATCH",
      "Rejeita explicitamente número de projeto incorreto (999999999999) com 503 PROJECT_MISMATCH"
    );

    // 10.3: Rejeição de project_id alfanumérico errado
    PowerBIService.__clearAutonomousTokenCache();
    PowerBIService.__setMockRefreshTokenFetch(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        expires_in: "3600",
        token_type: "Bearer",
        refresh_token: "ref_tok",
        id_token: createValidIdToken(),
        user_id: OWNER_UID,
        project_id: "other-foreign-project-id"
      })
    }));

    const resWrongProjectId = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });
    assert(
      resWrongProjectId.status === 503 && resWrongProjectId.data.code === "PROJECT_MISMATCH",
      "Rejeita projectId incorreto com 503 PROJECT_MISMATCH"
    );

    // -------------------------------------------------------------------------
    // BLOCO 11: Instância 2 Independente (Serverless Cold Start)
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 11: Nova Instância Serverless Independente (Cold Start)");

    PowerBIService.__clearAutonomousTokenCache();
    let instance2Calls = 0;
    PowerBIService.__setMockRefreshTokenFetch(async () => {
      instance2Calls++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          expires_in: "3600",
          token_type: "Bearer",
          refresh_token: "ref_tok",
          id_token: createValidIdToken(),
          user_id: OWNER_UID,
          project_id: expectedProject
        })
      };
    });

    const resInstance2 = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });
    assert(resInstance2.status === 200, "Instância 2 independente obtém 200 OK no cold start sem estado compartilhado");
    assert(instance2Calls === 1, "Instância 2 executou a renovação autônoma a partir da Secret");

    // -------------------------------------------------------------------------
    // BLOCO 12: Revogação de Token e Limpeza de Estado
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 12: Revogação de Token e Limpeza de Estado");

    PowerBIService.__clearAutonomousTokenCache();
    PowerBIService.__setMockRefreshTokenFetch(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { code: 400, message: "TOKEN_EXPIRED" } })
    }));

    const resRevoked = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });
    assert(
      resRevoked.status === 503 && resRevoked.data.code === "FIREBASE_REFRESH_TOKEN_INVALID",
      "Rejeita token revogado com 503 FIREBASE_REFRESH_TOKEN_INVALID"
    );

    const statusAfterRevoke = PowerBIService.getActiveSessionStatus();
    assert(statusAfterRevoke.sessionActive === false, "Falha na renovação limpa imediatamente o status para sessionActive: false");
    assert(statusAfterRevoke.expiresInSeconds === 0, "TTL resetado para 0 após erro de autenticação");

    // -------------------------------------------------------------------------
    // BLOCO 13: Timeouts e Proteção de Segredos
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco 13: Timeout e Proteção de Segredos nas Respostas");

    PowerBIService.__clearAutonomousTokenCache();
    PowerBIService.__setMockRefreshTokenFetch(async () => {
      const err: any = new Error("Aborted");
      err.name = "TimeoutError";
      throw err;
    });

    const resTimeout = await makeRequest(server, "/api/powerbi-data", "GET", {
      "x-api-key": TEST_VALID_KEY
    });
    assert(resTimeout.status === 503 && resTimeout.data.code === "AUTH_TIMEOUT", "Timeout de rede retorna 503 com código genérico AUTH_TIMEOUT");

    const fullStatus = PowerBIService.getActiveSessionStatus();
    const statusStr = JSON.stringify(fullStatus);
    assert(!statusStr.includes("fingerprint"), "Nenhum hash ou fingerprint exposto no status");
    assert(!statusStr.includes(MOCK_REFRESH_TOKEN), "Nenhum refresh token exposto no status");
    assert(!statusStr.includes(TEST_VALID_KEY), "Nenhuma API key exposta no status");

    // Restaura ambiente original
    PowerBIService.__setMockRefreshTokenFetch(null);
    PowerBIService.__setMockFirestoreFetch(null);
    PowerBIService.__setMockCerts(null);
    PowerBIService.__clearAutonomousTokenCache();

    if (originalKey) process.env.POWERBI_API_KEY = originalKey;
    else delete process.env.POWERBI_API_KEY;

    if (originalUid) process.env.POWERBI_OWNER_UID = originalUid;
    else delete process.env.POWERBI_OWNER_UID;

    if (originalRefreshToken) process.env.FIREBASE_REFRESH_TOKEN = originalRefreshToken;
    else delete process.env.FIREBASE_REFRESH_TOKEN;

    if (originalNodeEnv) process.env.NODE_ENV = originalNodeEnv;
    else delete process.env.NODE_ENV;

    console.log("\n================================================================================");
    console.log(`🏁 RESULTADO FINAL: ${passedTests} de ${totalTests} asserções passaram.`);
    console.log("================================================================================");

    if (passedTests === totalTests) {
      console.log("🎉 TODAS AS ASSERÇÕES PASSARAM COM 100% DE SUCESSO!\n");
    } else {
      process.exit(1);
    }
  } finally {
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Erro fatal na suíte de testes:", err);
  process.exit(1);
});
