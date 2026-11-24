import { test } from "node:test";
import assert from "node:assert/strict";
import { decodeReceipt, readReceipt } from "../../lib/printing/receipt-text.ts";

// Bytes of a print job: strings are written one byte per character (latin1), numbers as they are.
function job(...parts: (string | number | number[] | Uint8Array)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "number") out.push(part);
    else if (typeof part === "string") for (const char of part) out.push(char.charCodeAt(0));
    else out.push(...part);
  }
  return Uint8Array.from(out);
}
const ESC = 0x1b, GS = 0x1d;

test("as tabelas de código têm 128 letras cada", () => {
  for (let byte = 0x80; byte <= 0xff; byte += 1) {
    for (const page of [0, 2, 3]) {
      const text = decodeReceipt(job(ESC, 0x74, page, "a", byte, "a")).text;
      assert.equal([...text].length, 3, `ESC t ${page}, byte ${byte.toString(16)}`);
    }
  }
});

test("cupom ESC/POS em CP850: tira os comandos e lê o pedido", () => {
  // "Endereço" and "São" with ç = 0x87 and ã = 0xC6 in CP850.
  const bytes = job(
    ESC, 0x40, ESC, 0x74, 2,
    ESC, 0x61, 1, ESC, 0x45, 1, "PEDIDO #4821\n", ESC, 0x45, 0,
    ESC, 0x61, 0,
    "Cliente: Jo", 0xc6, "o Pereira\n",
    "Telefone: (11) 98765-4321\n",
    "Endere", 0x87, "o: Rua das Flores, 120 - Apto 3\n",
    "Bairro: Vila Mariana\n",
    "Obs: sem cebola\n",
    "1x X-Salada        R$ 25,00\n",
    ESC, 0x45, 1, "TOTAL              R$ 32,00\n", ESC, 0x45, 0,
    "Pagamento: cart", 0xc6, "o na entrega\n",
    ESC, 0x64, 4, GS, 0x56, 66, 0,
  );
  const reading = readReceipt(bytes);
  assert.deepEqual(reading.payment, { method: "CARD", amountDueCents: 3200 }, "the payment goes to the panel too");
  assert.equal(reading.pickup, false);
  assert.equal(readReceipt(job("*** MODALIDADE: RETIRADA NA LOJA ***\nCLIENTE: Maria Oliveira\n")).pickup, true,
    "a pickup never goes to the panel's delivery queue");
  assert.equal(reading.format, "escpos");
  assert.equal(reading.encoding, "cp850");
  assert.equal(reading.verdict, "text");
  assert.equal(reading.cut, true);
  assert.match(reading.text, /^PEDIDO #4821\nCliente: João Pereira\n/);
  assert.match(reading.text, /Endereço: Rua das Flores/);
  assert.equal(reading.order.customer, "João Pereira");
  assert.equal(reading.order.phone, "11987654321");
  assert.equal(reading.order.address, "Rua das Flores, 120");
  assert.equal(reading.order.complement, "Apto 3");
  assert.equal(reading.order.neighborhood, "Vila Mariana");
  assert.equal(reading.order.reference, "4821");
  assert.deepEqual(reading.found, ["customer", "phone", "address", "neighborhood", "complement", "reference", "notes"]);
});

test("texto puro do driver Generic / Text Only, em Windows-1252", () => {
  const bytes = job("Pedido 77\r\nCliente: Ana Concei", 0xe7, 0xe3, "o\r\nRua Tr", 0xea, "s, 10\r\n\x0c");
  const reading = readReceipt(bytes);
  assert.equal(reading.format, "text");
  assert.equal(reading.encoding, "cp1252");
  assert.equal(reading.text, "Pedido 77\nCliente: Ana Conceição\nRua Três, 10");
  assert.equal(reading.order.customer, "Ana Conceição");
  assert.equal(reading.order.address, "Rua Três, 10");
});

test("sem ESC t: escolhe a página que faz sentido em português", () => {
  // CP850: "Conceição" = ç 0x87, ã 0xC6; read as Windows-1252 it would be "Concei‡Æo".
  const cp850 = readReceipt(job("Cliente: Ana Concei", 0x87, 0xc6, "o\n"));
  assert.equal(cp850.encoding, "cp850");
  assert.equal(cp850.order.customer, "Ana Conceição");
  // CP860 (Portuguese): ã = 0x84, õ = 0x94.
  const cp860 = readReceipt(job("Observa", 0x87, 0x94, "es: port", 0x84, "o azul\n"));
  assert.equal(cp860.encoding, "cp860");
  assert.equal(cp860.text, "Observações: portão azul");
});

test("UTF-8 vale como está", () => {
  const bytes = new TextEncoder().encode("Cliente: José Antônio\nAv. Paulista, 1000\n");
  const reading = readReceipt(bytes);
  assert.equal(reading.encoding, "utf-8");
  assert.equal(reading.order.customer, "José Antônio");
  assert.equal(reading.order.address, "Av. Paulista, 1000");
});

test("cupom impresso como figura: avisa que não há texto", () => {
  const width = 72, height = 600; // 576 dots wide, 600 lines: a whole receipt
  const raster = new Uint8Array(width * height).fill(0xaa);
  const reading = readReceipt(job(ESC, 0x40, GS, 0x76, 0x30, 0, width, 0, height & 0xff, height >> 8, raster, GS, 0x56, 1));
  assert.equal(reading.verdict, "image");
  assert.equal(reading.images, 1);
  assert.equal(reading.imageBytes, width * height);
  assert.equal(reading.text, "");
  assert.deepEqual(reading.found, []);
  assert.equal(reading.cut, true);
});

test("logo em figura e o resto em texto: lê o texto", () => {
  const logo = new Uint8Array(48 * 60).fill(0xff);
  const reading = readReceipt(job(
    GS, 0x76, 0x30, 0, 48, 0, 60, 0, logo,
    "Cliente: Maria Souza\nTelefone: 11 91234-5678\nRua Augusta, 900\n",
    ESC, 0x2a, 33, 2, 0, [1, 2, 3, 4, 5, 6], "\n",
  ));
  assert.equal(reading.verdict, "text");
  assert.equal(reading.images, 2);
  assert.equal(reading.order.customer, "Maria Souza");
  assert.equal(reading.order.phone, "11912345678");
  assert.equal(reading.order.address, "Rua Augusta, 900");
});

test("código de barras, QR e gaveta não viram letras", () => {
  const qr = job("1Q0https://exemplo.test/p/1");
  const bytes = job(
    "Pedido 9\n",
    GS, 0x6b, 4, "123456", 0, // CODE39, NUL terminated
    GS, 0x6b, 73, 5, "{B123", // CODE128 with length
    GS, 0x28, 0x6b, qr.length, 0, qr, // QR code data
    ESC, 0x70, 0, 25, 250, // cash drawer
    "Fim\n",
  );
  assert.equal(decodeReceipt(bytes).text, "Pedido 9\nFim");
});

test("PDF, PostScript e PCL: driver errado", () => {
  assert.equal(readReceipt(job("%PDF-1.7\n...")).verdict, "document");
  assert.equal(readReceipt(job("%!PS-Adobe-3.0\n")).verdict, "document");
  assert.equal(readReceipt(job("\x1b%-12345X@PJL JOB\n")).verdict, "document");
});

test("trabalho vazio ou só comandos", () => {
  assert.equal(readReceipt(new Uint8Array()).verdict, "empty");
  assert.equal(readReceipt(job(ESC, 0x40, GS, 0x56, 0)).verdict, "empty");
});

test("comando cortado no fim não trava", () => {
  assert.doesNotThrow(() => decodeReceipt(job("Oi\n", GS, 0x76, 0x30, 0, 200)));
  assert.doesNotThrow(() => decodeReceipt(job("Oi\n", ESC)));
  assert.equal(decodeReceipt(job("Oi\n", ESC)).text, "Oi");
});
