# AMRUT POULTRY FARM

Premium enterprise poultry farm management application.

This is an existing React application.
Preserve existing functionality unless the task explicitly authorizes
a business-logic change.

---

# 1. TECHNOLOGY

- React 19
- Vite
- TypeScript 5.7
- Tailwind CSS v4
- Zustand
- React Router
- date-fns
- Lucide

Do not migrate the technology stack.

Do not introduce a new framework.

Do not introduce a backend or database unless explicitly requested.

---

# 2. DEVELOPMENT SERVER

A Vite development server is already running on `$PORT`.

DO NOT start another development server.

Use the existing preview.

Hot reload is enabled.

---

# 3. IMPORTANT: WORK EFFICIENTLY

The repository may be large.

DO NOT inspect the entire repository for every task.

Start with the files directly relevant to the requested screen.

Only follow imports when necessary.

Do not repeatedly reread files that have already been inspected.

Do not repeatedly inspect unrelated modules.

Prefer targeted changes over broad rewrites.

---

# 4. BEFORE CODING

For every task:

1. Identify the affected screen.
2. Identify its route.
3. Identify its main component.
4. Identify the components it actually uses.
5. Identify the relevant store/selectors only if necessary.
6. Make the smallest safe set of changes.
7. Validate the result.

Do NOT perform a full-project audit unless explicitly requested.

---

# 5. VISUAL / UI TASKS

For visual redesign tasks, prioritize:

- layout
- spacing
- typography
- colors
- cards
- surfaces
- borders
- shadows
- buttons
- inputs
- tables
- charts
- responsive behavior
- loading states
- empty states
- error states
- information hierarchy

Prefer CSS/Tailwind/component changes.

Do not rewrite business logic for visual improvements.

---

# 6. FUNCTIONALITY PROTECTION

Unless the task explicitly says otherwise, DO NOT CHANGE:

- business calculations
- data models
- Zustand store behavior
- authentication
- authorization
- roles
- permissions
- company isolation
- persistence
- localStorage schema
- CRUD behavior
- existing workflows
- stock calculations
- egg calculations
- sale calculations
- trader calculations
- feed calculations
- formula versioning
- mortality calculations
- finance calculations
- day-lock behavior
- audit behavior
- route semantics
- navigation destinations

If an existing action works, keep its behavior exactly the same.

---

# 7. PREMIUM DESIGN SYSTEM

The product should look like a multi-million-dollar enterprise
software product.

Use one consistent design language.

Do not create independent styles for each screen.

Primary brand direction:

Deep Forest Green:
#123C2A
#164A35
#1B5E3B

Premium Gold:
#C9972E
#D9A441
#E0B04B

Warm background:
#F7F8F5
#F5F6F2
#FAFAF8

Surface:
#FFFFFF

Primary text:
#17201B

Secondary text:
#66706A

Borders:
#E3E7E3

Use semantic green/red/amber colors carefully.

Avoid neon colors.

Avoid rainbow palettes.

Avoid excessive gradients.

Avoid excessive shadows.

Avoid generic blue/purple SaaS styling.

---

# 8. PREMIUM COMPONENT STYLE

Prefer:

- 16–20px card radius
- 8–12px control radius
- subtle 1px borders
- very soft shadows
- generous spacing
- strong typography hierarchy
- tabular numerals for financial values
- consistent Lucide icons

Do not make every element a card.

Do not make every element a pill.

Premium means restrained and intentional.

---

# 9. RESPONSIVE DESIGN

Design for:

- 360px
- 390px
- 430px
- tablet
- 1280px+
- 1440px+
- large desktop

Do not simply shrink desktop layouts.

Maintain usable touch targets.

---

# 10. DATA

Never invent production data, financial data, inventory data,
sales data, mortality data, or chart data.

Use existing application data.

If data is unavailable, show an appropriate empty state.

Do not silently convert missing financial information into zero.

---

# 11. FINANCE

Finance is an important enterprise module.

The Finance UI may contain:

- financial summary
- income
- expenses
- balance
- financial trends
- expense breakdown
- income breakdown
- shed-wise financial performance
- batch-wise financial performance
- Godown inventory value
- Godown ledger
- shared Godown expenses
- shortages
- recent transactions
- full transaction ledger

If the task explicitly authorizes accounting changes,
follow the task-specific accounting instructions.

Otherwise preserve existing accounting behavior.

---

# 12. GODOWN ACCOUNTING

When explicitly requested by the Finance accounting specification:

Godown inventory is separate from Shed P&L.

Feed purchased into Godown is inventory.

Feed consumed by a Shed becomes that Shed's expense.

Godown shortages must be visible.

Shared Godown expenses may be allocated to Sheds only when an
explicit allocation rule is defined.

Never double-count inventory and consumption.

---

# 13. QUICK ADD

Do not add generic "+ Quick Add" buttons everywhere.

Use contextual actions.

Examples:

Godown:
Feed In / Feed Out / Adjustment

Eggs:
Add Collection

Shed:
Add Shed

Batch:
Create Batch

Formula:
Create / Edit / Duplicate

Trader:
Add Trader / Record Payment

---

# 14. COMPONENT REUSE

Before creating a new component:

Check whether an existing component already performs the same
visual function.

Prefer extending reusable components rather than duplicating them.

Examples:

- Card
- Button
- Dialog
- FormField
- PageHeader
- DataTable
- ChartCard
- StatusBadge
- EmptyState
- LoadingSkeleton

Do not create five visually different versions of the same component.

---

# 15. IMPLEMENTATION SPEED

Work in focused batches.

For a screen redesign:

1. Inspect screen.
2. Identify existing components.
3. Make the visual changes.
4. Run a targeted type/build check.
5. Continue.

Do not stop after every tiny CSS change.

Do not repeatedly run expensive full-project analysis.

Group related visual changes into one coherent edit.

---

# 16. DO NOT OVER-ENGINEER

Do not introduce abstractions unless they are actually reused.

Do not create unnecessary files.

Do not refactor unrelated code.

Do not rename unrelated components.

Do not reorganize the entire repository for a screen-level task.

Do not rewrite working code simply because another implementation
looks cleaner.

---

# 17. VALIDATION

After a meaningful batch of changes:

Run:

npx tsc --noEmit

If the task affects the production build, run:

npm run build

Do not repeatedly run both commands after every tiny edit.

Fix errors before continuing.

---

# 18. WHEN A TASK IS LARGE

If a task affects many screens:

Work in phases.

Example:

Phase 1:
Design system

Phase 2:
Shared components

Phase 3:
Dashboard

Phase 4:
Operations

Phase 5:
Finance

Phase 6:
Inventory

Phase 7:
Mobile refinement

Do not attempt an uncontrolled full-project rewrite.

---

# 19. VISUAL QUALITY STANDARD

Every redesigned screen should answer:

What is this page?

What is most important?

What action matters?

What information is primary?

What information is secondary?

Can the user scan it quickly?

Does it feel like the same product as every other screen?

---

# 20. FINISHING RULE

Do not declare a screen complete merely because it compiles.

Check:

- desktop
- mobile
- spacing
- alignment
- typography
- color consistency
- overflow
- loading
- empty
- error
- interaction states

Then stop.

Do not continue making unrelated improvements.

---

# 21. CRITICAL RULE

When the user asks for a visual change:

CHANGE THE LOOK.

Do not unnecessarily change:

DATA
LOGIC
CALCULATIONS
WORKFLOWS
PERMISSIONS
STORAGE
ROUTES

When the user explicitly asks for a business-logic change,
that specific request overrides this visual-only rule.

---

# 22. COMMUNICATION

Before making changes, briefly state:

- what files are relevant
- what you will change
- what you will leave untouched

Then execute.

Do not spend a long response explaining obvious implementation details.

After completion, report:

- files changed
- what changed
- validation performed
- any remaining issue

Keep the report concise.


# 23. AGENT PERFORMANCE RULES

The priority is:

FAST INSPECTION
→ FAST IMPLEMENTATION
→ TARGETED VALIDATION
→ STOP

Do not spend excessive time planning when the required change is
already clear.

Do not repeatedly explain the plan.

Do not repeatedly inspect the same files.

Do not repeatedly validate unrelated parts of the project.

---

# 24. FILE INSPECTION RULES

For a screen-level task:

1. Find the route.
2. Find the page component.
3. Read the page component.
4. Read only the components directly used by that page.
5. Read only the relevant store/selectors.
6. Implement.

Follow additional imports only when required to understand or safely
modify the requested behavior.

Do NOT scan the entire src directory unless the task explicitly
requires application-wide changes.

---

# 25. NEVER INSPECT GENERATED / THIRD-PARTY FILES

Do NOT spend time inspecting:

- node_modules/
- dist/
- build/
- generated files
- cache directories
- lockfiles unless dependency changes are required
- compiled output

Treat these as implementation artifacts.

---

# 26. USE TARGETED SEARCH

Prefer targeted repository search over opening large numbers of files.

Search for:

- route name
- component name
- store name
- selector name
- exact UI text
- relevant model/type

Once the relevant implementation is found, stop searching unrelated
areas.

Do not search the repository repeatedly for the same symbol.

---

# 27. DO NOT RE-READ KNOWN FILES

Once a file has been inspected during the current task:

- remember its relevant structure
- reuse that understanding
- do not reopen it unless the implementation changed or additional
  context is genuinely required

Avoid repeated read → think → read → think cycles.

---

# 28. EDIT IN COHERENT BATCHES

Do not make one tiny edit at a time.

Group related changes.

Example:

Instead of:

change card radius
→ validate
→ change card padding
→ validate
→ change card shadow
→ validate
→ change card typography
→ validate

Do:

