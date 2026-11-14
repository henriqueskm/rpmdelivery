# Avisos automáticos ao cliente — "saiu para entrega" e "você é o próximo"

Quando o motoboy toca **Iniciar rota**, cada cliente da rota recebe no WhatsApp: "Seu pedido de *Loja* saiu para entrega. Acompanhe por aqui: *link*". Ninguém na loja precisa enviar nada, e o telefone do cliente nunca passa pelo motoboy.

Depois, quando a parada de um cliente vira a **próxima** do motoboy (a anterior foi entregue ou não deu certo), ele recebe: "Você é o próximo! O entregador de *Loja* está indo até você. Acompanhe: *link*". O primeiro cliente da rota não recebe esse segundo aviso: ele já recebeu o "saiu para entrega" no mesmo instante, e o link mostra "Você é o próximo".

Para a simulação familiar usamos o **número de teste da Meta** (WhatsApp Cloud API): não exige cartão e envia para até 5 números verificados. Com restaurante real, o envio passa a ser pago por mensagem (confira a tabela oficial da Meta antes de precificar).

## Como funciona

```
start_route ──trigger──▶ delivery_notifications (TRACKING_LINK, com o telefone)
parada vira NEXT ─trigger▶ delivery_notifications (NEXT_DELIVERY, a partir da 2ª)
                                   │
app chama dispatch-notifications ──┤ claim_route_notifications (service_role)
  (JWT do motoboy ou da loja)      │   └─ só o motoboy da rota ou membro da loja
                                   ▼
                     Meta Cloud API (rpm_pedido_saiu ou rpm_voce_e_o_proximo)
                                   │
                     complete_notification: SENT | RETRY | FAILED
```

- **Fila no banco** (`delivery_notifications`): o início da rota enfileira um aviso por entrega, na mesma transação. Índice único por entrega, canal e tipo: retry, nova tentativa ou pedido que sai de novo nunca mandam a mensagem duas vezes.
- **Quem lê a fila:** só a loja (RLS existente). O motoboy não lê; as funções de envio só existem para `service_role`.
- **Edge Function `dispatch-notifications`:** recebe `{ routeId }` com o JWT do usuário, confere no banco se ele é o motoboy da rota ou membro da loja, reserva os avisos por 2 minutos (duas chamadas ao mesmo tempo não duplicam), envia e registra o resultado. Devolve só contagens, nunca telefone.
- **Falhas:** 429/5xx/rede → tenta de novo na próxima chamada; outros 4xx (número fora da lista de teste, modelo não aprovado) → FAILED. Depois de 3 tentativas, ou se o aviso tiver mais de 30 minutos ("saiu" atrasado não serve), vira FAILED. Erros guardam só o código e a mensagem da Meta, com qualquer telefone mascarado.
- **Sem configuração** (faltando token, número ou site), a função responde 503 e não mexe na fila.

## Configurar a Meta (feito por você, com a sua conta)

1. Em [developers.facebook.com](https://developers.facebook.com), crie um app com o caso de uso **WhatsApp** (conectar com clientes). A Meta cria uma conta de teste e um **número de teste**.
2. Em **WhatsApp → API Setup**: anote o **Phone number ID** e, em "To", adicione até 5 números da família; cada um confirma por código.
3. No **WhatsApp Manager → Modelos de mensagem**, crie:
   - Nome: `rpm_pedido_saiu` · Categoria: **Utilidade** · Idioma: **Português (BR)**
   - Corpo: `Seu pedido de {{1}} saiu para entrega. Acompanhe por aqui: {{2}}`
   - Exemplos: `Pizzaria Boa` e `https://seu-site/acompanhar/exemplo`
   - Aguarde a aprovação.
   - Segundo modelo: `rpm_voce_e_o_proximo` · **Utilidade** · **Português (BR)**
   - Corpo: `Você é o próximo! O entregador de {{1}} está indo até você. Acompanhe: {{2}}`
   - Mesmos exemplos. Sem ele aprovado, o "você é o próximo" falha (FAILED) e o resto segue normal.
4. Token: o da página API Setup expira em 24 h (serve para o primeiro teste). Para não expirar, crie um **usuário do sistema** nas configurações do negócio e gere um token com a permissão `whatsapp_business_messaging`.
5. Guarde no Supabase como segredos (você roda; nunca coloque esses valores em arquivo, PR ou chat):

   ```bash
   npx supabase secrets set --workdir . WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=... PUBLIC_SITE_URL=https://...
   ```

   Opcionais: `WHATSAPP_TEMPLATE` (padrão `rpm_pedido_saiu`), `WHATSAPP_TEMPLATE_NEXT` (padrão `rpm_voce_e_o_proximo`), `WHATSAPP_TEMPLATE_LANGUAGE` (padrão `pt_BR`), `WHATSAPP_GRAPH_VERSION` (padrão `v23.0`; use a versão mostrada no painel da Meta).

6. Publicar a função (`npx supabase functions deploy dispatch-notifications --workdir .`) mexe no projeto hospedado e só acontece com autorização.

## O que ainda falta para a simulação

- **Quem chama a função:** o app do motoboy chama depois de iniciar a rota, de "Entregue" e de "Não consegui entregar" (é quando a próxima parada muda). A chamada nunca trava a rota: sem a função publicada, ela falha em silêncio.
- **A página `/acompanhar/<token>`** já existe: veja `docs/delivery-core-commands.md`, fatia 4. O link só abre em produção depois do deploy do site com `PUBLIC_SITE_URL` apontando para ele.
- **"Você é o próximo"** (migration `20261115120000`): gatilho quando uma entrega vira NEXT numa rota em andamento que já tem alguma parada resolvida; uma vez por entrega, mesmo que ela volte a ser a próxima numa nova tentativa. Mesmo limite de 30 minutos e 3 tentativas.
