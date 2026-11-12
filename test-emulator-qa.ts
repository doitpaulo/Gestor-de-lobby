import http from "http";
import { initializeApp, deleteApp, FirebaseApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  updatePassword,
  signOut
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  collection,
  query,
  where
} from "firebase/firestore";
import { getApps as getAdminApps, initializeApp as initAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

import app from "./api/index";
import firebaseConfig from "./firebase-applet-config.json";
import { AdminProvisioningService } from "./services/adminProvisioningService";
import { StorageService } from "./services/storageService";
import { NEXUS_OWNER_UID } from "./types";

let totalTests = 0;
let passedTests = 0;
const unsupportedLimitations: string[] = [];

function assert(condition: boolean, testName: string, details?: any) {
  totalTests++;
  if (condition) {
    passedTests++;
    console.log(`  ✔ PASSOU: ${testName}`);
  } else {
    console.error(`  ❌ FALHOU: ${testName}`, details !== undefined ? details : "");
  }
}

function recordUnsupported(capability: string, reason: string) {
  unsupportedLimitations.push(`${capability}: ${reason}`);
  console.log(`  ⚠️ NÃO SUPORTADO (registrado explicitamente): ${capability} -> ${reason}`);
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

    const reqHeaders: Record<string, string> = { ...headers };
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
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let parsed: any = raw;
          try {
            parsed = JSON.parse(raw);
          } catch {}
          resolve({ status: res.statusCode || 500, headers: res.headers, data: parsed });
        });
      }
    );

    req.on("error", reject);
    if (body) req.write(postData);
    req.end();
  });
}

async function clearEmulators(projectId: string, databaseId: string, authHost: string, fsHost: string) {
  const authRes = await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/accounts`, {
    method: "DELETE"
  });
  if (!authRes.ok) {
    throw new Error(`Falha ao limpar Auth Emulator: ${authRes.status}`);
  }

  const dbSegment = databaseId && databaseId !== "(default)" ? databaseId : "(default)";
  const fsRes = await fetch(
    `http://${fsHost}/emulator/v1/projects/${projectId}/databases/${encodeURIComponent(dbSegment)}/documents`,
    { method: "DELETE" }
  );
  if (!fsRes.ok) {
    throw new Error(`Falha ao limpar Firestore Emulator: ${fsRes.status}`);
  }
}

function createIsolatedClientSdk(name: string, authHost: string, fsHost: string) {
  const clientApp: FirebaseApp = initializeApp(firebaseConfig, name);
  const clientAuth = getAuth(clientApp);
  connectAuthEmulator(clientAuth, `http://${authHost}`, { disableWarnings: true });

  const [fsHostName, fsPortStr] = fsHost.split(":");
  const databaseId = (firebaseConfig as any).firestoreDatabaseId;
  const clientDb =
    databaseId && databaseId !== "(default)"
      ? getFirestore(clientApp, databaseId)
      : getFirestore(clientApp);
  connectFirestoreEmulator(clientDb, fsHostName, Number(fsPortStr));

  return { clientApp, clientAuth, clientDb };
}

async function expectPermissionDenied(fn: () => Promise<any>): Promise<{ denied: boolean; code?: string; message?: string }> {
  try {
    await fn();
    return { denied: false };
  } catch (err: any) {
    const code = String(err?.code || "");
    const msg = String(err?.message || "");
    const hasNullValueError = msg.includes("Null value error");
    const hasExplicitFalse = /false for '(get|list|create|update|delete|write)' @ L\d+/.test(msg);
    const hasEvalError = msg.includes("evaluation error");
    const isPermissionDeniedCode =
      code === "permission-denied" ||
      code.includes("permission-denied") ||
      msg.includes("PERMISSION_DENIED") ||
      msg.includes("Missing or insufficient permissions");

    const isDenied =
      isPermissionDeniedCode &&
      !hasNullValueError &&
      (!hasEvalError || hasExplicitFalse);

    return { denied: isDenied, code, message: msg };
  }
}

