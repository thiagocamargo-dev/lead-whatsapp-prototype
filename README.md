# Lead → WhatsApp Instantâneo (protótipo)

Protótipo local, sem dependências externas, que qualifica leads automaticamente e envia
uma mensagem de boas-vindas via WhatsApp em menos de 2 minutos após a qualificação — com
retry, proteção contra duplicidade e recuperação automática se a API cair.

```bash
npm install
npm run seed     # popula data/leads.db com 40 leads determinísticos
npm run dev       # sobe API + worker em http://localhost:3000 (dashboard em "/")
npm run test       # suíte de testes automatizados
npm run demo       # roda o fluxo completo ponta a ponta e imprime o resultado
```

**Stack**: Node.js + TypeScript + Express + `node:sqlite` (nativo do Node ≥ 22.5, evita
dependência de compilação nativa como `better-sqlite3`) + `uuid` + Vitest.

---

## Arquitetura

```
Formulário (POST /leads)  ──► Banco (SQLite)  ◄──►  Worker (polling a cada 5s)
                                                            │
                                          qualifica → envia (retry) → checa SLA
                                                            │
                                                            ▼
                                              API falsa do WhatsApp
                                       (~20% falha, offline sob demanda,
                                        dedupe por idempotency_key)
```

| Peça | Arquivo |
|---|---|
| Banco + 2ª camada de idempotência | [src/database/database.ts](src/database/database.ts) |
| Regra de qualificação | [src/services/qualification.service.ts](src/services/qualification.service.ts) |
| Orquestração (qualificar → enviar → SLA) | [src/services/lead-processor.service.ts](src/services/lead-processor.service.ts) |
| Client HTTP do WhatsApp | [src/services/whatsapp.service.ts](src/services/whatsapp.service.ts) |
| Worker de polling | [src/workers/lead-worker.ts](src/workers/lead-worker.ts) |
| API falsa do WhatsApp | [src/api/fake-whatsapp.ts](src/api/fake-whatsapp.ts) |
| Dashboard | [public/index.html](public/index.html) |

---

## 1. Polling ou evento?

**Escolhi polling**, a cada 5s (`POLL_INTERVAL_MS`, configurável).

- **A favor**: com um SLA de 120s, uma latência de detecção de até 5s é desprezível — sobra
  folga mesmo somando retries. Além disso, polling se **auto-recupera sozinho** de qualquer
  falha (crash do processo, API fora do ar) porque cada ciclo relê o estado real do banco,
  nunca depende de memória do processo.
- **Contra**: não é instantâneo, e revarre o banco mesmo sem novidade.
- **Evento** (fila/pub-sub) daria latência quase zero, mas exige infraestrutura extra
  (broker/CDC) e, se o evento se perder, o lead pode nunca ser processado — a menos que
  também exista um polling de segurança por trás. Em produção, a combinação ideal é
  **evento para latência + polling como rede de segurança**; aqui, com folga de sobra pro
  SLA, o polling sozinho já resolve.

---

## 2. Critério de qualificação

```
qualificado  ⇔  score >= 70  E  (cargo decisório  OU  faturamento >= 1M  OU  >= 51 funcionários)
```

Não usei só `score >= X`: score mede engajamento, não capacidade de compra. Um estagiário
engajado (score alto) não decide nem paga; um CEO pouco engajado (score médio) decide e
paga. Por isso exijo score mínimo **e** um sinal independente de poder de compra.

Cargos decisórios: CEO, Founder, Co-Founder, Owner, Diretor(a), VP, Head, Gerente, Sócio(a).

### Resultado real sobre os 40 leads gerados (`npm run seed`)

```
Total: 40  →  4 em draft (fora do funil)  +  36 avaliados
Qualificados: 16
Rejeitados:   20
```

