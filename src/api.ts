import { config } from "./config";
import type { BatchStatus, Receipt, UploadResponse } from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown
  ) {
    super(message);
  }
}

export async function uploadPaymentBatch(payload: {
  file: File;
  serviceType: string;
  clientRuc: string;
  signal?: AbortSignal;
}): Promise<UploadResponse> {
  const form = new FormData();
  form.append("file", payload.file);
  form.append("serviceType", payload.serviceType);
  form.append("clientRuc", payload.clientRuc);

  const response = await fetch(url(config.uploadPath), {
    method: "POST",
    body: form,
    signal: payload.signal
  });

  const body = await parseJson(response);
  if (!response.ok) {
    throw toApiError(response, body, "No se pudo enviar el archivo.");
  }

  const batchId = firstText(body, ["batchId", "batch_id", "paymentBatchId", "payment_batch_id", "id"]);
  if (!batchId) {
    throw new ApiError("La respuesta no incluyo batchId.", response.status, body);
  }

  return {
    batchId,
    status: firstText(body, ["status"]),
    message: firstText(body, ["message"]),
    declaredRecords: firstNumber(body, ["declaredRecords", "declared_records", "declaredTotalRecords"])
  };
}

export async function getBatchStatus(batchId: string, signal?: AbortSignal): Promise<BatchStatus> {
  const response = await fetch(url(config.batchStatusPath, batchId), { signal });
  const body = await parseJson(response);
  if (!response.ok) {
    if (response.status === 404) {
      return {
        batchId,
        status: "PROCESSING",
        declaredTotalRecords: 0,
        successfulRecords: 0,
        rejectedRecords: 0,
        inProcessRecords: 0,
        successfulAmount: 0,
        rejectedAmount: 0,
        message: "Inicializando procesamiento..."
      };
    }
    throw toApiError(response, body, "No se encontro el lote.");
  }

  return {
    batchId: firstText(body, ["batchId", "batch_id"]) || batchId,
    status: normalizeStatus(firstText(body, ["status"])),
    declaredTotalRecords: firstNumber(body, ["declaredTotalRecords", "declared_total_records", "total", "totalRecords"]),
    successfulRecords: firstNumber(body, ["successfulRecords", "successful_records", "successful", "exitosas"]),
    rejectedRecords: firstNumber(body, ["rejectedRecords", "rejected_records", "rejected", "rechazadas"]),
    inProcessRecords: firstNumber(body, ["inProcessRecords", "in_process_records", "processingRecords", "processing_records", "inProcess", "enProceso", "en_proceso"]),
    successfulAmount: firstNumber(body, ["successfulAmount", "successful_amount"]),
    rejectedAmount: firstNumber(body, ["rejectedAmount", "rejected_amount"]),
    createdAt: firstText(body, ["createdAt", "created_at"]),
    updatedAt: firstText(body, ["updatedAt", "updated_at"]),
    completedAt: firstText(body, ["completedAt", "completed_at"]),
    message: firstText(body, ["message"])
  };
}

export async function downloadBatchReport(batchId: string) {
  const response = await fetch(url(config.batchReportPath, batchId));
  if (!response.ok) {
    throw toApiError(response, await parseJson(response), "No se pudo descargar el reporte.");
  }
  return response.blob();
}

export async function getReceipt(batchId: string): Promise<Receipt> {
  const response = await fetch(url(config.receiptPath, batchId));
  const body = await parseJson(response);
  if (!response.ok) {
    throw toApiError(response, body, "No se pudo generar el comprobante.");
  }
  return body as Receipt;
}

export async function downloadReceiptPdf(batchId: string) {
  const response = await fetch(url(config.receiptPath, batchId) + "/pdf");
  if (!response.ok) {
    throw toApiError(response, await parseJson(response), "No se pudo descargar el PDF.");
  }
  return response.blob();
}

export function saveBlob(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = href;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(href);
  }, 500);
}

function url(path: string, batchId?: string) {
  const resolved = batchId ? path.replace(":batchId", encodeURIComponent(batchId)) : path;
  return `${config.apiBaseUrl}${resolved.startsWith("/") ? resolved : `/${resolved}`}`;
}

async function parseJson(response: Response) {
  const text = await response.text();
  if (!text) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function toApiError(response: Response, body: unknown, fallback: string) {
  const message = typeof body === "object" && body ? ("message" in body ? String((body as any).message) : "error" in body ? String((body as any).error) : fallback) : fallback;
  return new ApiError(message, response.status, body);
}

function firstText(body: unknown, keys: string[]) {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return undefined;
}

function firstNumber(body: unknown, keys: string[]) {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "number") {
      return value;
    }
    if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}

function normalizeStatus(status?: string): BatchStatus["status"] {
  const value = status?.toUpperCase().trim();
  if (!value) {
    return "UNKNOWN";
  }
  if (value === "RECIBIDO" || value === "PENDIENTE") {
    return "RECEIVED";
  }
  if (value === "EN_PROCESO" || value === "PROCESANDO") {
    return "PROCESSING";
  }
  if (value === "COMPLETANDO") {
    return "COMPLETING";
  }
  if (value === "COMPLETADO" || value === "FINALIZADO") {
    return "COMPLETED";
  }
  if (value === "COMPLETED_WITH_ISSUES" || value === "COMPLETED_WITH_NOVEDADES" || value === "EXITOSO_CON_NOVEDAD") {
    return "COMPLETED_WITH_ISSUES";
  }
  if (value === "FALLIDO" || value === "ERROR") {
    return "FAILED";
  }
  if (value === "RECHAZADO" || value === "RECHAZADA") {
    return "REJECTED";
  }
  if (value === "RECEIVED" || value === "PROCESSING" || value === "COMPLETING" || value === "COMPLETED" || value === "COMPLETED_WITH_ISSUES" || value === "FAILED" || value === "REJECTED") {
    return value as BatchStatus["status"];
  }
  return "UNKNOWN";
}

export interface Account {
  accountId: number;
  accountNumber: string;
  customerId: number;
  status: string;
  availableBalance: number;
  accountingBalance: number;
  currency: string;
  branchId: number;
}

export async function getAccounts(customerId: number, signal?: AbortSignal): Promise<Account[]> {
  const response = await fetch(`/api/v2/accounts/customer/${customerId}`, { signal });
  if (!response.ok) {
    throw new Error("No se pudieron cargar las cuentas");
  }
  return await response.json();
}
