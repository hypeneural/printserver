# Recibo de Homologação — Runtime de Impressão Windows 11 (28/10/2026)

## 1. Contexto e Escopo
- **Repositório:** `hypeneural/printserver`
- **PR:** #2 (`audit/windows-label-readonly-20261028`)
- **Estação de Impressão:** Windows 11 (Ambiente Operacional Avell)
- **Impressora Físico-Térmica:** `LABEL` conectada via porta `USB001`

---

## 2. Diagnóstico de Prontidão Read-Only

Executado via `windows/Test-LabelRuntimeReadOnly.ps1`:
```json
{
  "source": "PRINTSERVER_WINDOWS_READ_ONLY_DIAGNOSTIC",
  "printer_present": true,
  "spooler_running": true,
  "printer_status": "Normal",
  "port_expected": true,
  "media_100x40_advertised": true,
  "jobs_in_spooler": 0,
  "task_registered": true,
  "task_state": "Running",
  "last_task_result": 267009,
  "ok": true,
  "writes_performed": false,
  "agent_invoked": false,
  "print_submitted": false
}
```

### Análise Sintática PowerShell 5.1 (AST)
Executado via `scripts/Validate-SyntaxOnly.ps1`:
```json
{
  "source": "PRINTSERVER_WINDOWS_PARSER_ONLY",
  "files_checked": 8,
  "syntax_ok": true,
  "failure_paths": [],
  "writes_performed": false,
  "printer_accessed": false
}
```

---

## 3. Estado do Broker e Conexão do Agente

- **Broker em Produção (VPS MCP 8097):** commit `968e299addbac0bbf90c065a79f0229a28f935a8`.
- **Exigência de Arte Canônica:** `PRINTSERVER_REQUIRE_CRM_ARTWORK=1`.
- **Status do Agente (`GET /v1/agent/status` com Bearer Token):**
  ```json
  {
    "agent_online": true,
    "agent_poll_age_seconds": 1,
    "status_source": "authenticated_agent_poll",
    "physical_print_verified": false
  }
  ```

---

## 4. Evidência do Canário Físico Autorizado (Pedido 5058)

- **Job ID:** `f146d063-9159-4703-b901-6a4a00cb8830`
- **Pedido:** `5058` (*Experiência Ho-Ho-Ho*, status 10, saldo R$ 0)
- **Arte Canônica:** Natal 2026 (PNG 109.165 bytes com gorro, flocos de neve, laço sobre o QR e fita de nome)
- **Ciclo de Impressão:**
  - `POST /v1/jobs` -> `queued`
  - `/v1/jobs/claim` pelo agente Windows 11
  - Impressão térmica disparada via SumatraPDF (`-print-to "LABEL" -print-settings "noscale,paper=Etiqueta,monochrome,1x,disable-auto-rotation,ignore-pdf-print-settings"`)
  - `POST /v1/jobs/:id/ack` reportado em **4,52 segundos**: `state: spooled`
  - Spooler Windows: **0 trabalhos pendentes**.
- **Tombstones de Deduplicação Preservados:** `seen_arrival_orders: [999999, 5088, 5093, 5058]`.
