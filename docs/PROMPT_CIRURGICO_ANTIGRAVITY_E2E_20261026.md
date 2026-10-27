# PROMPT CIRÚRGICO — Antigravity / PrintServer + MCP + CRM (26/10/2026)

**Você é executor e homologador da integração que já está construída.** Não refaça arquitetura e não altere o CRM Laravel. Trabalhe nos repositórios `hypeneural/printserver` PR #1 e `hypeneural/evydencia-crm-mcp` PR #12, seguindo `AGENTS.md` de cada um.

Leia antes `printserver/docs/AUDITORIA_INTEGRACAO_E2E_LIVE_20261026.md` e `evydencia-crm-mcp/docs/AUDITORIA_OPENAI_PLUGIN_PRINTSERVER_20261026.md`.

## Estado confirmado — não refazer sem nova evidência
- ChatGPT: 33 tools, gateway LIVE `f6f93b5`, operador #2 e `print.jobs.write` efetivo.
- Leitura de job sintético `999999` / `95bab7dc-62e9-498f-afbd-68775f05e549`: `spooled`, `synthetic_test=true`, `printed_physically=false`.
- A prévia real de malotes bloqueou dois pedidos de status 6/saldo pendente, sem escrita.
- Relatório Antigravity: broker estava implantado em `a244c2632dd5`, gateway em `f6f93b5`, agente Windows ativo. **Confirme o estado atual** em read-only; não presumir que o PID ou o SHA continuam iguais.

## G0 — Preflight forense sem efeitos colaterais
1. Registrar os HEADs exatos das PRs e status das CI. Se verdes nos HEADs, NÃO repetir loops de testes globais.
2. Na VPS confirmar `systemctl is-active` dos serviços `evydencia-printserver` e `evydencia-crm-mcp-live`; ler `git rev-parse HEAD` dos respectivos diretórios e `/healthz` em loopback. Não imprimir secrets, arquivos JSON completos ou environment em console/log.
3. Inspecionar somente contagem por estado (queued, claimed, spooled, unknown) e número de tombstones do `jobs.json` sob conta autorizada, sem copiar nomes/dados. Se houver `claimed`, não reiniciar broker.
4. No AnnaHelena confirmar `Get-Service Spooler`, `Get-Printer LABEL`, `Get-ScheduledTask`, `scripts/Test-LabelPrinter.ps1`, `SumatraPDF.exe -console -list-printers`. Validar explicitamente formulário 100×40 e paperkind só a partir do output real.
5. Comparar o proxy efetivo (Nginx segundo dossiê) com o runbook. Não substituir por Caddy sem motivo; não tocar em TLS/DNS.

## G1 — Verificação cirúrgica de código e CI
6. Confirmar no PrintServer: commit de create, claim e ACK somente após `save()`; rollback em memória em falha; persistência de `seen_arrival_orders`; ausência de retry automático de estado `unknown`; texto do PDF dentro de 100×40.
7. CI `PrintServer Validation` precisa incluir falhas forçadas de I/O para create/claim/ACK e sintaxe PS5.1. No MCP, `Validate MCP` e `MCP validation` devem aprovar o contrato OAuth e a anotação `destructiveHint=true` da ferramenta de impressão. Se CI falhar, abrir o log do job exato e corrigir SOMENTE o erro.
8. Verificar que nenhuma alteração foi feita no CRM Laravel; endpoint legado de status e rotas de WhatsApp não entram neste rollout.

## G2 — Publicação controlada apenas se o SHA LIVE estiver defasado
9. Broker: preparar snapshot novo, protegido, de `jobs.json` e registrar SHA/versão de rollback; nunca restaurar estado antigo por cima de trabalhos posteriores. Com fila sem `claimed` e CI verde, publicar somente revisão de broker aprovada que ainda não esteja ativa; reiniciar apenas `evydencia-printserver.service`, verificar health, controle de tombstones e smoke autenticado READ-ONLY do job #999999.
10. MCP: somente se aprovado e houver alteração de metadados necessária no ChatGPT, publicar revisão aprovada com snapshot/rollback do gateway. Não reiniciar gateway `f6f93b5` saudável só por rotina. Após mudança de ferramentas/metadados, atualizar conexão do plugin no ChatGPT e repetir UMA vez os 4 smoke tests safe.
11. Sem mudanças no PrintServer Windows ou no CRM durante publicação do broker.

## G3 — UMA validação física sintética
12. O gestor já autorizou a homologação com a LeLONG no AnnaHelena. Confirme impressora LABEL/USB001, bobina e separação 100×40. Usar a fixture `node scripts/Create-SyntheticLabel.mjs` e `windows/Invoke-SyntheticPrintTest.ps1 -AuthorizeSinglePrint` **uma única vez**, sem pedido real e sem retry automático. Se já houver teste físico conclusivo dessa mesma versão/hardware, não repetir.
13. Capturar apenas dados técnicos: versão Sumatra, mídia, código de saída, uma etiqueta entregue, margens, gap e avanço. Atribuir `physical_print_verified=true` somente no relatório de inspeção humana, não no broker com base em `spooled`. Em timeout/resultado incerto, parar e investigar antes de qualquer novo comando.

## G4 — Teste de integração com ChatGPT sem alterar pedidos
14. Executar `crm_capacidades` (33, operador #2, `print.jobs.write`); `crm_consultar_impressao_etiqueta` do job sintético; `crm_previa_malotes_retirada` read-only; `crm_solicitar_impressao_etiqueta` somente com `confirmado_pelo_operador=false` para comprovar recusa. Não chamar impressão real de pedido de cliente durante smoke.
15. Relatar claramente a lacuna: **ChatGPT ainda não executa baixa status 10 nem envia WhatsApp por este PrintServer**. O operador usa o modal Gestão/Malotes; a automação futura exige endpoint canônico transacional e idempotente no CRM com financeiro, concorrência e outbox. Não usar a API legada.

## Entrega sem fricção
- Relatório único com: SHAs da PR e de produção, CI, liveness real, estado do polling Windows, resultados do único teste físico, 33 tools/OAuth, broker smoke, riscos e rollback.
- Se um gate falhar, encerrar com `NO-GO` e causa exata; não tentar repetidamente nem solicitar novo desenvolvimento sem evidência.
- Sem novos jobs de clientes, baixa comercial, Z-API, mudanças de driver, exposição de token/PII, migrations ou alterações de Nginx.
