// O que o programa pede ao Windows, pelo PowerShell que já vem no sistema (nada a instalar):
// listar as impressoras, imprimir em modo RAW numa delas e instalar a impressora RPM.
//
// Os valores (nome da impressora, arquivo) vão por variável de ambiente, nunca colados no script.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pointsToSelf } from "./forward.mts";

export type WindowsPrinter = { name: string; portName: string; host: string | null; port: number | null };

/** The printer the program installs, and its port (Standard TCP/IP, RAW, to this computer). */
export const RPM_PRINTER_NAME = "RPM Impressora";
export const RPM_PORT_NAME = "RPM 9100";
const TEXT_DRIVER = "Generic / Text Only";

/** Runs a PowerShell script; UTF-8 out, so printer names keep their accents. */
export function runPowerShell(script: string, env: Record<string, string> = {}, timeoutMs = 60_000):
  Promise<{ code: number | null; stdout: string; stderr: string }> {
  const full = `[Console]::OutputEncoding = [Text.Encoding]::UTF8\n$ErrorActionPreference = 'Stop'\n${script}`;
  const encoded = Buffer.from(full, "utf16le").toString("base64");
  return new Promise((resolve, reject) => {
    const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { env: { ...process.env, ...env }, windowsHide: true });
    let stdout = "", stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", chunk => { stderr += chunk.toString("utf8"); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

/**
 * PowerShell's error text, without the script lines it quotes. Run this way (redirected, encoded
 * command) PowerShell 5.1 writes its errors as CLIXML: the text is in <S S="Error"> with _xHHHH_ escapes.
 */
export function shortError(stderr: string): string {
  let text = stderr;
  if (text.trimStart().startsWith("#< CLIXML")) {
    text = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map(match => match[1]).join("")
      .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&apos;/g, "'").replace(/&amp;/g, "&");
  }
  const line = text.split(/\r?\n/).map(part => part.trim())
    .find(part => part && !part.startsWith("+") && !/^(At line|No linha|Na linha|em linha)/i.test(part));
  if (!line) return "erro do Windows";
  // 'Exception calling "Send" with "2" argument(s): "The printer name is invalid"' → the last quoted part.
  const quoted = line.match(/:\s*"(.+)"\s*$/);
  return (quoted ? quoted[1] : line).slice(0, 300);
}

/** The printers installed in Windows, with where their port points when it is a TCP/IP port. */
export async function listPrinters(): Promise<WindowsPrinter[]> {
  const { code, stdout, stderr } = await runPowerShell(`
$list = @(Get-Printer | ForEach-Object {
  $port = Get-PrinterPort -Name $_.PortName -ErrorAction SilentlyContinue
  [pscustomobject]@{ name = $_.Name; portName = $_.PortName; host = $port.PrinterHostAddress; port = $port.PortNumber }
})
ConvertTo-Json -InputObject $list -Compress`);
  if (code !== 0) throw new Error(shortError(stderr));
  return parsePrinters(stdout);
}

/** PowerShell's JSON as printers; anything odd is left out. */
export function parsePrinters(json: string): WindowsPrinter[] {
  let value: unknown;
  try { value = JSON.parse(json.trim() || "[]"); } catch { return []; }
  const list = Array.isArray(value) ? value : [value];
  return list.flatMap(item => {
    const row = item as Record<string, unknown> | null;
    if (!row || typeof row.name !== "string" || !row.name.trim()) return [];
    return [{
      name: row.name, portName: typeof row.portName === "string" ? row.portName : "",
      host: typeof row.host === "string" && row.host ? row.host : null,
      port: typeof row.port === "number" ? row.port : null,
    }];
  });
}

/** Ports that are not a printer on paper: PDF, XPS, fax, OneNote, a file. */
const NOT_PAPER = /^(PORTPROMPT:|SHRFAX:|FILE:|nul:?|XPSPort:|Microsoft\.Office)/i;

/** Printers that put paper out: neither this program's own printer nor PDF, XPS, fax or OneNote. */
export function paperPrinters(printers: WindowsPrinter[], listenPort: number): WindowsPrinter[] {
  return printers.filter(printer => !NOT_PAPER.test(printer.portName) && !pointsToSelf(printer.host, printer.port, listenPort));
}

/** The installed printer(s) that send to this program. */
export function ownPrinters(printers: WindowsPrinter[], listenPort: number): WindowsPrinter[] {
  return printers.filter(printer => pointsToSelf(printer.host, printer.port, listenPort));
}

/** Finds a printer by name, ignoring case and spaces at the ends. */
export function findPrinter(printers: WindowsPrinter[], name: string): WindowsPrinter | undefined {
  const wanted = name.trim().toLowerCase();
  return printers.find(printer => printer.name.trim().toLowerCase() === wanted);
}

const RAW_PRINT = `
Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
public static class RpmRawPrint {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DocInfo { public string pDocName; public string pOutputFile; public string pDataType; }
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool ClosePrinter(IntPtr handle);
  [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
  static extern int StartDocPrinter(IntPtr handle, int level, [In, MarshalAs(UnmanagedType.LPStruct)] DocInfo info);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndDocPrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool StartPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)] static extern bool EndPagePrinter(IntPtr handle);
  [DllImport("winspool.drv", SetLastError = true)]
  static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);
  public static void Send(string printer, byte[] bytes) {
    IntPtr handle;
    if (!OpenPrinter(printer, out handle, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try {
      DocInfo info = new DocInfo { pDocName = "Cupom (RPM Impressora)", pDataType = "RAW" };
      if (StartDocPrinter(handle, 1, info) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
      try {
        StartPagePrinter(handle);
        int written;
        if (!WritePrinter(handle, bytes, bytes.Length, out written)) throw new Win32Exception(Marshal.GetLastWin32Error());
        if (written != bytes.Length) throw new Exception("a impressora aceitou só parte do cupom");
        EndPagePrinter(handle);
      } finally { EndDocPrinter(handle); }
    } finally { ClosePrinter(handle); }
  }
}
"@
[RpmRawPrint]::Send($env:RPM_PRINTER, [IO.File]::ReadAllBytes($env:RPM_FILE))`;

/**
 * Prints the bytes as they are (RAW) on a printer installed in Windows. The bytes go through a file in
 * the temp folder, deleted right after: it has the customer's data.
 */
export async function rawPrint(name: string, bytes: Uint8Array): Promise<void> {
  const file = join(tmpdir(), `rpm-cupom-${randomUUID()}.bin`);
  await writeFile(file, bytes);
  try {
    const { code, stderr } = await runPowerShell(RAW_PRINT, { RPM_PRINTER: name, RPM_FILE: file }, 30_000);
    if (code !== 0) throw new Error(shortError(stderr));
  } finally {
    await unlink(file).catch(() => undefined);
  }
}

/**
 * Installs "RPM Impressora" (driver Generic / Text Only, port RPM 9100 → 127.0.0.1:[port]). Needs an
 * administrator: Windows asks the person at the computer (UAC) and the installation runs in that window.
 * Returns whether the printer is there afterwards.
 */
export async function installPrinter(port: number): Promise<boolean> {
  const install = `
$ErrorActionPreference = 'Stop'
if (-not (Get-PrinterDriver -Name '${TEXT_DRIVER}' -ErrorAction SilentlyContinue)) { Add-PrinterDriver -Name '${TEXT_DRIVER}' }
if (-not (Get-PrinterPort -Name '${RPM_PORT_NAME}' -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name '${RPM_PORT_NAME}' -PrinterHostAddress '127.0.0.1' -PortNumber ${Math.trunc(port)}
}
if (-not (Get-Printer -Name '${RPM_PRINTER_NAME}' -ErrorAction SilentlyContinue)) {
  Add-Printer -Name '${RPM_PRINTER_NAME}' -DriverName '${TEXT_DRIVER}' -PortName '${RPM_PORT_NAME}'
}`;
  const encoded = Buffer.from(install, "utf16le").toString("base64");
  await runPowerShell(`Start-Process -FilePath powershell.exe -Verb RunAs -Wait -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', '${encoded}')`,
    {}, 5 * 60_000).catch(() => undefined);
  const printers = await listPrinters().catch(() => []);
  return ownPrinters(printers, port).length > 0;
}
