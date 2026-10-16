# Teste de carga

## Objetivo

Medir a aplicação local sem sacrificar a principal condição de sucesso: ao final, o saldo de toda wallet deve ser igual ao saldo reconstruído pelo ledger.

## Metodologia

O gerador nativo em Bun chama diretamente as três réplicas em round-robin. O setup e o aquecimento ficam fora da janela medida. Toda aposta usa identidade única.

- **Distribuído:** múltiplas wallets processadas em paralelo.
- **Hot wallet:** várias requisições competem pelo lock de uma wallet.
- **Métricas:** req/s, p50, p95, p99, máximo, erros e distribuição HTTP.
- **Gate:** qualquer divergência de reconciliação encerra o comando com falha.

```powershell
$env:LOAD_DURATION_SECONDS='10'
$env:LOAD_CONCURRENCY='16'
$env:LOAD_WALLETS='20'
bun run test:load
```

Configurações adicionais: `LOAD_BASE_URLS`, `LOAD_WARMUP_REQUESTS`, `LOAD_AMOUNT` e `LOAD_INITIAL_BALANCE`. O resultado completo é gerado em `reports/load-test.json`.

## Ambiente e resultados

Execução de referência em 16/10/2026, após `docker compose down --volumes` e reconstrução completa das imagens:

- Windows 11 Pro, Docker Desktop Engine 27.4.0;
- Intel Core i5-1335U, 10 cores/12 processadores lógicos e 23,7 GiB de RAM;
- Bun 1.4.3 x64 como gerador;
- PostgreSQL 16, LocalStack 4.9 e três réplicas da API em containers locais;
- concorrência 16, 10 s medidos por cenário, 10 requisições de aquecimento e apostas de BRL 0,01.

| Cenário | Requisições | Req/s | p50 | p95 | p99 | Máximo | Erros | Reconciliação |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 20 wallets | 1.415 | 140,73 | 102,40 ms | 201,78 ms | 285,80 ms | 505,18 ms | 0 | 20/20 consistentes |
| hot wallet | 638 | 62,12 | 56,34 ms | 1.276,75 ms | 2.593,18 ms | 3.026,67 ms | 0 | 1/1 consistente |

Todas as 2.053 respostas medidas foram HTTP 201. A menor vazão e a cauda maior da hot wallet são coerentes com a serialização intencional pelo lock pessimista daquela carteira. O arquivo `reports/load-test.json`, ignorado pelo Git, preserva os valores brutos da execução local atual.

## Limitações

Os números representam uma única execução local com PostgreSQL e LocalStack no Docker Desktop, com gerador e serviços compartilhando a mesma máquina. Não são benchmark estatístico nem estimam capacidade de produção, latência da AWS, comportamento de rede real ou escalabilidade ilimitada. As réplicas são acessadas diretamente porque esta entrega não inclui load balancer. Esta versão do runner não mede separadamente conflitos de lock nem outbox lag durante a janela; essas métricas podem ser consultadas em `/metrics`, mas não integram o relatório de carga.
