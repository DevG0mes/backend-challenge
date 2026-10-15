import { Migration } from '@mikro-orm/migrations';

export class Migration202610150001 extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table wallets (
        id uuid primary key,
        player_id uuid not null,
        currency varchar(3) not null,
        balance numeric(40, 2) not null,
        version integer not null,
        created_at timestamptz not null,
        updated_at timestamptz not null,
        constraint wallets_player_currency_unique unique (player_id, currency),
        constraint wallets_currency_format check (currency ~ '^[A-Z]{3}$'),
        constraint wallets_balance_non_negative check (balance >= 0),
        constraint wallets_version_positive check (version >= 1)
      )
    `);

    this.addSql(`
      create table wager_transactions (
        id uuid primary key,
        provider_id varchar(100) not null,
        external_transaction_id varchar(255) not null,
        idempotency_key varchar(255) not null,
        payload_hash varchar(64) not null,
        wallet_id uuid not null references wallets(id),
        player_id uuid not null,
        round_id varchar(255) not null,
        game_id varchar(255) not null,
        kind varchar(16) not null,
        amount numeric(40, 2) not null,
        currency varchar(3) not null,
        reference_external_transaction_id varchar(255),
        reference_transaction_id uuid references wager_transactions(id),
        status varchar(24) not null,
        failure_code varchar(64),
        result_balance numeric(40, 2),
        result_currency varchar(3),
        pending_attempts integer not null default 0,
        next_attempt_at timestamptz,
        processed_at timestamptz,
        created_at timestamptz not null,
        constraint wager_transactions_idempotency_key_unique unique (idempotency_key),
        constraint wager_transactions_provider_external_unique unique (
          provider_id, external_transaction_id
        ),
        constraint wager_transactions_payload_hash_format check (
          payload_hash ~ '^[a-f0-9]{64}$'
        ),
        constraint wager_transactions_kind_valid check (
          kind in ('OPENING', 'BET', 'WIN', 'LOSS', 'REFUND', 'ROLLBACK')
        ),
        constraint wager_transactions_status_valid check (
          status in ('PENDING', 'PENDING_REFERENCE', 'PROCESSED', 'REJECTED', 'FAILED')
        ),
        constraint wager_transactions_amount_non_negative check (amount >= 0),
        constraint wager_transactions_currency_format check (currency ~ '^[A-Z]{3}$'),
        constraint wager_transactions_pending_attempts_non_negative check (pending_attempts >= 0),
        constraint wager_transactions_result_money_complete check (
          (result_balance is null and result_currency is null)
          or (result_balance is not null and result_currency ~ '^[A-Z]{3}$')
        )
      )
    `);

    this.addSql(`
      create unique index wager_transactions_one_processed_reversal_per_kind
        on wager_transactions (kind, reference_transaction_id)
        where status = 'PROCESSED'
          and kind in ('REFUND', 'ROLLBACK')
          and reference_transaction_id is not null
    `);

    this.addSql(`
      create index wager_transactions_pending_reference_due
        on wager_transactions (next_attempt_at, id)
        where status = 'PENDING_REFERENCE'
    `);

    this.addSql(`
      create table wallet_ledger_entries (
        id uuid primary key,
        wallet_id uuid not null references wallets(id),
        transaction_id uuid not null references wager_transactions(id),
        direction varchar(6) not null,
        amount numeric(40, 2) not null,
        currency varchar(3) not null,
        balance_before numeric(40, 2) not null,
        balance_after numeric(40, 2) not null,
        created_at timestamptz not null,
        constraint wallet_ledger_entries_wallet_transaction_unique unique (
          wallet_id, transaction_id
        ),
        constraint wallet_ledger_entries_direction_valid check (
          direction in ('DEBIT', 'CREDIT')
        ),
        constraint wallet_ledger_entries_amount_positive check (amount > 0),
        constraint wallet_ledger_entries_currency_format check (currency ~ '^[A-Z]{3}$'),
        constraint wallet_ledger_entries_balances_non_negative check (
          balance_before >= 0 and balance_after >= 0
        ),
        constraint wallet_ledger_entries_arithmetic_valid check (
          (direction = 'DEBIT' and balance_before - amount = balance_after)
          or (direction = 'CREDIT' and balance_before + amount = balance_after)
        )
      )
    `);

    this.addSql(`
      create index wallet_ledger_entries_cursor
        on wallet_ledger_entries (wallet_id, created_at, id)
    `);

    this.addSql(`
      create function reject_wallet_ledger_mutation()
      returns trigger
      language plpgsql
      as $$
      begin
        raise exception 'wallet ledger entries are immutable';
      end;
      $$
    `);

    this.addSql(`
      create trigger wallet_ledger_entries_immutable
      before update or delete on wallet_ledger_entries
      for each row execute function reject_wallet_ledger_mutation()
    `);

    this.addSql(`
      create table inbox_messages (
        consumer_name varchar(100) not null,
        message_id varchar(255) not null,
        payload_hash varchar(64) not null,
        received_at timestamptz not null,
        processed_at timestamptz,
        primary key (consumer_name, message_id),
        constraint inbox_messages_payload_hash_format check (
          payload_hash ~ '^[a-f0-9]{64}$'
        )
      )
    `);

    this.addSql(`
      create table outbox_messages (
        id uuid primary key,
        aggregate_id uuid not null,
        event_type varchar(100) not null,
        payload jsonb not null,
        occurred_at timestamptz not null,
        attempts integer not null default 0,
        next_attempt_at timestamptz,
        published_at timestamptz,
        constraint outbox_messages_attempts_non_negative check (attempts >= 0),
        constraint outbox_messages_payload_object check (jsonb_typeof(payload) = 'object')
      )
    `);

    this.addSql(`
      create index outbox_messages_pending_due
        on outbox_messages (coalesce(next_attempt_at, occurred_at), id)
        where published_at is null
    `);
  }

  override async down(): Promise<void> {
    this.addSql('drop table if exists outbox_messages');
    this.addSql('drop table if exists inbox_messages');
    this.addSql('drop trigger if exists wallet_ledger_entries_immutable on wallet_ledger_entries');
    this.addSql('drop function if exists reject_wallet_ledger_mutation()');
    this.addSql('drop table if exists wallet_ledger_entries');
    this.addSql('drop table if exists wager_transactions');
    this.addSql('drop table if exists wallets');
  }
}
