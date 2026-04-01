import { formatCurrency } from "./payroll.js";
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
  const displayName = employee?.fullName || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim() || employeeName;
  const payDate = formatStatementDate(createdAt || draft?.payPeriodEnd || "");
  const payStartDate = formatStatementDate(draft?.payPeriodStart || "");
  const payEndDate = formatStatementDate(draft?.payPeriodEnd || "");
  const employeeAddress = [employee?.addressLine1, employee?.addressLine2, [employee?.city, employee?.province].filter(Boolean).join(", "), employee?.postalCode]
    .filter(Boolean)
    .join(", ");
  const employerAddress = [companyProfile?.addressLine1, companyProfile?.addressLine2, [companyProfile?.city, companyProfile?.province].filter(Boolean).join(", "), companyProfile?.postalCode]
    .filter(Boolean)
    .join(", ");
  const periodsPerYear =
    payFrequency === "weekly" ? 52 : payFrequency === "biweekly" ? 26 : payFrequency === "semi-monthly" ? 24 : 12;
  const salaryRate = employee?.annualSalary ? employee.annualSalary / periodsPerYear : 0;
  const isSalary = employee?.employmentType === "salary";
  const regularRate = isSalary ? salaryRate : employee?.hourlyRate ?? 0;
  const formatHoursClock = (value: number) => {
    const totalMinutes = Math.max(0, Math.round(value * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    return `${hours}:${String(minutes).padStart(2, "0")}`;
  };
  const deduction = (value: number) => (Math.abs(value) < 0.0001 ? "" : `-${formatCurrency(Math.abs(value))}`);
  const incomeTaxCurrent = current.federalTax + current.provincialTax;
  const incomeTaxYtd = (ytd?.federalTax ?? 0) + (ytd?.provincialTax ?? 0);

  const earningsRows = [
    `<tr>
      <td>${escapeHtml(employee?.employmentType === "salary" ? "Salary" : "Hourly Salary")}</td>
      <td>${escapeHtml(current.regularHours > 0 ? formatHoursClock(current.regularHours) : "")}</td>
      <td>${escapeHtml(!isSalary && regularRate > 0 ? formatCurrency(regularRate) : "")}</td>
      <td>${escapeHtml(blankMoneyIfZero(current.grossRegular))}</td>
      <td>${escapeHtml(blankMoneyIfZero(ytd?.grossRegular))}</td>
    </tr>`,
    `<tr>
      <td>Overtime</td>
      <td>${escapeHtml(blankIfZero(current.overtimeHours) ? formatHoursClock(current.overtimeHours) : "")}</td>
      <td>${escapeHtml(regularRate > 0 ? formatCurrency(regularRate * 1.5) : "")}</td>
      <td>${escapeHtml(blankMoneyIfZero(current.grossOvertime))}</td>
      <td>${escapeHtml(blankMoneyIfZero(ytd?.grossOvertime))}</td>
    </tr>`,
  ];
  if (!isSalary) {
    earningsRows.push(`<tr>
      <td>VacPay-Paid Out</td>
      <td></td>
      <td></td>
      <td>${escapeHtml(blankMoneyIfZero(current.vacationPaid))}</td>
      <td>${escapeHtml(blankMoneyIfZero(ytd?.vacationPaid))}</td>
    </tr>`);
  }
  const earningsRowsMarkup = earningsRows.join("");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Employee Paystub - ${escapeHtml(displayName)}</title>
    <style>
      @page { size: Letter portrait; margin: 0.35in; }
      :root {
        color-scheme: light;
        font-family: Arial, Helvetica, sans-serif;
        --ink: #111;
        --line: #222;
        --soft: #d8d8d8;
        --muted: #555;
      }
      * { box-sizing: border-box; }
      body { margin: 0; color: var(--ink); background: #efefef; padding: 12px; }
      .sheet { max-width: 8.1in; margin: 0 auto; background: white; border: 1px solid #cfcfcf; padding: 10px; }
      .head-grid { display: grid; grid-template-columns: minmax(0,1fr) 2.55in; gap: 10px; }
      .company { display: grid; gap: 2px; }
      .company strong { font-size: 18px; }
      .mini-box { border: 1px solid var(--line); }
      .mini-box table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .mini-box td { border-bottom: 1px solid var(--line); padding: 5px 6px; font-size: 10px; vertical-align: top; }
      .mini-box tr:last-child td { border-bottom: none; }
      .mini-box td:first-child { width: 40%; text-transform: uppercase; letter-spacing: 0.05em; font-size: 8px; font-weight: 700; }
      .title { margin: 12px 0 8px; text-align: center; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 700; font-size: 24px; }
      .paystub-line { border: 1px solid var(--line); padding: 6px 8px; font-size: 10px; display: flex; gap: 16px; flex-wrap: wrap; }
      .employee-info { margin-top: 8px; border: 1px solid var(--line); }
      .employee-info table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .employee-info td { border-bottom: 1px solid var(--soft); padding: 6px; font-size: 10px; vertical-align: top; }
      .employee-info tr:last-child td { border-bottom: none; }
      .employee-info td:first-child { width: 20%; text-transform: uppercase; letter-spacing: 0.05em; font-size: 8px; font-weight: 700; }
      .summary { margin-top: 8px; border: 1px solid var(--line); }
      .summary table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .summary td { border-bottom: 1px solid var(--soft); padding: 6px; font-size: 11px; }
      .summary tr:last-child td { border-bottom: none; font-weight: 700; font-size: 14px; }
      .summary td:nth-child(2), .summary td:nth-child(3) { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .two-col { margin-top: 8px; display: grid; grid-template-columns: minmax(0,1fr) minmax(0,0.88fr); gap: 8px; align-items: start; }
      .block { border: 1px solid var(--line); }
      .block-head { padding: 6px; border-bottom: 1px solid var(--line); text-transform: uppercase; letter-spacing: 0.05em; font-size: 8px; font-weight: 700; }
      .block table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .block th, .block td { border-bottom: 1px solid var(--soft); padding: 5px 6px; font-size: 10px; vertical-align: top; }
      .block tr:last-child td { border-bottom: none; }
      .block th { text-align: left; text-transform: uppercase; letter-spacing: 0.05em; font-size: 8px; background: #fafafa; }
      .block th:nth-child(n+2), .block td:nth-child(n+2) { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
      .withholdings-block th:nth-child(1), .withholdings-block td:nth-child(1) { width: 50%; white-space: normal; word-break: break-word; }
      .withholdings-block th:nth-child(2), .withholdings-block td:nth-child(2) { width: 25%; }
      .withholdings-block th:nth-child(3), .withholdings-block td:nth-child(3) { width: 25%; }
      @media print {
        body { background: white; padding: 0; }
        .sheet { border: none; padding: 0; max-width: none; }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <div class="head-grid">
        <div class="company">
          <strong>${escapeHtml(employerName)}</strong>
          <span>${escapeHtml(textOrDash(companyProfile?.addressLine1))}</span>
          ${companyProfile?.addressLine2 ? `<span>${escapeHtml(companyProfile.addressLine2)}</span>` : ""}
          <span>${escapeHtml([companyProfile?.city, companyProfile?.province, companyProfile?.postalCode].filter(Boolean).join(", "))}</span>
        </div>
        <div class="mini-box">
          <table><tbody>
            <tr><td>Pay Date</td><td>${escapeHtml(payDate)}</td></tr>
            <tr><td>Pay Period</td><td>${escapeHtml(`${payStartDate} - ${payEndDate}`)}</td></tr>
          </tbody></table>
        </div>
      </div>

      <div class="title">Statement of Earnings and Deductions</div>

      <div class="paystub-line">
        <span><strong>Employee Paystub</strong></span>
        <span>Cheque number: ${escapeHtml(employee?.employeeNumber || runId)}</span>
        <span>Pay Period: ${escapeHtml(`${payStartDate} - ${payEndDate}`)}</span>
        <span>Cheque Date: ${escapeHtml(payDate)}</span>
      </div>

      <div class="employee-info">
        <table><tbody>
          <tr><td>Employee</td><td>${escapeHtml(displayName)}${employeeAddress ? `, ${employeeAddress}` : ""}</td></tr>
          <tr><td>Occupation</td><td>${escapeHtml(employeeRole)} · ${escapeHtml(employerName)}${employerAddress ? `, ${escapeHtml(employerAddress)}` : ""}</td></tr>
        </tbody></table>
      </div>

      <div class="summary">
        <table><tbody>
          <tr><td>Gross Pay</td><td>${escapeHtml(formatCurrency(current.grossPay))}</td><td>${escapeHtml(formatCurrency(ytd?.grossPay ?? 0))}</td></tr>
          <tr><td>Total Withholdings</td><td>${escapeHtml(deduction(current.totalDeductions))}</td><td>${escapeHtml(deduction(ytd?.totalDeductions ?? 0))}</td></tr>
          <tr><td>Net Pay</td><td>${escapeHtml(formatCurrency(current.netPay))}</td><td>${escapeHtml(formatCurrency(ytd?.netPay ?? 0))}</td></tr>
        </tbody></table>
      </div>

      <div class="two-col">
        <div class="block">
          <div class="block-head">Earnings and Hours</div>
          <table>
            <thead><tr><th>Earnings and Hours</th><th>Qty</th><th>Rate</th><th>Current</th><th>YTD Amount</th></tr></thead>
            <tbody>${earningsRowsMarkup}</tbody>
          </table>
        </div>
        <div class="block withholdings-block">
          <div class="block-head">Withholdings</div>
          <table>
            <thead><tr><th>Withholdings</th><th>Current</th><th>YTD Amount</th></tr></thead>
            <tbody>
              <tr><td>CPP - Employee</td><td>${escapeHtml(deduction(current.cpp))}</td><td>${escapeHtml(deduction(ytd?.cpp ?? 0))}</td></tr>
              <tr><td>EI - Employee</td><td>${escapeHtml(deduction(current.ei))}</td><td>${escapeHtml(deduction(ytd?.ei ?? 0))}</td></tr>
              <tr><td>Federal Income Tax</td><td>${escapeHtml(deduction(incomeTaxCurrent))}</td><td>${escapeHtml(deduction(incomeTaxYtd))}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </main>
  </body>
</html>`;
};
