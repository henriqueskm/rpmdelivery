import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deliver, inOrder, parseTarget, pointsToSelf, sendNetwork, targetText,
} from "../../tools/print-capture/forward.mts";
import { findPrinter, ownPrinters, paperPrinters, parsePrinters, shortError } from "../../tools/print-capture/windows.mts";
import { choosePaper, loadConfig, saveConfig } from "../../tools/print-capture/setup.mts";

test("impressora de papel: IP é de rede, o resto é o nome de uma impressora do Windows", () => {
  assert.deepEqual(parseTarget("192.168.0.50"), { kind: "network", host: "192.168.0.50", port: 9100 });
  assert.deepEqual(parseTarget(" 192.168.0.50:9101 "), { kind: "network", host: "192.168.0.50", port: 9101 });
  assert.deepEqual(parseTarget("Impressora.Local:9100"), { kind: "network", host: "impressora.local", port: 9100 });
  assert.deepEqual(parseTarget("EPSON TM-T20"), { kind: "windows", name: "EPSON TM-T20" });
  assert.deepEqual(parseTarget("Cozinha"), { kind: "windows", name: "Cozinha" });
  assert.deepEqual(parseTarget("Elgin i9 (USB)"), { kind: "windows", name: "Elgin i9 (USB)" });
  assert.equal(parseTarget("  "), null);
  assert.equal(parseTarget(undefined), null);
  assert.equal(targetText({ kind: "network", host: "10.0.0.9", port: 9100 }), "10.0.0.9:9100");
  // Never forward to this program itself: it would print in a circle.
  assert.equal(pointsToSelf("127.0.0.1", 9100, 9100), true);
  assert.equal(pointsToSelf("localhost", 9100, 9100), true);
  assert.equal(pointsToSelf("127.0.0.1", 9100, 9101), false);
  assert.equal(pointsToSelf("192.168.0.50", 9100, 9100), false);
  assert.equal(pointsToSelf(null, null, 9100), false);
});

test("repasse por rede: os bytes chegam como saíram, comandos e corte incluídos", async () => {
  const received: Buffer[] = [];
  const server = createServer(socket => socket.on("data", chunk => received.push(chunk)));
  await new Promise<void>(done => server.listen(0, "127.0.0.1", done));
  const port = (server.address() as { port: number }).port;
  const bytes = new Uint8Array([0x1b, 0x40, 0x41, 0x42, 0x0a, 0x1d, 0x56, 0x00]);
  await sendNetwork({ host: "127.0.0.1", port }, bytes);
  await new Promise(done => setTimeout(done, 50));
  server.close();
  assert.deepEqual(new Uint8Array(Buffer.concat(received)), bytes);
  // Nobody listening: the promise fails instead of pretending, in the store's words.
  await assert.rejects(sendNetwork({ host: "127.0.0.1", port }, bytes, 2000), /recusou a conexão/);
});

test("tenta de novo antes de avisar que não saiu no papel; um cupom de cada vez, na ordem", async () => {
  const waits: number[] = [];
  const sleep = async (ms: number) => { waits.push(ms); };
  let calls = 0;
  const flaky = async () => { calls += 1; if (calls < 3) throw new Error("sem papel"); };
  assert.deepEqual(await deliver(flaky, [2000, 5000], sleep), { ok: true, attempts: 3 });
  assert.deepEqual(waits, [2000, 5000]);
  const broken = async () => { throw new Error("impressora desligada"); };
  assert.deepEqual(await deliver(broken, [1, 1], sleep), { ok: false, attempts: 3, error: "impressora desligada" });

  // The first is slow, the second fast: the paper still comes out first, second.
  const order: string[] = [];
  const send = inOrder(async bytes => {
    await new Promise(done => setTimeout(done, bytes[0] === 1 ? 40 : 1));
    order.push(String(bytes[0]));
    return { ok: true, attempts: 1 };
  });
  await Promise.all([send(new Uint8Array([1])), send(new Uint8Array([2]))]);
  assert.deepEqual(order, ["1", "2"]);
  // One failure does not stop the next.
  const after = inOrder(async bytes => { if (bytes[0] === 1) throw new Error("x"); return { ok: true, attempts: 1 }; });
  await assert.rejects(after(new Uint8Array([1])));
  assert.deepEqual(await after(new Uint8Array([2])), { ok: true, attempts: 1 });
});

