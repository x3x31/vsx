# Broker do vsx

Pequeno serviço que troca o **código da autorização OAuth por um token do
GitHub** para o vsx publicado no GitHub Pages.

Por que ele é necessário: `github.com/login/oauth/access_token` **não envia
cabeçalhos CORS**, então o navegador não consegue fazer essa troca sozinho
(ESPECIFICACAO.md §2.1). É a única tarefa do broker — e ele faz isso sem
guardar credencial de ninguém:

```
janela do GitHub  →  redireciona para o vsx com ?code=...
vsx (Pages)       →  POST /oauth/exchange {code, code_verifier}
broker            →  troca com github.com e devolve {token, login}
vsx (Pages)       →  guarda o token no localStorage e conecta
```

## Publicando (uma vez só)

```sh
cd broker
npx wrangler login                       # conta gratuita
# edite wrangler.toml e cole o Client ID do OAuth App do vsx
npx wrangler deploy
```

O deploy imprime o endereço, por exemplo:

```
https://vsx-broker.seuusuario.workers.dev
```

Cole esse endereço em `js/broker.js` (constante `DEFAULT_BROKER_URL`) e faça
o commit — ou informe na interface, em **Conectar com GitHub → Configuração
avançada → Endereço do broker** (fica salvo no navegador).

## Configuração

| Variável | Onde | O que é |
| --- | --- | --- |
| `VSX_CLIENT_ID` | `wrangler.toml` | Client ID do OAuth App do vsx |
| `VSX_ALLOWED_ORIGINS` | `wrangler.toml` | Origens autorizadas (use `*.github.io` para aceitar forks) |
| `VSX_CLIENT_SECRET` | `wrangler secret put VSX_CLIENT_SECRET` | Só se a troca responder `incorrect_client_credentials` |
| `VSX_GITHUB_TOKEN_URL` · `VSX_GITHUB_USER_URL` | `wrangler.toml` | Para apontar para um GitHub simulado nos testes |

### OAuth App (o mesmo serve para todos os usuários)

Um único OAuth App atende **qualquer** pessoa: o visitante só autoriza a
própria conta.

1. <https://github.com/settings/developers> → **OAuth Apps** → **New OAuth App**
2. **Authorization callback URL**: `https://x3x31.github.io/vsx/`
   (tem de bater caractere a caractere com o `redirect_uri` do vsx)
3. Cole o **Client ID** em `VSX_CLIENT_ID` no `wrangler.toml`

> O `client_secret` fica no broker (`wrangler secret put VSX_CLIENT_SECRET`),
> nunca no navegador. O fluxo também usa PKCE, então o código só é trocado
> na janela que iniciou a autorização.

## Sem broker?

O vsx continua aceitando **token pessoal** (PAT) e continua funcionando com a
**ponte local** (`npm start` ou `npm run start:public`) — a ponte também
expõe `POST /oauth/exchange` com o mesmo contrato e devolve o token para o
navegador.

## Testando

```sh
npm test          # na raiz do repositório: broker + ponte
npm run test:e2e  # fluxo completo no navegador (requer npx playwright install chromium)
```
