export type BatchStatusName =
  | "RECEIVED"
  | "PROCESSING"
  | "COMPLETING"
  | "COMPLETED"
  | "FAILED"
  | "REJECTED"
  | "UNKNOWN";

export interface UploadResponse {
  batchId: string;
  status?: string;
  message?: string;
  declaredRecords?: number;
}

export interface BatchStatus {
  batchId: string;
  status: BatchStatusName;
  declaredTotalRecords?: number;
  successfulRecords?: number;
  rejectedRecords?: number;
  inProcessRecords?: number;
  successfulAmount?: number;
  rejectedAmount?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  message?: string;
}

export interface Receipt {
  batchId: string;
  clientRuc: string;
  companyName: string;
  processedDate: string;
  totalRecords: number;
  successful: number;
  rejected: number;
  totalAmountDispatched: number;
  commissionCharged: number;
  ivaCharged: number;
  totalDebited: number;
  receiptUuid: string;
  generatedAt: string;
}

export interface BatchHistoryItem {
  batchId: string;
  clientRuc?: string;
  serviceType?: string;
  fileName?: string;
  status?: BatchStatusName;
  declaredRecords?: number;
  successfulRecords?: number;
  rejectedRecords?: number;
  inProcessRecords?: number;
  successfulAmount?: number;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  source: "upload" | "lookup";
}
