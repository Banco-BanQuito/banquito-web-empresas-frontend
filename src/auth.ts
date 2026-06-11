import { config } from "./config";

const STORAGE_KEY = "banquito.empresas.session.v1";

export interface EmpresaSession {
  customerId: number;
  username: string;
  fullName: string;
  customerType: string;
  mustChangePassword: boolean;
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

export async function loginEmpresa(username: string, password: string): Promise<EmpresaSession> {
  const response = await fetch(`${config.partyApiBaseUrl}/api/v2/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? String((body as { message: unknown }).message)
        : "Credenciales incorrectas.";
    throw new Error(message);
  }

  if (body.customerType !== "JURIDICO") {
    throw new Error("Este portal es exclusivo para empresas. Use Banca Web Personas para clientes individuales.");
  }

  return {
    customerId: body.customerId,
    username: body.username,
    fullName: body.fullName,
    customerType: body.customerType,
    mustChangePassword: body.mustChangePassword ?? false,
  };
}
