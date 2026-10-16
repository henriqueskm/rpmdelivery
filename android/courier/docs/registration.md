# RPM-ANDROID-001B · Cadastro demonstrativo

Complemento da PR #22, a partir de `deab02c640da9438bdabd52aed05cf901778f6d0`.
A identidade, as quatro telas e a natureza demonstrativa permanecem iguais.
Nenhuma alteração no Next.js, schema, Auth, dados remotos ou dependências.

## Celular opcional

O campo existente é **celular com DDD**, não telefone fixo. Vazio é válido.
Preenchido, exige 11 dígitos nacionais, DDD brasileiro da lista local e número
de assinante com nove dígitos iniciado por 9. Essa validação não comprova
existência, titularidade ou capacidade de receber mensagens.

- Aceita números nacionais, pontuação usual e colagem com prefixo `+55`.
  O país exige `+` explícito: não se adivinha código de país por comprimento.
  DDD 55 permanece DDD. Acrescentar dígitos não reinterpreta nem troca o número;
  o limite de 11 permanece ativo, inclusive em edições no meio.
- Não aceita país estrangeiro, letras ou mais de 11 dígitos nacionais. Edições
  inválidas são rejeitadas integralmente, sem truncar silenciosamente números.
- `TextFieldState` contém só dígitos nacionais. `InputTransformation` remove
  pontuação/prefixo por edições no buffer; `OutputTransformation` insere a
  máscara. O Compose faz o mapeamento de seleção e cursor; não há atualização
  assíncrona nem reposicionamento forçado no fim do texto.
- Teclado `Phone`, ação `Next`; a próxima etapa continua sendo a senha.
- `BrazilianPhone.toE164(...)` retorna `+5511987654321` para número válido e
  `null` para vazio/inválido. Uma integração futura deve validar antes e tratar
  vazio como opcional; nesta PR não há payload ou chamada ao backend.
- O estado fica apenas em memória, sem saveable, logs ou persistência.

