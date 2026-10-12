import {test,expect,type Page} from "@playwright/test";
test.use({timezoneId:"America/Sao_Paulo"});
const epoch=Date.parse("2026-10-12T18:00:00Z");
async function open(page:Page,scenario="opt-urgent",count=3){
  await page.clock.install({time:new Date(epoch-600000)});await page.clock.pauseAt(new Date(epoch));
  await page.goto(`/preview/operacao?scenario=${scenario}`);
  await expect(page.getByRole("checkbox",{name:"Selecionar pedido 1048",exact:true})).toBeVisible();
  for(const reference of ["1048","1047","1046"].slice(0,count))
    await page.getByRole("checkbox",{name:`Selecionar pedido ${reference}`,exact:true}).check();
  const tab=page.getByRole("tab",{name:/^Montagem/});if(await tab.isVisible())await tab.click();
  // Let the lazily loaded dialog/Suspense settle before pausing timers for the simulated calculation.
  await page.clock.resume();
  await page.getByRole("button",{name:"Sugerir sequência",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"Sugerir sequência",exact:true})).toBeVisible();
  const current=await page.evaluate(()=>Date.now());
  await page.clock.pauseAt(new Date(current+1000));
}
const dialog=(page:Page)=>page.getByRole("dialog",{name:"Sugerir sequência",exact:true});
async function calculate(page:Page){
  await dialog(page).getByRole("button",{name:"Calcular sugestão (demo)"}).click();
  await expect(dialog(page).getByText("Calculando com a matriz simulada…",{exact:true})).toBeVisible();
  await page.clock.runFor(200);
}
test("sugestão explica urgência, compara hipóteses e só aplica após confirmação, sem consumo externo",async({page})=>{
  const errors:string[]=[],external:string[]=[];
  page.on("pageerror",e=>errors.push(e.message));
  page.on("request",r=>{if(r.url().startsWith("http")&&(r.method()!=="GET"||new URL(r.url()).hostname!=="127.0.0.1"))external.push(r.url());});
  await open(page);
  const manualBefore=await page.locator(".ops-stop-content strong").allTextContents();
  await calculate(page);
  const proposed=dialog(page).getByRole("region",{name:"Ordem sugerida"});
  await expect(proposed.locator("li").first()).toContainText("#1047");
  await expect(proposed).toContainText("0 com atraso previsto");
  const summary=dialog(page).getByRole("region",{name:"Comparação resumida"});
  if(await summary.isVisible()) {
    await expect(summary).toContainText("1 com atraso previsto");
    await expect(summary).toContainText("0 com atraso previsto");
    await expect(summary).toBeInViewport();
    await dialog(page).getByRole("button",{name:"Ver manual",exact:true}).click();
    await expect(dialog(page).getByRole("region",{name:"Ordem manual"})).toContainText("1 com atraso previsto");
    await dialog(page).getByRole("button",{name:"Ver sugerida",exact:true}).click();
    await expect(proposed).toBeVisible();
  } else await expect(dialog(page).getByRole("region",{name:"Ordem manual"})).toContainText("1 com atraso previsto");
  expect(await page.locator(".ops-stop-content strong").allTextContents()).toEqual(manualBefore);
  const expectedOrder=await proposed.locator("li > strong").allTextContents();
  await dialog(page).getByRole("button",{name:"Aplicar sequência (demo)"}).click();
  await expect(page.locator(".ops-stop-content strong")).toHaveText(expectedOrder);
  await page.getByRole("button",{name:"Atribuir rota (demo)"}).click();
  await expect(page.getByRole("article",{name:"Rota R-43",exact:true})).toContainText("Em preparação");
  await expect(page.getByRole("article",{name:"Rota R-43",exact:true})).toContainText("Aguardando liberação");
  expect(errors).toEqual([]);expect(external).toEqual([]);
});
test("mobile compara as duas ordens antes de aplicar e abre detalhes sem rolar a lista manual",async({page})=>{
  await open(page);
  await calculate(page);
  for(const width of [320,375,390]) {
    await page.setViewportSize({width,height:844});
    const summary=dialog(page).getByRole("region",{name:"Comparação resumida"});
    await expect(summary).toContainText("1 com atraso previsto");
    await expect(summary).toContainText("0 com atraso previsto");
    const bounds=await summary.boundingBox();
    const scroll=await page.locator(".ops-opt-scroll").boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(scroll!.y);
    expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(scroll!.y+scroll!.height);
    await expect(dialog(page).getByRole("region",{name:"Ordem sugerida"})).toBeVisible();
    await expect(dialog(page).getByRole("region",{name:"Ordem manual"})).toHaveCount(0);
    await dialog(page).getByRole("button",{name:"Ver manual",exact:true}).click();
    await expect(dialog(page).getByRole("region",{name:"Ordem manual"})).toBeVisible();
    await dialog(page).getByRole("button",{name:"Ver sugerida",exact:true}).click();
    await expect(dialog(page).getByRole("button",{name:"Editar hipóteses",exact:true})).toHaveAttribute("aria-expanded","false");
  }
});
test("descartar, mudar hipóteses e cancelar cálculo não aplicam proposta obsoleta",async({page})=>{
  await open(page);
  const original=await page.locator(".ops-stop-content strong").allTextContents();
  await calculate(page);
  const edit=dialog(page).getByRole("button",{name:"Editar hipóteses",exact:true});
  if(await edit.isVisible()) await edit.click();
  await dialog(page).getByLabel("Atendimento por parada (min)").fill("3");
  await expect(dialog(page)).toContainText("Dados ou saída estimada mudaram");
  await expect(dialog(page).getByRole("button",{name:"Aplicar sequência (demo)"})).toBeDisabled();
  await calculate(page);
  await dialog(page).getByRole("button",{name:"Descartar",exact:true}).click();
  expect(await page.locator(".ops-stop-content strong").allTextContents()).toEqual(original);
  await expect(page.getByRole("button",{name:"Sugerir sequência",exact:true})).toBeFocused();
  await page.getByRole("button",{name:"Sugerir sequência",exact:true}).click();
  await dialog(page).getByRole("button",{name:"Calcular sugestão (demo)"}).click();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"Remover pedido 1046 da montagem"}).click();
  await page.clock.runFor(500);
  expect(await page.locator(".ops-stop-content strong").count()).toBe(2);
  await page.getByRole("button",{name:"Sugerir sequência",exact:true}).click();
  await expect(dialog(page).getByRole("region",{name:"Ordem sugerida"})).toHaveCount(0);
  await expect(dialog(page).getByRole("button",{name:"Aplicar sequência (demo)"})).toBeDisabled();
});
test("aplicar reordenação em PREPARING preserva liberação e bloqueia otimização após saída",async({page})=>{
  await open(page);
  await dialog(page).getByRole("button",{name:"Descartar",exact:true}).click();
  await page.getByRole("button",{name:"Atribuir rota (demo)"}).click();
  const card=page.getByRole("article",{name:"Rota R-43",exact:true});
  await card.getByRole("button",{name:"Liberar retirada",exact:true}).click();
  await card.getByRole("button",{name:"Editar montagem",exact:true}).click();
  await page.getByRole("button",{name:"Sugerir sequência",exact:true}).click();
  await calculate(page);
  const expected=await dialog(page).getByRole("region",{name:"Ordem sugerida"}).locator("li > strong").allTextContents();
  await dialog(page).getByRole("button",{name:"Aplicar sequência (demo)"}).click();
  await page.getByRole("button",{name:"Salvar montagem (demo)"}).click();
  await expect(card).toContainText("Pronto para retirada");
  await card.getByRole("button",{name:"Visão do motoboy (demo)"}).click();
  const driver=page.getByRole("dialog",{name:"Aplicativo do motoboy"});
  await expect(driver.locator(".ops-courier-deliveries li > strong")).toHaveText(expected);
  await driver.getByRole("button",{name:"Recolhi os pedidos · Iniciar rota"}).click();
  await expect(driver).toContainText("Em rota");
  await page.keyboard.press("Escape");
  await expect(card.getByRole("button",{name:"Editar montagem"})).toHaveCount(0);
  const tab=page.getByRole("tab",{name:/^Montagem/});if(await tab.isVisible())await tab.click();
  await expect(page.getByRole("button",{name:"Sugerir sequência",exact:true})).toBeDisabled();
});
for(const [scenario,message] of [
  ["opt-impossible","Nenhuma sequência cumpre todos os prazos"],
  ["opt-no-route","Não existe percurso completo"],
  ["opt-unavailable","Simulação de serviço indisponível"],
  ["opt-missing","Faltam coordenadas confirmadas"],
] as const)test(`falha/risco ${scenario} preserva a montagem manual`,async({page})=>{
  await open(page,scenario);
  const before=await page.locator(".ops-stop-content strong").allTextContents();
  await calculate(page);
  await expect(dialog(page)).toContainText(message);
  await dialog(page).getByRole("button",{name:"Descartar",exact:true}).click();
  expect(await page.locator(".ops-stop-content strong").allTextContents()).toEqual(before);
  await expect(page.getByRole("button",{name:"Atribuir rota (demo)"})).toBeEnabled();
});
test("pico acima de oito é explicado sem truncar; textos longos e controles cabem em 320/375/390",async({page})=>{
  await page.goto("/preview/operacao?scenario=busy");
  await page.getByRole("checkbox",{name:"Selecionar visíveis",exact:true}).check();
  const tab=page.getByRole("tab",{name:/^Montagem/});if(await tab.isVisible())await tab.click();
  await page.getByRole("button",{name:"Sugerir sequência",exact:true}).click();
  await expect(dialog(page)).toContainText("Selecione até 8 pedidos");
  await expect(dialog(page).getByRole("button",{name:"Calcular sugestão (demo)"})).toBeDisabled();
  await page.keyboard.press("Escape");
  expect(await page.locator(".ops-sequence li").count()).toBe(20);
  await page.getByLabel("Cenário").selectOption("worst");
  for(const reference of ["1048","WHATSAPP-20261011-PEDIDO-ALMOCO-1284","1046"])await page.getByRole("checkbox",{name:`Selecionar pedido ${reference}`,exact:true}).check();
  const nextTab=page.getByRole("tab",{name:/^Montagem/});if(await nextTab.isVisible())await nextTab.click();
  await page.getByRole("button",{name:"Sugerir sequência",exact:true}).click();
  await dialog(page).getByRole("button",{name:"Calcular sugestão (demo)"}).click();
  await expect(dialog(page).getByRole("region",{name:"Ordem sugerida"})).toBeVisible();
  for(const width of [320,375,390]){
    await page.setViewportSize({width,height:844});
    await expect(dialog(page)).toContainText("Maria Aparecida de Albuquerque e Vasconcelos");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const button=await dialog(page).getByRole("button",{name:"Descartar",exact:true}).boundingBox();
    expect(button!.height).toBeGreaterThanOrEqual(44);expect(button!.y+button!.height).toBeLessThanOrEqual(844);
  }
});
