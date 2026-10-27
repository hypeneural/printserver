# Auditoria forense — etiqueta natalina, malotes e handoff Antigravity (27/10/2026)

## Fontes e escopo
- CRM Laravel \`hypeneural/evydencia-crm\` **somente leitura**: \`OrderLabelService\`, \`OrderLabelRenderer\`, \`OrderLabelTemplateResolver\`, \`OrderLabelDataResolver\`, \`OrderLabelQrCodeRenderer\`, \`config/order_label.php\`.
- \`hypeneural/printserver\` PR #1 (\`feat/windows-label-mcp-broker-20261026\`).
- \`hypeneural/evydencia-crm-mcp\` PR #12 (\`feat/printserver-bridge-20261026\`).
- Relato Antigravity: PNG sintético \`1181×472\`, SHA \`b0f1743a18c763015838cb71e2913ca171e41aca163610a0bdc204077a1b84b4\`; PDF sintético \`100×40\` SHA \`fecad2ac193a3ec981ef23fcf74adc02fcc1c0fd3bd3e19997de5a723a671ef7\`; QR OpenCV \`http://minhas.fotosdenatal.com/999999\`; envio de uma etiqueta ao spooler Windows \`LABEL\` via SumatraPDF 3.6.1, exit 0.
- O relato afirma que a impressora ejetou papel, mas o script registra \`physical_print_verified:false\`. Não há evidência de leitura com smartphone ou aprovação visual assinada, nem canário da ferramenta MCP no novo build.
- Não imprimir novamente a mesma fixture para "reconfirmar"; a ação é irreversível e o resultado anterior foi \`spooled\`.
- **Não modificar CRM, Z-API, banco, driver, permissões nem produção neste PR.**

## Diagnóstico e correções confirmadas
| Risco | Causa raiz | Correção na PR |
|---|---|---|
| P0 — falha em etiqueta rica no agente | \`windows/agent.ps1\` rejeitava qualquer PDF \`>262144 bytes\`, embora o novo PNG→PDF possa superar esse limite | Suporte limitado a **5 MiB** com SHA-256 e assinatura PDF; teste de raster sintético 1181×472 que excede 256 KiB |
| P0 — job preso | Exceção de validação do arquivo após \`/agent/claim\` impedia \`/agent/ack\` | Payload não imprimível passa a receber \`failed\` via ACK (quando o lease é válido), sem reenvio automático |
| P1 — replay de arte incorreta | Sob \`PRINTSERVER_REQUIRE_CRM_ARTWORK=1\`, o broker poderia devolver replay de uma etiqueta **antiga minimal** como sucesso da arte do CRM | Replay agora retorna **409** com reconciliação manual; tombstones mantidos |
| P1 — memória/IO do broker | Até 500 PDFs raster poderiam ser armazenados em \`jobs.json\`; cada \`claim\`/ACK regrava snapshot | Backpressure de **32 MiB** de \`pdf_base64\` pendente; falha 503 antes de criar trabalho/tombstone |
| P1 — dado comercial defasado | \`legacy-api-read.mjs\` cacheava consultas forenses por 15 s, inclusive dados utilizados como guarda de impressão | MCP usa \`fresh:true\` para validação de status/financeiro imediatamente antes de enfileirar; prévia mantém cache |
| P1 — rajada de 15/20 fotos | \`Promise.all\` de 20 \`direct.detail\` poderia iniciar 20 PHP/Laravel lookups concorrentes | Prévia limitada a **quatro** leituras simultâneas, resultados na ordem original, duplicados removidos |
| P2 — alegação de GO amplo | Fixture gerada pelo **preset legado** não garante que cada pedido real hoje use a mesma personalização | Preparar canário autorizado de pedido real, sem incluir PII/log/arte no Git; GO apenas após prova de render efetivo |

## Arquitetura e limites
1. Foto de envelope → ChatGPT identifica **candidatos**; número de etiqueta do laboratório **não** é número de pedido do CRM.
2. \`crm_previa_malotes_retirada(order_ids[1..20])\`: somente leitura, status/saldo; quatro consultas simultâneas; resposta por ID.
3. Operador confirma pedidos e modo desejado. Modos solicitados: **só baixa**, **só imprime**, **baixa e imprime**. **Somente impressão já tem ferramenta** e requer pedido no status 10 + saldo exatamente zero.
4. \`crm_solicitar_impressao_etiqueta\` exige operador/OAuth \`print.jobs.write\`, confirmação explícita, leitura financeira sem cache, status 10, saldo zero; chama \`OrderLabelService::generate($uuid)\` no CRM Laravel existente. Não duplica QR nem fundo.
5. Broker confere SHA/CRC do PNG, encapsula imagem em PDF de 100×40 e persiste job por pedido. No modo estrito, nenhuma etiqueta simples é aceita.
6. Agente Windows 11 PowerShell 5.1 por tarefa no login faz polling HTTPS e imprime no \`LABEL\` com SumatraPDF. Erros/incerteza ⇒ **sem repetição automática**.
7. \`spooled\` é aceitação por executável/spooler, não prova física.
8. **Bloqueio comercial**: atualmente não existe MCP de escrita para status 10; \`PUT /api/orders/status\` legado é proibido. Para **só baixa** e **baixa+imprime**, ainda precisa de operação canônica transacional no CRM, com saldo e concorrência revalidados, idempotência, histórico e efeitos WhatsApp geridos pelo próprio CRM. Não tratar esse bloqueio como concluído.

## Riscos remanescentes: não liberar antes da verificação
- O broker mantém deduplicação \`arrival\` por pedido para sempre, impedindo reimpressão voluntária no mesmo contrato. **Não** limpar tombstones nem contornar pelo \`request_id\`; reimpressão autorizada requer contrato próprio, auditado, com razão e idempotência.
- \`MAX_JOBS=500\` conta jobs concluídos retidos por sete dias; grande volume semanal poderá causar 503 antes da limpeza. Avaliar nova política de retenção compatível com tombstones em tarefa separada, sem afetar este hotfix.
- A URL QR legada é HTTP com \`quietzone=0\`; o scanner OpenCV na fixture verifica conteúdo digital, NÃO operação do domínio ou leitura no papel. Validar redirecionamento, HTTPS, permissão da galeria e leitura real em aparelho; não trocar URL/config de cliente às cegas.
- A fixture canônica usa preset \`legacy_presets.natal\`, não necessariamente as configurações atuais por produto/global no banco. Comparação exata exige um pedido de homologação autorizado e \`OrderLabelService::generate\`, sem PII persistido no Git.
- Broker e gateway podem permanecer nos builds anteriores apesar de PR/CI verde. Consultar \`crm_capacidades.build_commit\` e \`systemctl\` antes de presumir produção.
- Laravel CLI PHP 8.3, GD, background, vendor e chillerlan disponíveis **segundo relato do Antigravity** na VPS; o ambiente ANNAHELENA não possui checkout Laravel/GD para executar a fixture localmente. **Não** instalar stack redundante no Windows: PHP produz arte na VPS; Windows só imprime.
- O operador deve atestar fisicamente legibilidade do QR e corte. A ausência dessa confirmação mantém o *go-live comercial* como NO-GO.

## Procedimento de homologação mínima, sem loops
1. \`git fetch origin\` e conferir worktrees/owner/branch atuais de PR #1 e #12; jamais fazer reset/force-push. Registrar HEADs reais e checks das PRs; as evidências do SHA anterior deixam de valer após novo commit.
2. Windows AnnaHelena **leitura apenas**: \`Get-Service Spooler\`, \`Get-Printer -Name LABEL\`, \`Get-PrintJob -PrinterName LABEL\`, \`Get-ScheduledTask -TaskName 'Evydencia - PrintServer LABEL'\`, \`Get-PrintConfiguration -PrinterName LABEL\`. Certificar spooler, status normal, \`Etiqueta\` 100×40, driver/USB001 e executável SumatraPDF. Não trocar papel/driver.
3. Ler \`windows/agent.ps1\` (corrigido limite e ACK), rodar CI exact-SHA / \`node --test test/crm-label-pdf.test.mjs\` se não houve receipt; \`powershell.exe -NoProfile -File windows/Invoke-CrmArtworkPrintTest.ps1\` **sem flag** → \`NOT_EXECUTED\`.
4. Não repetir impressão da fixture já enfileirada. Se o gestor inspecionou a etiqueta, coletar atesto **manual** de corte, texto e QR físico (no smartphone). Se não, registrar \`physical_print_verified:false\` e um único teste separado **somente** após aprovação específica para repetição, consultando os jobs antes.
5. VPS somente leitura: \`systemctl is-active evydencia-printserver evydencia-crm-mcp-live\`, \`curl -fsS http://127.0.0.1:8097/healthz\`, \`curl -fsS http://127.0.0.1:8090/healthz\`; checar SHAs implantados, logs redigidos e snapshots da fila **sem expor dados/segredos**. MCP \`crm_capacidades\` deve manter 33 tools e operador autorizado; build reportado anteriormente \`f6f93b5\` é anterior às melhorias desta PR.
6. Se houver autorização **específica para deploy**, janela sem jobs pendentes e com backup privado/rollback validado: publicar broker primeiro (artwork strict OFF), depois MCP (render OFF), conferir health, ativar render MCP e só então exigir strict no broker. **Não** usar \`git checkout\` de SHA colado em dossiê como estratégia de rollback: determinar last-known-good *implantado*, árvore/estado real, preservar fila/tombstones.
7. Se smoke pós-ativação retornar 409/422/timeout, **parar, consultar estado**, nunca clicar imprimir novamente para "ver se foi".
8. Concluir GO/NO-GO discriminado: arte digital, hardware físico, comunicação broker, escrita de baixa, WhatsApp, ChatGPT real. Não confundir os gates.

## Fontes oficiais auditadas
- PowerShell 5.1 Start-Process: https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1
- Windows PrintManagement Get-Printer: https://learn.microsoft.com/en-us/powershell/module/printmanagement/get-printer
- Windows Get-PrintJob: https://learn.microsoft.com/en-us/powershell/module/printmanagement/get-printjob
- SumatraPDF -print-to/-print-settings e códigos de retorno: https://www.sumatrapdfreader.org/docs/Command-line-arguments
- OpenAI MCP tool annotations: https://developers.openai.com/plugins/build/mcp-server
- QR quiet zone: https://www.qrcode.com/en/howto/code.html
