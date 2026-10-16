# Matriz de conformidade

| Requisito | Status | Implementação | Evidência |
|---|---|---|---|
| Bun, TypeScript strict, NestJS, PostgreSQL, MikroORM e SQS | Atendido | `package.json`, `compose.yaml`, `src/` | build e Docker |
| Dinheiro sem `number`/float | Atendido | `Money`, `NUMERIC(20,2)` | `money.test.ts`, constraints |
| Wallet, wager e ledger com invariantes encapsuladas | Atendido | `src/wallet/domain`, `src/wagering/domain` | testes unitários de domínio |
| Saldo nunca negativo e sem lost update | Atendido | check SQL + lock pessimista por wallet | concorrência 100 / 2×80 |
| Ledger imutável e um lançamento por efeito | Atendido | constraints, unicidade e trigger | `constraints.test.ts` |
| Idempotência persistente e conflito de payload | Atendido | identidades únicas + hash canônico | integração e 50 chamadas concorrentes |
| BET, WIN, LOSS, REFUND e ROLLBACK | Atendido | `wager-rules.ts` | unitários e integração |
| Referências fora de ordem | Atendido | estado/worker `PENDING_REFERENCE` | `pending-reference-worker.test.ts` |
| API, consultas, paginação e reconciliação | Atendido | controllers e use cases | E2E e integração |
| Inbox, redelivery, retry e DLQ | Atendido | consumer SQS + inbox persistente | testes com LocalStack |
| Transactional outbox e publishers concorrentes | Atendido | outbox + lease/`SKIP LOCKED` | `outbox-publisher.test.ts` |
| Shutdown gracioso | Atendido | runtime workers | testes dos workers |
| ≥3 processos e recuperação após reinício | Atendido | process harness | suíte `test:concurrency` |
| Logs estruturados sem dados financeiros | Atendido | `StructuredLogger` | teste de redaction |
| Métricas operacionais consultáveis | Atendido com trade-off | `GET /metrics`, por processo | unitário + E2E; agregação externa não incluída |
| Liveness e readiness públicos | Atendido | `/health/live`, `/health/ready` | health/E2E |
| Autenticação | Decisão aceita pelo enunciado | `ProviderAuthGuard` no-op + desenho OIDC | documentada em `ARCHITECTURE.md` |
| Teste de carga | Diferencial implementado | `bun run test:load` | `docs/LOAD_TEST.md` |

Nenhuma falha eliminatória conhecida permanece. Exactly-once, autenticação real, load balancer e observabilidade distribuída são limites documentados, não requisitos obrigatórios desta entrega.
