# RPM-ONBOARD-001 — Convites e vínculos

Migration proposta: `20261015221053_courier_invitations_commands.sql`.
Não aplicada no Supabase hospedado. Até aplicação aprovada, a interface informa
que o fluxo aguarda a migration. Navegador usa mocks; SQL usa identidades
sintéticas em PostgreSQL 17 descartável.

## Fluxo

1. Dashboard autenticado → Motoboys → **Convites e vínculos reais** →
   `/motoboys`. Somente OWNER/MANAGER ativo carrega a gestão da própria loja.
2. Gerar convite: validade 1–168 horas, limite 1–100 solicitações novas;
   padrões 72h/20 usos. QR local, código ou copiar link para colar manualmente
   no WhatsApp. Nenhum envio automático.
3. QR/link abrem `/convite#c=<código>`. O fragmento é removido do histórico
   visível e guardado no navegador por até 24h. Código também pode ser digitado
   diretamente em `/convite`.
4. Login/cadastro usam marcador fixo `?perfil=motoboy`, sem redirect arbitrário.
   Signup sem sessão mostra confirmação de e-mail, sem liberar onboarding.
   Retorno fixo do Auth: `/convite`, sem código do convite.
5. Autenticado, o motoboy vê nome da loja e completa nome, celular opcional e
   modelo/placa/cor da moto. O comando reutiliza `create_courier_profile`.
6. **Solicitar vínculo** cria PENDING uma única vez. Gestor aprova ACTIVE ou
   rejeita REJECTED. `/meus-estabelecimentos` mostra os próprios vínculos/status.
7. ACTIVE persiste para futuros turnos; várias lojas são permitidas, sem
   duplicar motoboy/loja. Revogar convite não revoga vínculos. REJECTED/SUSPENDED
   não são reabertos por convite; reconsideração/suspensão ficam fora do escopo.

Convite/vínculo não iniciam turno/rota nem concedem acesso a clientes/pedidos/GPS.
A fila operacional demonstrativa permanece separada desta gestão real.

## Contratos

Todas as RPCs são SECURITY DEFINER, `search_path=''`, auth.uid() como ator,
EXECUTE explícito para authenticated, revogado de PUBLIC/anon. IDs recebidos
não autorizam ações: o backend confere a associação ativa à loja.
Parâmetros SQL recebem prefixo `p_`.

| RPC | Entradas | Resultado / autorização |
| --- | --- | --- |
| create_courier_invite | restaurant_id, hours, max_uses | Convite sanitizado; OWNER/MANAGER próprio |
| revoke_courier_invite | restaurant_id, invite_id | Revogação idempotente; mesmo controle |
| list_courier_management | restaurant_id | Convites próprios e cadastros PENDING necessários; mesmo controle |
| inspect_courier_invite | code | Nome da loja/existência do perfil próprio; autenticado e limitado |
| complete_courier_registration | name, phone, model, plate, color | ID próprio; delega à RPC de perfil existente |
| request_courier_membership | code | ID/status próprio; consumo atômico e limitado |
| review_courier_membership | restaurant_id, relationship_id, approve | PENDING → ACTIVE/REJECTED; OWNER/MANAGER próprio |
| list_my_establishments | nenhuma | Vínculos próprios e nomes das lojas |

OPERATOR não gera/lista/revoga/decide. Novas tabelas privadas têm RLS sem
políticas e nenhum grant comum. Não se ampliam escritas diretas em
convites/vínculos, grants de service_role, leitura GPS, defaults ou sequências.
Mensagens não mostram SQL bruto nem payloads. Códigos inválidos, expirados,
revogados ou esgotados retornam o mesmo `unavailable`, sem enumeração de motivo.

## Concorrência e proteção do código

- 10 bytes de pgcrypto: 80 bits, 20 caracteres hexadecimais, cinco grupos de
  quatro. Aceita espaços/hífens. Convites legados incompatíveis não são
  consumidos/compartilhados; gestor pode revogar/reemitir sem reescrever registros.
