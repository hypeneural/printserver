# Validação local do agente — somente este checkout
**27/10/2026 · escopo fechado · sem produção e sem impressão real**

## Objetivo único
Certificar sintaxe do broker Node 22, contratos de persistência e idempotência, geração de PDF físico 100 × 40 mm e sintaxe dos scripts do Windows PowerShell 5.1 **sem executar nenhum desses scripts operacionais**.

## Limites de execução
- Diretório permitido: somente este checkout e suas subpastas. Não investigar, ler, clonar ou citar outro repositório ou diretório de projeto.
- Não acessar SSH, rede, VPS, gerenciadores remotos, chaves, arquivos `config.local.json` ou credenciais.
- Não editar driver, spooler, tarefas agendadas, fila LABEL nem executar SumatraPDF.
- Não chamar `agent.ps1` em modo operacional; **apenas análise sintática**.
- Não invocar `Invoke-SyntheticPrintTest.ps1` nem `Invoke-CrmArtworkPrintTest.ps1`, mesmo com flag de impressão.
- Não fazer checkout destrutivo, reset, merge, force-push, release ou deploy.

## Um comando autorizado
Na raiz deste projeto:
```powershell
npm run agent:validate:local
```
Executa testes sintéticos de broker e PDF sem conexão remota. No Windows, usa o parser nativo PowerShell 5.1 para checar os scripts **sem dot-source/import/execução**. Retorna JSON com `ok`, `steps`, tempos e confirmação `physical_print_performed=false`. Se `ok=true` no mesmo SHA, não repetir.

## Contratos a conferir
- Fila persistente, tombstones e ausência de retry em `unknown`.
- Aceitação somente de PNG com SHA-256 e dimensão correta no modo estrito.
- PDF 100 × 40 mm, sem redesenho de QR; no agente, limites e checksum validados.
- `spooled` significa apenas aceitação da submissão, não confirmação física.
- Scripts de PowerShell e configuração de exemplo devem permanecer fail-closed.

## Reconciliação de commits locais divergentes

O runner oficial deste repositório é `scripts/validate-agent-local.mjs`, executado por `npm run agent:validate:local`. **Não criar, importar, substituir ou publicar uma cópia com o nome `scripts/agent-validate-local.mjs`.** A CI inclui `test/agent-validator-contract.test.mjs`, que reprova duplicações.

Um resultado `LOCAL_PASS` de outro commit não prova que aquele SHA foi enviado à PR, nem que o serviço em produção o utiliza. Para conferir o estado do checkout sem descartá-lo:
```powershell
git status --short
git rev-parse HEAD
git branch -vv
git log -5 --oneline
```
Se existir commit local próprio com runner alternativo, preservar histórico e **não fazer push, reset, rebase, merge ou cherry-pick automático**. Apenas registrar o SHA e informar que o arquivo duplicado não deve entrar na PR. O validador oficial já está versionado e aprovado; a decisão de integrar qualquer alteração não duplicada pertence à revisão técnica.

**Escopo da aprovação:** testes sintéticos e parser local. Nenhum desses scripts precisa ser implantado como serviço, nem substitui teste funcional de impressão física, fila remota ou release de aplicação.

## Entrega
Informar somente SHA local **deste repositório**, `PASS/FAIL` do comando, número de etapas e um problema concreto reproduzido, se houver. Não realizar nova impressão física ou consulta ao serviço remoto como parte desta tarefa.

Fontes oficiais: Microsoft Parser.ParseFile https://learn.microsoft.com/en-us/dotnet/api/system.management.automation.language.parser.parsefile?view=powershellsdk-7.0.0 ; Node child_process https://nodejs.org/api/child_process.html .
