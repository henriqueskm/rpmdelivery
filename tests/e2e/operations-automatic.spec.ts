import { test, expect, type Page } from "@playwright/test";
test.use({timezoneId:"America/Sao_Paulo"});
const epoch=new Date("2026-10-12T18:00:00Z");
const dialog=(page:Page)=>page.getByRole("dialog",{name:"Montagem automática",exact:true});
async function open(page:Page,scenario="opt-urgent",capacity="4",manualSelection:string[]=[]) {
  await page.clock.setFixedTime(epoch);
  await page.goto(`/preview/operacao?scenario=${scenario}`);
  for(const reference of manualSelection)await page.getByRole("checkbox",{name:`Selecionar pedido ${reference}`,exact:true}).check();
  await page.getByRole("button",{name:"Montagem automática",exact:true}).click();
  await expect(dialog(page)).toBeVisible();
  await dialog(page).getByLabel("Entregas por rota",{exact:true}).selectOption(capacity);
}
async function calculate(page:Page) {
  await dialog(page).getByRole("button",{name:"Gerar propostas (demo)",exact:true}).click();
  await expect(dialog(page).getByRole("region",{name:"Rotas propostas",exact:true})).toBeVisible();
}
test("calcular não atribui; lote reserva FIFO em PREPARING, só loja libera e só motoboy inicia",async({page})=>{
  const external:string[]=[],errors:string[]=[];
  page.on("request",r=>{if(r.url().startsWith("http")&&(r.method()!=="GET"||new URL(r.url()).hostname!=="127.0.0.1"))external.push(r.url());});
  page.on("pageerror",e=>errors.push(e.message));
  await open(page,"opt-urgent","1",["1048","1047"]);await calculate(page);
  await expect(page.locator(".ops-stop-content strong")).toHaveCount(2);
  const proposals=dialog(page).getByRole("article",{name:/^Proposta /});
  await expect(proposals).toHaveCount(3);
  await expect(proposals.nth(0)).toContainText("João Martins");await expect(proposals.nth(1)).toContainText("Lívia Oliveira");await expect(proposals.nth(2)).toContainText("Bianca Souza");
  await expect(page.getByRole("article",{name:"Rota R-43",exact:true})).toHaveCount(0);
  const choose=dialog(page).getByRole("checkbox",{name:/^Selecionar proposta /});
  for(let i=0;i<3;i++)await choose.nth(i).check();
  await dialog(page).getByRole("button",{name:"Confirmar 3 rotas (demo)",exact:true}).click();
  await expect(page.locator("#ops-panel-routes")).toBeFocused();
  await expect(page.locator(".ops-stop-content strong")).toHaveCount(1);
  await expect(page.locator(".ops-stop-content strong")).toContainText("#1048");
  for(const reference of ["R-43","R-44","R-45"]) {
    const route=page.getByRole("article",{name:`Rota ${reference}`,exact:true});
    await expect(route).toContainText("Em preparação");await expect(route).toContainText("Aguardando liberação");
  }
  const route=page.getByRole("article",{name:"Rota R-43",exact:true});
  await route.getByRole("button",{name:"Visão do motoboy (demo)",exact:true}).click();
  const driver=page.getByRole("dialog",{name:"Aplicativo do motoboy",exact:true});
  await expect(driver.getByRole("button",{name:"Recolhi os pedidos · Iniciar rota",exact:true})).toBeDisabled();
  await page.keyboard.press("Escape");await route.getByRole("button",{name:"Liberar retirada",exact:true}).click();
  await route.getByRole("button",{name:"Visão do motoboy (demo)",exact:true}).click();
  await driver.getByRole("button",{name:"Recolhi os pedidos · Iniciar rota",exact:true}).click();
  await expect(driver).toContainText("Em rota");expect(errors).toEqual([]);expect(external).toEqual([]);
});
test("um pedido permite confirmação individual sem aplicar outras propostas",async({page})=>{
  await open(page,"one");await calculate(page);
  await expect(dialog(page).getByRole("heading",{name:"Se confirmar todas as propostas",exact:true})).toBeVisible();
  await expect(dialog(page).locator(".ops-auto-metrics")).toContainText("rota proposta");
  await expect(dialog(page).locator(".ops-auto-metrics")).toContainText("entrega proposta");
  await expect(dialog(page).locator(".ops-auto-selection")).toContainText("Nada atribuído");
  await expect(dialog(page).locator(".ops-auto-batch")).toContainText("1 de 1 pedido analisado");
  await expect(dialog(page).getByRole("article",{name:"Proposta 1",exact:true})).toContainText("1 entrega");
  await dialog(page).getByRole("button",{name:"Confirmar rota 1 de João Martins (demo)",exact:true}).click();
  await expect(page.getByRole("article",{name:"Rota R-43",exact:true})).toContainText("Aguardando liberação");
  await expect(page.getByRole("article",{name:"Rota R-44",exact:true})).toHaveCount(0);
});
test("ajustar ordem e retirar pedido recalcula sem persistir; critérios antigos ficam bloqueados",async({page})=>{
  await open(page,"opt-short","2");await calculate(page);
  let card=dialog(page).getByRole("article",{name:"Proposta 1",exact:true});
  await card.getByText("Conferir e ajustar pedidos",{exact:true}).click();
  const original=await card.locator("li > strong").allTextContents();
  const down=card.getByRole("button",{name:/^Descer pedido /}).first();
  await down.click();
  await expect(card.locator("li > strong")).toHaveText(original.slice().reverse().map((s,i)=>s.replace(/^\d+\./,`${i+1}.`)));
  await card.getByRole("button",{name:/^Retirar pedido /}).first().click();
  await expect(card.locator("li")).toHaveCount(1);
  await expect(dialog(page).getByRole("region",{name:"Pedidos que continuam aguardando",exact:true})).toBeVisible();
  await card.getByLabel("Adicionar pendente à proposta 1",{exact:true}).selectOption({index:1});
  await card.getByRole("button",{name:"Adicionar pedido",exact:true}).click();
  await expect(card.locator("li")).toHaveCount(2);
  await dialog(page).getByRole("button",{name:"Editar critérios",exact:true}).click();
  await dialog(page).getByLabel("Atendimento por parada (min)",{exact:true}).fill("3");
  await expect(dialog(page).getByRole("alert")).toContainText("recalcule");
  await expect(dialog(page).getByRole("button",{name:/^Confirmar \d+ rotas?/})).toBeDisabled();
  await calculate(page);
  card=dialog(page).getByRole("article",{name:"Proposta 1",exact:true});
  await expect(card).toBeVisible();
  await page.clock.setFixedTime(new Date(epoch.getTime()+600000));
  await expect(dialog(page).getByRole("alert")).toContainText("saída estimada ficou no passado");
  await expect(dialog(page).getByRole("button",{name:"Gerar propostas (demo)",exact:true})).toBeDisabled();
  await expect(dialog(page).getByRole("button",{name:/^Confirmar \d+ rotas?/})).toBeDisabled();
  await dialog(page).getByLabel("Saída estimada",{exact:true}).fill("2026-10-12T15:15");
  await calculate(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button",{name:"Montagem automática",exact:true})).toBeFocused();
  await expect(page.getByRole("article",{name:"Rota R-43",exact:true})).toHaveCount(0);
});
test("pico explicita lote, pendências e motivos sem travar; interface em 320/375/390/1280/1440",async({page})=>{
  await open(page,"busy");await calculate(page);
  await expect(dialog(page)).toContainText("24 de 1000 pedidos analisados");
  await expect(dialog(page).locator(".ops-auto-risk-summary")).toContainText("não cumpririam o prazo nem na estimativa otimista");
  const counts=await page.locator(".ops-auto-metrics strong").allTextContents();
  expect(Number(counts[0])).toBeLessThanOrEqual(3);expect(Number(counts[1])).toBeLessThanOrEqual(12);
  expect(Number(counts[1])+Number(counts[2])).toBe(1000);
  await dialog(page).getByText(new RegExp(`Ver ${counts[2]} pedidos pendentes e motivos`)).click();
  const pending=dialog(page).getByRole("region",{name:"Pedidos que continuam aguardando",exact:true});
  await expect(pending.locator("li")).toHaveCount(20);
  await pending.getByRole("button",{name:"Próximos pendentes",exact:true}).click();
  await expect(pending).toContainText("Fora do lote de 24");
  await pending.getByText(new RegExp(`Ver ${counts[2]} pedidos pendentes e motivos`)).click();
  for(const width of [320,375,390,1280,1440]) {
    const height=width===1280?800:width===1440?900:844;
    await page.setViewportSize({width,height});
    await dialog(page).locator(".ops-opt-scroll").evaluate(el=>{el.scrollTop=0;});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const courier=dialog(page).getByRole("checkbox",{name:"Selecionar proposta 1",exact:true});
    const courierRect=(await courier.boundingBox())!;
    const scrollRect=(await dialog(page).locator(".ops-opt-scroll").boundingBox())!;
    expect(courierRect.y).toBeGreaterThanOrEqual(scrollRect.y);
    expect(courierRect.y+courierRect.height).toBeLessThanOrEqual(scrollRect.y+scrollRect.height);
    for(const label of ["Voltar sem atribuir","Confirmar 0 rotas (demo)"]) {
      const r=await dialog(page).getByRole("button",{name:label,exact:true}).boundingBox();
      expect(r!.height).toBeGreaterThanOrEqual(44);expect(r!.y+r!.height).toBeLessThanOrEqual(height);
    }
  }
  await dialog(page).getByRole("checkbox",{name:"Selecionar proposta 1",exact:true}).check();
  await expect(dialog(page).locator(".ops-auto-selection")).toContainText("Selecionadas: 1 rota");
  const first=dialog(page).getByRole("article",{name:"Proposta 1",exact:true});
  const deliveryCount=Number((await first.locator(".ops-auto-route-summary").innerText()).match(/^\d+/)![0]);
  await expect(dialog(page).locator(".ops-auto-selection")).toContainText(`${1000-deliveryCount} seguem aguardando`);
  await expect(dialog(page).getByRole("button",{name:"Confirmar 1 rota (demo)",exact:true})).toBeEnabled();
  for(const width of [320,375,390,1280,1440]) {
    await page.setViewportSize({width,height:width===1280?800:width===1440?900:844});
    await first.getByText("Conferir e ajustar pedidos",{exact:true}).click();
    await expect.poll(async()=>{
      const stop=(await first.locator("li").first().boundingBox())!;
      const area=(await dialog(page).locator(".ops-opt-scroll").boundingBox())!;
      return stop.y>=area.y&&stop.y+stop.height<=area.y+area.height;
    }).toBe(true);
    await first.getByText("Conferir e ajustar pedidos",{exact:true}).click();
  }
});
for(const [scenario,expected] of [
  ["auto-no-couriers","Sem motoboy disponível"],["opt-missing","Sem coordenadas confirmadas"],
  ["opt-no-route","Sem percurso encontrado neste lote"],["auto-scarce","fora das propostas"],
] as const)test(`pendência ${scenario} mantém montagem manual e não esconde pedidos`,async({page})=>{
  await open(page,scenario,"1");await calculate(page);
  if(scenario==="auto-no-couriers") {
    await expect(dialog(page).locator(".ops-auto-cause")).toContainText("Nenhum motoboy disponível");
    await expect(dialog(page).locator('.ops-auto-metrics [data-tone="gain"]')).toHaveCount(0);
  }
  const pending=dialog(page).getByRole("region",{name:"Pedidos que continuam aguardando",exact:true});
  await pending.getByText(/Ver \d+ pedidos? pendentes? e motivos/).click();
  await expect(dialog(page)).toContainText(expected);
  await dialog(page).getByRole("button",{name:"Voltar sem atribuir",exact:true}).click();
  await expect(page.getByRole("article",{name:"Rota R-43",exact:true})).toHaveCount(0);
});
test("impossíveis, margem apertada, textos longos e vazio continuam explícitos",async({page})=>{
  for(const scenario of ["opt-impossible","opt-tight","worst","empty"]) {
    await page.setViewportSize({width:320,height:844});await open(page,scenario);await calculate(page);
    if(scenario==="opt-impossible") {
      await expect(dialog(page).locator('.ops-opt-risk[data-tone="danger"]')).toContainText("6 atrasos previstos");
      await expect(dialog(page).locator(".ops-auto-metrics strong").nth(1)).toHaveText("6");
    }
    if(scenario==="worst") {
      for(const summary of await dialog(page).getByText("Conferir e ajustar pedidos",{exact:true}).all())await summary.click();
      await expect(dialog(page)).toContainText("Alergia alimentar: conferir etiqueta.");
    }
    if(scenario==="empty")await expect(dialog(page)).toContainText("Nenhuma rota proposta");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
  }
});
test("limite de duração/critério inválido explica impedimento, sem atribuição",async({page})=>{
  await open(page,"opt-short");await dialog(page).getByText("Limite de duração",{exact:true}).click();
  await dialog(page).getByLabel("Duração máxima da rota (min)",{exact:true}).fill("1");await calculate(page);
  await expect(dialog(page)).toContainText("Nenhuma rota proposta");
  await dialog(page).getByRole("region",{name:"Pedidos que continuam aguardando",exact:true}).getByText(/Ver \d+ pedidos? pendentes?/).click();
  await expect(dialog(page)).toContainText("Trajeto excede a duração máxima");
  await dialog(page).getByRole("button",{name:"Editar critérios",exact:true}).click();
  await dialog(page).getByLabel("Atendimento por parada (min)",{exact:true}).fill("-1");
  await dialog(page).getByRole("button",{name:"Gerar propostas (demo)",exact:true}).click();
  await expect(dialog(page).getByRole("alert")).toContainText("montagem manual continua disponível");
});
test("worker sem resposta mantém UI responsiva, cancela, expira em 5s e permite recuperação",async({page})=>{
  let intercepted=0;
  const workerPattern="**/turbopack-worker-*.js*";
  // Explicit transport fixture: a worker that never replies, not a fake successful proposal.
  await page.route(workerPattern,async route=>{intercepted++;await route.fulfill({status:200,contentType:"application/javascript",body:"self.onmessage=()=>{};"});});
  await open(page,"busy");
  await dialog(page).getByRole("button",{name:"Gerar propostas (demo)",exact:true}).click();
  await expect(dialog(page).getByRole("status")).toContainText("Calculando propostas");
  await dialog(page).getByRole("button",{name:"Cancelar cálculo",exact:true}).click();
  await expect(dialog(page).getByRole("region",{name:"Rotas propostas",exact:true})).toHaveCount(0);
  await dialog(page).getByRole("button",{name:"Gerar propostas (demo)",exact:true}).click();
  await expect(dialog(page).getByRole("alert")).toContainText("limite de 5 segundos",{timeout:8000});
  expect(intercepted).toBeGreaterThan(0);
  await expect(page.getByRole("article",{name:"Rota R-43",exact:true})).toHaveCount(0);
  await page.unroute(workerPattern);
  await calculate(page);
  await expect(dialog(page)).toContainText("24 de 1000 pedidos analisados");
});
test("ajuste sem percurso preserva a proposta anterior e permite continuar a conferência",async({page})=>{
  await open(page,"opt-no-route","8");await calculate(page);
  const card=dialog(page).getByRole("article",{name:"Proposta 1",exact:true});
  await card.getByText("Conferir e ajustar pedidos",{exact:true}).click();
  const before=await card.locator("li > strong").allTextContents();
  await card.getByLabel("Adicionar pendente à proposta 1",{exact:true}).selectOption({index:1});
  await card.getByRole("button",{name:"Adicionar pedido",exact:true}).click();
  await expect(dialog(page).getByRole("alert")).toContainText("proposta anterior foi preservada");
  await expect(card.locator("li > strong")).toHaveText(before);
  await expect(card.getByRole("button",{name:"Confirmar rota 1 de João Martins (demo)",exact:true})).toBeEnabled();
  await expect(page.getByRole("article",{name:"Rota R-43",exact:true})).toHaveCount(0);
});
