// "Motoboy livre": when the first courier in line is free and orders are waiting with a pin, the panel
// offers "Sugerir rotas". "Agora não" hides it for that courier until more orders are waiting.

export type FreeCourierNotice = { courierId: string; name: string; waiting: number };

/** [dismissed]: courier id → how many orders were waiting when the store said "agora não". */
export function freeCourierNotice(courier: { id: string; name: string } | undefined, waiting: number,
  dismissed: Record<string, number>): FreeCourierNotice | null {
  if (!courier || waiting < 1) return null;
  const before = dismissed[courier.id];
  if (before !== undefined && waiting <= before) return null;
  return { courierId: courier.id, name: courier.name, waiting };
}
