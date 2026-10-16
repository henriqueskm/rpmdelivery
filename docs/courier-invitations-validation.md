# RPM-ONBOARD-001 — Validação e revisão independente

Base: `2a634939e9d88980f956c754f04356d07baa3971` (main após PR #20).
Branch: `feat/courier-invitations`. Evidências correspondem à implementação
desta PR, antes de seu commit final. Nenhum teste acessou Supabase hospedado.

## Complemento do parecer Lead — cadastro existente incompleto

O complemento parte do HEAD revisado
`7a174c5d6a7587351716cf4e2701200797d0ffd0`. Revisa somente a migration
proposta não aplicada, seu contrato/UI e testes de regressão.

PostgreSQL17 e PGlite cobrem cadastro antigo com veículo nulo/parcial, nome
em branco, valores acima dos limites, preenchimento normalizado, preservação
de nome/telefone/modelo/cor válidos e retry sem alterar campos/timestamps.
Também cobrem rollback integral, UPDATE direto negado, parâmetro user_id
forjado rejeitado e ausência de alteração no cadastro de outra identidade.
No PostgreSQL real, conexões distintas disputam a reparação da mesma pessoa
e uma solicitação aguarda a reparação em outra transação.

Playwright adiciona cadastros antigos com veículo todo/parcialmente vazio,
campos válidos somente leitura, solicitação negada enquanto incompleto e
recuperação após invalidação do cadastro entre inspeção e solicitação.
O endpoint browser é mockado: a prova de autorização/grants vem do PostgreSQL.

A suíte completa deste complemento passou com 152 testes, workers=1 e retries=0.
Após a revisão visual, os campos preservados receberam a descrição acessível
“Já salvo · somente leitura”. A suíte focada final passou com 20 testes,
incluindo assertions de aria-describedby, sem retries; verify foi reexecutado
com sucesso. PostgreSQL 17 e PGlite passaram novamente com o SQL final.
O CI do novo HEAD é acompanhado separadamente no PR.

### Rechecagem independente do complemento

A sessão read-only `/root/rpmdelivery_visual_critic` inspecionou as quatro
capturas finais, desktop 1280×844 e mobile 390×844, e o código dos campos.
O P3 inicial de clareza — valores somente leitura pareciam editáveis — foi
resolvido pelo Builder com o aviso individual “Já salvo · somente leitura”.
O Critic confirmou rótulos, campos faltantes e botão legíveis, sem cortes ou
sobreposições aparentes; salvar cadastro permanece distinto de solicitar vínculo.
Nenhum achado P0–P3 pendente nessa cobertura, sem aprovação automática da PR.

- [Cadastro antigo vazio — desktop](screenshots/courier-invitations/desktop-chromium-legacy-empty.png)
- [Cadastro antigo vazio — mobile](screenshots/courier-invitations/mobile-chromium-legacy-empty.png)
- [Cadastro antigo parcial — desktop](screenshots/courier-invitations/desktop-chromium-legacy-partial.png)
- [Cadastro antigo parcial — mobile](screenshots/courier-invitations/mobile-chromium-legacy-partial.png)

Limitações: imagens de página inteira e código, sem navegador interativo próprio,
teclado/foco, leitor de tela ou contraste medido pelo Critic. Não há Figma aprovado.
Testes e inspeção interativa do Builder não são atribuídos ao revisor.
TOML carregado explicitamente; seleção automática por agent_type não comprovada.

## Testes e segurança

| Verificação | Resultado |
| --- | --- |
| npm ci | Aprovado, lockfile reproduzido |
| npm run verify | Lint, TypeScript e build aprovados |
| npm run test:unit | 78 aprovados; inclui decodificação independente do QR e expiração do contexto |
| npm run test:sql | PGlite aprovado, incluindo hardening anterior e contratos novos |
| PostgreSQL 17.11 descartável | Aprovado com pgcrypto real, migrations completas e conexões concorrentes |
| npm audit --omit=dev | Zero vulnerabilidades |
| Playwright desktop/mobile | 152 aprovados em 13,6min, workers=1 e retries=0 |
| YAML, bash -n, git diff --check | Aprovados |

PostgreSQL executado em container próprio sem rede externa, volume tmpfs novo,
bind somente leitura do repositório, sem reutilizar banco/volume do usuário.
O script exige opt-in, host loopback, nome exato de banco vazio e versão 17.
Evidência completa sintética é produzida também pelo workflow
`Courier invitations security`, com retenção de sete dias.

Cobertura: OWNER/MANAGER ativo, OPERATOR e anon negados; duas lojas; comandos
cruzados negados; perfil próprio; nenhum INSERT direto comum; PENDING/ACTIVE
sem acesso a pedidos/clientes/rotas/GPS; expiração/revogação/esgotamento/código
inexistente; retries sem duplicação; rate limit persistente; múltiplas lojas;
aprovação/rejeição auditadas. Concorrência real com conexões distintas testa
última vaga, dois convites para mesma pessoa/loja e decisões contraditórias.
RPCs de onboarding, políticas/defaults e proteções GPS anteriores são rechecados.

O audit completo mantém cinco alertas high de desenvolvimento anteriores
(`braces`, `micromatch`, `fast-glob`, `@next/eslint-plugin-next`,
`eslint-config-next`). Não foram aplicados force, override, downgrade ou
alteração do gate de produção. O npm ci mantém o postinstall de unrs-resolver
bloqueado pela política já existente, sem ampliar scripts permitidos.

As páginas de Auth passaram a ler searchParams para o marcador de motoboy.
Nos testes antigos, cancelamentos normais do transporte RSC foram classificados
como falha crítica. O helper de rede agora exclui somente
`net::ERR_ABORTED` + fetch + cabeçalho RSC + parâmetro _rsc nas páginas
`/login` e `/cadastro`. HTTP 4xx/5xx, APIs, console, exceções e demais falhas
continuam sendo verificadas. O teste também deixa de navegar duas vezes ao login.
Não se alteram retries globais.

## Navegador integrado — Builder

Servidor local isolado `127.0.0.1:3121`, build com URL/chave fictícias de teste.
Em 1280×800 e 390×844: entrada pública do motoboy → convite digitável →
armazenamento do código fictício → login marcado como motoboy.
Console sem warnings/errors e nenhum erro HTTP nesse percurso anônimo.
O buffer CDP completo registrou um fetch RSC de /login cancelado pela navegação
(`net::ERR_ABORTED`, canceled=true), sem falha inesperada de API ou exceção.
Nenhuma credencial foi digitada.
Código local removido pela interface; viewport restaurado e aba própria fechada.

Fluxos autenticados são testados por Playwright com mocks de SDK/PostgREST.
Isso não equivale a homologação de Auth, e-mail, PostgREST ou câmera física.
Não foram lidos arquivos privados de conexão/credenciais nem dados reais.

## Visual Critic independente, somente leitura

Uma primeira sessão independente recebeu a configuração
`.codex/agents/rpmdelivery-visual-critic.toml`, leu as skills pertinentes e
inspecionou seis capturas iniciais e depois as evidências corrigidas.
A ferramenta disponível não expõe seleção de agent_type; o spawn inicial do
nome reservado não pôde ser usado. Depois foi acionada por followup a sessão
registrada `/root/rpmdelivery_visual_critic`, que carregou explicitamente o TOML
e inspecionou as capturas mobile atuais. Isso comprova a sessão independente
com esse nome, **não a aplicação automática do TOML por agent_type**.
Ambas permaneceram sem escrita e não executaram testes/servidores.

### P2 observado e corrigido

Antes, CSS colocava Solicitações antes de Convites somente visualmente no
mobile, mantendo Convites primeiro no DOM. Isso provocava uma sequência de
leitura/foco divergente.

Correção do Builder: Solicitações primeiro no DOM e no layout desktop/mobile,
sem `order` de CSS. Teste de teclado confere Aprovar → Rejeitar → Atualizar
solicitações → Validade nos cinco viewports.

| Antes | Depois | Benefício |
| --- | --- | --- |
| Ordem visual mobile diferente do DOM | Mesma ordem sem reposicionamento CSS | Leitura e foco previsíveis |

Na rechecagem, o revisor confirmou o P2 resolvido nas imagens atuais e no código,
sem novos achados relevantes nos cenários observados. Nome longo/modelo sem
espaços quebram dentro do cartão; placa/status/ações permanecem legíveis.
No formulário desktop, rótulos e telefone opcional estão claros e salvar perfil
é distinto de solicitar vínculo. Não houve aprovação automática.

A sessão registrada confirmou também gestão mobile 390×844, textos longos
375×844, cadastro no perfil Pixel 7 e solicitação 390px, além de desktop
1280×800. Nenhum novo P0–P3 verificável nos cenários inspecionados.

### Evidências

- [Antes desktop](screenshots/courier-invitations/before-management-1280.png)
- [Antes mobile](screenshots/courier-invitations/before-management-390.png)
- [Gestão atual desktop](screenshots/courier-invitations/desktop-chromium-management-1280.png)
- [Gestão atual 390px](screenshots/courier-invitations/desktop-chromium-management-390.png)
- [Textos longos em 375px](screenshots/courier-invitations/desktop-chromium-long-375.png)
- [Cadastro de perfil desktop](screenshots/courier-invitations/desktop-chromium-profile.png)
- [Cadastro de perfil mobile](screenshots/courier-invitations/mobile-chromium-profile.png)
- [Convite mobile](screenshots/courier-invitations/mobile-chromium-courier-390.png)

Capturas contêm apenas fixtures. As imagens de página inteira podem ser mais
altas que o viewport; o projeto mobile usa escala de dispositivo maior.
Não há frame Figma aprovado. O revisor não usou navegador interativo; inspeção
própria não abrange teclado/leitor de tela, contraste medido, loading/erros,
hardware, safe areas ou teclado virtual.
320/375/390/1280/1440 foram exercitados no E2E, mas nem todos os estados têm
capturas independentes. Resultados do Builder não são apresentados como testes
executados pelo Critic. Aprovação final permanece com o Lead.

## Limites operacionais

Migration somente proposta. Sem SQL remoto, db push, alteração de Auth,
usuários reais, secrets, produção ou acesso a outro projeto. Nenhuma migration
antiga foi editada. Checkout principal preservado por worktree separado,
com hashes dos arquivos locais anteriores conferidos.

Homologação e riscos de compatibilidade: [contratos e implantação](courier-invitations.md).
