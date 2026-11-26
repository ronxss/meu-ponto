# Meu Ponto — que horas eu saio?

App (PWA) feito a partir do artefato **Calculadora de Ponto**, aberto ao público e mantido por **anúncios (Google AdSense)**.

- **Bater ponto com um toque**: a tela principal tem um único botão que registra, na ordem, **entrada → saída para o almoço → retorno do almoço → saída**, mostra a saída prevista e quanto falta. Dá para desfazer o último registro e marcar "hoje sem almoço".
- **Jornada configurada uma vez** no primeiro acesso (horas por dia + tempo de almoço); muda em **Ajustes**.
- **Histórico e banco de horas** por mês, com correção de dias (ou lançamento de dia esquecido) e exportação em CSV.
- **Lançamentos só com login** (e-mail/senha com e-mail verificado, ou Google): sincroniza entre aparelhos; cada pessoa só enxerga os próprios dados. A cópia offline fica separada por conta e é apagada ao sair.
- **Lembretes por notificação 2 min antes** de bater o ponto de **volta do almoço** e de **saída**, com o app fechado (Android, computador e iPhone com o app instalado na Tela de Início).
- **Funciona offline** e instala como app (Android, iPhone e computador).
- **LGPD**: baixar todos os dados e apagar dados + conta pelo próprio app; política de privacidade em `docs/privacidade.html`.

## Como funciona

```
 Visitante ─ app (docs/) ── HTTPS + App Check ──> Firebase Auth   (login)
                         └─────────────────────> Firestore: usuarios/{uid}          (ajustes)
                                                            usuarios/{uid}/dias/{data} (horários)
                         └─────────────────────> Firestore: avisos/{uid}            (horários dos lembretes)
                                                            usuarios/{uid}/push/{token} (aparelhos com lembrete)
                         └─ anúncios (iframes do Google AdSense, sem acesso aos dados)

 Notificador (Cloudflare, a cada minuto) ── avisos vencidos ── Firebase Cloud Messaging ──> aparelhos do usuário
```

| Pasta/arquivo | O que é |
|---|---|
| `docs/` | O app: `index.html`, `app.js` (tela, login, sincronização, anúncios), `ponto.js` (motor de cálculo do artefato), `sw.js` (offline), `config.js` (Firebase/AdSense — valores públicos), `privacidade.html`, `ads.txt` |
| `notifier/` | Notificador sem dependências: `worker.mjs` (Cloudflare Workers, a cada minuto) e `run.mjs` (Node, para testar) |
| `wrangler.toml` | Configuração do Worker |
| `firestore.rules` | Cada usuário só lê/escreve `usuarios/{seu uid}`; formato dos dados validado; o resto é negado |
| `storage.rules` | Storage bloqueado (o app não usa) |
| `firebase.json` | Hospedagem + cabeçalhos de segurança (CSP, HSTS, anti-clickjacking…) |
| `.github/workflows/` | `publicar.yml` (deploy) e `verificar.yml` (testes + busca de chaves vazadas) |
| `SEGURANCA.md` | **Checklist de segurança — leia antes de abrir ao público** |

## Colocar no ar (igual ao meal-routine, ~30 min)

> **Só pelo celular:** configure o secret `FIREBASE_SERVICE_ACCOUNT` e a variável `FIREBASE_PROJECT_ID` (Settings › Secrets and variables › Actions), crie o ambiente `producao` (Settings › Environments) e rode Actions › **Publicar** › *Run workflow*. Cada push na `main` em `docs/` ou nas regras publica de novo.

### 1. Firebase (grátis, plano Spark)
1. Em <https://console.firebase.google.com> crie o projeto (ex.: `meu-ponto`). **Não** ative o Google Analytics se não for usar.
2. **Authentication › Sign-in method**: ative **E-mail/senha** e **Google**. Em **Settings**: deixe ligada a *Proteção contra enumeração de e-mail* e configure a *Política de senha* (mínimo 8, exigir letras e números, “Exigir”).
3. **Firestore Database**: crie em **modo produção**, região `southamerica-east1`.
4. **Configurações do projeto › Seus apps**: adicione um app **Web** e copie o `firebaseConfig` para `docs/config.js`.
5. **App Check**: registre o app Web com **reCAPTCHA v3** e cole a *chave do site* em `appCheckSiteKey`. Depois de alguns dias vendo as métricas, clique em **Aplicar** para Firestore e Authentication (veja `SEGURANCA.md`).
6. Conta de serviço para o deploy: Google Cloud › IAM › Contas de serviço › criar, com os papéis **Administrador do Firebase Hosting** e **Administrador do Firebase Rules** (não use “Proprietário”). Gere a chave JSON, cole no secret do GitHub e **apague o arquivo** do computador.

