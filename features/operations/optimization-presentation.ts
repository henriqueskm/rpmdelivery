import type { Arrival, Comparison } from "../route-optimization/types.ts";
import { calendarTime, clockTime, localDateTime } from "./deadlines.ts";

export type Tone = "gain" | "danger" | "attention" | "stable";
const numeric = (value: number) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value);
export const minutes = (seconds: number) => `${Math.ceil(seconds / 60)} min`;
export const distance = (meters: number) => `${(meters / 1000).toFixed(1).replace(".", ",")} km`;
export const margin = (seconds: number) => seconds < 60 ? "<1 min" : `${Math.floor(seconds / 60)} min`;
export const estimateTime = (timestamp: number, departure: number) =>
  localDateTime(timestamp).slice(0,10) === localDateTime(departure).slice(0,10) ? clockTime(timestamp) : calendarTime(timestamp);
export function difference(value: number, unit: "seconds" | "meters") {
  if (!value) return "Sem alteração";
  const sign = value > 0 ? "+" : "−", amount = Math.abs(value);
  if (unit === "meters") return `${sign}${amount < 1 ? "<1 m" : amount < 1000 ? `${numeric(amount)} m` : distance(amount)}`;
  return `${sign}${amount < 1 ? "<1 s" : amount < 60 ? `${numeric(amount)} s` : `${numeric(amount / 60)} min`}`;
}
function changeTone(delta: number, before: number, significant: number): Tone {
  if (delta < 0) return "gain";
  if (delta === 0) return "stable";
  return delta >= significant || (before > 0 && delta / before >= 0.1) ? "danger" : "attention";
}
export function impactMetrics(result: Comparison) {
  const { manual, suggested } = result;
  const late = manual ? suggested.lateCount - manual.lateCount : null;
  const time = manual ? suggested.durationSeconds - manual.durationSeconds : null;
  const meters = manual ? suggested.distanceMeters - manual.distanceMeters : null;
  return [
    { key:"late", label:"Atrasos previstos", before:manual ? String(manual.lateCount) : "—", after:String(suggested.lateCount), unit:"entregas",
      tone:late === null || late === 0 ? "stable" : late < 0 ? "gain" : "danger", delta:late === null ? "Sem base de comparação" : late === 0 ? "Mesma quantidade" : `${Math.abs(late)} ${Math.abs(late) === 1 ? "atraso" : "atrasos"} ${late < 0 ? Math.abs(late) === 1 ? "evitado" : "evitados" : "a mais"}` },
    { key:"time", label:"Tempo total", before:manual ? String(Math.ceil(manual.durationSeconds / 60)) : "—", after:String(Math.ceil(suggested.durationSeconds / 60)), unit:"min",
      tone:time === null ? "stable" : changeTone(time,manual!.durationSeconds,300), delta:time === null ? "Ordem atual sem percurso" : difference(time,"seconds") },
    { key:"distance", label:"Distância", before:manual ? distance(manual.distanceMeters).replace(" km","") : "—", after:distance(suggested.distanceMeters).replace(" km",""), unit:"km",
      tone:meters === null ? "stable" : changeTone(meters,manual!.distanceMeters,1000), delta:meters === null ? "Ordem atual sem percurso" : difference(meters,"meters") },
  ] as const;
}
export function recommendation(result: Comparison) {
  const { manual, suggested } = result;
  if (!manual) return { title:"Use a sequência com percurso completo", reason:"A ordem atual não tem percurso completo nesta matriz. A sugerida inclui a volta à loja." };
  if (JSON.stringify(manual.ids) === JSON.stringify(suggested.ids))
    return { title:"Mantenha a ordem atual", reason:"Não há ganho em mudar a sequência sob estas hipóteses." };
  const avoided = manual.lateCount - suggested.lateCount;
  if (avoided > 0) return { title:"Antecipe as entregas mais urgentes", reason:`Evita ${avoided} ${avoided === 1 ? "atraso previsto" : "atrasos previstos"} com a nova sequência.` };
  if (suggested.lateSeconds < manual.lateSeconds)
    return { title:"Reduza o atraso total", reason:`A nova ordem reduz o atraso total previsto em ${difference(manual.lateSeconds-suggested.lateSeconds,"seconds").slice(1)}.` };
  return { title:"Encurte o deslocamento", reason:"A nova ordem mantém a quantidade de atrasos previstos e reduz o deslocamento, incluindo a volta à loja." };
}
export function stopRisk(stop: Arrival, now: number) {
  const spare = (stop.deadlineAt - stop.completedAt) / 1000;
  if (stop.deadlineAt <= now) return { tone:"danger" as const, text:`Prazo vencido · atraso previsto ${minutes(stop.lateSeconds)}` };
  if (stop.lateSeconds > 0) return { tone:"danger" as const, text:`Atraso previsto ${minutes(stop.lateSeconds)}` };
  if (spare < 300) return { tone:"attention" as const, text:`${spare < 60 ? "Prazo muito apertado" : "Prazo apertado"} · margem ${margin(spare)}` };
  return { tone:"stable" as const, text:`Margem ${margin(spare)}` };
}
export function riskSummary(result: Comparison) {
  const late = result.suggested.lateCount;
  const tight = result.suggested.stops.filter(s => s.lateSeconds === 0 && s.deadlineAt-s.completedAt < 300000);
  const critical = tight.filter(s => s.deadlineAt-s.completedAt < 60000);
  if (late) return { tone:"danger" as const, title:`${late} ${late === 1 ? "entrega permanece" : "entregas permanecem"} com atraso previsto`,
    text:`Nenhuma sequência cumpre todos os prazos sob estas hipóteses.${tight.length ? ` Mais ${tight.length} ${tight.length === 1 ? "prazo apertado" : "prazos apertados"}.` : ""}` };
  if (tight.length) return { tone:"attention" as const, title:critical.length ? "Atenção: prazo muito apertado" : "Atenção: prazo apertado",
    text:critical.length ? `${critical.length} ${critical.length === 1 ? "entrega tem" : "entregas têm"} margem inferior a 1 min.${tight.length>critical.length ? ` Outras ${tight.length-critical.length} com margem inferior a 5 min.` : ""} Uma saída mais tarde pode causar atraso.`
      : `${tight.length} ${tight.length === 1 ? "entrega tem" : "entregas têm"} margem inferior a 5 min. Uma saída mais tarde pode causar atraso.` };
  return null;
}
