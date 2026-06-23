import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowLeftRight,
  ArrowUpCircle,
  ArrowUpRight,
  Banknote,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  FileCheck2,
  FileText,
  Gauge,
  Landmark,
  LayoutDashboard,
  Loader2,
  LockKeyhole,
  LogOut,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  UploadCloud,
  WalletCards,
  XCircle
} from "lucide-react";
import {
  downloadBatchReport,
  getBatchStatus,
  getReceipt,
  downloadReceiptPdf,
  saveBlob,
  uploadPaymentBatch,
  getAccounts,
  getAccountTransactions,
  type Account,
  type AccountTransaction
} from "./api";
import { clearSession, EmpresaSession, loadSession, loginEmpresa, saveSession, changePasswordEmpresa } from "./auth";
import { config } from "./config";
import { clearHistory, readHistory, updateHistoryStatus, upsertHistory } from "./storage";
import type { BatchHistoryItem, BatchStatus, BatchStatusName, Receipt, UploadResponse } from "./types";

const terminalStatuses = new Set<BatchStatusName>(["COMPLETED", "COMPLETED_WITH_ISSUES", "FAILED", "REJECTED"]);
const templateRows = [
  "1750285577001,NOMINA,2026-06-18T12:10:00,0040000001,2,30.00",
  "1,001,1234567890001,NOMBRE BENEFICIARIO 1,2200000002,15.00,Pago de Nomina,beneficiario1@correo.com",
  "2,001,1700000001,NOMBRE BENEFICIARIO 2,3300000003,15.00,Pago de Nomina,beneficiario2@correo.com",
  "SEC-PLANTILLA,2,30.00"
];
type AppView = "overview" | "payments" | "reports" | "accounts" | "movements" | "template";

const viewMeta: Record<AppView, { eyebrow: string; title: string }> = {
  overview: { eyebrow: "Banca empresarial", title: "Centro de control corporativo" },
  payments: { eyebrow: "Pagos masivos", title: "Carga y seguimiento de lotes" },
  reports: { eyebrow: "Reporteria", title: "Novedades y comprobantes" },
  accounts: { eyebrow: "Finanzas", title: "Cuentas y saldos" },
  movements: { eyebrow: "Finanzas", title: "Movimientos de cuenta" },
  template: { eyebrow: "Pagos masivos", title: "Formato de carga" }
};

export function App() {
  const [session, setSession] = useState<EmpresaSession | null>(() => loadSession());

  function handleLogin(s: EmpresaSession) {
    saveSession(s);
    setSession(s);
  }

  function handleLogout() {
    clearSession();
    setSession(null);
  }

  if (!session) {
    return <LoginPage onLogin={handleLogin} />;
  }

  if (session.mustChangePassword) {
    return (
      <ForceChangePasswordPage
        session={session}
        onPasswordChanged={() => handleLogin({ ...session, mustChangePassword: false })}
        onLogout={handleLogout}
      />
    );
  }

  return <Dashboard session={session} onLogout={handleLogout} />;
}

