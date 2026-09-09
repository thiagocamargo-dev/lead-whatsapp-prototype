# Lead → WhatsApp Instantâneo (protótipo)

Protótipo completo, local e sem dependências externas, que simula: criação de lead →
qualificação automática → envio de WhatsApp em menos de 2 minutos → retry → idempotência →
recuperação de falhas → observabilidade por logs e métricas.

```bash
npm install
npm run seed     # popula data/leads.db com 40 leads determinísticos
npm run dev       # sobe a API + worker de polling em http://localhost:3000
npm run test       # suíte de testes automatizados (unit + integração)
npm run demo       # roda o fluxo completo ponta a ponta e imprime o resultado no terminal
```

---

## 1. Visão geral

Um formulário cria um **lead** (nome, telefone, empresa, cargo, faturamento, nº de
funcionários, score). Um **worker** varre o banco periodicamente, aplica a **regra de
qualificação** e, assim que um lead é qualificado, dispara o envio de uma mensagem de
boas-vindas via WhatsApp — com **retry com backoff**, **duas camadas de proteção contra
duplicidade**, **recuperação automática após falhas/indisponibilidade da API** e
**monitoramento de SLA (< 120s entre qualificação e envio)**. Tudo roda num único processo
Node, com SQLite embutido (`node:sqlite`, nativo do Node ≥ 22.5) como "banco falso" e uma
API HTTP local que simula a WhatsApp Business Platform (incluindo falhas aleatórias e
indisponibilidade sob demanda).

### Por que essa stack

- **TypeScript + Node.js + Express**, como sugerido no desafio.
- **`node:sqlite`** (módulo nativo do Node, sem flags a partir do Node 22.11/24) em vez de
  `better-sqlite3`: elimina a dependência de compilação nativa (node-gyp/Visual Studio Build
  Tools), o que é especialmente relevante em ambiente Windows sem toolchain de C++
  pré-instalado. Zero dependências nativas externas — só o runtime do Node.
- **`fetch` nativo** (Node ≥ 18) para o client HTTP do `whatsapp.service` — sem axios.
- **`uuid`** para os IDs de lead/mensagem, como sugerido no desafio.
- **Vitest** para os testes (rápido, TS nativo, API compatível com Jest).

---

## 2. Arquitetura

```
Formulário (POST /leads)
        │
        ▼
   ┌─────────┐        polling a cada 5s        ┌───────────────┐
   │ Database │◄───────────────────────────────►│  LeadWorker    │
   │ (SQLite) │                                  │  (setInterval) │
   └─────────┘                                  └───────┬────────┘
        ▲                                                │ chama
        │                                                ▼
        │                                     ┌───────────────────────┐
        │        grava qualificado_em,        │ LeadProcessorService  │
        └────────────────────────────────────►│  - sweepQualification │
                                               │  - sweepWhatsappSend  │
                                               │  - sweepSlaViolations │
                                               └───────────┬───────────┘
                                                            │ retry c/ backoff
                                                            ▼
                                               ┌───────────────────────┐
                                               │   WhatsappService     │
                                               │ (HTTP client + timeout)│
                                               └───────────┬───────────┘
                                                            │ POST /fake-whatsapp/send
                                                            ▼
                                               ┌───────────────────────┐
                                               │  Fake WhatsApp API    │
                                               │ (~20% falha, offline  │
                                               │  sob demanda, dedupe  │
                                               │  por idempotency_key) │
                                               └───────────────────────┘
```

Camadas, com responsabilidade única cada:

