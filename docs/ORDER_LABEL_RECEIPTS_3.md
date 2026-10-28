# Etiqueta independente e recibos por pedido — #3

O broker aceita uma impressão autorizada sem representar uma mudança no CRM.
`purpose="order_label"` não exige status10 ou quitação. `status_key` contém o
estado real informado pelo conector, como string técnica ou `null` quando não
conhecido. A finalidade legada `arrival` continua exigindo
`waiting_product_retrieve`. Nenhuma finalidade altera pedidos ou pagamentos.

O contrato de `POST /v1/jobs` preserva autenticação admin, confirmação literal,
ID do pedido/operador, UUID da requisição, limites, arte e checksum existentes.
`PRINTSERVER_REQUIRE_CRM_ARTWORK=1` continua recusando fallback sem PNG canônico.
Não existe finalidade de reimpressão nem relaxamento da autenticação do agente.

## Consulta antes de despachar

`GET /v1/orders/{order_id}/label-job`, com a credencial admin existente:

```json
{
  "order_id": 5001,
  "state": "not_requested",
  "job": null,
  "needs_reconciliation": false,
  "printed_physically": false
}
```

- `not_requested`: não existe recibo nem tombstone conhecido para esse pedido.
- `queued`, `claimed`, `spooled`: há recibo; `job` contém seu ID e metadados.
  O conector acompanha o mesmo trabalho, sem criar outro.
- `failed`, `unknown`, `expired`: `needs_reconciliation=true`; não redespachar.
- `not_verified`: tombstone legado sem recibo; não inferir ausência de impressão.
- Recibo ativo sem trabalho correspondente ou arte mínima antiga em modo estrito
  também exige reconciliação. Um recibo `spooled` permanece consultável após
  remoção do trabalho antigo e permite replay sem nova impressão.

A consulta não enfileira trabalho nem acessa o CRM. Assim como a consulta por
job, pode persistir expiração ou a migração dos metadados da fila existente.
`GET /healthz` anuncia `capabilities.independent_order_labels=true` e
`capabilities.order_label_receipts=true`, sem divulgar credenciais ou pedidos.

## Persistência e compatibilidade

O arquivo mantém `version:2`, `jobs` e `seen_arrival_orders`. O campo aditivo
`order_label_receipts` contém recibos mínimos por pedido, sem nomes, contatos,
operador, PNG/PDF ou lease token. Jobs legados ainda presentes fornecem seus
recibos durante a migração; tombstones isolados continuam não verificados.

As duas finalidades compartilham deduplicação por pedido. Seus IDs também entram
em `seen_arrival_orders`, preservando a proteção do código anterior. Enqueue,
claim, ACK e expiração atualizam o recibo no mesmo snapshot atômico da fila;
falha de gravação restaura o estado anterior em memória. Jobs grandes podem ser
removidos depois da retenção existente; recibos e tombstones permanecem.

Recibos corrompidos, duplicados ou vinculados a trabalhos conflitantes impedem
inicialização. Não escolher arbitrariamente um dos trabalhos nem apagar a fila
para contornar a falha. A checagem inclui estado e metadados divergentes mesmo
quando o ID do trabalho coincide, para impedir regressão de `spooled` a `queued`.

No rollout, publicar o broker compatível antes do MCP, sem trabalho ativo. O
rollback preferido do MCP mantém este broker compatível. Um downgrade do broker
precisa preservar snapshot privado dos recibos: código antigo pode ignorar e
descartar o campo aditivo em gravações futuras. Os tombstones ainda evitam novo
despacho, mas o detalhe pode voltar a `not_verified`. Nunca restaurar uma fila
antiga sobre trabalhos já executados.

O protocolo de claim/ACK do agente Windows, driver, papel e tarefa agendada não
mudam. `spooled` comprova somente submissão ao executável/spooler; papel físico
e entrega de mensagens continuam sem prova neste contrato.

## Verificação offline

Testes sintéticos cobrem finalidade independente, legado, permissões, concorrência,
deduplicação cruzada, reinício, prune, lease expirada, recibos inválidos e rollback
após erros de disco. Executar o runner oficial `npm run agent:validate:local` no
SHA final; ele inclui a checagem sintática PowerShell5.1 sem executar o agente.
Nenhuma impressão real faz parte desse runner.
