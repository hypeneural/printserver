# Antigravity — publicação do PrintServer Broker na VPS do MCP

**Data:** 27/10/2026. **Escopo:** somente PrintServer PR #1, integração do gateway MCP na mesma VPS e diagnóstico **não invasivo** do agente Windows. Este runbook não autoriza exploração de outros repositórios, servidores ou bancos de negócios.

## Origem do código
- Branch GitHub: `feat/windows-label-mcp-broker-20261026`, PR #1.
- HEAD homologado antes deste runbook: `05756319acb22b4ae0ecce494912d971fdf9bf68`. Conferir HEAD/CI vivos antes de qualquer mudança.
- O trabalho local antigo `e94be13d1f68860434a17a642b91f551feef9fa0` está preservado apenas no clone da estação. Nunca `push --force`, `reset --hard`, `cherry-pick` nem renomear a branch para substituí-lo. O runner canônico já é `scripts/validate-agent-local.mjs`; não incorporar `agent-validate-local.mjs` duplicado.
- `git fetch origin` e `git worktree add --detach ..\printserver-release-check origin/feat/windows-label-mcp-broker-20261026` a partir do clone local, em diretório NOVO não existente. Rodar `npm run agent:validate:local` no worktree novo; CI GitHub deve ter sucesso no SHA exato.
- Se o worktree destino existir ou a árvore base não estiver limpa, STOP; não resetar branches antigas.

## Alvo e preflight
1. **VPS MCP autorizada**: identificar host por inventário e verificação da instância antes de SSH ou sudo. O broker é `evydencia-printserver.service`, não um serviço de dados comerciais.
2. `systemctl show evydencia-printserver.service -p ActiveState -p SubState -p MainPID -p WorkingDirectory -p FragmentPath`. Verificar `/opt/evydencia-printserver`, `/var/lib/evydencia-printserver/jobs.json` e health em `127.0.0.1:8097`.
3. Inspecionar com privilégios mínimos e **sem revelar conteúdo de dados/segredos** o backlog `queued/claimed/unknown`. Qualquer impressão em trânsito ou estado duvidoso exige reconciliação; não parar serviço em trabalho ativo.
4. Anotar último SHA implantado e rollback de código; gerar snapshot privado durável de `jobs.json` (com tombstones) e das configurações não secretas sem expor PII.
5. `PRINTSERVER_REQUIRE_CRM_ARTWORK=0` durante a implantação inicial compatível. Não modificar flags financeiras ou operações comerciais.

## Rollout condicional
1. Se a versão já coincide com o HEAD aprovado e os health checks passam, **não reinstalar nem reiniciar**.
2. Se difere, usar mecanismo existente de implantação que preserva worktree ativo, usuário `evydmcp` e dados duráveis. NÃO executar `git checkout` arbitrário sobre pasta operando sem snapshot/rollback. Reiniciar apenas `evydencia-printserver.service` após confirmar ausência de job ativo.
3. Health `/healthz` e resposta autenticada somente leitura da fila. O agente Windows deve fazer polling de saída via HTTPS, sem portas inbound.
4. Após o gateway MCP estar na revisão compatível com PNG/QR e a renderização canônica validada, habilitar `PRINTSERVER_REQUIRE_CRM_ARTWORK=1` para bloquear etiquetas mínimas antigas. A mudança de flag exige restart controlado e verificação da fila.
5. Qualquer resposta 409, timeout ou `unknown`: **não repetir** automaticamente o job; registrar necessidade de reconciliação com o operador.

## Hardware Windows — sem alteração
- Impressora física `LABEL`, porta `USB001`, papel `Etiqueta` 100×40 mm, agente `windows/agent.ps1` PowerShell 5.1 e SumatraPDF portátil são componentes existentes.
- No host local, somente `npm run agent:validate:local`, `Get-Service Spooler`, `Get-Printer -Name LABEL` e `Get-PrintJob -PrinterName LABEL` para diagnóstico. Não reinstalar tarefa, driver, Sumatra, mudar fila, imprimir fixture ou tocar no token do agente como resultado do deploy do broker.
- `spooled` não comprova saída de papel, nem QR válido no material físico.

## Entrega
SHA do broker no GitHub + VPS, CI do mesmo SHA, snapshot/rollback verificados, health, estado de fila, compatibilidade com o gateway, impressão física **não realizada** durante deploy e decisão GO/NO-GO. Nenhuma alteração ou inspeção de sistemas fora da VPS MCP.

Referências oficiais: https://git-scm.com/docs/git-worktree e https://www.freedesktop.org/software/systemd/man/latest/systemctl .
