# BrocheLink

Plataforma de **QR Codes dinâmicos para broches físicos**. O administrador gera broches em qualquer quantidade, imprime os QR Codes com seus códigos secretos de ativação, e cada proprietário ativa o próprio broche e escolhe — e muda quando quiser — para onde as leituras vão. Quem escaneia não precisa de conta.

```
Visitante escaneia  ──►  https://SEU-APP/b/K7M2X9P4Q6R8  ──►  302 (sem cache)  ──►  destino do proprietário
                                    │
                      broche disponível? ──►  /ativar/K7M2X9P4Q6R8  (login + código secreto + URL https)
```

> **Quer colocar no ar?** Siga o **[PASSO-A-PASSO.md](PASSO-A-PASSO.md)**: do repositório no GitHub ao app publicado na Vercel com Supabase, só com planos gratuitos.

---

## Sumário

1. [Stack](#stack)
2. [Funcionalidades](#funcionalidades)
3. [Arquitetura](#arquitetura)
4. [Configuração do Supabase](#configuração-do-supabase)
5. [Rodando localmente](#rodando-localmente)
6. [Roteiro: os 10 primeiros broches](#roteiro-os-10-primeiros-broches)
7. [Publicação na Vercel](#publicação-na-vercel)
8. [Segurança](#segurança)
9. [Escala e limites reais dos planos gratuitos](#escala-e-limites-reais-dos-planos-gratuitos)
10. [Testes](#testes)
11. [Referência da API](#referência-da-api)
12. [Migração para planos pagos e domínio próprio](#migração-para-planos-pagos-e-domínio-próprio)
13. [Decisões de projeto e limitações conhecidas](#decisões-de-projeto-e-limitações-conhecidas)

---

## Stack

| Camada | Tecnologia |
|---|---|
| Framework | Next.js 16 (App Router, Turbopack), React 19, TypeScript |
| Estilo | Tailwind CSS 4, Lucide React (tema claro/escuro automático) |
| Formulários | React Hook Form + Zod (mesmos esquemas validam no servidor) |
| Dados e Auth | Supabase PostgreSQL + Supabase Auth (`@supabase/ssr`) |
| QR Codes | `qrcode` (PNG/SVG), `pdf-lib` (folha A4), `jszip` (pacotes) |
| Testes | Vitest + PGlite (PostgreSQL real em WASM rodando as migrations de produção) |
| Hospedagem | Vercel |

## Funcionalidades

**Administrador** (`/admin`)
- Painel com totais de broches emitidos, ativados, disponíveis, suspensos, revogados, total de leituras e ativações recentes.
- **Gerador de lotes**: qualquer quantidade inteira positiva, processamento em partes com barra de progresso, idempotente e retomável.
- Exportação em **PDF** (folha A4 de corte, 12 por página, com ou sem código de ativação), **ZIP** (PNG + SVG + PDF + manifesto CSV), **PNG** e **SVG**; lotes grandes são divididos em partes.
- Lista de todos os broches com filtros (status, identificador, e-mail do proprietário) e paginação.
- Detalhe do broche: visualizador de QR, proprietário, destino, histórico, estatísticas, auditoria; suspender, reativar, revogar, gerar novo código de ativação.
- Estatísticas globais de leitura (7/30/90/365 dias) e ranking de broches.
- Auditoria (somente-inserção) e relatórios CSV: broches, leituras, histórico de destinos, lotes, auditoria.
- Lista de domínios bloqueados.

**Proprietário** (`/painel`)
- Cadastro e login (Supabase Auth, e-mail e senha).
- Ativação com código secreto, URL HTTPS e tela de confirmação.
- Lista dos próprios broches; alteração de destino com confirmação; suspensão e reativação; estatísticas de leitura por dia; histórico de destinos; download do próprio QR Code.

**Visitante**
- Escaneia e é redirecionado (HTTP 302, `Cache-Control: no-store`). Broches suspensos, revogados ou inexistentes mostram páginas próprias.

## Arquitetura

```
app/
  b/[code]/route.ts            ← URL permanente do QR (302, sem cache, contabiliza leitura)
  ativar/[code]/               ← jornada de ativação (Modelo A)
  login/ cadastro/ auth/       ← Supabase Auth (callback PKCE, signout)
  painel/                      ← dashboard do proprietário
  admin/                       ← dashboard, lotes, broches, estatísticas, auditoria, segurança
  status/[kind]/               ← suspenso, revogado, não encontrado, indisponível
  api/                         ← rotas que alteram estado (todas autorizadas no servidor)
lib/
  codes.ts                     ← identificadores, derivação e hash dos códigos de ativação
  url-validation.ts            ← validação rigorosa de destinos
  services/generation.ts       ← geração em lotes idempotente e retomável
  services/activation.ts       ← ativação e troca de destino
  brooches/transitions.ts      ← regras de status (espelho da função SQL)
  store/                       ← contrato de persistência + implementação Supabase
  export/                      ← PNG, SVG, PDF, ZIP, CSV
supabase/migrations/           ← esquema, funções (RPC) e RLS
tests/                         ← unitários + banco real (PGlite)
proxy.ts                       ← renova sessão e protege /painel e /admin (Next 16: antigo middleware)
```

**Modelo de segurança em uma frase:** o navegador só **lê** dados próprios (RLS); toda **escrita** passa por uma rota do Next.js que autentica (`getUser()`), autoriza, valida (Zod + regras de domínio) e só então chama uma função SQL `SECURITY DEFINER` executável **apenas** pela `service_role`.

### Banco de dados

| Tabela | Conteúdo |
|---|---|
| `profiles` | 1:1 com `auth.users`; `role` = `owner` (padrão) ou `admin` |
| `brooches` | UUID interno, `public_code` **UNIQUE** (12 caracteres), status, proprietário, destino, contadores |
| `activation_credentials` | **somente o hash** do código, versão, tentativas e bloqueio |
| `scan_events` | leituras (IP apenas como hash, país, user-agent truncado) |
| `destination_history` | toda mudança de destino (ativação, proprietário, admin) |
| `audit_logs` | auditoria somente-inserção (trigger bloqueia UPDATE/DELETE) |
| `generation_batches` | `id, created_by, requested_quantity, generated_quantity, status, created_at, completed_at` + chave de idempotência |
| `blocked_domains`, `rate_limits` | suporte à segurança |

Não há nenhuma constraint, sequência ou limite de linhas para broches.

### Como a geração ilimitada funciona sem estourar a infraestrutura

1. `POST /api/admin/batches` cria o lote com uma **chave de idempotência** gerada no navegador. Repetir a requisição (falha de rede, clique duplo) devolve o **mesmo** lote.
2. O navegador do admin chama `POST /api/admin/batches/{id}/process` em laço. Cada chamada gera no máximo `GENERATION_CHUNK_SIZE` broches (padrão 500) — uma fração de segundo de trabalho, muito abaixo do tempo máximo de função.
3. `UNIQUE (batch_id, sequence_in_batch)` + `ON CONFLICT DO NOTHING` impede duplicatas mesmo com chamadas concorrentes. `UNIQUE (public_code)` impede identificadores repetidos; em colisão, novos códigos são sorteados.
4. Se uma chamada falhar entre inserir broches e inserir credenciais, a próxima encontra os broches sem credencial e as completa. O progresso é sempre recalculado a partir das linhas reais.
5. Se a aba for fechada, o lote fica "Interrompido/Em andamento" e o botão **Retomar** continua de onde parou.

### Códigos de ativação

- 12 caracteres (60 bits) num alfabeto sem ambíguos (`23456789ABCDEFGHJKLMNPQRSTUVWXYZ`), impressos como `XXXX-XXXX-XXXX`.
- São **derivados** por HMAC-SHA256 de `ACTIVATION_CODE_SECRET` + id do broche + versão. O banco guarda apenas `HMAC(ACTIVATION_HASH_PEPPER, id:versão:código)`.
- Consequências: um vazamento do banco não revela códigos; o admin pode reimprimir cartões a qualquer momento; um cartão perdido é invalidado com "Novo código de ativação" (versão +1).
- ⚠️ **Nunca troque `ACTIVATION_CODE_SECRET` nem `ACTIVATION_HASH_PEPPER` depois de imprimir** — os códigos impressos deixariam de funcionar.

---

## Configuração do Supabase

1. Crie um projeto em [supabase.com](https://supabase.com) (plano Free). Região sugerida: **South America (São Paulo)**.
2. Aplique as migrations, **na ordem**, por um destes caminhos:
   - **SQL Editor** (mais simples): cole e execute cada arquivo de `supabase/migrations/` em ordem (`…0001_schema.sql`, `…0002_functions.sql`, `…0003_rls.sql`).
   - **Supabase CLI**: `npx supabase link --project-ref SEU_REF` e depois `npx supabase db push`.
3. **Authentication → URL Configuration**
   - *Site URL*: a URL pública do app (ex.: `https://brochelink.vercel.app`).
   - *Redirect URLs*: `http://localhost:3000/auth/callback` e `https://SEU-APP/auth/callback`.
4. **Authentication → Providers → Email**: mantenha "Confirm email" ligado em produção. O serviço de e-mail embutido do Supabase tem cota baixa e serve para testes; para uso real configure um SMTP próprio (Authentication → Emails → SMTP).
5. **Project Settings → API**: copie a URL, a chave pública (*anon*/*publishable*) e a chave secreta (*service_role*/*secret*).
6. **Crie sua conta pelo app** (`/cadastro`) e depois promova-a a administrador **no SQL Editor**:

   ```sql
   select public.promote_to_admin('seu-email@exemplo.com');
   ```

   Esse é o único caminho para virar admin: a função não pode ser chamada por nenhum papel da API (`anon`, `authenticated` nem `service_role`), o cadastro ignora qualquer `role` enviado e um trigger impede alterar `profiles.role` fora dela. Para remover: `select public.demote_admin('email');`.

## Rodando localmente

Requisitos: Node.js 20.9+ (testado com 22).

```bash
npm install
cp .env.example .env.local
npm run secrets            # gera ACTIVATION_CODE_SECRET, ACTIVATION_HASH_PEPPER e IP_HASH_SALT
# edite .env.local com as chaves do Supabase e os segredos gerados
npm run dev                # http://localhost:3000
```

Para testar a leitura pelo celular na mesma rede Wi-Fi, use o IP da máquina em `NEXT_PUBLIC_APP_URL` (ex.: `http://192.168.0.10:3000`) **antes** de gerar e imprimir — essa URL fica gravada nos QR Codes. Para os broches definitivos, gere-os já com a URL de produção.

Scripts:

| Comando | O que faz |
|---|---|
| `npm run dev` / `build` / `start` | desenvolvimento, build e servidor de produção |
| `npm test` | todos os testes (unitários + banco real em PGlite) |
| `npm run test:db` | só os testes de banco |
| `npm run lint` / `typecheck` | ESLint e TypeScript |
| `npm run secrets` | gera segredos fortes |

## Roteiro: os 10 primeiros broches

Este roteiro cumpre o critério de conclusão do projeto.

1. Publique o app (ou rode localmente) com `NEXT_PUBLIC_APP_URL` **definitiva**.
2. Entre como admin → **Admin → Lotes** → quantidade `10`, formato **PDF**, "Incluir códigos de ativação" marcado → **Gerar**.
3. Clique em **Baixar PDF**: cada cartão traz o QR Code, o identificador e o código de ativação. Imprima, recorte e entregue cada cartão junto com o broche correspondente (o manifesto CSV do ZIP ajuda na conferência).
4. Com outro celular/conta, escaneie um broche → página de ativação → **Criar conta** → informe o código do cartão e um destino `https://` → confirme.
5. Escaneie novamente: o redirecionamento é imediato para o destino.
6. Em **Meus broches**, altere o destino e escaneie de novo: o novo destino vale na hora — o QR impresso é o mesmo.
7. Teste suspender/reativar (proprietário) e revogar (admin).
8. Depois, gere outro lote (ex.: 50). Nada no código ou no banco muda, e os 10 primeiros continuam funcionando.

## Publicação na Vercel

1. Envie o projeto para um repositório Git (GitHub, GitLab ou Bitbucket).
2. Em [vercel.com/new](https://vercel.com/new), importe o repositório. O framework **Next.js** é detectado automaticamente; não altere comandos de build.
3. Em **Environment Variables**, cadastre todas as variáveis do `.env.example` (Production e Preview):
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_APP_URL` = `https://SEU-PROJETO.vercel.app` (ou o domínio próprio)
   - `ACTIVATION_CODE_SECRET`, `ACTIVATION_HASH_PEPPER`, `IP_HASH_SALT` (os **mesmos** do ambiente onde os broches foram gerados)
   - opcionais: `GOOGLE_SAFE_BROWSING_API_KEY` e os limites por operação
4. **Deploy**. Depois, adicione `https://SEU-PROJETO.vercel.app/auth/callback` nas *Redirect URLs* do Supabase e ajuste a *Site URL*.
5. Recomendado: em **Settings → Functions**, escolha a região `gru1` (São Paulo), próxima do banco.
6. Faça o roteiro dos 10 broches acima.

Pela CLI: `npx vercel` (preview) e `npx vercel --prod` (produção), após `npx vercel env add ...`.

> **Antes de imprimir**, garanta que `NEXT_PUBLIC_APP_URL` é a URL que você manterá. Ela está gravada nos QR Codes.

---

## Segurança

| Requisito | Implementação |
|---|---|
| Supabase Auth | e-mail/senha, confirmação por e-mail (PKCE), sessão em cookies renovada no `proxy.ts` |
| Autorização no servidor | toda rota usa `getUser()` (valida o JWT), checa papel/propriedade; broches alheios retornam 404 |
| RLS | ativo em todas as tabelas; proprietário lê só os seus broches, leituras e histórico; admin lê tudo; `activation_credentials` e `rate_limits` sem nenhuma política (inacessíveis pela API); escrita direta revogada de `anon`/`authenticated` |
| Códigos como hash | HMAC-SHA256 com pepper; comparação em tempo constante |
| Tentativas repetidas | bloqueio após `ACTIVATION_MAX_ATTEMPTS` erros (15 min, dobrando até 24 h) + rate limit por usuário e IP |
| Validação de URL | só `https://`, sem credenciais, sem portas não padrão, sem IPs (inclusive formas numéricas/IPv6), sem hosts internos (`localhost`, `.local`, `.internal`…), sem domínios "curinga" de IP (`nip.io`…), sem apontar para o próprio app, máx. 2048 caracteres |
| Destinos maliciosos | lista `blocked_domains` (admin) com bloqueio de subdomínios + Google Safe Browsing opcional |
| XSS | React escapa tudo; destinos só são aceitos como `https://` (sem `javascript:`/`data:`); CSP restritiva; SVG servido com CSP própria e `nosniff` |
| SSRF | o servidor **nunca** acessa a URL de destino — apenas devolve um 302 ao navegador do visitante. A única requisição externa (Safe Browsing) vai para um endpoint fixo do Google |
| CSRF | rotas que alteram estado exigem `Origin` do próprio app; cookies `SameSite=Lax` do Supabase |
| Auditoria | ações de admin e proprietário registradas; tabela somente-inserção |
| Credenciais | `service_role` só no servidor (`server-only`, sem prefixo `NEXT_PUBLIC_`); IP armazenado apenas como hash |
| Paginação e rate limiting | todas as listas paginadas; limites por janela em ativação, alterações, geração, exportação e contagem de leituras |
| Papel de admin | só via `promote_to_admin` no SQL Editor; nunca pelo cadastro |
| Cabeçalhos | CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Permissions-Policy`; redirecionamentos com `Referrer-Policy: no-referrer` |

## Escala e limites reais dos planos gratuitos

**"Geração ilimitada" significa que o software não impõe teto ao número de broches** — não que hospedagem ou processamento sejam ilimitados. Os planos gratuitos têm cotas (consultadas em novembro de 2026; confira as páginas oficiais, pois mudam):

**Supabase Free** ([supabase.com/pricing](https://supabase.com/pricing))

| Recurso | Limite |
|---|---|
| Banco de dados | 500 MB por projeto |
| Usuários ativos/mês (Auth) | 50.000 |
| Egress | 5 GB (+ 5 GB em cache) |
| Projetos ativos | 2 |
| Inatividade | **projeto pausa após 1 semana sem atividade** |
| Backups automáticos | não incluídos |

**Vercel Hobby** ([vercel.com/docs/plans/hobby](https://vercel.com/docs/plans/hobby))

| Recurso | Limite mensal |
|---|---|
| Invocações de função | 1.000.000 |
| Active CPU | 4 CPU-horas |
| Fast Data Transfer | 100 GB |
| Duração máxima de função | 300 s |
| Uso | **somente pessoal e não comercial** |

Ao estourar uma cota do Hobby, o recurso fica indisponível até completar 30 dias.

**Estimativas de consumo (ordem de grandeza):**
- Cada broche (linha + credencial + índices) ocupa cerca de 1 KB → 10.000 broches ≈ 10 MB.
- Cada leitura gera um evento de ~200–300 bytes com índices → **≈ 1,5–2 milhões de leituras** cabem nos 500 MB. É o principal fator de crescimento.
- Cada leitura = 1 invocação de função + 2 chamadas ao banco.

**Mantendo-se no gratuito:**
- Execute periodicamente `select public.purge_maintenance(365);` (apaga eventos de leitura com mais de 365 dias e janelas antigas de rate limit). Os contadores totais em `brooches.scan_count` são preservados.
- Projetos Free pausados por inatividade **param de redirecionar** os broches. Para uso real, mantenha atividade ou migre para o plano pago.
- Exportações grandes são divididas em arquivos de até `EXPORT_MAX_ITEMS` QR Codes.

## Testes

```bash
npm test
```

São 97 testes. Os de banco rodam **as migrations reais** num PostgreSQL em processo (PGlite) que emula os papéis do Supabase (`anon`, `authenticated`, `service_role`), `auth.uid()` e os privilégios padrão — então RLS, grants, triggers e funções são exercitados de verdade.

| Item pedido | Onde é testado (`tests/db/brochelink.test.ts` salvo indicação) |
|---|---|
| 1. Geração de um broche | "1. gera um único broche" |
| 2. Geração inicial de 10 | "2. gera o lote inicial de 10…" (em partes de 4, verifica hashes) |
| 3. Novos lotes depois | "3. gera novos lotes depois…" (lotes antigos intactos e funcionando) |
| 4. Unicidade | "4. unicidade…" (constraint + colisão forçada com nova tentativa) e `unit/codes.test.ts` (100 mil códigos) |
| 5. Ativação segura | "5a–5d" (código errado, bloqueio, URL insegura, reativação negada, corrida entre duas ativações) |
| 6. Redirecionamento | "6a/6b" + `unit/misc.test.ts` (302, sem cache) |
| 7. Alteração de destino | "7." (histórico, terceiros proibidos, URL inválida) |
| 8. Suspensão e reativação | "8." e "8b." (regras do front idênticas às da função SQL, por força bruta) |
| 9. Controle de acesso | "9." e "9b." (RLS, credenciais inacessíveis, RPCs negadas), testes de perfil/admin |
| 10. Lotes grandes e paginação | "10." (1.234 broches em partes de 250) |
| 11. Recuperação de falha parcial | "11." (falha simulada entre broches e credenciais, retomada sem duplicar) |

Também cobertos: idempotência por chave, auditoria imutável, rate limit, exclusão de conta, validação de URLs (40+ casos), exportação PNG/SVG/PDF/ZIP, CSV seguro contra fórmulas, proteção contra *open redirect*.

## Referência da API

| Método e rota | Quem | Descrição |
|---|---|---|
| `GET /b/{codigo}` | público | leitura do QR → 302 |
| `POST /api/activate` | autenticado | `{publicCode, activationCode, destinationUrl, confirm: true}` |
| `PATCH /api/brooches/{id}/destination` | dono ou admin | `{url, confirm: true}` |
| `POST /api/brooches/{id}/status` | dono ou admin | `{action: "suspend" \| "reactivate" \| "revoke"}` |
| `GET /api/brooches/{id}/qr?format=png\|svg\|pdf` | dono ou admin | QR individual (`&download=1`, admin: `&codes=1` no PDF) |
| `POST /api/admin/batches` | admin | `{quantity, idempotencyKey, label?}` |
| `POST /api/admin/batches/{id}/process` | admin | processa a próxima parte |
| `GET /api/admin/batches/{id}/export` | admin | `?format=pdf\|zip\|png\|svg\|csv&from=&to=&codes=1` |
| `POST /api/admin/brooches/{id}/reset-code` | admin | novo código de ativação |
| `GET /api/admin/reports/{brooches\|scans\|history\|batches\|audit}` | admin | CSV em streaming |
| `POST/DELETE /api/admin/blocked-domains` | admin | `{domain, reason?}` |

Erros seguem `{ error, message }` com status HTTP apropriado (401, 403, 404, 409, 422, 423, 429).

## Migração para planos pagos e domínio próprio

- **Uso comercial** exige sair do Vercel Hobby (Pro). No Supabase, o plano Pro remove a pausa por inatividade e inclui backups.
- Nada no código precisa mudar: ajuste os limites por operação nas variáveis de ambiente (ex.: `GENERATION_CHUNK_SIZE`, `EXPORT_MAX_ITEMS`).
- **Domínio próprio:** adicione-o em *Vercel → Settings → Domains* e configure o DNS. Atenção: os QR Codes já impressos apontam para a URL antiga. **Mantenha a URL antiga ativa** no mesmo projeto Vercel (o subdomínio `*.vercel.app` continua funcionando, e domínios adicionais podem ficar apontados para o projeto). Só os lotes gerados depois de trocar `NEXT_PUBLIC_APP_URL` usarão o novo domínio. A validação de URLs bloqueia destinos que apontem para o próprio app; adicione cada domínio do app ao configurar.
- Em escala maior, considere: mover a contagem de leituras para uma fila/armazenamento analítico, rate limiting no edge (Vercel WAF ou Upstash), e um job de servidor para lotes muito grandes (hoje o laço é conduzido pelo navegador do admin, o que funciona em qualquer plano).

## Decisões de projeto e limitações conhecidas

- **Processamento de lotes guiado pelo navegador do admin:** funciona no plano gratuito sem filas nem cron. Se a aba fechar, o lote é retomado depois. Não há processamento em segundo plano sem o admin presente.
- **Rate limit no Postgres:** dispensa Redis, mas cada leitura faz uma escrita extra. Se o contador falhar, a requisição é permitida (falha aberta) para não derrubar o redirecionamento; a proteção contra força bruta da ativação (bloqueio por broche) é independente e sempre vale.
- **Safe Browsing** é opcional e falha aberta (se o Google estiver indisponível, as demais validações continuam valendo).
- **Leituras de robôs** (pré-visualização de links do WhatsApp, Slack etc.) são redirecionadas, mas não contadas. Leituras acima do limite por IP/minuto também não são contadas, mas o visitante é sempre redirecionado.
- **Exclusão de conta:** broches ativos do usuário ficam suspensos pelo sistema; o admin decide o que fazer.
- **Fuso horário** das estatísticas diárias: America/Sao_Paulo.
