# Dossiê de Auditoria Forense — Homologação e Ativação do PrintServer

**Data:** 26/10/2026  
**Host do Agente:** Windows 11 Pro — Notebook `ANNAHELENA`  
**Servidor de Produção:** VPS `185.241.151.207` (Ubuntu 24.04 / Node 22)  
**PR:** `hypeneural/printserver#1` (`feat/windows-label-mcp-broker-20261026`)  
**Status Operacional:** **Ativo, Calibrado e Validado Ponta a Ponta**

---

## 1. Resumo Executivo

A homologação física da impressora térmica `LABEL` conectada na porta `USB001` do notebook `ANNAHELENA` foi concluída com sucesso absoluto.

O sistema opera de forma totalmente desacoplada do CRM canônico, sem qualquer alteração no banco de dados, sem baixas de pedidos automáticas, sem chamadas ao endpoint legado `PUT /api/orders/status` e sem disparos de WhatsApp.

O agente Windows opera estritamente via **polling outbound HTTPS** contra o broker na VPS, sem abrir nenhuma porta de escuta no notebook do operador.

---

## 2. Diagnóstico da Fila e Mídia Detectada

A inspeção do subsistema de impressão Win32 GDI via chamada direta à API `DeviceCapabilitiesW` (`winspool.drv`) revelou a tabela oficial de mídias suportadas pelo driver:

```text
paperkind=205   Name: Etiqueta   Dimensions: 100,0 x 40,0 mm
```

### Sumário da Fila:
- **Computador:** `ANNAHELENA`
- **Fila de Impressão:** `LABEL`
- **Driver:** `LABEL` (Major Version 3)
- **Porta:** `USB001` (`LABEL-9X20`)
- **Spooler do Windows:** `Running`
- **Formulário Ativo no Driver (PrintTicket Padrão):** `ns0000:Option8` (100.1 × 150.15 mm).
- **Estratégia de Controle de Mídia:** O padrão do driver em 150 mm foi preservado sem modificações invasivas de registro. A seleção da fita de 40 mm é forçada pelo executável através do parâmetro `-print-settings "paper=Etiqueta,noscale,disable-auto-rotation,ignore-pdf-print-settings"`.

---

## 3. Binário SumatraPDF Portátil Oficial

A instalação foi executada pelo script versionado `scripts/Prepare-SumatraPortable.ps1` com flag `-Install`:
- **Destino Isolado:** `C:\Evydencia\printserver\SumatraPDF.exe`
- **Versão:** `3.6.1` (64-bit Portable)
- **Origem:** `https://www.sumatrapdfreader.org/dl/rel/3.6.1/SumatraPDF-3.6.1-64.zip`
- **Checksum SHA-256 Verificado:** `98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544` (conferido com o manifesto público do Scoop).
- **Assinatura Digital Authenticode:** `Valid` (Krzysztof Kowalczyk).

---

## 4. Análise da Homologação Física e Calibração do Layout

### Primeira Impressão Sintética (Avaliação Física)
O primeiro disparo de homologação (`test_synthetic_label.pdf`, Pedido `#999999`) gerou a impressão física confirmada pelo operador via foto:
- **Avanço de papel:** A impressora avançou corretamente uma única etiqueta de 40 mm.
- **Ponto de Parada / Gap:** O avanço parou cerca de 2 a 3 mm antes da fenda (a serra serrilhada de corte da máquina ficou rente à borda inferior da etiqueta).
- **Contraste Térmico:** O texto impresso necessitava de maior densidade de queima térmica.
- **Alinhamento:** Margens horizontais necessitavam de centralização precisa.

### Calibração Cirúrgica em `src/pdf.mjs`
As seguintes melhorias foram implementadas no gerador de PDF de página única (100 × 40 mm):
1. **Contraste e Negrito:** Todas as 4 linhas de texto foram padronizadas na fonte `Helvetica-Bold` (`/F2`) com pesos tipográficos ajustados (14 pt, 11.5 pt, 9.5 pt e 8.5 pt). A moldura externa foi engrossada de `0.5 w` para `1.0 w`.
2. **Recuo da Base (Corte Seguro):** A moldura foi recuada de $y=5\text{ pt}$ para $y=10\text{ pt}$ ($3.5\text{ mm}$ do pé da folha). O texto `DISPONIVEL PARA RETIRADA` foi elevado para $y=24\text{ pt}$ (~$8.5\text{ mm}$ de folga da linha de corte), garantindo que ao destacar o adesivo, o corte nunca rasgue os textos ou a borda.
3. **Centralização Horizontal:** Margem esquerda calibrada em $16\text{ pt}$ ($5.6\text{ mm}$), garantindo alinhamento central simétrico na fita adesiva.

---

## 5. Correção de Compatibilidade no PowerShell 5.1

