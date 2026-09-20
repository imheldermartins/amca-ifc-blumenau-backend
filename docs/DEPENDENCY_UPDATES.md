# Atualização manual de dependências

As dependências diretas do backend usam versões exatas no `package.json`. As
transitivas ficam fixadas pelo `package-lock.json`; por isso `npm ci` reproduz a
mesma árvore até que uma atualização seja feita deliberadamente. O `.npmrc`
mantém `save-exact=true`, inclusive para pacotes adicionados no futuro.

O `packageManager` também fixa a versão do npm. As etapas de dependências do
Dockerfile instalam essa mesma versão antes de executar `npm ci`; ao atualizar
o npm, altere os dois pontos juntos.

`@types/node` acompanha o major 24 do Node fixado na imagem de produção. Ele
pode aparecer no `npm outdated` quando já existir um major de Node mais novo;
isso é intencional e só deve mudar junto com o runtime.

## Pacotes npm

1. Confira o que mudou e os avisos de segurança:

   ```powershell
   npm run deps:outdated
   npm run deps:audit
   ```

2. Atualize somente os pacotes escolhidos, sempre gravando a versão exata:

   ```powershell
   npm install --save-exact pacote@latest
   npm install --save-dev --save-exact pacote-de-dev@latest
   ```

3. Revise scripts de instalação. O projeto permite apenas o `esbuild` na versão
   auditada:

   ```powershell
   npm install-scripts ls
   npm install-scripts prune --dry-run
   npm install-scripts prune
   npm install-scripts approve esbuild
   ```

4. Valide e revise o diff de `package.json` e `package-lock.json`:

   ```powershell
   npm ci
   npm audit
   npm test
   npx tsc --noEmit
   npm run build
   ```

Não use `npm audit fix --force`: ele pode atravessar versões major sem a revisão
e os testes necessários.

## Imagens Docker

As imagens base estão fixadas por tag completa e digest nos Dockerfiles. O
Dockerfile executa `npm run build` numa etapa separada e a imagem final recebe
somente `dist`, `package.json` e dependências de produção. Para atualizá-las,
obtenha a nova versão estável, faça o pull e copie o digest exibido:

```powershell
docker pull node:<node>-alpine<alpine>
docker image inspect node:<node>-alpine<alpine> --format '{{index .RepoDigests 0}}'

docker pull rqlite/rqlite:<versão>
docker image inspect rqlite/rqlite:<versão> --format '{{index .RepoDigests 0}}'
```

Atualize tag e digest juntos em `Dockerfile` e `docker/rqlite/Dockerfile`. Depois:

```powershell
docker compose -f docker/docker-compose.dev.yml config --quiet
docker compose -f docker/docker-compose.prod.yml config --quiet
docker compose -f docker/docker-compose.prod.yml build --pull backend rqlite
```

Em produção, o entrypoint do backend aguarda o healthcheck do rqlite via
Compose, aplica migrations pendentes e só então inicia o servidor. Defina
`RUN_MIGRATIONS=false` apenas em uma execução operacional consciente que não
deva migrar.