| Camada | Arquivo | Responsabilidade |
|---|---|---|
| Banco | [src/database/database.ts](src/database/database.ts) | Schema, `LeadRepository` (CRUD + queries de pendências), 2ª camada de idempotência |
| Modelo | [src/models/lead.ts](src/models/lead.ts) | Tipos e enums do domínio |
| Regra de negócio | [src/services/qualification.service.ts](src/services/qualification.service.ts) | Decide se um lead é qualificado |
| Orquestração | [src/services/lead-processor.service.ts](src/services/lead-processor.service.ts) | Qualificação → envio (retry) → SLA |
| Integração | [src/services/whatsapp.service.ts](src/services/whatsapp.service.ts) | Client HTTP para a API do WhatsApp, com timeout e classificação de erro |
| Worker | [src/workers/lead-worker.ts](src/workers/lead-worker.ts) | Polling periódico |
| API falsa | [src/api/fake-whatsapp.ts](src/api/fake-whatsapp.ts) | Simula a WhatsApp Business Platform |
| API principal | [src/api/leads.ts](src/api/leads.ts), [src/index.ts](src/index.ts) | Formulário, `/health`, `/metrics` |
| Observabilidade | [src/utils/logger.ts](src/utils/logger.ts) | Logs estruturados, mascaramento de telefone |

---

## 3. Como executar

```bash
npm install

# Popular o banco principal com os 40 leads (apaga data/leads.db anterior)
npm run seed

# Subir a API + worker de polling (porta 3000, configurável via .env)
npm run dev

# Testes
npm run test          # toda a suíte (unit + integração)
npm run test:e2e       # só o pipeline ponta a ponta
npm run typecheck      # tsc --noEmit sobre src/ + tests/

# Demo ponta a ponta (o comando mais importante deste desafio)
npm run demo
```

`npm run dev` expõe:

- `POST /leads` — cria um lead (formulário)
- `GET /leads`, `GET /leads/:id`
- `GET /health`
- `GET /metrics`
- `POST /fake-whatsapp/send` — API falsa do WhatsApp
- `POST /fake-whatsapp/admin/*` — controles de teste (offline, falha forçada, reset)

Copie `.env.example` para `.env` para customizar porta, intervalo de polling, taxa de falha
simulada, backoff, SLA etc. (todos os valores têm defaults sensatos).

---

## 4. Critério de qualificação

```
qualificado  ⇔  score >= 70  E  (cargo é decisório  OU  faturamento >= 1M  OU  nº funcionários >= 51)
```

Implementado em [qualification.service.ts](src/services/qualification.service.ts).

### Por que não `score >= X` sozinho

Score mede *engajamento/fit comportamental* (abriu e-mails, visitou páginas de preço,
preencheu formulário completo) — não mede **capacidade de compra**. Um estagiário
extremamente engajado (score alto) não decide nem paga por uma compra B2B; um CEO com
score mediano pode simplesmente não ter respondido a poucos gatilhos de engajamento, mas
tem 100% do poder de decisão e orçamento. Por isso a regra exige **score mínimo E um sinal
independente de capacidade de compra** (cargo decisório, faturamento ou tamanho da empresa).
O score sozinho gera falsos positivos (júnior engajado) e falsos negativos (decisor pouco
engajado); a combinação reduz — mas não elimina — os dois.

Cargos considerados decisórios (comparação normalizada: minúsculas, sem acento, substring):
`CEO, Founder, Co-Founder, Owner, Diretor(a), VP, Head, Gerente, Sócio(a)`.

Faturamento qualifica a partir de `1M-5M` (índice ≥ 2 em
`['<500K','500K-1M','1M-5M','5M-20M','20M+']`). Nº de funcionários qualifica a partir de
`51-200` (índice ≥ 2 em `['1-10','11-50','51-200','201-500','500+']`).

### Resultado real sobre os 40 leads gerados (`npm run seed`)

```
Total: 40
Draft (fora do funil, aguardando conclusão do formulário): 4
Avaliados (status=new): 36
  Qualificados: 16
  Rejeitados: 20
```

Distribuição por faixa de score (10 leads cada, como pedido no desafio):

| Faixa de score | Qualificados | Rejeitados | Observação |
|---|---|---|---|
| < 50 (10 leads) | 0 | 10 | Score sozinho já reprova, independente de cargo/empresa |
| 50–69 (10 leads) | 0 | 10 | Idem — inclui CEO (score 68) e Founder (score 55) rejeitados só por score |
| 70–84 (10 leads) | 8 | 2 | Depende do sinal adicional |
| ≥ 85 (10 leads) | 8 | 2 | Idem |

