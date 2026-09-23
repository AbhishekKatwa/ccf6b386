# Amrut Poultry Farm - Architecture Guide

## 1. PURPOSE

This document describes the intended software architecture for the poultry farm management application.

The project currently originated as a React + Vite + Tailwind CSS application created in Figma Make.

The architecture should evolve incrementally rather than being rewritten unnecessarily.

## 2. HIGH-LEVEL LAYERS

Prefer separating the application into these logical layers:

### Presentation
React screens and reusable UI components.

Responsible for:
- Rendering
- User interaction
- Form state
- Navigation
- Loading/error/empty states

Should not contain complex accounting calculations.

### Application / Domain
Business workflows and calculations.

Examples:
- Egg sale calculation
- Feed cost calculation
- Stock movement
- Shed P&L
- Customer balance
- Supplier balance
- Day locking

This layer should contain testable functions/services.

### Data
Database/API/storage access.

Responsible for:
- Queries
- Mutations
- Persistence
- Mapping API/database records
- Error handling

Do not duplicate business rules across UI and data-access code.

## 3. FEATURE ORGANIZATION

Prefer feature-oriented organization when the project grows.

Possible structure:

`src/`
- `components/`
- `features/`
  - `dashboard/`
  - `sheds/`
  - `flocks/`
  - `eggs/`
  - `sales/`
  - `customers/`
  - `suppliers/`
  - `godown/`
  - `purchases/`
  - `expenses/`
  - `finance/`
  - `reports/`
  - `users/`
- `lib/`
- `services/`
- `types/`
- `hooks/`

Do not create this structure blindly if the existing project already uses a different coherent structure.

Follow the existing project conventions first.

## 4. DOMAIN MODEL

Core relationships:

Farm
  └── Sheds
       └── Flocks
            ├── Production
            ├── Mortality
            ├── Feed Consumption
            └── Shed Expenses

Farm
  └── Godown
       └── Inventory Items
            ├── Purchases
            ├── Issues
            ├── Adjustments
            └── Current Stock

Farm
  ├── Customers
  │    └── Egg Sales / Payments
  │
  └── Suppliers
       └── Purchases / Payments

## 5. TRANSACTION-FIRST DESIGN

Where practical, reports should derive from underlying transactions.

Avoid storing manually maintained totals when those totals can be derived reliably.

Examples:
- Current Godown stock = opening stock + inbound - outbound + adjustments
- Customer outstanding = sales - payments +/- adjustments
- Supplier outstanding = purchases - payments +/- adjustments
- Cumulative mortality = sum of mortality events
- Shed feed cost = sum of attributable feed consumption costs

Cached/denormalized values may be introduced for performance only when there is a clear reason.

## 6. INVENTORY MOVEMENTS

Represent inventory movement explicitly.

Conceptually:

Inventory Transaction
- item
- date
- quantity
- direction/type
- unit
- source
- destination
- rate/cost where applicable
- reference transaction
- user
- timestamp
- reason where applicable

Examples:
- Purchase: IN
- Shed issue: OUT
- Adjustment shortage: OUT
- Adjustment excess: IN
- Return: direction depends on workflow

Do not mutate stock without a corresponding auditable movement where the business model requires it.

## 7. FINANCIAL TRANSACTIONS

Financial transactions should contain enough information to identify:
- Date
- Amount
- Type
- Entity/context
- Category
- Reference
- User
- Status where applicable

Avoid anonymous amounts.

## 8. CALCULATION SERVICES

Keep domain calculations centralized.

Examples:

`calculateEggSaleAmount()`
`calculateFeedCost()`
`calculateInventoryBalance()`
`calculateInventoryValue()`
`calculateCustomerOutstanding()`
`calculateSupplierOutstanding()`
`calculateShedProfitLoss()`
`calculateFarmProfitLoss()`

A calculation should not have one formula on the Dashboard and another on the Reports page.

## 9. TYPES

Use explicit TypeScript types for important domain entities.

Avoid excessive `any`.

Financial and inventory types should distinguish:
- quantity
- unit
- rate
- amount
- date
- entity identifiers

Do not pass loosely structured objects through many layers.

## 10. FORMS

Forms should:
- Validate required fields
- Validate numeric ranges
- Validate units
- Show clear errors
- Prevent accidental duplicate submissions
- Provide sensible defaults
- Use numeric input where appropriate

For financial forms, display the calculated total before submission where useful.

## 11. MOBILE UX ARCHITECTURE

The primary interaction is mobile.

Prefer:
- Bottom sheets
- Full-screen mobile forms
- Large action buttons
- Sticky primary actions when useful
- Compact summary cards
- Detail pages instead of huge tables

Desktop layouts may expand naturally but should not dictate the mobile experience.

## 12. PERFORMANCE

Prefer:
- Local derived calculations for small datasets
- Server/database aggregation for large datasets
- Pagination for large histories
- Memoization only when profiling/reasoning indicates it is useful
- Lazy loading for large feature areas when appropriate

Do not introduce complexity solely for theoretical performance.

## 13. SECURITY

Role-based restrictions must not rely only on frontend visibility.

Where backend/API authorization exists, enforce permissions there.

Sensitive financial information must not be returned to roles that are not authorized to receive it.

## 14. OFFLINE-FIRST DIRECTION

If offline support is implemented:

- Local writes should be durable.
- Sync should be explicit and retryable.
- Conflicts must be handled deliberately.
- Financial transactions must not be duplicated during retry.
- Idempotency should be considered for sync operations.

Do not claim an operation is synced until persistence/sync state confirms it.

## 15. AUDIT ARCHITECTURE

Audit records should be append-oriented.

Prefer recording:
- Actor
- Timestamp
- Entity
- Action
- Before
- After
- Reason

Do not make audit history depend on the current state of the edited entity.

## 16. TESTING PRIORITIES

Highest priority tests:

1. Financial calculations
2. Inventory calculations
3. Stock movements
4. Customer/supplier balances
5. Shed P&L
6. Role restrictions
7. Day-lock behaviour
8. Data validation

UI snapshot/detail testing is useful but should not replace domain tests.

## 17. EXTENSIBILITY

Design so the following can be added without rewriting core accounting:
- Multiple farms
- More sheds
- More inventory categories
- More users
- Additional sale types
- Additional expense categories
- More detailed reporting
- Bank/cash accounts
- Advanced forecasting

Do not implement these features prematurely.

## 18. MIGRATION RULE

When changing the data model:
1. Identify existing consumers.
2. Preserve backwards compatibility where practical.
3. Migrate existing data deliberately.
4. Validate totals before and after migration.
5. Do not silently discard historical data.

## 19. ARCHITECTURAL RULE

Prefer boring, explicit, maintainable code.

The best architecture for this application is the simplest architecture that preserves:
- Correct accounting
- Data integrity
- Auditability
- Role security
- Fast farm operations
- Easy future modification
