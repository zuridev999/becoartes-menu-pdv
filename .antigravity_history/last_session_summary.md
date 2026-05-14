# 🧠 Memória Compartilhada - Projeto Becoartes
**Última Atualização:** 14/05/2026 - 20:13

Olá! Se você é o Antigravity de outro computador, este arquivo contém o contexto vital para continuar o trabalho no Becoartes sem perder tempo.

---

## 🚀 Infraestrutura e Deploy
- **Servidor (VPS):** `72.60.252.50` (root)
- **Chave SSH:** `~/.ssh/id_rsa_becoartes_ed`
- **Diretório na VPS:** `/root/becoartes-operational`
- **Método de Deploy:** `git push origin main` seguido de `docker compose up -d --build` na VPS.
- **Domínios ativos:** 
  - `tablet.becoartes.com` (Modo Quiosque)
  - `pdv.becoartes.com`
  - `coz.becoartes.com`

---

## 📱 Modo Quiosque e Tablet (APK)
Focamos hoje em estabilizar o Modo Quiosque para tablets Android.

### 🔑 Comandos Secretos (Busca do Tablet):
- **`0044`**: Ativa Modo Tela Cheia (Browser Fullscreen).
- **`0040`**: Sai do Modo Tela Cheia.
*(Estes comandos limpam o campo de busca e não aparecem para o cliente).*

### 📦 Aplicativo Nativo (APK):
- Foi gerado um APK nativo usando **Capacitor**.
- **Caminho Local (deste Mac):** `~/Desktop/becoartes-tablet.apk`
- **Configuração:** O app aponta para o site, mas tem permissões nativas de **Wake Lock** (não apaga a tela) e **Kiosk Mode** (API do Fully Kiosk Browser integrada).

### 🛡️ Travas de Segurança:
- **Pull-to-refresh (arrastar para baixo):** Bloqueado via CSS (`overscroll-behavior: none`) e via JS (interceptor de `touchmove`).
- **Botão Home:** Bloqueio deve ser feito via **Fully Kiosk Browser** ou **Fixação de Tela** do Android.

---

## 🛠️ Modificações Recentes no Código
1.  **`PWAHandler.tsx`**: Centraliza a lógica de Fullscreen, Wake Lock e API do Fully Kiosk.
2.  **`index.html`**: Contém o script de bloqueio de gestos ultra-agressivo.
3.  **`sw.js`**: Service Worker atualizado com estratégia *Network First* para evitar telas brancas.
4.  **`MenuCatalog.tsx`**: Intercepta a busca para processar os códigos `0044` e `0040`.

---

## 📋 Próximos Passos
- Monitorar a instalação do APK nos tablets físicos.
- Ajustar layouts caso surjam problemas de visualização em tablets específicos (landscape).

---
*Este arquivo serve como ponte de memória entre sessões.*
