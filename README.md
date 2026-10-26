# Evydência PrintServer — LABEL no AnnaHelena

Servidor de fila pequeno e agente PowerShell para imprimir etiquetas **100 × 40 mm** na térmica LeLONG/driver `LABEL` via SumatraPDF portátil. Projeto independente do Laravel e do EvydFlow. Sem PrintNode, sem mensalidade e **sem portas de entrada no notebook**.

## Topologia proposta

ChatGPT → Evidência MCP (OAuth operador e leitura CRM) → PrintServer broker HTTPS → agente PowerShell (poll HTTPS de saída) → SumatraPDF `-print-to "LABEL"` → Spooler USB001.

**Baixa do pedido não está implementada neste repositório.** O MCP só poderá gerar a impressão automática de um pedido cujo status **já está em 10** no CRM. O CRM continua sendo o único sistema que altera status e dispara WhatsApp. Nunca chamar a API legada de alteração de status diretamente.

## O que este MVP já contém

- `src/broker.mjs`: API pequena com autenticação Bearer separada para MCP e agente; fila persistente em arquivo JSON privado (um processo), criação idempotente **por pedido** da etiqueta de chegada, confirmação obrigatória, timeout de claim sem reenvio automático e descarte do PDF após ACK; marcador permanente de pedido mesmo após limpeza do histórico de trabalhos. Polls vazios não gravam JSON no disco.
- `src/pdf.mjs`: gerador PDF monofolha de 100 × 40 mm com dados mínimos do CRM, ASCII em Helvetica (a impressão inicial **não é cópia fiel da etiqueta visual do CRM**). Não contém telefone, preço ou CPF.
- `windows/agent.ps1`: Windows PowerShell 5.1, consulta a fila com HTTPS, checksum SHA-256, impressão em `LABEL` com opção explícita `paper=Etiqueta,noscale`, retorno `spooled` (= aceito pelo executável/spooler, não prova física). Limite de uma cópia. Sem impressão enquanto `enable_printing=false`.
- `windows/install-task.ps1`: instalação opcional de tarefa ao login do usuário atual, sem serviço novo e sem instalar Node no AnnaHelena.
- `scripts/Test-LabelPrinter.ps1`: diagnóstico somente leitura.
- `test/broker.test.mjs`: Node test runner, sem impressora nem rede externa.

## Instalação do broker (VPS, separado do CRM)

Requer Node.js ≥22; executar `npm test` e `npm run check`.

Definir secrets **fora do repositório** e diferentes entre si (min. 32 caracteres):
```text
PRINTSERVER_BIND=127.0.0.1
PRINTSERVER_PORT=8097
PRINTSERVER_DATA_FILE=/var/lib/evydencia-printserver/jobs.json
PRINTSERVER_MCP_TOKEN=<segredo exclusivo entre MCP e broker>
PRINTSERVER_AGENT_TOKEN=<segredo exclusivo entre notebook e broker>
```
Iniciar `node src/server.mjs` como usuário Linux sem privilégio. Expor `/v1/agent/*` **somente via HTTPS** e proxy reverso dedicado na VPS, mantendo o processo em loopback. Restringir firewall, rate-limit, body-size, TLS e IP quando possível. Não compartilhar os tokens entre serviços e não deixar JSON da fila acessível publicamente. A rota `/v1/jobs` usa credencial exclusiva do MCP. Fornecer a mesma origem HTTPS ao gateway MCP (`EVYD_PRINTSERVER_URL`) e ao agente (`broker_url`). Nenhuma mudança no Caddy foi aplicada aqui.

API (campos exemplificados com dados sintéticos):
- `POST /v1/jobs` (MCP Bearer): `{request_id:UUID,order_id:5001,operator_id:"42",status_key:"waiting_product_retrieve",confirmed_by_operator:true,purpose:"arrival",customer_name:"Cliente Exemplo",package_name:"Pacote Teste"}` → 201 com job; 200 replay. Outros status são 422; conflito desconhecido 409.
- `GET /v1/jobs/{job_id}` (MCP Bearer): somente status, sem conteúdo do PDF.
- `POST /v1/agent/claim` (agente Bearer, body `{}`) → PDF em base64 + SHA + token de lease, ou `job:null`.
- `POST /v1/agent/ack` (agente Bearer) → `{job_id,lease_token,result:"spooled"|"failed"}`.

