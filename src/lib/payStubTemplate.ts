import { formatCurrency, getFrequencyLabel } from "./payroll.js";
import type { Client, CompanyProfile, Employee, PayFrequency, PayRunDraft, PayStubTotals, TaxTableSummary } from "../types.js";

type StubRow = {
  label: string;
  currentAmount?: number;
  ytdAmount?: number;
  total?: boolean;
};

type EarningsRow = {
  label: string;
  rate?: string;
  currentUnits?: string;
  currentAmount?: string;
  ytdUnits?: string;
  ytdAmount?: string;
};

export type PayStubTemplateInput = {
  runId: string;
  employeeName: string;
  employeeRole: string;
  employee?: Employee;
  companyProfile?: CompanyProfile;
  client?: Client;
  draft?: PayRunDraft;
  current: PayStubTotals;
  ytd?: PayStubTotals;
  taxTable?: TaxTableSummary;
  createdAt: string;
  payFrequency: PayFrequency;
  notes?: string[];
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const formatStatementDate = (value: string) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
};

const decimal = (value?: number, digits = 2) => (value == null ? "" : value.toFixed(digits));
const blankIfZero = (value?: number, digits = 2) => (value == null || Math.abs(value) < 0.0001 ? "" : value.toFixed(digits));
const blankMoneyIfZero = (value?: number) => (value == null || Math.abs(value) < 0.0001 ? "" : formatCurrency(value));
const textOrDash = (value?: string) => (value && value.trim() ? value.trim() : "—");

const renderMoneyRows = (rows: StubRow[]) =>
  rows
    .map(
      (row) => `<tr${row.total ? ' class="total-row"' : ""}>
        <td>${escapeHtml(row.label)}</td>
        <td>${escapeHtml(blankMoneyIfZero(row.currentAmount) || (row.total ? formatCurrency(row.currentAmount ?? 0) : ""))}</td>
        <td>${escapeHtml(blankMoneyIfZero(row.ytdAmount) || (row.total ? formatCurrency(row.ytdAmount ?? 0) : ""))}</td>
      </tr>`,
    )
    .join("");

const renderEarningsRows = (rows: EarningsRow[]) =>
  rows
    .map(
      (row) => `<tr>
        <td>${escapeHtml(row.label)}</td>
        <td>${escapeHtml(row.rate ?? "")}</td>
        <td>${escapeHtml(row.currentUnits ?? "")}</td>
        <td>${escapeHtml(row.currentAmount ?? "")}</td>
        <td>${escapeHtml(row.ytdUnits ?? "")}</td>
        <td>${escapeHtml(row.ytdAmount ?? "")}</td>
      </tr>`,
    )
    .join("");

