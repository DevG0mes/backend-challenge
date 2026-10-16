# Evidências de testes

O projeto mantém duas formas complementares de apresentar a qualidade da solução:

- `bun test` mostra o resultado completo e legível durante o desenvolvimento;
- `bun run test:report` gera `reports/junit.xml`, um artefato padronizado que pode ser aberto por IDEs e publicado por ferramentas de CI.

O XML é gerado novamente a cada execução e não é versionado. Assim, a evidência apresentada sempre corresponde ao código e ao ambiente realmente testados. Para uma demonstração, execute PostgreSQL e LocalStack, defina `TEST_POSTGRES_PORT=55432`, rode a suíte completa e mostre tanto o resumo do terminal quanto o relatório JUnit.

Além da contagem de testes, vale destacar os cenários com maior valor técnico: concorrência sobre a mesma carteira, replay idempotente, ledger imutável, rollback transacional e redelivery do SQS.
