# Protocolo Técnico: Versionamento e Deploy Becoartes PDV

## 1. Regra de Ouro
**GitHub main + tag de versão são a fonte da verdade.** 
Nunca sobrescrever produção sem saber qual commit está no ar.

## 2. Ecossistema Unificado
O build é único para múltiplas frentes. O nome da frente é resolvido dinamicamente por hostname com `getAppLabel()`.
- **Exemplo:** `PDV v1.0.5 • commit` | `Cozinha v1.0.5 • commit`

## 3. Fluxo de Release (Local)
1. `git fetch origin --tags`
2. `git checkout main` && `git pull origin main`
3. Incrementar `version` no `package.json`.
4. `git add .` && `git commit -m "Mensagem clara"` && `git push origin main`
5. Criar tag: `git tag -a pdv-v1.x.x -m "Versão v1.x.x"`
6. `git push origin pdv-v1.x.x`

## 4. Fluxo de Deploy (VPS)
**IMPORTANTE:** Nunca usar `git reset --hard` ou `git clean -fd` sem autorização explícita (risco de apagar o `.env`).

**Regra operacional atual:** usar `/root/becoartes-operational-release` como diretório de release.
Não usar `git pull` às cegas em `/root/becoartes-operational`, porque esse caminho já teve alterações sujas antigas.

### Fluxo Seguro Atual:
```bash
APP_COMMIT=$(git rev-parse --short HEAD)
APP_VERSION=v1.x.x

rsync -az --delete \
  --exclude ".git" \
  --exclude "node_modules" \
  --exclude "dist" \
  --exclude ".env" \
  --exclude "_reports" \
  --exclude "local-delivery.db" \
  --exclude "local-delivery.db-shm" \
  --exclude "local-delivery.db-wal" \
  ./ root@72.60.252.50:/root/becoartes-operational-release/

ssh root@72.60.252.50 "cd /root/becoartes-operational-release && VITE_APP_VERSION=$APP_VERSION VITE_APP_COMMIT=$APP_COMMIT docker compose up -d --build"
npm run postdeploy:delivery
```

Ou, apos todos os preflights e com autorizacao explicita:

```bash
DELIVERY_DEPLOY_CONFIRM=deploy-delivery-release npm run deploy:delivery:release
```

Sem essa confirmacao textual, o script de release aborta antes de qualquer `rsync`.

> Observação: no servidor, preservar `.env` real e não imprimir tokens/chaves no terminal compartilhado.

## 4.1 Delivery
Antes de ativar `delivery.becoartes.com`, confirmar:

- Seguir `_reports/delivery-cutover-runbook.md` como runbook principal.
- Rodar `npm run preflight:delivery` localmente para registrar commit, versao, compose e DNS sem imprimir segredos.
- Rodar `npm run preflight:delivery:vps` para checar VPS/release/nginx/docker sem ler `.env` nem fazer deploy.
- Rodar `npm run deploy:delivery:release` sem confirmacao e confirmar que ele aborta antes de `rsync`.
- Rodar `DELIVERY_PREFLIGHT_STRICT=1 npm run preflight:delivery` somente quando o DNS de delivery ja estiver criado e a falha deve bloquear o deploy.
- `delivery.becoartes.com` no DNS apontando para a VPS.
- `nginx.conf` ou proxy ativo aceitando `delivery.becoartes.com`.
- `DELIVERY_PAYMENT_PROVIDER=mock` no primeiro deploy.
- `DELIVERY_LOGISTICS_PROVIDER=disabled` no primeiro deploy.
- `DELIVERY_KITCHEN_DISPATCH_MODE=mock` no primeiro deploy.
- `PAGBANK_NOTIFICATION_URL=https://delivery.becoartes.com/api/delivery/webhooks/pagbank` somente na homologação PagBank.
- `DELIVERY_KITCHEN_DISPATCH_MODE=production` somente em teste presencial controlado.
- `DELIVERY_LOGISTICS_PROVIDER=ifood` somente em homologacao iFood com `IFOOD_SHIPPING_MODE=dry_run` primeiro.
- Para chamada real iFood Shipping, confirmar latitude/longitude do cliente e `quoteId` de `deliveryAvailabilities`.

## 5. Auditoria Pré-Deploy
- Verificar commit atual: `git rev-parse --short HEAD`
- Verificar versão atual: `git describe --tags --abbrev=7`
- Validar build: `npm run build` ou `tsc -b`
- Validar lint: `npm run lint`
- Validar compose: `docker compose config`
- Validar domínios existentes antes e depois: `pdv`, `tablet`, `coz`, `bar`, `qr`.
- Validar `delivery` por último com `npm run postdeploy:delivery`.
