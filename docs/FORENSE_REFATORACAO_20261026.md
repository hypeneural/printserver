# Auditoria forense direcionada — 26/10/2026

**Alvos:** PrintServer PR #1; Evidência MCP PR #12. **Status:** código de pré-produção em Draft; sem print real, CRM write, WhatsApp ou deploy.

## Constatações nas fontes oficiais
- O driver LABEL do AnnaHelena anunciou `Etiqueta` 100×40 mm nas capacidades, mas o default do PrintTicket estava ~100×150 mm. Microsoft [PageMediaSize](https://learn.microsoft.com/en-us/windows/win32/printdocs/pagemediasize) define largura e altura em micrômetros, não em pixels.
- SumatraPDF [CLI oficial](https://www.sumatrapdfreader.org/docs/Command-line-arguments): `-print-to "LABEL"`, `-print-settings "noscale,paper=Etiqueta,monochrome,1x,disable-auto-rotation,ignore-pdf-print-settings"` e `-silent` suportam impressão específica sem UI. Zero no exit code = processo informou submissão, **não** entrega física; códigos 2..6 diferenciam tipos de falha. Confirmar `Etiqueta` na saída do `-list-printers`.
- Windows PowerShell 5.1 [Start-Process](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1) une arrays de ArgumentList em uma string; usar string única com aspas para paths. Invocação REST no PowerShell 5.1 suporta `-MaximumRedirection 0` para bloquear redirects.
- Microsoft [ScheduledTasks](https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/new-scheduledtasksettingsset): `MultipleInstances IgnoreNew` evita sobreposição. Tarefa com Interactive só funciona após login do usuário, requisito consciente desta primeira versão.

## Modificações feitas na PR #1
1. `src/broker.mjs`: bug P0 de duplicação após retenção de 7 dias corrigido com `seen_arrival_orders` (tombstone persistente). Schema v2 lê jobs antigos e migra marcadores a partir dos próprios jobs. Não elimina marcadores na limpeza de metadados; uma reimpressão é fluxo explícito separado.
2. `src/broker.mjs`: polling vazio e consultas de status não regravarão mais JSON se não houve modificação; sweeper uma vez por minuto expira PDFs e registra só mudanças. `unknown` é estado final do hand-off incerto.
3. `windows/agent.ps1`: flag adicional `calibration_confirmed_100x40`, verificação ativa da mídia e driver, checagem de printer/spooler antes do claim, argumentos Sumatra explícitos e timeout de 90 segundos (menos que lease de 120), segredos e PII fora de logs.
4. `src/pdf.mjs`: limites de caracteres para não ultrapassar a etiqueta.
5. `test/broker.test.mjs`: valida dedup após expirar/prunar e reiniciar; `unknown` sem reenvio.
6. `.github/workflows/test.yml`: parser de PowerShell 5.1 em windows-latest **sem executar impressão**, além do Node 22 Linux.

## Principais limites ainda não resolvidos
- Não existe confirmação física do papel; o operador deve homologar uma etiqueta sintética no AnnaHelena.
- SumatraPDF portátil e segredo local não foram instalados.
- Broker HTTPS/daemon/proxy reverso na VPS ainda não implantados; não abrir 8097 externamente.
- Layout básico não reproduz a etiqueta atual do CRM (foi evitada integração com Laravel para não atrapalhar a fila de features).
- O MCP apenas solicita impressão se o CRM já registra status 10 e saldo zero. A transição de baixa via ChatGPT continua bloqueada até um endpoint canônico seguro substituir o `PUT /api/orders/status` legado.

## Handoff mínimo ao Antigravity
- Inspecionar exatamente os HEADs das PRs #1 e MCP #12, verificar CI; executar uma vez `npm run check && npm test` em clone do PrintServer e `npm run validate:local` no MCP.
- No AnnaHelena, read-only `Test-LabelPrinter.ps1`, `SumatraPDF.exe -list-printers`, teste sintético, depois config local sob ACL e Task Scheduler.
- Criar configuração Caddy/HTTPS para broker (back-end bind `127.0.0.1:8097`), secrets privados independentes; inicialmente usar agente OFF.
- Se algum teste falhar, corrigir somente a causa identificada, evitando ciclos globais de CI repetidos.
