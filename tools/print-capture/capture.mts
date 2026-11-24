// Impressora virtual: finge ser uma impressora térmica de rede (porta RAW 9100), guarda cada impressão
// que chega e diz se o cupom é texto legível e o que o "Colar pedido" reconheceria nele.
// Não manda nada para fora do computador, a não ser que --repassar aponte uma impressora de verdade.
//
//   node tools/print-capture/capture.mts                       ouve em 127.0.0.1:9100
//   node tools/print-capture/capture.mts --porta 9101          outra porta
//   node tools/print-capture/capture.mts --repassar 192.168.0.50:9100   imprime também na impressora de rede
//   node tools/print-capture/capture.mts --repassar "EPSON TM-T20"      ou numa impressora do Windows (USB)
//   node tools/print-capture/capture.mts --app                 modo loja (pasta RpmImpressora): configuração
//                                                              e impressões em %APPDATA%\RpmImpressora
//   node tools/print-capture/capture.mts --app --configurar    refaz a configuração
//   node tools/print-capture/capture.mts --ler arquivo.bin     lê uma impressão já guardada
//   node tools/print-capture/capture.mts --sistema "Balcão"    nome do sistema que imprime, mostrado no painel
//   node tools/print-capture/capture.mts --sem-painel          não entrega os pedidos ao painel
//
// Cada cupom com pedido fica disponível para o painel aberto neste computador (127.0.0.1:9180), que o
// mostra em "Pedidos" quando a opção "Pedidos da impressora" está ligada no menu da loja. A fila fica
// também no arquivo fila.json da pasta das impressões: fechar o programa ou reiniciar o computador não
// perde os pedidos que o painel ainda não pegou (os das últimas 24 horas voltam ao abrir).
//
// Passo a passo para instalar a impressora no Windows: tools/print-capture/README.md

import { createServer, type Socket } from "node:net";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { readReceipt, type ReceiptReading } from "../../lib/printing/receipt-text.ts";
import { foundText } from "../../features/operations/paste-order.ts";
import { draftText } from "../../features/operations/payment.ts";
import { allowedRequest, isOrderLike, PANEL_HEADER, PANEL_ORIGINS, PRINTER_INBOX_PORT, QUEUE_LIMIT }
  from "../../lib/printing/printer-inbox.ts";
import { emptyQueue, placeReceipt, QUEUE_WARNING, queueToSave, restoreQueue, takeOrder }
  from "../../lib/printing/printer-queue.ts";
import { deliver, inOrder, parseTarget, pointsToSelf, sendNetwork, targetText, type Delivery, type ForwardTarget } from "./forward.mts";
import { findPrinter, listPrinters, rawPrint } from "./windows.mts";
import { loadConfig, runSetup, type AppConfig } from "./setup.mts";

const args = process.argv.slice(2);
const option = (name: string) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 ? args[at + 1] : undefined;
};

// Store mode (the RpmImpressora folder): settings and prints in the user's AppData, not in the project.
const appMode = args.includes("--app");
const appFolder = join(process.env.APPDATA ?? homedir(), "RpmImpressora");
const host = option("endereco") ?? "127.0.0.1";
const port = Number(option("porta") ?? 9100);
const folder = resolve(option("pasta") ?? (appMode ? join(appFolder, "impressoes") : join("tools", "print-capture", "impressoes")));
const readFileArg = option("ler");
// A job is over when the connection closes, or after this long without new bytes (some drivers keep it open).
const idleMs = Number(option("espera") ?? 3000);
const panel = !args.includes("--sem-painel");
const panelPort = Number(option("porta-painel") ?? PRINTER_INBOX_PORT);
const panelOrigins = [...PANEL_ORIGINS, ...(option("origem") ? [option("origem")!.replace(/\/+$/, "")] : [])];
let systemName = option("sistema")?.trim().slice(0, 40) || null;

/** Printed orders the panel has not taken yet (newest last) and the codes given out, also in queueFile. */
const queue = emptyQueue();
const queueFile = join(folder, "fila.json");
let queueSaving: Promise<void> = Promise.resolve();