- Inspeção/solicitação compartilham 10 tentativas por UID em janela fixa de
  15min. Erros retornam JSON, preservando contador. A tabela efêmera de limite
  é removida com o perfil via CASCADE; demais regras de exclusão não mudam.
- FOR UPDATE no convite protege a última vaga. Advisory lock motoboy/loja
  impede dupla contagem via convites diferentes. Recibo privado único
  (convite,motoboy) permite retry concluído após revogação/expiração/esgotamento.
  Vínculo preexistente nunca duplica nem consome novo uso.
- Revisão bloqueia vínculo: mesma decisão é idempotente; decisão concorrente
  contraditória é rejeitada. FOR SHARE mantém autorização do gestor até commit.
- Registro próprio é serializado por UID. Interface bloqueia duplo clique,
  desativa retries automáticos do SDK e recarrega depois de resultado incerto.
  Repetir geração após resposta perdida pode criar outro convite: conferir
  a lista antes de repetir.
- Código é capacidade sensível, em texto na tabela existente para reexibição
  autorizada. Não registrar corpos de RPCs em analytics/logs/suporte.
  Não usar QR externo, encurtador, wa.me, referrer ou parâmetros do Auth.
- `/convite`: no-referrer/noindex; fragmento não integra requisição HTTP.
  Código segue somente no corpo do RPC autenticado. Scripts/extensões
  maliciosos e histórico de links compartilhados continuam riscos do dispositivo.

## Compatibilidade e limites

- Auth mantém SDK browser/implicit existente; não há retrofit SSR/cookies/PKCE.
  Sessão é verificada antes de consultar/consumir convite. Allowlist/template
  hospedado deve permitir o retorno fixo `<origem aprovada>/convite`.
  Nada foi consultado/alterado remotamente; e-mail real não foi homologado.
- Continuidade automática exige mesmo navegador/armazenamento por até 24h.
  Em outro aparelho ou após limpeza/expiração, reabrir QR/link ou digitar código.
  O segredo não é colocado no e-mail.
- Entradas do motoboy: `/convite` e `/meus-estabelecimentos`. Cadastro normal
  de restaurantes mantém o fluxo original. Gestão reutiliza o restaurante
  ativo escolhido por useWorkspace; seletor de várias lojas fica para depois.
- Limite por UID não substitui quotas globais/IP ou proteção contra contas em
  massa. Recomenda-se controle de borda/monitoramento sem códigos antes de
  ampla exposição. Aprovação manual continua obrigatória.
- qrcode-generator 2.0.4 (MIT, sem transitivas runtime) gera QR local.
  jsqr 1.4.0 somente dev decodifica o resultado no teste independente.
  Next/React/Supabase SDK mantêm versões. Nenhuma service_role no frontend.
- Câmera física e origem HTTPS acessível ao celular não homologadas:
  localhost do computador não representa o servidor no celular.
- Sem frame Figma aprovado disponível: usados tokens, raio e controles atuais.
  Não há mudança de marca, GPS, rotas ou turnos.

## Evidências e aplicação futura

PostgreSQL 17 real, sem rede externa: todas as migrations, duas lojas e papéis
distintos, autorização cruzada, escrita direta bloqueada, limites persistentes,
estados e hardening anterior. Conexões distintas concorrem pela última vaga,
mesma pessoa com dois convites e aprovação/rejeição; unicidade/contadores/ator
auditado são conferidos após commit.

PGlite é complementar: substitui pgcrypto somente no harness. Grants,
criptografia e concorrência são validados separadamente no PostgreSQL real.
Playwright usa SDK/rede mockados: login, signup sem sessão, confirmação
implicit sintética, retomada, perfil, solicitação, várias lojas, gestão,
revogação e reflow 320/375/390/1280/1440. Capturas em
`docs/screenshots/courier-invitations/` contêm só fixtures.
Não comprovam comunicação com Auth/PostgREST hospedados.

Aplicação exige aprovação Lead, backup e conferência independente de histórico,
ACLs, pgcrypto no schema extensions e contratos existentes. Depois, homologar
reload PostgREST e Auth com usuários sintéticos autorizados. Esta PR não aplica
migration, altera Auth remoto, cria usuário real ou acessa outro projeto.
