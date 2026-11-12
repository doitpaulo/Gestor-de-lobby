import fs from "fs";
import { initializeApp, getApps, cert, applicationDefault, App as AdminApp } from "firebase-admin/app";
import { getAuth, Auth as AdminAuth } from "firebase-admin/auth";
import { getFirestore, Firestore as AdminFirestore, FieldValue } from "firebase-admin/firestore";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };
import {
  NEXUS_OWNER_UID,
  UserPermissions,
  UserRole,
  UserStatus,
  WorkspaceMember,
  DEFAULT_ADM_PERMISSIONS,
  DEFAULT_COLLABORATOR_PERMISSIONS
} from "../types.js";

export interface AdminUserRecord {
  uid: string;
  email?: string;
  displayName?: string;
  emailVerified?: boolean;
  disabled?: boolean;
  tokensValidAfterTime?: string;
  metadata?: {
    creationTime?: string;
    lastSignInTime?: string;
  };
}

export interface DecodedAdminIdToken {
  uid: string;
  email?: string;
  email_verified?: boolean;
  auth_time?: number;
  exp?: number;
}

export interface AdminBackendAdapter {
  verifyIdToken: (idToken: string) => Promise<DecodedAdminIdToken>;
  getUser: (uid: string) => Promise<AdminUserRecord>;
  getUserByEmail: (email: string) => Promise<AdminUserRecord>;
  createUser: (params: {
    email: string;
    password: string;
    displayName: string;
    emailVerified: boolean;
    disabled?: boolean;
  }) => Promise<AdminUserRecord>;
  deleteUser: (uid: string) => Promise<void>;
  getDoc: (path: string) => Promise<{ exists: boolean; data: Record<string, any> | undefined }>;
  setDoc: (path: string, data: Record<string, any>, merge?: boolean) => Promise<void>;
  deleteDoc: (path: string) => Promise<void>;
  syncTaskAcls: (params: {
    ownerUid: string;
    targetUid: string;
    addTaskIds: string[];
    removeTaskIds: string[];
  }) => Promise<{ missingTaskIds: string[]; addedCount: number; removedCount: number }>;
  isMock?: boolean;
}

export interface ProvisionDevRequest {
  mode: "create-with-temp-password" | "link-existing";
  email: string;
  tempPassword?: string;
  name: string;
  role?: UserRole;
  status?: UserStatus;
  linkedDevId?: string;
  linkedDevName?: string;
  existingUid?: string;
  previousMemberId?: string;
  permissions?: Partial<UserPermissions>;
  assignedTaskIds?: string[];
  workspaceOwnerUid?: string;
}

export interface ProvisionDevResult {
  success: boolean;
  mode: "create-with-temp-password" | "link-existing";
  uid: string;
  member: WorkspaceMember;
  tasksSynced: boolean;
  addedTasksCount: number;
  removedTasksCount: number;
  missingTaskIds: string[];
  linkedDevUpdated: boolean;
  partialFailure?: boolean;
  warning?: string;
}

let cachedAdminApp: AdminApp | null = null;
let mockBackendOverride: AdminBackendAdapter | null = null;
const inFlightProvisions = new Set<string>();

