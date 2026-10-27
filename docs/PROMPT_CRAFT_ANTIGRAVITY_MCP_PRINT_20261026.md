# Prompt Craft — Antigravity / PrintServer + MCP pós-auditoria LIVE

Você é o responsável pela execução CIRÚRGICA da integração `hypeneural/printserver` PR #1 (broker + agente LABEL) e `hypeneural/evydencia-crm-mcp` PR #12 (MCP LIVE v0.12.0). Leia `AGENTS.md` e `docs/AUDITORIA_FORENSE_BROKER_MCP_LIVE_20261026.md` do PrintServer e `docs/AUDITORIA_CHATGPT_LIVE_PRINTSERVER_20261026.md` do MCP. Não edite CRM Laravel.

## Provas já existentes — não repetir sem motivo
- ChatGPT tem **33/33** ferramentas invocáveis, `build_commit=f6f93b5`.
- `oauth_authorization.operator_id="2"`, `granted_scopes` contém `print.jobs.write`, `print_scope_granted=true`, `print_tool_enabled=true`.
- Consulta READ-ONLY `crm_consultar_impressao_etiqueta({order_id:999999,job_id:"95bab7dc-62e9-498f-afbd-68775f05e549"})` confirmou `synthetic_test=true`, `print_state=spooled`, `printed_physically=false`.
- `crm_solicitar_impressao_etiqueta({order_id:999999,confirmado_pelo_operador:false})` recusou como `operator_confirmation_required`.
- Prévia READ-ONLY de `[5127,5126]` retornou `session_schedule`, saldo em aberto e `changes_applied=false`.
- Performance interna gateway (amostras de uma janela): consulta job 116.27ms, prévia 490.47ms, recusa 0.54ms, capacidades 1.11ms. Não confundir com latência ponta a ponta da rede.

## Missão mínima
1. Localize a HEAD atual de cada PR e confirme CI do **SHA exato**. Evite reexecutar suites globais se já aprovadas no mesmo SHA.
2. Revise no diff PrintServer: `src/broker.mjs` agora **desfaz um job não persistido** quando `save()` falha e apaga arquivo temporário JSON; `src/pdf.mjs` limita texto para largura física; `test/broker.test.mjs` cobre disco indisponível e strings longas. Verifique `npm test` e gate Windows PS5.1 uma única vez se CI estiver verde.
3. Revise no MCP: consulta #999999 é exclusivamente read-only, com OAuth e reconcilição de job ID; criação de job nunca dispensa CRM, status 10, financeiro zero e confirmação; `crm_capacidades.oauth_authorization` expõe apenas scopes, sem token.
4. Sem publicação, faça somente diagnóstico READ-ONLY da VPS (`systemctl status`, SHA implantado, stdout limitado e sem secrets) e da fila LABEL/USB001 no AnnaHelena por `scripts/Test-LabelPrinter.ps1`. **Não** gerar nova impressão, job ou baixa nessa etapa.
5. Documente se o serviço PrintServer ativo ainda executa `005e44e` ou outra revisão. Se diferente da PR, compare o diff real e faça plano de rollback/snapshot de `jobs.json` protegido. Não sobrescrever nem eliminar `seen_arrival_orders`.
6. Somente com GO separado para rollout, publique exclusivamente o código de broker necessário, sem instalar nova stack. O MCP LIVE `f6f93b5` já está funcional: **não reiniciá-lo apenas para repetir a auditoria**. Não alterar Nginx, gateway OAuth, Z-API, Laravel, drivers, impressora ou tarefas Windows.
7. Smoke pós-deploy: `GET` do job sintético existente, contagem de ferramentas, uptime e logs sanitizados. Zero novas mensagens, jobs ou status de pedidos. Em caso de falha, interrompa e reporte bloqueio em vez de repetir impressão.
8. Documente em comentário na PR #1 os SHAs LIVE, limites, testes, latência, status de rollback e qualquer impedimento.

## Teste físico futuro, separado deste smoke
O operador autorizou homologações com a impressora, mas o roteiro desta rodada pede **não imprimir**. Para outra execução física explícita, use somente UMA etiqueta **sintética** 100 × 40 mm com `windows/Invoke-SyntheticPrintTest.ps1 -AuthorizeSinglePrint`, após conferência do rolo/gap, sem retry automático e com inspeção visual do papel. Nunca use pedidos de clientes reais como fixture.

## Condições de GO / NO-GO
- CI atual verde e nenhuma modificação não explicada nos SHAs.
- Persistência de jobs/tombstones íntegra; em falha de I/O, nenhum job não persistido fica claimable.
- `spooled` não equivale a `physically_printed`.
- Scopes/allowlist continuam exigidos, e saldo desconhecido ou pendente bloqueia impressão.
- Em qualquer discrepância, apresentar evidência e corrigir somente causa raiz; evitar loops de testes e deploys duplicados.
