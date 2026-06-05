import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  Loader2,
  RefreshCw,
  Search,
  Send,
  Trash2,
  UploadCloud,
  XCircle
} from "lucide-react";
import { downloadBatchReport, getBatchStatus, getReceipt, saveBlob, uploadPaymentBatch } from "./api";
import { config } from "./config";
import { clearHistory, readHistory, updateHistoryStatus, upsertHistory } from "./storage";
import type { BatchHistoryItem, BatchStatus, BatchStatusName, Receipt, UploadResponse } from "./types";

const terminalStatuses: BatchStatusName[] = ["COMPLETED", "FAILED", "REJECTED"];

export function App() {
  const [history, setHistory] = useState<BatchHistoryItem[]>(() => readHistory());
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const selectedHistory = useMemo(
    () => history.find((item) => item.batchId === selectedBatchId),
    [history, selectedBatchId]
  );

  useEffect(() => {
    if (!selectedBatchId || !autoRefresh || status?.status === "COMPLETED" || status?.status === "FAILED" || status?.status === "REJECTED") {
      return;
    }
    const interval = window.setInterval(() => {
      void refreshStatus(selectedBatchId, { quiet: true });
    }, config.pollIntervalMs);
    return () => window.clearInterval(interval);
  }, [selectedBatchId, autoRefresh, status?.status]);

  async function handleUploaded(response: UploadResponse, meta: UploadMeta) {
    const next = upsertHistory({
      batchId: response.batchId,
      clientRuc: meta.clientRuc,
      serviceType: meta.serviceType,
      fileName: meta.fileName,
      declaredRecords: response.declaredRecords,
      status: normalize(response.status),
      createdAt: new Date().toISOString(),
      source: "upload"
    });
    setHistory(next);
    setSelectedBatchId(response.batchId);
    setReceipt(null);
    setNotice({ type: "success", message: response.message || "Lote recibido por el Switch." });
    await refreshStatus(response.batchId, { quiet: true });
  }

  async function refreshStatus(batchId = selectedBatchId, options?: { quiet?: boolean }) {
    const value = batchId.trim();
    if (!value) {
      setNotice({ type: "error", message: "Ingresa un batchId valido." });
      return;
    }
    setLoadingStatus(true);
    try {
      const nextStatus = await getBatchStatus(value);
      setStatus(nextStatus);
      setSelectedBatchId(nextStatus.batchId);
      setReceipt(null);

      const existing = readHistory().some((item) => item.batchId === nextStatus.batchId);
      const nextHistory = existing
        ? updateHistoryStatus(nextStatus.batchId, nextStatus)
        : upsertHistory({
            batchId: nextStatus.batchId,
            status: nextStatus.status,
            declaredRecords: nextStatus.declaredTotalRecords,
            successfulRecords: nextStatus.successfulRecords,
            rejectedRecords: nextStatus.rejectedRecords,
            successfulAmount: nextStatus.successfulAmount,
            createdAt: nextStatus.createdAt || new Date().toISOString(),
            updatedAt: nextStatus.updatedAt,
            completedAt: nextStatus.completedAt,
            source: "lookup"
          });
      setHistory(nextHistory);
      if (!options?.quiet) {
        setNotice({ type: "success", message: "Estado actualizado desde routing-service." });
      }
    } catch (error) {
      setStatus(null);
      if (!options?.quiet) {
        setNotice({ type: "error", message: readableError(error) });
      }
    } finally {
      setLoadingStatus(false);
    }
  }

  async function handleDownloadReport() {
    if (!selectedBatchId) {
      return;
    }
    setDownloadingReport(true);
    try {
      const blob = await downloadBatchReport(selectedBatchId);
      saveBlob(blob, `novedades_${selectedBatchId}.csv`);
      setNotice({ type: "success", message: "Reporte de novedades descargado." });
    } catch (error) {
      setNotice({ type: "error", message: readableError(error) });
    } finally {
      setDownloadingReport(false);
    }
  }

  async function handleReceipt() {
    if (!selectedBatchId) {
      return;
    }
    setLoadingReceipt(true);
    try {
      const nextReceipt = await getReceipt(selectedBatchId);
      setReceipt(nextReceipt);
      setNotice({ type: "success", message: "Comprobante generado por report-service." });
    } catch (error) {
      setReceipt(null);
      setNotice({ type: "error", message: readableError(error) });
    } finally {
      setLoadingReceipt(false);
    }
  }

  const canDownload = status?.status === "COMPLETED";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">BanQuito Switch</p>
          <h1>Empresas</h1>
        </div>
        <div className="connection-pill">
          <span>Kong Switch</span>
          <strong>{config.apiBaseUrl}</strong>
        </div>
      </header>

      {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

      <section className="workspace">
        <div className="primary-column">
          <UploadPanel onUploaded={handleUploaded} onNotice={setNotice} />
          <StatusPanel
            batchId={selectedBatchId}
            setBatchId={setSelectedBatchId}
            status={status}
            selectedHistory={selectedHistory}
            loading={loadingStatus}
            autoRefresh={autoRefresh}
            setAutoRefresh={setAutoRefresh}
            onRefresh={() => void refreshStatus()}
          />
          <ReportsPanel
            canDownload={canDownload}
            status={status}
            receipt={receipt}
            downloadingReport={downloadingReport}
            loadingReceipt={loadingReceipt}
            onDownloadReport={() => void handleDownloadReport()}
            onReceipt={() => void handleReceipt()}
          />
        </div>
        <HistoryPanel
          history={history}
          selectedBatchId={selectedBatchId}
          onSelect={(batchId) => {
            setSelectedBatchId(batchId);
            setReceipt(null);
            void refreshStatus(batchId);
          }}
          onClear={() => {
            setHistory(clearHistory());
            setStatus(null);
            setReceipt(null);
            setSelectedBatchId("");
          }}
        />
      </section>
    </main>
  );
}