async function runEmulatorQA() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;

  if (!authHost || !fsHost) {
    console.error("❌ ERRO: Este teste DEVE rodar exclusivamente via Firebase Auth + Firestore Emulator.");
    console.error("Execute: firebase emulators:exec --config /tmp/firebase.qa.json --project atomic-chess-2kpr3 --only auth,firestore \"npx tsx test-emulator-qa.ts\"");
    process.exit(1);
  }

  // Ensure AdminProvisioningService uses REAL Admin SDK pointing to Emulator (NO mock adapter!)
  AdminProvisioningService.__setMockAdminBackend(null);

  const projectId = firebaseConfig.projectId;
  const databaseId = (firebaseConfig as any).firestoreDatabaseId || "(default)";

  console.log("================================================================================");
  console.log("🧪 QA DE INTEGRAÇÃO EM EMULADOR DESCARTÁVEL (AUTH + FIRESTORE + RULES + API)");
  console.log(`   Auth Emulator: ${authHost} | Firestore Emulator: ${fsHost}`);
  console.log(`   Project ID (descartável): ${projectId} | DB: ${databaseId}`);
  console.log("================================================================================\n");

  await clearEmulators(projectId, databaseId, authHost, fsHost);

  const adminApp =
    getAdminApps().find((a) => a.name === "qa-seeder") ||
    initAdminApp({ projectId }, "qa-seeder");
  const adminAuth = getAdminAuth(adminApp);
  const adminDb =
    databaseId && databaseId !== "(default)"
      ? getAdminFirestore(adminApp, databaseId)
      : getAdminFirestore(adminApp);

  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  const clientAppsToCleanup: FirebaseApp[] = [];

  try {
    // =========================================================================
    // CENÁRIO 1: EMPRESA A — EMILY (DEV FICTÍCIA COM E-MAIL EXTERNO)
    // =========================================================================
    console.log("👉 Cenário 1: ADM A provisiona Emily (e-mail externo), negação pré-troca, troca real no Auth Emulator e ACL");

    // Seed ADM A (Root Owner UID da Empresa A) apenas no Auth Emulator descartável
    await adminAuth.createUser({
      uid: NEXUS_OWNER_UID,
      email: "adm.a.qa@empresa-a.example",
      password: "AdmASecretQa#2026!",
      displayName: "ADM Empresa A (QA)",
      emailVerified: true
    });

    const admAClient = createIsolatedClientSdk("client-adm-a", authHost, fsHost);
    clientAppsToCleanup.push(admAClient.clientApp);

    const admACred = await signInWithEmailAndPassword(
      admAClient.clientAuth,
      "adm.a.qa@empresa-a.example",
      "AdmASecretQa#2026!"
    );
    const admAToken = await admACred.user.getIdToken();

    // ADM A cadastra catálogo fictício de Devs e 2 demandas da Empresa A
    await adminDb.doc(`users/${NEXUS_OWNER_UID}/devs/dev-emily-qa`).set({
      id: "dev-emily-qa",
      name: "Emily QA Fictícia",
      role: "RPA Developer",
      email: "emily.qa@dominio-externo.example"
    });
    await adminDb.doc(`users/${NEXUS_OWNER_UID}/devs/dev-outro-qa`).set({
      id: "dev-outro-qa",
      name: "Outro Dev QA",
      role: "RPA Developer",
      email: "outro.dev@empresa-a.example"
    });

    await adminDb.doc(`users/${NEXUS_OWNER_UID}/tasks/TASK-A-EMILY-1`).set({
      id: "TASK-A-EMILY-1",
      summary: "Demanda Exclusiva Emily QA",
      assignee: "Emily QA Fictícia",
      status: "Em Atendimento",
      allowedUids: []
    });
    await adminDb.doc(`users/${NEXUS_OWNER_UID}/tasks/TASK-A-OUTRO-2`).set({
      id: "TASK-A-OUTRO-2",
      summary: "Demanda Confidencial Outro Dev",
      assignee: "Outro Dev QA",
      status: "Novo",
      allowedUids: ["uid-outro-dev-a-qa"]
    });

    const EMILY_EXTERNAL_EMAIL = "emily.qa@dominio-externo.example";
    const EMILY_TEMP_PASS = "TmpPass#EmilyQa99";
    const EMILY_NEW_PASS = "NovaSenhaForte#Emily2026!";

    // 1.1 ADM A provisiona Emily via endpoint real (Admin SDK -> Auth Emulator + Firestore Emulator)
    const provisionRes = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: `Bearer ${admAToken}` },
      {
        mode: "create-with-temp-password",
        email: EMILY_EXTERNAL_EMAIL,
        name: "Emily QA Fictícia",
        tempPassword: EMILY_TEMP_PASS,
        role: "Colaborador",
        status: "active",
        linkedDevId: "dev-emily-qa",
        linkedDevName: "Emily QA Fictícia",
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
        assignedTaskIds: ["TASK-A-EMILY-1"]
      }
    );

    const emilyUid = provisionRes.data?.uid;
    assert(
      provisionRes.status === 200 && provisionRes.data?.success === true && Boolean(emilyUid),
      "ADM A provisionou Emily com sucesso no Auth Emulator + Firestore Emulator (200)",
      provisionRes.data
    );

    // 1.2 Verificar que e-mail externo NÃO foi declarado como verificado sem prova
    const emilyAdminAuthRec = await adminAuth.getUser(emilyUid);
    assert(
      emilyAdminAuthRec.emailVerified === false,
      "Provisionamento NÃO declara e-mail externo como verificado sem prova (emailVerified === false no Auth Emulator)",
      { emailVerified: emilyAdminAuthRec.emailVerified }
    );

    // Verificar higiene de senha e vínculo no Firestore Emulator
    const emilyMemberSnap = await adminDb.doc(`users/${NEXUS_OWNER_UID}/members/${emilyUid}`).get();
    const emilyDevSnap = await adminDb.doc(`users/${NEXUS_OWNER_UID}/devs/dev-emily-qa`).get();
    const taskEmilyBeforeSnap = await adminDb.doc(`users/${NEXUS_OWNER_UID}/tasks/TASK-A-EMILY-1`).get();

    assert(
      emilyMemberSnap.exists && emilyMemberSnap.data()?.mustChangePassword === true,
      "Documento members/{emilyUid} persistido no Firestore Emulator com mustChangePassword: true"
    );
    assert(
      emilyDevSnap.data()?.linkedUid === emilyUid && emilyDevSnap.data()?.linkedMemberId === emilyUid,
      "Cadastro devs/dev-emily-qa atualizado com linkedUid/linkedMemberId"
    );
    assert(
      !JSON.stringify({ res: provisionRes.data, member: emilyMemberSnap.data(), dev: emilyDevSnap.data(), task: taskEmilyBeforeSnap.data() }).includes(EMILY_TEMP_PASS),
      "Senha temporária não foi gravada em nenhuma resposta HTTP ou documento do Firestore Emulator"
    );

    // 1.3 Emily faz login no Auth Emulator com senha temporária
    const emilyClient = createIsolatedClientSdk("client-emily", authHost, fsHost);
    clientAppsToCleanup.push(emilyClient.clientApp);

    const emilyLoginCred = await signInWithEmailAndPassword(
      emilyClient.clientAuth,
      EMILY_EXTERNAL_EMAIL,
      EMILY_TEMP_PASS
    );
    assert(
      emilyLoginCred.user.uid === emilyUid && emilyLoginCred.user.emailVerified === false,
      "Emily autenticou no Auth Emulator com senha temporária e mantém emailVerified === false"
    );

    // Leitura do próprio perfil de membro funciona (para acionar barreira ForcePasswordChangeScreen)
    const emilyOwnMemberRead = await getDoc(
      doc(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/members/${emilyUid}`)
    );
    const resolvedBeforeChange = StorageService.resolveUserMembership(
      {
        id: emilyLoginCred.user.uid,
        name: emilyLoginCred.user.displayName || "Emily",
        email: emilyLoginCred.user.email || "",
        emailVerified: emilyLoginCred.user.emailVerified,
        role: "Colaborador"
      },
      emilyOwnMemberRead.data() as any
    );
    assert(
      emilyOwnMemberRead.exists() &&
        resolvedBeforeChange.mustChangePassword === true &&
        resolvedBeforeChange.pendingReason === "MUST_CHANGE_PASSWORD",
      "Antes da troca, resolveUserMembership bloqueia Emily na barreira MUST_CHANGE_PASSWORD"
    );

    // Negação REAL nas regras do Firestore Emulator ANTES da troca de senha!
    const preChangeTaskEmilyRead = await expectPermissionDenied(() =>
      getDoc(doc(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks/TASK-A-EMILY-1`))
    );
    assert(
      preChangeTaskEmilyRead.denied,
      "Firestore Rules NEGAM leitura da própria demanda atribuída enquanto mustChangePassword === true",
      preChangeTaskEmilyRead
    );

    const preChangeTaskOutroRead = await expectPermissionDenied(() =>
      getDoc(doc(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks/TASK-A-OUTRO-2`))
    );
    assert(
      preChangeTaskOutroRead.denied,
      "Firestore Rules NEGAM leitura da demanda de outro dev antes da troca de senha",
      preChangeTaskOutroRead
    );

    const preChangeDevsRead = await expectPermissionDenied(() =>
      getDoc(doc(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/devs/dev-emily-qa`))
    );
    assert(
      preChangeDevsRead.denied,
      "Firestore Rules NEGAM leitura do catálogo de devs antes da troca de senha",
      preChangeDevsRead
    );

    // Tentar chamar /api/auth/complete-first-password-change SEM ter trocado a senha no Auth Emulator
    const emilyPreChangeToken = await emilyLoginCred.user.getIdToken(true);
    const bypassChangeRes = await makeRequest(
      server,
      "/api/auth/complete-first-password-change",
      "POST",
      { Authorization: `Bearer ${emilyPreChangeToken}` }
    );
    assert(
      bypassChangeRes.status === 403 && bypassChangeRes.data?.code === "PASSWORD_CHANGE_NOT_VERIFIED",
      "Servidor bloqueia tentativa de liberar dados sem troca real no Auth Emulator (403 PASSWORD_CHANGE_NOT_VERIFIED)",
      bypassChangeRes.data
    );

    // 1.4 Troca REAL de senha no Firebase Auth Emulator
    // Wait > 1.1s so tokensValidAfterTime (second granularity) strictly advances past creationTime/baseline
    await new Promise((r) => setTimeout(r, 1150));
    await updatePassword(emilyClient.clientAuth.currentUser!, EMILY_NEW_PASS);
    const emilyRefreshedCred = await signInWithEmailAndPassword(
      emilyClient.clientAuth,
      EMILY_EXTERNAL_EMAIL,
      EMILY_NEW_PASS
    );
    const emilyPostChangeToken = await emilyRefreshedCred.user.getIdToken(true);

    const completeChangeRes = await makeRequest(
      server,
      "/api/auth/complete-first-password-change",
      "POST",
      { Authorization: `Bearer ${emilyPostChangeToken}` }
    );
    assert(
      completeChangeRes.status === 200 &&
        completeChangeRes.data?.success === true &&
        completeChangeRes.data?.member?.mustChangePassword === false,
      "Após updatePassword real no Auth Emulator, /api/auth/complete-first-password-change libera acesso (200)",
      completeChangeRes.data
    );

    // Re-login com nova senha (e verificar que a temporária não funciona mais)
    await signOut(emilyClient.clientAuth);
    let oldPassRejected = false;
    try {
      await signInWithEmailAndPassword(emilyClient.clientAuth, EMILY_EXTERNAL_EMAIL, EMILY_TEMP_PASS);
    } catch {
      oldPassRejected = true;
    }
    assert(oldPassRejected, "Auth Emulator rejeita a senha temporária antiga após a troca");

    const emilyReloginCred = await signInWithEmailAndPassword(
      emilyClient.clientAuth,
      EMILY_EXTERNAL_EMAIL,
      EMILY_NEW_PASS
    );
    assert(
      emilyReloginCred.user.uid === emilyUid && emilyReloginCred.user.emailVerified === false,
      "Emily faz login com a nova senha pessoal (e emailVerified continua false sem prova de verificação)"
    );

    // 1.5 Pós-troca: leitura permitida SOMENTE da demanda atribuída; negação de demanda de outro dev e acesso amplo
    const postChangeOwnTask = await getDoc(
      doc(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks/TASK-A-EMILY-1`)
    );
    assert(
      postChangeOwnTask.exists() && postChangeOwnTask.data()?.id === "TASK-A-EMILY-1",
      "Após troca de senha, Emily lê sua demanda atribuída (TASK-A-EMILY-1) no Firestore Emulator"
    );

    const postChangeScopedQuery = await getDocs(
      query(
        collection(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks`),
        where("allowedUids", "array-contains", emilyUid)
      )
    );
    assert(
      postChangeScopedQuery.size === 1 && postChangeScopedQuery.docs[0].id === "TASK-A-EMILY-1",
      "Query scoped por allowedUids retorna apenas TASK-A-EMILY-1",
      { count: postChangeScopedQuery.size, ids: postChangeScopedQuery.docs.map((d) => d.id) }
    );

    const postChangeOutroTaskDenied = await expectPermissionDenied(() =>
      getDoc(doc(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks/TASK-A-OUTRO-2`))
    );
    assert(
      postChangeOutroTaskDenied.denied,
      "Firestore Rules NEGAM leitura de demanda de outro dev (TASK-A-OUTRO-2) mesmo após troca de senha",
      postChangeOutroTaskDenied
    );

    const postChangeUnscopedListDenied = await expectPermissionDenied(() =>
      getDocs(collection(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks`))
    );
    assert(
      postChangeUnscopedListDenied.denied,
      "Firestore Rules NEGAM listagem global sem filtro ACL de users/{owner}/tasks",
      postChangeUnscopedListDenied
    );

    const postChangeTamperAclDenied = await expectPermissionDenied(() =>
      updateDoc(doc(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks/TASK-A-EMILY-1`), {
        allowedUids: [emilyUid, "uid-invasor"]
      })
    );
    assert(
      postChangeTamperAclDenied.denied,
      "Firestore Rules NEGAM adulteração de allowedUids pelo colaborador",
      postChangeTamperAclDenied
    );

    const spoofAccessRequestDenied = await expectPermissionDenied(() =>
      setDoc(doc(emilyClient.clientDb, `users/${NEXUS_OWNER_UID}/accessRequests/${emilyUid}`), {
        id: emilyUid,
        uid: emilyUid,
        email: EMILY_EXTERNAL_EMAIL,
        status: "pending",
        requestedAt: new Date().toISOString()
      })
    );
    assert(
      spoofAccessRequestDenied.denied,
      "Firestore Rules NEGAM criação em accessRequests enquanto e-mail não está verificado (email_verified != true)",
      spoofAccessRequestDenied
    );

    // =========================================================================
    // CENÁRIO 2: EMPRESA B ISOLADA (ADM B + DEV B vs EMPRESA A)
    // =========================================================================
    console.log("\n👉 Cenário 2: Empresa B Isolada (ADM B + Dev B vs Empresa A & Limite de Owner Fixo)");

    const ADM_B_UID = "uid-adm-empresa-b-qa";
    await adminAuth.createUser({
      uid: ADM_B_UID,
      email: "adm.b.qa@empresa-b.example",
      password: "AdmBSecretQa#2026!",
      displayName: "ADM Empresa B (QA)",
      emailVerified: true
    });

    const DEV_B_UID = "uid-dev-empresa-b-qa";
    await adminAuth.createUser({
      uid: DEV_B_UID,
      email: "dev.b.qa@empresa-b.example",
      password: "DevBSecretQa#2026!",
      displayName: "Dev Empresa B (QA)",
      emailVerified: false
    });

    const admBClient = createIsolatedClientSdk("client-adm-b", authHost, fsHost);
    const devBClient = createIsolatedClientSdk("client-dev-b", authHost, fsHost);
    clientAppsToCleanup.push(admBClient.clientApp, devBClient.clientApp);

    const admBCred = await signInWithEmailAndPassword(
      admBClient.clientAuth,
      "adm.b.qa@empresa-b.example",
      "AdmBSecretQa#2026!"
    );
    const admBToken = await admBCred.user.getIdToken();

    await signInWithEmailAndPassword(
      devBClient.clientAuth,
      "dev.b.qa@empresa-b.example",
      "DevBSecretQa#2026!"
    );

    // 2.1 ADM B tenta provisionar via API do backend -> bloqueado contra A e não suportado para B por owner fixo!
    const admBTriesProvisionA = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: `Bearer ${admBToken}` },
      {
        mode: "create-with-temp-password",
        email: "intruso@empresa-b.example",
        name: "Intruso B",
        tempPassword: "TmpPass#Intruso99"
      }
    );
    assert(
      admBTriesProvisionA.status === 403 && admBTriesProvisionA.data?.code === "FORBIDDEN_NOT_ADMIN",
      "ADM B NÃO consegue provisionar usuários na Empresa A via /api/admin/provision-dev (403 FORBIDDEN_NOT_ADMIN)",
      admBTriesProvisionA.data
    );

    const admBTriesLinkEmily = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: `Bearer ${admBToken}` },
      {
        mode: "link-existing",
        email: EMILY_EXTERNAL_EMAIL,
        name: "Tentativa Sequestro Emily",
        existingUid: emilyUid,
        assignedTaskIds: ["TASK-A-EMILY-1"]
      }
    );
    assert(
      admBTriesLinkEmily.status === 403 && admBTriesLinkEmily.data?.code === "FORBIDDEN_NOT_ADMIN",
      "ADM B NÃO consegue vincular dev da Empresa A via /api/admin/provision-dev (403 FORBIDDEN_NOT_ADMIN)",
      admBTriesLinkEmily.data
    );

    const admBTriesProvisionOwnWorkspaceB = await makeRequest(
      server,
      "/api/admin/provision-dev",
      "POST",
      { Authorization: `Bearer ${admBToken}` },
      {
        mode: "create-with-temp-password",
        email: "novo.dev.b@empresa-b.example",
        name: "Novo Dev B",
        tempPassword: "TmpPass#DevB99",
        workspaceOwnerUid: ADM_B_UID
      }
    );
    assert(
      admBTriesProvisionOwnWorkspaceB.status === 403 && admBTriesProvisionOwnWorkspaceB.data?.code === "FORBIDDEN_NOT_ADMIN",
      "Backend recusa ADM B mesmo informando workspaceOwnerUid próprio (single-tenant hardcoded em NEXUS_OWNER_UID)",
      admBTriesProvisionOwnWorkspaceB.data
    );
    recordUnsupported(
      "Multi-workspace via API /api/admin/provision-dev e App UI (Empresa B independente)",
      `Arquitetura atual fixa o owner único NEXUS_OWNER_UID='${NEXUS_OWNER_UID}' em AdminProvisioningService, StorageService, FirebaseService e App.tsx; ADM B não pode provisionar um segundo workspace isolado via API.`
    );

    // 2.2 ADM B operando diretamente no seu próprio caminho users/{ADM_B_UID} no Firestore Emulator
    await setDoc(doc(admBClient.clientDb, `users/${ADM_B_UID}/members/${DEV_B_UID}`), {
      id: DEV_B_UID,
      uid: DEV_B_UID,
      email: "dev.b.qa@empresa-b.example",
      name: "Dev Empresa B (QA)",
      role: "Colaborador",
      status: "active",
      mustChangePassword: false
    });
    await setDoc(doc(admBClient.clientDb, `users/${ADM_B_UID}/tasks/TASK-B-1`), {
      id: "TASK-B-1",
      summary: "Demanda Exclusiva Empresa B",
      allowedUids: [DEV_B_UID],
      assignedUid: DEV_B_UID
    });

    const devBOwnTaskSnap = await getDoc(
      doc(devBClient.clientDb, `users/${ADM_B_UID}/tasks/TASK-B-1`)
    );
    assert(
      devBOwnTaskSnap.exists() && devBOwnTaskSnap.data()?.id === "TASK-B-1",
      "No nível de regras do Firestore, ADM B cadastra sob users/{ADM_B_UID} e Dev B lê TASK-B-1 da Empresa B"
    );

    // 2.3 Garantir que ADM B e Dev B são NEGADOS em TODOS os dados da Empresa A
    const admBReadsTaskA = await expectPermissionDenied(() =>
      getDoc(doc(admBClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks/TASK-A-EMILY-1`))
    );
    const admBReadsMembersA = await expectPermissionDenied(() =>
      getDocs(collection(admBClient.clientDb, `users/${NEXUS_OWNER_UID}/members`))
    );
    const admBWritesDevA = await expectPermissionDenied(() =>
      setDoc(doc(admBClient.clientDb, `users/${NEXUS_OWNER_UID}/devs/dev-invasor-b`), { id: "dev-invasor-b", name: "Invasor" })
    );
    const devBReadsTaskA1 = await expectPermissionDenied(() =>
      getDoc(doc(devBClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks/TASK-A-EMILY-1`))
    );
    const devBReadsTaskA2 = await expectPermissionDenied(() =>
      getDoc(doc(devBClient.clientDb, `users/${NEXUS_OWNER_UID}/tasks/TASK-A-OUTRO-2`))
    );

    assert(admBReadsTaskA.denied, "Firestore Rules NEGAM leitura de demanda da Empresa A por ADM B", admBReadsTaskA);
    assert(admBReadsMembersA.denied, "Firestore Rules NEGAM leitura de membros da Empresa A por ADM B", admBReadsMembersA);
    assert(admBWritesDevA.denied, "Firestore Rules NEGAM escrita no catálogo devs da Empresa A por ADM B", admBWritesDevA);
    assert(devBReadsTaskA1.denied, "Firestore Rules NEGAM leitura da demanda da Emily (Empresa A) por Dev B", devBReadsTaskA1);
    assert(devBReadsTaskA2.denied, "Firestore Rules NEGAM leitura de outra demanda da Empresa A por Dev B", devBReadsTaskA2);

    console.log("\n================================================================================");
    console.log(`🏁 RESULTADO QA EMULADOR: ${passedTests} de ${totalTests} asserções passaram.`);
    if (unsupportedLimitations.length > 0) {
      console.log("📌 Limitações Arquiteturais Registradas:");
      unsupportedLimitations.forEach((u) => console.log(`   - ${u}`));
    }
    console.log("================================================================================");

    if (passedTests !== totalTests) {
      process.exitCode = 1;
    }
  } finally {
    await Promise.all(clientAppsToCleanup.map((a) => deleteApp(a).catch(() => {})));
    server.close();
  }
}

runEmulatorQA().catch((err) => {
  console.error("❌ Erro fatal no QA com Emulador:", err);
  process.exit(1);
});
