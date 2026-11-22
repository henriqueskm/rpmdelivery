// Impressora virtual de teste: finge ser uma impressora térmica de rede (porta RAW 9100), guarda cada
// impressão que chega e diz se o cupom é texto legível e o que o "Colar pedido" reconheceria nele.
// Não manda nada para fora do computador, a não ser que --repassar aponte uma impressora de verdade.
//
//   node tools/print-capture/capture.mts                       ouve em 127.0.0.1:9100
//   node tools/print-capture/capture.mts --porta 9101          outra porta
//   node tools/print-capture/capture.mts --repassar 192.168.0.50:9100   imprime também na impressora real
//   node tools/print-capture/capture.mts --ler arquivo.bin     lê uma impressão já guardada
//
// Passo a passo para instalar a impressora no Windows: tools/print-capture/README.md

import { createServer, connect, type Socket } from "node:net";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { readReceipt, type ReceiptReading } from "../../lib/printing/receipt-text.ts";
import { foundText } from "../../features/operations/paste-order.ts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

const host = option("endereco") ?? "127.0.0.1";
const port = Number(option("porta") ?? 9100);
const folder = resolve(option("pasta") ?? join("tools", "print-capture", "impressoes"));
const forward = option("repassar");
const readFileArg = option("ler");
// A job is over when the connection closes, or after this long without new bytes (some drivers keep it open).
const idleMs = Number(option("espera") ?? 3000);

const FIELD_NAMES: Record<string, string> = {
  customer: "Nome", phone: "WhatsApp", address: "Endereço", neighborhood: "Bairro",
  complement: "Complemento", reference: "Nº do pedido", notes: "Observações",
};

function report(reading: ReceiptReading, bytes: number): string {
  const lines: string[] = [];
  const encoding = { "utf-8": "UTF-8", cp850: "CP850", cp860: "CP860 (português)", cp437: "CP437", cp1252: "Windows-1252" }[reading.encoding];
  lines.push(`  ${bytes} bytes · ${reading.format === "escpos" ? "comandos ESC/POS" : reading.format === "text" ? "texto puro" : reading.format}`
    + `${reading.letters ? ` · letras em ${encoding}` : ""}${reading.images ? ` · ${reading.images} figura(s)` : ""}${reading.cut ? " · com corte de papel" : ""}`);
  if (reading.verdict === "image") {
    lines.push("  ✗ O cupom chegou como FIGURA: não há texto para ler.");
    lines.push("    O sistema ou o driver desenha o cupom como imagem. Tente o driver \"Generic / Text Only\"");
    lines.push("    ou procure no sistema do restaurante uma opção de impressão em modo texto.");
  } else if (reading.verdict === "document") {
    lines.push(`  ✗ Chegou um documento ${reading.format.toUpperCase()}, não um cupom: a impressora foi instalada com o driver errado.`);
    lines.push("    Use o driver \"Generic / Text Only\" (veja o README).");
  } else if (reading.verdict === "empty") {
    lines.push("  ✗ A impressão chegou vazia (só comandos, sem letras nem figuras).");
  } else {
    lines.push("  ✓ O cupom é TEXTO legível.");
    if (reading.found.length) {
      lines.push(`  ✓ O \"Colar pedido\" reconheceria: ${foundText(reading.found)}.`);
      for (const key of reading.found) lines.push(`      ${FIELD_NAMES[key].padEnd(13)} ${reading.order[key]}`);
    } else lines.push("  · Não reconheci campos de pedido (nome, WhatsApp, endereço) neste texto.");
    const missing = (["customer", "phone", "address"] as const).filter(key => !reading.found.includes(key));
    if (reading.found.length && missing.length)
      lines.push(`  · Faltou: ${missing.map(key => FIELD_NAMES[key].toLowerCase()).join(", ")}.`);
  }
  return lines.join("\n");
}

let jobCount = 0;
async function save(bytes: Uint8Array, reading: ReceiptReading): Promise<string> {
  await mkdir(folder, { recursive: true });
  const now = new Date();
  const two = (value: number) => String(value).padStart(2, "0");
  const stamp = `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}_${two(now.getHours())}-${two(now.getMinutes())}-${two(now.getSeconds())}`;
  jobCount += 1;
  const base = join(folder, `impressao_${stamp}_${String(jobCount).padStart(3, "0")}`);
  await writeFile(`${base}.bin`, bytes);
  await writeFile(`${base}.txt`, `${reading.text}\n`, "utf8");
  return base;
}

function passOn(bytes: Uint8Array) {
  if (!forward) return;
  const [forwardHost, forwardPort] = forward.split(":");
  const socket = connect({ host: forwardHost, port: Number(forwardPort ?? 9100) }, () => socket.end(bytes));
  socket.setTimeout(10_000, () => socket.destroy());
  socket.on("error", error => console.log(`  ! Não consegui repassar para ${forward}: ${error.message}`));
  socket.on("close", hadError => { if (!hadError) console.log(`  → Repassado para a impressora ${forward}.`); });
}

async function handle(socket: Socket) {
  const chunks: Buffer[] = [];
  let timer: NodeJS.Timeout | undefined;
  let done = false;
  const finish = async () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    socket.destroy();
    const bytes = new Uint8Array(Buffer.concat(chunks));
    if (!bytes.length) return; // the driver only checked that the printer is there
    const reading = readReceipt(bytes);
    const base = await save(bytes, reading);
    console.log(`\n[${new Date().toLocaleTimeString("pt-BR")}] Impressão recebida → ${base}.txt`);
    console.log(report(reading, bytes.length));
    if (reading.text) {
      console.log("  ─── texto do cupom ───");
      console.log(reading.text.split("\n").map(line => `  │ ${line}`).join("\n"));
    }
    passOn(bytes);
  };
  const idle = () => { clearTimeout(timer); timer = setTimeout(finish, idleMs); };
  socket.on("data", chunk => { chunks.push(chunk); idle(); });
  socket.on("end", finish);
  socket.on("close", finish);
  socket.on("error", () => { void finish(); });
  idle();
}

if (readFileArg) {
  const bytes = new Uint8Array(await readFile(readFileArg).catch(() => {
    console.error(`Não encontrei o arquivo ${readFileArg}.`);
    process.exit(1);
  }));
  const reading = readReceipt(bytes);
  console.log(`${readFileArg}`);
  console.log(report(reading, bytes.length));
  if (reading.text) console.log(`  ─── texto do cupom ───\n${reading.text.split("\n").map(line => `  │ ${line}`).join("\n")}`);
} else {
  const server = createServer(socket => { void handle(socket); });
  server.on("error", error => {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(code === "EADDRINUSE"
      ? `A porta ${port} já está em uso (outra cópia deste programa ou uma impressora instalada nela). Use --porta 9101.`
      : `Não consegui abrir a porta ${port}: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`Impressora virtual ouvindo em ${host}:${port}.`);
    console.log(`As impressões ficam em ${folder}`);
    if (forward) console.log(`Cada impressão também vai para a impressora ${forward}.`);
    console.log("Imprima algo na impressora \"RPM Teste\" (Ctrl+C para sair).");
  });
}
