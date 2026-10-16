# Arquitetura do Distributed Wagering Processor

## Objetivo e prioridades

A solução privilegia correção financeira sob concorrência e entrega at-least-once. As invariantes centrais são: dinheiro decimal exato; saldo nunca negativo; uma identidade externa produz no máximo um efeito financeiro; toda mudança de saldo possui exatamente um lançamento imutável; e eventos confirmados não são perdidos.

## Estrutura

```text
HTTP / SQS
    |
    v
controllers / consumer workers
    |
    v
application use cases -------> ports
    |                            |
    v                            v
domain (Wallet, Money,       MikroORM / PostgreSQL
WagerTransaction, rules)     AWS SDK / SQS
                                 |
                     inbox + wallet + ledger + wager + outbox
                              na mesma transação SQL
```

Os módulos são organizados em `wallet`, `wagering`, `messaging`, `database`, `health` e `shared`. O domínio não depende de NestJS, MikroORM ou AWS.

## Dinheiro, saldo e ledger

`Money` aceita somente strings decimais sem sinal e com duas casas, normaliza moeda ISO em maiúsculas e usa `decimal.js` com precisão 80. Nenhuma operação financeira passa por `number`.

`Wallet` é a raiz do agregado. Toda alteração bloqueia a linha com `SELECT ... FOR UPDATE`, valida fundos, atualiza o saldo/versionamento e insere um `WalletLedgerEntry` na mesma transação. PostgreSQL reforça saldo não negativo, unicidade e aritmética do ledger. Trigger impede `UPDATE` e `DELETE` dos lançamentos confirmados.

## Idempotência e concorrência

Há duas identidades únicas: `idempotency_key` e `(provider_id, external_transaction_id)`. O payload de negócio é serializado com chaves ordenadas e SHA-256; replay com hash igual retorna o resultado original, enquanto a mesma chave com payload diferente gera conflito.

O lock pessimista da carteira serializa operações que poderiam competir pelo mesmo saldo. Carteiras distintas não compartilham lock. Violações únicas resolvem a corrida da primeira entrega; o perdedor relê o resultado confirmado. A suíte `test:concurrency` inicia três processos reais e prova esses comportamentos.

## Mensageria e atomicidade

```text
SQS wager -> persistent inbox -> regra financeira -> ledger -> transactional outbox
                    \____________ uma transação PostgreSQL ____________/

outbox pendente -> claim SKIP LOCKED + lease -> SQS events -> marca published
```

O inbox deduplica por `(consumer,message_id)`. Mensagens inválidas/permanentes vão à DLQ; falhas transitórias retornam para retry. A entrega é at-least-once: consumidores de eventos devem deduplicar pelo `event.id` estável.

O publisher reivindica lotes com `FOR UPDATE SKIP LOCKED`, confirma uma lease curta e só então acessa a rede. Uma queda depois do envio e antes da marcação pode republicar o mesmo ID, mas nunca perde o evento.

## Referências fora de ordem

REFUND e ROLLBACK sem referência ficam `PENDING_REFERENCE`. Um worker reivindica linhas vencidas com `SKIP LOCKED`, procura a referência e reutiliza a mesma política de validação. Backoff é exponencial, limitado a uma hora; após dez tentativas o resultado é `REFERENCE_NOT_FOUND`. Provider, player, wallet, rodada, moeda, valor, tipo, estado e reversão anterior são validados antes de qualquer movimento.

## Reconciliação

A reconciliação percorre o ledger em ordem estável `(created_at,id)`, parte de zero e aplica créditos/débitos com `Money`. Compara o cálculo ao saldo materializado, registra e contabiliza divergências, mas nunca corrige automaticamente. Paginação usa cursor Base64URL opaco com a mesma fronteira estável.

## Operação

- `/health/live`: vida do processo, sem dependências.
- `/health/ready`: consulta PostgreSQL e SQS; responde 503 quando qualquer um está indisponível.
- `/metrics`: expõe métricas Prometheus locais à instância; agregação exige scraping de cada réplica.
- Logs JSON mantêm IDs de correlação/transação/carteira/provedor e removem payloads financeiros, tokens e segredos.
- Métricas cobrem status, duplicidades, latência, espera por lock, retries, DLQ, lag do outbox e divergências de reconciliação.
- Workers param de buscar trabalho e aguardam operações em andamento até o grace period.

## Autenticação

`ProviderAuthGuard` é intencionalmente no-op e aplicado às APIs de negócio. A extensão recomendada é validar JWT/OIDC de Keycloak, Zitadel ou outro IdP, traduzindo `sub`/claims para uma identidade de provedor e verificando se ela corresponde ao `providerId`. Health permanece público; SQS usa identidade e autorização da infraestrutura. Não seria criada uma tabela local de senhas.

## Limites e trade-offs conhecidos

- Os defaults `dw_app` / `dw_local_N7v4K2p9` existem somente para desenvolvimento local; produção deve injetar secrets.
- Métricas são mantidas em memória e precisam de um exporter Prometheus/OpenTelemetry em produção.
- O cursor é opaco, mas não assinado; ele não contém segredo e é validado, porém poderia receber HMAC em uma API pública.
- O outbox garante at-least-once, não exactly-once; consumidores precisam deduplicar IDs.
- Não há reparo automático de reconciliação, por escolha de segurança e auditabilidade.
- O Compose demonstra três instâncias com portas distintas; balanceamento seria responsabilidade do ingress/load balancer.