### Exemplos reais (gerados por [seed-data.ts](src/database/seed-data.ts))

**Qualificados:**
- Marcelo Andrade — CEO, score 78, Andrade Indústria, faturamento 1M-5M, 51-200 funcionários (3 sinais).
- Débora Sales — Coordenadora de Marketing (**não** é cargo decisório), score 82, faturamento 20M+, 500+ funcionários — qualifica só pelo porte da empresa, mostrando que o cargo não é o único caminho.
- Leonardo Freitas — Founder, score 71, empresa de 1-10 funcionários e faturamento < 500K — qualifica só pelo cargo (ver falso positivo abaixo).

**Rejeitados:**
- Lucas Tavares — Estagiário, score 18. Reprovado só por score, como esperado.
- Amanda Cavalcante — CEO, score 68. Cargo decisório, mas **1 ponto abaixo** do mínimo.
- Tatiane Farias — Analista de Produto, score 83, empresa de 1-10 funcionários, faturamento < 500K. Score alto, mas nenhum sinal de capacidade de compra.

### Falsos positivos (a regra qualifica, mas talvez não devesse)

- **Founder de empresa muito pequena** (ex.: Leonardo Freitas, score 71, empresa <500K
  faturamento/1-10 funcionários): o cargo "Founder" sozinho já qualifica, mas pode ser uma
  startup em estágio inicial sem orçamento real para comprar. Mitigação possível em produção:
  pesar o cargo por faixa de faturamento/funcionários em vez de tratá-lo como sinal binário.
- **Autodeclaração de cargo**: como não há verificação (ex.: LinkedIn, e-mail corporativo), um
  lead pode se autodeclarar "Diretor" sem ser. Mitigação: enriquecimento de dados externo.

### Falsos negativos (a regra rejeita, mas talvez devesse qualificar)

- **Decisor com score abaixo do mínimo** (ex.: Amanda Cavalcante, CEO, score 68; Eduardo
  Salles, VP Comercial, score 50, empresa de 51-200 funcionários e faturamento 1M-5M — dois
  sinais de compra, mas reprovado só por 20 pontos de score). O score mínimo de 70 é uma
  linha dura; um decisor comprovado com score levemente abaixo é descartado.
- **Analista sênior de alta qualidade em empresa pequena** (ex.: Tatiane Farias, score 83,
  sem nenhum sinal de porte/cargo): pode ser um usuário técnico influente numa compra
  bottom-up (comum em produtos self-service/PLG), mas a regra atual assume um modelo de
  venda B2B tradicional (decisor único).

Esses casos de borda foram incluídos **de propósito** no seed para tornar essa discussão
concreta — não são acidentes dos dados gerados.

---

## 5. Detecção de novos leads: Polling vs. Evento

**Escolha: polling**, a cada `POLL_INTERVAL_MS=5000` (configurável). Ver
[lead-worker.ts](src/workers/lead-worker.ts).

| | Vantagens | Desvantagens |
|---|---|---|
| **Polling** (escolhido) | Simples, sem infraestrutura extra; **auto-recupera sozinho** de qualquer falha (crash do processo, API fora do ar) porque cada ciclo relê o estado real do banco; idempotente por natureza — reprocessar o mesmo lead pendente não tem efeito colateral além de mais uma tentativa; fácil de testar e demonstrar deterministicamente | Latência de detecção limitada pelo intervalo (pior caso ~5s); desperdiça algum trabalho revarrendo o banco mesmo sem novidades |
| Evento (fila/pub-sub, trigger de banco) | Latência ~instantânea; menos leitura redundante no banco | Precisa de infraestrutura adicional (fila, broker, ou CDC/trigger de banco) que este protótipo deveria evitar; se o evento se perde (broker fora do ar, listener não estava rodando), o lead pode nunca ser processado *a menos que* haja também um mecanismo de fallback — ou seja, na prática, sistemas de produção usam evento **como otimização de latência, mas mantêm polling/varredura periódica como rede de segurança** |

