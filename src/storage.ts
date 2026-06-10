import type { BatchHistoryItem, BatchStatus } from "./types";

const STORAGE_KEY = "banquito.empresas.batches.v1";

export function readHistory(): BatchHistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function upsertHistory(item: BatchHistoryItem) {
  const next = [item, ...readHistory().filter((entry) => entry.batchId !== item.batchId)].slice(0, 25);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function updateHistoryStatus(batchId: string, status: BatchStatus) {
  const next = readHistory().map((entry) =>
    entry.batchId === batchId
      ? {
          ...entry,
          status: status.status,
          declaredRecords: status.declaredTotalRecords ?? entry.declaredRecords,
          successfulRecords: status.successfulRecords,
          rejectedRecords: status.rejectedRecords,
          inProcessRecords: status.inProcessRecords,
          successfulAmount: status.successfulAmount,
          updatedAt: status.updatedAt,
          completedAt: status.completedAt
        }
      : entry
  );
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY);
  return [];
}
