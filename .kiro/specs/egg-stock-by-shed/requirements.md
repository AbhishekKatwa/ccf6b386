# Requirements Document: Egg Stock by Shed

## Introduction

This feature introduces an Owner-facing operational page called "Egg Stock by Shed" that provides a comprehensive, real-time view of egg inventory across all sheds in a poultry farm. The page aggregates data from egg collections, sales, and existing stock to help owners make informed operational decisions. It displays current stock levels, daily production, dispatches, and damage tracking at the shed level.

## Glossary

- **System**: Amrut Poultry Management System
- **Egg Collection**: Daily record of eggs gathered from a batch, categorized as good, damaged, or cracked
- **Egg Sale**: Record of eggs sold to traders, tracked by trays (30 eggs per tray)
- **Stock**: Total egg inventory available, calculated as collected eggs minus sold eggs minus damaged eggs
- **Production**: Today's egg collection from a specific batch/shed
- **Dispatch**: Today's egg sales from a specific batch/shed
- **Damage**: Eggs that are broken or cracked, categorized as damaged or cracked
- **Shed**: Physical structure where batches of birds are housed
- **Batch**: Group of birds of the same age and type housed in a shed
- **Tray**: Standard container holding 30 eggs

## Requirements

### Requirement 1: Page Header and Date Selection

**User Story:** As an owner, I want to see a clear header with the page title and date selector, so that I can easily identify the report date and navigate to this view.

#### Acceptance Criteria

1. WHEN the "Egg Stock by Shed" page is loaded, THE Display SHALL show "Egg Stock by Shed" as the main title
2. WHILE on the Egg Stock by Shed page, THE Display SHALL show a date selector allowing the owner to view historical stock data
3. WHERE the owner selects a date, THE Display SHALL update all stock calculations and visualizations to reflect that date's data
4. THE Date Selector SHALL default to today's date when the page is first loaded

### Requirement 2: Summary Card Metrics

**User Story:** As an owner, I want to see high-level egg stock metrics at the top of the page, so that I can quickly assess overall farm egg inventory status.

#### Acceptance Criteria

1. THE Display SHALL show a Summary Card Section with the following metrics:
   - Total Egg Stock: Total available eggs across all sheds (calculated as total collected minus total sold minus total damaged)
   - Total Trays: Total number of trays available across all sheds
   - Total Eggs: Total number of individual eggs (trays × 30 plus loose eggs)
   - Today's Production: Total eggs collected across all sheds today
   - Today's Dispatch: Total eggs sold across all sheds today
   - Damaged Eggs: Total damaged + cracked eggs across all sheds today
2. FOR ALL metrics, WHEN no egg data exists, THE Display SHALL show "0" or "—"
3. FOR Total Egg Stock, THE Calculation SHALL be: Total Good Eggs + Total Damaged Eggs + Total Cracked Eggs - Total Sold Eggs
4. FOR Total Trays, THE Calculation SHALL be: (Total Stock Eggs) ÷ 30, rounded down to nearest integer
5. FOR Total Eggs, THE Calculation SHALL be: (Total Trays × 30) + Loose Eggs
6. FOR Today's Production, THE Calculation SHALL be: Sum of (good + damaged + cracked) from all egg collections today
7. FOR Today's Dispatch, THE Calculation SHALL be: Sum of (trays × 30) from all egg sales today
8. FOR Damaged Eggs, THE Calculation SHALL be: Sum of (damaged + cracked) from all egg collections today

### Requirement 3: Shed-Wise Stock Display

**User Story:** As an owner, I want to see per-shed egg stock details in a clear table or card layout, so that I can identify which sheds are performing well or have issues.

#### Acceptance Criteria