Referências: [transformações de texto Compose](https://developer.android.com/develop/ui/compose/text/user-input),
[códigos nacionais da Anatel](https://www.gov.br/anatel/pt-br/regulado/numeracao/codigos-nacionais).
A regra de celular segue a [numeração de nove dígitos](https://www.gov.br/anatel/pt-br/regulado/numeracao/codigos-nacionais/nono-digito).
A lista local de DDD deve ser revisada se a regulamentação mudar.

## Catálogo local

`registration/MotorcycleCatalog.kt` mantém IDs estáveis, marca, modelo e aliases
em uma lista pequena: 14 modelos Honda/Yamaha, incluindo exemplos de gerações
anteriores. Não é uma lista completa de marcas, anos, versões ou acabamentos.
Referências de nomenclatura: [Honda](https://www.honda.com.br/motos),
[Yamaha](https://www.yamaha-motor.com.br/). Nenhuma consulta ocorre em runtime.

A busca ignora caixa, acentos e separadores; combina marca, modelo e aliases
como `cg160 fan`, `fan 160`, `broz 160` e `fz 15`. Resultados mantêm ordem
estável; até quatro aparecem por vez, com contagem total e orientação para
refinar a busca. Sem lista aninhada de rolagem, popup ou biblioteca adicional.

Digitar, inclusive o nome exato, **não seleciona** uma moto. A escolha de um
item reconhecido é obrigatória. Alterar o texto invalida o ID imediatamente;
um ID inexistente ou incompatível com o texto não satisfaz a validação.
O valor canônico futuro é `selected.displayName`, com marca/modelo completos
e máximo de 80 caracteres. Todos os itens são testados contra esse limite.
Nada altera ou amplia o contrato atual do backend.

“Não encontrei minha moto” limpa a seleção, explica a limitação do catálogo
e oferece voltar à busca. Não pede texto arbitrário nem aceita outro modelo
como substituto. A demonstração não conclui enquanto faltar uma escolha válida.
Não há solicitação remota de inclusão de modelo.

Para ampliar o catálogo, acrescentar um item com ID único e nome canônico
verificado, aliases que não confundam modelos distintos, e rodar os testes.
Não usar aliases para equiparar automaticamente gerações/versões diferentes.

## Evidências

Suíte Android ampliada de 9 para **29 testes**:

- 7 de telefone: máscara progressiva, DDD, celular opcional/incompleto,
  pontuação/`+55`, E.164, tamanho, país inválido e caso DDD 55;
- 5 de catálogo/seleção: aliases, acentos, caixa, IDs, limite de 80, texto
  arbitrário, invalidação ao editar e modelo não encontrado;
- 3 de campo nativo: contrato `InputConnection.commitText`, teclado Phone/Next,
  edição/seleção/apagamento no meio e separadores, rejeição sem perda do valor,
  foco no campo seguinte;
- 4 de formulário: telefone incompleto e reparação, escolha obrigatória,
  alteração de escolha, recuperação de modelo não encontrado e Tab/Enter;
- 1 de cadastro a 320dp/fonte150% com insets IME sintéticos de 280dp;
- 9 da fundação, preservados, incluindo fluxo opcional sem celular, contraste,
  navegação, rota, textos longos e Activity em API26.

O teste Tab/Enter configura explicitamente modo teclado no Robolectric: a
renderização nativa começa em modo toque, no qual os botões não recebem foco
por Tab. Não se força foco no item que a asserção espera; as teclas precisam
alcançá-lo e selecioná-lo. A consulta pendente permanece visível ao mudar foco.
As APIs experimentais de interceptação de IME/injeção de teclas ficam apenas
nos testes. O código do aplicativo não usa esses hooks de teste.

Capturas novas (Compose/PixelCopy, 390×844dp/mdpi salvo indicação):

- [Celular formatado](screenshots/06-registration-phone-390.png).
- [Busca e escolha obrigatória](screenshots/07-registration-suggestions-390.png).
- [Moto não encontrada](screenshots/08-registration-not-found-390.png).
- [Celular em 320dp/fonte150%](screenshots/09-registration-phone-320-font150-ime-insets.png).
- [Sugestões em 320dp/fonte150%](screenshots/10-registration-suggestions-320-font150-ime-insets.png).
- [Foco de teclado](screenshots/11-registration-keyboard-focus-390.png).

Em 320dp, os 280dp inferiores são espaço reservado por insets sintéticos,
sem desenho de um teclado. Cada uma das quatro sugestões foi conferida por
rolagem com altura ≥48dp, sem ultrapassar 320dp horizontalmente nem ficar
atrás desse espaço reservado. Não se afirma teste de teclado real.

`rpmdelivery_visual_critic` revisou independentemente as capturas e o código,
somente em leitura, comparando o cadastro com o HEAD de referência: nenhum
achado P0–P3 na cobertura inspecionada. Preservação de identidade, clareza da
seleção/limitação do catálogo e leitura de máscara/sugestões foram observadas.
O Critic não executou build, testes, ações, TalkBack, cursor ou clipboard;
erro de telefone e diálogo final não foram verificados independentemente.
Não se comprova invocação nativa por `agent_type` nesta superfície; a sessão
independente aplica as instruções do TOML existente, sem corrigir seus achados.

Resultados, APK, capturas e revisão independente desta rodada são registrados
na PR #22. Testes em JVM não substituem teclado/clipboard/TalkBack reais.
Build local `assembleDebug`, 29 testes (zero falhas/skips) e `lintDebug`
aprovados. O aviso informativo `OldTargetApi` mantém a política documentada
da fundação; não foram adicionadas supressões ou mudanças de ferramentas.

APK local `0.1.1-demo`, versionCode 2: **11.949.793 bytes**, assinatura debug
verificada com `apksigner`; SHA-256
`11CE11ADB06DF9F0E12DE80705D11EC0D72912CBDF3E9A94B9906B1D9B5F0EE0`.
Manifesto sem permissões de internet, localização ou notificações, mantendo
somente a permissão signature interna de receiver do AndroidX. APK não
versionado; o artefato CI tem assinatura/hash próprios do runner.

O usuário informou aprovação visual do APK anterior em aparelho; não se
atribui essa validação ao APK novo sem novo teste no celular.

Antes de uso real, homologar edição/seleção, colagem do clipboard, Back/Next,
teclado de fabricantes diferentes, rolagem, TalkBack e fontes ampliadas.
O navegador integrado não executa APK; não há réplica web dessas evidências.

O CI usa assinatura debug efêmera. Se o Android recusar atualização por
assinatura diferente, será necessário remover apenas o aplicativo Demo
anterior e instalar o novo APK. Não há dados persistidos neste protótipo.
Não há chave de release ou credencial nova nesta tarefa.
