# Passo a passo: do repositório no GitHub ao app no ar

Este guia publica o BrocheLink usando somente planos gratuitos: **GitHub**, **Supabase Free** e **Vercel Hobby**. Tudo é feito pelo navegador. Você só precisa do terminal no passo 1, para enviar o código ao GitHub, e no passo 3, se quiser gerar os segredos com Node.

Tempo estimado: 20 a 30 minutos.

> **Leia antes de começar.** A URL do app fica gravada em cada QR Code impresso. Escolha o nome do projeto na Vercel com calma (passo 4): ele vira o endereço `https://NOME.vercel.app`, que precisa continuar existindo enquanto houver broches em uso.

---

## Visão geral

| Passo | Onde | O que acontece |
|---|---|---|
| 1 | GitHub | O código vai para um repositório seu |
| 2 | Supabase | Banco de dados e login são criados |
| 3 | Seu computador | Três segredos são gerados |
| 4 | Vercel | O app é publicado a partir do GitHub |
| 5 | Supabase | O login passa a aceitar a URL do app |
| 6 | App + Supabase | Você cria sua conta e vira administrador |
| 7 | App | Primeiros 10 broches gerados e testados |

---

## 1. Colocar o código no GitHub

**Se o repositório já existe** com este código (por exemplo, alguém já enviou para você ou você fez um fork), pule para o passo 2.

**Se você tem o código num ZIP:**

