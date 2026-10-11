# Visual Critic do RpmDelivery

`rpmdelivery_visual_critic` é um custom subagent do projeto definido em `.codex/agents/rpmdelivery-visual-critic.toml`. Revisa Product Design, Design Engineering e UX operacional de forma independente; o Builder implementa e corrige, o Critic coleta evidências e recomenda, e a aprovação da PR continua humana.

## Quando e como invocar

Use depois da implementação e QA do Builder, antes da aprovação de mudanças visuais relevantes. Não o acione em PRs exclusivamente de backend/documentação. Não carregue todas as skills em toda tarefa.

Abra uma sessão no checkout da feature que contenha a configuração (depois do merge desta PR, branches novas da main a herdarão). Forneça PR/HEAD, URL local já iniciada, escopo, cenários fictícios e link Figma aprovado quando existir. Peça **delegação ao custom subagent pelo nome**, com contexto independente do histórico de implementação:

```text
Invoque o custom subagent rpmdelivery_visual_critic em uma sessão independente
do Builder para revisar a PR <número>, HEAD <SHA>, em <URL localhost>.
Inspecione desktop 1280×800/1440×900 e mobile 390×844/375px/320px,
os cenários disponíveis e teclado. Não edite arquivos nem dados.
Retorne achados P0–P3 com evidências, reprodução, responsável,
recomendação, benefício e limitações. Aguarde o relatório antes da revisão humana.
```

Se a ferramenta expuser `agent_type`, selecione `rpmdelivery_visual_critic`. Um agente genérico que apenas lê o TOML é um teste comportamental, **não comprova descoberta/invocação nativa**. Registre a diferença. Uma sessão já aberta pode precisar ser reaberta para carregar agentes recém-adicionados; não edite configuração global para contornar isso.

## Configuração e skills

Conforme a [documentação oficial de custom agents](https://learn.chatgpt.com/docs/agent-configuration/subagents#custom-agents), arquivos do projeto em `.codex/agents/` definem `name`, `description` e `developer_instructions`. O campo `name` identifica o agente, independentemente do nome do arquivo. Não há override de modelo/esforço: as escolhas do chamador são herdadas.

| Skill existente | Uso seletivo |
| --- | --- |
| `.agents/skills/emil-design-eng/` | Hierarquia, acabamento, densidade e clareza operacional |
| `.agents/skills/mobile-native/` | Reflow, toque e limites da emulação |
| `.agents/skills/break-ui/` | Vazio, um item, textos longos e volume com fixtures existentes |
| `.agents/skills/review-animations/` | Somente quando houver movimento relevante |
| `.codex/skills/rpmdelivery-qa/` | Inspeção do localhost, console/network e evidências |

O Critic não instala, duplica ou modifica essas skills. As sugestões de correção, criação de fixtures e execução de comandos da QA não se aplicam ao revisor; ficam com o Builder.

## Leitura e limites

`sandbox_mode = "read-only"` e `approval_policy = "never"` são padrões restritivos para comandos. Não garantem isolamento universal de ferramentas: navegador/MCP têm permissões próprias, e overrides ativos do chamador podem prevalecer conforme a [documentação de sandbox dos subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents#approvals-and-sandbox-controls). Não use `--yolo`, ampliação de permissões ou autoaprovação para executar o Critic. As instruções proíbem escrita mesmo quando uma superfície oferece ferramentas de mutação.

- Leia código, Git e evidências; não leia `.env`, tokens ou secrets.
- Use o servidor já iniciado pelo Builder. Não execute npm ci, build, verify, testes ou comandos que geram arquivos.
- Navegue e interaja somente com demos locais em memória ou mocks comprovados; nunca envie formulários que persistam dados reais.
- Não altere produto, documentação, fixtures, Supabase, banco, produção ou configuração. Não comente no GitHub, faça commit/push, merge, auto-merge ou deploy.
- Retorne evidências pela ferramenta. Se precisar salvar screenshots/relatório, peça ao Builder para fazê-lo fora dos arquivos de produto.
- Sem navegador, use screenshots identificadas e declare ausência de teste interativo. Sem acesso a imagens, declare revisão somente estática. Não invente console, network, estados, testes ou fidelidade ao Figma.

## Relatório esperado

Informe PR/HEAD, URL, viewports e cenários efetivamente inspecionados. Para cada achado: severidade P0/P1/P2/P3, problema e impacto, screenshot ou evidência verificável, reprodução, arquivo/componente/linha quando identificáveis, recomendação objetiva e benefício esperado. Inclua tabela Antes/Depois/Benefício, aspectos que resistiram aos testes e limites reais.

Priorize bloqueios operacionais e informação essencial inacessível. Não confunda preferência estética com defeito; não recomende animação decorativa. Sem achados, limite a conclusão aos cenários inspecionados. O Critic não aprova automaticamente nem corrige seus achados.

Figma é referência quando houver frame aprovado. Sem frame, use o design system e o raio atuais. Emulação mobile não comprova comportamento em aparelho físico, teclado virtual, safe areas ou gestos.

O teste independente da PR #10 e a evidência de descoberta estão registrados em [visual-critic-validation.md](visual-critic-validation.md).
