export const config = {
  partyApiBaseUrl: trimTrailingSlash(import.meta.env.VITE_PARTY_API_BASE_URL || "http://localhost:8083"),
  apiBaseUrl: trimTrailingSlash(import.meta.env.VITE_API_BASE_URL || ""),
  uploadPath: import.meta.env.VITE_UPLOAD_PATH || "/api/v2/payments/batches",
  batchStatusPath: import.meta.env.VITE_BATCH_STATUS_PATH || "/api/v2/payments/batches/:batchId/status",
  batchReportPath: import.meta.env.VITE_BATCH_REPORT_PATH || "/api/v2/payments/batches/:batchId/report",
  receiptPath: import.meta.env.VITE_RECEIPT_PATH || "/api/v2/payments/receipts/:batchId",
  maxUploadMb: Number(import.meta.env.VITE_MAX_UPLOAD_MB || 10),
  pollIntervalMs: Number(import.meta.env.VITE_POLL_INTERVAL_MS || 10000),
  serviceTypes: splitCsv(import.meta.env.VITE_SERVICE_TYPES || "NOMINA,PROVEEDORES,INTERBANCARIO"),
  identityPlatformApiKey: import.meta.env.VITE_IDENTITY_PLATFORM_API_KEY || ""
};

function trimTrailingSlash(value: string) {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function splitCsv(value: string) {
  const values = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length ? values : ["NOMINA"];
}