1. Acesse [github.com/new](https://github.com/new).
2. Em *Repository name*, digite `brochelink`.
3. Escolha **Private** (recomendado).
4. **Não** marque *Add a README*, *.gitignore* nem *license*. O repositório precisa nascer vazio.
5. Clique em **Create repository**.
6. No terminal, dentro da pasta do projeto descompactado:

   ```bash
   git init
   git add .
   git commit -m "BrocheLink: versão inicial"
   git branch -M main
   git remote add origin https://github.com/SEU-USUARIO/brochelink.git
   git push -u origin main
   ```

7. Atualize a página do repositório. Você deve ver as pastas `app`, `lib`, `supabase` e este arquivo.

> O arquivo `.env.local` (com senhas) está no `.gitignore` e **não** vai para o GitHub. Nunca coloque chaves no repositório.

---

## 2. Criar o banco de dados no Supabase

### 2.1 Criar o projeto

1. Acesse [supabase.com/dashboard](https://supabase.com/dashboard) e clique em **New project**.
2. Preencha:
   - *Name*: `brochelink`
   - *Database Password*: clique em **Generate a password** e guarde num gerenciador de senhas (o app não usa essa senha, mas você pode precisar dela no futuro)
   - *Region*: **South America (São Paulo)**
3. Clique em **Create new project** e aguarde cerca de 2 minutos.

> **Limite do plano gratuito:** cada organização Free tem no máximo **2 projetos ativos**. Se aparecer um aviso de limite, pause um projeto antigo em *Project Settings → General → Pause project* (os dados ficam guardados e dá para reativar depois).

### 2.2 Criar as tabelas (migrations)

As migrations ficam na pasta `supabase/migrations/` do repositório. São 3 arquivos e **a ordem importa**.

1. No Supabase, abra **SQL Editor** (menu lateral) e clique em **New query**.
2. No GitHub, abra `supabase/migrations/20261106000001_schema.sql`, clique no botão **Copy raw file** (ícone de copiar no topo do arquivo) e cole no SQL Editor.
3. Clique em **Run**. Deve aparecer *Success. No rows returned*.
4. Repita com `20261106000002_functions.sql`.
5. Repita com `20261106000003_rls.sql`.

Para conferir, abra **Table Editor**. Devem aparecer as tabelas `profiles`, `brooches`, `activation_credentials`, `scan_events`, `destination_history`, `audit_logs`, `generation_batches`, `blocked_domains` e `rate_limits`, todas com o selo **RLS enabled**.

> Se der erro no meio, não rode o próximo arquivo. As migrations podem ser executadas de novo com segurança: corrija o problema e rode o mesmo arquivo outra vez.

### 2.3 Copiar as chaves

Abra **Project Settings → API Keys** (ou *Settings → API*, dependendo da versão do painel) e copie para um bloco de notas temporário:

| O que copiar | Onde está | Vai virar a variável |
|---|---|---|
| Project URL | *Project Settings → Data API* (ex.: `https://abcdxyz.supabase.co`) | `NEXT_PUBLIC_SUPABASE_URL` |
| Chave pública: `anon` **ou** `sb_publishable_...` | *API Keys* | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Chave secreta: `service_role` **ou** `sb_secret_...` | *API Keys* (clique em *Reveal*) | `SUPABASE_SERVICE_ROLE_KEY` |

> **A chave secreta dá acesso total ao banco.** Não envie por chat ou e-mail e não coloque no código. Ela só deve ser colada nas variáveis de ambiente da Vercel (passo 4).

---

## 3. Gerar os segredos do app

O app precisa de três segredos próprios. Escolha **uma** das opções.

**Opção A: com Node.js instalado** (dentro da pasta do projeto):

```bash
npm install
npm run secrets
```

**Opção B: só com o terminal** (macOS, Linux ou Git Bash no Windows):

```bash
echo "ACTIVATION_CODE_SECRET=$(openssl rand -base64 48 | tr -d '\n=+/')"
echo "ACTIVATION_HASH_PEPPER=$(openssl rand -base64 48 | tr -d '\n=+/')"
echo "IP_HASH_SALT=$(openssl rand -base64 24 | tr -d '\n=+/')"
```

Copie as três linhas geradas para o bloco de notas.

> **Guarde `ACTIVATION_CODE_SECRET` e `ACTIVATION_HASH_PEPPER` para sempre** (num gerenciador de senhas). Se forem trocados ou perdidos depois de imprimir os cartões, **todos os códigos de ativação impressos param de funcionar**.

---

## 4. Publicar na Vercel

### 4.1 Importar o repositório

1. Acesse [vercel.com/new](https://vercel.com/new).
2. Em *Import Git Repository*, encontre `brochelink` e clique em **Import**.
   - Não aparece? Clique em **Adjust GitHub App Permissions** (ou *Install*) e dê acesso da Vercel ao repositório `brochelink`.
3. Em *Project Name*, confirme o nome. **Ele define a URL:** `brochelink` vira `https://brochelink.vercel.app`. Se o nome já estiver em uso por outra pessoa, a Vercel acrescenta um sufixo — confira a URL final no passo 4.3.
4. *Framework Preset*: **Next.js** (detectado automaticamente). Não altere *Build Command*, *Output Directory* nem *Root Directory*.

### 4.2 Variáveis de ambiente

Ainda na tela de importação, abra **Environment Variables** e adicione uma por uma (ou cole todas de uma vez no primeiro campo, no formato `CHAVE=valor`, uma por linha):

| Nome | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL do passo 2.3 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | chave pública do passo 2.3 |
| `SUPABASE_SERVICE_ROLE_KEY` | chave secreta do passo 2.3 |
| `NEXT_PUBLIC_APP_URL` | `https://NOME-DO-PROJETO.vercel.app` (sem barra no final) |
| `ACTIVATION_CODE_SECRET` | do passo 3 |
| `ACTIVATION_HASH_PEPPER` | do passo 3 |
| `IP_HASH_SALT` | do passo 3 |

Opcionais (podem ficar de fora; os valores padrão estão no `.env.example`): `GOOGLE_SAFE_BROWSING_API_KEY`, `GENERATION_CHUNK_SIZE`, `MAX_QUANTITY_PER_BATCH`, `EXPORT_MAX_ITEMS`, `ACTIVATION_MAX_ATTEMPTS`, `ACTIVATION_LOCK_SECONDS`, `SCAN_RATE_LIMIT_PER_MINUTE`.

Clique em **Deploy** e aguarde de 1 a 3 minutos.

### 4.3 Conferir a URL

1. Quando aparecer *Congratulations*, clique em **Continue to Dashboard**.
2. Em **Domains**, veja a URL de produção (ex.: `brochelink.vercel.app`).
3. **Ela é exatamente igual ao `NEXT_PUBLIC_APP_URL` que você cadastrou?**
   - **Sim:** siga para o passo 5.
   - **Não:** vá em *Settings → Environment Variables*, edite `NEXT_PUBLIC_APP_URL` com a URL correta, depois vá em *Deployments*, clique nos três pontos do deploy mais recente e em **Redeploy**. Variáveis `NEXT_PUBLIC_` só passam a valer depois de um novo deploy.

### 4.4 Região das funções (recomendado)

Em *Settings → Functions → Function Region*, escolha **São Paulo, Brazil (gru1)** — a mesma região do banco — e faça um **Redeploy**. Os redirecionamentos ficam mais rápidos.

---

## 5. Liberar o login para a URL do app

Sem este passo, o link de confirmação de e-mail leva para `localhost`.

1. No Supabase, abra **Authentication → URL Configuration**.
2. *Site URL*: `https://NOME-DO-PROJETO.vercel.app`
3. Em *Redirect URLs*, clique em **Add URL** e adicione:
   - `https://NOME-DO-PROJETO.vercel.app/auth/callback`
   - `http://localhost:3000/auth/callback` (só se for rodar localmente também)
4. Clique em **Save**.

> **E-mails de confirmação:** o serviço de e-mail embutido do Supabase envia pouquíssimos e-mails por hora e serve só para testes. Para uso real, configure um SMTP em *Authentication → Emails → SMTP Settings* (Resend, Brevo e similares têm planos gratuitos).

---

## 6. Criar sua conta e virar administrador

1. Abra `https://NOME-DO-PROJETO.vercel.app/cadastro` e crie sua conta.
2. Confirme o e-mail pelo link recebido.
3. No Supabase, abra o **SQL Editor** e execute, com o **seu** e-mail:

   ```sql
   select public.promote_to_admin('seu-email@exemplo.com');
   ```

   Deve retornar um código (o id do seu perfil). Se aparecer *no profile with email*, confira se o cadastro foi concluído e se o e-mail está escrito igual.
4. No app, clique em **Sair** e entre de novo. O menu passa a mostrar **Admin**.

> Não existe tela para promover administradores, de propósito. Esse comando só funciona no SQL Editor, com acesso de dono do projeto Supabase. Para remover um admin: `select public.demote_admin('email');`.

---

## 7. Gerar e testar os 10 primeiros broches

1. Vá em **Admin → Lotes**.
2. Quantidade `10`, formato **PDF**, deixe **Incluir códigos de ativação** marcado e clique em **Gerar**.
3. Clique em **Baixar PDF**. Cada cartão tem o QR Code, o identificador e o código de ativação. Imprima e recorte.
4. **Teste a jornada completa** com o celular de outra pessoa (ou numa janela anônima):
   - escaneie um cartão: deve abrir a página **Ativar broche**;
   - crie uma conta, digite o código de ativação do cartão e um destino `https://`;
   - confirme a ativação;
   - escaneie de novo: deve ir direto para o destino.
5. Em **Meus broches**, altere o destino e escaneie outra vez: o novo destino vale na hora, com o mesmo QR impresso.

Pronto: o app está no ar. Para gerar mais broches depois, basta repetir o passo 7 com a quantidade desejada.

---

## Atualizações futuras

- **Mudanças no código:** cada `git push` na branch `main` publica uma nova versão na Vercel automaticamente. Pushes em outras branches geram uma *Preview* com URL própria, sem afetar a produção.
- **Mudanças no banco:** novas migrations em `supabase/migrations/` **não** são aplicadas sozinhas. Rode cada arquivo novo no SQL Editor, na ordem, antes (ou logo depois) do deploy que depende dele.
- **Testes automáticos:** o repositório inclui `.github/workflows/ci.yml`. A cada push, o GitHub Actions roda lint, tipos, os 97 testes e o build. Veja o resultado na aba **Actions** do repositório.
- **Manutenção do banco** (a cada alguns meses), no SQL Editor:

  ```sql
  select public.purge_maintenance(365);  -- apaga leituras com mais de 1 ano
  ```

---

## Problemas comuns

| Sintoma | Causa provável | Solução |
|---|---|---|
| Página "Algo deu errado" ao abrir um broche, a ativação ou o admin | Variável de ambiente faltando ou curta demais | Confira as 7 variáveis do passo 4.2 (os três segredos precisam ter 32, 32 e 16 caracteres ou mais) e faça Redeploy. Os logs em *Vercel → Logs* mostram qual variável falta |
| Link de confirmação de e-mail abre `localhost` | Site URL do Supabase não configurada | Passo 5 |
| E-mail de confirmação não chega | Limite do e-mail embutido do Supabase | Aguarde, confira o spam ou configure SMTP (passo 5) |
| "Login inválido" logo após o cadastro | E-mail ainda não confirmado | Clique no link do e-mail primeiro |
| Não aparece o menu Admin | Promoção não feita ou sessão antiga | Passo 6: rode o comando e saia/entre de novo |
| QR Code leva para o domínio errado | `NEXT_PUBLIC_APP_URL` estava errada quando o lote foi gerado | Corrija, faça Redeploy e gere um novo lote. Os broches antigos continuam apontando para a URL antiga |
| Todo QR leva para "Serviço temporariamente indisponível" | Projeto Supabase pausado (1 semana sem uso no plano Free) ou chave secreta errada | Reative o projeto no painel do Supabase; confira `SUPABASE_SERVICE_ROLE_KEY` |
| Erro ao rodar uma migration | Arquivo rodado fora de ordem ou colado pela metade | Rode de novo, inteiro, na ordem 0001 → 0002 → 0003 |
| Códigos de ativação impressos deixaram de funcionar | `ACTIVATION_CODE_SECRET` ou `ACTIVATION_HASH_PEPPER` foram alterados | Volte os valores originais na Vercel e faça Redeploy |

---

Para entender a arquitetura, a segurança e os limites dos planos gratuitos em detalhe, veja o [README.md](README.md).
