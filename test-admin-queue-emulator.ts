import { initializeApp, deleteApp, FirebaseApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  signInWithEmailAndPassword,
  signOut
} from "firebase/auth";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  setDoc,
  collection
} from "firebase/firestore";
import {
  getApps as getAdminApps,
  initializeApp as initAdminApp,
  deleteApp as deleteAdminApp
} from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

import firebaseConfig from "./firebase-applet-config.json";
import { auth, db, FirebaseService } from "./services/firebase";
import { NEXUS_OWNER_UID, AccessRequest, DEFAULT_ADM_PERMISSIONS } from "./types";

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

async function clearEmulators(
  projectId: string,
  databaseId: string,
  authHost: string,
  fsHost: string
) {
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

async function expectPermissionDenied(
  fn: () => Promise<any>
): Promise<{ denied: boolean; code?: string; message?: string }> {
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

async function runAdminQueueEmulatorQA() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;

  if (!authHost || !fsHost) {
    console.error("❌ ERRO: Este teste deve rodar exclusivamente via Auth + Firestore Emulator.");
    process.exit(1);
  }

  const [fsHostName, fsPortStr] = fsHost.split(":");
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  connectFirestoreEmulator(db, fsHostName, Number(fsPortStr));

  const projectId = firebaseConfig.projectId;
  const databaseId = (firebaseConfig as any).firestoreDatabaseId || "(default)";
  await clearEmulators(projectId, databaseId, authHost, fsHost);

  const harnessApp =
    getAdminApps().find((a) => a.name === "qa-queue-harness") ||
    initAdminApp({ projectId }, "qa-queue-harness");
  const harnessAuth = getAdminAuth(harnessApp);
  const harnessDb =
    databaseId && databaseId !== "(default)"
      ? getAdminFirestore(harnessApp, databaseId)
      : getAdminFirestore(harnessApp);

  const ownerEmail = "owner-queue-qa@nexus-qa.local";
  const ownerPass = "OwnerQueue!2026";
  const delegatedAdmEmail = "adm-delegado-qa@nexus-qa.local";
  const delegatedAdmPass = "AdmDelegado!2026";
  const preDevEmail = "dev-previo@empresa-qa.local";
  const preDevPass = "DevPrevio!2026";
  const realtimeDevEmail = "dev-realtime@empresa-qa.local";
  const realtimeDevPass = "DevRealtime!2026";

  console.log("\n=== QA FILA DE APROVAÇÃO DO ADM (ABA NOVA, PRÉ-SOLICITAÇÃO, SERVIDOR, TEMPO REAL & ERROS) ===");

  try {
    // Seed owner, delegated ADM, and two verified devs
    await harnessAuth.createUser({
      uid: NEXUS_OWNER_UID,
      email: ownerEmail,
      password: ownerPass,
      emailVerified: true,
      displayName: "Owner QA"
    });

    const delegatedAdmRec = await harnessAuth.createUser({
      email: delegatedAdmEmail,
      password: delegatedAdmPass,
      emailVerified: true,
      displayName: "ADM Delegado QA"
    });

    await harnessDb.doc(`users/${NEXUS_OWNER_UID}/members/${delegatedAdmRec.uid}`).set({
      id: delegatedAdmRec.uid,
      uid: delegatedAdmRec.uid,
      email: delegatedAdmEmail,
      name: "ADM Delegado QA",
      role: "ADM",
      status: "active",
      mustChangePassword: false,
      permissions: DEFAULT_ADM_PERMISSIONS,
      assignedTaskIds: [],
      workspaceOwnerUid: NEXUS_OWNER_UID
    });

    const preDevRec = await harnessAuth.createUser({
      email: preDevEmail,
      password: preDevPass,
      emailVerified: true,
      displayName: "Dev Pré-Existente QA"
    });

    const realtimeDevRec = await harnessAuth.createUser({
      email: realtimeDevEmail,
      password: realtimeDevPass,
      emailVerified: true,
      displayName: "Dev Tempo Real QA"
    });

    // -----------------------------------------------------------------------
    // ETAPA 1: Solicitação criada ANTES de o painel ADM abrir
    // -----------------------------------------------------------------------
    console.log("\n[ETAPA 1] Solicitação pendente criada ANTES de o painel ADM montar");
    const preDevSession = createIsolatedClientSdk("pre-dev-client", authHost, fsHost);
    try {
      await signInWithEmailAndPassword(preDevSession.clientAuth, preDevEmail, preDevPass);
      const reqPayload: AccessRequest = {
        id: preDevRec.uid,
        uid: preDevRec.uid,
        email: preDevEmail,
        name: "Dev Pré-Existente QA",
        department: `Solicitação autenticada (UID: ${preDevRec.uid})`,
        devNameHint: "Dev Pré-Existente QA",
        status: "pending",
        requestedAt: new Date(Date.now() - 60000).toISOString()
      };
      await setDoc(doc(preDevSession.clientDb, "users", NEXUS_OWNER_UID, "accessRequests", preDevRec.uid), reqPayload);

      // Verified collaborator can GET own request, but CANNOT LIST entire collection
      const ownSnap = await getDoc(doc(preDevSession.clientDb, "users", NEXUS_OWNER_UID, "accessRequests", preDevRec.uid));
      assert(
        ownSnap.exists() && ownSnap.data()?.status === "pending",
        "Conta verificada lê sua própria solicitação pending em users/{NEXUS_OWNER_UID}/accessRequests/{uid}"
      );

      const nonAdmList = await expectPermissionDenied(() =>
        getDocs(collection(preDevSession.clientDb, "users", NEXUS_OWNER_UID, "accessRequests"))
      );
      assert(nonAdmList.denied, "Conta verificada sem ADM é bloqueada ao tentar listar accessRequests (regras preservadas)", nonAdmList);
    } finally {
      await signOut(preDevSession.clientAuth).catch(() => {});
      await deleteApp(preDevSession.clientApp).catch(() => {});
    }

    // -----------------------------------------------------------------------
    // ETAPA 2: Simulação de aba nova antes do Firebase Auth hidratar (auth.currentUser === null)
    // -----------------------------------------------------------------------
    console.log("\n[ETAPA 2] Sessão Firebase ainda não autenticada NÃO retorna fila vazia silenciosa");
    await signOut(auth);
    assert(auth.currentUser === null, "auth.currentUser está nulo antes de autenticar a aba");

    let unauthServerErrCode = "";
    try {
      await FirebaseService.fetchAccessRequestsFromServer(NEXUS_OWNER_UID);
    } catch (err: any) {
      unauthServerErrCode = err?.code || err?.message || "";
    }
    assert(
      unauthServerErrCode === "auth/unauthenticated",
      "fetchAccessRequestsFromServer falha explicitamente com auth/unauthenticated (sem retornar [])",
      unauthServerErrCode
    );

    let unauthSubCalledCallback = false;
    let unauthSubErrorCode = "";
    const unsubPreAuth = FirebaseService.subscribeAccessRequests(
      NEXUS_OWNER_UID,
      () => {
        unauthSubCalledCallback = true;
      },
      (err) => {
        unauthSubErrorCode = err?.code || err?.message || "";
      }
    );
    unsubPreAuth();
    assert(
      !unauthSubCalledCallback && unauthSubErrorCode === "auth/unauthenticated",
      "subscribeAccessRequests dispara onError (auth/unauthenticated) em vez de emitir 0 silencioso",
      { unauthSubCalledCallback, unauthSubErrorCode }
    );

    // -----------------------------------------------------------------------
    // ETAPA 3: Owner autentica -> leitura inicial do servidor + assinatura em tempo real
    // -----------------------------------------------------------------------
    console.log("\n[ETAPA 3] Leitura inicial do servidor após auth e atualização em tempo real");
    const observedSessions: Array<{ ready: boolean; uid: string | null }> = [];
    const unsubSession = FirebaseService.subscribeAuthSession((s) => {
      observedSessions.push({ ready: s.ready, uid: s.uid });
    });

    await signInWithEmailAndPassword(auth, ownerEmail, ownerPass);
    const readySession = await FirebaseService.waitForAuthSession();
    assert(
      readySession.uid === NEXUS_OWNER_UID && observedSessions.some((s) => s.ready && s.uid === NEXUS_OWNER_UID),
      "subscribeAuthSession e waitForAuthSession resolvem UID autenticado do Owner"
    );
    unsubSession();

    const serverInitial = await FirebaseService.fetchAccessRequestsFromServer(NEXUS_OWNER_UID);
    assert(
      serverInitial.source === "server" &&
        serverInitial.requests.length === 1 &&
        serverInitial.requests[0].uid === preDevRec.uid &&
        serverInitial.requests[0].status === "pending",
      "fetchAccessRequestsFromServer traz imediatamente do servidor a solicitação pré-existente (1)",
      serverInitial
    );

    // Attach real-time listener with metadata tracking AND submit a 2nd request while open
    const seenPayloads: Array<{ count: number; fromCache: boolean; uids: string[] }> = [];
    const realtimeArrivalPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout aguardando chegada em tempo real na fila ADM")), 5000);
      const unsub = FirebaseService.subscribeAccessRequests(
        NEXUS_OWNER_UID,
        (list, meta) => {
          seenPayloads.push({
            count: list.length,
            fromCache: Boolean(meta?.fromCache),
            uids: list.map((r) => r.uid)
          });
          if (
            !meta?.fromCache &&
            list.some((r) => r.uid === preDevRec.uid) &&
            list.some((r) => r.uid === realtimeDevRec.uid)
          ) {
            clearTimeout(timer);
            unsub();
            resolve();
          }
        },
        (err) => {
          clearTimeout(timer);
          unsub();
          reject(err);
        }
      );
    });

    // Submit 2nd request from another verified dev session after listener is attached
    const rtDevSession = createIsolatedClientSdk("rt-dev-client", authHost, fsHost);
    try {
      await signInWithEmailAndPassword(rtDevSession.clientAuth, realtimeDevEmail, realtimeDevPass);
      await setDoc(doc(rtDevSession.clientDb, "users", NEXUS_OWNER_UID, "accessRequests", realtimeDevRec.uid), {
        id: realtimeDevRec.uid,
        uid: realtimeDevRec.uid,
        email: realtimeDevEmail,
        name: "Dev Tempo Real QA",
        department: `Solicitação autenticada (UID: ${realtimeDevRec.uid})`,
        devNameHint: "Dev Tempo Real QA",
        status: "pending",
        requestedAt: new Date().toISOString()
      });
      await realtimeArrivalPromise;
      assert(
        seenPayloads.some((p) => !p.fromCache && p.count === 2 && p.uids.includes(preDevRec.uid) && p.uids.includes(realtimeDevRec.uid)),
        "subscribeAccessRequests preserva tempo real com metadados (fromCache=false) ao receber 2ª solicitação",
        seenPayloads
      );
    } finally {
      await signOut(rtDevSession.clientAuth).catch(() => {});
      await deleteApp(rtDevSession.clientApp).catch(() => {});
    }

    // -----------------------------------------------------------------------
    // ETAPA 4: ADM Delegado ativo lê fila; usuário com mustChangePassword=true bloqueado
    // -----------------------------------------------------------------------
    console.log("\n[ETAPA 4] Privilégios de ADM delegado e retry manual");
    await signOut(auth);
    await signInWithEmailAndPassword(auth, delegatedAdmEmail, delegatedAdmPass);
    const admServerRes = await FirebaseService.fetchAccessRequestsFromServer(NEXUS_OWNER_UID);
    assert(
      admServerRes.requests.length === 2,
      "ADM delegado ativo lê todas as solicitações pendentes diretamente do servidor",
      admServerRes.requests.length
    );

    // Simulate ADM flagged with mustChangePassword=true -> MUST be denied by Firestore rules
    await harnessDb.doc(`users/${NEXUS_OWNER_UID}/members/${delegatedAdmRec.uid}`).update({
      mustChangePassword: true
    });
    const blockedAdmRes = await expectPermissionDenied(() =>
      FirebaseService.fetchAccessRequestsFromServer(NEXUS_OWNER_UID)
    );
    assert(
      blockedAdmRes.denied,
      "ADM com mustChangePassword=true é bloqueado pelas regras ao tentar ler accessRequests",
      blockedAdmRes
    );

    // Simulate manual retry after condition resolves
    await harnessDb.doc(`users/${NEXUS_OWNER_UID}/members/${delegatedAdmRec.uid}`).update({
      mustChangePassword: false
    });
    const retryRes = await FirebaseService.fetchAccessRequestsFromServer(NEXUS_OWNER_UID);
    assert(
      retryRes.source === "server" && retryRes.requests.length === 2,
      "Tentativa manual (fetchAccessRequestsFromServer) recupera fila após restauração de sessão/permissão"
    );
  } finally {
    await signOut(auth).catch(() => {});
    await deleteAdminApp(harnessApp).catch(() => {});
  }

  console.log(`\n==================================================`);
  console.log(`RESULTADO QA FILA DO ADM: ${passedTests}/${totalTests} verificações aprovadas.`);
  console.log(`==================================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runAdminQueueEmulatorQA().catch((err) => {
  console.error("Erro fatal na execução do QA Fila do ADM:", err);
  process.exit(1);
});
