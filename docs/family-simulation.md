# Simulação em família — roteiro

Um ensaio de ponta a ponta com pessoas reais da família, antes de qualquer restaurante. Objetivo: provar que a loja despacha, o motoboy entrega, o cliente acompanha e os números fecham, e anotar tudo que atrapalha.

Duração sugerida: 1 h a 1 h 30, numa tarde de fim de semana, no bairro (entregas a pé ou de moto, com pedidos fictícios como "um livro" ou "um bolo").

## Papéis

| Papel | Quem | Onde |
| --- | --- | --- |
| **Loja** | Você | PC ou notebook no `/dashboard` (Chrome) |
| **Motoboy** | 1 pessoa (de preferência 2, para testar a fila) | Celular Android com o app compilado |
| **Clientes** | 2 a 4 pessoas | O próprio celular com WhatsApp (números verificados na Meta, até 5) |
| **Observador** | Opcional | Anota tempos e problemas na tabela do fim |

## Antes do dia (no PC)

- [ ] Site publicado rodando o `main` atual (painel com pagamento, cancelar/devolver, endereço com mapa).
- [ ] Token público do Mapbox corrigido (mapa do cliente e mapinha do endereço aparecem).
- [ ] WhatsApp: números da família verificados, modelo "saiu para entrega" aprovado, segredos no Supabase e a função `dispatch-notifications` publicada (com autorização).
- [ ] App Android compilado com `auth.local.properties` e instalado no(s) celular(es) do motoboy.
- [ ] Conta da loja criada, endereço confirmado, e em **Pagamento dos motoboys**: encosta e valor por entrega (ex.: R$ 30,00 e R$ 7,00).
- [ ] Cada motoboy: conta criada no app, cadastro da moto completo, convite da loja aberto no navegador do celular e vínculo **aprovado** no painel.
- [ ] No celular do motoboy, em "Pronto para os avisos": notificações, localização e economia de bateria **ligadas**.

## Roteiro

Marque o horário de cada passo; o que não acontecer como descrito vai para a tabela de problemas.

### 1. Abertura do turno

1. Motoboy chega e toca **"Cheguei · pedir turno"**.
2. Loja vê o turno pendente (aba Motoboys com o número no celular) e **aprova**.
3. Motoboy recebe o aviso **"Turno aprovado"** com o celular no bolso, e depois **"Você é o próximo da fila"**.
   - Conferir: botão de ganhos aparece no topo (R$ 30,00 de encosta); "Seu dia" mostra "Na fila desde".

### 2. Entrega que dá certo

1. Loja cadastra 2 pedidos com o celular de dois clientes. No endereço, **escolher da lista** num e **digitar sem escolher** no outro.
2. Loja seleciona os dois, monta a rota para o motoboy e **libera a retirada**.
3. Motoboy recebe **"Rota pronta para retirada"**, pega os pedidos e **desliza para iniciar a rota** (aceitar a permissão de localização).
4. Clientes recebem o WhatsApp **"saiu para entrega"** com o link.
5. Cliente da primeira parada abre o link: vê **"Você é o próximo"** e o motoboy andando no mapa; o da parada com endereço escolhido vê também a casa.
6. Motoboy entrega e **desliza "Entregue"**. A tela passa para a próxima parada; o primeiro cliente vê "Entregue".
   - Conferir: no painel, o progresso da rota; no app, o valor de ganhos sobe R$ 7,00.

### 3. Entrega que não dá certo

1. Na segunda parada, o cliente combina de **não atender**.
2. Motoboy toca **"Não consegui entregar"**, escolhe **"Cliente não atende"** e envia.
3. Loja vê a ocorrência com som/aviso e, na Central, escolhe **"Tentar novamente"** uma vez; na segunda falha, **"Devolver"**.
4. Motoboy recebe "Volte para a loja", navega até a loja e **desliza "Cheguei na loja"**; volta para a fila.
5. Loja vê o pedido em **"Voltaram para a loja"** e toca **"Devolver à fila"** (ou cancela depois).
   - Conferir: o cliente vê "O pedido voltou para a loja"; o motoboy não ganha por essa entrega.

### 4. Ações da loja

1. Cadastrar um pedido e **cancelar** antes de montar rota.
2. Montar uma rota e **cancelar a rota** antes de liberar; os pedidos voltam a aguardar e o motoboy volta à fila.
3. Se houver dois motoboys: conferir a ordem da fila e o aviso de "próximo" passando de um para o outro.

### 5. Situações difíceis (escolha uma ou duas)

- Motoboy com **internet desligada** por 1 minuto durante a rota: a tela mostra "Sem conexão" e a posição volta a andar quando reconecta.
- **Painel fechado e reaberto** no meio da rota: tudo volta como estava.
- Motoboy com **letra grande** no celular: a parada e os botões continuam alcançáveis.

### 6. Fechamento

1. Motoboy **encerra o turno** (link discreto + confirmação).
2. Loja abre **Pagamento dos motoboys**: o acerto do dia bate com o que o motoboy vê no histórico.

## Tabela de problemas

| Hora | Quem | O que aconteceu | O que se esperava | Gravidade (trava / atrapalha / detalhe) |
| --- | --- | --- | --- | --- |
| | | | | |

Depois do ensaio: traga a tabela e as capturas de tela; cada linha "trava" vira correção antes de oferecer a um restaurante.

## Cuidados

- Use apenas números da família verificados na Meta; nunca números de terceiros.
- Pedidos fictícios: não registre dados reais além do nome e do celular de quem participa.
- Nada de apagar dados no banco depois: cancele pela tela o que sobrar.
