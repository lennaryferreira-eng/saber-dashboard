# saber-dashboard

Painel de indicadores das squads SABER/TER (V4 Company). App estático (`index.html` + `css/styles.css`), sem build step, deploy direto no Vercel. As funções em `api/` são serverless functions do Vercel — rodam no servidor, nunca no navegador.

## Arquitetura

- **`index.html`** — HTML + JS inline (sem framework). Os dados vivem em variáveis globais (`projects`, `auditorias`, `sinaisCulturais` etc.) sincronizadas com o Supabase.
- **`css/styles.css`** — estilos globais.
- **`api/`** — funções serverless. Cada arquivo é um endpoint (`api/foo.js` → `/api/foo`); `api/google/foo.js` → `/api/google/foo`. `api/_lib/` tem os helpers compartilhados (nunca é exposto como endpoint).
- **Persistência**: Supabase (chave anon pública, protegida por RLS — ver `SB_URL`/`SB_KEY`/`SB_TABLE` em `index.html`), com sync espelhado pro Google Sheets via Apps Script (`SHEETS_URL`, sem autenticação).

## Variáveis de ambiente (Vercel → Project Settings → Environment Variables)

| Variável | Obrigatória | Uso |
|---|---|---|
| `ANTHROPIC_API_KEY` | sim | `api/classify-signal.js` (classificação de sinais de cultura) e `api/evaluate-meeting.js` (avaliação de reunião via skill `avaliacao-reunioes-v4`) |
| `GOOGLE_CLIENT_ID` | só p/ fila do Drive | OAuth client (Google Cloud Console) |
| `GOOGLE_CLIENT_SECRET` | só p/ fila do Drive | idem |
| `GOOGLE_REDIRECT_URI` | só p/ fila do Drive | ex.: `https://<domínio>/api/google/callback` |
| `GOOGLE_REFRESH_TOKEN` | só p/ fila do Drive (conta única, fallback) | obtido uma única vez no setup abaixo |
| `GOOGLE_DRIVE_MEETINGS_FOLDER_ID` | opcional | restringe a busca de transcrições a uma pasta/Shared Drive específica (só a fila da conta única) |
| `GOOGLE_REDIRECT_URI_LOGIN` | sim (login) | ex.: `https://<domínio>/api/google/login-callback` — distinta de `GOOGLE_REDIRECT_URI`, pro fluxo de login por pessoa não colidir com o setup da conta única |
| `SUPABASE_SERVICE_ROLE_KEY` | sim (login) | Supabase → Project Settings → API → `service_role` (secreta!) — usada só pelas functions em `api/_lib/supabase.js` pra ler/escrever `google_connections`, nunca chega no navegador |

## Login por pessoa (Agenda + Drive) — como o app puxa a reunião de cada consultor

Desde a troca do login, o próprio "Entrar com Google" já pede acesso de leitura à Agenda e ao Drive da pessoa — é assim que a fila de auditoria consegue puxar reuniões de qualquer consultor, não só de uma conta compartilhada. O refresh token de cada pessoa fica na tabela `google_connections` do Supabase (RLS habilitado, **sem nenhuma policy** — só acessível via `SUPABASE_SERVICE_ROLE_KEY`, nunca pela chave anon pública que o resto do app usa).

1. No mesmo OAuth client já usado pela fila da conta única (abaixo), adicione **mais uma** redirect URI: `https://<domínio-do-deploy>/api/google/login-callback`.
2. Na tela de consentimento OAuth, adicione o escopo `.../auth/calendar.readonly` (o `.../auth/drive.readonly` já deve estar lá, do setup da conta única). Confirme que o tipo de usuário continua **Interno** — se estiver como Externo/Testing, o refresh token de cada pessoa expira sozinho em 7 dias e o login pararia de funcionar silenciosamente pra todo mundo.
3. Configure `GOOGLE_REDIRECT_URI_LOGIN` no Vercel.
4. No Supabase, crie a tabela `google_connections` (RLS habilitado, sem policies) — ver schema no histórico do projeto ou peça pra recriar via `apply_migration`.
5. Copie a `service_role` key do Supabase (Project Settings → API) pra `SUPABASE_SERVICE_ROLE_KEY` no Vercel.

O painel ADM "Quem já conectou a Agenda" (dentro de Auditoria de Entregas) mostra quem do roster (`PERFIS_POR_EMAIL`) já autorizou e quem ainda precisa logar de novo.

## Setup único da conexão com o Google Drive (fila da conta única — fallback)

Antes do login por pessoa, a fila de "Puxar reuniões do Drive" dependia de **uma única conta compartilhada** — continua funcionando como fallback pra quem ainda não conectou pelo login novo, mas só enxerga reuniões que essa conta específica tem acesso (dono do arquivo ou compartilhamento explícito).

1. No [Google Cloud Console](https://console.cloud.google.com/), crie um projeto e ative a **Google Drive API**.
2. Crie uma credencial OAuth 2.0 do tipo **Web application**, com redirect URI `https://<domínio-do-deploy>/api/google/callback`.
3. Na tela de consentimento OAuth, use o tipo de usuário **Interno** (disponível por ser Workspace `v4company.com`) — evita o processo de verificação do Google e evita que o `refresh_token` expire em 7 dias (limitação de apps em modo "Testing"/usuário externo).
4. Configure `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` e `GOOGLE_REDIRECT_URI` no Vercel e faça o deploy.
5. Acesse `https://<domínio-do-deploy>/api/google/auth-url`, abra a `url` retornada, faça login com a conta que deve ter acesso às gravações (precisa enxergar os arquivos de todos os consultores — via Shared Drive ou compartilhamento, configurado no Google Workspace, fora do escopo deste app).
6. O Google redireciona pro `/api/google/callback`, que mostra o `refresh_token` **uma única vez**. Copie o valor pra variável de ambiente `GOOGLE_REFRESH_TOKEN` no Vercel. Esse valor não fica salvo em nenhum banco — só nessa env var.
7. Opcional: se quiser restringir a busca a uma pasta/Shared Drive específica, configure `GOOGLE_DRIVE_MEETINGS_FOLDER_ID` com o ID da pasta.

## Rodando localmente

```bash
vercel dev
```

Necessário pra testar as funções `api/*` (um servidor estático simples não executa serverless functions). Sem `vercel dev`, dá pra abrir `index.html` direto num servidor estático (`python3 -m http.server`) pra navegar pela UI, mas qualquer chamada a `/api/*` vai falhar.

## Segurança

- Chaves de API (`ANTHROPIC_API_KEY`, credenciais do Google) só existem como env vars de servidor — nunca aparecem no HTML nem em nenhum banco.
- O Supabase usa uma chave anon pública por design (protegida por Row Level Security no lado do Supabase); é o único segredo que roda no navegador, e só isso.
- **`google_connections`** (refresh tokens do Google por pessoa) é a exceção proposital: RLS habilitado, **zero policies**, inacessível pela chave anon. Só as functions em `api/_lib/supabase.js` (via `SUPABASE_SERVICE_ROLE_KEY`, secreta) leem/escrevem essa tabela. Nunca crie uma policy pra `anon`/`authenticated` nela.
- `sbSave()` (em `index.html`) tem travas de segurança contra sobrescrever o banco com dados vazios ou com uma queda brusca no número de projetos, e detecta conflito quando outra sessão salvou por cima — não remova essas checagens.