**Garantias:** um pedido recebe no máximo um trabalho automático de chegada; reimpressão exigirá fluxo e aprovação separados. Claim perdido, processo Sumatra excedendo 90s ou resultado incerto torna resultado `unknown` (nunca reenfileira sozinho). Estado `spooled` não garante a saída do papel. PDF expira após 15 min se nunca foi retirado da fila; o broker usa armazenamento em disco protegido. Evitar vários workers broker no mesmo arquivo; MVP suporta processo único.

## Instalação no AnnaHelena (Windows 11 Pro)

1. Fazer checkout do repositório no Windows. Baixar a **versão portátil oficial** do [SumatraPDF](https://www.sumatrapdfreader.org/download-free-pdf-viewer) para `C:\Evydencia\printserver\SumatraPDF.exe` (verificar origem, assinatura e versão). Não incluir binário no GitHub.
2. Executar `powershell -NoProfile -File .\scripts\Test-LabelPrinter.ps1`; a evidência de 26/10/26 indicava fila `LABEL`, driver `LABEL` v3/203dpi, USB001 e formulário `Etiqueta` 100×40 cadastrado, mas **tamanho padrão 100×150**. Verificar com `SumatraPDF.exe -list-printers` se há o papel `Etiqueta`, testar página PDF **sintética** em `-print-to "LABEL" -print-settings "noscale,paper=Etiqueta,monochrome,1x" `. Não assumir que formato está correto antes do papel físico.
3. Copiar `windows/config.example.json` para `windows/config.local.json`. Ajustar `broker_url` e localização do executável. Criar o arquivo local `agent-token.txt` (fora do Git) com `PRINTSERVER_AGENT_TOKEN`; restringir ACL ao usuário da tarefa; nunca enviar esse token no ChatGPT ou issues.
4. Manter `enable_printing=false` e `calibration_confirmed_100x40=false` até aprovação de uma etiqueta sintética física e do HTTPS/broker. Após homologação, configurar **ambos** como `true` e executar `powershell -NoProfile -File .\windows\agent.ps1 -Once`, em ambiente com somente job sintético.
5. Depois instalar a tarefa sob o usuário logado: `powershell -NoProfile -File .\windows\install-task.ps1 -WhatIf`, e então retirar `-WhatIf` quando autorizado. A tarefa inicia no login, sem privilégios elevados. Ela **não** trabalha com o usuário deslogado; essa é a limitação consciente do MVP.

## Segurança/privacidade
- Repositório **público**: proibido armazenar nomes/telefones reais, etiquetas, tokens, log detalhado ou PDFs.
- Dados mínimos do cliente são transmitidos ao broker em HTTPS e permanecem temporariamente no disco privado até ACK/expiração. Definir política de retenção/backup e autorização antes de produção.
- Permissão independente no MCP para impressão; confirmação humana explícita antes de criar trabalho. O browser não recebe secrets de impressão.
- Nenhum job real de CRM/WhatsApp, envio de foto ou impressão física foi executado nesta implementação.

## Próximas entregas
Conectar ferramentas do MCP: prévia por fotos / consulta de pedido (read-only), solicitar impressão somente após leitura do status 10 (sem mexer no CRM), acompanhar trabalho. A baixa automática exige endpoint seguro de negócio no CRM e depende das correções de financeiro/concorrência; não usar `PUT /api/orders/status` legado.

## Referências oficiais
- SumatraPDF: https://www.sumatrapdfreader.org/docs/Printing
- PowerShell Scheduler: https://learn.microsoft.com/en-us/powershell/module/scheduledtasks/register-scheduledtask
- PowerShell PrintManagement: https://learn.microsoft.com/en-us/powershell/module/printmanagement/get-printconfiguration
- MCP security: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
