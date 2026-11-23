// Monta a pasta RpmImpressora para levar a um computador da loja, sem Node nem o projeto:
//
//   npm run print:build   →   tools/print-capture/dist/RpmImpressora.zip
//
// RpmImpressora/
//   RPM Impressora.cmd             abre o programa (na primeira vez, configura)
//   Configurar RPM Impressora.cmd  refaz a configuração
//   LEIA-ME.txt
//   app/node.exe                   o Node oficial deste computador (assinado pela OpenJS Foundation)
//   app/rpm-impressora.cjs         o programa e o leitor de cupom num arquivo só
//
// O "empacotador" abaixo é mínimo de propósito (sem dependência nova): segue os imports relativos a partir
// de capture.mts, transpila cada arquivo com o TypeScript do projeto e junta tudo num CommonJS.

import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..", "..");
const entry = "tools/print-capture/capture.mts";
const out = join(root, "tools", "print-capture", "dist");
const folder = join(out, "RpmImpressora");

/** Relative imports and exports with values (type-only ones vanish when transpiled). */
function dependencies(source: string): string[] {
  const found = new Set<string>();
  for (const match of source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+"(\.{1,2}\/[^"]+)"/gm)) found.add(match[1]);
  return [...found];
}

async function bundle(): Promise<string> {
  const modules = new Map<string, string>();
  const pending = [entry];
  while (pending.length) {
    const id = pending.pop()!;
    if (modules.has(id)) continue;
    const source = await readFile(join(root, id), "utf8");
    // As a .ts name: a .mts name would make TypeScript keep the ESM syntax.
    const { outputText, diagnostics } = ts.transpileModule(source, {
      fileName: id.replace(/\.mts$/, ".ts"), reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: false, sourceMap: false },
    });
    if (diagnostics?.length) throw new Error(`${id}: ${ts.flattenDiagnosticMessageText(diagnostics[0].messageText, "\n")}`);
    modules.set(id, outputText);
    for (const request of dependencies(source)) pending.push(posix.normalize(posix.join(posix.dirname(id), request)));
  }
  const body = [...modules].map(([id, code]) =>
    `${JSON.stringify(id)}: function (module, exports, require) {\n${code}\n}`).join(",\n");
  return `"use strict";
// RPM Impressora: gerado por tools/print-capture/build.mts. Não edite: edite os arquivos de origem.
const __modules = {
${body}
};
const __cache = {};
function __load(id) {
  if (__cache[id]) return __cache[id].exports;
  if (!__modules[id]) throw new Error("módulo ausente no pacote: " + id);
  const module = { exports: {} };
  __cache[id] = module;
  __modules[id](module, module.exports, request => __require(id, request));
  return module.exports;
}
function __require(from, request) {
  if (!request.startsWith(".")) return require(request);
  const parts = from.split("/");
  parts.pop();
  for (const part of request.split("/")) {
    if (part === "..") parts.pop();
    else if (part !== ".") parts.push(part);
  }
  return __load(parts.join("/"));
}
__load(${JSON.stringify(entry)});
`;
}

const crlf = (text: string) => text.replace(/\r?\n/g, "\r\n");

const launcher = (extra: string, self: string) => crlf(`@echo off
chcp 65001 >nul
title RPM Impressora
set "RPM_LAUNCHER=${self}"
"%~dp0app\\node.exe" "%~dp0app\\rpm-impressora.cjs" --app ${extra}%*
echo.
pause
`);

const readme = crlf(`RPM Impressora
==============

Lê os pedidos que o sistema de pedidos da loja imprime e os entrega ao painel do RpmDelivery aberto
neste computador. O mesmo cupom continua saindo no papel, na impressora térmica de verdade.

Como funciona
-------------
O sistema de pedidos passa a imprimir na impressora "RPM Impressora". Este programa recebe o cupom,
manda o mesmo cupom para a impressora térmica (o papel sai como antes) e oferece o pedido ao painel.

Primeira vez
------------
1. Deixe esta pasta num lugar fixo (por exemplo, Documentos\\RpmImpressora). Se mudar a pasta de lugar,
   abra "Configurar RPM Impressora" de novo.
2. Abra "RPM Impressora". Se o Windows mostrar "O Windows protegeu o computador", clique em
   "Mais informações" e depois em "Executar assim mesmo".
3. A janela pergunta:
   - se pode instalar a impressora "RPM Impressora" (o Windows pede permissão de administrador);
   - em qual impressora o cupom deve continuar saindo no papel (a térmica da loja);
   - o nome do sistema de pedidos (opcional);
   - se o programa deve abrir sozinho quando o Windows ligar.
4. No sistema de pedidos, troque a impressora dos pedidos para "RPM Impressora".
5. No painel (rpmdelivery.vercel.app), abra o menu da loja e ligue "Pedidos da impressora neste
   computador". Se o Chrome pedir para acessar a rede local, clique em Permitir.

Todo dia
--------
Deixe a janela "RPM Impressora" aberta (pode minimizar). Fechada, os cupons não chegam nem ao papel
nem ao painel. Se a impressora térmica falhar, a janela avisa: "O CUPOM NÃO SAIU NO PAPEL".

Instalar a impressora à mão (se a instalação automática não funcionar)
---------------------------------------------------------------------
Configurações > Impressoras e scanners > Adicionar impressora > "A impressora que eu quero não está na
lista" > configurações manuais > Criar nova porta "Standard TCP/IP Port" > endereço 127.0.0.1, sem
consultar a impressora > Personalizado: Bruto (Raw), porta 9100 > driver Generic / Text Only > nome
"RPM Impressora".

Arquivos
--------
As impressões ficam em %APPDATA%\\RpmImpressora\\impressoes. Elas têm nome, telefone e endereço de
clientes: não envie para ninguém sem apagar esses dados. A configuração fica em
%APPDATA%\\RpmImpressora\\config.json.

O programa usa o Node.js (nodejs.org, licença MIT), que vai junto na pasta app.
`);

async function main() {
  await rm(folder, { recursive: true, force: true });
  await mkdir(join(folder, "app"), { recursive: true });
  await writeFile(join(folder, "app", "rpm-impressora.cjs"), await bundle(), "utf8");
  await copyFile(process.execPath, join(folder, "app", "node.exe"));
  await writeFile(join(folder, "RPM Impressora.cmd"), launcher("", "%~f0"), "utf8");
  await writeFile(join(folder, "Configurar RPM Impressora.cmd"), launcher("--configurar ", "%~dp0RPM Impressora.cmd"), "utf8");
  await writeFile(join(folder, "LEIA-ME.txt"), readme, "utf8");
  const zip = join(out, "RpmImpressora.zip");
  await rm(zip, { force: true });
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      "Compress-Archive -Path $env:RPM_FOLDER -DestinationPath $env:RPM_ZIP -Force"],
      { env: { ...process.env, RPM_FOLDER: folder, RPM_ZIP: zip }, stdio: "inherit" });
    if (result.status !== 0) throw new Error("não consegui criar o .zip");
    console.log(`Pronto: ${relative(root, zip)} (leve este arquivo ao computador da loja e descompacte).`);
  } else {
    console.log(`Pronto: ${relative(root, folder)} (compacte a pasta para levar).`);
  }
  console.log(`Node ${process.version} incluído. A pasta está em ${relative(root, dirname(zip))}.`);
}

void main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