**Impacto no SLA de 2 minutos**: com um intervalo de 5s, o pior caso de latência de detecção
(~5s) é **desprezível** frente ao orçamento de 120s — sobra folga de sobra mesmo somando
tentativas de retry. Por isso polling puro já é suficiente para cumprir o requisito sem
complexidade adicional.

**Em produção**, a abordagem recomendada seria híbrida: evento (ex.: mensagem publicada
after commit numa fila — SQS/RabbitMQ/Kafka, ou CDC via Debezium sobre o banco) para
latência sub-segundo, **mais** um job de varredura periódica (a cada 1-5 min) como
*safety net* para capturar qualquer evento perdido — exatamente o papel que o polling já
cumpre sozinho neste protótipo. É assim que se evita perder eventos: nunca confiar
unicamente em "at-least-once" de mensageria sem uma fonte de verdade auditável (o próprio
banco) para reconciliar.

---

## 6. Idempotência — duas camadas independentes

**Chave de idempotência**: `whatsapp:lead:<lead_id>:boas_vindas_lead` — determinística
(sempre a mesma para o mesmo lead+template), calculada em
[whatsapp.service.ts](src/services/whatsapp.service.ts) (`buildIdempotencyKey`).

### Camada 1 — API falsa do WhatsApp ([fake-whatsapp.ts](src/api/fake-whatsapp.ts))

A API mantém um `Map<idempotency_key, message_id>` das chaves já processadas. Se a mesma
chave chegar de novo (por causa de um retry após timeout, por exemplo), ela **não** gera uma
nova mensagem — devolve `200 { success: true, duplicate: true, message_id: <o mesmo de antes> }`.
Isso simula como um provedor real de mensageria deveria se comportar (a Meta também
recomenda idempotency keys em cenários de reenvio).

### Camada 2 — UNIQUE constraint no banco ([database.ts](src/database/database.ts))

```sql
CREATE TABLE messages (
  ...
  UNIQUE(lead_id, template_id),
  ...
);
```

Toda mensagem "enviada com sucesso" é gravada em `messages` via `recordMessageOnce()`. Se a
constraint rejeitar a inserção (porque já existe uma linha para aquele `lead_id` +
`template_id`), o método retorna `false` **sem lançar exceção** e o processador registra
`DUPLICATE_PREVENTED` no log — mas o lead ainda é marcado como `enviado` normalmente.

### Por que duas camadas, e não uma só

> **Nunca confie só na aplicação.**

A camada 1 (API) protege contra o cenário mais comum: o cliente (nosso processador) enviou a
requisição, o provedor processou com sucesso, mas a resposta se perdeu (timeout de rede) —
o cliente, sem saber se funcionou, tenta de novo. A camada 1 garante que o *provedor* nunca
duplica o envio real.

A camada 2 (constraint no banco) protege contra bugs **do nosso próprio lado**: um race
condition entre dois workers concorrentes, um bug de orquestração que chama `sendForLead`
duas vezes para o mesmo lead, ou mesmo um teste manual de duplicidade (como o que o `npm run
demo` faz deliberadamente). Ela é a garantia de última linha, no nível de dado, que nenhuma
lógica de aplicação — por mais correta que pareça — pode acidentalmente contornar. É o
princípio de "defesa em profundidade": cada camada cobre uma classe diferente de falha.

O `npm run demo` demonstra isso explicitamente: reprocessa deliberadamente um lead **já
enviado** e mostra, com contagem real de linhas em `messages` antes/depois, que o total
continua em 1.

---

## 7. Retry

Estratégia: **backoff progressivo** com 4 tentativas locais por ciclo, configurável via
`RETRY_DELAYS_MS` (default `0,2000,5000,10000` — imediato, 2s, 5s, 10s), implementado em
[retry.ts](src/utils/retry.ts) e orquestrado em
[lead-processor.service.ts](src/services/lead-processor.service.ts).

