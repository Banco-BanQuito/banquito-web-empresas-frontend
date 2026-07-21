# BanQuito Web Empresas Frontend

Frontend asignado a Anthony para el portal de empresas del Switch de Pagos Masivos V2.

## Que hace

- Carga archivos CSV/TXT de pagos masivos y los envia al Switch por Kong.
- Consulta el estado real de un lote procesado por `banquito-routing-service`.
- Descarga el reporte de novedades generado por `banquito-report-service`.
- Genera el comprobante del lote desde `banquito-report-service`.
- Mantiene un historial local solo con lotes que el usuario haya cargado o consultado contra el backend.

No contiene datos quemados de lotes, clientes, pagos ni respuestas simuladas. Si un backend no esta levantado o no existe aun, la pantalla muestra el error real devuelto por la llamada HTTP.

## Endpoints consumidos

Por defecto el front apunta a Kong Switch:

```env
VITE_API_BASE_URL=http://localhost:8010
```

Rutas usadas:

| Funcion | Metodo y ruta |
| --- | --- |
| Cargar lote | `POST /api/v2/payments/batches` |
| Consultar estado | `GET /api/v2/payments/batches/:batchId/status` |
| Descargar novedades | `GET /api/v2/reports/payments/batches/:batchId/report` |
| Ver comprobante | `GET /api/v2/payments/receipts/:batchId` |

Estas rutas corresponden a la configuracion de Kong en `banquito-infra/kong/switch/kong.yml`.

## Variables de entorno

Copiar `.env.example` a `.env` si se necesita cambiar algun valor:

```env
VITE_API_BASE_URL=http://localhost:8010
VITE_UPLOAD_PATH=/api/v2/payments/batches
VITE_BATCH_STATUS_PATH=/api/v2/payments/batches/:batchId/status
VITE_BATCH_REPORT_PATH=/api/v2/reports/payments/batches/:batchId/report
VITE_RECEIPT_PATH=/api/v2/payments/receipts/:batchId
VITE_MAX_UPLOAD_MB=10
VITE_POLL_INTERVAL_MS=10000
VITE_SERVICE_TYPES=NOMINA,PROVEEDORES,INTERBANCARIO
```

## Ejecucion local

```bash
npm install
npm run dev
```

Abrir la URL que indique Vite, normalmente `http://localhost:5173`.

## Build

```bash
npm run build
```

## Docker

```bash
docker build -t banquito-web-empresas-frontend .
docker run --rm -p 8080:80 banquito-web-empresas-frontend
```

## Servicios necesarios para probar flujo completo

Para el flujo end-to-end deben estar disponibles:

- Kong Switch desde `banquito-infra`.
- `banquito-file-reception-service` para recibir archivos.
- `banquito-routing-service` para consultar estado del lote.
- `banquito-report-service` para novedades y comprobantes.
- Los servicios gRPC que routing-service consuma en el flujo real.
