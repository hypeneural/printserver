# PrintServer — regras para Antigravity/Codex

## Escopo
- Projeto independente: `hypeneural/printserver` (Node 22 + PowerShell 5.1 + SumatraPDF portátil).
- Integração externa fica em `hypeneural/evydencia-crm-mcp` PR #12.
- **Não editar o CRM Laravel**, não usar API legada de status, não disparar WhatsApp e não instalar EvydFlow no notebook.
- Repositório público: NÃO registrar PII real, segredos, PDFs de clientes, logs de pedidos ou binários de terceiros.

## Estado e liberação
- Configuração de exemplo é **OFF**: `enable_printing=false` e `calibration_confirmed_100x40=false`. O relatório do Antigravity informa um agente Windows e broker já **ON em produção**. Não inferir o estado LIVE por este exemplo; verificar G0 no host, conforme `docs/AUDITORIA_INTEGRACAO_E2E_LIVE_20261026.md`. O processo Node atende em `127.0.0.1`; acesso remoto passa pelo proxy TLS existente.
- Não abrir portas no notebook; agente faz polling de saída para HTTPS.
- PR #1 permanece Draft até homologação de uma etiqueta **sintética** física em `LABEL`, papel `Etiqueta` 100×40, USB001.
- Respeitar `unknown`/409: não repetir impressão automaticamente. `spooled` não comprova papel impresso.
- Política do Windows deve ser configurada manualmente pelo operador se o driver não selecionar o formato adequado. Não reconfigurar driver/spooler/PrintTicket por script.

## Validação — uma execução limpa
1. `node --version` — exigir versão >=22.
2. `npm run check && npm test` — sem credenciais, rede externa ou impressora.
3. Conferir GitHub Actions `PrintServer Validation`: testes Linux e parser PowerShell 5.1 Windows. Não repetir validação sem mudança de SHA.
4. No AnnaHelena, read-only: `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Test-LabelPrinter.ps1`.
5. Seguir `docs/HOMOLOGACAO_ANTIGRAVITY_REVISADA_20261026.md`. Primeiro `scripts/Prepare-SumatraPortable.ps1` sem `-Install`, depois `-Install` somente com autorização; SHA-256 verificado. Validar `-console -list-printers` com mídia `Etiqueta`.
6. Executar `node scripts/Create-SyntheticLabel.mjs`. O script `windows/Invoke-SyntheticPrintTest.ps1` é inerte sem `-AuthorizeSinglePrint`; imprimir uma única vez apenas após GO específico, sem retry automático.
7. Só depois de confirmação **física** configurar `config.local.json`, ACL do token e tarefa de login; homologar `-Once` com job sintético e broker HTTPS validado.
8. Não fazer deploy de VPS, merge, criação de jobs com clientes reais ou enable_printing automaticamente. Não usar `tls internal` para o cliente externo sem CA confiável.

## Plano/roteiro cirúrgico
- `docs/HOMOLOGACAO_ANTIGRAVITY_REVISADA_20261026.md` e `docs/ANTIGRAVITY_PROMPT_CIRURGICO_20261026.md` prevalecem sobre um plano local não versionado.

## Arquivos centrais
- `src/broker.mjs`: fila persistente single process, auth MCP vs agent, tombstones permanentes, expiração de PDFs e estado incerto.
- `src/pdf.mjs`: etiqueta básica 100×40 em PDF (não equivale à arte oficial CRM).
- `windows/agent.ps1`: opção paper explícita, preflight, timeout de execução, checksum SHA-256, sem retry cego.
- `windows/install-task.ps1`: Windows Task Scheduler ao login, `MultipleInstances IgnoreNew`.
- `scripts/Test-LabelPrinter.ps1`: auditoria read-only de driver/porta/capabilities.
- `test/broker.test.mjs`: invariantes e testes sintéticos.

## Fontes oficiais
- SumatraPDF: https://www.sumatrapdfreader.org/docs/Command-line-arguments
- Microsoft Start-Process: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1
- Microsoft Task Scheduler: https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset
- Microsoft PageMediaSize: https://learn.microsoft.com/en-us/windows/win32/printdocs/pagemediasize
