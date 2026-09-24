# Implementation Plan: Egg Stock by Shed

## Overview

Implement an Owner-facing "Egg Stock by Shed" page that aggregates egg collection, sales, and damage data across all sheds for a selected date. The implementation is purely additive: new files are created, two existing files (`App.tsx`, `AppShell.tsx`) receive minimal additions, and no existing business logic or store structure is modified.

The design uses TypeScript (React + Zustand + Tailwind), matching the existing codebase.

## Tasks

- [ ] 1. Create calculation library `src/lib/eggStockCalc.ts`
  - [ ] 1.1 Define and export the `ShedStockMetrics`, `SummaryMetrics`, and `StockMovement` TypeScript interfaces
    - Import existing types: `EggCollection`, `EggSale`, `Shed`, `Batch` from `@/types`
    - `ShedStockMetrics`: `shedId`, `currentStock`, `trays`, `looseEggs`, `todayProduction`, `todayDispatch`, `todayDamage`, `closingStock`, `status: 'HEALTHY' | 'LOW_STOCK' | 'CRITICAL'`
    - `SummaryMetrics`: `totalStock`, `totalTrays`, `totalEggs`, `todayProduction`, `todayDispatch`, `damagedEggs`
    - `StockMovement`: `openingStock`, `production`, `sales`, `damage`, `adjustments`, `closingStock`
    - _Requirements: 2.1, 3.1, 4.1, 9.1_

  - [ ] 1.2 Implement `shedStockMetrics()` function
    - Filter `eggCollections` by `shedBatches` and `onDate`; filter `eggSales` by `shedBatches` and `onDate`
    - `totalCollected = sum(good + damaged + cracked)` from collections
    - `totalSold = sum(trays * eggsPerTray)` from sales
    - `totalDamaged = sum(damaged + cracked)` from collections
    - `currentStock = totalCollected - totalSold - totalDamaged`; guard against negative values with `Math.max(0, ...)`
    - `trays = Math.floor(currentStock / 30)`, `looseEggs = currentStock % 30`
    - Status thresholds: `< 5000 → CRITICAL`, `< 10000 → LOW_STOCK`, `>= 10000 → HEALTHY`
    - Guard NaN/Infinity — return `0` if any intermediate value is invalid
    - _Requirements: 3.3, 3.4, 3.6, 9.4, 9.5_

  - [ ] 1.3 Implement `calculateSummary()` function
    - Map all active sheds through `shedStockMetrics()` and aggregate totals
    - `totalTrays` sums per-shed trays; `totalEggs = totalTrays * 30 + sum(looseEggs)`
    - _Requirements: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [ ] 1.4 Implement `calculateStockMovement()` function
    - Derive `openingStock` by summing all collections up to (but not including) `onDate` minus sales up to that date minus damage up to that date
    - `closingStock = openingStock + production - sales - damage + adjustments`
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 1.5 Write property tests for `eggStockCalc.ts`
    - **Property 2: Tray conversion invariant** — for any stock count `n ≥ 0`, `floor(n / 30) * 30 + (n % 30) === n`
    - **Property 4: Status threshold invariant** — for any `currentStock`, status must follow the three threshold rules exactly and never be undefined
    - **Validates: Requirements 3.4, 3.6**

- [ ] 2. Create reusable UI component `src/components/ui/SummaryCard.tsx`
  - [ ] 2.1 Implement `SummaryCard` component
    - Wrap the existing `KPI` component from `Card.tsx` with props: `label`, `value`, `subValue?`, `tone?`
    - Accept `tone` of type `Tone` ('brand' | 'accent' | 'success' | 'warn' | 'danger' | 'neutral')
    - Render `subValue` as the `sub` prop on `KPI`
    - Export named export `SummaryCard`
    - _Requirements: 6.1, 6.2, 15.1, 15.2_

  - [ ]* 2.2 Write unit tests for `SummaryCard`
    - Test renders label and value correctly
    - Test all tone variants render without errors
    - Test `subValue` renders when provided and is absent when not
    - _Requirements: 6.2_

- [ ] 3. Create reusable UI component `src/components/ui/ShedStockCard.tsx`
  - [ ] 3.1 Implement `ShedStockCard` component
    - Props: `shed: Shed`, `stock: ShedStockMetrics`
    - Use existing `Card` component as container
    - Header row: shed name (`shed.name`) + status badge (`Badge` from `Card.tsx`) using tone mapping: `HEALTHY → success`, `LOW_STOCK → warn`, `CRITICAL → danger`
    - Status badge must include a text label (not colour-only) per accessibility requirement
    - Metrics grid: Current Stock, Trays, Loose Eggs (use `fmtIN` from `lib/format.ts`)
    - Daily activity row: Today's Production, Today's Dispatch, Today's Damage
    - Closing Stock row at bottom
    - All values guard against NaN — render `'—'` for invalid numbers
    - Minimum font size 14px; all interactive wrappers min 44px touch target
    - _Requirements: 3.1, 3.2, 6.3, 6.4, 15.2, 15.3, 15.4_

  - [ ]* 3.2 Write unit tests for `ShedStockCard`
    - Test HEALTHY, LOW_STOCK, CRITICAL badges render with correct tone and text label
    - Test zero-value stock renders `0` values not errors
    - Test NaN guard renders `'—'`
    - _Requirements: 3.2, 6.4, 12.3_