interface UploadMeta {
  clientRuc: string;
  serviceType: string;
  fileName: string;
}

interface UiNotice {
  type: "success" | "error" | "info";
  message: string;
}

function UploadPanel({
  onUploaded,
  onNotice
}: {
  onUploaded: (response: UploadResponse, meta: UploadMeta) => Promise<void>;
  onNotice: (notice: UiNotice) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [clientRuc, setClientRuc] = useState("");
  const [serviceType, setServiceType] = useState(config.serviceTypes[0]);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    const validation = validateUpload(file, clientRuc);
    if (validation) {
      onNotice({ type: "error", message: validation });
      return;
    }
    setSubmitting(true);
    try {
      const selectedFile = file!;
      const response = await uploadPaymentBatch({ file: selectedFile, clientRuc: clientRuc.trim(), serviceType });
      await onUploaded(response, { clientRuc: clientRuc.trim(), serviceType, fileName: selectedFile.name });
      setFile(null);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    } catch (error) {
      onNotice({ type: "error", message: readableError(error) });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-title">
        <UploadCloud size={20} />
        <h2>Cargar lote</h2>
      </div>
      <div className="form-grid">
        <label>
          <span>RUC empresa</span>
          <input value={clientRuc} onChange={(event) => setClientRuc(onlyDigits(event.target.value).slice(0, 13))} inputMode="numeric" />
        </label>
        <label>
          <span>Servicio</span>
          <select value={serviceType} onChange={(event) => setServiceType(event.target.value)}>
            {config.serviceTypes.map((type) => (
              <option key={type} value={type}>
                {type}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="file-row">
        <button type="button" className="icon-button secondary" onClick={() => inputRef.current?.click()} aria-label="Seleccionar archivo">
          <FileText size={18} />
          <span>{file ? file.name : "Seleccionar CSV/TXT"}</span>
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.txt,text/csv,text/plain"
          onChange={(event) => setFile(event.target.files?.[0] || null)}
        />
        {file && <span className="file-size">{formatBytes(file.size)}</span>}
      </div>
      <div className="actions">
        <button type="button" className="primary-action" onClick={() => void submit()} disabled={submitting}>
          {submitting ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          <span>Procesar nomina</span>
        </button>
      </div>
    </section>
  );
}

function StatusPanel(props: {
  batchId: string;
  setBatchId: (value: string) => void;
  status: BatchStatus | null;
  selectedHistory?: BatchHistoryItem;
  loading: boolean;
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
  onRefresh: () => void;
}) {
  const displayedStatus = props.status?.status || props.selectedHistory?.status || "UNKNOWN";
  const declaredRecords = props.status?.declaredTotalRecords ?? props.selectedHistory?.declaredRecords;
  const successfulRecords = props.status?.successfulRecords ?? props.selectedHistory?.successfulRecords;
  const rejectedRecords = props.status?.rejectedRecords ?? props.selectedHistory?.rejectedRecords;
  const inProcessRecords =
    props.status?.inProcessRecords ??
    props.selectedHistory?.inProcessRecords ??
    inferInProcess(declaredRecords, successfulRecords, rejectedRecords);
  return (
    <section className="panel">
      <div className="panel-title">
        <Clock3 size={20} />
        <h2>Seguimiento</h2>
      </div>
      <div className="lookup-row">
        <label>
          <span>Batch ID</span>
          <input value={props.batchId} onChange={(event) => props.setBatchId(event.target.value.trim())} />
        </label>
        <button type="button" className="icon-only" onClick={props.onRefresh} disabled={props.loading} aria-label="Consultar estado">
          {props.loading ? <Loader2 className="spin" size={20} /> : <Search size={20} />}
        </button>
      </div>
      <div className="status-strip">
        <StatusBadge status={displayedStatus} />
        <label className="toggle">
          <input type="checkbox" checked={props.autoRefresh} onChange={(event) => props.setAutoRefresh(event.target.checked)} />
          <span>Auto</span>
        </label>
        <button type="button" className="ghost-button" onClick={props.onRefresh} disabled={props.loading}>
          <RefreshCw size={16} />
          <span>Actualizar</span>
        </button>
      </div>
      <ProgressBar total={declaredRecords} successful={successfulRecords} rejected={rejectedRecords} inProcess={inProcessRecords} />
      <div className="metrics-grid">
        <Metric label="Declaradas" value={numberText(declaredRecords)} />
        <Metric label="Exitosas" value={numberText(successfulRecords)} tone="good" />
        <Metric label="Rechazadas" value={numberText(rejectedRecords)} tone="bad" />
        <Metric label="En proceso" value={numberText(inProcessRecords)} />
        <Metric label="Monto exitoso" value={moneyText(props.status?.successfulAmount ?? props.selectedHistory?.successfulAmount)} />
      </div>
    </section>
  );
}

function ProgressBar(props: { total?: number; successful?: number; rejected?: number; inProcess?: number }) {
  const total = props.total && props.total > 0 ? props.total : 0;
  const successful = total ? percent(props.successful, total) : 0;
  const rejected = total ? percent(props.rejected, total) : 0;
  const inProcess = total
    ? typeof props.inProcess === "number"
      ? percent(props.inProcess, total)
      : Math.max(0, 100 - successful - rejected)
    : 0;

  return (
    <div className="progress-block" aria-label="Progreso del lote">
      <div className="progress-track">
        <span className="progress-segment success" style={{ width: `${successful}%` }} />
        <span className="progress-segment rejected" style={{ width: `${rejected}%` }} />
        <span className="progress-segment processing" style={{ width: `${inProcess}%` }} />
      </div>
      <div className="progress-legend">
        <span>Exitosas {Math.round(successful)}%</span>
        <span>Rechazadas {Math.round(rejected)}%</span>
        <span>En proceso {Math.round(inProcess)}%</span>
      </div>
    </div>
  );
}

function ReportsPanel(props: {
  canDownload: boolean;
  status: BatchStatus | null;
  receipt: Receipt | null;
  downloadingReport: boolean;
  loadingReceipt: boolean;
  onDownloadReport: () => void;
  onReceipt: () => void;
}) {
  return (
    <section className="panel">
      <div className="panel-title">
        <FileCheck2 size={20} />
        <h2>Reportes</h2>
      </div>
      <div className="download-row">
        <button type="button" className="primary-action" onClick={props.onDownloadReport} disabled={!props.canDownload || props.downloadingReport}>
          {props.downloadingReport ? <Loader2 className="spin" size={18} /> : <Download size={18} />}
          <span>Novedades CSV</span>
        </button>
        <button type="button" className="secondary-action" onClick={props.onReceipt} disabled={!props.canDownload || props.loadingReceipt}>
          {props.loadingReceipt ? <Loader2 className="spin" size={18} /> : <FileText size={18} />}
          <span>Comprobante</span>
        </button>
      </div>
      {props.receipt && (
        <div className="receipt-box">
          <div>
            <span>Total debitado</span>
            <strong>{moneyText(props.receipt.totalDebited)}</strong>
          </div>
          <div>
            <span>Dispersado</span>
            <strong>{moneyText(props.receipt.totalAmountDispatched)}</strong>
          </div>
          <div>
            <span>Comision</span>
            <strong>{moneyText(props.receipt.commissionCharged)}</strong>
          </div>
          <div>
            <span>IVA</span>
            <strong>{moneyText(props.receipt.ivaCharged)}</strong>
          </div>
          <small>{props.receipt.receiptUuid}</small>
        </div>
      )}
    </section>
  );
}

function HistoryPanel(props: {
  history: BatchHistoryItem[];
  selectedBatchId: string;
  onSelect: (batchId: string) => void;
  onClear: () => void;
}) {
  return (
    <aside className="history-panel">
      <div className="history-header">
        <h2>Historial</h2>
        <button type="button" className="icon-only subtle" onClick={props.onClear} aria-label="Limpiar historial" disabled={props.history.length === 0}>
          <Trash2 size={18} />
        </button>
      </div>
      <div className="history-list">
        {props.history.length === 0 && <p className="empty-state">Sin lotes registrados.</p>}
        {props.history.map((item) => (
          <button
            type="button"
            className={`history-item ${item.batchId === props.selectedBatchId ? "active" : ""}`}
            key={item.batchId}
            onClick={() => props.onSelect(item.batchId)}
          >
            <span className="history-main">{item.batchId}</span>
            <span className="history-meta">
              {item.fileName || item.clientRuc || "Consulta"} - {item.status || "UNKNOWN"}
            </span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function Notice({ notice, onClose }: { notice: UiNotice; onClose: () => void }) {
  const Icon = notice.type === "success" ? CheckCircle2 : notice.type === "error" ? AlertCircle : Clock3;
  return (
    <div className={`notice ${notice.type}`}>
      <Icon size={18} />
      <span>{notice.message}</span>
      <button type="button" onClick={onClose} aria-label="Cerrar aviso">
        <XCircle size={18} />
      </button>
    </div>
  );
}

function StatusBadge({ status }: { status: BatchStatusName }) {
  const Icon = status === "COMPLETED" ? CheckCircle2 : status === "FAILED" || status === "REJECTED" ? XCircle : Clock3;
  return (
    <span className={`status-badge ${status.toLowerCase()}`}>
      <Icon size={16} />
      {status}
    </span>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "good" | "bad" }) {
  return (
    <div className={`metric ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function validateUpload(file: File | null, clientRuc: string) {
  if (!/^\d{10,13}$/.test(clientRuc.trim())) {
    return "El RUC debe tener entre 10 y 13 digitos.";
  }
  if (!file) {
    return "Selecciona un archivo CSV o TXT.";
  }
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension !== "csv" && extension !== "txt") {
    return "Solo se permiten archivos CSV o TXT.";
  }
  const maxBytes = config.maxUploadMb * 1024 * 1024;
  if (file.size > maxBytes) {
    return `El archivo supera ${config.maxUploadMb} MB.`;
  }
  return "";
}

function readableError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Error temporal, intente en unos minutos.";
}

function normalize(status?: string): BatchStatusName {
  const value = status?.toUpperCase();
  return terminalStatuses.includes(value as BatchStatusName) || value === "RECEIVED" || value === "PROCESSING" || value === "COMPLETING"
    ? (value as BatchStatusName)
    : "UNKNOWN";
}

function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

function numberText(value?: number) {
  return typeof value === "number" ? new Intl.NumberFormat("es-EC").format(value) : "-";
}

function inferInProcess(total?: number, successful?: number, rejected?: number) {
  if (typeof total !== "number") {
    return undefined;
  }
  return Math.max(total - (successful || 0) - (rejected || 0), 0);
}

function percent(value: number | undefined, total: number) {
  if (!total || typeof value !== "number") {
    return 0;
  }
  return Math.max(0, Math.min(100, (value / total) * 100));
}

function moneyText(value?: number) {
  return typeof value === "number"
    ? new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value)
    : "-";
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
