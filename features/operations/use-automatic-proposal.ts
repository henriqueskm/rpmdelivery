import { useEffect, useRef, useState } from "react";
import { PLANNING_TIMEOUT_MS, type Plan, type PlannedGroup, type PlanningInput } from "../route-planning/types";

export function useAutomaticProposal(currentKey:string) {
  const [job,setJob]=useState<{key:string;status:"pending"|"done"|"error";result?:Plan;error?:string}>();
  const worker=useRef<Worker>(null), timer=useRef<ReturnType<typeof setTimeout>>(undefined);
  function stop() {worker.current?.terminate();worker.current=null;clearTimeout(timer.current);}
  useEffect(()=>()=>{worker.current?.terminate();clearTimeout(timer.current);},[]);
  useEffect(()=>{worker.current?.terminate();worker.current=null;clearTimeout(timer.current);},[currentKey]);
  function calculate(key:string,makeInput:()=>PlanningInput,groups?:PlannedGroup[]) {
    stop();setJob(current=>({key,status:"pending",result:groups?current?.result:undefined}));
    try {
      const input=makeInput();
      const active=new Worker(new URL("./planning-worker.ts",import.meta.url));
      worker.current=active;
      const failed=(error:string)=>setJob(current=>groups&&current?.key===key&&current.result?
        {key,status:"done",result:current.result,error:"adjustment"}:{key,status:"error",error});
      const fail=(error:string)=>{
        if(worker.current!==active)return;
        stop();failed(error);
      };
      active.onmessage=(event:MessageEvent<{result?:Plan;error?:string}>)=>{
        if(worker.current!==active)return;
        stop();if(event.data.result)setJob({key,status:"done",result:event.data.result});
        else failed(event.data.error??"unavailable");
      };
      active.onerror=()=>fail("unavailable");
      timer.current=setTimeout(()=>fail("budget"),PLANNING_TIMEOUT_MS);
      active.postMessage({input,groups});
    } catch {stop();setJob({key,status:"error",error:"unavailable"});}
  }
  function cancel() {stop();setJob(undefined);}
  return {job,calculate,cancel};
}
