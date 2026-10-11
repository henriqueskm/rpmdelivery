# Endereço e celular no onboarding

Nome → autocomplete → seleção → resolução permanente → mapa de confirmação → celular opcional → RPC. Alterar qualquer caractere do endereço cancela requests e remove imediatamente coordenadas, provider, ID e confirmação. O envio exige nome válido, endereço confirmado e celular válido ou vazio. Celular tem 11 dígitos nacionais, DDD e assinante começando em 9; a UI mascara e o serviço/RPC normalizam para `+55DD9XXXXXXXX`.

## Provider e autorização

O browser chama somente `POST /api/geocoding/suggest` e `/resolve`, com o access token da sessão atual. O servidor verifica esse token com `auth.getUser(token)` usando a chave publishable; o guard client não concede autorização. Não há service role nem mudança na arquitetura de sessão do PR #5.

O adapter usa [Mapbox Geocoding v6](https://docs.mapbox.com/api/search/geocoding/): Brasil, português, tipo `address`, debounce de 300ms, máximo cinco sugestões, sem cache. Sugestões temporárias (`permanent=false`, `autocomplete=true`) retornam somente ID e labels, sem coordenadas. Selecionar refaz a busca pelo `mapbox_id` com `permanent=true`, `autocomplete=false`; somente esse resultado alimenta o RPC. Requests têm timeout de 8s, input limitado, autenticação e erros genéricos. Nenhum token ou erro interno é logado.

O mini mapa usa [Static Images](https://docs.mapbox.com/api/maps/static-images/) sem SDK, com pin e coordenadas permanentes. Logo e atribuição seguem os defaults do Mapbox. Não há edição do pin. Falha/ausência do token do mapa exibe mensagem e mantém o endereço confirmado.

Em `.env.local`, ignorado pelo Git:

| Variável | Uso |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Instância local ou desenvolvimento autorizado |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Chave pública desse ambiente |
| `MAPBOX_ACCESS_TOKEN` | Geocoding no servidor; nunca prefixar com `NEXT_PUBLIC_` |
| `NEXT_PUBLIC_MAPBOX_MAP_TOKEN` | Token **público `pk.*` separado**, somente scopes Maps necessários, sem scopes administrativos |

Restrinja o token público por URL/domínio no painel Mapbox antes da disponibilização. Geocoding permanente exige conta Mapbox com cartão válido ou contrato enterprise. Nenhum valor real é versionado. Limitação: autenticação/debounce/limites não substituem quota e rate limiting distribuído; revisar controles de custo antes de produção. Os parâmetros do RPC passam validação de formato/faixa; não há prova criptográfica de origem Mapbox contra um cliente autenticado que forje chamadas diretas.

## Migration e RPC

Migration forward-only: `supabase/migrations/20261002231941_restaurant_address_geocoding.sql`, criada pelo CLI. **Não aplicada remotamente.** O schema original já contém `latitude/longitude numeric`; por isso o `ALTER TABLE` converte ambas para `double precision`, sem inventar coordenadas, e adiciona `address_provider/address_provider_id text null`. A conversão usa a precisão de ponto flutuante exigida para geolocalização.

Os checks existentes dos intervalos [-90,90] e [-180,180] permanecem. Novos checks: par de coordenadas, metadados ambos nulos ou Mapbox com ID válido/coordenadas presentes, celular nulo ou E.164 brasileiro. São `NOT VALID` para preservar registros legados, incluindo telefone antigo ou par incompleto; aplicam-se a novos inserts/updates. Antes de validá-los em ambiente real, auditar e tratar legados em tarefa autorizada. Nenhuma migration anterior é editada; nenhuma policy RLS ou grant de tabela muda.

Assinatura antiga removida exatamente:

```sql
drop function public.create_restaurant(text, text, text);
```

Assinatura nova única:

```sql
create function public.create_restaurant(
  p_name text, p_address text, p_phone text,
  p_latitude double precision, p_longitude double precision,
  p_address_provider text, p_address_provider_id text
) returns uuid language plpgsql security definer set search_path = '' ...;

revoke all on function public.create_restaurant(
  text, text, text, double precision, double precision, text, text
) from public, anon, authenticated;
grant execute on function public.create_restaurant(
  text, text, text, double precision, double precision, text, text
) to authenticated;
```

O corpo completo está na migration: identidade via `auth.uid()`, profile obrigatório, limites de strings, coordenadas não nulas/finitas dentro da faixa, provider/ID e celular validados; restaurante e vínculo OWNER criados na mesma transação. O telefone opcional é enviado como `null` explicitamente. A substituição é transacional e evita overload ambíguo no PostgREST. O frontend novo exige a migration revisada/aplicada por processo autorizado antes de criação real; não chamar o novo contrato contra o banco antigo.

**Idempotência:** `restaurant_members` permite um usuário ser OWNER de múltiplos restaurantes. Uma constraint por usuário ou retorno do primeiro OWNER mudaria o produto. Mantêm-se bloqueio de double click, ausência de retry automático e bloqueio após resultado incerto; reload/requests concorrentes continuam sem garantia durável. Próxima decisão proposta: chave explícita por operação, persistida no cliente e vinculada ao usuário no banco, com fingerprint do payload e unicidade transacional. Isso permite retries sem impedir operações legítimas adicionais; não foi implementado silenciosamente.

## Validação local

- `npm run verify`: lint, geração de tipos de rotas, TypeScript e build.
- `npm run test:unit`: helpers, adapter temporário/permanente e segurança/input/erros dos handlers; Node 24, sem nova biblioteca de testes.
- `npm run test:e2e`: mocks explícitos dos endpoints e Supabase loopback em desktop/mobile. Força token Mapbox servidor vazio e token Maps placeholder; nunca usa Mapbox/Supabase real ou credenciais QA. Cobre teclado, Escape, debounce/abort, vazio/erros, confirmação/mapa, invalidação por edição e payload/E.164.
- `npm run test:sql:install`, depois `npm run test:sql`: instala PGlite 0.5.8 somente no cache ignorado e executa PostgreSQL em memória. Reconstrói migrations anteriores com fixture de Auth, omite apenas extensão pgcrypto (UUID é nativo), preserva legado e testa RPC/grants/RLS/validações. Não conecta a nenhum banco. Não substitui revisão Supabase/PostgREST e teste de concorrência real.
- `npm audit` e `git diff --check`.

Navegador integrado: desktop 1280×800 e mobile 390×844 com fixtures de rede locais, sem injetar estado React, sem criar restaurante real. Conferir dropdown, teclado, loading, mapa, erro/vazio, telefone, botão e console/network. Screenshots ficam no cache/artefatos ignorados. O Figma oficial [RpmDelivery](https://www.figma.com/design/ACQilVSdQov2BYvWsRTuZR/RpmDelivery) estava com a página `00 Brand` vazia, sem frames consultáveis; esta evolução reutiliza Auth/cores/Geist existentes e permanece sujeita à comparação visual quando houver frames aprovados.
