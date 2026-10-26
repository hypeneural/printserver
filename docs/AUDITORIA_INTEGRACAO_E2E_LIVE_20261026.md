# Auditoria E2E do PrintServer / Windows LABEL / MCP LIVE
**Data:** 26/10/2026 · **Release reportado:** broker `a244c2632dd5`, gateway `f6f93b5`  
**Estado das PRs:** #1 PrintServer e #12 MCP podem estar publicadas a partir de branches Draft, sem merge; não confundir HEAD da PR com SHA do processo systemd.

## Evidências e limites (fontes separadas)
### Comprovado por chamadas reais do ChatGPT nesta auditoria
- `crm_capacidades`: 33 tools, `build_commit=f6f93b5`, operador #2, OAuth efetivo `print.jobs.write`, ferramenta de impressão habilitada.
- `crm_consultar_impressao_etiqueta(999999,95bab7dc-62e9-498f-afbd-68775f05e549)`: `synthetic_test=true`, `print_state=spooled`, `printed_physically=false`.
- `crm_previa_malotes_retirada([5127,5126])`: status de agendamento, saldo pendente, ambos inelegíveis; `changes_applied=false`.
- **Não foram criados jobs novos nem executadas baixas no CRM.**

### Reportado pelo Antigravity; ainda requer leitura no host atual
- Broker `evydencia-printserver.service` ativo no SHA `a244c2632dd5`, `127.0.0.1:8097`.
- Gateway `evydencia-crm-mcp-live.service` ativo no SHA `f6f93b5`, `127.0.0.1:8090`.
- Agente Windows `Evydencia - PrintServer LABEL` em execução, SumatraPDF 3.6.1, USB001/203 DPI, mídia `Etiqueta` 100×40.
- Snapshot `jobs.json.bak_1793054231` com `seen_arrival_orders`. Nunca recolocar o snapshot enquanto o broker estiver executando ou sobrescrever mudanças posteriores.
- A topologia publicada usa **Nginx** para `/v1/` conforme relatório; `AGENTS.md` do MCP contém um exemplo histórico **Caddy**. Inspecionar proxy efetivo em read-only, sem substituir Nginx apenas para harmonizar documentação.

### Não comprovado
- Frescor do polling Windows neste exato momento; processo `Running` não atesta bobina, papel ou spooler capaz de imprimir.
- Impressão física de novo job depois das mudanças de PDF; `spooled` não é prova de papel.
- Baixa status 10 e envio de WhatsApp via ChatGPT. MCP **não tem ferramenta canônica de escrita para status**; não usar `PUT /api/orders/status` legado.

## Segunda rodada de hardening no código (branches, não produção até reconciliação)
- Broker `src/broker.mjs`: em erro de persistência, **criar, reivindicar e finalizar ACK** não deixa estado afirmado em memória sem gravação. Claim/ACK usam snapshot apenas do job afetado (baixo overhead). Testes sintéticos forçam `rename` a falhar e verificam rollback e ausência de reenvio.
- MCP `src/live-gateway.mjs`: anotação específica para `crm_solicitar_impressao_etiqueta` como **readOnlyHint=false, destructiveHint=true, idempotentHint=true, openWorldHint=false**; mantém confirmação, status 10 e saldo zero. Descrição diz explicitamente que impressão física é potencialmente irreversível.
- O operador continua com autorização `print.jobs.write` independente da ability de proposta e `EVYD_PRINT_ALLOWED_OPERATOR_IDS`. Nenhum código Laravel foi modificado.

## Sequência operativa mínima / critérios objetivos
### G0 — Preflight de produção, apenas leitura
Na VPS, em sessão operacional já autorizada, registrar:
```bash
systemctl is-active evydencia-printserver.service evydencia-crm-mcp-live.service
systemctl show evydencia-printserver.service -p MainPID -p ActiveState -p SubState
systemctl show evydencia-crm-mcp-live.service -p MainPID -p ActiveState -p SubState
git -C /opt/evydencia-printserver rev-parse HEAD
git -C /opt/evydencia-mcp/app rev-parse HEAD
curl --fail --silent http://127.0.0.1:8097/healthz
curl --fail --silent http://127.0.0.1:8090/healthz
```
Não imprimir `Environment`, tokens ou payload completo de `jobs.json` em logs. Inspecionar **somente contagem e estados** da fila com processo autorizado (sem expor nomes/PII). Se existirem jobs `claimed` ou `queued`, não reiniciar precipitadamente.

