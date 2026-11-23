// Reads what a store's system sends to a receipt printer and says whether it is readable text.
// Thermal printers speak ESC/POS: printable bytes mixed with control commands (bold, cut, cash
// drawer, pictures). This strips the commands, decodes the text in the code page the printer was
// told to use (or the one that makes the most sense for Portuguese), and counts the pictures: many
// delivery apps print the whole receipt as one picture, and then there is no text to read.
// Pure and dependency free, used by the print capture tool (tools/print-capture).

import { parsePastedOrder, type PastedOrder } from "../../features/operations/paste-order.ts";

export type ReceiptFormat = "escpos" | "text" | "pdf" | "postscript" | "pcl" | "empty";
export type ReceiptEncoding = "utf-8" | "cp850" | "cp860" | "cp437" | "cp1252";

export type DecodedReceipt = {
  format: ReceiptFormat;
  /** What the printer would print as letters, one receipt line per line. */
  text: string;
  encoding: ReceiptEncoding;
  /** Pictures in the job (logos, QR codes printed as pictures, or the whole receipt). */
  images: number;
  /** Bytes of picture data: a receipt printed as a picture has thousands. */
  imageBytes: number;
  /** Letters and digits in the text: a receipt printed as a picture has almost none. */
  letters: number;
  /** The paper is cut at the end (the job looks complete). */
  cut: boolean;
};

const ESC = 0x1b, GS = 0x1d, FS = 0x1c, DLE = 0x10;

// Upper halves (0x80–0xFF) of the DOS code pages thermal printers use. Index = byte − 0x80.
const BOX_437 = "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const PAGES: Record<"cp850" | "cp860" | "cp437", string> = {
  cp850: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ",
  cp860: "ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»" + BOX_437,
  cp437: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»" + BOX_437,
};
// ESC t n: the code page the store's system selected.
const ESC_T: Record<number, ReceiptEncoding> = { 0: "cp437", 2: "cp850", 3: "cp860", 16: "cp1252" };