- Cada tentativa é logada (`WHATSAPP_ATTEMPT`) e persistida (`tentativas_envio++`) **antes**
  da chamada — nunca depois, para nunca perder a contagem se o processo cair no meio.
- Erros 5xx/timeout/offline são `retryable`; erros 4xx (payload inválido) não são — não faz
  sentido re-tentar um payload que sempre vai ser rejeitado.
- Se as 4 tentativas locais se esgotarem, o lead **não é descartado**: volta para
  `whatsapp_status='retrying'` e é automaticamente pego pelo próximo ciclo do worker (é assim
  que o sistema sobrevive a uma indisponibilidade prolongada da API — ver seção 8).
- Um contador **separado e cumulativo**, `MAX_TOTAL_ATTEMPTS` (default 8, contando entre
  ciclos), decide quando desistir de vez (ver seção 9 — dead-letter).

---

## 8. API fora do ar

**O que acontece se a API do WhatsApp ficar fora do ar por 10 minutos?**

Nada é perdido. O lead permanece no banco com `whatsapp_status IN ('pending', 'retrying')` —
esses campos **nunca dependem de memória do processo**, só do SQLite em disco. A cada ciclo
de polling (a cada 5s em produção), o worker consulta
`listPendingWhatsappSend()` e tenta de novo. Se o processo Node inteiro reiniciar no meio da
indisponibilidade, o próximo `npm run dev` retoma exatamente de onde parou, porque o estado
inteiro vive no banco, não no processo.

O `npm run demo` simula esse cenário de forma **determinística e com tempo comprimido**: em
vez de travar o terminal por 10 minutos reais, ele ativa a flag `offline` da API falsa,
deixa o lead esgotar as tentativas locais (ficando `retrying`), e retroage o timestamp
`qualificado_em` do lead em ~10 minutos antes de reativar a API — permitindo demonstrar
tanto a **recuperação** quanto a **violação de SLA resultante** sem exigir uma espera real.
Isso é documentado explicitamente na saída do demo, para transparência.

Em produção, `MAX_TOTAL_ATTEMPTS` (default 8) limita quantos ciclos um lead fica em retry
antes de virar dead-letter (seção 9) — com polling de 5s e backoff de até 10s por tentativa,
isso cobre bem mais que 10 minutos de indisponibilidade contínua.

---

## 9. Dead-letter (falhas definitivas)

Quando `tentativas_envio >= MAX_TOTAL_ATTEMPTS`, o lead é marcado
`status='erro'`, `whatsapp_status='erro'`, com `ultimo_erro` preenchido — e um log
`WHATSAPP_DEAD_LETTER` é emitido (fácil de localizar/alertar em produção via grep de log ou
por query `WHERE status = 'erro'`). O lead não desaparece: continua consultável via
`GET /leads/:id`, aparece em `messages_failed` no `/metrics`, e carrega o histórico completo
de tentativas e do último erro para investigação manual.

---

## 10. SLA (< 120 segundos)

O relógio do SLA começa em **`qualificado_em`**, nunca em `criado_em` — um lead pode ficar
dias como `new` antes de se tornar qualificado; o que importa é o tempo entre "virou
qualificado" e "mensagem enviada".

- **PASS**: `enviado_em - qualificado_em < 120s`.
- **FAIL**: mensagem foi enviada, mas `>= 120s` depois da qualificação.
- **MISSED / SLA_VIOLATION**: ainda não foi enviada e já se passaram `>= 120s` desde a
  qualificação. Detectado por `sweepSlaViolations()`
  ([lead-processor.service.ts](src/services/lead-processor.service.ts)), chamado a cada
  ciclo do worker, que roda a query:

  ```sql
  SELECT * FROM leads
  WHERE status IN ('qualificado','processando','erro')
    AND whatsapp_status != 'enviado'
    AND qualificado_em <= (agora - 120s)
    AND sla_violation_logged_em IS NULL
  ```

  e emite um log `SLA_VIOLATION` (uma única vez por lead, graças a
  `sla_violation_logged_em`, evitando spam de log a cada ciclo).