test("impressoras do Windows: o papel de verdade, sem PDF, fax, OneNote nem a própria impressora RPM", () => {
  const printers = parsePrinters(JSON.stringify([
    { name: "RPM Teste", portName: "RPM Teste 9100", host: "127.0.0.1", port: 9100 },
    { name: "EPSON TM-T20X", portName: "USB001", host: null, port: null },
    { name: "Cozinha", portName: "IP_192.168.0.50", host: "192.168.0.50", port: 9100 },
    { name: "Microsoft Print to PDF", portName: "PORTPROMPT:", host: null, port: null },
    { name: "Fax", portName: "SHRFAX:", host: null, port: null },
    { name: "OneNote for Windows 10", portName: "Microsoft.Office.OneNote_16001", host: null, port: null },
    { name: "", portName: "x" }, null,
  ]));
  assert.equal(printers.length, 6);
  assert.deepEqual(paperPrinters(printers, 9100).map(p => p.name), ["EPSON TM-T20X", "Cozinha"]);
  assert.deepEqual(ownPrinters(printers, 9100).map(p => p.name), ["RPM Teste"]);
  // A single printer comes as an object, not a list.
  assert.equal(parsePrinters('{"name":"Só uma","portName":"USB001","host":null,"port":null}').length, 1);
  assert.deepEqual(parsePrinters("lixo"), []);
  assert.equal(findPrinter(printers, " epson tm-t20x ")?.name, "EPSON TM-T20X");
});

test("erro do PowerShell vira uma frase curta", () => {
  const clixml = '#< CLIXML\r\n<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">'
    + '<S S="Error">Exceção ao chamar "Send" com "2" argumento(s): "O nome da impressora é inválido"_x000D__x000A_</S>'
    + '<S S="Error">No linha:40 caractere:1_x000D__x000A_</S><S S="Error">+ [RpmRawPrint]::Send()_x000D__x000A_</S></Objs>';
  assert.equal(shortError(clixml), "O nome da impressora é inválido");
  assert.equal(shortError("Access is denied\r\nAt line:1 char:1"), "Access is denied");
  assert.equal(shortError(""), "erro do Windows");
});

test("configuração da loja: escolher a impressora de papel e guardar", async () => {
  const paper = parsePrinters(JSON.stringify([
    { name: "EPSON TM-T20X", portName: "USB001" }, { name: "Cozinha", portName: "IP_1", host: "192.168.0.50", port: 9100 }]));
  assert.deepEqual(choosePaper("1", paper), { forward: "EPSON TM-T20X" });
  assert.deepEqual(choosePaper(" 2 ", paper), { forward: "Cozinha" });
  assert.deepEqual(choosePaper("0", paper, "Cozinha"), {}, "0: no paper");
  assert.deepEqual(choosePaper("", paper, "Cozinha"), { forward: "Cozinha" }, "Enter keeps it");
  assert.deepEqual(choosePaper("", paper), {});
  assert.deepEqual(choosePaper("192.168.0.77", paper), { forward: "192.168.0.77:9100" });
  assert.equal(choosePaper("3", paper), null, "not on the list");
  assert.equal(choosePaper("Epson", paper), null, "a typed name is not trusted: pick from the list");

  const folder = await mkdtemp(join(tmpdir(), "rpm-config-"));
  assert.deepEqual(await loadConfig(folder), {}, "no file yet");
  await saveConfig(folder, { forward: "EPSON TM-T20X", system: "Gestor iFood", setupDone: true });
  assert.deepEqual(await loadConfig(folder), { forward: "EPSON TM-T20X", system: "Gestor iFood", setupDone: true });
  assert.match(await readFile(join(folder, "config.json"), "utf8"), /"forward": "EPSON TM-T20X"/);
});
