# Plano cirúrgico de homologação — AnnaHelena / LABEL

**Data 26/10/2026 · Rev 2**  
**Origem:** plano local `implementation_plan.md` do Antigravity, confrontado com os HEADs de `printserver#1` e `evydencia-crm-mcp#12`.  
**Não executar instalação, impressão, deploy ou escrita no CRM sem autorização explícita para o respectivo passo.**

## Auditoria dos fatos
- No notebook AnnaHelena, o script de diagnóstico **somente leitura** reportou: fila `LABEL`, driver `LABEL` v3, porta `USB001` LABEL-9X20, spooler `Running`, 0 trabalhos na amostra.
- O XML de capacidades anuncia `UserForm204` `Etiqueta` = **100 × 40 mm**; o PrintTicket ativo está ~**100 × 150 mm**. O Windows documenta dimensões em micrômetros.
- O PDF sintético #999999 foi relatado como gerado no checkout local do Antigravity, porém **não faz parte do Git** (PDF ignorado); portanto criamos um gerador versionado e reproduzível.
- As CI do PrintServer e MCP não demonstram impressão física nem broker remoto em execução. Os SHAs devem ser reconferidos na hora do handoff, sem confiar em CI de commit anterior.
- SumatraPDF 3.6.1 é release oficial existente e o URL versionado do ZIP x64 está no domínio oficial. O SHA256 do ZIP é cruzado com manifesto público do Scoop, **não com assinatura first-party do fabricante**.

## Correções sobre o plano original
1. **Corrigir causalidade:** `paper=Etiqueta` é uma opção suportada no CLI, não prova de que driver, gap, escala e firmware consumirão exatamente 40 mm. O teste físico é obrigatório.
2. **Corrigir TLS:** não copiar `tls internal` para um domínio público, a menos que todos os clientes tenham explicitamente a CA instalada. Preferir Caddy automatic HTTPS com CA pública, DNS/ACME e acesso de rede previamente autorizados. Nunca trocar/verificar certificados desabilitando a validação TLS.
3. **Separar ambientes:** o teste físico `SumatraPDF → LABEL` é totalmente **offline** e não necessita broker, MCP, credenciais ou tarefa automática. Só depois configurar a infraestrutura externa.
4. **Corrigir integridade do binário:** baixar 3.6.1 do fornecedor, verificar SHA256 do ZIP `98b33a518d42986856d225064b0cd2d3643ecf78cbf84ab873d26cc51877a544`, rejeitar divergências. Verificar assinatura Authenticode como observação adicional, não substituir checksum.
5. **Controlar impressão única:** usar `windows/Invoke-SyntheticPrintTest.ps1 -AuthorizeSinglePrint`, com PDF gerado pelo script do repositório, checagem de cabeçalho/PDF, texto estritamente sintético e `MediaBox` 100×40. Sem esse parâmetro nenhuma impressão ocorre.
6. **Segurança da máquina:** antes de qualquer `icacls`, conferir `whoami /user` e ACL atual; preservar acesso administrativo/SYSTEM quando necessário, não remover herança indiscriminadamente. Nunca imprimir ou colar o conteúdo do token em logs.
7. **Escopo consciente:** o MVP MCP ainda não altera status 10 nem dispara WhatsApp. Ele só oferece impressão se o pedido já estiver em status 10 com saldo zerado; o recurso `print.jobs.write` deve ser autorizado separadamente.

## Fases com gates objetivos

### G0 — Leitura / zero efeitos colaterais (já parcialmente cumprido)
- Confirme SHA exato de PR #1 e PR #12 e status verde das CI respectivas.
- No AnnaHelena `powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\scripts\Test-LabelPrinter.ps1`.
- Status esperado: `has_100x40_form=true`, `active_paper_matches_100x40=false` permitido no preflight (o CLI solicitará mídia explicitamente). Impressora `Normal`; `physical_print_verified=false`.
- Não repetir CI global se SHA idêntico e checks aprovados.