Todo envio bem-sucedido já loga o veredito no próprio evento `WHATSAPP_SENT`
(`elapsed=Xs sla=PASS|FAIL`), então não é preciso cruzar logs manualmente para saber se um
envio específico cumpriu o SLA.

---

## 11. Observabilidade

Logs estruturados em blocos `evento` + `campo=valor` (ver
[logger.ts](src/utils/logger.ts)), simultaneamente no `stdout` e em `logs/application.log`
(ou `logs/demo.log` durante o demo). Eventos emitidos: `LEAD_CREATED`, `LEAD_QUALIFIED`,
`LEAD_REJECTED`, `WHATSAPP_ATTEMPT`, `WHATSAPP_ERROR`, `WHATSAPP_SENT`,
`WHATSAPP_PENDING_RETRY`, `WHATSAPP_DEAD_LETTER`, `DUPLICATE_PREVENTED`, `SLA_VIOLATION`.

Telefones **nunca** aparecem completos em log — `maskPhone()` mostra só os 6 primeiros e 4
últimos dígitos (`551198****0001`).

**Como encontrar leads que não receberam a mensagem em até 2 minutos:**

1. Em tempo real: acompanhar o log por `SLA_VIOLATION` (o worker já varre e loga isso
   automaticamente a cada ciclo).
2. Sob demanda: `GET /metrics` → campo `sla_fail` conta tanto envios tardios quanto leads
   ainda pendentes que já estouraram o SLA.
3. Via banco: `SELECT * FROM leads WHERE qualificado_em IS NOT NULL AND whatsapp_status !=
   'enviado' AND qualificado_em <= datetime('now','-120 seconds')`.

---

## 12. API falsa do WhatsApp — referência da regra simulada

A rota `POST /fake-whatsapp/send` ([fake-whatsapp.ts](src/api/fake-whatsapp.ts)) simula um
subconjunto real das regras da **Meta WhatsApp Business Platform** (Cloud API), pesquisado
na documentação oficial da Meta e em material de referência de parceiros oficiais:

- **Toda conversa business-iniciada só pode começar com um template pré-aprovado pela
  Meta.** Fora da janela de atendimento de 24h (aberta quando o usuário manda a primeira
  mensagem), mensagens de texto livre são rejeitadas — só templates aprovados são aceitos.
  É exatamente o erro que simulamos: `400 { "error": "A conversation must be initiated using
  an approved template." }`. A Cloud API real retorna esse cenário como o erro **131047 –
  "Re-engagement message"** quando não há resposta do cliente dentro de 24h.
- **Templates precisam de aprovação prévia da Meta** antes de poderem ser usados — nossa API
  falsa simula isso permitindo só um `template_id` "aprovado" (`boas_vindas_lead`) e
  rejeitando qualquer outro com o mesmo erro de template não aprovado.
- **Templates recebem variáveis nomeadas** (parâmetros) que são substituídas no corpo
  aprovado — simulado pelo campo obrigatório `variaveis`.
- **Falhas 5xx e indisponibilidade** são cenários reais de qualquer API HTTP em produção —
  simulados com uma taxa de falha configurável (`WHATSAPP_FAILURE_RATE`, default 20%) e uma
  flag de "offline" administrável via `/fake-whatsapp/admin/offline`.

Não há integração real com a Meta — é 100% simulado localmente, como pedido.

