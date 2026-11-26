# Segurança do Meu Ponto

Objetivo: **ninguém consegue ver ou alterar dados de outro usuário, nem ler o banco “por fora”** — seja olhando o código do site, seja fazendo pentest nas APIs.

## 1. Entenda o modelo (o mais importante)

- **O código do site sempre é visível.** Todo app web entrega HTML/JS ao navegador; qualquer pessoa pode abrir o DevTools. Ofuscar ou minificar não protege nada — só atrapalha quem mantém. Por isso **nenhum segredo fica no código**.
- **`docs/config.js` não é segredo.** A `apiKey` do Firebase é um identificador público do projeto (o Google documenta isso). Saber a chave não dá acesso aos dados.
- **Quem protege os dados é o servidor**, em camadas:
  1. **Regras do Firestore** (`firestore.rules`): cada pedido é checado no Google. Só passa quem está logado, com e-mail verificado, e apenas em `usuarios/{o próprio uid}`. Todo o resto é negado — inclusive listar usuários.
  2. **App Check**: só o seu app publicado (com token do reCAPTCHA) consegue falar com Firestore e Auth. Scripts, Postman e bots ficam de fora.
  3. **Restrição da chave de API** no Google Cloud: a chave só funciona a partir do seu domínio e só para as APIs que o app usa.
  4. **Cabeçalhos HTTP** (`firebase.json`): CSP, HSTS, anti-clickjacking — dificultam XSS e roubo de sessão.
- **Chaves privadas de verdade** (conta de serviço) ficam **só** no GitHub Secrets. Nunca no repositório, nunca no app.

## 2. Checklist antes de abrir ao público

### Firebase Authentication
- [ ] Ativar só **E-mail/senha** e **Google**. Desligar provedores não usados (telefone/SMS, anônimo…).
- [ ] **Settings › Proteção contra enumeração de e-mail**: ligada (o app também responde igual no “esqueci a senha”).
- [ ] **Settings › Política de senha**: mínimo 8, letras + números, modo *Exigir*.
- [ ] **Domínios autorizados**: só o seu domínio e `SEU-PROJETO.web.app`/`firebaseapp.com`. Tire `localhost` em produção.
- [ ] Modelos de e-mail (verificação/senha) com o nome do app e, se possível, domínio próprio de remetente.
- [ ] (Opcional) Atualizar para **Identity Platform** para ter limite de cadastros por IP, bloqueio por região e MFA.

### Firestore
- [ ] Banco criado em **modo produção** (nunca deixe a regra temporária do “modo de teste”).
- [ ] `firestore.rules` publicadas (o workflow faz isso). Confira em **Firestore › Regras** se a data/versão bate.
- [ ] Testar no **Rules Playground** (Firestore › Regras › Playground):
  - `get /usuarios/OUTRO_UID/dias/2026-11-25` autenticado como outro uid → **negado**
  - `list /usuarios` → **negado**
  - `get` sem autenticação → **negado**
  - `create` com campo extra (ex.: `admin: true`) → **negado**
- [ ] **Não** guarde dados pessoais além do necessário (o app guarda só horários e ajustes; o e-mail fica no Auth).

### App Check
- [ ] Registrar o app Web com **reCAPTCHA v3** (ou Enterprise) e colar a *chave do site* em `config.js`.
- [ ] Acompanhar **App Check › APIs** por alguns dias: “Solicitações verificadas” devem ser ~100%.
- [ ] Clicar em **Aplicar** para **Cloud Firestore** e **Authentication**. A partir daí, chamadas sem token válido são recusadas — mesmo com a apiKey.

### Google Cloud (console.cloud.google.com, mesmo projeto)
- [ ] **APIs e serviços › Credenciais › a chave “Browser key”**:
  - *Restrições de aplicativo*: **Referenciadores HTTP** → `https://SEU-DOMINIO/*`, `https://SEU-PROJETO.web.app/*`, `https://SEU-PROJETO.firebaseapp.com/*`.
  - *Restrições de API*: só **Identity Toolkit API**, **Token Service API**, **Cloud Firestore API**, **Firebase App Check API**, **Firebase Installations API**, **FCM Registration API** e **Firebase Cloud Messaging API**.
- [ ] **IAM**: a conta de serviço do deploy só com *Administrador do Firebase Hosting* + *Administrador do Firebase Rules*. Ninguém além de você como Proprietário.
- [ ] Ative **verificação em duas etapas** na sua conta Google (ela é a “chave mestra” do banco).
- [ ] **Faturamento**: fique no plano Spark (sem cobrança) ou, no Blaze, crie **alerta de orçamento** — protege contra ataques que tentam gerar custo.
- [ ] (Recomendado) Trocar a chave JSON por **Workload Identity Federation** (deploy do GitHub sem chave guardada).