### G1 — Sumatra portátil, somente após autorização de INSTALAÇÃO
```powershell
powershell.exe -NoProfile -File .\scripts\Prepare-SumatraPortable.ps1
# Sem download: mostra origem, SHA e destino.
powershell.exe -NoProfile -File .\scripts\Prepare-SumatraPortable.ps1 -Install
& "C:\Evydencia\printserver\SumatraPDF.exe" -console -list-printers
```
- `-Install` baixa arquivo oficial e só extrai/copía após SHA igual; nunca substitui executável existente.
- Confirmar que o relatório de `-list-printers` mostra `LABEL` **e** mídia `Etiqueta`; se a seleção por nome falhar, **não tentar imprimir com padrão de 150 mm**. Investigar `paperkind=<id>` retornado pelo próprio SumatraPDF, sem adivinhar número.

### G2 — UMA impressão sintética, somente após autorização de IMPRESSÃO
```powershell
node scripts\Create-SyntheticLabel.mjs
powershell.exe -NoProfile -File .\windows\Invoke-SyntheticPrintTest.ps1
# A linha acima NÃO imprime.
powershell.exe -NoProfile -File .\windows\Invoke-SyntheticPrintTest.ps1 -AuthorizeSinglePrint
```
- Antes do último comando, operador confirma ter **rolo e gap preparados**, pode observar saída e autoriza **1** etiqueta de teste.
- A classificação `spooled` **não** comprova impressão física; pedir foto ou checklist do resultado: 1 etiqueta, orientação correta, 100mm de largura, 40mm de altura/avanço conforme rolo, corte/gap e contraste.
- Se o tamanho estiver errado, interromper; conferir via GUI driver/firmware e opções `paper`/`paperkind`. **Não executar a impressão uma segunda vez automaticamente.**

### G3 — Integração remota, NÃO executar como parte do teste físico
- Avaliar domínio proposto como hipótese; não presumir DNS existente nem expor VPS nova sem autorização.
- Service Node 22 sob usuário dedicado com persistência de `jobs.json`, bind `127.0.0.1:8097`. TLS público com Caddy sob domínio verificado, autenticação independente MCP/agent e logs sem PII.
- Token agent armazenado localmente com ACL verificada; `config.local.json` inicialmente `enable_printing=false` e `calibration_confirmed_100x40=false`.
- Depois de G2 aprovado, testar broker com fixture sintética e `-Once`, **sem** CRM real; só então registrar `windows/install-task.ps1` com `-WhatIf` seguido da instalação autorizada.

### G4 — MCP opt-in e operação real, etapa diferente
- Confirmar `EVYD_PRINT_ALLOWED_OPERATOR_IDS`, scope `print.jobs.write`, status 10 e saldo zero no CRM. Sem POST legado `PUT /api/orders/status`.
- Prévia sem efeito → confirmação explícita → uma intent de impressão → consultar status. `unknown`/409 não geram retry automático.
- Teste com dados reais e alterações de pedidos dependem de autorização e guardas financeiras do CRM. Não executados no G0–G3.

## Critérios de parada obrigatória
- Integridade do ZIP diverge, Binário inesperado, arquivo sintético inválido ou `MediaBox` incorreta.
- `LABEL`/mídia `Etiqueta` não anunciada, spooler indisponível ou erro do Sumatra.
- PrintTicket padrão 100×150 **não justifica ignorar o teste físico**.
- TLS não confiável, segredos fora de ACL, mismatch de operador, resultados `unknown` sem reconciliação.
- CI vermelha no SHA corrente: resolver apenas check correspondente; não rodar suite global indefinidamente.

## Fontes oficiais
- Sumatra [CLI e códigos](https://www.sumatrapdfreader.org/docs/Command-line-arguments)
- Sumatra [3.6.1 release](https://github.com/sumatrapdfreader/sumatrapdf/releases/tag/3.6.1rel)
- [Checksum SHA do manifesto Scoop](https://github.com/ScoopInstaller/Extras/blob/master/bucket/sumatrapdf.json) (terceira parte)
- Microsoft [PageMediaSize](https://learn.microsoft.com/en-us/windows/win32/printdocs/pagemediasize)
- Microsoft [Start-Process 5.1](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.management/start-process?view=powershell-5.1)
- Caddy [Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- Microsoft [icacls](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/icacls)
