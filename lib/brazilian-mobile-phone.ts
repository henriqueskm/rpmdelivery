function nationalDigits(value: string) {
  const digits = value.replace(/\D/g, "");
  return value.trim().startsWith("+55") ? digits.slice(2) : digits;
}

export function isValidBrazilianMobilePhone(value: string) {
  if (value.trim() && (!/^\+?[0-9() .-]+$/.test(value.trim())
    || (value.trim().startsWith("+") && !value.trim().startsWith("+55")))) return false;
  return !value.trim() || /^[1-9]\d9\d{8}$/.test(nationalDigits(value));
}

export function parseBrazilianMobilePhone(value: string): string | null {
  if (!value.trim()) return null;
  if (!isValidBrazilianMobilePhone(value))
    throw new Error("Informe um celular com DDD e 9 dígitos.");
  return `+55${nationalDigits(value)}`;
}

export function formatBrazilianMobilePhone(value: string) {
  const digits = nationalDigits(value).slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;
  const subscriber = digits.slice(2);
  return `(${digits.slice(0, 2)}) ${subscriber.slice(0, 5)}${subscriber.length > 5 ? `-${subscriber.slice(5)}` : ""}`;
}
