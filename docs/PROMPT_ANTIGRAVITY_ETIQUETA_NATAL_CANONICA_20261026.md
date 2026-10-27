# PROMPT CIRÚRGICO — ANTIGRAVITY | Etiqueta canônica de Natal no PrintServer

**Objetivo:** homologar, com menor fricção, a substituição do PDF simples pelo PNG/QR Code REAL já gerado por `OrderLabelService` no Laravel, sem reimplementar layout. O fluxo de impressão física já foi comprovado no AnnaHelena, mas a paridade visual nova precisa de UMA homologação sintética.

Repositórios:
- `hypeneural/evydencia-crm` (**somente leitura**, `main` atual)
- `hypeneural/evydencia-crm-mcp` PR #12, branch `feat/printserver-bridge-20261026`
- `hypeneural/printserver` PR #1, branch `feat/windows-label-mcp-broker-20261026`

**Leia antes** os `AGENTS.md` aplicáveis e o dossiê `evydencia-crm-mcp/docs/AUDITORIA_ETIQUETA_NATAL_CANONICA_20261026.md`. A imagem da cliente fornecida pelo gestor é apenas referência visual: NÃO incluí-la no código, logs ou fixtures.

## 1. Não refazer trabalho pronto
O CRM já possui `OrderLabelService`, `OrderLabelDataResolver`, `OrderLabelTemplateResolver`, `OrderLabelRenderer`, `OrderLabelQrCodeRenderer`, `OrderLabelVariableResolver` e `config/order_label.php`. A etiqueta é produto/global/fallback, com PNG 100×40, logo/fundo, campos, QR dinâmico. O código novo usa diretamente o **serviço de produção** pelo PHP CLI read-only.

O QR NÃO deve ser criado por um gerador Node genérico; preserve o URL efetivo do CRM e as opções do QR instalado (chillerlan 2.0.8). Não presumir que o URL do preset legado `http://minhas.fotosdenatal.com/{id}` é o URL de todo pedido atual. Validar no celular o QR sintético e o QR de um pedido de teste autorizado.

## 2. Preflight e CI (não repetir sem SHA novo)
1. Verifique HEAD exato e workflows da PR #12 e PR #1; anote verde/vermelho por SHA.
2. Inspecione APENAS o diff relevante: MCP `scripts/crm-label-render-bridge.php`, `src/crm-label-render.mjs`, `scripts/crm-label-synthetic-fixture.php`, `src/live-gateway.mjs`; PrintServer `src/crm-label-pdf.mjs`, `src/broker.mjs`, `windows/Invoke-CrmArtworkPrintTest.ps1` e testes.
3. Verifique que não houve alteração no Laravel. Execute `php -l` dos dois scripts PHP e `npm run check` somente caso CI exija.

## 3. Teste visual LOCAL, totalmente sintético
Na máquina/ambiente em que o Laravel está disponível com `vendor/autoload.php`, `bootstrap/app.php` e os assets do Natal:
```powershell
# Executar a partir de C:\Projetos\hypeneural\evydencia-crm-mcp
$env:EVYD_CRM_APP_PATH = 'C:\Projetos\hypeneural\evydencia-crm'
php -l .\scripts\crm-label-render-bridge.php
php -l .\scripts\crm-label-synthetic-fixture.php
php .\scripts\crm-label-synthetic-fixture.php
```
Se não houver Laravel completo no AnnaHelena, executar no host de validação que JÁ tenha a stack, sem instalar dependências na produção nem copiar credenciais de clientes.

No checkout do PrintServer (repositório irmão):
```powershell
node .\scripts\wrap-crm-label-fixture.mjs
powershell.exe -NoProfile -File .\windows\Invoke-CrmArtworkPrintTest.ps1
```
O último comando sem flag DEVE resultar em `NOT_EXECUTED`. Abrir o PDF de teste em `test-output/crm-label-natal-synthetic.pdf` e conferir o modelo preto/branco do Natal, ícones/fundo, nome/pacote/data/WhatsApp e QR.