function sanitizePermissions(
  role: UserRole,
  raw?: Partial<UserPermissions>
): UserPermissions {
  if (role === "ADM") {
    return JSON.parse(JSON.stringify(DEFAULT_ADM_PERMISSIONS));
  }
  const base = DEFAULT_COLLABORATOR_PERMISSIONS;
  const rawModules = (raw?.modules || {}) as Record<string, any>;
  const rawActions = (raw?.actions || {}) as Record<string, any>;

  return {
    modules: {
      dashboard: rawModules.dashboard !== undefined ? Boolean(rawModules.dashboard) : base.modules.dashboard,
      projects: rawModules.projects !== undefined ? Boolean(rawModules.projects) : base.modules.projects,
      esteira: rawModules.esteira !== undefined ? Boolean(rawModules.esteira) : base.modules.esteira,
      sprints: rawModules.sprints !== undefined ? Boolean(rawModules.sprints) : base.modules.sprints,
      projectReport: rawModules.projectReport !== undefined ? Boolean(rawModules.projectReport) : base.modules.projectReport,
      kanban: rawModules.kanban !== undefined ? Boolean(rawModules.kanban) : base.modules.kanban,
      list: rawModules.list !== undefined ? Boolean(rawModules.list) : base.modules.list,
      gantt: rawModules.gantt !== undefined ? Boolean(rawModules.gantt) : base.modules.gantt,
      robots: rawModules.robots !== undefined ? Boolean(rawModules.robots) : base.modules.robots,
      totem: rawModules.totem !== undefined ? Boolean(rawModules.totem) : base.modules.totem,
      reports: rawModules.reports !== undefined ? Boolean(rawModules.reports) : base.modules.reports
    },
    actions: {
      view: rawActions.view !== undefined ? Boolean(rawActions.view) : base.actions.view,
      create: rawActions.create !== undefined ? Boolean(rawActions.create) : base.actions.create,
      edit: rawActions.edit !== undefined ? Boolean(rawActions.edit) : base.actions.edit,
      comment: rawActions.comment !== undefined ? Boolean(rawActions.comment) : base.actions.comment,
      attach: rawActions.attach !== undefined ? Boolean(rawActions.attach) : base.actions.attach,
      export: rawActions.export !== undefined ? Boolean(rawActions.export) : base.actions.export
    },
    canAssign: false,
    canReorganize: false,
    canDelete: false,
    canImport: false,
    canManageUsers: false,
    canManageIntegrations: false,
    canManageSprints: Boolean(raw?.canManageSprints)
  };
}

function scrubSecret(message: string, secret?: string): string {
  if (!secret || secret.length < 2) return message;
  return message.split(secret).join("[REDACTED]");
}