/** One save at a time, each with the latest queue; a half-written file never replaces the good one. */
function saveQueue() {
  const text = JSON.stringify(queueToSave(queue, new Date()));
  queueSaving = queueSaving.then(async () => {
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(`${queueFile}.tmp`, text, "utf8");
      await rename(`${queueFile}.tmp`, queueFile);
    } catch (error) {
      console.log(`  ! Não consegui gravar a fila em ${queueFile}: ${(error as Error).message}`);
    }
  });
}

async function loadQueue() {
  let saved: unknown;
  try { saved = JSON.parse(await readFile(queueFile, "utf8")); } catch { return; }
  const restored = restoreQueue(saved, new Date());
  queue.inbox.push(...restored.inbox);
  queue.seen.push(...restored.seen);
  if (restored.inbox.length)
    console.log(`${restored.inbox.length} pedido(s) da impressora ainda esperando o painel desde a última vez.`);
}

function offerToPanel(reading: ReceiptReading, receivedAt: Date) {
  if (!panel || reading.verdict !== "text" || !isOrderLike(reading.found)) return;
  // Picked up at the counter: no courier. The paper still prints; the panel's delivery queue skips it.
  if (reading.pickup) {
    console.log("  → Retirada na loja: não vai para o painel (o cupom sai no papel normalmente).");
    return;
  }
  const fingerprint = createHash("sha256").update(reading.text.replace(/\s+/g, " ").trim()).digest("hex");
  const placed = placeReceipt(queue, { id: randomUUID(), receivedAt, fingerprint, app: systemName,
    order: reading.order, found: reading.found, payment: reading.payment });
  saveQueue();
  console.log(placed.reprint
    ? `  → Segunda via do pedido ${placed.externalId}: no painel continua um só.`
    : `  → Pronto para o painel (código ${placed.externalId}). Abra "Pedidos" no painel deste computador.`);
  for (const item of placed.dropped)
    console.log(`  ! Fila cheia (${QUEUE_LIMIT}): o pedido ${item.externalId} saiu da fila sem ir ao painel. Confira no papel.`);
  if (queue.inbox.length >= QUEUE_WARNING)
    console.log(`  ! ${queue.inbox.length} pedidos esperando: o painel deste computador está aberto, com "Pedidos da impressora" ligado?`);
}