export const buildClassicPayStubMarkup = ({
  runId,
  employeeName,
  employeeRole,
  employee,
  companyProfile,
  client,
  draft,
  current,
  ytd,
  taxTable,
  createdAt,
  payFrequency,
}: PayStubTemplateInput) => {
  const employerName = companyProfile?.legalName || companyProfile?.name || "Payroll provider";
  const clientName = client?.legalName || client?.name || "Client company";
  const displayName = employee?.fullName || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim() || employeeName;
  const payDate = formatStatementDate(createdAt || draft?.payPeriodEnd || "");
  const payStartDate = formatStatementDate(draft?.payPeriodStart || "");
  const payEndDate = formatStatementDate(draft?.payPeriodEnd || "");
  const employeeNumber = employee?.employeeNumber || runId;
  const employeeAddress = [employee?.addressLine1, employee?.addressLine2, [employee?.city, employee?.province].filter(Boolean).join(", "), employee?.postalCode]
    .filter(Boolean)
    .join("<br />");
  const periodsPerYear =
    payFrequency === "weekly" ? 52 : payFrequency === "biweekly" ? 26 : payFrequency === "semi-monthly" ? 24 : 12;
  const salaryRate = employee?.annualSalary ? employee.annualSalary / periodsPerYear : 0;
  const regularRate = employee?.employmentType === "salary" ? salaryRate : employee?.hourlyRate ?? 0;
  const overtimeRate = employee?.hourlyRate ? employee.hourlyRate * 1.5 : 0;
  const earningsRows: EarningsRow[] = [
    {
      label: "Regular pay",
      rate: regularRate > 0 ? formatCurrency(regularRate) : "",
      currentUnits: current.regularHours > 0 ? decimal(current.regularHours) : "",
      currentAmount: formatCurrency(
        current.grossRegular ||
          (employee?.employmentType === "salary"
            ? current.grossPay - current.grossOvertime - current.bonusAmount - current.taxableBenefits - current.vacationPaid
            : current.grossRegular),
      ),
      ytdUnits: ytd?.regularHours != null ? decimal(ytd.regularHours) : "",
      ytdAmount: ytd?.grossRegular != null ? formatCurrency(ytd.grossRegular) : "",
    },
    {
      label: "Overtime pay",
      rate: overtimeRate > 0 ? formatCurrency(overtimeRate) : "",
      currentUnits: blankIfZero(current.overtimeHours),
      currentAmount: blankMoneyIfZero(current.grossOvertime),
      ytdUnits: ytd?.overtimeHours != null ? blankIfZero(ytd.overtimeHours) : "",
      ytdAmount: blankMoneyIfZero(ytd?.grossOvertime),
    },
    {
      label: "Bonus",
      currentAmount: blankMoneyIfZero(current.bonusAmount),
      ytdAmount: blankMoneyIfZero(ytd?.bonusAmount),
    },
    {
      label: "Vacation pay",
      rate: draft?.vacationHandling === "pay" ? `${decimal((employee?.vacationRate ?? 0) * 100)}%` : "",
      currentAmount: blankMoneyIfZero(current.vacationPaid),
      ytdAmount: blankMoneyIfZero(ytd?.vacationPaid),
    },
    {
      label: "Taxable benefits",
      currentAmount: blankMoneyIfZero(current.taxableBenefits),
      ytdAmount: blankMoneyIfZero(ytd?.taxableBenefits),
    },
  ];

  const leftDeductions: StubRow[] = [
    { label: "CPP", currentAmount: current.cpp, ytdAmount: ytd?.cpp },
    { label: "CPP2", currentAmount: current.cpp2, ytdAmount: ytd?.cpp2 },
    { label: "EI", currentAmount: current.ei, ytdAmount: ytd?.ei },
    { label: "RRSP / RPP", currentAmount: current.rrspRppPrppContribution, ytdAmount: ytd?.rrspRppPrppContribution },
    { label: "Union dues", currentAmount: current.unionDues, ytdAmount: ytd?.unionDues },
  ];
  const rightDeductions: StubRow[] = [
    { label: "Federal tax", currentAmount: current.federalTax, ytdAmount: ytd?.federalTax },
    { label: "Ontario tax", currentAmount: current.provincialTax, ytdAmount: ytd?.provincialTax },
    { label: "Total deductions", currentAmount: current.totalDeductions, ytdAmount: ytd?.totalDeductions, total: true },
  ];
  const otherRows: StubRow[] = [
    { label: "Vacation accrual", currentAmount: current.vacationAccrual, ytdAmount: ytd?.vacationAccrual },
    { label: "Vacation balance", currentAmount: current.vacationBalance, ytdAmount: ytd?.vacationBalance },
    { label: "Employer CPP", currentAmount: current.employerCpp, ytdAmount: ytd?.employerCpp },
    { label: "Employer CPP2", currentAmount: current.employerCpp2, ytdAmount: ytd?.employerCpp2 },
    { label: "Employer EI", currentAmount: current.employerEi, ytdAmount: ytd?.employerEi },
  ];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Pay Stub - ${escapeHtml(employeeName)}</title>
    <style>
      @page { size: Letter portrait; margin: 0.32in; }
      :root {
        color-scheme: light;
        font-family: Arial, Helvetica, sans-serif;
        --ink: #111;
        --muted: #575757;
        --line: #1f1f1f;
        --soft-line: #a9a9a9;
        --paper: #fff;
        --wash: #f5f5f5;
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: #ececec; color: var(--ink); padding: 18px; }
      .sheet { width: 8.15in; margin: 0 auto; background: var(--paper); border: 1px solid #cfcfcf; box-shadow: 0 8px 24px rgba(0,0,0,0.08); padding: 0.22in 0.24in 0.16in; }
      .topbar { display: grid; grid-template-columns: minmax(0,1fr) 1.95in; gap: 0.18in; align-items: start; }
      .identity { display: grid; grid-template-columns: 0.95in minmax(0,1fr); gap: 0.12in; align-items: start; }
      .logo-wrap { width: 0.88in; min-height: 0.7in; display: flex; align-items: center; justify-content: center; }
      .logo-wrap img { max-width: 100%; max-height: 0.72in; object-fit: contain; }
      .mono-badge { width: 0.68in; height: 0.68in; border: 1px solid var(--line); display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 0.2in; letter-spacing: 0.04em; }
      .identity-copy { display: grid; gap: 2px; font-size: 10px; line-height: 1.25; }
      .identity-copy .eyebrow { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
      .identity-copy strong { font-size: 15px; line-height: 1.15; }
      .meta-box { border: 1px solid var(--line); }
      .meta-box table, .summary-box table, .earnings-table, .deduction-table, .other-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .meta-box td, .summary-box td { border-bottom: 1px solid var(--line); padding: 6px 8px; font-size: 10px; }
      .meta-box tr:last-child td, .summary-box tr:last-child td { border-bottom: none; }
      .meta-box td:first-child, .summary-box td:first-child { width: 44%; font-weight: 700; background: var(--wash); text-transform: uppercase; letter-spacing: 0.05em; font-size: 8px; }
      .stub-title { margin: 0.16in 0 0.12in; text-align: center; }
      .stub-title h1 { margin: 0; font-size: 18px; letter-spacing: 0.03em; text-transform: uppercase; }
      .stub-title p { margin: 4px 0 0; font-size: 9px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.09em; }
      .statement { border: 1.5px solid var(--line); }
      .employee-strip { display: grid; grid-template-columns: 1.65in minmax(0,1fr); border-bottom: 1px solid var(--line); }
      .employee-name { padding: 10px 10px 8px; border-right: 1px solid var(--line); min-height: 1.16in; }
      .employee-name .eyebrow { font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
      .employee-name strong { display: block; margin-top: 6px; font-size: 24px; line-height: 0.95; word-break: break-word; }
      .employee-facts { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); }
      .fact { padding: 8px 10px; border-right: 1px solid var(--soft-line); }
      .fact:last-child { border-right: none; }
      .fact .label { display: block; font-size: 8px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
      .fact .value { display: block; margin-top: 4px; font-size: 11px; line-height: 1.3; }
      .main-grid { display: grid; grid-template-columns: 58% 42%; }
      .earnings-area { border-right: 1px solid var(--line); }
      .pane-title { padding: 6px 8px; border-bottom: 1px solid var(--line); background: var(--wash); font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; }
      .earnings-table th, .earnings-table td, .deduction-table th, .deduction-table td, .other-table th, .other-table td { padding: 4px 6px; border-bottom: 1px solid #dcdcdc; font-size: 10px; vertical-align: top; }
      .earnings-table th, .deduction-table th, .other-table th { background: #fafafa; text-transform: uppercase; letter-spacing: 0.06em; font-size: 8px; }
      .earnings-table th:nth-child(1) { width: 26%; text-align: left; }
      .earnings-table th:nth-child(2) { width: 14%; text-align: right; }
      .earnings-table th:nth-child(3) { width: 14%; text-align: right; }
      .earnings-table th:nth-child(4) { width: 16%; text-align: right; }
      .earnings-table th:nth-child(5) { width: 14%; text-align: right; }
      .earnings-table th:nth-child(6) { width: 16%; text-align: right; }
      .earnings-table td:nth-child(n+2), .deduction-table td:nth-child(n+2), .other-table td:nth-child(n+2) { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .earnings-table td:first-child, .deduction-table td:first-child, .other-table td:first-child { text-align: left; }
      .gross-row td, .net-row td, .total-row td { font-weight: 700; }
      .gross-row td, .net-row td { border-top: 1.5px solid var(--line); border-bottom: 1.5px solid var(--line); }
      .gross-pay, .net-pay-banner { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; padding: 8px 10px; font-size: 12px; font-weight: 700; }
      .gross-pay { border-top: 1px solid var(--line); }
      .gross-pay strong, .net-pay-banner strong { font-size: 19px; letter-spacing: 0.01em; white-space: nowrap; }
      .right-stack { display: grid; grid-template-rows: auto auto 1fr; }
      .right-block { border-bottom: 1px solid var(--line); }
      .right-block:last-child { border-bottom: none; }
      .net-pay-banner { border-top: 1.5px solid var(--line); }
      .lower-grid { border-top: 1px solid var(--line); min-height: 1.35in; }
      @media print {
        body { background: white; padding: 0; }
        .sheet { width: auto; border: none; box-shadow: none; padding: 0; }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <section class="topbar">
        <div class="identity">
          <div class="logo-wrap">
            ${companyProfile?.logoUrl
              ? `<img src="${escapeHtml(companyProfile.logoUrl)}" alt="${escapeHtml(companyProfile.name)} logo" />`
              : `<div class="mono-badge">${escapeHtml((companyProfile?.name ?? "MT").slice(0, 2).toUpperCase())}</div>`}
          </div>
          <div class="identity-copy">
            <span class="eyebrow">Payroll prepared by</span>
            <strong>${escapeHtml(employerName)}</strong>
            <span>${escapeHtml(textOrDash(companyProfile?.contactName))}</span>
            <span>${escapeHtml(textOrDash(companyProfile?.addressLine1))}</span>
            ${companyProfile?.addressLine2 ? `<span>${escapeHtml(companyProfile.addressLine2)}</span>` : ""}
            <span>${escapeHtml([companyProfile?.city, companyProfile?.province].filter(Boolean).join(", "))} ${escapeHtml(companyProfile?.postalCode ?? "")}</span>
          </div>
        </div>
        <div class="meta-box">
          <table><tbody>
            <tr><td>Pay date</td><td>${escapeHtml(payDate)}</td></tr>
            <tr><td>Pay end date</td><td>${escapeHtml(payEndDate)}</td></tr>
            <tr><td>Pay period</td><td>${escapeHtml(`${payStartDate} to ${payEndDate}`)}</td></tr>
            <tr><td>Frequency</td><td>${escapeHtml(getFrequencyLabel(payFrequency))}</td></tr>
            <tr><td>Tax table</td><td>${escapeHtml(taxTable?.label ?? "Saved payroll table")}</td></tr>
          </tbody></table>
        </div>
      </section>
      <section class="stub-title">
        <h1>Statement of Earnings and Deductions</h1>
        <p>${escapeHtml(clientName)} payroll statement</p>
      </section>
      <section class="statement">
        <div class="employee-strip">
          <div class="employee-name">
            <span class="eyebrow">Employee</span>
            <strong>${escapeHtml(displayName)}</strong>
          </div>
          <div class="employee-facts">
            <div class="fact"><span class="label">Employee ID</span><span class="value">${escapeHtml(employeeNumber)}</span></div>
            <div class="fact"><span class="label">Client company</span><span class="value">${escapeHtml(clientName)}</span></div>
            <div class="fact"><span class="label">Address</span><span class="value">${employeeAddress || "Address not entered"}</span></div>
            <div class="fact"><span class="label">Role / type</span><span class="value">${escapeHtml(employeeRole)}<br />${escapeHtml(employee?.employmentType ?? "saved run")}</span></div>
          </div>
        </div>
        <div class="main-grid">
          <div class="earnings-area">
            <div class="pane-title">Earnings</div>
            <table class="earnings-table">
              <thead><tr><th>Earnings</th><th>Rate</th><th>Current hrs/units</th><th>Current amount</th><th>YTD hrs/units</th><th>YTD amount</th></tr></thead>
              <tbody>
                ${renderEarningsRows(earningsRows)}
                <tr class="gross-row"><td>Total earnings</td><td></td><td></td><td>${escapeHtml(formatCurrency(current.grossPay))}</td><td></td><td>${escapeHtml(formatCurrency(ytd?.grossPay ?? 0))}</td></tr>
              </tbody>
            </table>
            <div class="gross-pay"><span>Gross pay before deductions</span><strong>${escapeHtml(formatCurrency(current.grossPay))}</strong></div>
          </div>
          <div class="right-stack">
            <div class="right-block">
              <div class="pane-title">Deductions</div>
              <table class="deduction-table"><thead><tr><th>Deductions</th><th>Current amount</th><th>YTD amount</th></tr></thead><tbody>${renderMoneyRows(leftDeductions)}</tbody></table>
            </div>
            <div class="right-block">
              <div class="pane-title">Income tax</div>
              <table class="deduction-table"><thead><tr><th>Deductions</th><th>Current amount</th><th>YTD amount</th></tr></thead><tbody>${renderMoneyRows(rightDeductions)}</tbody></table>
            </div>
            <div class="net-pay-banner"><span>Net pay</span><strong>${escapeHtml(formatCurrency(current.netPay))}</strong></div>
          </div>
        </div>
        <div class="lower-grid">
          <div class="other-panel">
            <div class="pane-title">Other</div>
            <table class="other-table"><thead><tr><th>Other</th><th>Current</th><th>YTD</th></tr></thead><tbody>${renderMoneyRows(otherRows)}</tbody></table>
          </div>
        </div>
      </section>
    </main>
  </body>
</html>`;
};
