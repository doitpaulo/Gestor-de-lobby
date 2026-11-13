import { initializeApp, deleteApp, FirebaseApp } from "firebase/app";
import {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
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
import { getApps as getAdminApps, initializeApp as initAdminApp, deleteApp as deleteAdminApp } from "firebase-admin/app";
import { getAuth as getAdminAuth } from "firebase-admin/auth";
import { getFirestore as getAdminFirestore } from "firebase-admin/firestore";

import firebaseConfig from "./firebase-applet-config.json";
import { auth, db, FirebaseService } from "./services/firebase";
import { StorageService, isTaskAuthorized } from "./services/storageService";
import { NEXUS_OWNER_UID, AccessRequest, Task } from "./types";

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

async function runNoAdminEmulatorQA() {
  const authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const fsHost = process.env.FIRESTORE_EMULATOR_HOST;

  if (!authHost || !fsHost) {
    console.error("❌ ERRO: Este teste deve rodar exclusivamente via Auth + Firestore Emulator.");
    process.exit(1);
  }

  // Connect the real app Client SDK instance (services/firebase.ts) to the emulators
  const [fsHostName, fsPortStr] = fsHost.split(":");
  connectAuthEmulator(auth, `http://${authHost}`, { disableWarnings: true });
  connectFirestoreEmulator(db, fsHostName, Number(fsPortStr));

  const projectId = firebaseConfig.projectId;
  const databaseId = (firebaseConfig as any).firestoreDatabaseId || "(default)";

  await clearEmulators(projectId, databaseId, authHost, fsHost);

  // Test-only harness Admin SDK (used ONLY to seed owner/tasks and inspect Auth Emulator OOB codes,
  // NEVER passed to Workspace approval code!)
  const harnessApp =
    getAdminApps().find((a) => a.name === "qa-harness") ||
    initAdminApp({ projectId }, "qa-harness");
  const harnessAuth = getAdminAuth(harnessApp);
  const harnessDb =
    databaseId && databaseId !== "(default)"
      ? getAdminFirestore(harnessApp, databaseId)
      : getAdminFirestore(harnessApp);

  const ownerEmail = "owner-qa@nexus-qa.local";
  const ownerPass = "OwnerQaPass!123";
  const devEmail = "dev.noadmin@empresa-qa.local";
  const devPass = "DevSenha!2026";
  const devName = "Camila Onboarding QA";

  console.log("\n=== QA FLUXO SEM ADMIN SDK (CADASTRO -> VERIFICAÇÃO -> FILA -> APROVAÇÃO OWNER -> ISOLAMENTO & RETRY) ===");

  try {
    // 1. Seed workspace owner + tasks + dev catalog in disposable emulator
    await harnessAuth.createUser({
      uid: NEXUS_OWNER_UID,
      email: ownerEmail,
      password: ownerPass,
      emailVerified: true,
      displayName: "Owner QA"
    });

    await harnessDb.doc(`users/${NEXUS_OWNER_UID}/devs/dev_camila`).set({
      id: "dev_camila",
      name: devName,
      email: devEmail
    });

    await harnessDb.doc(`users/${NEXUS_OWNER_UID}/tasks/TASK-NOADMIN-1`).set({
      id: "TASK-NOADMIN-1",
      summary: "Demanda autorizada para Camila",
      type: "Nova Automação",
      priority: "Alta",
      status: "Em Andamento",
      assignee: devName,
      createdAt: "2026-06-01T10:00:00.000Z"
    });

    await harnessDb.doc(`users/${NEXUS_OWNER_UID}/tasks/TASK-NOADMIN-2`).set({
      id: "TASK-NOADMIN-2",
      summary: "Demanda restrita de outro desenvolvedor",
      type: "Melhoria",
      priority: "Média",
      status: "Novo",
      assignee: "Outro Dev QA",
      createdAt: "2026-06-01T10:00:00.000Z"
    });

    // -----------------------------------------------------------------------
    // FASE 1: Cadastro sem verificação prévia -> emailVerified === false
    // -----------------------------------------------------------------------
    console.log("\n[FASE 1] Cadastro self-service não verificado");
    const registered = await FirebaseService.registerWithEmail(devEmail, devPass, devName);
    const devUid = registered.id;
    assert(Boolean(devUid), "Cadastro criou usuário no Auth Emulator via FirebaseService.registerWithEmail", devUid);
    assert(registered.emailVerified === false, "Logo após cadastro, emailVerified é false");

    const pendingBeforeVerify = StorageService.resolveUserMembership(registered, null);
    assert(
      pendingBeforeVerify.status === "pending" && pendingBeforeVerify.pendingReason === "EMAIL_UNVERIFIED",
      "Usuário recém-criado fica em status pending com pendingReason EMAIL_UNVERIFIED"
    );

    // Send verification email -> inspect Auth Emulator OOB code queue
    await FirebaseService.sendVerificationEmail();
    const oobRes = await fetch(`http://${authHost}/emulator/v1/projects/${projectId}/oobCodes`);
    const oobData = (await oobRes.json()) as { oobCodes?: Array<{ email: string; oobCode: string; requestType: string; oobLink: string }> };
    const verifyCodeObj = (oobData.oobCodes || []).find(
      (item) => item.email?.toLowerCase() === devEmail && item.requestType === "VERIFY_EMAIL"
    );
    assert(Boolean(verifyCodeObj?.oobCode), "Reenvio/envio gerou código VERIFY_EMAIL real no Auth Emulator");

    // Attempt to saveAccessRequest BEFORE verification (client guard + Firestore rules)
    let clientGuardBlocked = false;
    try {
      await FirebaseService.saveAccessRequest(NEXUS_OWNER_UID, {
        id: devUid,
        uid: devUid,
        email: devEmail,
        name: devName,
        requestedAt: new Date().toISOString(),
        status: "pending"
      });
    } catch (e: any) {
      clientGuardBlocked = String(e?.message || "").includes("Verifique seu e-mail");
    }
    assert(clientGuardBlocked, "saveAccessRequest bloqueia envio enquanto emailVerified === false");

    const rawUnverifiedWrite = await expectPermissionDenied(() =>
      setDoc(doc(db, "users", NEXUS_OWNER_UID, "accessRequests", devUid), {
        id: devUid,
        uid: devUid,
        email: devEmail,
        name: devName,
        requestedAt: new Date().toISOString(),
        status: "pending"
      })
    );
    assert(rawUnverifiedWrite.denied, "Firestore Rules nega create em accessRequests quando email_verified != true", rawUnverifiedWrite);

    // -----------------------------------------------------------------------
    // FASE 2: Confirmação de e-mail, reload de token, retry após falha & idempotência
    // -----------------------------------------------------------------------
    console.log("\n[FASE 2] Confirmação do link de verificação, reload de usuário/token, retry e idempotência");

    // Apply the real Auth Emulator VERIFY_EMAIL oobCode (simulating user clicking the link in another tab)
    const applyOobRes = await fetch(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseConfig.apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oobCode: verifyCodeObj!.oobCode })
      }
    );
    const applyOobJson = (await applyOobRes.json()) as any;
    assert(applyOobRes.ok && applyOobJson?.emailVerified === true, "Auth Emulator confirmou oobCode e marcou emailVerified=true no servidor", applyOobJson);

    // Client session still holds stale emailVerified === false until reloadCurrentUser()
    assert(auth.currentUser?.emailVerified === false, "Antes do reload, cliente ainda reflete estado antigo em memória");

    const reloaded = await FirebaseService.reloadCurrentUser();
    assert(Boolean(reloaded?.emailVerified), "reloadCurrentUser() atualiza emailVerified === true e força refresh do ID Token");

    const pendingAfterVerify = StorageService.resolveUserMembership(reloaded!, null);
    assert(
      pendingAfterVerify.status === "pending" && pendingAfterVerify.pendingReason === "UNAUTHORIZED",
      "Após verificar e-mail, pendingReason transiciona para UNAUTHORIZED (pronto para fila)"
    );

    // Simulate a failed attempt before recovery/retry (e.g. spoofing/transient failure followed by clean retry)
    const spoofAttempt = await expectPermissionDenied(() =>
      setDoc(doc(db, "users", NEXUS_OWNER_UID, "accessRequests", "uid_falso_terceiro"), {
        id: "uid_falso_terceiro",
        uid: "uid_falso_terceiro",
        email: devEmail,
        requestedAt: new Date().toISOString(),
        status: "pending"
      })
    );
    assert(spoofAttempt.denied, "Firestore Rules nega accessRequest com UID divergente do token", spoofAttempt);

    // Simulate transient error during first enqueue + clean retry (matches PendingAccessScreen auto-submit -> error -> Retry)
    let simulatedFailureCount = 0;
    const enqueueWithTransientFailure = async (req: AccessRequest) => {
      if (simulatedFailureCount === 0) {
        simulatedFailureCount++;
        throw new Error("Falha transitória simulada na rede antes do retry.");
      }
      return await FirebaseService.saveAccessRequest(NEXUS_OWNER_UID, req);
    };

    const reqPayload: AccessRequest = {
      id: devUid,
      uid: devUid,
      email: devEmail,
      name: devName,
      department: `Solicitação autenticada (UID: ${devUid})`,
      devNameHint: devName,
      requestedAt: new Date().toISOString(),
      status: "pending"
    };

    let sawVisibleFailure = false;
    try {
      await enqueueWithTransientFailure(reqPayload);
    } catch {
      sawVisibleFailure = true;
    }
    assert(sawVisibleFailure, "Falha transitória é propagada explicitamente sem sucesso falso");

    // Retry succeeds cleanly and writes to accessRequests/{uid}
    const retryRes = await enqueueWithTransientFailure(reqPayload);
    assert(retryRes.status === "created", "Retry persiste solicitação em accessRequests/{uid} (status: created)", retryRes);

    // Idempotent second call when returning to PendingAccessScreen must NOT fail on !exists() rule
    const idempotentRes = await FirebaseService.saveAccessRequest(NEXUS_OWNER_UID, reqPayload);
    assert(
      idempotentRes.status === "already-exists" && idempotentRes.request.status === "pending",
      "Envio automático idempotente detecta solicitação existente sem duplicar nem violar !exists()",
      idempotentRes
    );

    // Dev CANNOT self-approve in members/
    const selfApproveDenied = await expectPermissionDenied(() =>
      setDoc(doc(db, "users", NEXUS_OWNER_UID, "members", devUid), {
        id: devUid,
        uid: devUid,
        email: devEmail,
        name: devName,
        role: "ADM",
        status: "active",
        workspaceOwnerUid: NEXUS_OWNER_UID
      })
    );
    assert(selfApproveDenied.denied, "Dev não consegue se autoaprovar ou escalar para ADM em members/", selfApproveDenied);

    // -----------------------------------------------------------------------
    // FASE 3: Proprietário autentica no Client SDK (SEM Admin SDK) e aprova solicitação
    // -----------------------------------------------------------------------
    console.log("\n[FASE 3] Proprietário lê fila e aprova diretamente pelo Firestore autenticado (sem chave Admin SDK)");
    await signOut(auth);
    await signInWithEmailAndPassword(auth, ownerEmail, ownerPass);

    // Owner sees pending verified request via subscribeAccessRequests
    const observedRequests = await new Promise<AccessRequest[]>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timeout aguardando subscribeAccessRequests")), 4000);
      const unsub = FirebaseService.subscribeAccessRequests(
        NEXUS_OWNER_UID,
        (list) => {
          if (list.some((item) => item.uid === devUid && item.status === "pending")) {
            clearTimeout(timer);
            unsub();
            resolve(list);
          }
        },
        (err) => {
          clearTimeout(timer);
          unsub();
          reject(err);
        }
      );
    });
    assert(
      observedRequests.some((r) => r.uid === devUid && r.email === devEmail && r.status === "pending"),
      "ADM/Owner visualiza solicitação autenticada pendente em tempo real via subscribeAccessRequests"
    );

    // Owner approves directly via Firestore WITHOUT Admin SDK key, trying to pass privilege-escalation flags
    // that MUST be sanitized down to false for Colaborador!
    const approvalResult = await FirebaseService.approveMemberDirectlyViaFirestore({
      ownerUid: NEXUS_OWNER_UID,
      targetUid: devUid,
      email: devEmail,
      name: devName,
      role: "Colaborador",
      status: "active",
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
        },
        // Attempt privilege escalation in payload -> MUST be forced false
        canAssign: true,
        canReorganize: true,
        canDelete: true,
        canImport: true,
        canManageUsers: true,
        canManageIntegrations: true,
        canManageSprints: false
      },
      assignedTaskIds: ["TASK-NOADMIN-1", "TASK-FANTASMA-INEXISTENTE"],
      linkedDevId: "dev_camila",
      linkedDevName: devName,
      originatingAccessRequestUid: devUid,
      invitedBy: ownerEmail
    });

    assert(approvalResult.member.status === "active", "Aprovação direta grava membro ativo em members/{uid}");
    assert(approvalResult.member.role === "Colaborador", "Perfil permanece estritamente Colaborador");
    assert(
      approvalResult.member.mustChangePassword === false,
      "Conta autogerida não exige troca forçada de senha temporária"
    );
    assert(
      approvalResult.member.permissions.canDelete === false &&
        approvalResult.member.permissions.canManageUsers === false &&
        approvalResult.member.permissions.canAssign === false &&
        approvalResult.member.permissions.canManageIntegrations === false &&
        approvalResult.member.permissions.modules.list === true &&
        approvalResult.member.permissions.modules.kanban === true &&
        approvalResult.member.permissions.modules.dashboard === false,
      "Sanitização impede ampliação de permissões administrativas no Colaborador",
      approvalResult.member.permissions
    );
    assert(
      approvalResult.addedTasksCount === 1 &&
        approvalResult.missingTaskIds.includes("TASK-FANTASMA-INEXISTENTE"),
      "Sincronização vincula apenas demanda existente e ignora ID inexistente sem criar documento fantasma",
      approvalResult
    );
    assert(approvalResult.linkedDevUpdated === true, "Dev vinculado atualizado com linkedUid");
    assert(approvalResult.accessRequestResolved === true, "Solicitação accessRequests/{uid} marcada como resolved");

    const ghostSnap = await harnessDb.doc(`users/${NEXUS_OWNER_UID}/tasks/TASK-FANTASMA-INEXISTENTE`).get();
    assert(!ghostSnap.exists, "Documento fantasma não foi criado em tasks/");

    // -----------------------------------------------------------------------
    // FASE 4: Isolamento das demandas do dev aprovado (Client SDK isolado)
    // -----------------------------------------------------------------------
    console.log("\n[FASE 4] Leitura autorizada e isolamento de demandas do dev aprovado");
    const devSession = createIsolatedClientSdk("dev-noadmin-client", authHost, fsHost);
    try {
      await signInWithEmailAndPassword(devSession.clientAuth, devEmail, devPass);

      const myMemberSnap = await getDoc(doc(devSession.clientDb, "users", NEXUS_OWNER_UID, "members", devUid));
      assert(myMemberSnap.exists() && myMemberSnap.data()?.status === "active", "Dev lê seu próprio registro ativo em members/{uid}");

      // Scoped query matches subscribeAuthorizedTasks
      const scopedQ = query(
        collection(devSession.clientDb, "users", NEXUS_OWNER_UID, "tasks"),
        where("allowedUids", "array-contains", devUid)
      );
      const scopedSnap = await getDocs(scopedQ);
      const visibleIds = scopedSnap.docs.map((d) => d.id);
      assert(
        visibleIds.length === 1 && visibleIds[0] === "TASK-NOADMIN-1",
        "Query autenticada do dev retorna exclusivamente a demanda atribuída TASK-NOADMIN-1",
        visibleIds
      );

      // Direct read of another dev's demand is DENIED
      const otherReadDenied = await expectPermissionDenied(() =>
        getDoc(doc(devSession.clientDb, "users", NEXUS_OWNER_UID, "tasks", "TASK-NOADMIN-2"))
      );
      assert(otherReadDenied.denied, "Dev é bloqueado ao tentar ler demanda alheia TASK-NOADMIN-2", otherReadDenied);

      // Unscoped collection list is DENIED
      const unscopedListDenied = await expectPermissionDenied(() =>
        getDocs(collection(devSession.clientDb, "users", NEXUS_OWNER_UID, "tasks"))
      );
      assert(unscopedListDenied.denied, "Listagem irrestrita da coleção tasks é bloqueada pelas Rules", unscopedListDenied);

      // Dev cannot tamper with allowedUids on own task
      const aclTamperDenied = await expectPermissionDenied(() =>
        updateDoc(doc(devSession.clientDb, "users", NEXUS_OWNER_UID, "tasks", "TASK-NOADMIN-1"), {
          allowedUids: [devUid, "outro_uid_invasor"]
        })
      );
      assert(aclTamperDenied.denied, "Dev não consegue adulterar allowedUids da própria demanda", aclTamperDenied);

      // Dev CAN update operational fields on assigned task without touching ACLs
      let ownUpdateAllowed = false;
      try {
        await updateDoc(doc(devSession.clientDb, "users", NEXUS_OWNER_UID, "tasks", "TASK-NOADMIN-1"), {
          status: "Concluído"
        });
        ownUpdateAllowed = true;
      } catch {}
      assert(ownUpdateAllowed, "Dev consegue atualizar status da sua demanda autorizada sem alterar ACL");

      // StorageService client gate consistency
      const resolvedDevUser = StorageService.resolveUserMembership(
        { id: devUid, name: devName, email: devEmail, emailVerified: true },
        myMemberSnap.data() as any
      );
      assert(
        isTaskAuthorized({ id: "TASK-NOADMIN-1", allowedUids: [devUid] } as Task, resolvedDevUser) === true &&
          isTaskAuthorized({ id: "TASK-NOADMIN-2", allowedUids: ["outro"] } as Task, resolvedDevUser) === false,
        "Gate de UI isTaskAuthorized acompanha o isolamento estrito das demandas"
      );

      // Verify revoking TASK-NOADMIN-1 by Owner removes access immediately
      await FirebaseService.approveMemberDirectlyViaFirestore({
        ownerUid: NEXUS_OWNER_UID,
        targetUid: devUid,
        email: devEmail,
        name: devName,
        role: "Colaborador",
        status: "active",
        permissions: approvalResult.member.permissions,
        assignedTaskIds: [],
        invitedBy: ownerEmail
      });

      const revokedReadDenied = await expectPermissionDenied(() =>
        getDoc(doc(devSession.clientDb, "users", NEXUS_OWNER_UID, "tasks", "TASK-NOADMIN-1"))
      );
      assert(revokedReadDenied.denied, "Após remoção da demanda pelo Owner, dev perde imediatamente acesso a TASK-NOADMIN-1", revokedReadDenied);
    } finally {
      await signOut(devSession.clientAuth).catch(() => {});
      await deleteApp(devSession.clientApp).catch(() => {});
    }
  } finally {
    await signOut(auth).catch(() => {});
    await deleteAdminApp(harnessApp).catch(() => {});
  }

  console.log(`\n==================================================`);
  console.log(`RESULTADO QA SEM ADMIN SDK: ${passedTests}/${totalTests} verificações aprovadas.`);
  console.log(`==================================================\n`);

  if (passedTests !== totalTests) {
    process.exit(1);
  }
}

runNoAdminEmulatorQA().catch((err) => {
  console.error("Erro fatal na execução do QA sem Admin SDK:", err);
  process.exit(1);
});