function answer(response: ServerResponse, status: number, origin: string | undefined, body?: unknown) {
  response.statusCode = status;
  response.setHeader("Vary", "Origin");
  response.setHeader("Cache-Control", "no-store");
  if (origin && panelOrigins.includes(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
  if (body === undefined) { response.end(); return; }
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

function servePanel(request: IncomingMessage, response: ServerResponse) {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (request.method === "OPTIONS") {
    // The browser asks first because of the panel's header; only the panel's pages get a yes.
    if (!allowedRequest({ host, origin, panel: "1" }, panelPort, panelOrigins) || !origin) {
      answer(response, 403, undefined); return;
    }
    response.setHeader("Access-Control-Allow-Methods", "GET, POST");
    response.setHeader("Access-Control-Allow-Headers", PANEL_HEADER);
    // Chrome asks a public page (the hosted panel) before it reaches this computer.
    response.setHeader("Access-Control-Allow-Private-Network", "true");
    response.setHeader("Access-Control-Max-Age", "600");
    answer(response, 204, origin);
    return;
  }
  const panelHeader = request.headers[PANEL_HEADER];
  if (!allowedRequest({ host, origin, panel: Array.isArray(panelHeader) ? panelHeader[0] : panelHeader }, panelPort, panelOrigins)) {
    answer(response, 403, undefined); return;
  }
  const path = (request.url ?? "/").split("?")[0];
  if (request.method === "GET" && path === "/pedidos") { answer(response, 200, origin, { orders: queue.inbox }); return; }
  const taken = path.match(/^\/pedidos\/([\w-]{1,64})\/concluido$/);
  if (request.method === "POST" && taken) {
    const item = takeOrder(queue, taken[1]);
    if (item) {
      saveQueue();
      console.log(`\n[${new Date().toLocaleTimeString("pt-BR")}] O painel tirou da lista o pedido da impressora (código ${item.externalId}).`);
    }
    answer(response, 204, origin);
    return;
  }
  answer(response, 404, origin, { error: "not found" });
}

const FIELD_NAMES: Record<string, string> = {
  customer: "Nome", phone: "WhatsApp", contact: "Contato do app", address: "Endereço", neighborhood: "Bairro", city: "Cidade",
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
    if (reading.found.length) lines.push(`      ${"Pagamento".padEnd(13)} ${draftText(reading.payment)}`);
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

/** Sends each print on to the real printer, in order, trying again before giving up. Null: no paper. */
let toPaper: ((bytes: Uint8Array) => Promise<Delivery>) | null = null;
let paperName = "";

function paperTarget(target: ForwardTarget) {
  paperName = targetText(target);
  const send = target.kind === "network"
    ? (bytes: Uint8Array) => sendNetwork(target, bytes)
    : (bytes: Uint8Array) => rawPrint(target.name, bytes);
  toPaper = inOrder(bytes => deliver(() => send(bytes)));
}

/** Checks the paper printer before the first print: missing, or this program itself, means no paper. */
async function preparePaper(text: string | undefined) {
  const target = parseTarget(text);
  if (!target) return;
  if (target.kind === "network") {
    if (pointsToSelf(target.host, target.port, port)) {
      console.log(`  ! ${targetText(target)} é este próprio programa: repassar para ele imprimiria em círculo. Sem papel.`);
      return;
    }
    paperTarget(target);
    return;
  }
  if (process.platform !== "win32") {
    console.log(`  ! "${target.name}" é uma impressora do Windows, e este computador não é Windows. Sem papel.`);
    return;
  }
  const printers = await listPrinters().catch(() => null);
  const printer = printers && findPrinter(printers, target.name);
  if (printers && !printer) {
    console.log(`  ! Não achei a impressora "${target.name}" no Windows. Os cupons NÃO vão sair no papel.`);
    console.log("    Confira o nome em Impressoras e scanners, ou abra \"Configurar RPM Impressora\".");
    return;
  }
  if (printer && pointsToSelf(printer.host, printer.port, port)) {
    console.log(`  ! "${printer.name}" manda para este próprio programa: repassar para ela imprimiria em círculo. Sem papel.`);
    console.log("    Escolha a impressora térmica de verdade em \"Configurar RPM Impressora\".");
    return;
  }
  paperTarget(printer ? { kind: "windows", name: printer.name } : target);
}

function paperResult(result: Delivery) {
  const time = new Date().toLocaleTimeString("pt-BR");
  if (result.ok) {
    console.log(`[${time}] → Saiu no papel em ${paperName}${result.attempts > 1 ? ` (na ${result.attempts}ª tentativa)` : ""}.`);
    return;
  }
  // Loud on purpose (with the terminal bell): the kitchen is waiting for this paper.
  console.log(`\x07\n[${time}] !!! O CUPOM NÃO SAIU NO PAPEL em ${paperName}: ${result.error}`);
  console.log("    Confira se a impressora está ligada, com papel e conectada, e imprima o pedido de novo no sistema.");
}

// A browser opening http://127.0.0.1:9100 sends an HTTP request, cookies and session tokens
// included. That is never a print job: answer with a short page and keep nothing.
const httpRequest = /^(GET|POST|HEAD|PUT|PATCH|DELETE|OPTIONS|CONNECT) \S+ HTTP\/\d/;

const browserPage = [
  "<!doctype html><meta charset=\"utf-8\"><title>Impressora de teste</title>",
  "<body style=\"font-family:system-ui;max-width:36rem;margin:3rem auto;padding:0 1rem\">",
  "<h1>Esta é a impressora de teste</h1>",
  "<p>Ela não abre no navegador. Imprima pelo Windows na impressora RPM e veja o resultado na janela do programa.</p>",
].join("");

function refuseBrowser(socket: Socket) {
  const body = Buffer.from(browserPage, "utf8");
  socket.end(Buffer.concat([
    Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n`, "latin1"),
    body,
  ]));
  console.log(`\n[${new Date().toLocaleTimeString("pt-BR")}] Um navegador abriu este endereço. Isso não é uma impressão: nada foi guardado nem mostrado.`);
  console.log("  Imprima pelo Windows na impressora RPM em vez de abrir 127.0.0.1:9100 no navegador.");
}

async function handle(socket: Socket) {
  const chunks: Buffer[] = [];
  let timer: NodeJS.Timeout | undefined;
  let done = false;
  let checked = false;
  const finish = async () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    socket.destroy();
    const bytes = new Uint8Array(Buffer.concat(chunks));
    if (!bytes.length) return; // the driver only checked that the printer is there
    // Paper first: the kitchen gets its copy whatever the reading finds.
    const paper = toPaper?.(bytes);
    const reading = readReceipt(bytes);
    const base = await save(bytes, reading);
    console.log(`\n[${new Date().toLocaleTimeString("pt-BR")}] Impressão recebida → ${base}.txt`);
    console.log(report(reading, bytes.length));
    if (reading.text) {
      console.log("  ─── texto do cupom ───");
      console.log(reading.text.split("\n").map(line => `  │ ${line}`).join("\n"));
    }
    offerToPanel(reading, new Date());
    if (paper) paperResult(await paper);
  };
  const idle = () => { clearTimeout(timer); timer = setTimeout(finish, idleMs); };
  socket.on("data", chunk => {
    if (done) return;
    chunks.push(chunk);
    if (!checked) {
      const start = Buffer.concat(chunks);
      if (start.length >= 16 || start.includes(0x0a)) {
        checked = true;
        if (httpRequest.test(start.subarray(0, 64).toString("latin1"))) {
          done = true;
          clearTimeout(timer);
          chunks.length = 0;
          refuseBrowser(socket);
          return;
        }
      }
    }
    idle();
  });
  socket.on("end", finish);
  socket.on("close", finish);
  socket.on("error", () => { void finish(); });
  idle();
}

async function main() {
  if (readFileArg) {
    const bytes = new Uint8Array(await readFile(readFileArg).catch(() => {
      console.error(`Não encontrei o arquivo ${readFileArg}.`);
      process.exit(1);
    }));
    const reading = readReceipt(bytes);
    console.log(`${readFileArg}`);
    console.log(report(reading, bytes.length));
    if (reading.text) console.log(`  ─── texto do cupom ───\n${reading.text.split("\n").map(line => `  │ ${line}`).join("\n")}`);
    return;
  }

  if (appMode) {
    let config: AppConfig = await loadConfig(appFolder);
    if (!config.setupDone || args.includes("--configurar"))
      config = await runSetup(appFolder, port, config, process.env.RPM_LAUNCHER ?? null);
    systemName = option("sistema")?.trim().slice(0, 40) || config.system || null;
    await preparePaper(option("repassar") ?? config.forward);
  } else {
    await preparePaper(option("repassar"));
  }

  if (panel) await loadQueue();
  const server = createServer(socket => { void handle(socket); });
  server.on("error", error => {
    const code = (error as NodeJS.ErrnoException).code;
    console.error(code === "EADDRINUSE"
      ? appMode
        ? `A porta ${port} já está em uso: o programa já deve estar aberto (veja a barra de tarefas).`
        : `A porta ${port} já está em uso (outra cópia deste programa ou uma impressora instalada nela). Use --porta 9101.`
      : `Não consegui abrir a porta ${port}: ${error.message}`);
    process.exit(1);
  });
  server.listen(port, host, () => {
    console.log(`Impressora virtual ouvindo em ${host}:${port}.`);
    console.log(`As impressões ficam em ${folder}`);
    console.log(toPaper ? `Cada cupom também sai no papel em ${paperName}.` : "Sem impressora de papel: os cupons não saem no papel.");
    console.log(appMode ? "Deixe esta janela aberta (pode minimizar): fechar a janela para de receber os pedidos."
      : "Imprima algo na impressora \"RPM Teste\" (Ctrl+C para sair).");
  });
  if (panel) {
    const panelServer = createHttpServer(servePanel);
    panelServer.on("error", error => {
      const code = (error as NodeJS.ErrnoException).code;
      console.log(code === "EADDRINUSE"
        ? `  ! A porta ${panelPort} do painel já está em uso: os pedidos não vão para o painel. Use --porta-painel.`
        : `  ! Não consegui abrir a porta ${panelPort} do painel: ${error.message}`);
    });
    // Only this computer: the panel open here asks for the printed orders.
    panelServer.listen(panelPort, "127.0.0.1", () =>
      console.log(`Pedidos para o painel deste computador em 127.0.0.1:${panelPort}.`));
  }
}

void main();
