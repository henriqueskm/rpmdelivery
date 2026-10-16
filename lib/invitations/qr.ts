import qrcode from "qrcode-generator";
export function inviteQr(value: string) {
  const qr = qrcode(0, "M");
  qr.addData(value, "Byte");
  qr.make();
  return qr;
}
