"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FormField } from "@/components/form-field";
import { getSupabase } from "@/lib/supabase/client";

type RouteSettings = { maxStops: number; maxDetourMinutes: number; neighborMeters: number; canEdit: boolean };

const parse = (value: unknown): RouteSettings | null => {
  const v = value as Record<string, unknown> | null;
  return v && Number.isInteger(v.maxStops) && Number.isInteger(v.maxDetourMinutes) && Number.isInteger(v.neighborMeters)
    ? { maxStops: v.maxStops as number, maxDetourMinutes: v.maxDetourMinutes as number,
      neighborMeters: v.neighborMeters as number, canEdit: v.canEdit === true } : null;
};
/** "2", "1,5", "0.8" km → meters; null outside 0–10 km. */
export function kmToMeters(text: string): number | null {
  if (!/^\d{1,2}([.,]\d{1,2})?$/.test(text.trim())) return null;
  const meters = Math.round(Number(text.trim().replace(",", ".")) * 1000);
  return meters <= 10_000 ? meters : null;
}
const kmText = (meters: number) => (meters / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 2 });

/** "Montagem automática" limits on Dados da loja: what "Sugerir rotas" in the panel follows. */
export function RouteSettingsCard({ restaurantId }: { restaurantId: string }) {
  const [settings, setSettings] = useState<RouteSettings | null>(null);
  const [stops, setStops] = useState(""), [detour, setDetour] = useState(""), [neighbor, setNeighbor] = useState("");
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [pending, setPending] = useState(false);
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    void getSupabase().rpc("get_route_settings", { p_restaurant_id: restaurantId }).then(({ data, error }) => {
      if (!active) return;
      const loaded = error ? null : parse(data);
      if (!loaded) { setMessage({ text: "Não foi possível carregar os limites da montagem.", error: true }); return; }
      setSettings(loaded); setStops(String(loaded.maxStops)); setDetour(String(loaded.maxDetourMinutes)); setNeighbor(kmText(loaded.neighborMeters));
    });
    return () => { active = false; };
  }, [restaurantId]);

  const stopsValue = /^\d$/.test(stops) ? Number(stops) : NaN;
  const detourValue = /^\d{1,2}$/.test(detour) ? Number(detour) : NaN;
  const neighborValue = kmToMeters(neighbor);
  const valid = stopsValue >= 1 && stopsValue <= 8 && detourValue >= 0 && detourValue <= 60 && neighborValue !== null;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings?.canEdit || !valid || saving.current) return;
    saving.current = true; setPending(true); setMessage(null);
    const { data, error } = await getSupabase().rpc("set_route_settings", {
      p_restaurant_id: restaurantId, p_max_stops: stopsValue, p_max_detour_minutes: detourValue, p_neighbor_meters: neighborValue!,
    });
    saving.current = false; setPending(false);
    const saved = error ? null : parse(data);
    if (!saved) { setMessage({ text: "Não foi possível salvar os limites. Tente de novo.", error: true }); return; }
    setSettings(saved);
    setMessage({ text: "Limites salvos. Valem na próxima vez que a loja pedir sugestões.", error: false });
  }

  if (!settings) return message
    ? <p className="notice error invite-section" role="alert">{message.text}</p> : null;
  return <form className="invite-card store-form" onSubmit={save} aria-label="Montagem automática" aria-busy={pending}>
    <h2>Montagem automática</h2>
    <p>O que o botão “Sugerir rotas” do painel segue. Pedidos do mesmo endereço sempre vão juntos, e nenhum pedido entra se fizer outro atrasar.</p>
    {!settings.canEdit && <p className="notice" role="note">Somente o dono ou um gerente da loja altera estes limites.</p>}
    <fieldset disabled={pending || !settings.canEdit} onInput={() => setMessage(null)}>
      <FormField label="Entregas por rota" id="route-max-stops" name="maxStops" inputMode="numeric" maxLength={1}
        value={stops} onChange={event => setStops(event.target.value.replace(/\D/g, ""))} aria-invalid={!(stopsValue >= 1 && stopsValue <= 8)}
        hint="De 1 a 8." />
      <FormField label="Desvio máximo para ir no caminho (minutos)" id="route-max-detour" name="maxDetour" inputMode="numeric" maxLength={2}
        value={detour} onChange={event => setDetour(event.target.value.replace(/\D/g, ""))} aria-invalid={!(detourValue >= 0 && detourValue <= 60)}
        hint="Quanto o motoboy pode rodar a mais para levar um pedido junto. De 0 a 60." />
      <FormField label="Bairros vizinhos até (km)" id="route-neighbor" name="neighbor" inputMode="decimal" maxLength={5}
        value={neighbor} onChange={event => setNeighbor(event.target.value)} aria-invalid={neighborValue === null}
        hint="Distância entre as entregas para dois bairros contarem como vizinhos. De 0 a 10 km." />
      <button className="button primary" type="submit" disabled={!valid}>{pending ? "Salvando…" : "Salvar limites"}</button>
    </fieldset>
    {message && <p className={`notice ${message.error ? "error" : ""} invite-message`} role={message.error ? "alert" : "status"}>{message.text}</p>}
  </form>;
}