### 2. Publicar
```bash
npm i -g firebase-tools
```
```bash
firebase login
```
```bash
cp .firebaserc.example .firebaserc   # troque SEU-PROJETO pelo ID
```
```bash
firebase deploy --only hosting,firestore:rules
```
O app fica em `https://SEU-PROJETO.web.app`.

### 3. Domínio próprio (necessário para os anúncios)
O AdSense só aprova sites em um domínio que você controla — o endereço `*.web.app` não serve. Registre um domínio (ex.: `meuponto.com.br` no registro.br) e conecte em **Hosting › Adicionar domínio personalizado**. Depois:
- Em **Authentication › Settings › Domínios autorizados**, adicione o domínio e remova `localhost` quando não estiver desenvolvendo.
- Na restrição da chave de API (ver `SEGURANCA.md`), inclua o domínio.

### 4. Anúncios (Google AdSense)
1. Crie a conta em <https://adsense.google.com>, adicione o site (o domínio próprio) e aguarde a aprovação. Dica: o Google rejeita sites com pouco conteúdo — vale ter páginas de ajuda (ex.: “como calcular banco de horas”, “intervalo na CLT”).
2. Troque `pub-0000000000000000` em `docs/ads.txt` pelo seu ID de editor.
3. Em **Anúncios › Por bloco de anúncios**, crie dois blocos **Display** responsivos (“Hoje” e “Histórico”) e preencha em `docs/config.js`:
   ```js
   adsense: { client: "ca-pub-SEU_ID", slots: { hoje: "1234567890", hist: "0987654321" } }
   ```
4. Em **Privacidade e mensagens**, ative a mensagem de consentimento do Google se for atender visitantes da Europa.

O app só carrega anúncios depois que a pessoa escolhe no aviso de consentimento; quem recusa a personalização recebe anúncios genéricos. Os anúncios ficam em iframes do Google e **não têm acesso** aos horários do usuário.

### 5. Lembretes (notificações)
1. **Chave VAPID**: Firebase › ⚙️ Configurações do projeto › **Cloud Messaging** › *Configuração da Web* › **Certificados push da Web** › **Gerar par de chaves**. Copie a chave (é pública) para `vapidKey` em `docs/config.js`.
2. **Cloudflare** (grátis): crie a conta em <https://dash.cloudflare.com>.
   - **ID da conta**: aparece na página inicial do painel (Workers e Pages › lado direito, “Account ID”).
   - **Token**: ícone do perfil › *Meu perfil* › **Tokens de API** › *Criar token* › modelo **Editar Cloudflare Workers** › *Continuar* › *Criar token*.
3. No GitHub (Settings › Secrets and variables › Actions › Secrets), crie:
   - `CLOUDFLARE_API_TOKEN` = o token
   - `CLOUDFLARE_ACCOUNT_ID` = o ID da conta
   - `RUN_KEY` = uma senha longa qualquer (16+ caracteres), para testar o notificador
4. Rode Actions › **Publicar**. O job *Notificador* publica o Worker `meu-ponto-notificador`, que roda a cada minuto.
5. No app: **Ajustes › Lembretes › Ativar neste aparelho** e depois **Enviar teste** (chega em até 1 minuto).
   - No iPhone, só funciona com o app instalado na Tela de Início (iOS 16.4+) e aberto pelo ícone.
   - O lembrete do retorno do almoço é agendado quando você registra a **saída para o almoço**; o da saída usa a previsão do app e é recalculado no retorno.

Para ver se está rodando: Cloudflare › **Workers e Pages** › `meu-ponto-notificador` › **Logs** (uma linha por minuto com `usuarios`/`enviados`). O Worker não tem endereço público (`workers_dev = false`); para testar por `/run` com a `RUN_KEY`, registre um subdomínio `workers.dev` e mude para `true` em `wrangler.toml`.

### 6. Instalar no celular
- **Android/Chrome**: menu ⋮ › *Instalar app*.
- **iPhone/Safari**: Compartilhar › *Adicionar à Tela de Início*.

## Desenvolvimento
```bash
npm start      # serve docs/ em http://localhost:5173 (para lançar é preciso login no Firebase)
```
```bash
npm test       # cálculo + checagens de segurança (CSP, regras, segredos)
```

Ao mudar arquivos do app, aumente `CACHE` em `docs/sw.js` (ex.: `meu-ponto-v2`) para os celulares pegarem a versão nova.

O Meu Ponto é uma ferramenta de apoio e não substitui o registro oficial de ponto da empresa.
