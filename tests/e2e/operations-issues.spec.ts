import {test,expect,type Page} from "@playwright/test";
const epoch=Date.parse("2026-10-12T18:00:00Z");
const driver=(page:Page)=>page.getByRole("dialog",{name:"Aplicativo do motoboy"});
const center=(page:Page)=>page.getByRole("dialog",{name:"Central de ocorrências"});
const route=(page:Page,ref="R-41")=>page.getByRole("article",{name:`Rota ${ref}`,exact:true});
const diagnostics=new WeakMap<Page,string[]>();
test.beforeEach(async({page})=>{
  const errors:string[]=[];diagnostics.set(page,errors);
  page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text());});
  page.on("requestfailed",r=>errors.push(`${r.method()} ${new URL(r.url()).pathname}: ${r.failure()?.errorText}`));
  page.on("response",r=>{if(r.status()>=400)errors.push(`${new URL(r.url()).pathname}: ${r.status()}`);});
  page.on("request",r=>{if(new URL(r.url()).hostname!=="127.0.0.1")errors.push("requisição externa inesperada");});
  await page.clock.setFixedTime(new Date(epoch));
});
test.afterEach(async({page})=>{expect(diagnostics.get(page)).toEqual([]);});
async function open(page:Page,scenario="issues-new") {
  await page.goto(`/preview/operacao?scenario=${scenario}`);
  await expect(page.getByRole("heading",{name:"Central de operações",exact:true})).toBeVisible();
}
async function routes(page:Page) {
  const tab=page.getByRole("tab",{name:"Rotas",exact:true});if(await tab.isVisible())await tab.click();
}
async function courier(page:Page,ref="R-41") {
  await routes(page);await route(page,ref).getByRole("button",{name:"Visão do motoboy (demo)"}).click();
}
test("falha obrigatória, aviso dispensável, nova tentativa, entregas individuais e fila FIFO",async({page})=>{
  await open(page);await courier(page);const original=await driver(page).locator(".ops-driver-sequence").textContent();
  await driver(page).getByRole("button",{name:"Não consegui entregar"}).click();
  await driver(page).getByRole("button",{name:"Registrar falha"}).click();
  await expect(driver(page).getByLabel("Motivo da falha")).toBeFocused();
  await driver(page).getByLabel("Motivo da falha").selectOption("OTHER");
  await driver(page).getByRole("button",{name:"Registrar falha"}).click();
  await expect(driver(page).getByRole("textbox")).toBeFocused();
  await driver(page).getByRole("textbox").fill("Portão lateral fechado; confirmar referência com a loja.");
  await driver(page).getByRole("button",{name:"Registrar falha"}).click();
  await expect(driver(page).getByRole("heading",{name:/#1039/})).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading",{name:"Nova ocorrência de entrega"})).toBeVisible();
  await expect(page.locator(".ops-new-issue")).toBeInViewport();
  await page.getByRole("button",{name:"Fechar aviso sem resolver ocorrências"}).click();
  await expect(page.getByRole("heading",{name:"Nova ocorrência de entrega"})).toHaveCount(0);
  await page.getByRole("button",{name:"Ocorrências: 1 pendência",exact:true}).click();
  await expect(center(page)).toContainText("Outro motivo");await expect(center(page)).toContainText("Portão lateral fechado");
  await center(page).getByRole("button",{name:"Tentar novamente"}).press("Enter");
  await expect(center(page).getByRole("tabpanel")).toContainText("Nenhuma ocorrência pendente");
  await center(page).getByRole("tab",{name:"Histórico (1)"}).click();await expect(center(page)).toContainText("Nova tentativa liberada");
  await page.keyboard.press("Escape");await courier(page);
  await expect(driver(page).getByRole("heading",{name:/#1039/})).toBeVisible();
  await driver(page).getByRole("button",{name:"Entregue",exact:true}).click();
  await expect(driver(page).getByRole("heading",{name:/#1040/})).toBeFocused();
  await expect(driver(page)).toContainText("Nova tentativa liberada pela loja");
  await driver(page).getByRole("button",{name:"Entregue",exact:true}).click();
  await expect(driver(page)).toContainText("Retornando");
  expect(original).toMatch(/1040[\s\S]*1039/);
  await expect(driver(page).locator(".ops-courier-deliveries>li>strong")).toHaveText(["1. #1040 · Juliana Alves","2. #1039 · Felipe Barros"]);
  await driver(page).getByRole("button",{name:"Confirmar retorno — simulação"}).click();await page.keyboard.press("Escape");
  await expect(route(page)).toContainText("Concluída");
  const tab=page.getByRole("tab",{name:"Motoboys",exact:true});if(await tab.isVisible())await tab.click();
  await expect(page.locator(".ops-courier").filter({hasText:"Rafa Santos"})).toContainText("Disponível");
  const queue=await page.locator(".ops-courier").allTextContents();expect(queue.findIndex(t=>t.includes("Rafa Santos"))).toBeGreaterThan(queue.findIndex(t=>t.includes("Bianca Souza")));
});
test("retorno e cancelamento pela loja encerram ocorrência; pedido cancelado continua visível",async({page})=>{
  for(const cancel of [false,true]){
    await open(page,"issues-client");await page.getByRole("button",{name:"Ocorrências: 1 pendência",exact:true}).click();
    if(cancel){await center(page).getByText("Detalhes e histórico",{exact:true}).click();await center(page).getByRole("button",{name:"Cancelar entrega",exact:true}).click();await center(page).getByRole("button",{name:"Confirmar cancelamento"}).click();}
    else await center(page).getByRole("button",{name:"Retornar pedido à loja"}).click();
    await expect(center(page).getByRole("tabpanel")).toContainText("Nenhuma ocorrência pendente");await page.keyboard.press("Escape");await courier(page);
    await driver(page).getByRole("button",{name:"Entregue",exact:true}).click();
    await expect(driver(page)).toContainText("Retornando");await expect(driver(page)).toContainText(cancel?"Cancelada":"Retornar pedido à loja");
    await page.keyboard.press("Escape");await expect(route(page)).toContainText("#1039");
  }
});
test("timeout compartilhado e fim das demais entregas não prendem motoboy",async({page})=>{
  await page.clock.install({time:new Date(epoch-60_000)});await page.clock.pauseAt(new Date(epoch));
  await open(page,"issues-client");
  await page.clock.fastForward(8*60_000);
  await page.getByRole("button",{name:"Ocorrências: sem pendências"}).click();
  await center(page).getByRole("tab",{name:"Histórico (1)"}).click();await expect(center(page)).toContainText("Prazo de resposta encerrado");
  await page.keyboard.press("Escape");await courier(page);await driver(page).getByRole("button",{name:"Entregue",exact:true}).click();
  await expect(driver(page)).toContainText("Retornando");await page.keyboard.press("Escape");
  await open(page,"issues-last");await courier(page);await driver(page).getByRole("button",{name:"Entregue",exact:true}).click();
  await expect(driver(page)).toContainText("Retornando");await expect(driver(page)).toContainText("Retornar pedido à loja");await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Ocorrências: sem pendências"}).click();await center(page).getByRole("tab",{name:"Histórico (1)"}).click();
  await expect(center(page)).toContainText("Demais entregas encerradas");
});
test("som exige opt-in, agrupa simultâneas e não repete em relógio, reabertura ou histórico",async({page})=>{
  await page.addInitScript(()=>{
    const w=window as unknown as {toneStarts:number;audioContexts:number};w.toneStarts=0;w.audioContexts=0;
    const param={setValueAtTime(){},linearRampToValueAtTime(){}};
    class FakeAudioContext {
      state="suspended";currentTime=0;destination={};constructor(){w.audioContexts++;}
      async resume(){this.state="running";}async suspend(){this.state="suspended";}async close(){this.state="closed";}
      createGain(){return {gain:param,connect(){},disconnect(){}};}
      createOscillator(){return {type:"sine",frequency:param,onended:null,connect(){},disconnect(){},start(){w.toneStarts++;},stop(){}};}
    }
    Object.defineProperty(window,"AudioContext",{value:FakeAudioContext,configurable:true});
  });
  await page.clock.install({time:new Date(epoch-60_000)});await page.clock.pauseAt(new Date(epoch));
  const counters=()=>page.evaluate(()=>{const w=window as unknown as {toneStarts:number;audioContexts:number};return [w.toneStarts,w.audioContexts];});
  await open(page,"issues-client");await page.clock.runFor(1000);expect(await counters()).toEqual([0,0]);
  await page.getByRole("button",{name:"Ativar som de alertas"}).click();await expect(page.getByRole("button",{name:"Silenciar alertas"})).toHaveAttribute("aria-pressed","true");
  await page.clock.runFor(1000);expect(await counters()).toEqual([0,1]);
  await open(page,"issues-multiple");expect(await counters()).toEqual([0,0]);
  await page.getByRole("button",{name:"Simular 3 ocorrências simultâneas"}).click();
  await expect(page.getByRole("heading",{name:"3 novas ocorrências"})).toBeVisible();await page.clock.runFor(250);expect(await counters()).toEqual([0,0]);
  await page.reload();await expect(page.getByRole("button",{name:"Ativar som de alertas"})).toHaveAttribute("aria-pressed","false");
  await page.getByRole("button",{name:"Ativar som de alertas"}).click();await page.getByRole("button",{name:"Simular 3 ocorrências simultâneas"}).click();
  await expect(page.getByRole("heading",{name:"3 novas ocorrências"})).toBeVisible();await page.clock.runFor(250);
  expect(await counters()).toEqual([2,1]);await page.clock.runFor(5000);expect(await counters()).toEqual([2,1]);
  await page.getByRole("button",{name:"Fechar aviso sem resolver ocorrências"}).click();
  await page.getByRole("button",{name:"Ocorrências: 3 pendências",exact:true}).click();await page.keyboard.press("Escape");
  await page.clock.runFor(1000);expect(await counters()).toEqual([2,1]);
  await page.getByRole("button",{name:"Silenciar alertas"}).click();await page.getByRole("button",{name:"Simular nova ocorrência"}).click();await page.clock.runFor(500);
  expect(await counters()).toEqual([2,1]);await page.reload();await expect(page.getByRole("button",{name:"Ativar som de alertas"})).toHaveAttribute("aria-pressed","false");
});
test("áudio bloqueado ou indisponível mantém opt-in desligado e alertas visuais utilizáveis",async({page})=>{
  for(const blocked of [false,true]){
    await page.addInitScript(blocked=>{
      class BlockedAudioContext {state="suspended";async resume(){throw Error("blocked");}async close(){this.state="closed";}}
      Object.defineProperty(window,"AudioContext",{value:blocked?BlockedAudioContext:undefined,configurable:true});
    },blocked);
    await open(page,"issues-new");await page.getByRole("button",{name:"Ativar som de alertas"}).click();
    await expect(page.getByText("Não foi possível ativar o som. Os alertas visuais continuam ativos.",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"Ativar som de alertas"})).toHaveAttribute("aria-pressed","false");
    await page.getByRole("button",{name:"Simular nova ocorrência",exact:true}).click();await expect(page.locator(".ops-new-issue")).toBeInViewport();
  }
});
test("rechecagem P2: contraste, contexto antes da decisão, próxima entrega fixa e reabertura nas pendências",async({page})=>{
  for(const width of [320,375,390,1280,1440]){
    await page.setViewportSize({width,height:844});await open(page,"issues-long");
    await page.getByRole("button",{name:/^Ocorrências:/}).click();
    const selected=center(page).getByRole("tab",{name:"Pendentes (1)"});await selected.hover();
    await expect(selected).toHaveCSS("background-color","rgb(32, 49, 44)");await expect(selected).toHaveCSS("color","rgb(255, 255, 255)");
    const card=center(page).getByRole("article",{name:"Ocorrência do pedido 1039",exact:true});
    await expect(card.locator(".ops-issue-context")).toContainText("Alergia alimentar: conferir etiqueta. Não deixar na recepção sem confirmação.");
    await expect(card.locator(".ops-issue-context")).toContainText("A entrada lateral está fechada; cliente pediu para conferir a alternativa com o restaurante antes de nova tentativa.");
    expect(await card.locator(".ops-issue-context").evaluate(el=>!!(el.compareDocumentPosition(el.parentElement!.querySelector('.ops-issue-decisions')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    await card.getByRole("button",{name:"Tentar novamente"}).click();await center(page).getByRole("tab",{name:"Histórico (1)"}).click();await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Simular nova ocorrência",exact:true}).click();await page.getByRole("button",{name:"Decidir na Central"}).click();
    await expect(center(page).getByRole("tab",{name:"Pendentes (1)"})).toHaveAttribute("aria-selected","true");
    await expect(center(page).getByRole("article",{name:"Ocorrência do pedido 1040",exact:true}).locator(".ops-issue-context")).toContainText("Contato sem resposta na simulação. Conferir referência de entrega.");
    await page.keyboard.press("Escape");await page.locator(".ops-new-issue").getByRole("button",{name:"Acompanhar rotas"}).click();await courier(page);
    await expect(driver(page).locator(".ops-driver-heading>.ops-kicker")).toBeVisible();await expect(driver(page).locator(".ops-driver-heading")).toContainText("PRÓXIMA ENTREGA");
    await expect(driver(page).getByRole("heading",{name:/#1043/})).toBeInViewport();
    await driver(page).getByRole("button",{name:"Não consegui entregar"}).click();await driver(page).getByLabel("Motivo da falha").selectOption("OTHER");
    await driver(page).getByRole("textbox").fill("Relato longo fictício. ".repeat(20));
    await expect(driver(page).getByRole("heading",{name:/#1043/})).toBeInViewport();await expect(driver(page).locator(".ops-driver-heading>.ops-kicker")).toBeInViewport();
    expect(await driver(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  }
});
for(const width of [320,375,390,1280,1440])test(`alerta, foco, textos longos, toque e ações em ${width}px`,async({page})=>{
  await page.setViewportSize({width,height:width>=1280?900:844});await page.emulateMedia({reducedMotion:"reduce"});
  await open(page,"issues-long");await expect(page.getByRole("heading",{name:"Nova ocorrência de entrega"})).toHaveCount(0);
  await page.getByRole("button",{name:"Simular nova ocorrência"}).click();
  const alert=page.locator(".ops-new-issue");await expect(alert).toBeVisible();
  expect(await alert.evaluate(el=>getComputedStyle(el).transitionDuration)).toBe("0s");
  await alert.getByRole("button",{name:"Acompanhar rotas"}).click();
  await expect(width<1100?route(page):page.locator("#ops-panel-routes")).toBeFocused();await expect(route(page)).toHaveClass(/is-highlighted/);
  if(width<1100)await expect(page.getByRole("tab",{name:"Rotas",exact:true})).toHaveAttribute("aria-selected","true");
  await page.getByRole("button",{name:/^Ocorrências:/}).click();
  await center(page).getByText("Detalhes e histórico",{exact:true}).first().click();await expect(center(page)).toContainText("Alergia alimentar: conferir etiqueta");
  await expect(center(page)).toContainText("Entrada pela portaria de visitantes");
  const sizes=await center(page).locator("button:visible").evaluateAll(els=>els.map(el=>el.getBoundingClientRect()));
  expect(sizes.every(r=>r.height>=44&&r.width>=44)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect(await center(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
  await page.keyboard.press("Escape");await courier(page);
  await expect(driver(page).getByRole("heading",{name:/#1043/})).toBeVisible();await expect(driver(page).getByRole("button",{name:"Entregue",exact:true})).toBeVisible();
  expect(await driver(page).evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
});
test("pico de 1.000 pedidos permanece navegável; cenário vazio sem aviso ou pendência",async({page})=>{
  await open(page,"issues-busy");await expect(page.locator(".ops-order")).toHaveCount(20);
  await page.getByRole("button",{name:"Simular nova ocorrência"}).click();await expect(page.getByRole("heading",{name:"Nova ocorrência de entrega"})).toBeVisible();
  await page.getByRole("button",{name:/^Ocorrências:/}).click();await expect(center(page)).toContainText("Cliente não localizado");await page.keyboard.press("Escape");
  await open(page,"empty");await expect(page.getByRole("button",{name:"Ocorrências: sem pendências"})).toBeVisible();await expect(page.locator(".ops-new-issue")).toHaveCount(0);
});