**Uma impressão física sintética já autorizada pelo gestor**, se ainda não executada para esse modelo no mesmo hardware/driver:
```powershell
powershell.exe -NoProfile -File .\windows\Invoke-CrmArtworkPrintTest.ps1 -AuthorizeSinglePrint
```
Executar exatamente uma vez; zero retries automáticos. Confirmar com inspeção visual **uma etiqueta física**, tamanho 100×40, contraste, QR escaneável por smartphone, alinhamento, margens/gap e picote. `spooled` não é papel confirmado.

## 4. Validação de ponta a ponta sem impressão de cliente
- `src/crm-label-render.mjs`: compara UUID/ID, SHA-256, MIME/prefixo PNG, largura/altura 100×40. Falha de PHP/asset/QR bloqueia impressão, sem cair na etiqueta simples.
- `src/crm-label-pdf.mjs`: trata PNG GD RGB/RGBA e alpha, verifica CRC e dimensões, gera XObject em PDF de uma página.
- `src/broker.mjs`: recusa hashes incorretos; na flag `PRINTSERVER_REQUIRE_CRM_ARTWORK=1` recusa qualquer job simples antigo.
- `crm_solicitar_impressao_etiqueta`: só após OAuth `print.jobs.write`, confirmação explícita, pedido no status 10 e saldo zero. O payload do PNG vai do PHP privado ao broker; imagem/URL do QR não aparecem ao ChatGPT.
- Prévia até 20 IDs continua somente leitura. Sem fazer novas baixas, pagamentos ou envios Z-API.

## 5. Plano de ativação SEM corrida entre versões
1. Não presumir que HEAD das PRs está implantado: registrar SHA real do broker/gateway e snapshot privado do `jobs.json` (sem sobrescrever tombstones).
2. Durante janela operacional controlada sem jobs em voo, publicar primeiro **suporte binário de PNG no broker** com `PRINTSERVER_REQUIRE_CRM_ARTWORK=0` (compatibilidade), smoke sintético.
3. Depois publicar gateway com `EVYD_CRM_LABEL_RENDER_ENABLED=0`, checar PHP CLI/CRM assets no host. Somente após sucesso, ativar `EVYD_CRM_LABEL_RENDER_ENABLED=1`; certificar que nenhuma etiqueta simples está sendo criada e que o broker lê PNG.
4. Por fim, ativar `PRINTSERVER_REQUIRE_CRM_ARTWORK=1` no broker, para impedir qualquer downgrade silencioso. Coordenar o momento com agente/fila e usuários; rollback deve preservar jobs e tombstones, nunca repetir impressão em estado `unknown`.
5. Atualizar o conector ChatGPT apenas se contrato/metadados realmente mudarem; não há nova ferramenta, catálogo esperado continua **33**.
6. Não mexer no Laravel, Nginx, QR dos pedidos reais, versão da impressora, driver, WhatsApp ou status nesta entrega.

## 6. Próximo fluxo operacional por foto (separar escopos)
Para 5, 10 ou 15 fotos: reconhecer IDs com confiança, buscar no CRM via `crm_previa_malotes_retirada`, mostrar elegibilidade financeira e estado, pedir confirmação por pedido.
- **Só etiqueta:** permite apenas pedido JÁ em status 10 + saldo zero.
- **Só baixa:** NÃO implementado pelo MCP; requer endpoint canônico transacional do CRM.
- **Baixa + etiqueta:** NÃO executar sem resultado positivo/idempotente do endpoint de baixa, depois gerar PNG do CRM e imprimir.
- Não inferir ID do CRM a partir do ID de laboratório na foto.
- Não chamar `PUT /api/orders/status` legado nem afirmar que status 10 prova WhatsApp entregue.

## Resultado esperado
Relatório único e curto:
SHAs da PR e da produção, testes/CI, arquivo PNG sintético (privado), PDF 100×40, fotografia/conferência da etiqueta física, resultado do QR, status do pipeline 33 ferramentas/OAuth, plano rollback, bloqueios. Marcar explicitamente **GO/NO-GO** do novo template. Se algum teste falhar, corrigir somente a causa e repetir apenas o teste afetado; nada de loop global.
