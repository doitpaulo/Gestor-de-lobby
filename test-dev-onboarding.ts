import fs from "fs";
import http from "http";
import path from "path";
import app from "./api/index";
import {
  AdminProvisioningService,
  AdminBackendAdapter,
  AdminUserRecord,
  DecodedAdminIdToken
} from "./services/adminProvisioningService";
import { StorageService, isTaskAuthorized } from "./services/storageService";
import { NEXUS_OWNER_UID, Task, User, WorkspaceMember } from "./types";

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ PASSOU: ${testName}`);
  } else {
    console.error(`  ❌ FALHOU: ${testName}`, details !== undefined ? details : "");
  }
}

function makeRequest(
  server: http.Server,
  reqPath: string,
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
        path: reqPath,
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
    if (body) req.write(postData);
    req.end();
  });
}

interface MockStore {
  users: Map<string, AdminUserRecord & { passwordHashMock?: string }>;
  docs: Map<string, Record<string, any>>;
  tokens: Map<string, DecodedAdminIdToken>;
  createUserCalls: number;
  deleteUserCalls: string[];
  failNextMemberWrite: boolean;
  failNextRollbackDelete: boolean;
  failNextTaskSync: boolean;
  delayMemberWriteMs: number;
}

function createMockBackend(): { store: MockStore; adapter: AdminBackendAdapter } {
  const store: MockStore = {
    users: new Map(),
    docs: new Map(),
    tokens: new Map(),
    createUserCalls: 0,
    deleteUserCalls: [],
    failNextMemberWrite: false,
    failNextRollbackDelete: false,
    failNextTaskSync: false,
    delayMemberWriteMs: 0
  };

  // Seed Root Owner & delegated ADMs / non-ADMs
  store.tokens.set("token-owner", {
    uid: NEXUS_OWNER_UID,
    email: "paulo.mmartinio@gmail.com",
    email_verified: true
  });
  store.tokens.set("token-delegated-adm", {
    uid: "uid-delegated-adm",
    email: "adm.delegado@empresa.com",
    email_verified: true
  });
  store.tokens.set("token-pending-adm", {
    uid: "uid-pending-adm",
    email: "adm.pendente@empresa.com",
    email_verified: true
  });
  store.tokens.set("token-collab", {
    uid: "uid-regular-collab",
    email: "collab@empresa.com",
    email_verified: true
  });

  store.docs.set(`users/${NEXUS_OWNER_UID}/members/uid-delegated-adm`, {
    id: "uid-delegated-adm",
    uid: "uid-delegated-adm",
    email: "adm.delegado@empresa.com",
    name: "ADM Delegado",
    role: "ADM",
    status: "active",
    mustChangePassword: false
  });
  store.docs.set(`users/${NEXUS_OWNER_UID}/members/uid-pending-adm`, {
    id: "uid-pending-adm",
    uid: "uid-pending-adm",
    email: "adm.pendente@empresa.com",
    name: "ADM Senha Pendente",
    role: "ADM",
    status: "active",
    mustChangePassword: true
  });
  store.docs.set(`users/${NEXUS_OWNER_UID}/members/uid-regular-collab`, {
    id: "uid-regular-collab",
    uid: "uid-regular-collab",
    email: "collab@empresa.com",
    name: "Colaborador Comum",
    role: "Colaborador",
    status: "active",
    mustChangePassword: false
  });

  // Seed 7 Devs in catalog (none are WorkspaceMembers yet!)
  for (let i = 1; i <= 7; i++) {
    store.docs.set(`users/${NEXUS_OWNER_UID}/devs/dev-${i}`, {
      id: `dev-${i}`,
      name: `Dev ${i}`,
      role: "RPA Developer",
      email: `dev${i}@empresa.com`
    });
  }

  // Seed tasks in Firestore
  store.docs.set(`users/${NEXUS_OWNER_UID}/tasks/TASK-001`, {
    id: "TASK-001",
    summary: "Automação Financeira (Dev 1)",
    assignee: "Dev 1",
    status: "Em Atendimento",
    allowedUids: []
  });
  store.docs.set(`users/${NEXUS_OWNER_UID}/tasks/TASK-002`, {
    id: "TASK-002",
    summary: "Automação RH (Dev 2)",
    assignee: "Dev 2",
    status: "Novo",
    allowedUids: ["uid-dev-2"]
  });
  store.docs.set(`users/${NEXUS_OWNER_UID}/tasks/TASK-003`, {
    id: "TASK-003",
    summary: "Demanda Sem Atribuição Com Nome Parecido",
    assignee: "Dev 1",
    status: "Novo",
    allowedUids: []
  });

  // Seed an existing Auth user (already signed up before ADM links)
  store.users.set("uid-existing-dev2", {
    uid: "uid-existing-dev2",
    email: "dev2@empresa.com",
    displayName: "Dev 2",
    emailVerified: true,
    disabled: false,
    tokensValidAfterTime: "2026-10-01T10:00:00.000Z",
    passwordHashMock: "ORIGINAL_USER_PASSWORD_SECRET",
    metadata: {
      creationTime: "2026-10-01T10:00:00.000Z"
    }
  });
  store.docs.set(`users/${NEXUS_OWNER_UID}/accessRequests/uid-existing-dev2`, {
    id: "uid-existing-dev2",
    uid: "uid-existing-dev2",
    email: "dev2@empresa.com",
    name: "Dev 2",
    status: "pending",
    requestedAt: "2026-10-02T10:00:00.000Z"
  });

  const adapter: AdminBackendAdapter = {
    isMock: true,
    verifyIdToken: async (token: string) => {
      const decoded = store.tokens.get(token);
      if (!decoded) {
        throw new Error("Invalid ID token");
      }
      return decoded;
    },
    getUser: async (uid: string) => {
      const user = store.users.get(uid);
      if (!user) {
        const err: any = new Error("User not found");
        err.code = "auth/user-not-found";
        throw err;
      }
      return { ...user };
    },
    getUserByEmail: async (email: string) => {
      const clean = email.trim().toLowerCase();
      for (const u of store.users.values()) {
        if ((u.email || "").toLowerCase() === clean) {
          return { ...u };
        }
      }
      const err: any = new Error("User not found");
      err.code = "auth/user-not-found";
      throw err;
    },
    createUser: async (params) => {
      store.createUserCalls++;
      const clean = params.email.trim().toLowerCase();
      for (const u of store.users.values()) {
        if ((u.email || "").toLowerCase() === clean) {
          const err: any = new Error("Email already exists");
          err.code = "auth/email-already-exists";
          throw err;
        }
      }
      const uid = `uid-created-${store.createUserCalls}`;
      const nowIso = new Date().toISOString();
      const rec: AdminUserRecord & { passwordHashMock?: string } = {
        uid,
        email: clean,
        displayName: params.displayName,
        emailVerified: params.emailVerified,
        disabled: Boolean(params.disabled),
        tokensValidAfterTime: nowIso,
        passwordHashMock: `HASH(${params.password})`,
        metadata: { creationTime: nowIso }
      };
      store.users.set(uid, rec);
      return { ...rec };
    },
    deleteUser: async (uid: string) => {
      store.deleteUserCalls.push(uid);
      if (store.failNextRollbackDelete) {
        store.failNextRollbackDelete = false;
        throw new Error("Simulated rollback delete failure");
      }
      store.users.delete(uid);
    },
    getDoc: async (docPath: string) => {
      const data = store.docs.get(docPath);
      return {
        exists: Boolean(data),
        data: data ? JSON.parse(JSON.stringify(data)) : undefined
      };
    },
    setDoc: async (docPath: string, data: Record<string, any>, merge = true) => {
      if (docPath.includes("/members/") && store.delayMemberWriteMs > 0) {
        const ms = store.delayMemberWriteMs;
        await new Promise((r) => setTimeout(r, ms));
      }
      if (docPath.includes("/members/") && store.failNextMemberWrite) {
        store.failNextMemberWrite = false;
        throw new Error("Simulated Firestore permission/network failure with secret: TempPass#Fail99!");
      }
      const prev = merge ? store.docs.get(docPath) || {} : {};
      store.docs.set(docPath, JSON.parse(JSON.stringify({ ...prev, ...data })));
    },
    deleteDoc: async (docPath: string) => {
      store.docs.delete(docPath);
    },
    syncTaskAcls: async ({ ownerUid, targetUid, addTaskIds, removeTaskIds }) => {
      if (store.failNextTaskSync) {
        store.failNextTaskSync = false;
        throw new Error("Simulated batch write failure on tasks ACL");
      }
      const missingTaskIds: string[] = [];
      let addedCount = 0;
      let removedCount = 0;

      for (const taskId of addTaskIds) {
        const p = `users/${ownerUid}/tasks/${taskId}`;
        const existing = store.docs.get(p);
        if (!existing) {
          missingTaskIds.push(taskId);
          continue;
        }
        const allowed = new Set<string>(Array.isArray(existing.allowedUids) ? existing.allowedUids : []);
        allowed.add(targetUid);
        store.docs.set(p, {
          ...existing,
          allowedUids: Array.from(allowed),
          assignedUid: existing.assignedUid || targetUid
        });
        addedCount++;
      }

      for (const taskId of removeTaskIds) {
        const p = `users/${ownerUid}/tasks/${taskId}`;
        const existing = store.docs.get(p);
        if (!existing) continue;
        const allowed = (Array.isArray(existing.allowedUids) ? existing.allowedUids : []).filter(
          (id: string) => id !== targetUid
        );
        const next: Record<string, any> = { ...existing, allowedUids: allowed };
        if (next.assignedUid === targetUid) {
          delete next.assignedUid;
        }
        store.docs.set(p, next);
        removedCount++;
      }

      return { missingTaskIds, addedCount, removedCount };
    }
  };

  return { store, adapter };
}

async function runTests() {
  console.log("================================================================================");
  console.log("🧪 SUÍTE ISOLADA DE TESTES: ONBOARDING DE DEVS, PROVISIONAMENTO ADM & ACL");
  console.log("================================================================================\n");

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const origSa = process.env.FIREBASE_SERVICE_ACCOUNT;
  const origGac = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const origAuthEmu = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const origFsEmu = process.env.FIRESTORE_EMULATOR_HOST;

  try {
    // -------------------------------------------------------------------------
    // BLOCO A: Fail-closed sem credenciais e Verificação de ADM no Servidor
    // -------------------------------------------------------------------------
    console.log("👉 Bloco A: Fail-closed & Autorização ADM Verificada no Servidor");

    delete process.env.FIREBASE_SERVICE_ACCOUNT;
    delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    delete process.env.FIRESTORE_EMULATOR_HOST;
    AdminProvisioningService.__setMockAdminBackend(null);

    const resFailClosed = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer any-token" },
      { mode: "create-with-temp-password", email: "dev1@empresa.com", name: "Dev 1", tempPassword: "TempPassword123!" }
    );
    assert(
      resFailClosed.status === 503 && resFailClosed.data.code === "ADMIN_SDK_UNAVAILABLE",
      "Fail-closed retorna 503 ADMIN_SDK_UNAVAILABLE quando Admin SDK não está configurado"
    );

    const { store, adapter } = createMockBackend();
    AdminProvisioningService.__setMockAdminBackend(adapter);

    const resNoAuth = await makeRequest(server, "/api/admin/provision-dev", "POST", {}, {});
    assert(resNoAuth.status === 401 && resNoAuth.data.code === "UNAUTHENTICATED", "Rejeita chamada sem Authorization Bearer com 401");

    const resBadToken = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer forged-token" },
      {}
    );
    assert(resBadToken.status === 401 && resBadToken.data.code === "INVALID_TOKEN", "Rejeita token inválido/adulterado com 401");

    const resCollabForbidden = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-collab" },
      { mode: "create-with-temp-password", email: "dev1@empresa.com", name: "Dev 1", tempPassword: "TempPassword123!" }
    );
    assert(
      resCollabForbidden.status === 403 && resCollabForbidden.data.code === "FORBIDDEN_NOT_ADMIN",
      "Bloqueia colaborador comum tentando chamar /api/admin/provision-dev (403)"
    );

    const resPendingAdmForbidden = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-pending-adm" },
      { mode: "create-with-temp-password", email: "dev1@empresa.com", name: "Dev 1", tempPassword: "TempPassword123!" }
    );
    assert(
      resPendingAdmForbidden.status === 403 && resPendingAdmForbidden.data.code === "FORBIDDEN_NOT_ADMIN",
      "Bloqueia ADM com mustChangePassword=true tentando provisionar outros usuários (403)"
    );

    const resDelegatedPromoteAdm = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-delegated-adm" },
      {
        mode: "create-with-temp-password",
        email: "dev1@empresa.com",
        name: "Dev 1",
        role: "ADM",
        tempPassword: "TempPassword123!"
      }
    );
    assert(
      resDelegatedPromoteAdm.status === 403 && resDelegatedPromoteAdm.data.code === "FORBIDDEN_OWNER_ONLY_ADM",
      "Impede ADM delegado de promover outro usuário a ADM (somente Proprietário Raiz)"
    );

    // -------------------------------------------------------------------------
    // BLOCO B: Provisionamento ADM com Senha Temporária + Higiene de Senha
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco B: Provisionamento pelo ADM com Senha Temporária & Higiene");

    const SECRET_TEMP_PASS = "NexusTmp#2026!Secret";
    const resProvisionDev1 = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-owner" },
      {
        mode: "create-with-temp-password",
        email: "dev1@empresa.com",
        name: "Dev 1",
        tempPassword: SECRET_TEMP_PASS,
        role: "Colaborador",
        status: "active",
        linkedDevId: "dev-1",
        linkedDevName: "Dev 1",
        permissions: {
          modules: {
            dashboard: false,
            projects: false,
            esteira: false,
            sprints: false,
            projectReport: false,
            kanban: true,
            list: true,
            gantt: false,
            robots: false,
            totem: false,
            reports: false
          },
          actions: {
            view: true,
            create: false,
            edit: true,
            comment: true,
            attach: false,
            export: false
          }
        },
        assignedTaskIds: ["TASK-001"]
      }
    );

    const dev1Uid = resProvisionDev1.data?.uid;
    assert(resProvisionDev1.status === 200 && resProvisionDev1.data.success === true, "Owner provisiona Dev 1 no servidor com sucesso (200)");
    assert(Boolean(dev1Uid) && resProvisionDev1.data.linkedDevUpdated === true, "Vinculou cadastro Dev 1 ao UID criado no Auth");
    assert(resProvisionDev1.data.addedTasksCount === 1, "Liberou exatamente 1 demanda atribuída (TASK-001)");
    assert(resProvisionDev1.headers["cache-control"] === "no-store", "Resposta de provisionamento inclui Cache-Control: no-store");

    const createdMemberDoc = store.docs.get(`users/${NEXUS_OWNER_UID}/members/${dev1Uid}`) as WorkspaceMember;
    const createdAuthUser = store.users.get(dev1Uid);
    assert(createdAuthUser?.emailVerified === false, "Provisionamento ADM NÃO declara e-mail externo como verificado sem prova (emailVerified === false)");
    const updatedDev1Doc = store.docs.get(`users/${NEXUS_OWNER_UID}/devs/dev-1`);
    const task1Doc = store.docs.get(`users/${NEXUS_OWNER_UID}/tasks/TASK-001`);
    const task2Doc = store.docs.get(`users/${NEXUS_OWNER_UID}/tasks/TASK-002`);
    const task3Doc = store.docs.get(`users/${NEXUS_OWNER_UID}/tasks/TASK-003`);

    assert(createdMemberDoc?.mustChangePassword === true && typeof createdMemberDoc?.tempPasswordSetAt === "number", "Membro criado com mustChangePassword: true e tempPasswordSetAt");
    assert(createdMemberDoc?.permissions?.modules?.list === true && createdMemberDoc?.permissions?.modules?.kanban === true && createdMemberDoc?.permissions?.modules?.dashboard === false, "Módulos configurados preservados (Lista/Kanban ativos, Dashboard bloqueado)");
    assert(updatedDev1Doc?.linkedUid === dev1Uid && updatedDev1Doc?.linkedMemberId === dev1Uid, "Registro em devs/dev-1 atualizado apenas com metadados linkedUid/linkedMemberId");
    assert(Array.isArray(task1Doc?.allowedUids) && task1Doc.allowedUids.includes(dev1Uid), "TASK-001 inclui UID do Dev 1 em allowedUids");
    assert(!Array.isArray(task2Doc?.allowedUids) || !task2Doc.allowedUids.includes(dev1Uid), "TASK-002 (de outro dev) NÃO inclui UID do Dev 1");
    assert(!Array.isArray(task3Doc?.allowedUids) || !task3Doc.allowedUids.includes(dev1Uid), "TASK-003 (não atribuída, mesmo com assignee='Dev 1') NÃO inclui UID do Dev 1");

    // Password Hygiene: tempPassword NEVER persisted in response or Firestore
    const serializedState = JSON.stringify({
      response: resProvisionDev1.data,
      member: createdMemberDoc,
      dev: updatedDev1Doc,
      tasks: [task1Doc, task2Doc, task3Doc]
    });
    assert(!serializedState.includes(SECRET_TEMP_PASS), "Senha temporária NUNCA aparece na resposta HTTP nem em qualquer documento do Firestore");

    // -------------------------------------------------------------------------
    // BLOCO C: Separação Devs vs Membros & Zero Auto-acesso pela lista de Devs
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco C: Separação Estrita entre Catálogo de Devs e Membros");

    const unprovisionedDev3Raw: User = {
      id: "uid-unprovisioned-dev3",
      name: "Dev 3",
      email: "dev3@empresa.com",
      emailVerified: true,
      role: "Colaborador"
    };
    const resolvedDev3 = StorageService.resolveUserMembership(unprovisionedDev3Raw, null);
    assert(
      resolvedDev3.status === "pending" && resolvedDev3.pendingReason === "UNAUTHORIZED" && resolvedDev3.role === "Colaborador",
      "Dev presente no catálogo (7 devs), porém sem registro em members/, permanece pending/UNAUTHORIZED"
    );

    const unverifiedExternalRaw: User = {
      id: "uid-unverified-ext",
      name: "Externo",
      email: "externo@empresa.com",
      emailVerified: false,
      role: "Colaborador"
    };
    const resolvedUnverified = StorageService.resolveUserMembership(unverifiedExternalRaw, null);
    assert(
      resolvedUnverified.status === "pending" && resolvedUnverified.pendingReason === "EMAIL_UNVERIFIED",
      "Usuário externo sem e-mail verificado recebe pendingReason EMAIL_UNVERIFIED"
    );

    // -------------------------------------------------------------------------
    // BLOCO D: Troca Obrigatória de Senha Antes de Liberar Dados & Isolamento
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco D: Barreira Obrigatória de Troca de Senha & Isolamento de Demandas");

    store.tokens.set("token-dev1", {
      uid: dev1Uid,
      email: "dev1@empresa.com",
      email_verified: true
    });

    // Simulate Dev 1 resolved user while mustChangePassword === true
    const dev1WhileMustChange = StorageService.resolveUserMembership(
      { id: dev1Uid, name: "Dev 1", email: "dev1@empresa.com", emailVerified: true, role: "Colaborador" },
      createdMemberDoc
    );
    assert(
      dev1WhileMustChange.mustChangePassword === true && dev1WhileMustChange.pendingReason === "MUST_CHANGE_PASSWORD",
      "resolveUserMembership sinaliza mustChangePassword: true e MUST_CHANGE_PASSWORD antes da troca"
    );
    assert(
      isTaskAuthorized(task1Doc as Task, dev1WhileMustChange) === false,
      "isTaskAuthorized bloqueia leitura de demanda mesmo atribuída enquanto mustChangePassword === true"
    );

    // Attempt to call complete-first-password-change BEFORE actually changing Auth password
    const resBypassAttempt = await makeRequest(
      server,
      "/api/auth/complete-first-password-change",
      "POST",
      { Authorization: "Bearer token-dev1" }
    );
    assert(
      resBypassAttempt.status === 403 && resBypassAttempt.data.code === "PASSWORD_CHANGE_NOT_VERIFIED",
      "Bloqueia tentativa de liberar dados sem troca real de senha no Firebase Auth (403 PASSWORD_CHANGE_NOT_VERIFIED)"
    );

    // Simulate real Auth updatePassword advancing tokensValidAfterTime
    const authUser1 = store.users.get(dev1Uid)!;
    authUser1.tokensValidAfterTime = new Date(Date.now() + 5000).toISOString();
    authUser1.passwordHashMock = "NEW_PERSONAL_DEV_PASSWORD";

    const resCompleteChange = await makeRequest(
      server,
      "/api/auth/complete-first-password-change",
      "POST",
      { Authorization: "Bearer token-dev1" }
    );
    assert(
      resCompleteChange.status === 200 && resCompleteChange.data.success === true && resCompleteChange.data.member?.mustChangePassword === false,
      "Confirma troca real no Auth, atualiza mustChangePassword=false e grava passwordChangedAt (200)"
    );

    const updatedMember1 = store.docs.get(`users/${NEXUS_OWNER_UID}/members/${dev1Uid}`) as WorkspaceMember;
    const dev1AfterPasswordChange = StorageService.resolveUserMembership(
      { id: dev1Uid, name: "Dev 1", email: "dev1@empresa.com", emailVerified: true, role: "Colaborador" },
      updatedMember1
    );
    assert(
      isTaskAuthorized(task1Doc as Task, dev1AfterPasswordChange) === true,
      "Após troca de senha, Dev 1 lê demanda atribuída (TASK-001)"
    );
    assert(
      isTaskAuthorized(task2Doc as Task, dev1AfterPasswordChange) === false,
      "Após troca de senha, Dev 1 continua NEGADO para demanda de outro dev (TASK-002)"
    );
    assert(
      isTaskAuthorized(task3Doc as Task, dev1AfterPasswordChange) === false,
      "Após troca de senha, Dev 1 continua NEGADO para demanda não liberada por UID mesmo com assignee='Dev 1' (TASK-003)"
    );

    // -------------------------------------------------------------------------
    // BLOCO E: Vincular Conta Existente Sem Redefinir Senha
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco E: Vincular Conta Existente Sem Alterar Senha Atual");

    const resConflictCreate = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-delegated-adm" },
      {
        mode: "create-with-temp-password",
        email: "dev2@empresa.com",
        name: "Dev 2",
        tempPassword: "ShouldNotOverwrite123!"
      }
    );
    assert(
      resConflictCreate.status === 409 &&
        resConflictCreate.data.code === "EMAIL_ALREADY_EXISTS" &&
        resConflictCreate.data.existingUid === "uid-existing-dev2",
      "Bloqueia criação sobre e-mail Auth já existente (409 EMAIL_ALREADY_EXISTS) e retorna existingUid"
    );
    assert(
      store.users.get("uid-existing-dev2")?.passwordHashMock === "ORIGINAL_USER_PASSWORD_SECRET",
      "Senha original do usuário existente permanece 100% intacta"
    );

    const resLinkExisting = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-delegated-adm" },
      {
        mode: "link-existing",
        email: "dev2@empresa.com",
        name: "Dev 2",
        existingUid: "uid-existing-dev2",
        linkedDevId: "dev-2",
        linkedDevName: "Dev 2",
        status: "active",
        role: "Colaborador",
        permissions: {
          modules: { list: true, kanban: true, dashboard: false },
          actions: { view: true, edit: true }
        },
        assignedTaskIds: ["TASK-002"]
      }
    );
    assert(
      resLinkExisting.status === 200 &&
        resLinkExisting.data.success === true &&
        resLinkExisting.data.uid === "uid-existing-dev2" &&
        resLinkExisting.data.member?.mustChangePassword === false,
      "ADM delegado vincula conta existente via link-existing sem forçar troca de senha (200)"
    );
    assert(
      store.users.get("uid-existing-dev2")?.passwordHashMock === "ORIGINAL_USER_PASSWORD_SECRET",
      "link-existing NUNCA redefine senha do usuário existente"
    );
    assert(
      store.docs.get(`users/${NEXUS_OWNER_UID}/accessRequests/uid-existing-dev2`)?.status === "resolved",
      "Solicitação pendente em accessRequests/{uid} é marcada como resolved automaticamente ao vincular"
    );

    // -------------------------------------------------------------------------
    // BLOCO F: Tratamento de Falhas Parciais, Rollback & Concorrência
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco F: Falhas Parciais, Rollback Automático & Repetição Idempotente");

    // F.1: Member write fails after Auth user created -> compensating deleteUser rollback
    store.failNextMemberWrite = true;
    const leakedPass = "TempPass#Fail99!";
    const resRollback = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-owner" },
      {
        mode: "create-with-temp-password",
        email: "dev4@empresa.com",
        name: "Dev 4",
        tempPassword: leakedPass,
        linkedDevId: "dev-4"
      }
    );
    assert(
      resRollback.status === 500 &&
        resRollback.data.code === "PROVISION_ROLLED_BACK" &&
        resRollback.data.rollbackSucceeded === true,
      "Falha ao gravar membro no Firestore aciona rollback do usuário Auth criado (PROVISION_ROLLED_BACK)"
    );
    assert(!JSON.stringify(resRollback.data).includes(leakedPass), "Mensagem de erro de falha parcial sanitiza a senha temporária ([REDACTED])");

    // F.2: Task ACL sync fails after Auth + Member saved -> exposes createdUid + allows idempotent retry via link-existing
    store.failNextTaskSync = true;
    const resPartialTasks = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-owner" },
      {
        mode: "create-with-temp-password",
        email: "dev5@empresa.com",
        name: "Dev 5",
        tempPassword: "TempPass#Dev5!",
        linkedDevId: "dev-5",
        assignedTaskIds: ["TASK-001"]
      }
    );
    assert(
      resPartialTasks.status === 500 &&
        resPartialTasks.data.code === "PARTIAL_FAILURE_TASKS_SYNC" &&
        resPartialTasks.data.partialFailure === true &&
        Boolean(resPartialTasks.data.createdUid),
      "Falha na sincronização de ACL das demandas reporta PARTIAL_FAILURE_TASKS_SYNC com createdUid e member"
    );

    const dev5Uid = resPartialTasks.data.createdUid;
    const resRetryLink = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-owner" },
      {
        mode: "link-existing",
        email: "dev5@empresa.com",
        name: "Dev 5",
        existingUid: dev5Uid,
        linkedDevId: "dev-5",
        assignedTaskIds: ["TASK-001"]
      }
    );
    assert(
      resRetryLink.status === 200 && resRetryLink.data.member?.mustChangePassword === true && resRetryLink.data.addedTasksCount === 1,
      "Repetição idempotente via link-existing após falha parcial conclui liberação de demandas e preserva mustChangePassword=true"
    );

    // F.3: Concurrent duplicate request for same email -> 409 REQUEST_IN_PROGRESS
    store.delayMemberWriteMs = 120;
    const pFirst = makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-owner" },
      {
        mode: "create-with-temp-password",
        email: "dev6@empresa.com",
        name: "Dev 6",
        tempPassword: "TempPass#Dev6!"
      }
    );
    // Slight delay so first call acquires lock
    await new Promise((r) => setTimeout(r, 20));
    const resConcurrent = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: "Bearer token-owner" },
      {
        mode: "create-with-temp-password",
        email: "dev6@empresa.com",
        name: "Dev 6",
        tempPassword: "TempPass#Dev6!"
      }
    );
    const resFirst = await pFirst;
    store.delayMemberWriteMs = 0;

    assert(resFirst.status === 200, "Primeira requisição concorrente conclui normalmente (200)");
    assert(
      resConcurrent.status === 409 && resConcurrent.data.code === "REQUEST_IN_PROGRESS",
      "Segunda requisição concorrente para o mesmo e-mail é bloqueada com 409 REQUEST_IN_PROGRESS"
    );

    // -------------------------------------------------------------------------
    // BLOCO G: Auditoria Estática de Segurança em firestore.rules
    // -------------------------------------------------------------------------
    console.log("\n👉 Bloco G: Auditoria Estática de Contrato & Regras em firestore.rules");

    const rulesText = fs.readFileSync(path.join(process.cwd(), "firestore.rules"), "utf-8");
    assert(!/allow\s+create\s*:\s*if\s+true/i.test(rulesText), "firestore.rules NÃO contém nenhuma regra insegura 'allow create: if true'");
    assert(rulesText.includes(NEXUS_OWNER_UID), `firestore.rules preserva UID imutável do proprietário (${NEXUS_OWNER_UID})`);
    assert(rulesText.includes("mustChangePassword") && rulesText.includes("!= true"), "isActiveMember exige mustChangePassword != true antes de liberar leituras/escritas");
    assert(
      rulesText.includes("request.auth.uid == requestId") &&
        rulesText.includes("request.auth.token.email_verified == true") &&
        rulesText.includes("!exists(/databases/$(database)/documents/users/$(userId)/accessRequests/$(requestId))"),
      "accessRequests exige auth, uid == docId, email_verified == true e bloqueio de duplicata (!exists)"
    );
    assert(
      rulesText.includes("request.resource.data.keys().hasAll") &&
        rulesText.includes("request.resource.data.keys().hasOnly") &&
        rulesText.includes("request.resource.data.status == 'pending'"),
      "accessRequests valida esquema estrito (hasAll/hasOnly), match de e-mail do token e status == 'pending'"
    );
    assert(
      rulesText.includes("request.auth.uid in resource.data.allowedUids") &&
        !rulesText.includes("resource.data.assignee == request.auth.token.email"),
      "tasks isola leitura/edição estritamente por assignedUid/allowedUids sem fallback frágil por nome/e-mail"
    );
    assert(
      rulesText.includes("match /recoveryRequests/{requestId}") &&
        !rulesText.includes("allow create: if true"),
      "recoveryRequests restrito a Owner/ADM/Admin SDK sem criação pública aberta"
    );

    console.log("\n================================================================================");
    console.log(`🏁 RESULTADO FINAL: ${passedTests} de ${totalTests} asserções passaram.`);
    console.log("================================================================================");

    if (passedTests === totalTests) {
      console.log("🎉 TODAS AS ASSERÇÕES DE ONBOARDING & PROVISIONAMENTO PASSARAM COM 100% DE SUCESSO!\n");
    } else {
      process.exit(1);
    }
  } finally {
    AdminProvisioningService.__setMockAdminBackend(null);
    if (origSa !== undefined) process.env.FIREBASE_SERVICE_ACCOUNT = origSa;
    else delete process.env.FIREBASE_SERVICE_ACCOUNT;
    if (origGac !== undefined) process.env.GOOGLE_APPLICATION_CREDENTIALS = origGac;
    else delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (origAuthEmu !== undefined) process.env.FIREBASE_AUTH_EMULATOR_HOST = origAuthEmu;
    else delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    if (origFsEmu !== undefined) process.env.FIRESTORE_EMULATOR_HOST = origFsEmu;
    else delete process.env.FIRESTORE_EMULATOR_HOST;
    server.close();
  }
}

runTests().catch((err) => {
  console.error("Erro fatal na suíte de testes de onboarding:", err);
  process.exit(1);
});
