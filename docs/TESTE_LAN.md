# Teste temporário na LAN

IP Wi-Fi desta máquina: `192.168.1.27`.

O celular e o computador devem estar na mesma rede Wi-Fi. O celular acessa
somente o frontend; ele encaminha `/api` e `/socket.io` para o backend, então
não é necessário apontar o celular para rqlite.

Em três terminais, execute:

```powershell
# C:\Projects\cubs-backend
docker compose -f docker/docker-compose.dev.yml --env-file docker/.env.lan up -d
npm run dev:lan

# C:\Projects\cubs-frontend
npm run dev:lan
```

No celular, abra `http://192.168.1.27:5173`.

## Portas e segurança

| Serviço | Porta | Exposição no perfil LAN |
| --- | ---: | --- |
| Frontend Vite | 5173 | Necessária para o celular |
| Backend + Socket.io | 3000 | Publicada para diagnóstico; o frontend a usa via proxy |
| rqlite | 8000 | Publicada só para diagnóstico temporário |

O rqlite não possui autenticação nesta configuração. Não o acesse pelo
celular, não use esta configuração fora da rede local e encerre o compose ao
terminar (`docker compose -f docker/docker-compose.dev.yml --env-file docker/.env.lan down`).

Se o celular não abrir a página, permita conexões de entrada TCP na porta 5173
no perfil de rede **Privado** do Firewall do Windows. As portas 3000 e 8000 só
precisam ser liberadas se você quiser diagnosticá-las diretamente de outro
dispositivo.

Abra o PowerShell **como Administrador** e execute, uma vez, para liberar só o
frontend na rede privada:

```powershell
New-NetFirewallRule -DisplayName "Cub's LAN temporary test (Vite 5173)" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -Profile Private
```

Após o teste, remova a regra:

```powershell
Remove-NetFirewallRule -DisplayName "Cub's LAN temporary test (Vite 5173)"
```
