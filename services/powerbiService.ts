import crypto from "crypto";
import firebaseConfig from "../firebase-applet-config.json" with { type: "json" };

// ---------------------------------------------------------------------------
// Configuration & Secrets (Server-Side Only - Never Exposed to Frontend)
// ---------------------------------------------------------------------------
export interface PowerBIConfig {
  apiKey: string;
  ownerUid: string;
  refreshToken?: string;
}

// In-memory volatile store for the active session bridge token
// NEVER written to disk, Git, URLs, or logged.
interface ActiveSession {
  idToken: string;
  uid: string;
  email?: string;
  expiresAt: number; // Unix timestamp in seconds
  connectedAt: string;
}

let activeSession: ActiveSession | null = null;

// Autonomous ID token cache (RAM-only optimization with safety buffer, bound to ownerUid and credential fingerprint)
interface CachedIdToken {
  idToken: string;
  ownerUid: string;
  tokenFingerprint: string; // SHA-256 hex hash of the source refresh token
  expiresAt: number; // Unix timestamp in seconds
}
let autonomousTokenCache: CachedIdToken | null = null;

const computeTokenFingerprint = (token: string): string => {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
};

// Cache for Google's public certificates (RS256 verification of Firebase ID Tokens)
interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}
let googleCertsCache: CertCache | null = null;

// Allow injecting mock certificates or fetcher in test environments
let mockCertsOverride: Record<string, string> | null = null;
let mockFirestoreFetch: ((url: string, init: any) => Promise<any>) | null = null;
let mockRefreshTokenFetch: ((url: string, init: any) => Promise<any>) | null = null;

// ---------------------------------------------------------------------------
// Strict Allowlists (Entity Sanitization)
// Rejects any unapproved or sensitive fields (history, tokens, internal data)
// ---------------------------------------------------------------------------
export function sanitizeTask(doc: any): any {
  if (!doc || typeof doc !== "object") return null;

  const allowed: Record<string, any> = {
    id: String(doc.id || "").trim(),
    type: String(doc.type || "Incidente").trim(),
    summary: String(doc.summary || "").trim(),
    status: String(doc.status || "Novo").trim(),
    priority: String(doc.priority || "3 - Moderada").trim(),
    assignee: doc.assignee ? String(doc.assignee).trim() : null,
    requester: String(doc.requester || "").trim(),
    startDate: String(doc.startDate || "").trim(),
    endDate: String(doc.endDate || "").trim(),
    estimatedTime: String(doc.estimatedTime || "").trim(),
    actualTime: String(doc.actualTime || "").trim(),
    fteValue: typeof doc.fteValue === "number" && Number.isFinite(doc.fteValue) ? doc.fteValue : 0,
    automationName: String(doc.automationName || "").trim(),
    managementArea: String(doc.managementArea || "").trim(),
    iterationPath: String(doc.iterationPath || "").trim(),
    createdAt: String(doc.createdAt || "").trim()
  };

  if (doc.description !== undefined && doc.description !== null) {
    allowed.description = String(doc.description);
  }
  if (doc.category !== undefined && doc.category !== null) {
    allowed.category = String(doc.category);
  }
  if (doc.subcategory !== undefined && doc.subcategory !== null) {
    allowed.subcategory = String(doc.subcategory);
  }
  if (doc.blocker !== undefined && doc.blocker !== null) {
    allowed.blocker = String(doc.blocker);
  }

  // Sanitize subTasks: only project specific fields, stripping any private metadata
  if (Array.isArray(doc.subTasks)) {
    allowed.subTasks = doc.subTasks.map((st: any) => ({
      id: String(st.id || "").trim(),
      title: String(st.title || st.summary || "").trim(),
      status: String(st.status || "Pendente").trim(),
      estimatedHours: typeof st.estimatedHours === "number" && Number.isFinite(st.estimatedHours) ? st.estimatedHours : 0,
      actualHours: typeof st.actualHours === "number" && Number.isFinite(st.actualHours) ? st.actualHours : 0,
      assignee: st.assignee ? String(st.assignee).trim() : null
    }));
  }

  return allowed;
}