1. WHEN egg data exists for a shed, THE Display SHALL show a Shed Stock Card/Row containing:
   - Shed Name: Display the shed identifier (e.g., "Gld-1", "Br-2")
   - Current Stock: Total egg inventory for this shed (collected - sold - damaged)
   - Trays: Number of complete trays available
   - Loose Eggs: Number of eggs not in complete trays
   - Today's Production: Eggs collected today from this shed
   - Today's Dispatch: Eggs sold today from this shed
   - Damage: Number of damaged + cracked eggs today
   - Closing Stock: Stock remaining after accounting for today's production minus dispatch and damage
   - Status: Visual indicator showing stock level (e.g., HEALTHY, LOW_STOCK, CRITICAL)
2. FOR Each Shed, WHEN no egg data exists, THE Display SHALL still show the shed with zero values and HEALTHY status
3. FOR Current Stock Calculation, THE Formula SHALL be: (Sum of good + damaged + cracked eggs) - (Sum of trays × 30 eggs sold)
4. FOR Tray and Loose Eggs, THE Display SHALL show: Trays = floor(Current Stock / 30), Loose Eggs = Current Stock mod 30
5. FOR Closing Stock, THE Formula SHALL be: Opening Stock + Today's Production - Today's Dispatch - Today's Damage
6. FOR Status Calculation, THE Logic SHALL be:
   - IF Current Stock < 5000, Status = CRITICAL
   - IF Current Stock < 10000, Status = LOW_STOCK
   - IF Current Stock >= 10000, Status = HEALTHY
7. THE Display SHALL show all active sheds, including those with zero activity

### Requirement 4: Stock Movement Details

**User Story:** As an owner, I want to see a detailed breakdown of stock movements, so that I can understand the factors affecting current egg inventory levels.

#### Acceptance Criteria

1. THE Display SHALL show a Stock Movement Section with the following components:
   - Opening Stock: Total eggs available at the start of the day
   - Production: Total eggs collected today across all sheds
   - Sales/Dispatch: Total eggs sold/dispatched today across all sheds
   - Damage: Total eggs damaged (damaged + cracked) today across all sheds
   - Adjustments: Manual adjustments made to stock (if any)
   - Closing Stock: Final stock count at end of day
2. FOR Stock Movement Calculation, THE Formula SHALL be:
   - Closing Stock = Opening Stock + Production - Sales - Damage + Adjustments
3. FOR Opening Stock, WHEN no previous day data exists, THE Display SHALL show "0"
4. FOR Adjustments, WHEN no adjustments exist, THE Display SHALL show "0" and hide adjustment row
5. EACH Movement Component SHALL display its value in both count (eggs) and trays format

### Requirement 5: Filter and Search Capabilities

**User Story:** As an owner, I want to filter the stock view by various criteria, so that I can focus on specific sheds, date ranges, or egg types.

#### Acceptance Criteria

1. WHERE the owner selects "All Sheds", THE Display SHALL show data for all active sheds
2. WHERE the owner selects a specific shed, THE Display SHALL filter to show only that shed's data
3. WHERE the owner selects a date, THE Display SHALL show stock data for that specific date
4. WHERE egg type/grade filter is applied, THE Display SHALL filter based on egg quality:
   - GOOD: Show only good eggs count
   - DAMAGED: Show damaged + cracked eggs
   - ALL: Show all egg types
5. FOR Multiple Filters, WHEN combined, THE Display SHALL apply ALL selected filters simultaneously
6. FOR Filter State, WHEN filters change, THE Display SHALL update all metrics and tables in real-time
7. THE Filter Controls SHALL be accessible via filter button or expandable section

### Requirement 6: Visual Design and UI/UX

**User Story:** As an owner, I want a premium, clean, and readable interface, so that I can quickly scan and understand complex egg stock data on both desktop and mobile devices.

#### Acceptance Criteria

1. THE Page Layout SHALL use the existing project design system (Header, Card components, spacing, typography)
2. FOR Summary Cards, THE Display SHALL use large, legible numbers with clear labels and visual hierarchy
3. FOR Shed Cards, THE Layout SHALL be optimized for mobile screens with readable font sizes (minimum 14px)
4. FOR Color Coding, THE Status Indicators SHALL use:
   - GREEN for HEALTHY stock levels
   - ORANGE/YELLOW for LOW_STOCK status
   - RED for CRITICAL status