card styling
+
spacing
+
typography
+
shadow
+
responsive behavior

in one coherent edit.

Then validate once.

---

# 29. VALIDATION FREQUENCY

Do not run full validation after every tiny visual change.

For visual-only work:

Make a meaningful batch of changes.

Then run:

npx tsc --noEmit

Run:

npm run build

when:

- the task is substantial
- routing changed
- imports changed significantly
- dependencies changed
- TypeScript structure changed
- the user asks for final validation

Do not repeatedly run expensive validation commands when only
minor CSS changes were made.

---

# 30. VISUAL TASK OPTIMIZATION

For visual redesign tasks:

Prioritize the page component and reusable UI components.

Do not inspect business logic unless the visual implementation
actually depends on it.

Do not inspect unrelated stores.

Do not inspect unrelated routes.

Do not refactor business logic merely because the UI is being
redesigned.

---

# 31. REUSE BEFORE CREATE

Before creating a component:

Search for an existing equivalent.

Prefer:

existing Card
existing Button
existing Dialog
existing Table
existing Form
existing Chart
existing PageHeader

over creating a new duplicate.

If an existing component can be improved globally without changing
its behavior, prefer that over creating another component.

---

# 32. DESIGN SYSTEM FIRST

When multiple screens require the same visual treatment:

Change the shared design system/component once.

Do NOT individually recreate the same styling on every screen.

Examples:

If all cards need:

- new radius
- new border
- new shadow
- new padding

update the shared Card styling.

If all buttons need a premium appearance:

update the shared Button styling.

This is faster and creates consistency.

---

# 33. AVOID UNNECESSARY REFACTORING

Do NOT:

- rename unrelated files
- reorganize folders
- rewrite components that already work
- replace working patterns
- introduce new state-management patterns
- replace libraries
- migrate CSS architecture
- clean unrelated code
- fix unrelated warnings

Only change what is required for the requested task.

---

# 34. NO DEPENDENCY CHANGES FOR VISUAL POLISH

For normal visual redesign tasks:

Do not install new packages.

Use the existing:

React
Tailwind
Lucide
existing chart library
existing UI components

Only add a dependency when it is genuinely necessary and explicitly
approved by the task.

---

# 35. DO NOT OVER-PLAN

Do not spend a large amount of time producing an elaborate plan for
a straightforward UI change.

For a clear task:

Inspect
→ implement
→ validate
→ report

Use a detailed plan only when the task genuinely requires
multi-stage architectural work.

---

# 36. DO NOT WAIT FOR USER CONFIRMATION

If the requested implementation is clear:

execute it.

Do not stop after inspection and ask:

"Should I proceed?"

Do not stop after creating a plan and ask:

"Would you like me to implement this?"

Proceed unless an actual ambiguity would make the implementation
unsafe.

---

# 37. STOP CONDITIONS

Stop when:

- requested change is implemented
- affected screen works
- TypeScript passes
- required build passes
- no obvious regression exists

Do NOT continue making unrelated improvements.

Do NOT keep polishing indefinitely.

---

# 38. REPORTING

After completion, provide only:

CHANGED:
- file/component
- file/component

RESULT:
- short description

VALIDATION:
- tsc
- build

ISSUES:
- only if something remains

Do not provide a long implementation diary.

# 39. SCREEN-LOCKED IMPLEMENTATION

When the user requests a specific screen:

Treat that screen as the active workspace.

Do not modify other screens unless:

1. the requested screen directly depends on a shared component, or
2. the change is necessary for consistency, or
3. the user explicitly requests application-wide changes.

Example:

If the task is Finance:

Primarily inspect and modify Finance-related files.

Do not redesign Dashboard, Godown, Traders, Sheds, or Settings
at the same time.

If a shared Card component is changed, verify that its existing
behavior remains compatible with other screens, but do not redesign
those screens unnecessarily.


# FAST MODE

Unless the task explicitly requests architecture or repository-wide
work, operate in FAST MODE.

FAST MODE means:

- inspect only task-relevant files
- no full repository audit
- no repeated file reads
- no unrelated refactoring
- no dependency installation
- no broad architectural analysis
- no repeated build commands
- batch related edits
- reuse existing components
- make the smallest safe change
- validate once after the batch
- stop when complete

The user's requested screen is the highest-priority scope.

USER REQUEST
     ↓
Identify screen
     ↓
Find route
     ↓
Find page component
     ↓
Find direct UI components
     ↓
Find only relevant store/selectors
     ↓
Implement in one batch
     ↓
Preview
     ↓
TypeScript check
     ↓
Build if needed
     ↓
STOP

User request
 ↓
Scan whole repo
 ↓
Read 40 files
 ↓
Analyze architecture
 ↓
Read same files again
 ↓
Make one CSS change
 ↓
Build
 ↓
Scan repo again
 ↓
Refactor unrelated component
 ↓
Build again
 ↓
Explain
 ↓
Continue...