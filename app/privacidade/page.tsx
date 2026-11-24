import type { Metadata } from "next";
import { Brand } from "@/components/brand";
import { PRIVACY_CONTACT, PRIVACY_UPDATED } from "@/features/legal/privacy-contact";

export const metadata: Metadata = {
  title: "Política de privacidade | RpmDelivery",
  description: "Como o RpmDelivery e o app RpmDelivery Motoboy tratam dados de motoboys, lojas e clientes.",
};

// Public page, linked from the courier app and from Google's app registration. Plain language; every
// item matches what the app and the panel actually do (docs/android-release.md lists the sources).
export default function PrivacyPage() {
  return <main className="legal-page">
    <header className="legal-header"><Brand /></header>
    <h1>Política de privacidade</h1>
    <p className="legal-updated">Atualizada em {PRIVACY_UPDATED}.</p>

    <p>
      O RpmDelivery é um sistema de entregas usado por restaurantes com motoboys próprios: o painel da loja e o
      app <strong>RpmDelivery Motoboy</strong>. Esta página explica quais dados usamos, para quê e como pedir
      acesso, correção ou exclusão, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).
    </p>

    <h2>Quem é o responsável</h2>
    <p>
      {PRIVACY_CONTACT.name}, responsável pelo RpmDelivery. Contato para privacidade:{" "}
      <a href={`mailto:${PRIVACY_CONTACT.email}`}>{PRIVACY_CONTACT.email}</a>.
      Cada loja que usa o sistema também responde pelos dados dos seus pedidos e dos motoboys com quem trabalha.
    </p>

    <h2>Dados do motoboy (app RpmDelivery Motoboy)</h2>
    <ul>
      <li><strong>Conta e cadastro:</strong> nome, e-mail, celular e os dados da moto (modelo, placa e cor). Servem para entrar no app, para a loja saber quem você é e para o cliente reconhecer quem vai entregar.</li>
      <li><strong>Localização:</strong> só enquanto você está numa rota, com o aviso fixo do app na tela. Serve para a loja e o cliente acompanharem a entrega e para registrar a chegada. O app não pede localização em segundo plano fora da rota.</li>
      <li><strong>Turnos e entregas:</strong> horários do turno, rotas, entregas feitas, ocorrências e valores combinados com a loja, para a fila de entregas, o pagamento e o fechamento do dia.</li>
      <li><strong>Câmera:</strong> só para ler o QR Code do convite da loja. A imagem não é guardada nem enviada.</li>
      <li><strong>Notificações:</strong> avisos do turno e da rota (turno aprovado, rota liberada, turno encerrado pela loja).</li>
    </ul>

    <h2>Dados dos clientes das lojas</h2>
    <p>
      Nome, telefone ou contato do app de pedidos, endereço e forma de pagamento de cada pedido, vindos da loja.
      Servem para montar as rotas, informar o motoboy e enviar o link de acompanhamento. O link mostra a posição do
      motoboy durante a entrega e deixa de funcionar 24 horas depois da entrega ou do cancelamento.
    </p>

    <h2>Com quem os dados são compartilhados</h2>
    <ul>
      <li>Com a loja em que você trabalha ou em que o cliente pediu, apenas os dados daquela loja.</li>
      <li>Com o cliente do pedido: o nome e a moto do motoboy e a posição dele durante a entrega.</li>
      <li>Com os serviços que mantêm o sistema funcionando: Supabase (banco de dados e contas), Vercel (site) e Mapbox (mapas e busca de endereços). Eles tratam os dados apenas para prestar esse serviço.</li>
    </ul>
    <p>Não vendemos dados e não usamos dados para publicidade.</p>

    <h2>Por quanto tempo</h2>
    <p>
      Enquanto a conta existir e a loja precisar do histórico de entregas e pagamentos. Você pode pedir a exclusão
      a qualquer momento; o que a lei obrigar a guardar fica guardado só pelo prazo exigido.
    </p>

    <h2>Seus direitos e exclusão da conta</h2>
    <p>
      Você pode pedir acesso, correção, exclusão da conta e dos seus dados, ou tirar dúvidas, pelo e-mail{" "}
      <a href={`mailto:${PRIVACY_CONTACT.email}`}>{PRIVACY_CONTACT.email}</a>, informando o e-mail da sua conta.
      Respondemos em até 15 dias.
    </p>

    <h2>Segurança</h2>
    <p>
      As conexões são criptografadas, cada loja só enxerga os próprios dados e o app não guarda cópia de segurança
      dos seus dados no celular. Se algo mudar nesta política, a data no topo desta página muda junto.
    </p>
  </main>;
}
