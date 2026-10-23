# vsx no GitHub Codespaces

Este diretório empacota o vsx para rodar dentro de um Codespace. A interface
continua no GitHub Pages; o Codespace é o **workspace** de cada aluno
(ESPECIFICACAO.md §14).

## O que o devcontainer faz

- instala Node 22, `git`, `ripgrep` e `@opencode/cli@2.1.3`;
- encaminha a porta `4173`;
- no primeiro start, confere as ferramentas (`setup.sh`);
- a cada start, sobe a ponte em segundo plano (`start.sh`);
- grava a URL pública e a senha em `/tmp/vsx-codespace.log`.

## Como usar

1. Abra este repositório no Codespaces.
2. Aguarde o primeiro build/start.
3. Veja a URL e a senha:

   ```sh
   cat /tmp/vsx-codespace.log
   ```

4. Se a porta 4173 estiver privada, torne-a pública na aba **Ports** do
   Codespaces. A ponte continua exigindo a senha.
5. No vsx aberto no GitHub Pages, clique em **ponte: off-line**, informe a URL
   e a senha.
6. Configure o modelo no terminal do Codespace:

   ```sh
   opencode auth login
   opencode models
   ```

7. Para parar a ponte:

   ```sh
   kill "$(cat /tmp/vsx-codespace.pid)"
   ```

## Variáveis

| Variável | Uso |
| --- | --- |
| `BRIDGE_SECRET` | Senha da ponte; se não existir, é gerada e salva no config |
| `HOST` | Padrão `0.0.0.0` dentro do Codespace |
| `PORT` | Padrão `4173` |
| `VSX_PUBLIC_URL` | URL calculada a partir de `CODESPACE_NAME` e do domínio de forwarding |

## Limitações desta etapa

Esta é a **primeira parte** do §14: empacotamento e subida manual. A descoberta
automática do Codespace pelo frontend, a criação/retomada pela API do GitHub e
o botão de encerrar vêm nas próximas etapas.