const PORTUGUESE = /[áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g;
const ODD = /[░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├┼╞╟╚╔╩╦╠╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αΓπΣστΦΘΩδ∞φε∩≡≥≤⌠⌡≈∙√ⁿ¤ðÐıþÞýÝ¯‗¶¸¨¹³ƒ₧⌐åÅæÆøØÿ¦�]/g;

function decodeWith(bytes: Uint8Array, encoding: ReceiptEncoding): string {
  if (encoding === "utf-8") return new TextDecoder("utf-8").decode(bytes);
  if (encoding === "cp1252") return new TextDecoder("windows-1252").decode(bytes);
  const page = PAGES[encoding];
  let out = "";
  for (const byte of bytes) out += byte < 0x80 ? String.fromCharCode(byte) : page[byte - 0x80];
  return out;
}

function validUtf8(bytes: Uint8Array): boolean {
  try { new TextDecoder("utf-8", { fatal: true }).decode(bytes); return true; } catch { return false; }
}

/** The code page whose letters read as Portuguese: accented letters count, box drawing in the middle of words does not. */
function guessEncoding(bytes: Uint8Array): ReceiptEncoding {
  if (!bytes.some(byte => byte >= 0x80)) return "cp850";
  if (validUtf8(bytes)) return "utf-8";
  let best: ReceiptEncoding = "cp850", bestScore = -Infinity;
  for (const encoding of ["cp850", "cp860", "cp1252", "cp437"] as const) {
    const text = decodeWith(bytes, encoding);
    const score = (text.match(PORTUGUESE)?.length ?? 0) * 2 - (text.match(ODD)?.length ?? 0) * 3;
    if (score > bestScore) { best = encoding; bestScore = score; }
  }
  return best;
}

const word = (bytes: Uint8Array, at: number) => (bytes[at] ?? 0) + (bytes[at + 1] ?? 0) * 256;

function startsWith(bytes: Uint8Array, text: string, at = 0): boolean {
  for (let i = 0; i < text.length; i += 1) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

function documentFormat(bytes: Uint8Array): ReceiptFormat | null {
  let at = 0;
  while (at < bytes.length && (bytes[at] === 0x04 || bytes[at] === 0x0d || bytes[at] === 0x0a)) at += 1;
  if (startsWith(bytes, "%PDF", at)) return "pdf";
  if (startsWith(bytes, "%!PS", at)) return "postscript";
  if (startsWith(bytes, "\x1b%-12345X", at) || startsWith(bytes, "@PJL", at) || startsWith(bytes, "\x1bE\x1b&", at)) return "pcl";
  return null;
}

/** Strips ESC/POS commands from a print job and decodes what is left as text. */
export function decodeReceipt(input: Uint8Array): DecodedReceipt {
  const bytes = input;
  const document = documentFormat(bytes);
  if (document) return { format: document, text: "", encoding: "cp850", images: 0, imageBytes: 0, letters: 0, cut: false };

  // Printable bytes per line, kept raw until the code page is known.
  const printable: number[] = [];
  let commands = 0, images = 0, imageBytes = 0, cut = false;
  let selected: ReceiptEncoding | null = null;
  const image = (length: number) => { images += 1; imageBytes += Math.max(0, length); };

  let i = 0;
  while (i < bytes.length) {
    const byte = bytes[i];
    if (byte === ESC) {
      commands += 1;
      const command = bytes[i + 1];
      switch (command) {
        case 0x40: case 0x32: case 0x3c: case 0x69: case 0x6d: i += 2; break; // init, line spacing, home, cut
        case 0x64: case 0x4a: case 0x65: // feed n lines / dots / reverse
          if (command === 0x64) for (let n = Math.min(bytes[i + 2] ?? 0, 10); n > 0; n -= 1) printable.push(0x0a);
          i += 3; break;
        case 0x74: { const page = ESC_T[bytes[i + 2]]; if (page) selected = page; i += 3; break; }
        case 0x2a: { // ESC * m nL nH: bit image, column format
          const mode = bytes[i + 2], columns = word(bytes, i + 3);
          const length = columns * (mode === 32 || mode === 33 ? 3 : 1);
          image(length); i += 5 + length; break;
        }
        case 0x70: i += 5; break; // cash drawer pulse
        case 0x24: case 0x5c: i += 4; break; // absolute / relative position
        case 0x63: i += 4; break; // ESC c 3/4/5 n: panel and sensors
        case 0x26: { // ESC & y c1 c2 [x d1…d(y×x)]…: user defined characters
          const height = bytes[i + 2] ?? 0, first = bytes[i + 3] ?? 0, last = bytes[i + 4] ?? 0;
          let at = i + 5;
          for (let c = first; c <= last && at < bytes.length; c += 1) at += 1 + height * (bytes[at] ?? 0);
          i = at; break;
        }
        case 0x28: i += 5 + word(bytes, i + 3); break; // ESC ( X pL pH …
        default: i += 3; // ESC ! n, ESC E n, ESC - n, ESC a n, ESC M n, ESC G n, ESC R n, ESC SP n…
      }
    } else if (byte === GS) {
      commands += 1;
      const command = bytes[i + 1];
      switch (command) {
        case 0x56: { // GS V: cut
          cut = true;
          const mode = bytes[i + 2];
          i += mode === 65 || mode === 66 || mode === 97 || mode === 98 || mode === 103 || mode === 104 ? 4 : 3; break;
        }
        case 0x76: { // GS v 0 m xL xH yL yH: raster image
          const length = word(bytes, i + 4) * word(bytes, i + 6);
          image(length); i += 8 + length; break;
        }
        case 0x28: { // GS ( X pL pH …: graphics (L), QR/2D codes (k) and other functions
          const kind = bytes[i + 2], length = word(bytes, i + 3);
          if (kind === 0x4c && length > 16) image(length);
          i += 5 + length; break;
        }
        case 0x38: { // GS 8 L p1 p2 p3 p4 …: large graphics
          const length = (bytes[i + 3] ?? 0) + (bytes[i + 4] ?? 0) * 256 + (bytes[i + 5] ?? 0) * 65536 + (bytes[i + 6] ?? 0) * 16777216;
          image(length); i += 7 + length; break;
        }
        case 0x2a: { // GS * x y d…: downloaded bit image
          const length = (bytes[i + 2] ?? 0) * (bytes[i + 3] ?? 0) * 8;
          image(length); i += 4 + length; break;
        }
        case 0x6b: { // GS k m …: barcode
          const mode = bytes[i + 2];
          if (mode <= 6) { let at = i + 3; while (at < bytes.length && bytes[at] !== 0) at += 1; i = at + 1; }
          else i += 4 + (bytes[i + 3] ?? 0);
          break;
        }
        case 0x4c: case 0x57: case 0x24: case 0x5c: case 0x50: i += 4; break; // margins, width, positions
        case 0x2f: image(0); i += 3; break; // GS / m: print the downloaded image
        default: i += 3; // GS ! n, GS B n, GS h n, GS w n, GS H n, GS f n, GS a n, GS r n…
      }
    } else if (byte === FS) {
      commands += 1;
      const command = bytes[i + 1];
      if (command === 0x70) { image(0); i += 4; } // FS p n m: print stored logo
      else if (command === 0x26 || command === 0x2e) i += 2; // kanji on / off
      else if (command === 0x71) { // FS q n [xL xH yL yH d…]…: store logos
        let at = i + 3;
        for (let n = bytes[i + 2] ?? 0; n > 0 && at < bytes.length; n -= 1) at += 4 + word(bytes, at) * word(bytes, at + 2) * 8;
        i = at;
      } else i += 3;
    } else if (byte === DLE) {
      commands += 1;
      const command = bytes[i + 1];
      i += command === 0x14 ? 5 : 3; // DLE DC4 …: real time requests; DLE EOT/ENQ n: status
    } else if (byte === 0x0a || byte === 0x0c) { printable.push(0x0a); i += 1; }
    else if (byte === 0x09) { printable.push(0x20); i += 1; }
    else if (byte >= 0x20 && byte !== 0x7f) { printable.push(byte); i += 1; }
    else i += 1; // CR and other controls
  }

  const raw = Uint8Array.from(printable);
  const encoding = selected ?? guessEncoding(raw);
  const text = decodeWith(raw, encoding)
    .split("\n").map(line => line.replace(/\s+$/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  const letters = text.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  const format: ReceiptFormat = !text && !images ? "empty" : commands ? "escpos" : "text";
  return { format, text, encoding, images, imageBytes, letters, cut };
}

export type ReceiptVerdict = "text" | "image" | "document" | "empty";

export type ReceiptReading = DecodedReceipt & {
  verdict: ReceiptVerdict;
  order: PastedOrder;
  found: (keyof PastedOrder)[];
};

/** Decodes a print job and reads the order in it, as "Colar pedido" would. */
export function readReceipt(bytes: Uint8Array): ReceiptReading {
  const decoded = decodeReceipt(bytes);
  const verdict: ReceiptVerdict = decoded.format === "pdf" || decoded.format === "postscript" || decoded.format === "pcl"
    ? "document"
    : decoded.format === "empty" ? "empty"
      // A picture with little text around it: the receipt itself is the picture.
      : decoded.images > 0 && decoded.imageBytes >= 2000 && decoded.letters < 40 ? "image"
        : decoded.letters ? "text" : decoded.images ? "image" : "empty";
  const { order, found } = verdict === "text" ? parsePastedOrder(decoded.text) : { order: {}, found: [] };
  return { ...decoded, verdict, order, found };
}
