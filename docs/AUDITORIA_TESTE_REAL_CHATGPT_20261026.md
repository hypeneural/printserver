# Auditoria forense E2E — 26/10/2026 — impressão pelo ChatGPT

## Evidência REAL de execução autorizada nesta conversa
- ChatGPT consultou `crm_pedido_detalhe` e `crm_previa_malotes_retirada` para um pedido efetivamente registrado em `waiting_product_retrieve` (status 10), com `remaining_cents=0` e `print_eligible=true`.
- O operador autorizou EXPRESSAMENTE o teste real de impressão via ChatGPT. Uma única execução de `crm_solicitar_impressao_etiqueta({order_id:<pedido confirmado>,confirmado_pelo_operador:true})` retornou `queued` com `replay=false`. A consulta subsequente de `crm_consultar_impressao_etiqueta` retornou `spooled`.
- A resposta confirmou `crm_status_updated=false`, `whatsapp_sent=false`, `printed_physically=false`. Não houve retry automático. Os identificadores do cliente e do trabalho ficam na evidência operacional privada da conversa, **não são publicados no repositório público**.
- **Conclusão precisa:** ChatGPT → OAuth MCP → leitura financeira/status CRM → broker → agente Windows / retorno de spooling funcionou num pedido real. Não há inspeção visual independente que confirme alinhamento físico, avanço do rolo e picote. Nunca tratar `spooled` como `physical_print_verified=true`.

## Forense do estado GitHub versus produção
- `main` PrintServer: SHA base `f2776dcca79e033e5751106a89b85f8432cf2787`; `main` MCP: `f34680f95ba462558fd4909c2ebb494a1370bb0c`. Ambas as PRs #1/#12 permanecem **Draft**, mas o relatório Antigravity indicou deploy direto dos SHAs da branch.
- Broker reportado em produção: `e8d9dfce0922060668069178f49ce8737c01f0c8`; gateway MCP consultado diretamente: `f6f93b5`. As mudanças desta segunda rodada são **commit de branch**, não deployment comprovado.
- Backend CRM Laravel: não modificado. O painel Gestão/Malotes realiza as transições comerciais, e a API legada `PUT /api/orders/status` carece de paridade de guarda financeira/concorrência para uso automático pelo MCP.

## Achados P0 e melhorias realizadas
1. **Crash durability:** em `src/broker.mjs`, gravação temporária agora usa `flush:true` (Node 22) antes do rename. Não equivale a transação de banco de dados com fsync do diretório; persistência single-process e backups permanecem necessários.
2. **Expiração fail-closed:** o antigo `prune()` modificava `jobs` em memória antes de salvar; uma falha de I/O deixava estado divergente. `persistPrune()` cria snapshot e desfaz mutações quando `save()` falha. Uma fila vazia não grava JSON a cada polling.
3. **Presença do agente:** novo endpoint administrativo `GET /v1/agent/status`, **não** requer abrir porta no Windows. Registra hora de último polling autenticado **em memória**; online somente se polling ≤30 s, retornando boolean `agent_online`, idade e `physical_print_verified=false`. Só aceita token de administração do broker (o token do agente recebe 401); sem PII no resultado e sem gravação de disco a cada 5 s. Após restart, estado começa offline até novo poll.
4. **MCP:** `src/printserver-client.mjs` tem método READ-ONLY `agentStatus()`. `scripts/verify-printserver-smoke.mjs` consulta opcionalmente esse status mantendo compatibilidade com broker antigo. O catálogo de 33 tools NÃO foi ampliado. **O status do agente ainda NÃO é retornado por `crm_consultar_impressao_etiqueta`**; essa exposição requer revisão de código do gateway e release separado. Não anunciar como LIVE até homologado.
5. **Testes:** novos casos de endpoint com roles, envelhecimento até offline, ausência de gravações em heartbeat e rollback de prune em falha de I/O. Gate padrão Node 22 + parser PowerShell 5.1.
6. **Sem reimpressão automática:** o pedido testado deve ser considerado usado. Repetir a ferramenta de impressão não é diagnóstico de conectividade. Se `spooled` estiver registrado, conferir o papel no local antes de qualquer nova ação.

## Sequência de rollout cirúrgico ao Antigravity
- G0: verificar HEAD PRs e CI no SHA exato, `systemctl show` read-only, SHAs implantados, estado da fila e `Get-Printer LABEL`/tarefa Windows. Não expor segredos, nomes reais ou payloads de jobs.
- G1: em ambiente isolado executar testes de persistência e simular agente online/offline; não simular erro de disco dentro de `/var/lib` de produção.
- G2: se aprovado, snapshot privado **novo** de `jobs.json`, verificar nenhum `claimed`, deploy restrito do broker, manter rollback com tombstones; `GET /v1/agent/status` usando conta de serviço autorizada, esperando `agent_online=true` somente com polling recente.
- G3: validar `npm run printserver:smoke:read` no host do MCP com `agent_online` read-only. Não reiniciar gateway que já opera 33 ferramentas simplesmente para adicionar o método de cliente.
- G4: operador inspeciona fisicamente a etiqueta já solicitada nesta conversa; verificar margem, legibilidade, comprimento 40 mm, gap e qualidade. Não gerar outra etiqueta do mesmo pedido.
- G5: para fluxo completo foto → baixa/status 10 → notificações → impressão, é necessário contrato de API canônico no CRM com locking, finanças e outbox. **Não utilizar PUT legado**.

## Referências oficiais verificadas
- Node v22 fsPromises.writeFile `flush:true`: https://nodejs.org/docs/latest-v22.x/api/fs.html
- Microsoft PowerShell Start-Process Windows 5.1: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1
- SumatraPDF impressão/limitações de spooler: https://www.sumatrapdfreader.org/docs/Command-line-arguments
- OpenAI MCP Plugin: https://developers.openai.com/plugins/build/mcp-server
- Segurança e anotações: https://developers.openai.com/plugins/plugin-guidelines
