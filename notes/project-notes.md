# Payroll Project Notes

## Purpose
This app is a payroll workspace for managing multiple clients, multiple employees per client, payroll runs, pay stubs, and payroll table references for Ontario payroll processing.

## Current structure
- Frontend: Vite + React
- Backend: Node/Express
- Database: SQLite
- Main app file: `src/AppV2.tsx`
- Payroll logic: `src/lib/payroll.ts`
- Tax table config: `src/lib/taxTables.ts`
- Pay stub PDF/print template: `src/lib/payStubTemplate.ts`

## Core payroll rules agreed in this chat
- CPP, CPP2, and EI must respect yearly maximums using YTD totals.
- TD1 federal and provincial claim amounts are built into tax withholding logic.
- The app should stay as close as possible to CRA PDOC/T4127 results without unnecessary complexity.
- Vacation accrued and vacation paid are different:
  - Vacation accrued affects liability and balance.
  - Vacation paid affects current gross pay, tax, CPP, and EI on that run.
- For PDOC comparison:
  - If CRA PDOC includes vacation pay as cash income, the app must use `Vacation paid this run`, not only vacation accrual.
- Salary override should be available on a payroll run and support a reason selected from an admin-managed list.

## Vacation handling behavior
- Employee setup includes a vacation percentage such as `4%`.
- Payroll run supports 3 vacation modes:
  - `Pay vacation automatically`
  - `Accrue vacation only`
  - `Custom vacation payout`
- `Pay vacation automatically` should calculate vacation paid using the employee's vacation percentage.
- `Accrue vacation only` should not pay vacation on that run.
- `Custom vacation payout` should enable the payout field and allow manual adjustment.

## Pay stub requirements decided
- Pay stub should include:
  - pay period
  - current values
  - YTD values
  - gross pay
  - deductions
  - net pay
  - vacation accrual and vacation balance
- Pay stub should show:
  - payroll preparer / accountant company details
  - client company details
  - employee details
- Pay stub PDF should use a traditional payroll statement look, closer to ADP than a modern dashboard card layout.
- Pay stub should be optimized for print/PDF and aim to fit on one page when practical.
- A detachable lower advice section is included in the current classic template.

## Multi-client / admin decisions
- Admin dashboard should support:
  - company settings
  - client settings
  - payroll tables
- The app should support:
  - multiple clients
  - multiple employees under each client
- Accountant company name and client company name should appear on the pay stub.
- Company logo, company information, and client information should be editable.
- Client delete action should remove related employees and pay runs cleanly.

## Employee form expectations
- Employee form should feel closer to a QuickBooks employee form.
- Important employee fields requested:
  - first name
  - last name
  - full name
  - employee number
  - address
  - DOB
  - hire date
  - email
  - phone
  - role
  - employment type
  - payroll tax settings
  - default regular hours per period

## UI/UX decisions from this chat
- Application should feel more premium and user-friendly.
- Pay period start and end fields should stay together.
- Payroll history should appear in a separate row/table style, not bulky stacked cards.
- Current vs YTD information should be easier to compare.
- Admin panel should stay organized and avoid one long form.
- Field labels and required settings should be customizable in Admin for:
  - payroll form
  - employee form
  - client form

## CRA / payroll table decisions
- Payroll table values are centralized by year in `src/lib/taxTables.ts`.
- App should clearly show which payroll table / tax year is active.
- A safe CRA update workflow is preferred over brittle scraping.
- Admin dashboard includes links/workflow for reviewing CRA payroll formula sources.
- For future years, add a new tax table entry rather than scattering changes through the calculator.

## PDOC matching notes
- The app was tested against a CRA PDOC example using:
  - Ontario
  - monthly salary `8000`
  - vacation pay `320`
  - Federal TD1 `16452`
  - Provincial TD1 `12989`
- Matching logic depends on modeling the scenario correctly:
  - if CRA case is paying vacation now, the app must use vacation paid now
  - not vacation accrued only

## Useful run commands
From the project folder:

```powershell
npm run dev
```

Backend only:

```powershell
npm run dev:server
```

Production build:

```powershell
npm run build
```

## Current follow-up ideas
- Add a simpler internal PDOC comparison tool for test cases.
- Continue refining the classic pay stub layout so it matches the reference even more closely.
- Add clearer inline explanations for vacation calculations.
- Consider opening YTD balance inputs/imports for mid-year onboarding.
