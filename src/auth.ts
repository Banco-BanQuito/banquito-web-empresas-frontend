import { config } from "./config";

const STORAGE_KEY = "banquito.empresas.session.v1";

export interface EmpresaSession {
  customerId: number;
  username: string;
  fullName: string;
  customerType: string;
  mustChangePassword: boolean;
  idToken: string;
  refreshToken: string;
  expiresAt?: number;
}

export function loadSession(): EmpresaSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as EmpresaSession) : null;
  } catch {
    return null;
  }
}

export function saveSession(session: EmpresaSession): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  localStorage.removeItem(STORAGE_KEY);
}

const SIGN_IN_URL = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${config.identityPlatformApiKey}`;
const UPDATE_URL = `https://identitytoolkit.googleapis.com/v1/accounts:update?key=${config.identityPlatformApiKey}`;
const LOOKUP_URL = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${config.identityPlatformApiKey}`;
const REFRESH_URL = `https://securetoken.googleapis.com/v1/token?key=${config.identityPlatformApiKey}`;
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

function toIdentityEmail(ruc: string): string {
  return `${ruc}@banquito.internal`;
}

async function identityFetch(url: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof data === "object" && data && "error" in data
        ? String((data.error as { message?: unknown })?.message ?? "Error de autenticación")
        : "Error de autenticación";
    throw new Error(message);
  }
  return data;
}

export async function loginEmpresa(username: string, password: string): Promise<EmpresaSession> {
  const signInData = await identityFetch(SIGN_IN_URL, {
    email: toIdentityEmail(username),
    password,
    returnSecureToken: true,
  });

  const lookupData = await identityFetch(LOOKUP_URL, { idToken: signInData.idToken });
  const users = lookupData.users as Array<{ createdAt?: string; lastLoginAt?: string }> | undefined;
  const accountInfo = users?.[0];
  const mustChangePassword = accountInfo ? accountInfo.createdAt === accountInfo.lastLoginAt : false;

  const customerResponse = await fetch(`${config.partyApiBaseUrl}/api/v2/customers/${username}`, {
    headers: apiHeaders({ Authorization: `Bearer ${signInData.idToken}` }),
  });
  const customer = await customerResponse.json().catch(() => ({}));
  if (!customerResponse.ok) {
    throw new Error("No se encontró el perfil del cliente asociado a este usuario.");
  }
  if (customer.customerType !== "JURIDICO") {
    throw new Error("Este portal es exclusivo para empresas. Use Banca Web Personas para clientes individuales.");
  }

  return {
    customerId: Number(customer.id),
    username,
    fullName: String(customer.fullName || customer.legalName || username),
    customerType: String(customer.customerType),
    mustChangePassword,
    idToken: String(signInData.idToken),
    refreshToken: String(signInData.refreshToken),
    expiresAt: Date.now() + Number(signInData.expiresIn || 3600) * 1000,
  };
}

export async function getFreshSession(): Promise<EmpresaSession | null> {
  const session = loadSession();
  if (!session?.idToken || !session.refreshToken || !config.identityPlatformApiKey) {
    return session;
  }

  if (session.expiresAt && session.expiresAt - Date.now() > REFRESH_MARGIN_MS) {
    return session;
  }

  const response = await fetch(REFRESH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    }),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    clearSession();
    globalThis.dispatchEvent(new CustomEvent("logout"));
    throw new Error(String(data.error?.message || "Sesion expirada"));
  }

  const refreshed = {
    ...session,
    idToken: String(data.id_token),
    refreshToken: String(data.refresh_token || session.refreshToken),
    expiresAt: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
  saveSession(refreshed);
  return refreshed;
}

export async function changePasswordEmpresa(
  username: string,
  currentPassword: string,
  newPassword: string
): Promise<void> {
  const signInData = await identityFetch(SIGN_IN_URL, {
    email: toIdentityEmail(username),
    password: currentPassword,
    returnSecureToken: true,
  });

  await identityFetch(UPDATE_URL, {
    idToken: signInData.idToken,
    password: newPassword,
    returnSecureToken: true,
  });
}

function apiHeaders(headers: Record<string, string>) {
  return config.apigeeApiKey
    ? { ...headers, "x-api-key": config.apigeeApiKey, apikey: config.apigeeApiKey }
    : headers;
}
