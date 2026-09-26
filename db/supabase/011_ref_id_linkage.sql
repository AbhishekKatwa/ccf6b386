-- 011_ref_id_linkage.sql — finance_txns.ref_id stops being a sale-entry-only column.
--
-- 001 declared `ref_id text references sale_entries(id) on delete cascade` back when a sale
-- voucher was the only writer. The vaccine flow (complete_vaccination, src/store/app.ts) also
-- stamps its link — 'vac-vaccine-<id>' and friends — and every such row died at the wall:
-- "insert or update on table "finance_txns" violates foreign key constraint
-- 'finance_txns_ref_id_fkey'". The link is app-level bookkeeping for replaceLedger(), exactly
-- like purchase_id two columns down, which 001 already keeps as plain text for the same
-- reason. The cascade was never load-bearing either: deleteSaleEntry() removes its own money
-- rows through the store before the row ever leaves the table.
--
-- trader_txns.ref_id keeps its constraint: the sale voucher is that ledger's only writer.

alter table public.finance_txns drop constraint if exists finance_txns_ref_id_fkey;

comment on column public.finance_txns.ref_id is
  'The voucher that generated this row — a sale entry (se_*) or a vaccination (vac-*). Plain '
  'text like purchase_id: replaceLedger() resolves it, and deleteSaleEntry() cleans its own '
  'rows, so no database cascade rides on it.';