function Dashboard({ session, onLogout }: Readonly<{ session: EmpresaSession; onLogout: () => void }>) {
  const [activeView, setActiveView] = useState<AppView>("overview");
  const [history, setHistory] = useState<BatchHistoryItem[]>(() => readHistory());
  const [selectedBatchId, setSelectedBatchId] = useState("");
  const [status, setStatus] = useState<BatchStatus | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [notice, setNotice] = useState<UiNotice | null>(null);
  const [loadingStatus, setLoadingStatus] = useState(false);
  const [downloadingReport, setDownloadingReport] = useState(false);
  const [loadingReceipt, setLoadingReceipt] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [confirmingLogout, setConfirmingLogout] = useState(false);

  const selectedHistory = useMemo(
    () => history.find((item) => item.batchId === selectedBatchId),
    [history, selectedBatchId]
  );

  const dashboardStats = useMemo(() => buildDashboardStats(history, status), [history, status]);

  useEffect(() => {
    if (!selectedBatchId || !autoRefresh || terminalStatuses.has(status?.status || "UNKNOWN")) {
      return;
    }
    const interval = globalThis.setInterval(() => {
      void refreshStatus(selectedBatchId, { quiet: true });
    }, config.pollIntervalMs);
    return () => globalThis.clearInterval(interval);
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
        setNotice({ type: "success", message: "Estado del lote actualizado exitosamente." });
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

  const canDownload = status?.status === "COMPLETED" || status?.status === "COMPLETED_WITH_ISSUES" || status?.status === "FAILED";

  return (
    <main className="bank-shell">
      <Sidebar activeView={activeView} onNavigate={setActiveView} session={session} onLogout={onLogout} />
      <section className="bank-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">{viewMeta[activeView].eyebrow}</p>
            <h1>{viewMeta[activeView].title}</h1>
          </div>
          <div className="topbar-actions">
            <div className="connection-pill" style={{ opacity: 0 }}>
            </div>
            <button type="button" className="icon-only quiet" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={() => setConfirmingLogout(true)}>
              <LockKeyhole size={19} />
            </button>
          </div>
        </header>

        {confirmingLogout && (
          <ConfirmLogoutModal onCancel={() => setConfirmingLogout(false)} onConfirm={onLogout} />
        )}

        {notice && <Notice notice={notice} onClose={() => setNotice(null)} />}

        {activeView === "overview" && (
          <>
            <DashboardStrip stats={dashboardStats} />
            <section className="overview-grid">
              <OperationsPanel onNavigate={setActiveView} />
              <HistoryPanel
                history={history}
                selectedBatchId={selectedBatchId}
                onSelect={(batchId) => {
                  setSelectedBatchId(batchId);
                  setReceipt(null);
                  setActiveView("payments");
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
          </>
        )}

        {activeView === "payments" && (
          <section className="workspace">
            <div className="primary-column">
              <UploadPanel onUploaded={handleUploaded} onNotice={setNotice} session={session} />
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
        )}

        {activeView === "reports" && (
          <section className="workspace reports-workspace">
            <div className="primary-column">
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
        )}

        {activeView === "accounts" && <AccountsPanel customerId={session.customerId} />}

        {activeView === "movements" && <MovementsPanel customerId={session.customerId} />}

        {activeView === "template" && <TemplatePanel />}
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

function downloadTemplateCsv() {
  const blob = new Blob([templateRows.join("\r\n") + "\r\n"], { type: "text/csv" });
  saveBlob(blob, "plantilla_carga_masiva_banquito.csv");
}

function Sidebar({
  activeView,
  onNavigate,
  session,
  onLogout,
}: Readonly<{
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  session: EmpresaSession;
  onLogout: () => void;
}>) {
  const items = [
    { label: "Resumen", icon: LayoutDashboard, view: "overview" },
    { label: "Cuentas", icon: Banknote, view: "accounts" },
    { label: "Movimientos", icon: ArrowLeftRight, view: "movements" },
    { label: "Pagos masivos", icon: WalletCards, view: "payments" },
    { label: "Formato de carga", icon: Download, view: "template" },
    { label: "Reportes", icon: FileText, view: "reports" }
  ] as const;

  return (
    <aside className="sidebar">
      <div className="brand-lockup">
        <div className="brand-mark">
          <Landmark size={24} />
        </div>
        <div>
          <strong>BanQuito</strong>
          <span>Corporate Banking</span>
        </div>
      </div>
      <nav className="side-nav" aria-label="Menu principal">
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button type="button" className={activeView === item.view ? "active" : ""} key={item.label} onClick={() => onNavigate(item.view)}>
              <Icon size={18} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="sidebar-user">
        <Building2 size={16} />
        <span>{session.fullName}</span>
      </div>
    </aside>
  );
}

function DashboardStrip({ stats }: Readonly<{ stats: ReturnType<typeof buildDashboardStats> }>) {
  return (
    <section className="executive-strip" aria-label="Resumen ejecutivo">
      <div className="executive-card primary">
        <div className="executive-copy">
          <span>Cuenta corporativa</span>
          <strong>BanQuito Empresas</strong>
          <small>Pagos, reportes y comprobantes en una sola consola.</small>
        </div>
        <div className="executive-amount">{moneyText(stats.amount)}</div>
      </div>
      <StatCard icon={FileCheck2} label="Lotes registrados" value={numberText(stats.batches)} />
      <StatCard icon={CheckCircle2} label="Procesados" value={numberText(stats.completed)} tone="good" />
      <StatCard icon={Gauge} label="En seguimiento" value={numberText(stats.inFlight)} />
    </section>
  );
}

function OperationsPanel({ onNavigate }: Readonly<{ onNavigate: (view: AppView) => void }>) {
  return (
    <section className="panel operations-panel">
      <div className="panel-title">
        <span className="title-icon">
          <Building2 size={20} />
        </span>
        <div>
          <h2>Operaciones disponibles</h2>
          <p>Gestiona los pagos masivos de tu empresa.</p>
        </div>
      </div>
      <div className="operation-list">
        <button type="button" onClick={() => onNavigate("payments")}>
          <WalletCards size={20} />
          <span>
            <strong>Cargar pagos masivos</strong>
            <small>Sube tu archivo de pagos para procesamiento.</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
        <button type="button" onClick={() => onNavigate("payments")}>
          <Clock3 size={20} />
          <span>
            <strong>Consultar lote</strong>
            <small>Consulta el estado de tus pagos enviados.</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
        <button type="button" onClick={() => onNavigate("reports")}>
          <FileCheck2 size={20} />
          <span>
            <strong>Descargar novedades</strong>
            <small>Reportes y comprobantes desde report-service.</small>
          </span>
          <ArrowUpRight size={18} />
        </button>
      </div>
    </section>
  );
}

function AccountsPanel({ customerId }: Readonly<{ customerId: number }>) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    getAccounts(customerId)
      .then(setAccounts)
      .catch((err) => setError(err instanceof Error ? err.message : "Error al cargar cuentas"))
      .finally(() => setLoading(false));
  }, [customerId]);

  return (
    <section className="integration-grid">
      <div className="panel integration-card" style={{ width: "100%", gridColumn: "1 / -1" }}>
        <div className="panel-title">
          <span className="title-icon">
            <Banknote size={20} />
          </span>
          <div>
            <h2>Tus cuentas empresariales</h2>
            <p>Consulta tus saldos disponibles y el estado de tus cuentas.</p>
          </div>
        </div>
        {loading && <div style={{ padding: "2rem", textAlign: "center" }}><Loader2 className="spin" size={24} style={{ margin: "auto" }}/></div>}
        {error && <div className="login-error"><AlertCircle size={16}/><span>{error}</span></div>}
        {!loading && !error && (
          <div className="endpoint-list" style={{ marginTop: "1rem" }}>
            {accounts.map(acc => (
              <div className="endpoint-row" key={acc.accountId} style={{ display: "flex", justifyContent: "space-between", padding: "1.5rem" }}>
                <div>
                  <strong>Cuenta Empresarial</strong>
                  <div style={{ color: "var(--fg-muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>{acc.accountNumber}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong style={{ fontSize: "1.1rem" }}>{new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(acc.availableBalance)}</strong>
                  <div style={{ color: "var(--fg-muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                    Estado: <span style={{ color: acc.status === "ACTIVA" ? "var(--good)" : "inherit" }}>{acc.status}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

const MOVEMENTS_PAGE_SIZE = 10;

function MovementsPanel({ customerId }: Readonly<{ customerId: number }>) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [transactions, setTransactions] = useState<AccountTransaction[]>([]);
  const [totalElements, setTotalElements] = useState(0);
  const [page, setPage] = useState(0);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingTx, setLoadingTx] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    getAccounts(customerId)
      .then((list) => {
        setAccounts(list);
        if (list.length > 0) {
          setSelectedAccountId(String(list[0].accountId));
        }
      })
      .catch(() => setError("No se pudieron cargar las cuentas."))
      .finally(() => setLoadingAccounts(false));
  }, [customerId]);

  useEffect(() => {
    if (!selectedAccountId) {
      return;
    }
    setLoadingTx(true);
    setError("");
    getAccountTransactions(Number(selectedAccountId), page, MOVEMENTS_PAGE_SIZE)
      .then((result) => {
        setTransactions(result.content || []);
        setTotalElements(result.totalElements || 0);
      })
      .catch(() => setError("No se pudieron cargar los movimientos."))
      .finally(() => setLoadingTx(false));
  }, [selectedAccountId, page]);

  const totalPages = Math.ceil(totalElements / MOVEMENTS_PAGE_SIZE);
  const selectedAccount = accounts.find((acc) => String(acc.accountId) === selectedAccountId);

  function refresh() {
    if (!selectedAccountId) {
      return;
    }
    setLoadingTx(true);
    setError("");
    getAccountTransactions(Number(selectedAccountId), page, MOVEMENTS_PAGE_SIZE)
      .then((result) => {
        setTransactions(result.content || []);
        setTotalElements(result.totalElements || 0);
      })
      .catch(() => setError("No se pudieron cargar los movimientos."))
      .finally(() => setLoadingTx(false));
  }

  return (
    <section className="integration-grid">
      <div className="panel integration-card" style={{ width: "100%", gridColumn: "1 / -1" }}>
        <div className="panel-title split">
          <span className="title-icon">
            <ArrowLeftRight size={20} />
          </span>
          <div>
            <h2>Movimientos de cuenta</h2>
            <p>Analiza las transacciones de una cuenta empresarial.</p>
          </div>
        </div>

        {loadingAccounts && (
          <div style={{ padding: "2rem", textAlign: "center" }}>
            <Loader2 className="spin" size={24} style={{ margin: "auto" }} />
          </div>
        )}

        {!loadingAccounts && accounts.length === 0 && !error && (
          <div className="empty-card">
            <Banknote size={22} />
            <span>No tienes cuentas asociadas.</span>
          </div>
        )}

        {!loadingAccounts && accounts.length > 0 && (
          <div className="form-grid" style={{ marginTop: "1rem" }}>
            <label>
              <span>Cuenta</span>
              <select
                value={selectedAccountId}
                onChange={(event) => {
                  setSelectedAccountId(event.target.value);
                  setPage(0);
                  setTransactions([]);
                }}
              >
                {accounts.map((acc) => (
                  <option key={acc.accountId} value={acc.accountId}>
                    {acc.accountNumber} — {acc.status} — {moneyText(acc.availableBalance)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {selectedAccount && (
          <div className="metrics-grid" style={{ marginTop: "1rem" }}>
            <Metric label="Saldo disponible" value={moneyText(selectedAccount.availableBalance)} />
            <Metric label="Saldo contable" value={moneyText(selectedAccount.accountingBalance)} />
          </div>
        )}

        {error && (
          <div className="login-error" style={{ marginTop: "1rem" }}>
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {selectedAccountId && (
          <>
            <div className="history-header" style={{ marginTop: "1.5rem" }}>
              <div>
                <h2 style={{ fontSize: "1rem" }}>Transacciones</h2>
                <p>{totalElements > 0 ? `${totalElements} en total` : "Historial de movimientos"}</p>
              </div>
              <button type="button" className="icon-only subtle" onClick={refresh} disabled={loadingTx} aria-label="Actualizar movimientos">
                <RefreshCw size={18} className={loadingTx ? "spin" : ""} />
              </button>
            </div>

            {loadingTx && (
              <div style={{ padding: "2rem", textAlign: "center" }}>
                <Loader2 className="spin" size={24} style={{ margin: "auto" }} />
              </div>
            )}

            {!loadingTx && transactions.length === 0 && !error && (
              <div className="empty-card">
                <ArrowLeftRight size={22} />
                <span>No hay movimientos registrados para esta cuenta.</span>
              </div>
            )}

            {!loadingTx && transactions.length > 0 && (
              <div className="endpoint-list" style={{ marginTop: "0.5rem" }}>
                {transactions.map((tx) => {
                  const isDebit = tx.movementType === "DEBITO";
                  return (
                    <div className="endpoint-row" key={tx.transactionUuid} style={{ display: "flex", alignItems: "center", gap: "1rem", padding: "1.25rem" }}>
                      {isDebit ? (
                        <ArrowUpCircle size={22} style={{ color: "var(--bad, #dc2626)" }} />
                      ) : (
                        <ArrowDownCircle size={22} style={{ color: "var(--good)" }} />
                      )}
                      <div style={{ flex: 1 }}>
                        <strong>{tx.description || "Sin descripcion"}</strong>
                        <div style={{ color: "var(--fg-muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          {formatDateTime(tx.transactionDate)}
                        </div>
                      </div>
                      <div style={{ textAlign: "right" }}>
                        <strong style={{ color: isDebit ? "var(--bad, #dc2626)" : "var(--good)" }}>
                          {isDebit ? "-" : "+"}
                          {moneyText(tx.amount)}
                        </strong>
                        <div style={{ color: "var(--fg-muted)", fontSize: "0.85rem", marginTop: "0.25rem" }}>
                          Saldo: {moneyText(tx.resultingBalance)}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {totalPages > 1 && (
              <div className="status-actions" style={{ justifyContent: "space-between" }}>
                <span style={{ color: "var(--fg-muted)", fontSize: "0.85rem" }}>
                  Pagina {page + 1} de {totalPages}
                </span>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button type="button" className="icon-only subtle" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0 || loadingTx} aria-label="Pagina anterior">
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    type="button"
                    className="icon-only subtle"
                    onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={page >= totalPages - 1 || loadingTx}
                    aria-label="Pagina siguiente"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function UploadPanel({
  onUploaded,
  onNotice,
  session
}: Readonly<{
  onUploaded: (response: UploadResponse, meta: UploadMeta) => Promise<void>;
  onNotice: (notice: UiNotice) => void;
  session: EmpresaSession;
}>) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [clientRuc, setClientRuc] = useState(session.username);
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
    <section className="panel upload-panel">
      <div className="panel-title">
        <span className="title-icon">
          <UploadCloud size={20} />
        </span>
        <div>
          <h2>Cargar lote de pagos</h2>
          <p>Sube tu archivo CSV para procesar nóminas o pagos a proveedores.</p>
        </div>
      </div>

      <div className="form-grid">
        <label>
          <span>RUC empresa</span>
          <input
            value={clientRuc}
            onChange={(event) => setClientRuc(onlyDigits(event.target.value).slice(0, 13))}
            inputMode="numeric"
            placeholder="1790012345001"
            disabled
          />
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

      <button type="button" className={`dropzone ${file ? "loaded" : ""}`} onClick={() => inputRef.current?.click()}>
        <span className="dropzone-icon">
          <FileText size={24} />
        </span>
        <span>
          <strong>{file ? file.name : "Seleccionar archivo CSV/TXT"}</strong>
          <small>{file ? formatBytes(file.size) : `Maximo ${config.maxUploadMb} MB por lote`}</small>
        </span>
        <ArrowUpRight size={19} />
      </button>
      <input ref={inputRef} type="file" accept=".csv,.txt,text/csv,text/plain" onChange={(event) => setFile(event.target.files?.[0] || null)} />

      <div className="actions">
        <button type="button" className="primary-action" onClick={() => void submit()} disabled={submitting}>
          {submitting ? <Loader2 className="spin" size={18} /> : <Send size={18} />}
          <span>Enviar a procesamiento</span>
        </button>
        <div className="process-note">
          <ShieldCheck size={16} />
          <span>Validacion, enrutamiento y trazabilidad por batch.</span>
        </div>
      </div>
    </section>
  );
}

function StatusPanel(props: Readonly<{
  batchId: string;
  setBatchId: (value: string) => void;
  status: BatchStatus | null;
  selectedHistory?: BatchHistoryItem;
  loading: boolean;
  autoRefresh: boolean;
  setAutoRefresh: (value: boolean) => void;
  onRefresh: () => void;
}>) {
  const displayedStatus = props.status?.status || props.selectedHistory?.status || "UNKNOWN";
  const declaredRecords = props.status?.declaredTotalRecords ?? props.selectedHistory?.declaredRecords;
  const successfulRecords = props.status?.successfulRecords ?? props.selectedHistory?.successfulRecords;
  const rejectedRecords = props.status?.rejectedRecords ?? props.selectedHistory?.rejectedRecords;
  const inProcessRecords =
    props.status?.inProcessRecords ??
    props.selectedHistory?.inProcessRecords ??
    inferInProcess(declaredRecords, successfulRecords, rejectedRecords);
  const progress = completionPercent(declaredRecords, successfulRecords, rejectedRecords);

  return (
    <section className="panel status-panel">
      <div className="panel-title split">
        <span className="title-icon">
          <Clock3 size={20} />
        </span>
        <div>
          <h2>Seguimiento del lote</h2>
          <p>Consulta operativa con actualizacion automatica.</p>
        </div>
        <StatusBadge status={displayedStatus} />
      </div>

      {props.status?.failureReason && (
        <div className="login-error">
          <AlertCircle size={16} />
          <span>{props.status.failureReason}</span>
        </div>
      )}

      <div className="lookup-row">
        <label>
          <span>Batch ID</span>
          <input value={props.batchId} onChange={(event) => props.setBatchId(event.target.value.trim())} placeholder="Ej. batch-2026-..." />
        </label>
        <button type="button" className="icon-only" onClick={props.onRefresh} disabled={props.loading} aria-label="Consultar estado">
          {props.loading ? <Loader2 className="spin" size={20} /> : <Search size={20} />}
        </button>
      </div>

      <div className="progress-head">
        <div>
          <span>Avance del lote</span>
          <strong>{Math.round(progress)}%</strong>
        </div>
        <label className="switch">
          <input type="checkbox" checked={props.autoRefresh} onChange={(event) => props.setAutoRefresh(event.target.checked)} />
          <span />
          <span>Auto</span>
        </label>
      </div>

      <ProgressBar total={declaredRecords} successful={successfulRecords} rejected={rejectedRecords} inProcess={inProcessRecords} />

      <div className="metrics-grid">
        <Metric label="Declaradas" value={numberText(declaredRecords)} />
        <Metric label="Exitosas" value={numberText(successfulRecords)} tone="good" />
        <Metric label="Rechazadas" value={numberText(rejectedRecords)} tone="bad" />
        <Metric label="En proceso" value={numberText(inProcessRecords)} />
        <Metric label="Monto exitoso" value={moneyText(props.status?.successfulAmount ?? props.selectedHistory?.successfulAmount)} wide />
      </div>

      <div className="status-actions">
        <button type="button" className="secondary-action" onClick={props.onRefresh} disabled={props.loading}>
          <RefreshCw size={16} />
          <span>Actualizar estado</span>
        </button>
      </div>
    </section>
  );
}

function ProgressBar(props: Readonly<{ total?: number; successful?: number; rejected?: number; inProcess?: number }>) {
  const total = props.total && props.total > 0 ? props.total : 0;
  const successful = total ? percent(props.successful, total) : 0;
  const rejected = total ? percent(props.rejected, total) : 0;
  let inProcess = 0;
  if (total && typeof props.inProcess === "number") {
    inProcess = percent(props.inProcess, total);
  } else if (total) {
    inProcess = Math.max(0, 100 - successful - rejected);
  }

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

function ReportsPanel(props: Readonly<{
  canDownload: boolean;
  status: BatchStatus | null;
  receipt: Receipt | null;
  downloadingReport: boolean;
  loadingReceipt: boolean;
  onDownloadReport: () => void;
  onReceipt: () => void;
}>) {
  return (
    <section className="panel reports-panel">
      <div className="panel-title">
        <span className="title-icon">
          <FileCheck2 size={20} />
        </span>
        <div>
          <h2>Reportes y comprobantes</h2>
          <p>Disponible cuando el lote finaliza correctamente.</p>
        </div>
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
      {props.receipt ? (
        <div className="receipt-box">
          <Metric label="Total debitado" value={moneyText(props.receipt.totalDebited)} />
          <Metric label="Dispersado" value={moneyText(props.receipt.totalAmountDispatched)} tone="good" />
          <Metric label="Comision" value={moneyText(props.receipt.commissionCharged)} />
          <Metric label="IVA" value={moneyText(props.receipt.ivaCharged)} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "1rem" }}>
            <small>{props.receipt.receiptUuid}</small>
            <button 
              type="button" 
              className="action-button secondary-action" 
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.75rem" }} 
              disabled={props.loadingReceipt}
              onClick={async () => {
                try {
                  const blob = await downloadReceiptPdf(props.receipt!.batchId);
                  saveBlob(blob, `comprobante_${props.receipt!.batchId}.pdf`);
                } catch (error) {
                  const message = error instanceof Error ? error.message : "Error descargando PDF";
                  alert(message);
                }
              }}>
              Descargar PDF
            </button>
          </div>
        </div>
      ) : (
        <div className="empty-card">
          <Banknote size={22} />
          <span>{props.status ? "Selecciona una accion cuando el lote este completo." : "Sin lote seleccionado."}</span>
        </div>
      )}
    </section>
  );
}

function HistoryPanel(props: Readonly<{
  history: BatchHistoryItem[];
  selectedBatchId: string;
  onSelect: (batchId: string) => void;
  onClear: () => void;
}>) {
  return (
    <aside className="panel history-panel">
      <div className="history-header">
        <div>
          <h2>Historial reciente</h2>
          <p>Ultimas consultas y cargas locales.</p>
        </div>
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
            <span className="history-meta">{item.fileName || item.clientRuc || "Consulta"}</span>
            <StatusBadge status={item.status || "UNKNOWN"} compact />
          </button>
        ))}
      </div>
    </aside>
  );
}

function Notice({ notice, onClose }: Readonly<{ notice: UiNotice; onClose: () => void }>) {
  let Icon = Clock3;
  if (notice.type === "success") {
    Icon = CheckCircle2;
  } else if (notice.type === "error") {
    Icon = AlertCircle;
  }
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

function TemplatePanel() {
  return (
    <section className="panel">
      <div className="panel-title">
        <span className="title-icon">
          <Download size={20} />
        </span>
        <div>
          <h2>Plantilla de carga masiva</h2>
          <p>Descarga el formato CSV que acepta el banco y reemplaza los valores de ejemplo con tus datos reales.</p>
        </div>
      </div>

      <div className="download-row">
        <button type="button" className="primary-action" onClick={downloadTemplateCsv}>
          <Download size={18} />
          <span>Descargar plantilla CSV</span>
        </button>
      </div>

      <div style={{ marginTop: "1.5rem" }}>
        <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>Estructura del archivo</p>
        <ul style={{ paddingLeft: "1.25rem", lineHeight: 1.7, color: "var(--muted, #64748b)" }}>
          <li><strong>Línea 1 (cabecera):</strong> ruc_empresa, servicio, fecha_generacion (ISO), cuenta_matriz, total_registros, monto_total</li>
          <li><strong>Líneas intermedias (detalle):</strong> secuencial, codigo_banco, identificacion_beneficiario, nombre_beneficiario, cuenta_destino, monto, referencia, email</li>
          <li><strong>Última línea (pie):</strong> codigo_seguridad, total_registros, monto_total</li>
        </ul>
        <p style={{ marginTop: "0.75rem", color: "var(--muted, #64748b)" }}>
          El total de registros y el monto total deben coincidir exactamente entre la cabecera, el pie y la suma de las líneas de detalle, o el archivo será rechazado.
        </p>
      </div>
    </section>
  );
}

function ConfirmLogoutModal({ onCancel, onConfirm }: Readonly<{ onCancel: () => void; onConfirm: () => void }>) {
  return (
    <dialog
      open
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: "12px",
          padding: "1.75rem",
          maxWidth: "360px",
          width: "90%",
          boxShadow: "0 10px 40px rgba(0,0,0,0.2)"
        }}
      >
        <h2 style={{ marginTop: 0 }}>¿Cerrar sesión?</h2>
        <p style={{ color: "var(--muted, #64748b)" }}>
          Vas a salir de BanQuito Empresas. Tendrás que volver a iniciar sesión para continuar.
        </p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1.25rem" }}>
          <button type="button" className="secondary-action" style={{ flex: 1, justifyContent: "center" }} onClick={onCancel}>
            Cancelar
          </button>
          <button type="button" className="primary-action" style={{ flex: 1, justifyContent: "center" }} onClick={onConfirm}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </div>
      </div>
    </dialog>
  );
}

function LoginPage({ onLogin }: Readonly<{ onLogin: (session: EmpresaSession) => void }>) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (!username.trim() || !password) return;
    setLoading(true);
    try {
      const session = await loginEmpresa(username.trim(), password);
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al conectar. Verifique que el servicio esté disponible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <aside className="login-brand">
        <div className="login-brand-inner">
          <div className="login-logo">
            <Landmark size={36} />
          </div>
          <h1>BanQuito</h1>
          <p>Portal Empresarial</p>
          <ul className="login-features">
            <li><CheckCircle2 size={15} /> Pagos masivos y nómina</li>
            <li><CheckCircle2 size={15} /> Seguimiento de lotes en tiempo real</li>
            <li><CheckCircle2 size={15} /> Reportes y comprobantes</li>
          </ul>
        </div>
      </aside>

      <main className="login-form-area">
        <div className="login-card">
          <div className="login-header">
            <h2>Ingreso empresarial</h2>
            <p>Accede con las credenciales de tu empresa</p>
          </div>

          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="login-fields">
            <label>
              <span>Usuario (RUC / identificación)</span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ej. 0000009001001"
                disabled={loading}
                required
                autoFocus
              />
            </label>
            <label>
              <span>Contraseña</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={loading}
                required
              />
            </label>
            <button type="submit" className="login-submit" disabled={loading || !username.trim() || !password}>
              {loading ? <><Loader2 size={17} className="spin" /> Ingresando...</> : "Ingresar"}
            </button>
          </form>

          <p className="login-help">¿Problemas de acceso? Contacte al administrador del sistema.</p>
        </div>
      </main>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, tone }: Readonly<{ icon: typeof Building2; label: string; value: string; tone?: "good" }>) {
  return (
    <div className={`stat-card ${tone || ""}`}>
      <Icon size={20} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatusBadge({ status, compact }: Readonly<{ status: BatchStatusName; compact?: boolean }>) {
  let Icon = Clock3;
  if (status === "COMPLETED" || status === "COMPLETED_WITH_ISSUES") {
    Icon = CheckCircle2;
  } else if (status === "FAILED" || status === "REJECTED") {
    Icon = XCircle;
  }
  return (
    <span className={`status-badge ${compact ? "compact" : ""} ${status.toLowerCase()}`}>
      <Icon size={compact ? 13 : 16} />
      {statusLabel(status)}
    </span>
  );
}

function Metric({ label, value, tone, wide }: Readonly<{ label: string; value: string; tone?: "good" | "bad"; wide?: boolean }>) {
  return (
    <div className={`metric ${tone || ""} ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function validateUpload(file: File | null, clientRuc: string) {
  if (!clientRuc || clientRuc.trim().length === 0) {
    return "El RUC/Usuario de la empresa no puede estar vacio.";
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
  const value = status?.toUpperCase().trim();
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
  if (value === "FALLIDO" || value === "ERROR") {
    return "FAILED";
  }
  if (value === "RECHAZADO" || value === "RECHAZADA") {
    return "REJECTED";
  }
  if (value && isBatchStatusName(value)) {
    return value;
  }
  return "UNKNOWN";
}

function isBatchStatusName(value: string): value is BatchStatusName {
  return terminalStatuses.has(value as BatchStatusName) || value === "RECEIVED" || value === "PROCESSING" || value === "COMPLETING";
}

function buildDashboardStats(history: BatchHistoryItem[], status: BatchStatus | null) {
  const isCompletedStatus = (s?: BatchStatusName) => s === "COMPLETED" || s === "COMPLETED_WITH_ISSUES";
  const completed = history.filter((item) => isCompletedStatus(item.status)).length + (isCompletedStatus(status?.status) ? 1 : 0);
  const inFlight = history.filter((item) => item.status === "RECEIVED" || item.status === "PROCESSING" || item.status === "COMPLETING").length;
  const amount =
    history.reduce((sum, item) => sum + (item.successfulAmount || 0), 0) + (status?.successfulAmount && !history.some((item) => item.batchId === status.batchId) ? status.successfulAmount : 0);
  return {
    batches: history.length,
    completed,
    inFlight,
    amount
  };
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

function completionPercent(total?: number, successful?: number, rejected?: number) {
  if (!total) {
    return 0;
  }
  return percent((successful || 0) + (rejected || 0), total);
}

function formatDateTime(value?: string) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return (
    date.toLocaleDateString("es-EC", { year: "numeric", month: "short", day: "numeric" }) +
    " " +
    date.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" })
  );
}

function moneyText(value?: number) {
  return typeof value === "number"
    ? new Intl.NumberFormat("es-EC", { style: "currency", currency: "USD" }).format(value)
    : "$0.00";
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

function compactUrl(url: string) {
  return url.replace(/^https?:\/\//, "");
}

function statusLabel(status: BatchStatusName) {
  const labels: Record<BatchStatusName, string> = {
    RECEIVED: "Recibido",
    PROCESSING: "Procesando",
    COMPLETING: "Cerrando",
    COMPLETED: "Exitoso",
    COMPLETED_WITH_ISSUES: "Exitoso con novedad",
    FAILED: "Fallido",
    REJECTED: "Rechazado",
    UNKNOWN: "Sin estado"
  };
  return labels[status];
}

function ForceChangePasswordPage({
  session,
  onPasswordChanged,
  onLogout
}: Readonly<{
  session: EmpresaSession;
  onPasswordChanged: () => void;
  onLogout: () => void;
}>) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      await changePasswordEmpresa(session.username, currentPassword, newPassword);
      onPasswordChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cambiar contraseña.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-shell">
      <main className="login-form-area" style={{ margin: "auto" }}>
        <div className="login-card">
          <div className="login-header">
            <h2>Actualización obligatoria</h2>
            <p>Por seguridad, debes cambiar tu contraseña.</p>
          </div>
          {error && (
            <div className="login-error">
              <AlertCircle size={16} />
              <span>{error}</span>
            </div>
          )}
          <form onSubmit={handleSubmit} className="login-fields">
            <label>
              <span>Contraseña actual</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </label>
            <label>
              <span>Nueva contraseña</span>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
              />
            </label>
            <label>
              <span>Confirmar nueva contraseña</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </label>
            <button type="submit" className="login-submit" disabled={loading}>
              {loading ? <Loader2 size={17} className="spin" /> : "Actualizar"}
            </button>
            <button type="button" className="secondary-action" onClick={onLogout} style={{ marginTop: "1rem", width: "100%", justifyContent: "center" }}>
              <LogOut size={16} /> Cancelar y salir
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}
