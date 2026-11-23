// Repasse do cupom para a impressora de verdade, para continuar saindo no papel.
//
// A impressora pode ser de rede (IP, porta RAW 9100) ou uma impressora instalada no Windows, como as
// térmicas USB (repasse em modo RAW pelo spooler: os bytes vão como chegaram, comandos ESC/POS e corte
// de papel incluídos). Cada impressão é repassada antes de ser lida, uma de cada vez, na ordem em que
// chegou, e tenta de novo duas vezes antes de avisar que o cupom não saiu no papel.

import { connect } from "node:net";

export type ForwardTarget =
  | { kind: "network"; host: string; port: number }
  | { kind: "windows"; name: string };

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

/**
 * "192.168.0.50", "192.168.0.50:9100" or "impressora.local:9100" → network printer;
 * anything else ("EPSON TM-T20", "Cozinha") → a printer installed in Windows, by its name.
 */
export function parseTarget(text: string | undefined): ForwardTarget | null {
  const value = text?.trim();
  if (!value) return null;
  const network = value.match(/^((?:\d{1,3}\.){3}\d{1,3}|localhost|[a-z0-9-]+(?:\.[a-z0-9-]+)+)(?::(\d{1,5}))?$/i);
  if (network) {
    const port = Number(network[2] ?? 9100);
    if (port >= 1 && port <= 65535) return { kind: "network", host: network[1].toLowerCase(), port };
  }
  return { kind: "windows", name: value.slice(0, 200) };
}

/** "192.168.0.50:9100" or "EPSON TM-T20". */
export function targetText(target: ForwardTarget): string {
  return target.kind === "network" ? `${target.host}:${target.port}` : target.name;
}

/** Same address as this program: forwarding there would print in a circle forever. */
export function pointsToSelf(host: string | null | undefined, port: number | null | undefined, listenPort: number): boolean {
  return !!host && LOOPBACK.has(host.trim().toLowerCase()) && port === listenPort;
}

/** A network error in the store's words. */
export function networkError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case "ECONNREFUSED": return "a impressora recusou a conexão (desligada, ou IP/porta errados)";
    case "EHOSTUNREACH": case "ENETUNREACH": case "ETIMEDOUT": return "a impressora não foi encontrada na rede (desligada, ou IP errado)";
    case "ENOTFOUND": case "EAI_AGAIN": return "não achei esse nome na rede";
    case "ECONNRESET": case "EPIPE": return "a impressora cortou a conexão no meio do cupom";
    default: return error.message;
  }
}

/** Sends the bytes to a network printer (RAW, usually port 9100). */
export function sendNetwork(target: { host: string; port: number }, bytes: Uint8Array, timeoutMs = 10_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let failed: Error | null = null;
    const socket = connect({ host: target.host, port: target.port }, () => socket.end(bytes));
    socket.setTimeout(timeoutMs, () => { failed = new Error("a impressora não respondeu a tempo"); socket.destroy(); });
    socket.on("error", (error: NodeJS.ErrnoException) => { failed = new Error(networkError(error)); });
    socket.on("close", () => (failed ? reject(failed) : resolve()));
  });
}

export type Delivery = { ok: true; attempts: number } | { ok: false; attempts: number; error: string };

/** Tries once, then again after each wait (2 s and 5 s by default). */
export async function deliver(send: () => Promise<void>, waits: number[] = [2000, 5000],
  sleep: (ms: number) => Promise<void> = ms => new Promise(done => setTimeout(done, ms))): Promise<Delivery> {
  let error = "";
  for (let attempt = 1; attempt <= waits.length + 1; attempt++) {
    try {
      await send();
      return { ok: true, attempts: attempt };
    } catch (problem) {
      error = problem instanceof Error ? problem.message : String(problem);
      if (attempt <= waits.length) await sleep(waits[attempt - 1]);
    }
  }
  return { ok: false, attempts: waits.length + 1, error };
}

/** One print at a time, in the order they arrived: two orders never come out swapped. */
export function inOrder(send: (bytes: Uint8Array) => Promise<Delivery>): (bytes: Uint8Array) => Promise<Delivery> {
  let last: Promise<unknown> = Promise.resolve();
  return bytes => {
    const next = last.then(() => send(bytes));
    last = next.catch(() => undefined);
    return next;
  };
}