function getOrInitAdminApp(): { app: AdminApp; auth: AdminAuth; db: AdminFirestore } {
  const hasEmulator = Boolean(process.env.FIREBASE_AUTH_EMULATOR_HOST || process.env.FIRESTORE_EMULATOR_HOST);
  const serviceAccountEnv = (process.env.FIREBASE_SERVICE_ACCOUNT || "").trim();
  const googleCredsEnv = (process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();

  if (!hasEmulator && !serviceAccountEnv && !googleCredsEnv) {
    const err: any = new Error(
      "Credencial privilegiada do Firebase Admin SDK não configurada no servidor (FIREBASE_SERVICE_ACCOUNT ou GOOGLE_APPLICATION_CREDENTIALS)."
    );
    err.status = 503;
    err.code = "ADMIN_SDK_UNAVAILABLE";
    throw err;
  }

  if (!cachedAdminApp) {
    const existing = getApps().find((a) => a.name === "nexus-admin");
    if (existing) {
      cachedAdminApp = existing;
    } else if (serviceAccountEnv) {
      let parsed: any;
      try {
        if (serviceAccountEnv.startsWith("{")) {
          parsed = JSON.parse(serviceAccountEnv);
        } else if (fs.existsSync(serviceAccountEnv)) {
          parsed = JSON.parse(fs.readFileSync(serviceAccountEnv, "utf-8"));
        } else {
          parsed = JSON.parse(Buffer.from(serviceAccountEnv, "base64").toString("utf-8"));
        }
      } catch {
        const err: any = new Error("FIREBASE_SERVICE_ACCOUNT possui formato JSON/base64 inválido.");
        err.status = 503;
        err.code = "ADMIN_SDK_INVALID_CONFIG";
        throw err;
      }
      cachedAdminApp = initializeApp(
        {
          credential: cert(parsed),
          projectId: parsed.project_id || firebaseConfig.projectId
        },
        "nexus-admin"
      );
    } else if (googleCredsEnv) {
      cachedAdminApp = initializeApp(
        {
          credential: applicationDefault(),
          projectId: firebaseConfig.projectId
        },
        "nexus-admin"
      );
    } else {
      // Emulator mode
      cachedAdminApp = initializeApp(
        {
          projectId: firebaseConfig.projectId
        },
        "nexus-admin"
      );
    }
  }

  const adminAuth = getAuth(cachedAdminApp);
  const databaseId = (firebaseConfig as any).firestoreDatabaseId;
  const adminDb =
    databaseId && databaseId !== "(default)"
      ? getFirestore(cachedAdminApp, databaseId)
      : getFirestore(cachedAdminApp);

  return { app: cachedAdminApp, auth: adminAuth, db: adminDb };
}

function getLiveAdapter(): AdminBackendAdapter {
  if (mockBackendOverride) {
    return mockBackendOverride;
  }
  const { auth, db } = getOrInitAdminApp();

  return {
    verifyIdToken: async (idToken: string) => {
      const decoded = await auth.verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: decoded.email,
        email_verified: decoded.email_verified,
        auth_time: decoded.auth_time,
        exp: decoded.exp
      };
    },
    getUser: async (uid: string) => {
      const rec = await auth.getUser(uid);
      return {
        uid: rec.uid,
        email: rec.email,
        displayName: rec.displayName,
        emailVerified: rec.emailVerified,
        disabled: rec.disabled,
        tokensValidAfterTime: rec.tokensValidAfterTime,
        metadata: {
          creationTime: rec.metadata?.creationTime,
          lastSignInTime: rec.metadata?.lastSignInTime
        }
      };
    },
    getUserByEmail: async (email: string) => {
      const rec = await auth.getUserByEmail(email);
      return {
        uid: rec.uid,
        email: rec.email,
        displayName: rec.displayName,
        emailVerified: rec.emailVerified,
        disabled: rec.disabled,
        tokensValidAfterTime: rec.tokensValidAfterTime,
        metadata: {
          creationTime: rec.metadata?.creationTime,
          lastSignInTime: rec.metadata?.lastSignInTime
        }
      };
    },
    createUser: async (params) => {
      const rec = await auth.createUser({
        email: params.email,
        password: params.password,
        displayName: params.displayName,
        emailVerified: params.emailVerified,
        disabled: Boolean(params.disabled)
      });
      return {
        uid: rec.uid,
        email: rec.email,
        displayName: rec.displayName,
        emailVerified: rec.emailVerified,
        disabled: rec.disabled,
        tokensValidAfterTime: rec.tokensValidAfterTime,
        metadata: {
          creationTime: rec.metadata?.creationTime,
          lastSignInTime: rec.metadata?.lastSignInTime
        }
      };
    },
    deleteUser: async (uid: string) => {
      await auth.deleteUser(uid);
    },
    getDoc: async (docPath: string) => {
      const snap = await db.doc(docPath).get();
      return {
        exists: snap.exists,
        data: snap.exists ? (snap.data() as Record<string, any>) : undefined
      };
    },
    setDoc: async (docPath: string, data: Record<string, any>, merge = true) => {
      await db.doc(docPath).set(data, { merge });
    },
    deleteDoc: async (docPath: string) => {
      await db.doc(docPath).delete();
    },
    syncTaskAcls: async ({ ownerUid, targetUid, addTaskIds, removeTaskIds }) => {
      const missingTaskIds: string[] = [];
      let addedCount = 0;
      let removedCount = 0;

      const ops: Array<{ ref: FirebaseFirestore.DocumentReference; update: Record<string, any> }> = [];

      for (const taskId of addTaskIds) {
        const safeId = String(taskId).replace(/\//g, "_").trim();
        if (!safeId) continue;
        const ref = db.doc(`users/${ownerUid}/tasks/${safeId}`);
        const snap = await ref.get();
        if (!snap.exists) {
          missingTaskIds.push(taskId);
          continue;
        }
        const data = snap.data() || {};
        const update: Record<string, any> = {
          allowedUids: FieldValue.arrayUnion(targetUid),
          updatedAt: new Date().toISOString()
        };
        if (!data.assignedUid) {
          update.assignedUid = targetUid;
        }
        ops.push({ ref, update });
        addedCount++;
      }

      for (const taskId of removeTaskIds) {
        const safeId = String(taskId).replace(/\//g, "_").trim();
        if (!safeId) continue;
        const ref = db.doc(`users/${ownerUid}/tasks/${safeId}`);
        const snap = await ref.get();
        if (!snap.exists) continue;
        const data = snap.data() || {};
        const update: Record<string, any> = {
          allowedUids: FieldValue.arrayRemove(targetUid),
          updatedAt: new Date().toISOString()
        };
        if (data.assignedUid === targetUid) {
          update.assignedUid = FieldValue.delete();
        }
        ops.push({ ref, update });
        removedCount++;
      }

      const chunkSize = 400;
      for (let i = 0; i < ops.length; i += chunkSize) {
        const batch = db.batch();
        const slice = ops.slice(i, i + chunkSize);
        slice.forEach((op) => batch.set(op.ref, op.update, { merge: true }));
        await batch.commit();
      }

      return { missingTaskIds, addedCount, removedCount };
    }
  };
}

function cleanFirestorePayload<T extends Record<string, any>>(obj: T): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      out[k] = v;
    }
  }
  return out;
}

