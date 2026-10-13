# Pruebas de carga — Virtual Shop Baires

**Nunca contra producción.** Los scripts se niegan a correr si la URL apunta a
`virtualshopbaires.com.ar`, a la implementación de producción del CRM o a la
planilla real.

## Qué hace falta (lo crea el dueño, no Claude)
1. **Copia de la planilla** con datos ficticios (Archivo → Hacer una copia). Anotar su ID.
2. **Proyecto de Apps Script aparte**: pegar `crm/Codigo.gs`, cambiar `SHEET_ID` por el de la copia,
   y en Propiedades del script poner `PANEL_PASS` de prueba, `MP_ACCESS_TOKEN` de **PRUEBA**
   (credenciales de test de Mercado Pago) y **sin** `TELEGRAM_*` ni `GH_TOKEN`.
   Implementar como aplicación web ("Cualquier usuario") y copiar la URL `/exec`.
3. Opcional, para el Worker: `cd worker && npx wrangler deploy --env staging` con un `[env.staging]`
   en `wrangler.toml` que apunte a un proyecto de Supabase de prueba.

## Correr
```bash
# Node (sin instalar nada):
TARGET_URL="https://script.google.com/macros/s/AKfycb.../exec" CONCURRENCIA=50 node tests/carga/carga-node.mjs

# k6 (https://k6.io): 50 / 200 / 500 checkouts concurrentes
TARGET_URL="https://script.google.com/macros/s/AKfycb.../exec" k6 run -e VUS=50 tests/carga/checkout.k6.js
```

Cada corrida reporta: p50, p95, p99, % de errores, respuestas `auth`/`error` y pedidos duplicados
(mismo `orderNumber` dos veces). Comparar con las cuotas de Apps Script:
30 ejecuciones simultáneas, 6 min por ejecución, 20.000 URL Fetch/día (cuenta Gmail).

Después de cada corrida, revisar en la copia de la planilla cuántas filas se crearon en
"Pedidos externos" y que ninguna tenga `⚠ PRECIOS SIN VERIFICAR`.