### Lembretes (notificador)
- Cada usuário só grava `avisos/{seu uid}` e `usuarios/{seu uid}/push`. O app manda só **horário e tipo**; o **texto** da notificação é montado no servidor — ninguém consegue usar o serviço para mandar mensagens arbitrárias, nem para aparelhos de outra pessoa.
- O notificador marca o aviso como enviado **antes** de enviar (sem duplicados) e apaga tokens de aparelhos que não existem mais.
- Ao **sair da conta**, o aparelho deixa de receber lembretes daquela conta; ao **apagar a conta**, os aparelhos e lembretes são apagados.
- O endereço `/run` do Worker só responde com o cabeçalho `x-run-key` correto (16+ caracteres, comparação em tempo constante). Sem ele, retorna só `ok`.
- [ ] (Recomendado) Crie uma conta de serviço **só para o notificador** com os papéis **Usuário do Cloud Datastore** e **Administrador da API Firebase Cloud Messaging**, e coloque o JSON no secret `NOTIFIER_SERVICE_ACCOUNT`. Assim o Worker não tem permissão de publicar o site nem mudar regras.

### GitHub
- [ ] Repositório **privado** (o código do site continua visível no navegador, mas configs, histórico e workflows ficam reservados).
- [ ] Settings › Code security: **Secret scanning** e **Push protection** ligados; **Dependabot** ligado (já há `.github/dependabot.yml`).
- [ ] **Branch protection** na `main` (sem force-push; exigir o check *Verificar*).
- [ ] Ambiente **`producao`** com *Required reviewers* = você: nenhum deploy sai sem sua aprovação.
- [ ] Verificação em duas etapas na conta do GitHub.

### Hospedagem e front-end (já feito no código)
- CSP sem `unsafe-inline`/`unsafe-eval` em scripts, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`.
- HSTS (2 anos), `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` bloqueando câmera/microfone/localização.
- O app nunca usa `innerHTML`/`eval` com dados (os testes checam); horários são validados no app **e** nas regras.
- CSV exportado é protegido contra *injeção de fórmula* no Excel.
- O service worker não guarda respostas de Auth, Firestore ou anúncios.
- Anúncios rodam em iframes de outra origem (Google): **não leem** o `localStorage` nem os dados do Firestore.

## 3. Faça você mesmo um “pentest” básico

1. **Sem login, direto na API** (deve dar `403 PERMISSION_DENIED`, ou `401` com App Check aplicado):
   ```bash
   curl "https://firestore.googleapis.com/v1/projects/SEU-PROJETO/databases/(default)/documents/usuarios"
   ```
2. **Logado como A, lendo dados de B**: no DevTools do app logado com a conta A, rode
   `firebase.firestore().doc('usuarios/UID_DO_B').get()` → deve falhar com *Missing or insufficient permissions*.
3. **Cabeçalhos**: teste o domínio em <https://observatory.mozilla.org> e <https://securityheaders.com> (meta: nota A).
4. **Senha fraca / e-mail inexistente**: tente criar conta com `1234` (deve recusar) e “Esqueci a senha” com e-mail que não existe (deve mostrar a mesma mensagem).
5. Depois de **mudar regras**, sempre repita o Playground do item 2 acima.

## 4. Limites honestos

- Quem tem a **senha da conta** de um usuário vê os dados dele — por isso a política de senha e, se possível, MFA (Identity Platform).
- **Você**, como dono do projeto Firebase, consegue ver os dados no console. Proteja sua conta Google com 2FA e não compartilhe acesso.
- App Check reduz muito o abuso, mas não é infalível; as **regras** continuam sendo a barreira principal. Nunca relaxe as regras contando só com o App Check.
- O AdSense coloca cookies próprios — isso está explicado na política de privacidade e depende do consentimento.

## 5. Se algo der errado (incidente)

1. **Trancar tudo na hora**: publique uma regra `allow read, write: if false;` em `match /{caminho=**}` (o app continua funcionando offline).
2. **Chave vazada** (conta de serviço): Google Cloud › IAM › Contas de serviço › Chaves › **excluir**; gere outra e atualize o secret no GitHub.
3. **Conta de usuário comprometida**: Authentication › Usuários › **Desativar conta** (derruba as sessões).
4. Veja o que aconteceu em **Cloud Logging** e no uso do Firestore.
5. LGPD: se houver vazamento de dados pessoais, a ANPD e os titulares devem ser comunicados em prazo razoável.