| Faixa de score | Qualificados | Rejeitados |
|---|---|---|
| < 50 (10 leads) | 0 | 10 |
| 50–69 (10 leads) | 0 | 10 |
| 70–84 (10 leads) | 8 | 2 |
| ≥ 85 (10 leads) | 8 | 2 |

Exemplos reais: **Marcelo Andrade** (CEO, score 78, faturamento 1M-5M) qualifica com 3
sinais. **Amanda Cavalcante** (CEO, score 68) é rejeitada por só 2 pontos de score — um
falso negativo conhecido da regra. **Leonardo Freitas** (Founder, score 71, empresa
minúscula) qualifica só pelo cargo — um falso positivo possível (startup em estágio muito
inicial). Esses casos foram incluídos de propósito no seed para deixar a discussão concreta.

---

## 3. Como evita duplicidade

Chave de idempotência determinística: `whatsapp:lead:<lead_id>:boas_vindas_lead`. Duas
camadas independentes:

1. **API falsa do WhatsApp** ([fake-whatsapp.ts](src/api/fake-whatsapp.ts)) guarda as
   chaves já processadas num mapa. Se a mesma chave chegar de novo (ex.: cliente reenviou
   após timeout), ela devolve `{ success: true, duplicate: true, message_id: <o mesmo> }`
   em vez de gerar uma mensagem nova. *(Isso exigiu adicionar um campo opcional
   `idempotency_key` no payload, além de `para`/`template_id`/`variaveis` — é a única
   diferença em relação ao formato mínimo pedido.)*
2. **`UNIQUE(lead_id, template_id)` no banco** — mesmo que a camada 1 falhasse por um bug,
   o banco fisicamente impede uma segunda linha em `messages` para o mesmo lead. Nunca
   confio só na aplicação: essa é a garantia de última linha, no nível de dado.

O `npm run demo` prova isso na prática: reprocessa deliberadamente um lead já enviado e
mostra a contagem de mensagens antes/depois — continua em 1.

---

## 4. E se a API ficar fora do ar por 10 minutos?

**Nenhum lead é perdido.** O estado (`whatsapp_status='pending'|'retrying'`,
`tentativas_envio`) vive só no banco em disco, nunca em memória do processo — se o processo
inteiro reiniciar no meio da indisponibilidade, o próximo `npm run dev` retoma de onde
parou. A cada ciclo do worker (5s), ele consulta os leads pendentes e tenta de novo
sozinho, sem intervenção manual, até a API voltar.

O `npm run demo` simula esse cenário com tempo comprimido (não trava o terminal por 10 min
reais): ativa a API "offline", deixa o lead esgotar as tentativas locais, e retroage o
timestamp de qualificação em ~10 min antes de reativar a API — mostrando tanto a
recuperação automática quanto a violação de SLA resultante (o lead é enviado, mas fora do
prazo de 120s — o que é o comportamento esperado, não um bug).

---

## Retry e SLA (resumo técnico)

- **Retry**: backoff 0s → 2s → 5s → 10s por ciclo (`RETRY_DELAYS_MS`). Se esgotar, o lead
  volta pro banco como `retrying` e o próximo ciclo do worker retoma. Após
  `MAX_TOTAL_ATTEMPTS` (8) tentativas acumuladas, vira dead-letter (`status='erro'`, com
  `ultimo_erro` preenchido) — não desaparece, fica consultável via `GET /leads/:id`.
- **SLA**: cronômetro começa em `qualificado_em` (nunca em `criado_em`). PASS se
  `enviado_em - qualificado_em < 120s`; senão FAIL. Um lead qualificado que passou de 120s
  sem enviar gera um log `SLA_VIOLATION` automaticamente a cada ciclo do worker — é assim
  que se descobre, olhando o log (ou `GET /metrics`), se algum lead ficou pra trás.

---

## Testes e evidência real

```bash
npm run test   # 27 testes: dataset gerado, qualificação, retry, idempotência (2 camadas), e2e
npm run demo   # fluxo real de ponta a ponta
```