5. FOR Data Density, THE Display SHALL present information densely but without clutter, using appropriate spacing
6. FOR Responsive Design, WHEN viewed on desktop, THE Layout SHALL use multi-column grid for summary cards
7. WHEN viewed on mobile, THE Layout SHALL stack elements vertically for optimal readability
8. FOR Empty State, WHEN no sheds exist, THE Display SHALL show an empty state message: "No sheds found. Create a shed to start tracking egg stock."

### Requirement 7: Navigation Integration

**User Story:** As an owner, I want to access the Egg Stock by Shed page from the main navigation, so that I can quickly reach this report without navigating through multiple menus.

#### Acceptance Criteria

1. THE Navigation Menu SHALL include an "Egg Stock by Shed" option
2. WHERE the owner taps "Egg Stock by Shed", THE System SHALL navigate to the /egg-stock-by-shed route
3. FOR Owner-level permissions ONLY, THE Navigation Item SHALL be visible and accessible
4. WHEN navigating from other pages, THE System SHALL preserve the selected filters and date
5. THE Page SHALL include a back button that returns to the previous screen

### Requirement 8: Permission and Security

**User Story:** As an owner, I want to ensure only authorized users can access egg stock data, so that sensitive inventory information remains protected.

#### Acceptance Criteria

1. FOR Users with OWNER role, THE System SHALL grant full access to Egg Stock by Shed page
2. FOR Users without OWNER role, THE System SHALL redirect to home or show "Access Denied" message
3. THE Permission Check SHALL use the existing useCan('exportReports') hook from the application
4. FOR API Security, ALL data fetching and calculations SHALL occur client-side using existing Zustand store data
5. NO new authentication mechanisms shall be created; reuse existing session and permission system

### Requirement 9: Data Consistency and Accuracy

**User Story:** As an owner, I want accurate stock calculations that reflect real-time data, so that I can make confident operational decisions.

#### Acceptance Criteria

1. FOR Egg Stock Calculations, THE System SHALL use existing seed data from EggCollection and EggSale entities
2. FOR Daily Calculations, WHEN a specific date is selected, THE System SHALL calculate stock as of that date using historical data
3. FOR Cross-Shed Aggregation, WHEN aggregating across multiple sheds, THE System SHALL correctly sum all shed-level data
4. FOR Rounding, WHEN calculating trays from eggs, THE System SHALL use floor() to get whole trays, then calculate loose eggs as remainder
5. FOR Zero-Data Scenarios, WHEN no collections or sales exist, THE Display SHALL show "0" or "—" instead of throwing errors
6. FOR Date Calculations, THE System SHALL use the existing todayISO() and fmtDate() utility functions
7. FOR Status Updates, WHEN stock levels change due to sales or damage, THE Status SHALL update immediately in the UI

### Requirement 10: Integration with Existing Modules

**User Story:** As an owner, I want the Egg Stock by Shed page to work seamlessly with existing screens, so that I don't need to re-enter data or navigate through multiple pages.

#### Acceptance Criteria

1. THE System SHALL reuse existing types: EggCollection, EggSale, Shed, Batch
2. FOR Stock Calculation, THE System SHALL reference existing EggCollection data from the Zustand store
3. FOR Sales Data, THE System SHALL use existing EggSale entities without modification
4. FOR Shed Information, THE Display SHALL fetch shed names and IDs from existing Shed entities
5. FOR Batch Information, WHEN needed, THE System SHALL reference Batch entities to get shed associations
6. THE System SHALL NOT modify the existing Zustand store structure or add new entities
7. FOR Reusability, WHERE possible, reuse existing components: Card, Header, Button, StatusBadge
8. FOR Navigation, THE System SHALL work with existing React Router setup without modifying app routing logic

### Requirement 11: Performance and Responsiveness

**User Story:** As an owner, I want the page to load quickly and respond to interactions instantly, so that I can efficiently manage my farm operations.

