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

### Comando Seguro:
```bash
git fetch origin main --tags
git pull --ff-only origin main
VITE_APP_VERSION=v1.x.x VITE_APP_COMMIT=$(git rev-parse --short HEAD) docker compose up -d --build
```

## 5. Auditoria Pré-Deploy
- Verificar commit atual: `git rev-parse --short HEAD`
- Verificar versão atual: `git describe --tags --abbrev=7`
- Validar build: `npm run build` ou `tsc -b`
