# Fechar o dia

No fim do expediente, a loja encerra o turno de todos os motoboys de uma vez e guarda o relatório do dia.

Migration: `supabase/migrations/20261205120000_store_day_close.sql`.

## Onde fica

- **Menu "⋯" no topo da coluna Motoboys** (ao lado de "1 disponível"), com as três opções: Convites e vínculos, Pagamentos e Fechar o dia. Assim a fila começa logo abaixo do título.
- **Também no menu da loja** (☰), abaixo de "Pagamentos dos motoboys".

## O que a tela mostra

1. **Turnos abertos:** cada motoboy, com "Na fila", "Aguardando aprovação" ou "Em rota: o turno continua até voltar".
2. **O período:** desde o último fechamento. No primeiro fechamento da loja, as últimas 24 horas.
3. **O relatório até agora:**
   - os pedidos recebidos no período: entregues, cancelados, aguardando despacho e em andamento;
   - por motoboy: entregas, quanto cobrou em dinheiro, cartão e Pix, e quanto a loja paga a ele (encosta mais o valor por entrega, como em "Pagamentos");
   - o total de cada coluna, quantas entregas já estavam pagas e quantas não tinham pagamento informado.
4. **"Encerrar turnos e fechar o dia":** pede confirmação antes. Por exemplo: "Encerra 2 turnos e salva o relatório. 1 motoboy em rota continua até voltar."
5. **Depois de fechar:** "Dia fechado em 24/11 23:40", quem teve o turno encerrado e quem ainda estava em rota. O botão **Imprimir relatório** imprime só o relatório.
6. **Relatórios anteriores:** a lista "Relatório" mostra os últimos 60 fechamentos, com a hora e quem fechou. Cada um é mostrado como foi salvo.

## Regras

- **Período, não dia do calendário:** o relatório vai do último fechamento até agora. Uma loja que fecha à 1h da manhã não perde as entregas depois da meia-noite.
- **Quem está em rota não bloqueia o fechamento:** o turno dele continua até voltar. As entregas que ele fizer depois entram no próximo fechamento.
- **Os demais turnos terminam:** na fila ou aguardando aprovação, terminam como `ENDED`, com `ended_by` de quem fechou. O app do motoboy volta para a tela inicial na próxima leitura.
- **Pedidos aguardando despacho** não são cancelados: aparecem no relatório e continuam no painel.
- **Quem pode fechar:** qualquer membro ativo da loja, operador incluído, a mesma regra de encerrar um turno.
- **Valores dos motoboys:** os mesmos de "Pagamentos". A encosta conta uma vez por motoboy por dia, com os valores copiados na aprovação do turno e na entrega.
- **O relatório salvo não muda depois**, mesmo que valores e pedidos mudem.

## Banco

- **Tabela `private.store_day_closes`:** guarda loja, início do período, hora do fechamento, quem fechou, id da requisição e o relatório em `jsonb`. Fica fora da API.
- **`get_day_close(loja)`:** turnos abertos, prévia do relatório e lista de fechamentos.
- **`close_store_day(loja, id da requisição)`:** encerra os turnos, salva e devolve o relatório.
  - O mesmo id de novo responde o fechamento já salvo.
  - Dois fechamentos ao mesmo tempo são feitos um depois do outro, porque a loja fica travada com `for no key update`. Pedidos e rotas continuam sendo salvos enquanto isso.
- **`get_day_close_report(loja, fechamento)`:** um relatório salvo.
- **Concorrência:** os turnos são travados primeiro e conferidos num comando seguinte, que já enxerga uma rota criada nesse meio-tempo. O motoboy que acabou de receber uma rota fica com o turno. A corrida 11 de `tests/sql/run-delivery-core.sh` cobre isso no PostgreSQL 17.
- **Leituras sem trava:** `get_day_close` e `get_day_close_report` são `stable`, e a API as roda numa transação somente leitura. Por isso conferem o membro com `private.require_member_to_read`, sem `for share` (migration `20261207120000`). A primeira versão travava a linha do membro e falhava com 25006 no painel, com a mensagem "Não foi possível concluir agora".
- **Testes:** `tests/sql/delivery-core/day-close-contracts.sql`, inclusive dentro de uma transação somente leitura, como a API faz.

## Aviso ao motoboy

Migration `20261206120000_shift_ended_by_store.sql`.

- **No app:** quando a loja encerra o turno, o app mostra "Cozinha da Vila encerrou seu turno às 23:40." na tela inicial.
- **Com o celular no bolso:** o serviço do turno dispara a notificação **"Turno encerrado pela loja"** antes de parar.
- **De onde vem:** `get_courier_home` traz `shiftEndedByStore` (turno, loja e hora). Vale só para o último turno do motoboy, nas últimas 12 horas, e some quando ele pede um turno novo.
- **Turno encerrado pelo próprio motoboy** não gera aviso.
- **Testes:** `tests/sql/delivery-core/shift-ended-contracts.sql`.

## Fora desta etapa

- Marcar o acerto como pago.
- Exportar o relatório em planilha.