export const AdminProvisioningService = {
  __setMockAdminBackend: (adapter: AdminBackendAdapter | null) => {
    mockBackendOverride = adapter;
  },

  verifyAdminCaller: async (
    authHeader: string | undefined
  ): Promise<{ uid: string; email?: string; isOwner: boolean; isAdmin: boolean }> => {
    const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      const err: any = new Error("Autenticação obrigatória no cabeçalho Authorization: Bearer <idToken>.");
      err.status = 401;
      err.code = "UNAUTHENTICATED";
      throw err;
    }

    const adapter = getLiveAdapter();
    let decoded: DecodedAdminIdToken;
    try {
      decoded = await adapter.verifyIdToken(token);
    } catch (e: any) {
      const err: any = new Error(e?.message || "Token Firebase inválido ou expirado.");
      err.status = 401;
      err.code = "INVALID_TOKEN";
      throw err;
    }

    if (!decoded?.uid) {
      const err: any = new Error("UID ausente no token autenticado.");
      err.status = 401;
      err.code = "INVALID_TOKEN";
      throw err;
    }

    if (decoded.uid === NEXUS_OWNER_UID) {
      return { uid: decoded.uid, email: decoded.email, isOwner: true, isAdmin: true };
    }

    const memberSnap = await adapter.getDoc(`users/${NEXUS_OWNER_UID}/members/${decoded.uid}`);
    const memberData = memberSnap.data;
    const isActiveAdm =
      memberSnap.exists &&
      memberData?.status === "active" &&
      memberData?.role === "ADM" &&
      memberData?.mustChangePassword !== true;

    if (!isActiveAdm) {
      const err: any = new Error("Acesso negado: apenas administradores ativos da workspace podem provisionar usuários.");
      err.status = 403;
      err.code = "FORBIDDEN_NOT_ADMIN";
      throw err;
    }

    return { uid: decoded.uid, email: decoded.email, isOwner: false, isAdmin: true };
  },

  provisionDeveloper: async (
    authHeader: string | undefined,
    body: ProvisionDevRequest
  ): Promise<ProvisionDevResult> => {
    const tempPasswordRaw = typeof body?.tempPassword === "string" ? body.tempPassword : "";

    // 1. Server-side ADM verification BEFORE anything else
    const caller = await AdminProvisioningService.verifyAdminCaller(authHeader);
    const adapter = getLiveAdapter();

    // 2. Validate payload strictly
    const mode = body?.mode;
    if (mode !== "create-with-temp-password" && mode !== "link-existing") {
      const err: any = new Error("Modo de provisionamento inválido. Use 'create-with-temp-password' ou 'link-existing'.");
      err.status = 400;
      err.code = "INVALID_MODE";
      throw err;
    }

    const cleanEmail = String(body?.email || "").trim().toLowerCase();
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail) || cleanEmail.length > 160) {
      const err: any = new Error("Informe um e-mail corporativo válido.");
      err.status = 400;
      err.code = "INVALID_EMAIL";
      throw err;
    }

    const cleanName = String(body?.name || cleanEmail.split("@")[0] || "").trim().slice(0, 120);
    if (!cleanName) {
      const err: any = new Error("Informe o nome completo do desenvolvedor.");
      err.status = 400;
      err.code = "INVALID_NAME";
      throw err;
    }

    const targetRole: UserRole = body?.role === "ADM" ? "ADM" : "Colaborador";
    if (targetRole === "ADM" && !caller.isOwner) {
      const err: any = new Error("Apenas o proprietário raiz do workspace pode promover usuários ao perfil ADM.");
      err.status = 403;
      err.code = "FORBIDDEN_OWNER_ONLY_ADM";
      throw err;
    }

    const targetStatus: UserStatus =
      body?.status === "inactive" || body?.status === "pending" ? body.status : "active";

    const ownerUid = NEXUS_OWNER_UID;
    const lockKey = `${ownerUid}:${cleanEmail}`;

    if (inFlightProvisions.has(lockKey)) {
      const err: any = new Error("Já existe um provisionamento em andamento para este e-mail. Aguarde a conclusão.");
      err.status = 409;
      err.code = "REQUEST_IN_PROGRESS";
      throw err;
    }

    if (mode === "create-with-temp-password") {
      if (!tempPasswordRaw || tempPasswordRaw.length < 6 || tempPasswordRaw.length > 128) {
        const err: any = new Error("A senha temporária deve ter entre 6 e 128 caracteres.");
        err.status = 400;
        err.code = "INVALID_TEMP_PASSWORD";
        throw err;
      }
    }

    const assignedTaskIds = Array.from(
      new Set(
        (Array.isArray(body?.assignedTaskIds) ? body.assignedTaskIds : [])
          .map((id) => String(id || "").trim())
          .filter(Boolean)
      )
    );

    const linkedDevId = body?.linkedDevId ? String(body.linkedDevId).trim() : undefined;
    const linkedDevName = body?.linkedDevName ? String(body.linkedDevName).trim() : undefined;
    const existingUidInput = body?.existingUid ? String(body.existingUid).trim() : undefined;
    const previousMemberId = body?.previousMemberId ? String(body.previousMemberId).trim() : undefined;

    inFlightProvisions.add(lockKey);

    try {
      let targetUser: AdminUserRecord;
      let createdNewAuthUser = false;

      if (mode === "create-with-temp-password") {
        // Check if Auth user already exists BEFORE attempting createUser
        let existingAuth: AdminUserRecord | null = null;
        try {
          existingAuth = await adapter.getUserByEmail(cleanEmail);
        } catch (lookupErr: any) {
          const code = lookupErr?.code || "";
          if (code && code !== "auth/user-not-found") {
            throw lookupErr;
          }
        }

        if (existingAuth) {
          const existingMemberSnap = await adapter.getDoc(`users/${ownerUid}/members/${existingAuth.uid}`);
          const err: any = new Error(
            existingMemberSnap.exists
              ? `O e-mail ${cleanEmail} já possui conta Auth e registro de membro (UID: ${existingAuth.uid}). Use "Vincular Conta Existente" ou edite o membro sem redefinir a senha.`
              : `O e-mail ${cleanEmail} já existe no Firebase Auth (UID: ${existingAuth.uid}). Use "Vincular Conta Existente" para associá-lo sem alterar sua senha atual.`
          );
          err.status = 409;
          err.code = existingMemberSnap.exists ? "EMAIL_ALREADY_PROVISIONED" : "EMAIL_ALREADY_EXISTS";
          err.existingUid = existingAuth.uid;
          throw err;
        }

        try {
          targetUser = await adapter.createUser({
            email: cleanEmail,
            password: tempPasswordRaw,
            displayName: cleanName,
            emailVerified: false,
            disabled: targetStatus === "inactive"
          });
          createdNewAuthUser = true;
        } catch (createErr: any) {
          if (createErr?.code === "auth/email-already-exists") {
            let detectedUid: string | undefined;
            try {
              const found = await adapter.getUserByEmail(cleanEmail);
              detectedUid = found.uid;
            } catch {}
            const err: any = new Error(
              `O e-mail ${cleanEmail} já existe no Firebase Auth. Use "Vincular Conta Existente" para evitar redefinição indevida de senha.`
            );
            err.status = 409;
            err.code = "EMAIL_ALREADY_EXISTS";
            err.existingUid = detectedUid;
            throw err;
          }
          const safeMsg = scrubSecret(createErr?.message || "Erro ao criar usuário no Firebase Auth.", tempPasswordRaw);
          const err: any = new Error(safeMsg);
          err.status = 500;
          err.code = createErr?.code || "AUTH_CREATE_FAILED";
          throw err;
        }
      } else {
        // mode === 'link-existing' — NEVER updates or resets password!
        try {
          if (existingUidInput) {
            targetUser = await adapter.getUser(existingUidInput);
            if (targetUser.email && targetUser.email.trim().toLowerCase() !== cleanEmail) {
              const err: any = new Error(
                `Conflito de identidade: o UID informado (${existingUidInput}) pertence ao e-mail ${targetUser.email}, diferente de ${cleanEmail}.`
              );
              err.status = 409;
              err.code = "UID_EMAIL_MISMATCH";
              throw err;
            }
          } else {
            targetUser = await adapter.getUserByEmail(cleanEmail);
          }
        } catch (lookupErr: any) {
          if (lookupErr?.status) throw lookupErr;
          const err: any = new Error(
            lookupErr?.code === "auth/user-not-found"
              ? `Nenhuma conta Firebase Auth encontrada para ${existingUidInput || cleanEmail}. Crie o login com senha temporária ou peça para o dev concluir o cadastro primeiro.`
              : lookupErr?.message || "Falha ao localizar conta existente no Firebase Auth."
          );
          err.status = lookupErr?.code === "auth/user-not-found" ? 404 : 500;
          err.code = lookupErr?.code || "AUTH_LOOKUP_FAILED";
          throw err;
        }
      }

      const targetUid = targetUser.uid;
      if (targetUid === NEXUS_OWNER_UID && targetRole !== "ADM") {
        const err: any = new Error("A conta do proprietário raiz não pode ser rebaixada.");
        err.status = 403;
        err.code = "FORBIDDEN_OWNER_IMMUTABLE";
        throw err;
      }

      // Read any previous member record (canonical UID or legacy mem_...) to compute task diff cleanly
      const existingCanonicalSnap = await adapter.getDoc(`users/${ownerUid}/members/${targetUid}`);
      const existingLegacySnap =
        previousMemberId && previousMemberId !== targetUid
          ? await adapter.getDoc(`users/${ownerUid}/members/${previousMemberId}`)
          : { exists: false, data: undefined };

      const prevMemberData = existingCanonicalSnap.data || existingLegacySnap.data;
      const previousTaskIds: string[] = Array.isArray(prevMemberData?.assignedTaskIds)
        ? prevMemberData.assignedTaskIds.map((x: any) => String(x || "").trim()).filter(Boolean)
        : [];

      const nowIso = new Date().toISOString();
      const nowSec = Math.floor(Date.now() / 1000);
      const authValidAfterMs = targetUser.tokensValidAfterTime
        ? Date.parse(targetUser.tokensValidAfterTime)
        : 0;

      const sanitizedPermissions = sanitizePermissions(targetRole, body?.permissions);

      // In create-with-temp-password mode, always enforce mustChangePassword: true.
      // In link-existing mode, preserve existing mustChangePassword if already pending, otherwise false (never force password change on untouched account).
      const mustChangePassword =
        mode === "create-with-temp-password"
          ? true
          : Boolean(prevMemberData?.mustChangePassword === true);

      const memberDoc: WorkspaceMember = cleanFirestorePayload({
        id: targetUid,
        uid: targetUid,
        email: cleanEmail,
        name: cleanName,
        role: targetUid === NEXUS_OWNER_UID ? "ADM" : targetRole,
        status: targetUid === NEXUS_OWNER_UID ? "active" : targetStatus,
        permissions: sanitizedPermissions,
        assignedTaskIds: targetRole === "ADM" ? [] : assignedTaskIds,
        workspaceOwnerUid: ownerUid,
        invitedAt: prevMemberData?.invitedAt || nowIso,
        activatedAt: targetStatus === "active" ? (prevMemberData?.activatedAt || nowIso) : prevMemberData?.activatedAt,
        invitedBy: caller.email || caller.uid,
        linkedDevId: linkedDevId || prevMemberData?.linkedDevId,
        linkedDevName: linkedDevName || prevMemberData?.linkedDevName,
        mustChangePassword,
        tempPasswordSetAt: mode === "create-with-temp-password" ? nowSec : prevMemberData?.tempPasswordSetAt,
        authValidAfterAtProvisionMs:
          mode === "create-with-temp-password" ? authValidAfterMs : prevMemberData?.authValidAfterAtProvisionMs,
        passwordChangedAt: prevMemberData?.passwordChangedAt,
        provisioningMode:
          mode === "create-with-temp-password"
            ? "admin-temp-password"
            : prevMemberData?.provisioningMode || "admin-linked-existing"
      }) as WorkspaceMember;

      // Step 2: Persist canonical Member document (with compensating Auth delete rollback on failure if newly created)
      try {
        await adapter.setDoc(
          `users/${ownerUid}/members/${targetUid}`,
          {
            ...memberDoc,
            updatedAt: nowIso
          },
          true
        );
      } catch (memberWriteErr: any) {
        let rollbackSucceeded = false;
        if (createdNewAuthUser) {
          try {
            await adapter.deleteUser(targetUid);
            rollbackSucceeded = true;
          } catch {
            rollbackSucceeded = false;
          }
        }
        const safeMsg = scrubSecret(memberWriteErr?.message || "Erro ao gravar registro de membro no Firestore.", tempPasswordRaw);
        const err: any = new Error(
          createdNewAuthUser
            ? rollbackSucceeded
              ? `Falha ao salvar permissões no Firestore (${safeMsg}). A conta criada no Auth foi revertida automaticamente; tente novamente.`
              : `Falha parcial crítica: usuário criado no Auth (UID: ${targetUid}), mas falhou ao gravar membro e o rollback do Auth também falhou. Utilize "Vincular Conta Existente" com UID ${targetUid}.`
            : `Falha ao gravar registro do membro no Firestore: ${safeMsg}`
        );
        err.status = 500;
        err.code = createdNewAuthUser
          ? rollbackSucceeded
            ? "PROVISION_ROLLED_BACK"
            : "PARTIAL_FAILURE_AUTH_ONLY"
          : "MEMBER_WRITE_FAILED";
        err.partialFailure = createdNewAuthUser && !rollbackSucceeded;
        err.authCreated = createdNewAuthUser;
        err.memberSaved = false;
        err.rollbackSucceeded = rollbackSucceeded;
        err.createdUid = targetUid;
        throw err;
      }

      // Clean up legacy mem_... doc if migrating to UID key
      if (previousMemberId && previousMemberId !== targetUid) {
        await adapter.deleteDoc(`users/${ownerUid}/members/${previousMemberId}`).catch(() => {});
      }

      // Step 3: Link existing Dev catalog entry (metadata only) and sync task ACLs
      let linkedDevUpdated = false;
      let warningMessages: string[] = [];

      if (linkedDevId) {
        try {
          const safeDevId = linkedDevId.replace(/\//g, "_").trim();
          const devSnap = await adapter.getDoc(`users/${ownerUid}/devs/${safeDevId}`);
          if (devSnap.exists) {
            await adapter.setDoc(
              `users/${ownerUid}/devs/${safeDevId}`,
              {
                linkedUid: targetUid,
                linkedMemberId: targetUid,
                email: cleanEmail,
                updatedAt: nowIso
              },
              true
            );
            linkedDevUpdated = true;
          } else {
            warningMessages.push(`Cadastro de Dev '${linkedDevName || linkedDevId}' não localizado na nuvem para anotar UID.`);
          }
        } catch (devErr: any) {
          warningMessages.push(`Falha ao atualizar referência no Dev: ${devErr?.message || "erro"}`);
        }
      }

      // Resolve pending access request for this UID if any exists
      try {
        const reqSnap = await adapter.getDoc(`users/${ownerUid}/accessRequests/${targetUid}`);
        if (reqSnap.exists && reqSnap.data?.status === "pending") {
          await adapter.setDoc(
            `users/${ownerUid}/accessRequests/${targetUid}`,
            {
              status: "resolved",
              resolvedAt: nowIso,
              resolvedByUid: caller.uid,
              updatedAt: nowIso
            },
            true
          );
        }
      } catch {
        // Non-blocking
      }

      // Sync task ACLs so ONLY assigned demands include targetUid in allowedUids
      const addTaskIds = targetRole === "ADM" ? [] : assignedTaskIds;
      const removeTaskIds =
        targetRole === "ADM"
          ? previousTaskIds
          : previousTaskIds.filter((id) => !assignedTaskIds.includes(id));

      let addedTasksCount = 0;
      let removedTasksCount = 0;
      let missingTaskIds: string[] = [];

      if (addTaskIds.length > 0 || removeTaskIds.length > 0) {
        try {
          const syncRes = await adapter.syncTaskAcls({
            ownerUid,
            targetUid,
            addTaskIds,
            removeTaskIds
          });
          addedTasksCount = syncRes.addedCount;
          removedTasksCount = syncRes.removedCount;
          missingTaskIds = syncRes.missingTaskIds;
        } catch (taskSyncErr: any) {
          const safeMsg = scrubSecret(taskSyncErr?.message || "Erro ao sincronizar ACL das demandas.", tempPasswordRaw);
          const err: any = new Error(
            `Falha parcial: login e perfil do colaborador foram salvos (UID: ${targetUid}), mas falhou ao liberar demandas atribuídas (${safeMsg}). Utilize "Vincular Conta Existente" ou edite o membro para re-sincronizar as demandas.`
          );
          err.status = 500;
          err.code = "PARTIAL_FAILURE_TASKS_SYNC";
          err.partialFailure = true;
          err.authCreated = createdNewAuthUser;
          err.memberSaved = true;
          err.tasksSynced = false;
          err.createdUid = targetUid;
          err.member = memberDoc;
          throw err;
        }
      }

      if (missingTaskIds.length > 0) {
        warningMessages.push(`Demandas não encontradas na nuvem: ${missingTaskIds.join(", ")}.`);
      }

      return {
        success: true,
        mode,
        uid: targetUid,
        member: memberDoc,
        tasksSynced: true,
        addedTasksCount,
        removedTasksCount,
        missingTaskIds,
        linkedDevUpdated,
        warning: warningMessages.length > 0 ? warningMessages.join(" ") : undefined
      };
    } finally {
      inFlightProvisions.delete(lockKey);
    }
  },

  completeFirstPasswordChange: async (
    authHeader: string | undefined
  ): Promise<{ success: boolean; alreadyCompleted?: boolean; member: WorkspaceMember }> => {
    const token = String(authHeader || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) {
      const err: any = new Error("Token de autenticação obrigatório.");
      err.status = 401;
      err.code = "UNAUTHENTICATED";
      throw err;
    }

    const adapter = getLiveAdapter();
    let decoded: DecodedAdminIdToken;
    try {
      decoded = await adapter.verifyIdToken(token);
    } catch (e: any) {
      const err: any = new Error(e?.message || "Token Firebase inválido ou expirado.");
      err.status = 401;
      err.code = "INVALID_TOKEN";
      throw err;
    }

    const uid = decoded.uid;
    const memberPath = `users/${NEXUS_OWNER_UID}/members/${uid}`;
    const memberSnap = await adapter.getDoc(memberPath);

    if (!memberSnap.exists || !memberSnap.data) {
      const err: any = new Error("Registro de membro não encontrado na workspace.");
      err.status = 404;
      err.code = "MEMBER_NOT_FOUND";
      throw err;
    }

    const member = memberSnap.data as WorkspaceMember;
    if (member.status !== "active") {
      const err: any = new Error("Seu acesso ainda não está ativo na workspace.");
      err.status = 403;
      err.code = "MEMBER_NOT_ACTIVE";
      throw err;
    }

    if (member.mustChangePassword !== true) {
      return { success: true, alreadyCompleted: true, member };
    }

    // Verify password change actually occurred in Firebase Auth
    const authUser = await adapter.getUser(uid);
    const validAfterMs = authUser.tokensValidAfterTime ? Date.parse(authUser.tokensValidAfterTime) : 0;
    const creationMs = authUser.metadata?.creationTime ? Date.parse(authUser.metadata.creationTime) : 0;
    const baselineMs = member.authValidAfterAtProvisionMs || creationMs || (member.tempPasswordSetAt ? member.tempPasswordSetAt * 1000 : 0);

    // Updating a password in Firebase Auth updates tokensValidAfterTime past initial creation/provision time.
    if (!validAfterMs || (baselineMs > 0 && validAfterMs <= baselineMs)) {
      const err: any = new Error(
        "A alteração de senha ainda não foi confirmada no Firebase Auth. Conclua a troca de senha antes de liberar os dados."
      );
      err.status = 403;
      err.code = "PASSWORD_CHANGE_NOT_VERIFIED";
      throw err;
    }

    const nowIso = new Date().toISOString();
    const updatedMember: WorkspaceMember = {
      ...member,
      mustChangePassword: false,
      passwordChangedAt: nowIso
    };

    await adapter.setDoc(
      memberPath,
      {
        mustChangePassword: false,
        passwordChangedAt: nowIso,
        updatedAt: nowIso
      },
      true
    );

    return { success: true, member: updatedMember };
  }
};