#### Acceptance Criteria

1. FOR Page Load, THE System SHALL render initial view within 500ms on average mobile devices
2. FOR Filter Changes, WHEN a filter is changed, THE Display SHALL update within 100ms
3. FOR Large Datasets, WHEN more than 1000 egg collection records exist, THE Display SHALL maintain responsive performance
4. FOR Calculations, ALL stock metrics SHALL be calculated using useMemo or similar optimization techniques
5. FOR Data Fetching, NO additional API calls shall be made; all data shall come from existing Zustand store
6. FOR Re-renders, WHEN date filter changes, THE System SHALL only re-calculate affected metrics

### Requirement 12: Error Handling and Validation

**User Story:** As an owner, I want to see helpful error messages if something goes wrong, so that I know if data is missing or if I need to take action.

#### Acceptance Criteria

1. WHEN no egg collection data exists, THE System SHALL show empty state: "No egg collection records found"
2. WHEN no sales data exists, THE Display SHALL show: "No egg sales recorded yet"
3. WHEN a shed has no activity, THE Display SHALL show zero values, not error messages
4. FOR Invalid Date Selection, WHEN owner selects a future date, THE System SHALL either prevent selection or show current date data
5. FOR Calculation Errors, IF a calculation results in NaN or Infinity, THE Display SHALL show "—" instead
6. FOR Network Issues, NO network operations occur; all data is local to the Zustand store

### Requirement 13: Export and Reporting Capabilities (Future-Proof)

**User Story:** As an owner, I may want to export egg stock data in the future, so that I can share reports or perform offline analysis.

#### Acceptance Criteria

1. FOR Future-Proof Design, THE System Structure SHALL allow adding export functionality without major refactoring
2. WHERE export is enabled, THE System SHALL include an export button in the header or action bar
3. FOR Export Format, WHEN export is implemented, THE Output SHALL be CSV or Excel format
4. FOR Export Scope, THE Export SHALL include all displayed data: summary metrics, shed-wise breakdown, and stock movements
5. FOR Data Include, THE Export SHALL include: shed name, current stock, trays, loose eggs, today's production, today's dispatch, damage, closing stock, status
6. FOR Date Range, THE Export SHALL include the selected date filter in the report header
7. NO export functionality shall be implemented in this version; this requirement is for future planning only

### Requirement 14: Audit and Historical Tracking (Future-Proof)

**User Story:** As an owner, I may want to track how stock levels have changed over time, so that I can identify trends and make better decisions.

#### Acceptance Criteria

1. FOR Historical View, WHEN owner selects a past date, THE Display SHALL show stock levels as of that date
2. FOR Trend Analysis, FOR Future Enhancement, THE System Structure SHALL support adding date-range views showing stock changes over time
3. FOR Data Integrity, ALL stock calculations SHALL be traceable to source EggCollection and EggSale records
4. FOR Audit Trail, NO changes shall be made to existing audit mechanisms; reuse existing audit system
5. NO historical trend charts shall be implemented in this version; this requirement is for future planning only

### Requirement 15: Accessibility and Usability

**User Story:** As an owner, I want the interface to be accessible and easy to understand, so that I can use it effectively without training.

#### Acceptance Criteria

1. FOR Contrast, ALL text SHALL have sufficient contrast against background colors (minimum 4.5:1 ratio)
2. FOR Font Sizes, ALL text SHALL be at least 14px for readability
3. FOR Touch Targets, ALL interactive elements SHALL have minimum 44px touch area
4. FOR Status Indicators, COLOR-ONLY coding SHALL be supplemented with text labels or icons
5. FOR Loading States, WHEN calculations are in progress, THE Display SHALL show loading indicator or skeleton
6. FOR Empty States, ALL empty data areas SHALL show helpful placeholder text
7. FOR Mobile Usability, WHEN viewed on mobile, THE Layout SHALL be optimized for single-thumb navigation
8. FOR Screen Readers, ALL visual elements SHALL have appropriate ARIA labels where needed
