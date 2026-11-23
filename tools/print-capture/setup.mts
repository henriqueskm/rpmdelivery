// Configuração do programa instalado na loja (modo --app): fica em %APPDATA%\RpmImpressora\config.json.
// Na primeira vez (ou com --configurar), pergunta no próprio terminal:
//   1. instalar a impressora RPM no Windows, se ainda não houver uma apontando para este programa;
//   2. em qual impressora o cupom continua saindo no papel (Windows ou IP de rede), ou nenhuma;
//   3. o nome do sistema que imprime (opcional);
//   4. abrir junto com o Windows.

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { parseTarget, targetText } from "./forward.mts";
import { installPrinter, listPrinters, ownPrinters, paperPrinters, RPM_PRINTER_NAME, type WindowsPrinter } from "./windows.mts";

export type AppConfig = {
  /** Where the receipt keeps coming out on paper: a Windows printer name or "ip:port". */
  forward?: string;
  /** The order system's name, shown on the panel ("Gestor iFood"). */
  system?: string;
  /** Set once the first setup ran to the end. */
  setupDone?: boolean;
};

export async function loadConfig(folder: string): Promise<AppConfig> {
  try {
    const value = JSON.parse(await readFile(join(folder, "config.json"), "utf8")) as Record<string, unknown>;
    return {
      ...(typeof value.forward === "string" && value.forward.trim() ? { forward: value.forward.trim().slice(0, 200) } : {}),
      ...(typeof value.system === "string" && value.system.trim() ? { system: value.system.trim().slice(0, 40) } : {}),
      ...(value.setupDone === true ? { setupDone: true } : {}),
    };
  } catch { return {}; }
}

export async function saveConfig(folder: string, config: AppConfig): Promise<void> {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

/**
 * The answer to "where does it come out on paper": a number from the list, an IP, 0 for none, or
 * Enter to keep [current] (none when there is none). A number outside the list is refused (null),
 * so a typo never becomes a printer name.
 */
export function choosePaper(answer: string, printers: WindowsPrinter[], current?: string): { forward?: string } | null {
  const value = answer.trim();
  if (!value) return current ? { forward: current } : {};
  if (value === "0") return {};
  if (/^\d{1,2}$/.test(value)) {
    const printer = printers[Number(value) - 1];
    return printer ? { forward: printer.name } : null;
  }
  const target = parseTarget(value);
  return target?.kind === "network" ? { forward: targetText(target) } : null;
}

const yes = (answer: string, byDefault: boolean) => {
  const value = answer.trim().toLowerCase();
  return value ? value.startsWith("s") || value.startsWith("y") : byDefault;
};

/** Windows' Startup folder: a small .cmd there opens the program, minimized, at every sign-in. */
function startupFile(): string | null {
  return process.env.APPDATA
    ? join(process.env.APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "RPM Impressora.cmd")
    : null;
}

/**
 * Questions in the terminal. Lines typed (or piped) before a question is asked are kept for it, and
 * once the input ends every question gets an empty answer (its default). The console echoes what is
 * typed: readline runs without terminal mode.
 */
function lineReader() {
  const reader = createInterface({ input: process.stdin, terminal: false });
  const lines: string[] = [];
  const waiting: ((line: string) => void)[] = [];
  let ended = false;
  reader.on("line", line => { const next = waiting.shift(); if (next) next(line); else lines.push(line); });
  reader.on("close", () => { ended = true; for (const next of waiting.splice(0)) next(""); });
  const piped = !process.stdin.isTTY;
  return {
    async question(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      const line = lines.length ? lines.shift()! : ended ? "" : await new Promise<string>(done => waiting.push(done));
      if (piped) process.stdout.write(`${line}\n`);
      return line;
    },
    close: () => reader.close(),
  };
}

/** The interactive setup; returns the saved configuration. [launcher] is the .cmd that opens the program. */
export async function runSetup(folder: string, listenPort: number, current: AppConfig, launcher: string | null): Promise<AppConfig> {
  const ask = lineReader();
  try {
    console.log("\n=== RPM Impressora: configuração ===\n");

    // 1. The RPM printer in Windows.
    let printers = await listPrinters().catch(error => {
      console.log(`  ! Não consegui ler as impressoras do Windows: ${error instanceof Error ? error.message : error}`);
      return [] as WindowsPrinter[];
    });
    const own = ownPrinters(printers, listenPort);
    if (own.length) {
      console.log(`1. Impressora RPM no Windows: já instalada ("${own[0].name}").`);
    } else {
      console.log("1. Ainda não há uma impressora no Windows mandando para este programa.");
      if (yes(await ask.question(`   Instalar a impressora "${RPM_PRINTER_NAME}" agora? O Windows vai pedir permissão de administrador. (S/n) `), true)) {
        console.log("   Instalando… confirme na janela do Windows.");
        if (await installPrinter(listenPort)) {
          console.log(`   ✓ "${RPM_PRINTER_NAME}" instalada.`);
          printers = await listPrinters().catch(() => printers);
        } else {
          console.log("   ✗ Não foi instalada (permissão negada, ou o Windows recusou). Dá para instalar à mão: veja o LEIA-ME.");
        }
      }
    }

    // 2. Where it keeps coming out on paper.
    const paper = paperPrinters(printers, listenPort);
    console.log("\n2. Em qual impressora o cupom deve continuar saindo no papel?");
    console.log("   O sistema de pedidos passa a imprimir na impressora RPM; este programa lê o pedido e manda o mesmo cupom para ela.");
    paper.forEach((printer, index) => console.log(`   ${String(index + 1).padStart(2)}. ${printer.name}${printer.host ? ` (rede ${printer.host})` : ""}`));
    console.log("    0. Nenhuma: os cupons só vão para o painel");
    if (current.forward) console.log(`   Hoje: ${current.forward} (Enter mantém)`);
    let forward: string | undefined;
    for (;;) {
      const answer = await ask.question("   Digite o número, ou o IP de uma impressora de rede (ex.: 192.168.0.50): ");
      const chosen = choosePaper(answer, paper, current.forward);
      if (chosen) { forward = chosen.forward; break; }
      console.log("   Não entendi. Use um número da lista ou um IP.");
    }
    console.log(forward ? `   ✓ O cupom continua saindo em: ${forward}` : "   · Sem papel: os cupons só vão para o painel.");

    // 3. The order system's name.
    const systemAnswer = await ask.question(`\n3. Nome do sistema de pedidos que imprime (opcional, ex.: Gestor iFood)${current.system ? ` [${current.system}]` : ""}: `);
    const system = systemAnswer.trim().slice(0, 40) || current.system;

    // 4. Open with Windows.
    const startup = startupFile();
    if (startup && launcher) {
      if (yes(await ask.question("\n4. Abrir este programa sozinho quando o Windows ligar? (S/n) "), true)) {
        await writeFile(startup, `@echo off\r\nstart "RPM Impressora" /min "${launcher}"\r\n`, "utf8");
        console.log("   ✓ Vai abrir minimizado sempre que o Windows ligar.");
      } else {
        await unlink(startup).catch(() => undefined);
        console.log("   · Não abre sozinho: use o atalho \"RPM Impressora\" quando precisar.");
      }
    }

    const config: AppConfig = { ...(forward ? { forward } : {}), ...(system ? { system } : {}), setupDone: true };
    await saveConfig(folder, config);
    console.log(`\nConfiguração salva. Para mudar, abra "Configurar RPM Impressora".\n`);
    return config;
  } finally {
    ask.close();
  }
}
