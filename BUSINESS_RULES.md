# Amrut Poultry Farm - Business Rules

This document defines domain rules for the Layer Poultry Farm management application.

When implementation details conflict with this document, preserve the business rule unless the Owner explicitly changes it.

## 1. CORE ENTITIES

Primary operational entities:
- Farm
- Shed
- Flock
- Bird batch
- Egg production
- Egg stock
- Egg sale
- Customer
- Supplier
- Godown
- Inventory item
- Inventory transaction
- Feed consumption
- Medicine consumption
- Purchase
- Expense
- Income
- Payment
- Customer ledger
- Supplier ledger
- Day lock
- Audit record
- User
- Role

## 2. FARM STRUCTURE

The farm may contain multiple sheds.

Shed-level operations include:
- Bird count
- Bird age
- Mortality
- Egg production
- Feed consumption
- Medicine/vaccine usage
- Shed-specific expenses
- Shed-specific revenue where applicable

Godown operations are centralized.

Do not create shed-wise inventory unless explicitly required by a future business rule.

## 3. GODOWN INVENTORY

Godown is the central inventory location.

Typical items include:
- Maize
- Soya DOC
- DDGS
- Groundnut DOC
- DORB
- Rapeseed
- Stone grit
- MCP
- DCP
- DLM
- Lysine
- Mixiblend
- Vitamins/minerals
- Medicines
- Other farm supplies

Each inventory item should have a consistent unit.

Examples:
- kg
- litre
- bag
- piece
- tray
- bottle

Do not silently mix units.

## 4. PURCHASE FLOW

When material is purchased:

1. Create purchase record.
2. Record supplier.
3. Record quantity.
4. Record rate.
5. Record taxes/transport where applicable.
6. Calculate total purchase cost.
7. Increase Godown stock.
8. Create the appropriate Godown ledger entry.
9. Update supplier payable/ledger when applicable.

A purchase is not a shed expense merely because the material will eventually be consumed by a shed.

## 5. FEED CONSUMPTION

When feed is issued to/consumed by a shed:

1. Decrease Godown stock.
2. Create a feed consumption record against the shed.
3. Calculate the applicable feed cost.
4. Record the cost as a shed expense.
5. Preserve the transaction in the Godown ledger.

Consumption must not reduce a shed's bird count or egg stock unless a separate business transaction explicitly requires it.

## 6. INVENTORY COST

The application must use one defined inventory costing method.

If the current implementation already defines a method, preserve it.

If a costing method is not yet defined, isolate costing logic behind a service/function so the method can be changed later.

Do not silently use different costing methods on different screens.

## 7. STOCK ADJUSTMENTS

Stock discrepancies require explicit adjustments.

Example:
System stock = 1,000 kg
Physical stock = 980 kg

Create:
- Adjustment quantity = -20 kg
- Reason = shortage/difference
- User
- Date/time

Never simply overwrite the quantity.

## 8. NEGATIVE STOCK

Do not allow negative stock by default.

If an operational workflow genuinely requires temporary negative stock, the rule must be explicitly defined before implementation.

## 9. EGG PRODUCTION

Egg production should be recorded by:
- Business date
- Shed/flock
- Quantity
- Unit

The application may represent eggs as:
- Pieces
- Trays

Where trays are used, retain the farm's defined conversion rules.

Do not invent a conversion factor.

## 10. EGG SALES

An egg sale should capture, as applicable:
- Date
- Customer
- Shed/source if required
- Egg quantity
- Tray quantity
- Rate
- Other applicable charges/adjustments
- Total amount
- Payment status

For sales where the farm uses the established calculation:

`Amount = trays × rate × 30`

preserve that calculation when the transaction is explicitly based on the per-30-egg/tray rate convention.

Do not silently change the convention.

## 11. SALES INVENTORY

Selling eggs reduces the relevant available egg stock.

Do not allow sales to silently create eggs.

Production and sales must remain separate transactions.

## 12. CUSTOMER LEDGER

Customer ledger should distinguish:
- Sale/invoice
- Payment received
- Credit/debit adjustment
- Outstanding balance

