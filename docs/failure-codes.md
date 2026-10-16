# Catálogo de falhas

## Resultados de negócio persistidos

| Código | Significado | Retry pelo provedor |
|---|---|---|
| `INSUFFICIENT_FUNDS` | BET excede o saldo disponível | Não, sem mudança de saldo |
| `REVERSAL_NEGATIVE_BALANCE` | ROLLBACK debitável deixaria saldo negativo | Não |
| `REFERENCE_NOT_FOUND` | Referência continuou ausente após esgotar tentativas | Não automático |
| `REFERENCE_NOT_PROCESSED` | Referência existe, mas não foi processada | Não |
| `REFERENCE_MISMATCH` | Provider, player, wallet, rodada ou ID não coincide | Não |
| `INVALID_REFERENCE_KIND` | Tipo referenciado não é permitido | Não |
| `AMOUNT_MISMATCH` | Valor difere da operação referenciada | Não |
| `ALREADY_REVERSED` | Reversão equivalente já foi processada | Não |
| `CURRENCY_MISMATCH` | Moedas da operação, carteira ou referência diferem | Não |
| `WALLET_MISMATCH` | Operação não pertence à carteira/player | Não |
| `INFRASTRUCTURE_PERMANENT` | Falha permanente registrada para auditoria | Intervenção operacional |

## Falhas de contrato e aplicação

| Código/situação | HTTP | Comportamento |
|---|---:|---|
| Payload ou dinheiro inválido | 400 | Corrigir requisição; não cria transação financeira |
| `INVALID_CURSOR`, `INVALID_PAGE_LIMIT` | 400 | Corrigir paginação |
| `WALLET_NOT_FOUND`, `TRANSACTION_NOT_FOUND` | 404 | Não repetir sem corrigir identidade |
| `IDEMPOTENCY_CONFLICT` | 409 | A chave já pertence a outro payload |
| Rejeição de negócio | 422 | Resultado terminal e auditável |
| Referência pendente | 202 | Aceito para reprocessamento assíncrono |
| Dependência indisponível | 500/503 | Retry com backoff; readiness fica degradado |

## SQS

JSON malformado, envelope inválido e conflitos permanentes seguem para DLQ. Falhas transitórias de banco/rede retornam para a fila até `maxReceiveCount`; ao atingir o limite, a mensagem vai para DLQ. O inbox impede um redelivery confirmado de repetir o efeito financeiro.
