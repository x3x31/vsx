# Guia do aluno — vsx com GitHub Codespaces

Este guia mostra o caminho mais simples para usar o **vsx** com **GitHub Codespaces**: um Codespace por aluno, isolado, sem configurar ponte manualmente e sem instalar o OpenCode à mão.

## 1) Pré-requisitos

- Conta no [GitHub](https://github.com)
- Acesso ao repositório-template do vsx (fornecido pelo professor)
- Créditos/cota gratuitos do GitHub Codespaces na sua conta pessoal

## 2) Criar seu Codespace

1. Acesse o **repositório-template** fornecido pelo professor.
2. Clique em **`Use this template` → `Open in a new codespace`** (ou **`Code` → `Codespaces` → `Create codespace on main`**).
3. Aguarde a inicialização. O `devcontainer` já vai:
   - Instalar o `@opencode/cli` globalmente
   - Rodar `npm install` (se necessário)
   - Subir a ponte do vsx em background na porta `4173`

A primeira vez leva **1–3 minutos**. Nas próximas vezes fica mais rápido.

## 3) Autenticar o provedor do OpenCode (uma única vez)

O vsx usa o **OpenCode** para ler e alterar arquivos. Ele precisa de pelo menos um provedor autenticado. Você só faz isso **uma vez** por Codespace.

Abra o **terminal integrado** do Codespace e rode:

```bash
opencode auth login
```

Siga o link/fluxo que abrir no navegador para autenticar o provedor desejado (Anthropic, OpenAI, etc.). Ao finalizar, pode fechar o navegador.

> **Alternativa (zero-config):** Se o professor configurou *Codespaces Secrets* com a chave do provedor (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ...), esse passo pode ser pulado.

## 4) Conectar o vsx ao seu Codespace

Tem duas formas simples:

### Opção A) Pela porta encaminhada do Codespaces (mais direto)

1. Na aba **PORTS** do Codespaces, localize a porta `4173` (vsx bridge).
2. Clique com o botão direito → **Make Public** (se ainda não estiver pública).
3. Copie a URL `https://...-4173.app.github.dev`.
4. Abra o [vsx no GitHub Pages](https://x3x31.github.io/vsx/).
5. Clique em **Conectar com GitHub** e autorize sua conta.
6. Clique em **Usar um workspace no Codespaces** (ou abra o modal **Conectar workspace no Codespaces**).
7. Cole a URL copiada e, se solicitado, o token da ponte (ele aparece no log do Codespace ou em `start-codespace`).

### Opção B) Descoberta automática (se disponível)

Em muitos casos o modal já sugere o workspace do Codespace conectado. Basta confirmar a URL e o token.

## 5) Usar para ler e alterar arquivos

1. Na barra lateral do vsx, selecione **seu repositório**.
2. Abra o **Terminal · OpenCode** (parte inferior).
3. Peça ao agente para ler ou alterar arquivos, por exemplo:
   - `"Leia o README.md e resuma em 3 pontos."`
   - `"Altere apenas src/app.js para corrigir o bug X. Não faça commit."`
4. Acompanhe as ferramentas e **aprove/rejeite** permissões quando aparecerem.
5. Revise as alterações no painel **Alterações (Git)** e faça **commit + push** pelo vsx quando quiser.

## 6) Dicas e boas práticas

- **Isolamento garantido:** Cada aluno tem seu próprio Codespace. Sessão, home, `opencode.db` e clone são exclusivos.
- **Não instale o OpenCode:** Já vem pré-instalado no devcontainer. Só autentique o provedor.
- **Economize cota:** Ao final da aula, você pode **Stop** ou **Delete** seu Codespace. Parado consome armazenamento; apagado limpa tudo.
- **Se o terminal ficar "processando..." sem resposta:** Verifique se fez `opencode auth login` ou se tem chave configurada. Rode `opencode models` no terminal do Codespace para conferir.
- **Se a ponte cair:** Geralmente volta sozinha, mas se necessário rode `bash .devcontainer/start.sh` no terminal do Codespace.

## Suporte

Em caso de dúvidas, siga as orientações do professor. O fluxo acima usa apenas o repositório-template + GitHub Pages, sem backend central mantido pelo projeto.
