# Segunda auditoria forense — PrintServer Broker / MCP LIVE (26/10/2026)

## Limites da evidência
- LIVE v0.12.0 `build_commit=f6f93b5` foi comprovado em ChatGPT, com **33/33 ferramentas invocáveis**, OAuth operador #2 com `print.jobs.write`, consulta do job sintético **spooled**, `printed_physically=false`, prévia dos pedidos bloqueados e recusa sem confirmação.
- **Não** foi submetida etiqueta física nova nesta auditoria. `spooled` é resultado do executável/spooler e não confirmação visual/hardware (conforme documentação oficial SumatraPDF).
- A PR #1 do PrintServer continua branch Draft; a publicação anterior do broker foi documentada com commit `005e44e`, porém novos commits desta rodada **não são produção automaticamente**.

## Leitura técnica e melhorias realmente aplicadas
**P0 — Atomicidade de trabalho / erro de disco:** em `src/broker.mjs`, antes da refatoração, `jobs.push(job)` e `seenArrivalOrders.add(id)` aconteciam *antes* de `await save()`. Com falha de rename/gravação, HTTP retornava erro 500, mas o job permanecia na memória e poderia ser retirado pelo agente/impresso sem estado durável. Correção: rollback em memória antes de devolver 500; arquivos temporários JSON com possíveis dados pessoais são removidos em `finally`. Não há impressão/retry durante o teste.

**P1 — Limite físico de texto:** `src/pdf.mjs` tinha `customer_name.slice(0,30)` e `package_name.slice(0,38)`, que podem ultrapassar a largura útil da mídia de 100mm para strings em Helvetica-Bold. A nova limitação conservadora é 22/27 caracteres. Layout, origem de coordenadas e dimensões físicas do PDF são preservados; pode haver truncamento intencional, preferir nome completo no CRM e não como identificador exclusivo da etiqueta.

**Testes adicionados em `test/broker.test.mjs`:**
- falha de persistência forçada de forma sintética impede claim por token agent, remove temporários e permite nova tentativa após correção de armazenamento;
- nome/pacote com 120 letras W respeita limites da etiqueta;
- permanecem os testes de dedup durável, lease, ACK incerto, ausência de retries e credenciais segregadas.

**CI:** consultar HEAD exato da PR #1 e workflow `PrintServer Validation` antes do handoff; testes Node 22 no Linux e verificação de sintaxe PowerShell 5.1 no Windows, sem impressão física.

## Semântica de estados, fonte da verdade
- `queued` = job gravado; `claimed` = notebook obteve lease; `spooled` = aceitação do comando, não papel confirmado; `unknown` = não repetir cegamente.
- `GET /v1/jobs/{uuid}` responde apenas do broker autenticado; autenticação de operador e checagem financeira/status são responsabilidade do gateway MCP.
- `crm_solicitar_impressao_etiqueta` exige `waiting_product_retrieve`, saldo zero em centavos e `confirmado_pelo_operador===true`, com scope `print.jobs.write`. A API legado de status do CRM não pode ser usada como atalho.
- O job histórico `999999` pode ser consultado pela exceção sintética do MCP; essa exceção **não** existe na ferramenta de criar novo job.
- Somente a empresa pode atestar o resultado físico e o avanço/corte da LeLONG.

## Gates cirúrgicos para Antigravity
1. Confirmar HEAD das PRs #1 e #12 e status CI correspondente. Evitar suites repetidas quando verde no mesmo SHA.
2. Confirmar no diff que só `src/broker.mjs`, `src/pdf.mjs`, `test/broker.test.mjs` e documentação foram tocados neste patch; não fazer mudanças no Laravel.
3. Se houver autorização separada para rollout, preparar snapshot seguro do `jobs.json` e binário/checkout ativo, executar preflight de permissão de escrita da pasta e certificar que não existem jobs `claimed`/em andamento antes de reiniciar o broker. O rollback tem que restaurar **código, configuração e compatibilidade do schema**, sem apagar histórico/tombstones ou reimprimir.
4. Publicar no PrintServer **somente** depois de uma confirmação explícita de release, sem reconfigurar driver/porta/mídia no Windows.
5. Para smoke pós-publicação: consultar por `GET` o job sintético existente e validar `spooled`; testar a falha de persistência **somente em um broker local isolado, nunca preenchendo/renomeando o jobs.json de produção**.
6. Se impressão física futura for solicitada, cumprir runbook de 100×40 com fixture sintética, job novo único e aprovação específica. Não usar cliente real por conveniência.

## Referências oficiais conferidas
- SumatraPDF CLI e exit codes: https://www.sumatrapdfreader.org/docs/Command-line-arguments
- Windows PowerShell `Start-Process`: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process
- OpenAI Plugins OAuth e authorization: https://developers.openai.com/plugins/build/auth
- MCP tooling/security: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