No AnnaHelena, comandos read-only:
```powershell
Get-Service Spooler | Select-Object Status
Get-Printer -Name LABEL | Select-Object Name,DriverName,PortName,PrinterStatus
Get-ScheduledTask -TaskName 'Evydencia - PrintServer LABEL' | Select-Object State,TaskName
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Test-LabelPrinter.ps1
& 'C:\Evydencia\printserver\SumatraPDF.exe' -console -list-printers
```
Não extrair conteúdo de `agent-token.txt`, não reconfigurar o driver automaticamente.

### G1 — Validadores sem hardware
- PrintServer PR #1: CI `PrintServer Validation` Node 22 + parser PowerShell 5.1 green no SHA exato; inclui falha simulada de persistência para create/claim/ACK.
- MCP PR #12: `Validate MCP` e `MCP validation` green no SHA exato; sem job real.
- Se os SHAs não mudaram e CI já verde, dispensar execução redundante.

### G2 — Rollout controlado (após G0 + G1)
- Fazer snapshot novo do `jobs.json` com **permissões privadas** e SHA, preservar tombstones `seen_arrival_orders` e registrar versão anterior para rollback.
- Parar/reiniciar **somente** o broker se a nova revisão da PR #1 ainda não estiver implantada, após garantir não haver job em voo. Não reiniciar gateway MCP somente por alteração de anotação sem planejar uma atualização de conexão/schemas.
- Se o gateway for atualizado, verificar OAuth, 33 ferramentas e ausência de alterações comerciais. O UI do ChatGPT pode exigir atualização do conector para reimportar metadados.
- Rollback de código deve preservar a fila atual; NUNCA restaurar snapshot antigo sobre jobs posteriores sem reconciliação.

### G3 — Teste físico sintético autorizado (uma execução, sem retry)
- Após conferir `LABEL`, formulário `Etiqueta`, bobina e gap, gerar fixture sintética do repositório.
- Usar `windows/Invoke-SyntheticPrintTest.ps1 -AuthorizeSinglePrint` **uma única vez**; documentar versão binária, `paper` ou `paperkind=205` somente se de fato validado no host, exit code, spooler, alinhamento e foto/checagem manual.
- **NÃO** usar a ferramenta MCP de impressão para o pedido fictício sem CRM. Nenhuma operação com pedido real é necessária para a homologação sintética.
- Na dúvida `unknown`, não repetir automaticamente. O operador confirma se o papel saiu.

### G4 — Operação comercial completa (depende de CRM)
- Com foto de envelopes, extrair IDs e usar prévia `crm_previa_malotes_retirada` em lotes ≤20, resolver duplicidades e conferir status/saldo.
- Se status 10 + saldo zero: pedir confirmação humana e enviar **um** job por pedido via ferramenta MCP.
- Se ainda em status 6/7/9: o painel Gestão/Malotes deve registrar a baixa, com as guardas financeiras e notificações do CRM. **Não existe API canônica exposta no MCP para alterar status**.
- Para fechar automaticamente foto → baixa → WhatsApp → impressão, criar depois um endpoint de domínio CRM transacional e idempotente, com autorização independente, validação financeira e eventos outbox, antes de conectar ao MCP. Não usar endpoint legado.

## Documentação oficial revisada
- OpenAI Plugin Guidelines (tools, annotations, OAuth, user confirmation): https://developers.openai.com/plugins/plugin-guidelines
- OpenAI Plugin Authentication: https://developers.openai.com/plugins/build/auth
- SumatraPDF CLI (paper, paperkind, exit codes e limites): https://www.sumatrapdfreader.org/docs/Command-line-arguments
- Microsoft Windows PowerShell 5.1 Start-Process: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1
- Microsoft Set-PrintConfiguration (exige admin, NÃO executar como auto-remediação): https://learn.microsoft.com/en-us/powershell/module/printmanagement/set-printconfiguration