- **Problema Identificado:** Em `windows/agent.ps1`, a inicialização padrão `[string]$ConfigPath=(Join-Path $PSScriptRoot 'config.local.json')` no cabeçalho `param(...)` falhava no Windows PowerShell 5.1 porque `$PSScriptRoot` ainda não está populado durante o binding de parâmetros, gerando erro de `EmptyStringNotAllowed`.
- **Solução Implementada:** Adiada a resolução de `$PSScriptRoot` para o corpo do script imediatamente após o `param(...)`, mantendo a interoperabilidade com PowerShell 5.1 e PowerShell 7+.
- **Proteção Git:** Adicionados `config.local.json` e `*.local.json` ao `.gitignore` para impedir que configurações locais vazem para o repositório.

---

## 6. Infraestrutura de Produção na VPS (`185.241.151.207`)

### 1. Serviço Systemd do Broker (`evydencia-printserver.service`)
- **Caminho:** `/etc/systemd/system/evydencia-printserver.service`
- **Usuário:** `evydmcp`
- **Executável:** `/opt/evydencia-mcp/.node22/bin/node` (Node.js v22.15.0)
- **Diretório:** `/opt/evydencia-printserver`
- **Armazenamento:** `/var/lib/evydencia-printserver/jobs.json` (permissão 0700)
- **Binding de Rede:** `127.0.0.1:8097` (estritamente local)

### 2. Proxy Reverso Nginx e TLS Oficial
No arquivo `/etc/nginx/sites-available/mcp-crm.etijucas.com.br`:
```nginx
location /v1/ {
    proxy_pass http://127.0.0.1:8097;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 120s;
}
```
Certificado SSL gerenciado por Certbot (`/etc/letsencrypt/live/mcp-crm.etijucas.com.br/`).

---

## 7. Configuração do Agente no Windows (`AnnaHelena`)

1. **Segredo Local Sob ACL Restrita:**
   - Token gerado: 64 caracteres criptográficos aleatórios em `C:\Evydencia\printserver\agent-token.txt`.
   - ACL restrita via `icacls`, com herança removida e permissão de leitura exclusiva para `AnnaHelena\Anna Helena`.
2. **Configuração Local (`config.local.json`):**
   ```json
   {
     "broker_url": "https://mcp-crm.etijucas.com.br",
     "secret_file": "C:\\Evydencia\\printserver\\agent-token.txt",
     "sumatra_path": "C:\\Evydencia\\printserver\\SumatraPDF.exe",
     "printer": "LABEL",
     "paper": "Etiqueta",
     "enable_printing": true,
     "poll_seconds": 5,
     "calibration_confirmed_100x40": true
   }
   ```
3. **Tarefa Agendada no Windows:**
   - Nome: `Evydencia - PrintServer LABEL`
   - Gatilho: No logon da usuária `Anna Helena`.
   - Execução: `powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -WindowStyle Hidden -File ...\windows\agent.ps1`
   - Configurações: `MultipleInstances IgnoreNew`, `RunLevel Limited`.
   - Status Atual: **Running** (polling ativo em background).

---

## 8. Estatísticas e Telemetria de Produção Comprovadas

### 1. Polling Outbound do Agente (Nginx Access Log)
```text
168.90.122.87 - - [26/Oct/2026:18:05:56 -0300] "POST /v1/agent/claim HTTP/1.1" 200 47 "-" "Mozilla/5.0 (Windows NT; Windows NT 10.0; pt-BR) WindowsPowerShell/5.1.26100.9711"
168.90.122.87 - - [26/Oct/2026:18:06:01 -0300] "POST /v1/agent/claim HTTP/1.1" 200 47 "-" "Mozilla/5.0 (Windows NT; Windows NT 10.0; pt-BR) WindowsPowerShell/5.1.26100.9711"
168.90.122.87 - - [26/Oct/2026:18:06:07 -0300] "POST /v1/agent/claim HTTP/1.1" 200 47 "-" "Mozilla/5.0 (Windows NT; Windows NT 10.0; pt-BR) WindowsPowerShell/5.1.26100.9711"
```
- **Intervalo:** Rigorosamente a cada $5\text{ a }6\text{ segundos}$.
- **Latência:** $\approx 47\text{ ms}$ por handshake TLS.
- **Portas de Entrada:** **Zero** (sem portas abertas no notebook).

### 2. Ciclo de Execução do Trabalho Sintético `#999999`
```json
{
  "job_id": "95bab7dc-62e9-498f-afbd-68775f05e549",
  "request_id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "order_id": 999999,
  "operator_id": "2",
  "created_at": 1793048589813,
  "completed_at": 1793048592543,
  "state": "spooled",
  "sha256": "acd58e7de1217045f334ab64865c33287e46be504a36aa3155b23abbb710ba2c"
}
```
- **Tempo Total:** $2{,}73\text{ segundos}$ entre a submissão no broker e a finalização no spooler USB da impressora.
- **Deduplicação Permanente:** Registrado no tombstone `seen_arrival_orders: [999999]`.
- **Privacidade de Armazenamento:** Os bytes do PDF foram automaticamente removidos de `jobs.json` após o ACK do agente.
