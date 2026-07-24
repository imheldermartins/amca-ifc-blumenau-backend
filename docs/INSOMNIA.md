# Testando o `/auth` no Insomnia (depois do cookie de sessão)

O contrato de autenticação mudou: **o refresh token não vem mais no corpo da
resposta.** Ele é gravado num cookie `HttpOnly` e volta pelo mesmo cookie. Se
você tinha o hábito de copiar o `refreshToken` do JSON do login, ele não existe
mais ali — e é de propósito (um XSS não pode ler cookie `HttpOnly`).

Este guia mostra como testar o fluxo novo.

## O que mudou, em uma linha

| Antes | Agora |
|---|---|
| `login` devolvia `{ accessToken, refreshToken }` | devolve `{ user, accessToken }` — o refresh vai no `Set-Cookie` |
| `refresh` recebia `{ refreshToken }` no corpo | recebe o cookie + o header `X-Cubs-Client` — **corpo vazio** |
| logout não existia | `POST /auth/logout` revoga a sessão no servidor |

## O cookie jar do Insomnia

O Insomnia guarda cookies automaticamente, **por ambiente**, num "cookie jar".
Depois do login o `cubs_rt` aparece lá sozinho, e as próximas requisições o
reenviam sozinhas — você não copia nada.

- Ver/limpar: no painel do ambiente, **Manage Cookies** (ou o ícone de cookie
  perto da barra de request).
- É o primeiro lugar a olhar quando um request autenticado dá 401 sem motivo
  aparente: quase sempre é cookie velho/duplicado. **Limpar o jar e refazer o
  login resolve.**
- Em dev o cookie **não** é `Secure` (o backend serve por http), então o jar o
  aceita em `http://localhost:3000` sem cerimônia.

## Passo a passo

### 1. Login

```
POST http://localhost:3000/api/auth/login
Body (JSON): { "email": "voce@exemplo.com", "password": "suasenha" }
```

Resposta: `{ "user": {...}, "accessToken": "eyJ..." }`. Confira em **Manage
Cookies** que o `cubs_rt` foi gravado.

**Dica de encadeamento:** para não copiar o `accessToken` à mão em todo request,
crie uma variável de ambiente `accessToken` como _response template tag_: no
header, digite `Bearer ` e insira a tag (Ctrl/Cmd+Space) do tipo **Response →
Body Attribute**, apontando para o request de login com o filtro `$.accessToken`
e trigger **Always**. Depois é só `Authorization: Bearer {{ accessToken }}` nos
outros requests.

### 2. Uma rota autenticada qualquer

```
GET http://localhost:3000/api/auth/me
Header: Authorization: Bearer {{ accessToken }}
```

Deve devolver o seu usuário. Este é o request que o guard de rota do frontend
usa para saber quem está logado.

### 3. Refresh (renovar o access token)

```
POST http://localhost:3000/api/auth/refresh
Header: X-Cubs-Client: web
Body: (VAZIO)
```

- **Sem corpo.** A credencial é o cookie `cubs_rt`, que o Insomnia reenvia
  sozinho.
- **O header `X-Cubs-Client` é obrigatório** — sem ele a resposta é **403**. É
  a guarda de CSRF: um site terceiro não consegue definir header customizado.
- A resposta é `{ "accessToken": "novo..." }`, e o cookie é **rotacionado**
  (o antigo deixa de valer).

### 4. Logout (e a prova da revogação)

```
POST http://localhost:3000/api/auth/logout
Header: X-Cubs-Client: web
```

Responde **204** e limpa o cookie. O que o torna diferente de "só apagar o
cookie": ele **revoga no servidor** (incrementa o `token_version` da conta).

Para provar: **antes** do logout, copie o valor do `cubs_rt` do jar. Depois do
logout, cole-o de volta no jar e chame `/auth/refresh` — deve dar **401**
mesmo com o cookie "válido". Sem a revogação, aquele refresh valeria por mais 7
dias.

## Pegadinhas

- **403 no refresh/logout** → faltou o header `X-Cubs-Client`.
- **401 no refresh logo após o login** → cookie jar sujo (cookie velho de outra
  sessão); limpe e refaça o login.
- **Apontando para PRODUÇÃO** → lá o cookie é `__Host-cubs_rt` e exige `Secure`,
  ou seja, **HTTPS**. Se você mirar um endpoint de prod em `http://`, o Insomnia
  **descarta o cookie em silêncio** e nada autentica. Use `https://`.
- **`GET /auth/me` dá 401 mas o login deu certo** → o `accessToken` não está no
  header `Authorization`, ou expirou (vida de 15 min). Rode o refresh.

## Referência

Contrato completo das rotas: `src/core/auth/auth-router.ts`. Política do cookie
por ambiente: `src/core/auth/cookie.config.ts`. Revogação: a migração
`token_version` e `auth-controller.revoke`.
