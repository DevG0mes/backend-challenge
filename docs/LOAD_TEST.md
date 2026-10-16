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

Os resultados serão preenchidos somente após a execução do código final em Compose limpo. Até lá, nenhuma capacidade ou throughput é reivindicado.

## Limitações

Os números representam uma execução local com PostgreSQL e LocalStack no Docker Desktop. Não estimam capacidade de produção, latência da AWS, comportamento de rede real ou escalabilidade ilimitada. As réplicas são acessadas diretamente porque esta entrega não inclui load balancer.