- [ ] 4. Create main screen `src/screens/EggStockByShedScreen.tsx`
  - [ ] 4.1 Scaffold screen with permission gate
    - Import `useCan`, `useCurrentUser` from `@/store/app`
    - Import `useApp` for `sheds`, `batches`, `eggs` (eggCollections), `eggSales`
    - If `!useCan('exportReports')`: render `Page > Header("Egg Stock by Shed") > EmptyState` with "Access Restricted" title and description
    - Otherwise proceed to render main content
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ] 4.2 Implement filter state and memoised data derivation
    - State: `selectedDate` (defaults to `todayISO()`), `selectedShedId` (`'ALL'` default), `eggTypeFilter` (`'ALL'` default)
    - `filteredSheds = useMemo(...)` — when `selectedShedId !== 'ALL'`, filter `sheds` to single shed
    - `summary = useMemo(() => calculateSummary(...), [filteredSheds, batches, eggs, eggSales, selectedDate])`
    - `shedMetrics = useMemo(() => filteredSheds.map(shed => shedStockMetrics(...)), [...])`
    - `stockMovement = useMemo(() => calculateStockMovement(...), [...])`
    - Prevent future date selection: cap `selectedDate` at `todayISO()` using `max` attribute on date input
    - _Requirements: 5.1–5.7, 9.2, 11.4, 11.6, 12.4_

  - [ ] 4.3 Implement Summary Cards section
    - Render six `SummaryCard` components in a responsive grid (`grid grid-cols-2 lg:grid-cols-3 gap-3`)
    - Cards: Total Egg Stock (neutral), Total Trays (brand), Total Eggs (brand), Today's Production (success), Today's Dispatch (accent), Damaged Eggs (danger)
    - Format values with `fmtIN()`; show `'0'` when zero — never `undefined`
    - Add `aria-label` to each card for screen reader support
    - _Requirements: 2.1, 2.2, 6.2, 6.6, 15.8_

  - [ ] 4.4 Implement Stock Movement section
    - Render a `Card` with a `SectionTitle` "Stock Movement"
    - Use `Row` component for each movement line: Opening Stock, Production, Sales/Dispatch, Damage, Closing Stock
    - Conditionally render Adjustments row only when `stockMovement.adjustments !== 0`
    - Each value shown in egg count format via `fmtIN()`
    - _Requirements: 4.1–4.5_

  - [ ] 4.5 Implement Filter section
    - Render a `Card` containing three filter controls:
      - Shed selector: a `<select>` with "All Sheds" option plus one option per `shed.name`
      - Date input: `type="date"` with `max={todayISO()}`, value bound to `selectedDate`
      - Egg type selector: `<select>` with options ALL / GOOD / DAMAGED
    - Apply `eggTypeFilter` during render of shed metrics (pass as prop to `ShedStockCard` or filter displayed count)
    - Filter state updates trigger `useMemo` re-calculation without manual "Apply" step (reactive)
    - _Requirements: 5.1–5.7, 6.7_

  - [ ] 4.6 Implement Shed Stock List
    - When `sheds.length === 0`: render `EmptyState` with "No sheds found. Create a shed to start tracking egg stock."
    - Otherwise: render a two-column responsive grid (`grid gap-3 sm:grid-cols-2`) of `ShedStockCard` components
    - Map `shedMetrics` array, passing `shed` and `stock` props; always show all sheds including zero-activity ones
    - _Requirements: 3.1, 3.2, 3.7, 6.8, 12.1–12.3_

  - [ ]* 4.7 Write property tests for filter + aggregation consistency
    - **Property 3: Filter aggregation** — for any combination of `selectedShedId` and `selectedDate`, `sum(shedMetrics[*].currentStock)` must equal `summary.totalStock`
    - **Property 1: Stock non-negative** — for any valid collection and sales inputs, `currentStock` must never be negative
    - **Validates: Requirements 5.5, 9.3**

- [ ] 5. Wire navigation and routing
  - [ ] 5.1 Add route in `src/App.tsx`
    - Import `EggStockByShedScreen` from `@/screens/EggStockByShedScreen`
    - Add `<Route path="/egg-stock-by-shed" element={<EggStockByShedScreen />} />` inside the authenticated `<Routes>` block, alongside existing routes
    - _Requirements: 7.2, 10.7_

  - [ ] 5.2 Add navigation entry in `src/components/layout/AppShell.tsx`
    - Import `Egg` icon from `lucide-react` (already imported in AppShell)
    - Add `{ to: '/egg-stock-by-shed', label: 'Egg Stock', icon: <Egg size={17} /> }` to the `Operations` group in `GROUPS`
    - Verify the item renders in the sidebar nav and mobile "More" sheet
    - _Requirements: 7.1, 7.3_

- [ ] 6. Checkpoint — verify build and correctness
  - Run `tsc --noEmit` from the project root to check for TypeScript errors
  - Fix any type errors in new files (incorrect imports, missing props, wrong types)
  - Confirm all existing screens still render without errors
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- The store property for egg collections is `eggs` (not `eggCollections`) — use `useApp(s => s.eggs)` in the screen
- `EggSale.eggsPerTray` must be used (not a hardcoded 30) when calculating dispatched eggs
- `fmtIN()` from `lib/format.ts` handles Indian-locale number formatting and guards `isFinite`
- `todayISO()` is available from both `lib/format.ts` (import) and `store/app.ts` (re-export)
- The existing `Badge` and `KPI` components in `Card.tsx` are the right primitives for status and metric display
- `SummaryCard` is a thin wrapper over `KPI` — keep it simple
- Checkpoints ensure incremental validation

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "1.4"] },
    { "id": 2, "tasks": ["1.5", "2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "4.6"] },
    { "id": 6, "tasks": ["4.7", "5.1", "5.2"] }
  ]
}
```
