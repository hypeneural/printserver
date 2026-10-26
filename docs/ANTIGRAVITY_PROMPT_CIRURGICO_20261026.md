# Prompt de continuação — Antigravity (G0/G1/G2 sem loop)

Faça a homologação **somente local e sintética** da impressora térmica LABEL no notebook AnnaHelena usando a PR #1 do PrintServer e PR #12 do Evidência MCP, com mínimo de comandos.

1. Leia `AGENTS.md`, `docs/HOMOLOGACAO_ANTIGRAVITY_REVISADA_20261026.md` e o diff corrente da PR #1. Confirme o SHA e CI; não repita testes se aprovados no mesmo SHA.
2. Execute `scripts/Test-LabelPrinter.ps1` read-only. O esperado é LABEL/USB001 e mídia 100×40 disponível, podendo o perfil padrão continuar em 100×150. **Não alterar a configuração do driver automaticamente.**
3. Antes de instalar, execute `scripts/Prepare-SumatraPortable.ps1` sem `-Install`. Se houver autorização de instalação, execute exatamente uma vez com `-Install`; valida SHA do ZIP oficial 3.6.1. Em seguida rode `SumatraPDF.exe -console -list-printers`. Se mídia Etiqueta não constar, pare.
4. Gere um PDF sintético apenas com `node scripts/Create-SyntheticLabel.mjs`. Execute `windows/Invoke-SyntheticPrintTest.ps1` sem flag para comprovar que é inerte. Se houver autorização específica para a impressão, use **uma única vez** `-AuthorizeSinglePrint`; não repetir em erro ou timeout. Faça registro de exit_code/estado e solicite confirmação visual do papel ao operador.
5. Após confirmação física, entregue um relatório conciso: SHA, versão Sumatra, opção de mídia, exit_code, resultado de corte/gap, necessidade de ajustar driver e ações pendentes. Não instalar task Windows, habilitar agente, configurar VPS/Caddy, publicar MCP, usar CRM real, chamar Z-API ou enviar WhatsApp nesta fase.
6. Se aparecer erro, pare no primeiro bloqueio material, registre erro e corrija só o arquivo necessário. Não refazer testes globais sem alteração de código.

**Não pedir autorização novamente para uma etapa que o operador já autorizou explicitamente nesta mesma execução; porém instalação e impressão física são ações diferentes.** Não afirmar `impresso fisicamente` por retorno `spooled`. O plano não autoriza deploy.
