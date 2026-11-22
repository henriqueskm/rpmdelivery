// Manda um cupom de exemplo para a impressora virtual, como faria o sistema de um restaurante.
// Serve para conferir que o capture.mts está ouvindo antes de instalar a impressora no Windows.
//
//   node tools/print-capture/send-sample.mts            cupom ESC/POS em texto (CP850)
//   node tools/print-capture/send-sample.mts figura     cupom inteiro desenhado como figura
//   node tools/print-capture/send-sample.mts --porta 9101

import { connect } from "node:net";

const args = process.argv.slice(2);
const at = args.indexOf("--porta");
const port = at >= 0 ? Number(args[at + 1]) : 9100;
const picture = args.includes("figura");

const ESC = 0x1b, GS = 0x1d;
// CP850 for the accented letters of the sample.
const CP850: Record<string, number> = { "ç": 0x87, "ã": 0xc6, "é": 0x82, "á": 0xa0, "õ": 0xe4, "ó": 0xa2, "í": 0xa1, "ú": 0xa3, "ê": 0x88, "º": 0xa7 };
const text = (value: string) => [...value].map(char => CP850[char] ?? char.charCodeAt(0));

function textReceipt(): number[] {
  return [
    ESC, 0x40, ESC, 0x74, 2,
    ESC, 0x61, 1, ESC, 0x21, 0x30, ...text("LANCHONETE EXEMPLO\n"), ESC, 0x21, 0,
    ...text("Pedido #5127 - Delivery\n"), ESC, 0x61, 0,
    ...text("------------------------------------------\n"),
    ...text("Cliente: João Conceição\n"),
    ...text("Telefone: (11) 98877-6655\n"),
    ...text("Endereço: Rua Vergueiro, 1500 - Apto 42\n"),
    ...text("Bairro: Vila Mariana\n"),
    ...text("Referência: portão azul\n"),
    ...text("------------------------------------------\n"),
    ...text("2x X-Bacon                      R$ 58,00\n"),
    ...text("1x Refrigerante 2L              R$ 14,00\n"),
    ...text("Taxa de entrega                 R$  7,00\n"),
    ESC, 0x45, 1, ...text("TOTAL                           R$ 79,00\n"), ESC, 0x45, 0,
    ...text("Pagamento: cartão na entrega\n"),
    ...text("Obs: sem cebola no segundo lanche\n"),
    GS, 0x6b, 4, ...text("5127"), 0,
    ESC, 0x64, 4, GS, 0x56, 66, 0,
  ];
}

function pictureReceipt(): number[] {
  const width = 72, height = 640; // 576 dots: a whole 80 mm receipt drawn as one picture
  const raster: number[] = [];
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) raster.push((y >> 3) % 3 === 0 && x % 9 < 6 ? 0xff : 0);
  return [ESC, 0x40, GS, 0x76, 0x30, 0, width, 0, height & 0xff, height >> 8, ...raster, ESC, 0x64, 3, GS, 0x56, 1];
}

const bytes = Uint8Array.from(picture ? pictureReceipt() : textReceipt());
const socket = connect({ host: "127.0.0.1", port }, () => socket.end(bytes));
socket.on("close", hadError => { if (!hadError) console.log(`Cupom de exemplo (${picture ? "figura" : "texto"}, ${bytes.length} bytes) enviado para 127.0.0.1:${port}.`); });
socket.on("error", error => {
  console.error(`Não consegui enviar para 127.0.0.1:${port}: ${error.message}. O capture.mts está rodando?`);
  process.exitCode = 1;
});
