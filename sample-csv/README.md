# CSV de referencia para pagos masivos

Estos archivos sirven para probar la pantalla de Pagos Masivos del frontend de empresas.

Datos de carga:

- RUC empresa: `0000009001001`
- Servicio: `NOMINA`
- Codigo On-Us BanQuito: `001`
- Cuenta matriz: `3000009001`

Archivos:

- `lote_nomina_20_onus_cuentas_reales.csv`: usa numeros de cuenta reales existentes en `accountdb` (`2200000001` a `2200000020`). Es el formato funcional esperado para un lote On-Us.
- `lote_nomina_20_onus_account_ids_diagnostico.csv`: usa los `account.id` reales (`1` a `20`) en el campo destino. Este archivo es solo de diagnostico para el estado actual del routing, porque `routing-service` convierte ese campo a `account_id` antes de llamar a `account-core`.

Nota importante:

Si `account-core-service` implementa el gRPC `AccountCoreService.BatchCredit` compatible con `routing-service`, el archivo principal de referencia deberia ser `lote_nomina_20_onus_cuentas_reales.csv`.
