import { useEffect, useRef, useState } from "react";
import type { DemoState } from "./model";
import { createAlertSound } from "./alert-sound";
import { pendingIssues } from "./issue-presentation";

export function useIssueAlerts(state: DemoState, onViewed: (ids: string[]) => void) {
  const [initialIds] = useState(() => new Set(state.issues.map(i => i.id)));
  const known = useRef(new Set(initialIds));
  const [sound] = useState(createAlertSound);
  const [enabled,setEnabled] = useState(false), [activating,setActivating] = useState(false), [message,setMessage] = useState("");
  useEffect(() => () => sound.dispose(),[sound]);
  useEffect(() => {
    const created = state.issues.filter(i => !known.current.has(i.id));
    for (const issue of created) known.current.add(issue.id);
    const ids = created.filter(i => i.status === "PENDING").map(i => i.id);
    if (!ids.length) return;
    onViewed(ids);
    sound.notify(() => {setEnabled(false);setMessage("Som indisponível neste navegador. Os alertas visuais continuam ativos.");});
  },[state.issues,onViewed,sound]);
  async function toggleSound() {
    setMessage("");
    if (enabled) {sound.disable();setEnabled(false);return;}
    setActivating(true);
    const active = await sound.enable();
    setEnabled(active);setActivating(false);
    if (!active) setMessage("Não foi possível ativar o som. Os alertas visuais continuam ativos.");
  }
  const alerts = pendingIssues(state).filter(i => !initialIds.has(i.id) && state.alertReceipts[i.id]?.dismissedAt === undefined);
  return {alerts,enabled,activating,message,toggleSound};
}