Fontes consultadas:
- [Meta for Developers — Service messages / send-messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages)
- [WhatsApp Business Platform 24 Hour Rule — Enchant](https://www.enchant.com/whatsapp-business-platform-24-hour-rule)
- [Troubleshooting WhatsApp API Error 131047: Re-Engagement Message — Heltar](https://www.heltar.com/blogs/troubleshooting-whatsapp-api-error-131047-re-engagement-message-required-cm5fctgfx000mkg77rgedcamx)

---

## 13. Segurança

- Nenhum secret no código; `.env` (git-ignorado) + `.env.example` documentando cada variável.
- Todas as queries usam **prepared statements parametrizados** (`db.prepare(...).run(...)`) —
  zero concatenação de string em SQL, elimina SQL injection por construção.
- Validação de payload em toda rota de escrita (`/leads`, `/fake-whatsapp/send`): campos
  obrigatórios, enums fechados (faturamento/funcionários), telefone validado por regex
  (`isValidPhone`).
- Telefones mascarados em log (`maskPhone`); nenhum dado sensível completo é persistido em
  log.
- Erros da API falsa nunca vazam stack trace — só uma mensagem de erro curta e um código
  HTTP apropriado.
- Chamadas HTTP entre serviços (`whatsapp.service` → API falsa) têm **timeout explícito**
  (`AbortController`, default 5s) para nunca travar o worker indefinidamente.
- `node:sqlite` não expõe binário nativo de terceiros (menor superfície de supply-chain
  comparado a bindings nativos como `better-sqlite3`).

---

## 14. Testes automatizados

```bash
npm run test
```

| Arquivo | Cobre |
|---|---|
| [tests/qualification.test.ts](tests/qualification.test.ts) | Regra de qualificação (CEO+score alto qualifica, estagiário+score baixo não; casos de borda de score alto sem sinal adicional e cargo decisório com score baixo) |
| [tests/retry.test.ts](tests/retry.test.ts) | Backoff genérico: sequência 500/500/200 sucede na 3ª tentativa; desiste após esgotar tentativas; respeita `isRetryable`; respeita os delays configurados |
| [tests/idempotency.test.ts](tests/idempotency.test.ts) | Rejeição de texto livre e de template não aprovado; mesma `idempotency_key` duas vezes gera 1 só mensagem (camada 1, via HTTP real); `UNIQUE(lead_id, template_id)` impede segunda linha (camada 2, direto no banco) |
| [tests/e2e.test.ts](tests/e2e.test.ts) | Pipeline completo: qualifica → envia → SLA calculado a partir de `qualificado_em`; reprocessamento não duplica; API offline → lead fica `retrying` → volta e recupera sozinho; violação de SLA detectada uma única vez |

Resultado real (`npm run test`):

```
✓ tests/qualification.test.ts (6 tests)
✓ tests/retry.test.ts (4 tests)
✓ tests/idempotency.test.ts (4 tests)
✓ tests/e2e.test.ts (5 tests)

Test Files  4 passed (4)
     Tests  19 passed (19)
```

---

## 15. `npm run demo`

Roda o fluxo real (nada de `console.log` fingindo resultado): popula os 40 leads, qualifica
de verdade, cria um lead de teste e o envia via HTTP real para a API falsa (com 1 falha
forçada para exibir o retry de forma determinística — a falha aleatória de ~20% já é
exercitada organicamente no restante do lote), demonstra a prevenção de duplicidade
reprocessando o mesmo lead, processa o resto do lote qualificado (com a taxa de falha real),
simula a API ficando offline por ~10 minutos (tempo comprimido) e sua recuperação, e termina
imprimindo `/metrics` reais e um resumo PASS/FAIL de cada cenário.

Exemplo de execução real (trecho):

```
========================================
WHATSAPP LEAD QUALIFICATION DEMO
========================================

[19:20:55] Gerando 40 leads...
[19:20:55] Banco populado.

Total: 40
Qualificados: 16
Não qualificados: 24
  (inclui 4 leads em "draft", fora do funil até o formulário ser concluído)

----------------------------------------
Criando lead de teste...
Lead: Nome: João Silva | Empresa: Acme Corporation | Cargo: CEO | Score: 92
----------------------------------------

[19:20:55] WHATSAPP_ATTEMPT lead_id=... attempt=1
[19:20:55] WHATSAPP_ERROR   lead_id=... error=SIMULATED_WHATSAPP_FAILURE
[19:20:57] WHATSAPP_ATTEMPT lead_id=... attempt=2
...
[19:21:02] WHATSAPP_SENT    lead_id=... message_id=msg_b81a5db1... elapsed=7.1s sla=PASS

========================================
RESULTADO
========================================
Lead: PASS
WhatsApp: ENVIADO
Duplicidade: NÃO
SLA: PASS

========================================
TESTE DE DUPLICIDADE
========================================
Mensagens registradas antes do reprocessamento: 1
Mensagens registradas depois do reprocessamento: 1
DUPLICATE PREVENTED: SIM

========================================
TESTE DE API OFFLINE
========================================
[19:20:23] API WhatsApp: OFFLINE
... 4 tentativas locais, todas ERROR: API_UNAVAILABLE ...
whatsapp_status=retrying | tentativas_envio=4
Lead permanece pendente (não foi perdido).
[19:20:40] API WhatsApp: ONLINE
[19:20:40] Worker encontrou lead pendente
[19:20:40] WHATSAPP_SENT message_id=msg_86a3e8dc... elapsed=622.1s sla=FAIL

SLA: FAIL
Motivo: API ficou indisponível por ~10 minutos (tempo comprimido para fins de demo)

========================================
MÉTRICAS FINAIS (/metrics)
========================================
{
  "total_leads": 42, "qualified": 18, "rejected": 20,
  "messages_sent": 18, "messages_failed": 0, "messages_pending": 0,
  "sla_pass": 17, "sla_fail": 1, "average_delivery_seconds": 45.68
}

========================================
RESULTADO GERAL
========================================
Lote de 40 leads ........... PASS (qualificados=16, enviados=17, dead-letter=0)
Lead de teste (retry) ...... PASS
Idempotência ............... PASS
Recuperação após offline ... PASS (SLA desse caso: FAIL, conforme esperado)
```

---

## 16. Limitações do protótipo (o que mudaria em produção)

- **Polling em vez de evento** — em produção, adicionaria uma fila (SQS/RabbitMQ) ou CDC
  para latência sub-segundo, mantendo o polling como *safety net* (seção 5).
- **`node:sqlite` de arquivo único** — não escala para múltiplos processos/instâncias
  concorrentes (sem locking distribuído real). Produção usaria Postgres/MySQL gerenciado,
  com o mesmo padrão de `UNIQUE constraint` para idempotência.
- **API falsa em memória** — o `Map` de `idempotency_key` da API falsa não sobrevive a um
  restart do processo (a 2ª camada, no banco principal, sim). Um provedor real persiste isso
  do lado dele; nós simulamos só o suficiente para demonstrar o mecanismo.
- **Sem autenticação/autorização** nas rotas — em produção, todo endpoint (especialmente
  `/leads` e as rotas `/admin/*` da API falsa) precisaria de autenticação e RBAC.
  As rotas `/fake-whatsapp/admin/*` existem *apenas* para permitir que testes e o demo
  controlem cenários determinísticos — não existiriam numa API real de provedor.
  Endpoints de mutação relevantes fora do escopo do desafio (ex.: `POST /leads`) também não
  têm rate limiting.
- **Regra de qualificação estática** — em produção, evoluiria para um modelo com pesos
  configuráveis ou scoring de ML, e provavelmente teria um humano no loop revisando os
  falsos positivos/negativos descritos na seção 4.
- **Sem migrações de schema versionadas** — o schema é criado via `CREATE TABLE IF NOT
  EXISTS` na inicialização; produção usaria uma ferramenta de migração (Prisma
  Migrate/Knex/Flyway).
- **Um único processo** — worker e API HTTP rodam no mesmo processo Node. Produção
  separaria o worker em um processo/serviço dedicado (ou usaria um scheduler tipo
  cron/queue-consumer), permitindo escalar independentemente e evitar que uma sobrecarga na
  API afete o processamento de fila (ou vice-versa).
- **Retries em memória do processo** — o backoff local de cada tentativa usa
  `setTimeout`/`await` dentro do processo; se o processo cair no meio do backoff, o lead fica
  `retrying` no banco e é retomado no próximo ciclo — não há perda, mas também não há um
  scheduler de retry mais sofisticado (ex.: fila de atraso, exponential backoff com jitter).