Dois destaques que provam, de forma automatizada (não só "de olho" no demo), os pontos mais
sensíveis do desafio:

- **[tests/seed-data.test.ts](tests/seed-data.test.ts)** — roda a regra de qualificação
  contra os 40 leads *de verdade* gerados pelo seed (não contra exemplos avulsos) e confirma:
  nenhum lead com score < 50 qualifica; leads júnior/estagiário com score alto (Felipe
  Araújo, score 89; Natália Barros, score 91) continuam **não** qualificando; decisores com
  score alto e empresa relevante qualificam; e a proporção final bate com os 16
  qualificados / 20 rejeitados documentados acima.
- **[tests/e2e.test.ts](tests/e2e.test.ts) — "sobrevive a falhas reais (HTTP 500)"** — não
  usa mocks: força 2 respostas `500` de verdade pela API falsa (via HTTP real, o mesmo
  contrato de erro que a falha aleatória de ~20% produz), deixa a 3ª tentativa suceder de
  verdade, e confirma que `messages` tem exatamente **1** linha para o lead — prova direta
  de que falhar e tentar de novo nunca duplica mensagem.

Trecho real de uma execução do `npm run demo` (não é log fabricado — os timestamps e IDs
são de uma corrida real):

```
[20:25:38] LEAD_QUALIFIED  lead_id=e543d2cf...  score=92  cargo=CEO
[20:25:38] WHATSAPP_ATTEMPT lead_id=e543d2cf...  attempt=1
[20:25:38] WHATSAPP_ERROR   lead_id=e543d2cf...  error=SIMULATED_WHATSAPP_FAILURE
[20:25:40] WHATSAPP_ATTEMPT lead_id=e543d2cf...  attempt=2
[20:25:40] WHATSAPP_SENT    lead_id=e543d2cf...  message_id=msg_18283d6b...  elapsed=2.0s  sla=PASS
```

Lead qualificado às 20:25:38, mensagem enviada às 20:25:40 → **2.0 segundos**, muito abaixo
do limite de 120s → **SLA: PASS**.

---

## Observabilidade

Endpoints: `GET /health`, `GET /metrics`, `GET /leads`. Logs estruturados em
`logs/application.log` (evento + campos), com telefone sempre mascarado
(`551198****0001`). Eventos: `LEAD_CREATED`, `LEAD_QUALIFIED`, `LEAD_REJECTED`,
`WHATSAPP_ATTEMPT/ERROR/SENT`, `WHATSAPP_PENDING_RETRY`, `WHATSAPP_DEAD_LETTER`,
`DUPLICATE_PREVENTED`, `SLA_VIOLATION`.

## Referência da regra simulada

A API falsa reproduz a regra real da Meta WhatsApp Business Platform: fora da janela de
atendimento, **toda conversa business-iniciada só pode começar com um template
pré-aprovado** — texto livre é rejeitado (erro real equivalente: **131047 – "Re-engagement
message"**). Fontes: [Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages),
[WhatsApp 24-Hour Rule](https://www.enchant.com/whatsapp-business-platform-24-hour-rule).

## Limitações (o que mudaria em produção)

- Polling em vez de evento (ver seção 1) — produção adicionaria fila/CDC como otimização,
  mantendo o polling como rede de segurança.
- `node:sqlite` de arquivo único não escala para múltiplas instâncias concorrentes —
  produção usaria Postgres/MySQL com a mesma estratégia de `UNIQUE constraint`.
- Sem autenticação nas rotas (as rotas `/fake-whatsapp/admin/*` existem só para permitir
  testes/demo determinísticos — não existiriam numa API real de provedor).
- Regra de qualificação é estática; produção evoluiria pra pesos configuráveis ou scoring
  de ML, com humano revisando falsos positivos/negativos.
- Worker e API rodam no mesmo processo; produção separaria em serviços independentes.
