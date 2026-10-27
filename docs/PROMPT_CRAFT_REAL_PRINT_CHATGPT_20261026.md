# PROMPT CRAFT — Antigravity / Homologação pós-impressão REAL do ChatGPT

Atue como engenheiro forense e responsável pelo rollout cirúrgico de `hypeneural/printserver` PR #1 e `hypeneural/evydencia-crm-mcp` PR #12. Leia os `AGENTS.md`, `docs/AUDITORIA_TESTE_REAL_CHATGPT_20261026.md` do PrintServer e `docs/AUDITORIA_IMPRESSAO_REAL_CHATGPT_20261026.md` do MCP antes de executar.

## FATOS DE PRODUÇÃO JÁ COMPROVADOS — NÃO REFZER IMPRESSÃO
O ChatGPT já acionou um trabalho NOVO para um pedido real elegível: status 10 no CRM, saldo zero, permissão OAuth `print.jobs.write`, confirmação explícita; MCP retornou `queued`, `replay=false`, e consulta posterior retornou `spooled` (aprox. 3,51 s para solicitar e 1,53 s para consultar). Retorno `printed_physically=false`: ainda falta o operador observar a etiqueta. Nenhum status foi modificado e nenhum WhatsApp enviado. Não repetir impressão desse mesmo pedido: é possível gerar cópias físicas duplicadas.

## FASE A — RASTREAMENTO DE ESTADO (SOMENTE LEITURA)
1. Confirmar **main e HEAD** das PRs #1/#12 e CI vinculada a cada SHA. Não confundir PR Draft com ausência de deploy: o Antigravity relata instalação a partir de commit de branch. Anotar os SHAs efetivamente executados no VPS.
2. Verificar `systemctl show evydencia-printserver.service` e `evydencia-crm-mcp-live.service` (estado, PID, uptime) e `/healthz` em `127.0.0.1:8097` e `:8090`. Confirmar se proxy atual é **Nginx**, não instalar Caddy por causa de uma doc histórica.
3. Inspecionar contagens e estados da fila e os tombstones sem imprimir nomes/IDs de clientes nem JSON completo. Se houver `claimed`, NÃO reiniciar broker.
4. No notebook AnnaHelena, consultar `Get-Service Spooler`, `Get-Printer LABEL`, `Get-ScheduledTask -TaskName 'Evydencia - PrintServer LABEL'`, `scripts/Test-LabelPrinter.ps1` e `SumatraPDF.exe -console -list-printers` (read-only). Conferir bobina `Etiqueta` 100×40, porta USB001, driver LABEL e tarefa.
5. Pedir APENAS inspeção física do trabalho já enviado: número de etiquetas realmente ejetadas, corte/gap, alinhamento, contraste, largura. Se o papel saiu, registrar evidência física; **não reenviar**.

## FASE B — VERIFICAÇÃO DO HARDENING JÁ CODIFICADO
6. Na PR #1 conferir `src/broker.mjs`: `writeFile(... flush:true)` Node 22, `persistPrune()` com rollback em erro de disco, fail-closed de create/claim/ACK, tombstones por pedido e ausência de reenvio de `unknown`.
7. Confirmar `GET /v1/agent/status` com autenticação **administrativa**: segredo do agente deve receber HTTP 401, token MCP retorna `agent_online` apenas se poll autenticado recente (≤30 s), nunca `physical_print_verified=true`. Endpoint só será LIVE após deploy da nova versão do broker.
8. Na PR #12 verificar `src/printserver-client.mjs` `agentStatus()` (GET), e `scripts/verify-printserver-smoke.mjs`. A ferramenta pública `crm_consultar_impressao_etiqueta` ainda não propaga este diagnóstico: NÃO declarar que a presença do agente está disponível no ChatGPT sem evidência.
9. CI `PrintServer Validation` (Node 22, Windows parser PowerShell 5.1) e os dois workflows `Validate MCP` / `MCP validation` devem estar SUCCESS no HEAD. Se o CI estiver verde no SHA atual, não repetir testes globais.

## FASE C — PUBLICAÇÃO CIRÚRGICA SOMENTE SE NECESSÁRIA
10. Se o broker não tiver a revisão atual de hardening, preparar backup NOVO restrito de `jobs.json` e configurar rollback de código, sem jamais sobrescrever pedidos posteriores. Confirmar 0 jobs `claimed`/em voo. Fazer rollout do broker somente dentro da autorização operacional estabelecida, preferindo janela sem trabalhos.
11. Verificar `GET /v1/agent/status` como admin a partir da VPS e `npm run printserver:smoke:read` do ambiente MCP. Resultado `agent_online=true` só significa agente autenticado recentemente e spooler relatando pronto no último polling; não prova papel.
12. A nova telemetria é opcional e não deve quebrar a consulta antiga do job nem aumentar catálogo além de 33 tools. O MCP `f6f93b5` já funcionou no teste real; preservar o serviço se não houver um motivo concreto para reiniciá-lo.
13. Não editar CRM Laravel, legacy status API, Nginx, DNS, Z-API, driver Windows ou permissões de operadores nesta entrega.

## FASE D — VEREDICTO HONESTO
- Confirmar que existe um *single-job real* aceito pelo ChatGPT e que não foi reenviado. Separar `queued`, `spooled`, `physical_output_verified`.
- Reportar campos: SHAs base/HEAD/live, CI, liveness, último poll agente, fila, resultado físico, impressão única, rollback, bloqueios e GO/NO-GO.
- A etapa FOTO → ALTERAÇÃO DE STATUS 10 → WHATSAPP → IMPRESSÃO ainda depende de um endpoint seguro no CRM com transação/locking/idempotência/outbox; documentar mas **não** implementar via `PUT /api/orders/status` legado.
- Se surgir falha, corrigir só a causa identificada e nunca repetir impressão às cegas. Nenhum loop de testes.

**Importante:** o operador já autorizou impressão real para homologação, mas nesta etapa uma impressão real já foi enviada e retornou `spooled`. Não há benefício em imprimir novamente sem primeiro verificar a etiqueta que saiu.