Do not treat a sale as a payment automatically unless the transaction explicitly indicates immediate payment.

## 13. SUPPLIER LEDGER

Supplier ledger should distinguish:
- Purchase
- Payment
- Credit/debit adjustment
- Outstanding payable

A purchase does not automatically mean the supplier has been paid.

## 14. SHED P&L

Shed profitability should be calculated from attributable revenue and attributable expenses.

Typical shed expenses:
- Feed
- Medicines
- Vaccines
- Labour allocated to the shed
- Electricity allocated to the shed
- Other explicitly allocated operating costs

Godown inventory purchases should not be directly counted as shed expenses until the material is consumed/allocated according to the defined costing method.

## 15. FARM-LEVEL EXPENSES

Some expenses belong to the farm generally and should not be assigned to an individual shed unless an allocation rule exists.

Examples:
- Administrative expenses
- General repairs
- Bank charges
- Certain transport costs
- General office expenses

Keep farm-level expenses separate from shed-specific expenses.

## 16. REVENUE

Revenue should be recorded at the level that generated it.

Where revenue is associated with a shed/flock, retain that relationship for reporting.

Do not duplicate revenue when producing farm-level totals.

## 17. BIRD COUNTS

Bird counts should be traceable.

A bird count change should be attributable to a reason such as:
- Opening count
- Mortality
- Sale
- Transfer
- Adjustment

Do not silently edit the historical count to make the current number match physical stock.

## 18. MORTALITY

Mortality should be recorded by:
- Date
- Shed/flock
- Quantity
- Reason/category where available

Cumulative mortality should be derived from recorded mortality events rather than manually overwritten totals.

## 19. FLOCK AGE

Flock age should be derived from hatch/start date and business date where possible.

Do not manually update flock age every day.

If a historical date is explicitly required, preserve it as entered.

## 20. DAY LOCK

Once a business day is locked:
- Normal users cannot change locked operational/financial records.
- Owner-authorized corrections may be allowed.
- Corrections must be auditable.

## 21. ROLES

### Owner
Full operational and financial visibility and authorized override capabilities.

### Manager
Operational access required for farm work.

Manager must not see restricted:
- Rates
- Revenue
- Profit
- Margin
- Financial summaries

### Financer
Access should be limited to the financial information required for the defined workflow.

### Super Admin
System/configuration administration.

Do not assume every role has full access.

## 22. AUDIT

Important changes should preserve:
- User
- Timestamp
- Entity
- Action
- Old value where relevant
- New value where relevant
- Reason where relevant

Financial history should not disappear without trace.

## 23. DAILY OPERATIONS

The application should make daily farm entry fast.

Typical daily workflow:
1. Select business date.
2. Review previous/opening values.
3. Enter shed bird/mortality data.
4. Enter egg production.
5. Enter feed consumption.
6. Enter other consumption/expenses.
7. Enter sales.
8. Review totals.
9. Lock the day when operations are complete.

The exact workflow may evolve, but the system should support this operational rhythm.

## 24. REPORTING

Reports should derive from transaction data rather than duplicate manually maintained totals.

Important report categories:
- Daily production
- Production by shed
- Mortality
- Feed consumption
- Feed cost
- Godown stock
- Godown valuation
- Purchases
- Egg sales
- Customer outstanding
- Supplier outstanding
- Shed P&L
- Farm P&L
- Cash/bank movements where implemented

## 25. DATA CONSISTENCY

The same underlying transaction should drive related reports.

For example:
A feed issue should affect:
- Godown stock
- Godown ledger
- Shed feed consumption
- Shed expense
- Relevant reports

Do not maintain independent numbers on different screens.

## 26. DISPLAY RULE

Display calculations clearly enough that a farm operator can understand them.

Example:
`820 trays × ₹525 × 30 = ₹12,915,000`

If the system uses a different rate convention for a particular transaction, show the actual formula/units used.

## 27. CHANGE CONTROL

When changing a business rule:
1. Update this document.
2. Update the affected calculation/domain logic.
3. Update relevant tests.
4. Check dependent reports/screens.
5. Validate historical data compatibility.

Never change an accounting rule in one screen only.
