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
| `GOOGLE_REFRESH_TOKEN` | só p/ fila do Drive | obtido uma única vez no setup abaixo |
| `GOOGLE_DRIVE_MEETINGS_FOLDER_ID` | opcional | restringe a busca de transcrições a uma pasta/Shared Drive específica |

## Setup único da conexão com o Google Drive (fila de avaliação)

A fila de "Puxar reuniões do Drive" (Auditoria de Entregas, visível só pro perfil ADM) lê transcrições do Google Meet (Google Docs nomeados com "Transcript") modificadas nos últimos 7 dias, direto do Drive da conta conectada.

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
- `sbSave()` (em `index.html`) tem travas de segurança contra sobrescrever o banco com dados vazios ou com uma queda brusca no número de projetos, e detecta conflito quando outra sessão salvou por cima — não remova essas checagens.