export function sanitizeRobot(doc: any): any {
  if (!doc || typeof doc !== "object") return null;

  return {
    id: String(doc.id || "").trim(),
    name: String(doc.name || "").trim(),
    status: String(doc.status || "Ativo").trim(),
    area: String(doc.area || "").trim(),
    developer: String(doc.developer || "").trim(),
    folder: String(doc.folder || "").trim(),
    fte: typeof doc.fte === "number" && Number.isFinite(doc.fte) ? doc.fte : 0,
    ticketNumber: String(doc.ticketNumber || "").trim()
  };
}

export function sanitizeDeveloper(doc: any): any {
  if (!doc || typeof doc !== "object") return null;

  return {
    id: String(doc.id || "").trim(),
    name: String(doc.name || "").trim()
  };
}

export const PowerBIService = {
  /**
   * Retrieves server-side Power BI configuration.
   * Exclusively sourced from process.env / server secrets.
   */
  getConfig: (): PowerBIConfig => {
    const apiKey = (process.env.POWERBI_API_KEY || "").trim();
    const ownerUid = (process.env.POWERBI_OWNER_UID || "").trim();
    const refreshToken = (process.env.FIREBASE_REFRESH_TOKEN || "").trim();
    return { apiKey, ownerUid, refreshToken: refreshToken || undefined };
  },

  /**
   * Timing-safe comparison of provided key against server's configured POWERBI_API_KEY.
   */
  validateApiKey: (providedKey: string): { valid: boolean; status?: number; error?: string } => {
    // 1. Missing or empty client key is immediately 401 Unauthorized
    if (!providedKey || typeof providedKey !== "string" || !providedKey.trim()) {
      return {
        valid: false,
        status: 401,
        error: "Chave de API não fornecida. Envie o parâmetro 'key' ou o cabeçalho 'X-API-Key' / 'Authorization: Bearer <key>'."
      };
    }

    // 2. Server configuration checks (incomplete server setup -> 503 Service Unavailable)
    const { apiKey } = PowerBIService.getConfig();
    if (!apiKey) {
      return {
        valid: false,
        status: 503,
        error: "Configuração do servidor incompleta. A variável POWERBI_API_KEY não foi configurada pelo administrador."
      };
    }

    if (apiKey.length < 32) {
      return {
        valid: false,
        status: 503,
        error: "A chave POWERBI_API_KEY configurada no servidor é insegura (deve ter pelo menos 32 caracteres)."
      };
    }

    const cleanProvided = providedKey.trim();
    const cleanExpected = apiKey.trim();

    const bufProvided = Buffer.from(cleanProvided);
    const bufExpected = Buffer.from(cleanExpected);

    if (bufProvided.length !== bufExpected.length) {
      return {
        valid: false,
        status: 401,
        error: "Chave de API inválida."
      };
    }

    const matches = crypto.timingSafeEqual(bufProvided, bufExpected);
    if (!matches) {
      return {
        valid: false,
        status: 401,
        error: "Chave de API inválida."
      };
    }

    return { valid: true };
  },

  /**
   * Fetches Google's public x509 certificates with strict validation and timeout.
   */
  getGooglePublicCerts: async (): Promise<Record<string, string>> => {
    if (mockCertsOverride) {
      return mockCertsOverride;
    }

    const now = Math.floor(Date.now() / 1000);
    if (googleCertsCache && googleCertsCache.expiresAt > now) {
      return googleCertsCache.certs;
    }

    const GOOGLE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
    
    try {
      const res = await fetch(GOOGLE_CERTS_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(5000)
      });

      if (!res.ok) {
        throw new Error(`Falha ao obter chaves públicas do Google (HTTP ${res.status}).`);
      }

      const certs: any = await res.json();
      if (!certs || typeof certs !== "object" || Object.keys(certs).length === 0) {
        throw new Error("Formato inválido de certificados públicos retornado pelo Google.");
      }

      let maxAge = 3600;
      const cacheControl = res.headers.get("cache-control");
      if (cacheControl) {
        const match = cacheControl.match(/max-age=(\d+)/);
        if (match) maxAge = Math.min(parseInt(match[1], 10), 86400);
      }

      googleCertsCache = {
        certs,
        expiresAt: now + maxAge
      };

      return certs;
    } catch (e: any) {
      throw new Error("Não foi possível validar as chaves públicas do Google: " + (e.message || "timeout de rede."));
    }
  },

  /**
   * Cryptographically validates a Firebase ID Token using Google's public x509 certificates.
   * Enforces:
   * - Algorithm RS256
   * - Non-empty sub <= 128 chars
   * - Numeric finite exp > now
   * - Numeric finite iat <= now + 300
   * - Numeric finite auth_time (if present) <= now + 300
   * - Issuer: https://securetoken.google.com/<projectId>
   * - Audience: <projectId>
   * - Sub strictly matches expectedUid (POWERBI_OWNER_UID)
   */
  verifyFirebaseIdToken: async (
    token: string,
    expectedUid: string
  ): Promise<{ uid: string; email?: string; expiresAt: number }> => {
    if (!token || typeof token !== "string" || !token.trim()) {
      throw new Error("Token de autenticação não fornecido.");
    }

    const parts = token.trim().split(".");
    if (parts.length !== 3) {
      throw new Error("Formato de token JWT inválido.");
    }

    const [headerB64, payloadB64, signatureB64] = parts;

    let header: any;
    let payload: any;
    try {
      header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf-8"));
      payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    } catch {
      throw new Error("Falha ao decodificar payload do token JWT.");
    }

    if (header.alg !== "RS256") {
      throw new Error("Algoritmo JWT inválido: esperado RS256.");
    }

    if (!header.kid || typeof header.kid !== "string") {
      throw new Error("Identificador de chave pública (kid) ausente no cabeçalho JWT.");
    }

    const certs = await PowerBIService.getGooglePublicCerts();
    const cert = certs[header.kid];
    if (!cert) {
      throw new Error("Chave pública correspondente ao token não foi encontrada.");
    }

    // Verify cryptographic signature using RS256
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(`${headerB64}.${payloadB64}`);
    const signature = Buffer.from(signatureB64, "base64url");
    const isSignatureValid = verifier.verify(cert, signature);

    if (!isSignatureValid) {
      throw new Error("Assinatura criptográfica do token Firebase é inválida.");
    }

    const now = Math.floor(Date.now() / 1000);

    // Validate claims: exp must be a finite number > now
    if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) {
      throw new Error("Claim 'exp' do token ausente ou inválida.");
    }
    if (payload.exp <= now) {
      throw new Error("O token de autenticação Firebase está expirado.");
    }

    // Validate claims: iat must be a finite number <= now + 300
    if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat) || payload.iat <= 0) {
      throw new Error("Claim 'iat' do token ausente ou inválida.");
    }
    if (payload.iat > now + 300) {
      throw new Error("Claim 'iat' no futuro.");
    }

    // Validate claims: auth_time if present must be a finite number <= now + 300
    if (payload.auth_time !== undefined && payload.auth_time !== null) {
      if (typeof payload.auth_time !== "number" || !Number.isFinite(payload.auth_time) || payload.auth_time <= 0) {
        throw new Error("Claim 'auth_time' inválida.");
      }
      if (payload.auth_time > now + 300) {
        throw new Error("Claim 'auth_time' no futuro.");
      }
    }

    // Validate project binding
    const expectedProject = firebaseConfig.projectId;
    const expectedIssuer = `https://securetoken.google.com/${expectedProject}`;

    if (payload.iss !== expectedIssuer) {
      throw new Error("Emissor (iss) do token inválido para este projeto.");
    }

    if (payload.aud !== expectedProject) {
      throw new Error("Destinatário (aud) do token inválido para este projeto.");
    }

    // Validate sub (UID): non-empty string <= 128 chars
    const tokenUid = payload.sub || payload.user_id;
    if (typeof tokenUid !== "string" || !tokenUid.trim() || tokenUid.length > 128) {
      throw new Error("Identificador de usuário (sub) ausente ou inválido no token.");
    }

    // Strict owner verification: sub must match configured expectedUid
    if (!expectedUid || tokenUid !== expectedUid) {
      throw new Error("Acesso negado: o token fornecido não pertence ao proprietário configurado.");
    }

    return {
      uid: tokenUid,
      email: typeof payload.email === "string" ? payload.email : undefined,
      expiresAt: payload.exp
    };
  },

  /**
   * Exchanges FIREBASE_REFRESH_TOKEN for a short-lived Firebase ID Token via the official Google Secure Token API.
   * Documentation: https://firebase.google.com/docs/reference/rest/auth#section-refresh-token
   * Validates:
   * - Endpoint HTTP response status
   * - data.user_id === expectedOwnerUid
   * - data.project_id === firebaseConfig.projectId
   * - Cryptographic signature of returned id_token via verifyFirebaseIdToken
   * In-memory cache is purely an optimization with a 5-minute safety margin; cold starts renew autonomously.
   */
  exchangeRefreshTokenForIdToken: async (
    refreshToken: string,
    expectedOwnerUid: string
  ): Promise<string> => {
    if (!refreshToken || typeof refreshToken !== "string" || !refreshToken.trim()) {
      const err: any = new Error("FIREBASE_REFRESH_TOKEN não fornecido.");
      err.status = 503;
      err.code = "CONFIG_MISSING_REFRESH_TOKEN";
      throw err;
    }

    const currentFingerprint = computeTokenFingerprint(refreshToken);
    const now = Math.floor(Date.now() / 1000);

    // Cache hit: valid ONLY if ownerUid matches, token fingerprint matches, and expiration has > 300s margin
    if (
      autonomousTokenCache &&
      autonomousTokenCache.ownerUid === expectedOwnerUid &&
      autonomousTokenCache.tokenFingerprint === currentFingerprint &&
      typeof autonomousTokenCache.expiresAt === "number" &&
      Number.isFinite(autonomousTokenCache.expiresAt) &&
      autonomousTokenCache.expiresAt > now + 300
    ) {
      return autonomousTokenCache.idToken;
    }

    const apiKey = firebaseConfig.apiKey;
    if (!apiKey) {
      autonomousTokenCache = null;
      const err: any = new Error("Configuração pública do Firebase incompleta (apiKey ausente).");
      err.status = 503;
      err.code = "CONFIG_ERROR";
      throw err;
    }

    const tokenUrl = `https://securetoken.googleapis.com/v1/token?key=${encodeURIComponent(apiKey)}`;
    const postBody = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken.trim()
    }).toString();

    let res: any;
    try {
      const fetchFn = mockRefreshTokenFetch || fetch;
      res = await fetchFn(tokenUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: postBody,
        signal: AbortSignal.timeout(8000)
      });
    } catch (e: any) {
      autonomousTokenCache = null;
      const isTimeout = e?.name === "TimeoutError" || e?.name === "AbortError";
      const err: any = new Error(
        isTimeout
          ? "Tempo limite esgotado ao contatar o serviço de autenticação do Firebase."
          : "Falha de rede ao contatar o serviço de autenticação do Firebase."
      );
      err.status = 503;
      err.code = isTimeout ? "AUTH_TIMEOUT" : "AUTH_NETWORK_ERROR";
      throw err;
    }

    if (!res.ok) {
      // Refresh token revoked, expired, or user disabled
      autonomousTokenCache = null;
      const err: any = new Error(
        "Falha na reautenticação autônoma com o Firebase (refresh token inválido, revogado ou expirado). Reautenticação necessária."
      );
      err.status = 503;
      err.code = "FIREBASE_REFRESH_TOKEN_INVALID";
      throw err;
    }

    let data: any;
    try {
      data = await res.json();
    } catch {
      autonomousTokenCache = null;
      const err: any = new Error("Resposta inválida do serviço de autenticação do Google.");
      err.status = 503;
      err.code = "INVALID_AUTH_RESPONSE";
      throw err;
    }

    if (!data || typeof data !== "object") {
      autonomousTokenCache = null;
      const err: any = new Error("Formato de resposta inesperado do serviço de autenticação.");
      err.status = 503;
      err.code = "INVALID_AUTH_RESPONSE";
      throw err;
    }

    // 1. Validate user_id strictly matches expectedOwnerUid
    if (!data.user_id || typeof data.user_id !== "string" || data.user_id.trim() !== expectedOwnerUid) {
      autonomousTokenCache = null;
      const err: any = new Error(
        "Acesso negado: o refresh token configurado pertence a um UID diferente do POWERBI_OWNER_UID."
      );
      err.status = 503;
      err.code = "OWNER_UID_MISMATCH";
      throw err;
    }

    // 2. Validate project_id
    // Accept project number ONLY if it strictly matches the explicitly configured projectNumber / messagingSenderId
    const configuredProjectId = String(firebaseConfig.projectId || "").trim();
    const configuredProjectNumber = String(
      (firebaseConfig as any).projectNumber || firebaseConfig.messagingSenderId || ""
    ).trim();

    if (data.project_id !== undefined && data.project_id !== null) {
      const respProj = String(data.project_id).trim();
      const isValidIdentifier =
        (configuredProjectId && respProj === configuredProjectId) ||
        (configuredProjectNumber && respProj === configuredProjectNumber);

      if (!isValidIdentifier) {
        autonomousTokenCache = null;
        const err: any = new Error(
          "Configuração inválida: o refresh token configurado pertence a outro projeto Firebase."
        );
        err.status = 503;
        err.code = "PROJECT_MISMATCH";
        throw err;
      }
    }

    // 3. Validate id_token presence
    if (!data.id_token || typeof data.id_token !== "string" || !data.id_token.trim()) {
      autonomousTokenCache = null;
      const err: any = new Error("ID Token não retornado pelo serviço de autenticação.");
      err.status = 503;
      err.code = "INVALID_AUTH_RESPONSE";
      throw err;
    }

    // 4. Cryptographic RS256 validation of the returned ID token against Google's public x509 certs
    // Enforces aud === projectId, iss === https://securetoken.google.com/<projectId>, and sub === expectedOwnerUid
    let verified: { uid: string; email?: string; expiresAt: number };
    try {
      verified = await PowerBIService.verifyFirebaseIdToken(data.id_token, expectedOwnerUid);
    } catch (e: any) {
      autonomousTokenCache = null;
      throw e;
    }

    // 5. Cache with finite expiration, bound to ownerUid and tokenFingerprint
    autonomousTokenCache = {
      idToken: data.id_token,
      ownerUid: expectedOwnerUid,
      tokenFingerprint: currentFingerprint,
      expiresAt: verified.expiresAt
    };

    return data.id_token;
  },

  /**
   * Sets in-memory active session token received from the authenticated owner.
   */
  setActiveSession: (idToken: string, uid: string, email: string | undefined, expiresAt: number) => {
    activeSession = {
      idToken,
      uid,
      email,
      expiresAt,
      connectedAt: new Date().toISOString()
    };
  },

  /**
   * Resets active session in memory.
   */
  clearActiveSession: () => {
    activeSession = null;
  },

  /**
   * Returns current active session status without revealing sensitive owner data publicly.
   */
  getActiveSessionStatus: () => {
    const { ownerUid, apiKey, refreshToken } = PowerBIService.getConfig();
    const now = Math.floor(Date.now() / 1000);
    const hasConfig = Boolean(ownerUid && apiKey && apiKey.length >= 32);
    const hasRefreshToken = Boolean(refreshToken && refreshToken.trim().length > 10);
    const currentFingerprint = hasRefreshToken && refreshToken ? computeTokenFingerprint(refreshToken) : "";

    let sessionActive = false;
    let ttl = 0;
    let mode = "unconfigured";

    // 1. Check verified autonomous cache (proven connectivity)
    if (
      hasRefreshToken &&
      autonomousTokenCache &&
      autonomousTokenCache.ownerUid === ownerUid &&
      autonomousTokenCache.tokenFingerprint === currentFingerprint &&
      typeof autonomousTokenCache.expiresAt === "number" &&
      Number.isFinite(autonomousTokenCache.expiresAt) &&
      autonomousTokenCache.expiresAt > now
    ) {
      sessionActive = true;
      ttl = Math.max(0, autonomousTokenCache.expiresAt - now);
      mode = "refresh-token-autonomous";
    } else if (hasRefreshToken) {
      // Configured with secret, but awaiting first successful exchange/validation (ready-to-test)
      sessionActive = false;
      ttl = 0;
      mode = hasConfig ? "ready-to-test" : "unconfigured";
    } else if (
      activeSession &&
      activeSession.uid === ownerUid &&
      typeof activeSession.expiresAt === "number" &&
      Number.isFinite(activeSession.expiresAt) &&
      activeSession.expiresAt > now
    ) {
      sessionActive = true;
      ttl = Math.max(0, activeSession.expiresAt - now);
      mode = "active-session-bridge";
    } else if (hasConfig) {
      mode = "waiting-session";
    }

    return {
      configured: hasConfig,
      sessionActive,
      expiresInSeconds: ttl,
      mode,
      authStrategy: hasRefreshToken ? "refresh-token" : (hasConfig ? "session-bridge-qa" : "none")
    };
  },

  /**
   * Decodes a Firestore REST Document field into a native JavaScript value.
   */
  decodeFirestoreField: (field: any): any => {
    if (!field || typeof field !== "object") return null;

    if ("stringValue" in field) return field.stringValue;
    if ("integerValue" in field) return parseInt(field.integerValue, 10);
    if ("doubleValue" in field) return parseFloat(field.doubleValue);
    if ("booleanValue" in field) return Boolean(field.booleanValue);
    if ("timestampValue" in field) return field.timestampValue;
    if ("nullValue" in field) return null;

    if ("arrayValue" in field) {
      const values = field.arrayValue.values || [];
      return values.map(PowerBIService.decodeFirestoreField);
    }

    if ("mapValue" in field) {
      const subFields = field.mapValue.fields || {};
      const obj: Record<string, any> = {};
      for (const [k, v] of Object.entries(subFields)) {
        obj[k] = PowerBIService.decodeFirestoreField(v);
      }
      return obj;
    }

    return null;
  },

  /**
   * Converts a raw Firestore REST Document resource into a sanitized clean record.
   */
  decodeFirestoreDocument: (doc: any): any => {
    if (!doc || !doc.fields) return null;
    const result: Record<string, any> = {};

    for (const [key, val] of Object.entries(doc.fields)) {
      result[key] = PowerBIService.decodeFirestoreField(val);
    }

    if (!result.id && doc.name) {
      const parts = String(doc.name).split("/");
      result.id = parts[parts.length - 1];
    }

    return result;
  },

  /**
   * Fetches all documents from a specific subcollection of the owner in the named Firestore database.
   * Handles full pagination with loop protection and 8-second timeout.
   */
  fetchCollectionLive: async (
    collectionName: "tasks" | "devs" | "robots",
    ownerUid: string,
    authToken: string
  ): Promise<any[]> => {
    const projectId = firebaseConfig.projectId;
    const databaseId = firebaseConfig.firestoreDatabaseId || "(default)";
    const items: any[] = [];
    let pageToken: string | null = null;
    const seenTokens = new Set<string>();
    let pageCount = 0;

    do {
      pageCount++;
      if (pageCount > 50) {
        throw new Error("Limite de paginação atingido ao consultar o Firestore.");
      }

      let url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${encodeURIComponent(ownerUid)}/${collectionName}?pageSize=100`;
      if (pageToken) {
        if (seenTokens.has(pageToken)) {
          throw new Error("Ciclo de paginação detectado na API do Firestore.");
        }
        seenTokens.add(pageToken);
        url += `&pageToken=${encodeURIComponent(pageToken)}`;
      }

      const fetchFn = mockFirestoreFetch || fetch;
      const res = await fetchFn(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authToken}`,
          Accept: "application/json"
        },
        signal: AbortSignal.timeout(8000)
      });

      if (!res.ok && res.status === 403) {
        const parent = `projects/${projectId}/databases/${databaseId}/documents/users/${ownerUid}`;
        const probe = await fetchFn(`https://firestore.googleapis.com/v1/${parent}:runQuery`, {
          method: "POST",
          headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
          body: JSON.stringify({ structuredQuery: { from: [{ collectionId: collectionName }], limit: 1 } }),
          signal: AbortSignal.timeout(8000)
        });
        const probeError: any = new Error(`Firestore listDocuments negado; runQuery ${probe.status}; coleção ${collectionName}.`);
        probeError.status = 503;
        probeError.code = probe.ok ? "FIRESTORE_QUERY_COMPATIBILITY_CONFIRMED" : "FIRESTORE_QUERY_DENIED";
        throw probeError;
      }
      if (!res.ok) {
        // Report only allowlisted diagnostics; never return Google's raw response.
        const failure: any = await res.json().catch(() => ({}));
        const allowedReasons = new Set(["SERVICE_DISABLED", "BILLING_DISABLED", "CONSUMER_INVALID", "API_KEY_SERVICE_BLOCKED", "API_KEY_HTTP_REFERRER_BLOCKED", "IAM_PERMISSION_DENIED", "SECURITY_RULES_VIOLATED"]);
        const reason = (failure.error?.details || []).map((detail: any) => detail?.reason).find((value: any) => allowedReasons.has(value));
        const deniedByRules = /missing or insufficient permissions/i.test(failure.error?.message || "");
        const diagnosis = reason || (deniedByRules ? "SECURITY_RULES_DENIED" : (failure.error?.status === "PERMISSION_DENIED" ? "PERMISSION_DENIED" : "UPSTREAM_ERROR"));
        const err: any = new Error(`Falha Firestore (${res.status}): ${diagnosis}; coleção ${collectionName}.`);
        err.status = 503;
        err.code = "FIRESTORE_" + diagnosis;
        throw err;
      }

      const body: any = await res.json();
      const docs = body.documents || [];
      for (const d of docs) {
        const decoded = PowerBIService.decodeFirestoreDocument(d);
        if (decoded) items.push(decoded);
      }

      pageToken = body.nextPageToken || null;
    } while (pageToken);

    // Apply strict entity allowlist
    if (collectionName === "tasks") {
      return items.map(sanitizeTask).filter(Boolean);
    }
    if (collectionName === "robots") {
      return items.map(sanitizeRobot).filter(Boolean);
    }
    if (collectionName === "devs") {
      return items.map(sanitizeDeveloper).filter(Boolean);
    }

    return items;
  },

  /**
   * Attempts ADC (Application Default Credentials) read testing the specific owner tasks subcollection.
   */
  tryGetAdcToken: async (ownerUid: string): Promise<string | null> => {
    try {
      const res = await fetch(
        "http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token",
        {
          headers: { "Metadata-Flavor": "Google" },
          signal: AbortSignal.timeout(3000)
        }
      );

      if (res.ok) {
        const data: any = await res.json();
        if (data.access_token) {
          // Verify if this ADC token can read the specific owner tasks subcollection
          const projectId = firebaseConfig.projectId;
          const databaseId = firebaseConfig.firestoreDatabaseId || "(default)";
          const validSubcollectionUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents/users/${encodeURIComponent(ownerUid)}/tasks?pageSize=1`;

          const testRes = await fetch(validSubcollectionUrl, {
            headers: { Authorization: `Bearer ${data.access_token}` },
            signal: AbortSignal.timeout(4000)
          });

          if (testRes.ok) {
            return data.access_token;
          }
        }
      }
    } catch {
      // ADC unavailable or unprivileged
    }
    return null;
  },

  /**
   * Main entrypoint for GET /api/powerbi-data:
   * 1. Validates API key (timing-safe).
   * 2. Checks server configuration (POWERBI_OWNER_UID).
   * 3. Selects auth strategy: ADC if privileged, otherwise in-memory active session token.
   * 4. Queries live named Firestore database with pagination & timeouts.
   * 5. Sanitizes fields via strict allowlists and formats response.
   */
  getLivePowerBIData: async (providedKey: string) => {
    // 1. Validate API Key
    const authCheck = PowerBIService.validateApiKey(providedKey);
    if (!authCheck.valid) {
      const err: any = new Error(authCheck.error || "Acesso negado.");
      err.status = authCheck.status || 401;
      throw err;
    }

    // 2. Validate Owner Configuration
    const { ownerUid } = PowerBIService.getConfig();
    if (!ownerUid) {
      const err: any = new Error(
        "Configuração do servidor incompleta. A variável POWERBI_OWNER_UID não foi definida pelo administrador."
      );
      err.status = 503;
      throw err;
    }

    // 3. Determine Auth Token for Firestore REST
    let authToken: string | null = null;
    let mode: "refresh-token-autonomous" | "adc" | "active-session-bridge" = "refresh-token-autonomous";

    const { refreshToken } = PowerBIService.getConfig();

    if (refreshToken) {
      // 3.A. Autonomous Mode (Primary strategy for Vercel Serverless / PRD)
      authToken = await PowerBIService.exchangeRefreshTokenForIdToken(refreshToken, ownerUid);
      mode = "refresh-token-autonomous";
    } else {
      // 3.B. If in production/Vercel, do NOT accept volatile RAM bridge as production fallback
      const isProduction = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
      if (isProduction) {
        const err: any = new Error(
          "Configuração de produção incompleta: para operação autônoma no Vercel (PRD), configure a Secret FIREBASE_REFRESH_TOKEN no servidor."
        );
        err.status = 503;
        err.code = "CONFIG_MISSING_REFRESH_TOKEN";
        throw err;
      }

      // 3.C. QA / Sandbox Fallback: Attempt ADC if available
      const adcToken = await PowerBIService.tryGetAdcToken(ownerUid);
      if (adcToken) {
        authToken = adcToken;
        mode = "adc";
      } else {
        // 3.D. QA Diagnostic: Validate volatile active session in memory
        const now = Math.floor(Date.now() / 1000);
        if (
          !activeSession ||
          activeSession.uid !== ownerUid ||
          typeof activeSession.expiresAt !== "number" ||
          !Number.isFinite(activeSession.expiresAt) ||
          activeSession.expiresAt <= now
        ) {
          const err: any = new Error(
            "Sessão de sincronização com o Power BI não conectada ou expirada. Em ambiente de produção Vercel, configure a Secret FIREBASE_REFRESH_TOKEN para operação autônoma sem necessidade de aba aberta."
          );
          err.status = 503;
          err.code = "POWERBI_SESSION_EXPIRED";
          throw err;
        }
        authToken = activeSession.idToken;
        mode = "active-session-bridge";
      }
    }

    // 4. Live fetch from named Firestore
    const [tasks, devs, robots] = await Promise.all([
      PowerBIService.fetchCollectionLive("tasks", ownerUid, authToken),
      PowerBIService.fetchCollectionLive("devs", ownerUid, authToken),
      PowerBIService.fetchCollectionLive("robots", ownerUid, authToken)
    ]);

    // 5. Structure payload (strict allowlists applied)
    return {
      generatedAt: new Date().toISOString(),
      metadata: {
        app: "Nexus Project",
        version: "2.6.0",
        endpoint: "/api/powerbi-data",
        source: "firestore-live",
        mode,
        databaseId: firebaseConfig.firestoreDatabaseId,
        sourceReadAt: new Date().toISOString()
      },
      schema: {
        tasks: [
          "id",
          "type",
          "summary",
          "status",
          "priority",
          "assignee",
          "requester",
          "startDate",
          "endDate",
          "estimatedTime",
          "actualTime",
          "fteValue",
          "automationName",
          "managementArea",
          "iterationPath",
          "createdAt"
        ],
        robots: [
          "id",
          "name",
          "status",
          "area",
          "developer",
          "folder",
          "fte",
          "ticketNumber"
        ],
        developers: ["id", "name"]
      },
      data: {
        tasks,
        robots,
        developers: devs
      }
    };
  },

  // Test helpers for mocking in automated tests
  __setMockCerts: (certs: Record<string, string> | null) => {
    mockCertsOverride = certs;
  },
  __setMockFirestoreFetch: (fn: ((url: string, init: any) => Promise<any>) | null) => {
    mockFirestoreFetch = fn;
  },
  __setMockRefreshTokenFetch: (fn: ((url: string, init: any) => Promise<any>) | null) => {
    mockRefreshTokenFetch = fn;
  },
  __clearAutonomousTokenCache: () => {
    autonomousTokenCache = null;
  }
};
