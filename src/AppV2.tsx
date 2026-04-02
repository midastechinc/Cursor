import { useEffect, useMemo, useRef, useState } from "react";
import { calculatePayroll, estimateVacationPayoutForRun, formatCurrency, getFrequencyLabel, inferVacationHandling } from "./lib/payroll";
import { buildClassicPayStubMarkup } from "./lib/payStubTemplate";
import { getSupportedTaxYears, getTaxTable, getTaxYearFromDraft } from "./lib/taxTables";
import type {
  AppSettings,
  BootstrapPayload,
  Client,
  CompanyProfile,
  CppStatus,
  ComplianceTask,
  Employee,
  EiStatus,
  EmployeeAttachment,
  PayFrequency,
  PayRunDraft,
  PayRunRecord,
  PayrollBreakdown,
  PayrollPreviewResponse,
  Pd7aReportInput,
  PayStubTotals,
  TaxTableSummary,
  VacationHandling,
  WorkerClassification,
} from "./types";

type DesktopApiResult = {
  ok: boolean;
  canceled?: boolean;
  error?: string;
  path?: string;
  backupPath?: string | null;
  restartRequired?: boolean;
  restarted?: boolean;
};

type DesktopBridge = {
  platform?: string;
  isDesktop?: boolean;
  printCurrentWindow?: () => Promise<DesktopApiResult>;
  openMailto?: (url: string) => Promise<DesktopApiResult>;
  exportDatabase?: () => Promise<DesktopApiResult>;
  importDatabase?: () => Promise<DesktopApiResult>;
};

const getDesktopBridge = () =>
  (window as Window & { midasPayrollDesktop?: DesktopBridge }).midasPayrollDesktop;

const payFrequencyOptions: PayFrequency[] = ["weekly", "biweekly", "semi-monthly", "monthly"];
const workerClassificationOptions: WorkerClassification[] = ["employee", "owner-employee", "self-employed-contractor"];
const cppStatusOptions: CppStatus[] = ["standard", "exempt-under-18", "exempt-70-plus", "cpp-working-beneficiary-exempt"];
const eiStatusOptions: EiStatus[] = ["standard", "non-insurable-cra-ruling", "owner-related-pending-ruling", "self-employed-non-insurable"];
type ViewMode = "payroll" | "admin" | "history";
type AdminTab = "company" | "people" | "tables";
type ClientFormValues = Omit<Client, "id" | "active">;
type ClientDirectorySort = "name-asc" | "employees-desc";
type ClientDeleteIntent = {
  id: string;
  name: string;
  employeeCount: number;
  payRunCount: number;
};
type EmployeeDeleteIntent = {
  id: string;
  name: string;
  payRunCount: number;
};
type PdocCompareForm = {
  employmentType: Employee["employmentType"];
  payFrequency: PayFrequency;
  annualSalary: number;
  hourlyRate: number;
  defaultHoursPerPeriod: number;
  regularHours: number;
  overtimeHours: number;
  vacationPayoutAmount: number;
  bonusAmount: number;
  taxableBenefits: number;
  federalClaimAmount: number;
  provincialClaimAmount: number;
  cppStatus: CppStatus;
  eiStatus: EiStatus;
  payPeriodStart: string;
  payPeriodEnd: string;
};
type PdocExpectedValues = {
  grossPay: string;
  cpp: string;
  ei: string;
  federalTax: string;
  provincialTax: string;
  netPay: string;
};

const defaultDraft: PayRunDraft = {
  employeeId: "",
  payFrequency: "monthly",
  payPeriodStart: "2026-03-01",
  payPeriodEnd: "2026-03-31",
  salaryOverrideAmount: 0,
  salaryOverrideReason: "",
  vacationHandling: "accrue",
  accrueVacation: true,
  vacationPayoutAmount: 0,
  regularHours: 173.33,
  overtimeHours: 0,
  bonusAmount: 0,
  taxableBenefits: 0,
};

const defaultAppSettings: AppSettings = {
  salaryOverrideReasons: ["New salary amount", "Partial period", "Owner draw", "Off-cycle adjustment", "Manual correction"],
  payrollFormFields: {
    clientId: { label: "Client", required: true },
    employeeId: { label: "Employee", required: true },
    payFrequency: { label: "Pay frequency", required: true },
    payPeriod: { label: "Pay period", required: true },
    regularHours: { label: "Regular hours", required: true },
    overtimeHours: { label: "Overtime hours", required: false },
    salaryOverrideAmount: { label: "Salary override for this run", required: false },
    salaryOverrideReason: { label: "Override reason", required: false },
    vacationHandling: { label: "Vacation handling", required: true },
    vacationPayoutAmount: { label: "Vacation paid this run", required: false },
    bonusAmount: { label: "Bonus", required: false },
    taxableBenefits: { label: "Taxable benefits", required: false },
  },
  employeeFormFields: {
    clientId: { label: "Client", required: true },
    employeeNumber: { label: "Employee number", required: false },
    firstName: { label: "First name", required: true },
    lastName: { label: "Last name", required: true },
    role: { label: "Job title", required: true },
    email: { label: "Email", required: false },
    phone: { label: "Phone", required: false },
    addressLine1: { label: "Address line 1", required: false },
    addressLine2: { label: "Address line 2", required: false },
    city: { label: "City", required: false },
    province: { label: "Province", required: false },
    postalCode: { label: "Postal code", required: false },
    dateOfBirth: { label: "Date of birth", required: false },
    hireDate: { label: "Hire date", required: false },
    terminationDate: { label: "Termination date", required: false },
    employmentType: { label: "Employment type", required: true },
    workerClassification: { label: "Worker classification", required: true },
    hourlyRate: { label: "Hourly rate", required: false },
    annualSalary: { label: "Annual salary", required: false },
    defaultHoursPerPeriod: { label: "Default regular hours", required: true },
    vacationRate: { label: "Vacation rate", required: true },
    federalClaimAmount: { label: "Federal TD1 amount", required: true },
    provincialClaimAmount: { label: "Ontario TD1 amount", required: true },
  },
  clientFormFields: {
    name: { label: "Client company", required: true },
    legalName: { label: "Legal name", required: false },
    contactName: { label: "Contact name", required: false },
    email: { label: "Email", required: false },
    phone: { label: "Phone", required: false },
    logoUrl: { label: "Logo URL", required: false },
    addressLine1: { label: "Address line 1", required: false },
    addressLine2: { label: "Address line 2", required: false },
    city: { label: "City", required: false },
    province: { label: "Province", required: false },
    postalCode: { label: "Postal code", required: false },
  },
};

const defaultPdocCompareForm: PdocCompareForm = {
  employmentType: "salary",
  payFrequency: "monthly",
  annualSalary: 96000,
  hourlyRate: 24,
  defaultHoursPerPeriod: 173.33,
  regularHours: 173.33,
  overtimeHours: 0,
  vacationPayoutAmount: 320,
  bonusAmount: 0,
  taxableBenefits: 0,
  federalClaimAmount: 16452,
  provincialClaimAmount: 12989,
  cppStatus: "standard",
  eiStatus: "standard",
  payPeriodStart: "2026-01-01",
  payPeriodEnd: "2026-01-31",
};

const defaultPdocExpectedValues: PdocExpectedValues = {
  grossPay: "8320",
  cpp: "477.69",
  ei: "135.62",
  federalTax: "1108.53",
  provincialTax: "560.22",
  netPay: "6037.94",
};

const emptyCompanyProfile: CompanyProfile = {
  name: "",
  legalName: "",
  contactName: "",
  email: "",
  phone: "",
  logoUrl: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "ON",
  postalCode: "",
  settings: defaultAppSettings,
};

const emptyClient: Omit<Client, "id" | "active"> = {
  name: "",
  legalName: "",
  contactName: "",
  email: "",
  phone: "",
  logoUrl: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "ON",
  postalCode: "",
};

const normalizeClientForm = (client?: Partial<ClientFormValues>): ClientFormValues => ({
  name: client?.name ?? "",
  legalName: client?.legalName ?? "",
  contactName: client?.contactName ?? "",
  email: client?.email ?? "",
  phone: client?.phone ?? "",
  logoUrl: client?.logoUrl ?? "",
  addressLine1: client?.addressLine1 ?? "",
  addressLine2: client?.addressLine2 ?? "",
  city: client?.city ?? "",
  province: client?.province ?? "ON",
  postalCode: client?.postalCode ?? "",
});

const clientFormFieldKeys = Object.keys(emptyClient) as (keyof ClientFormValues)[];
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const emptyEmployee: Omit<Employee, "id" | "provinceOfEmployment" | "active"> = {
  clientId: "",
  employeeNumber: "",
  attachments: [],
  firstName: "",
  lastName: "",
  fullName: "",
  role: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  province: "ON",
  postalCode: "",
  dateOfBirth: "",
  hireDate: "",
  terminationDate: "",
  employmentType: "hourly",
  workerClassification: "employee",
  hourlyRate: 24,
  annualSalary: 52000,
  defaultHoursPerPeriod: 80,
  federalClaimAmount: 16452,
  provincialClaimAmount: 12989,
  vacationRate: 0.04,
  rrspRppPrppContributionPerPeriod: 0,
  unionDuesPerPeriod: 0,
  prescribedZoneDeductionAnnual: 0,
  otherAnnualDeductionsAnnual: 0,
  cppStatus: "standard",
  eiStatus: "standard",
};

async function getJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
    },
    ...init,
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

const formatStatementDate = (value: string) =>
  new Date(value).toLocaleDateString("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

const formatPayPeriod = (start?: string, end?: string) => {
  if (!start && !end) {
    return "Pay period not set";
  }
  if (start && end) {
    return `${formatStatementDate(start)} to ${formatStatementDate(end)}`;
  }
  return formatStatementDate(start ?? end ?? "");
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const getCurrentTotals = (run: PayRunRecord): PayStubTotals => {
  if (run.payStub) {
    return {
      regularHours: run.payStub.draft.regularHours,
      overtimeHours: run.payStub.draft.overtimeHours,
      bonusAmount: run.payStub.draft.bonusAmount,
      taxableBenefits: run.payStub.draft.taxableBenefits,
      grossRegular: run.payStub.breakdown.grossRegular,
      grossOvertime: run.payStub.breakdown.grossOvertime,
      vacationAccrual: run.payStub.breakdown.vacationAccrual,
      vacationPaid: run.payStub.breakdown.vacationPaid,
      vacationBalance: run.payStub.ytd.vacationBalance,
      grossPay: run.payStub.breakdown.grossPay,
      rrspRppPrppContribution: run.payStub.breakdown.rrspRppPrppContribution,
      unionDues: run.payStub.breakdown.unionDues,
      cpp: run.payStub.breakdown.cpp,
      cpp2: run.payStub.breakdown.cpp2,
      ei: run.payStub.breakdown.ei,
      federalTax: run.payStub.breakdown.federalTax,
      provincialTax: run.payStub.breakdown.provincialTax,
      totalDeductions: run.payStub.breakdown.totalDeductions,
      netPay: run.payStub.breakdown.netPay,
      employerCpp: run.payStub.breakdown.employerCpp,
      employerCpp2: run.payStub.breakdown.employerCpp2,
      employerEi: run.payStub.breakdown.employerEi,
      employerCost: run.payStub.breakdown.employerCost,
    };
  }

  return {
    regularHours: run.regularHours,
    overtimeHours: run.overtimeHours,
    bonusAmount: run.bonusAmount,
    taxableBenefits: run.taxableBenefits,
    grossRegular: 0,
    grossOvertime: 0,
    vacationAccrual: 0,
    vacationPaid: run.vacationPayoutAmount,
    vacationBalance: 0,
    grossPay: run.grossPay,
    rrspRppPrppContribution: 0,
    unionDues: 0,
    cpp: 0,
    cpp2: 0,
    ei: 0,
    federalTax: 0,
    provincialTax: 0,
    totalDeductions: run.grossPay - run.netPay,
    netPay: run.netPay,
    employerCpp: 0,
    employerCpp2: 0,
    employerEi: 0,
    employerCost: run.employerCost,
  };
};

const buildPayStubMarkup = (run: PayRunRecord, fallbackEmployee?: Employee, fallbackCompanyProfile?: CompanyProfile, fallbackClient?: Client) => {
  const employee = run.payStub?.employee ?? fallbackEmployee;
  const companyProfile = run.payStub?.companyProfile ?? fallbackCompanyProfile;
  const client = run.payStub?.client ?? fallbackClient;
  const draft = run.payStub?.draft;
  const breakdown = run.payStub?.breakdown;
  const current = getCurrentTotals(run);
  const ytd = run.payStub?.ytd;
  const taxTable = run.payStub?.taxTable;
  const currency = (value?: number) => formatCurrency(value ?? 0);
  const decimal = (value?: number, digits = 2) => (value == null ? "" : value.toFixed(digits));
  const blankIfZero = (value?: number, digits = 2) => (value == null || Math.abs(value) < 0.0001 ? "" : value.toFixed(digits));
  const blankMoneyIfZero = (value?: number) => (value == null || Math.abs(value) < 0.0001 ? "" : formatCurrency(value));
  const textOrDash = (value?: string) => (value && value.trim() ? value.trim() : "—");
  const payDate = run.createdAt ? formatStatementDate(run.createdAt) : formatStatementDate(run.payPeriodEnd);
  const payEndDate = formatStatementDate(run.payPeriodEnd);
  const payStartDate = draft?.payPeriodStart ? formatStatementDate(draft.payPeriodStart) : formatStatementDate(run.payPeriodStart);
  const employeeDisplayName =
    employee?.fullName || [employee?.firstName, employee?.lastName].filter(Boolean).join(" ").trim() || run.employeeName;
  const employeeAddress = [employee?.addressLine1, employee?.addressLine2, [employee?.city, employee?.province].filter(Boolean).join(", "), employee?.postalCode]
    .filter(Boolean)
    .join("<br />");
  const employeeNumber = employee?.employeeNumber || run.employeeId || run.id;
  const annualSalary = employee?.annualSalary ?? 0;
  const periodsPerYear =
    run.payFrequency === "weekly" ? 52 : run.payFrequency === "biweekly" ? 26 : run.payFrequency === "semi-monthly" ? 24 : 12;
  const salaryRate = annualSalary > 0 ? annualSalary / periodsPerYear : 0;
  const regularRate = employee?.employmentType === "salary" ? salaryRate : employee?.hourlyRate ?? 0;
  const overtimeRate = employee?.hourlyRate ? employee.hourlyRate * 1.5 : 0;
  const employerName = companyProfile?.legalName || companyProfile?.name || "Payroll provider";
  const clientName = client?.legalName || client?.name || run.clientName || "Client company";
  const notesMarkup = breakdown?.notes?.length
    ? breakdown.notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")
    : "<li>Prepared from the payroll workspace. Review remittances and year-to-date balances after posting.</li>";

  const earningsDetailRows = [
    {
      label: "Regular pay",
      rate: regularRate > 0 ? currency(regularRate) : "",
      currentUnits: current.regularHours > 0 ? decimal(current.regularHours) : "",
      currentAmount: currency(current.grossRegular || (employee?.employmentType === "salary" ? current.grossPay - current.grossOvertime - current.bonusAmount - current.taxableBenefits - current.vacationPaid : current.grossRegular)),
      ytdUnits: ytd?.regularHours != null ? decimal(ytd.regularHours) : "",
      ytdAmount: ytd?.grossRegular != null ? currency(ytd.grossRegular) : "",
    },
    {
      label: "Overtime pay",
      rate: overtimeRate > 0 ? currency(overtimeRate) : "",
      currentUnits: blankIfZero(current.overtimeHours),
      currentAmount: blankMoneyIfZero(current.grossOvertime),
      ytdUnits: ytd?.overtimeHours != null ? blankIfZero(ytd.overtimeHours) : "",
      ytdAmount: blankMoneyIfZero(ytd?.grossOvertime),
    },
    {
      label: "Bonus",
      rate: "",
      currentUnits: "",
      currentAmount: blankMoneyIfZero(current.bonusAmount),
      ytdUnits: "",
      ytdAmount: blankMoneyIfZero(ytd?.bonusAmount),
    },
    {
      label: "Vacation pay",
      rate: draft?.vacationHandling === "pay" ? `${decimal((employee?.vacationRate ?? 0) * 100)}%` : "",
      currentUnits: "",
      currentAmount: blankMoneyIfZero(current.vacationPaid),
      ytdUnits: "",
      ytdAmount: blankMoneyIfZero(ytd?.vacationPaid),
    },
    {
      label: "Taxable benefits",
      rate: "",
      currentUnits: "",
      currentAmount: blankMoneyIfZero(current.taxableBenefits),
      ytdUnits: "",
      ytdAmount: blankMoneyIfZero(ytd?.taxableBenefits),
    },
  ];

  const deductionLeftRows = [
    { label: "CPP", currentAmount: current.cpp, ytdAmount: ytd?.cpp },
    { label: "CPP2", currentAmount: current.cpp2, ytdAmount: ytd?.cpp2 },
    { label: "EI", currentAmount: current.ei, ytdAmount: ytd?.ei },
    { label: "RRSP / RPP", currentAmount: current.rrspRppPrppContribution, ytdAmount: ytd?.rrspRppPrppContribution },
    { label: "Union dues", currentAmount: current.unionDues, ytdAmount: ytd?.unionDues },
  ];

  const deductionRightRows = [
    { label: "Federal tax", currentAmount: current.federalTax, ytdAmount: ytd?.federalTax },
    { label: "Ontario tax", currentAmount: current.provincialTax, ytdAmount: ytd?.provincialTax },
    { label: "Total deductions", currentAmount: current.totalDeductions, ytdAmount: ytd?.totalDeductions, total: true },
  ];

  const otherRows = [
    { label: "Vacation accrual", currentAmount: current.vacationAccrual, ytdAmount: ytd?.vacationAccrual },
    { label: "Vacation balance", currentAmount: current.vacationBalance, ytdAmount: ytd?.vacationBalance },
    { label: "Employer CPP", currentAmount: current.employerCpp, ytdAmount: ytd?.employerCpp },
    { label: "Employer CPP2", currentAmount: current.employerCpp2, ytdAmount: ytd?.employerCpp2 },
    { label: "Employer EI", currentAmount: current.employerEi, ytdAmount: ytd?.employerEi },
  ];

  const renderEarningsRows = () =>
    earningsDetailRows
      .map(
        (row) => `<tr>
          <td>${escapeHtml(row.label)}</td>
          <td>${escapeHtml(row.rate || "")}</td>
          <td>${escapeHtml(row.currentUnits || "")}</td>
          <td>${escapeHtml(row.currentAmount || "")}</td>
          <td>${escapeHtml(row.ytdUnits || "")}</td>
          <td>${escapeHtml(row.ytdAmount || "")}</td>
        </tr>`,
      )
      .join("");

  const renderSimpleRows = (rows: Array<{ label: string; currentAmount?: number; ytdAmount?: number; total?: boolean }>) =>
    rows
      .map(
        (row) => `<tr${row.total ? ' class="total-row"' : ""}>
          <td>${escapeHtml(row.label)}</td>
          <td>${escapeHtml(blankMoneyIfZero(row.currentAmount) || (row.total ? currency(row.currentAmount) : ""))}</td>
          <td>${escapeHtml(blankMoneyIfZero(row.ytdAmount) || (row.total ? currency(row.ytdAmount) : ""))}</td>
        </tr>`,
      )
      .join("");
  return buildClassicPayStubMarkup({
    runId: run.id,
    employeeName: run.employeeName,
    employeeRole: run.role,
    employee,
    companyProfile,
    client,
    draft,
    current,
    ytd,
    taxTable,
    createdAt: run.createdAt,
    payFrequency: run.payFrequency,
    notes: breakdown?.notes ?? [],
  });

  /*
  const renderAddress = (profile?: CompanyProfile | Client) =>
    [profile?.addressLine1, profile?.addressLine2, [profile?.city, profile?.province].filter(Boolean).join(", "), profile?.postalCode]
      .filter(Boolean)
      .map((line) => `<span>${escapeHtml(line ?? "")}</span>`)
      .join("");
  const companyLogoMarkup = companyProfile?.logoUrl
    ? `<img class="brand-logo" src="${escapeHtml(companyProfile.logoUrl)}" alt="${escapeHtml(companyProfile.name)} logo" />`
    : `<div class="brand-badge">${escapeHtml((companyProfile?.name ?? "Payroll").slice(0, 2).toUpperCase())}</div>`;
  const clientLogoMarkup = client?.logoUrl
    ? `<img class="client-logo" src="${escapeHtml(client.logoUrl)}" alt="${escapeHtml(client.name)} logo" />`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Pay Stub - ${escapeHtml(run.employeeName)}</title>
    <style>
      @page {
        size: Letter portrait;
        margin: 0.55in;
      }
      :root {
        color-scheme: light;
        font-family: "Segoe UI", Aptos, sans-serif;
        --ink: #163140;
        --muted: #597181;
        --accent: #1f7088;
        --line: #d5e0e6;
        --surface: #ffffff;
        --surface-alt: #f4f8fa;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 24px;
        color: var(--ink);
        background: linear-gradient(180deg, #eef5f8 0%, #ffffff 100%);
      }
      .sheet {
        max-width: 1040px;
        margin: 0 auto;
        background: var(--surface);
        border: 1px solid var(--line);
        border-radius: 22px;
        overflow: hidden;
      }
      .header {
        display: flex;
        justify-content: space-between;
        gap: 24px;
        padding: 24px 28px;
        background: linear-gradient(135deg, #11364c, #1f7088);
        color: white;
      }
      .header h1, .section h2, .notes h3 { margin: 0; }
      .header p { margin: 8px 0 0; color: rgba(255,255,255,0.82); }
      .brand-block {
        display: flex;
        gap: 16px;
        align-items: center;
      }
      .brand-logo,
      .client-logo {
        width: 64px;
        height: 64px;
        object-fit: cover;
        border-radius: 16px;
        background: rgba(255,255,255,0.14);
        border: 1px solid rgba(255,255,255,0.2);
      }
      .brand-badge {
        width: 64px;
        height: 64px;
        display: grid;
        place-items: center;
        border-radius: 16px;
        background: rgba(255,255,255,0.14);
        border: 1px solid rgba(255,255,255,0.2);
        font-size: 1.2rem;
        font-weight: 800;
        letter-spacing: 0.08em;
      }
      .meta {
        display: grid;
        gap: 6px;
        text-align: right;
        min-width: 220px;
      }
      .content {
        padding: 18px 22px 22px;
        display: grid;
        gap: 12px;
      }
      .party-strip {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
      }
      .party-card {
        min-width: 0;
        padding: 14px 16px;
        border-radius: 14px;
        border: 1px solid var(--line);
        background: var(--surface-alt);
      }
      .party-card-head {
        display: grid;
        grid-template-columns: 64px minmax(0, 1fr);
        gap: 14px;
        align-items: start;
      }
      .party-mark {
        width: 64px;
        display: flex;
        justify-content: center;
        align-items: flex-start;
        padding-top: 2px;
      }
      .party-main {
        min-width: 0;
        display: grid;
        gap: 8px;
      }
      .party-copy {
        min-width: 0;
      }
      .party-copy span,
      .party-copy small {
        display: block;
        color: var(--muted);
      }
      .party-copy strong {
        display: block;
        margin: 4px 0 4px;
        font-size: 0.98rem;
        line-height: 1.15;
        white-space: normal;
        overflow-wrap: anywhere;
      }
      .party-copy small {
        font-size: 0.82rem;
      }
      .summary {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .stat {
        padding: 12px 14px;
        border-radius: 16px;
        background: var(--surface-alt);
        border: 1px solid var(--line);
        min-width: 0;
      }
      .stat span {
        display: block;
        font-size: 0.86rem;
        color: var(--muted);
      }
      .stat strong {
        display: block;
        margin-top: 6px;
        font-size: 1.28rem;
        line-height: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        font-variant-numeric: tabular-nums;
      }
      .details {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 10px;
        align-items: start;
      }
      .section.section-wide {
        grid-column: 1 / -1;
      }
      .section {
        border: 1px solid var(--line);
        border-radius: 14px;
        overflow: hidden;
        min-width: 0;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .section h2 {
        padding: 10px 12px;
        background: var(--surface-alt);
        font-size: 0.92rem;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }
      th,
      td {
        padding: 8px 10px;
        border-top: 1px solid var(--line);
        vertical-align: top;
      }
      th {
        color: var(--muted);
        text-align: right;
        font-size: 0.72rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        background: #fbfdfe;
      }
      th:first-child,
      td:first-child {
        text-align: left;
        width: 42%;
      }
      th:nth-child(2),
      th:nth-child(3),
      td:nth-child(2),
      td:nth-child(3) {
        text-align: right;
        width: 29%;
      }
      td:nth-child(2),
      td:nth-child(3) {
        font-weight: 700;
        white-space: nowrap;
      }
      .employee-grid {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 10px;
      }
      .address-lines {
        display: grid;
        gap: 2px;
        font-size: 0.82rem;
        margin-top: 0;
      }
      .notes {
        padding: 12px 14px;
        border-radius: 14px;
        background: #fff9f1;
        border: 1px solid #f0dcc0;
        break-inside: avoid;
        page-break-inside: avoid;
      }
      .notes ul {
        margin: 12px 0 0;
        padding-left: 18px;
      }
      .notes li + li {
        margin-top: 8px;
      }
      @media (max-width: 860px) {
        body {
          padding: 20px;
        }
        .sheet {
          max-width: 100%;
        }
        .summary,
        .employee-grid,
        .details {
          grid-template-columns: 1fr;
        }
        .party-strip {
          grid-template-columns: 1fr;
        }
        .section.section-wide {
          grid-column: auto;
        }
      }
      @media print {
        @page {
          size: Letter portrait;
          margin: 0.25in;
        }
        body {
          padding: 0;
          background: white;
          font-size: 9px;
        }
        .sheet {
          max-width: none;
          border: none;
          border-radius: 0;
        }
        .header {
          gap: 14px;
          padding: 0 0 12px;
          background: white;
          color: var(--ink);
          border-bottom: 2px solid var(--line);
        }
        .brand-block {
          gap: 10px;
        }
        .header h1 {
          font-size: 1.15rem;
        }
        .header p {
          margin-top: 4px;
          font-size: 0.78rem;
          color: var(--muted);
        }
        .meta {
          min-width: 0;
          gap: 3px;
          font-size: 0.76rem;
        }
        .content {
          padding: 8px 0 0;
          gap: 6px;
        }
        .party-strip {
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
        }
        .party-card {
          padding: 7px 8px;
          border-radius: 8px;
        }
        .party-card-head {
          grid-template-columns: 40px minmax(0, 1fr);
          gap: 8px;
        }
        .party-mark {
          width: 40px;
        }
        .brand-logo,
        .client-logo,
        .brand-badge {
          width: 40px;
          height: 40px;
          border-radius: 10px;
        }
        .party-copy strong {
          margin: 2px 0;
          font-size: 0.86rem;
        }
        .party-copy small {
          font-size: 0.7rem;
        }
        .summary {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 5px;
        }
        .stat {
          padding: 6px 7px;
          border-radius: 8px;
          background: #f7fafb;
        }
        .stat span {
          font-size: 0.58rem;
        }
        .stat strong {
          margin-top: 4px;
          font-size: 0.8rem;
        }
        .details {
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
        }
        .section.section-wide {
          grid-column: auto;
        }
        .section {
          border-radius: 8px;
        }
        .section h2 {
          padding: 7px 9px;
          font-size: 0.76rem;
        }
        th,
        td {
          padding: 4px 6px;
        }
        th {
          font-size: 0.55rem;
        }
        th:first-child,
        td:first-child {
          width: 42%;
        }
        th:nth-child(2),
        th:nth-child(3),
        td:nth-child(2),
        td:nth-child(3) {
          width: 29%;
        }
        .notes {
          padding: 8px;
          border-radius: 8px;
          font-size: 0.74rem;
        }
        .notes ul {
          margin-top: 6px;
          padding-left: 14px;
        }
        .employee-grid {
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 5px;
        }
        .address-lines {
          gap: 1px;
          font-size: 0.66rem;
        }
      }
    </style>
  </head>
  <body>
    <main class="sheet">
      <section class="header">
        <div>
          <div class="brand-block">
            ${companyLogoMarkup}
            <div>
              <h1>Pay Stub</h1>
              <p>${escapeHtml(companyProfile?.name ?? "Payroll statement")} for ${escapeHtml(run.employeeName)}</p>
            </div>
          </div>
        </div>
        <div class="meta">
          <strong>Pay period: ${escapeHtml(formatPayPeriod(draft?.payPeriodStart, draft?.payPeriodEnd))}</strong>
          <strong>Statement date: ${escapeHtml(formatStatementDate(run.createdAt))}</strong>
          <span>Pay run ID: ${escapeHtml(run.id)}</span>
          <span>Frequency: ${escapeHtml(getFrequencyLabel(run.payFrequency))}</span>
          ${taxTable ? `<span>Tax table: ${escapeHtml(taxTable.label)}</span>` : ""}
        </div>
      </section>
      <section class="content">
        <div class="party-strip">
          <div class="party-card">
            <div class="party-card-head">
              <div class="party-mark">${companyLogoMarkup}</div>
              <div class="party-main">
                <div class="party-copy">
                  <span>Payroll prepared by</span>
                  <strong>${escapeHtml(companyProfile?.legalName || companyProfile?.name || "Payroll provider")}</strong>
                  ${companyProfile?.contactName ? `<small>${escapeHtml(companyProfile.contactName)}</small>` : ""}
                </div>
                <div class="address-lines">
                  ${renderAddress(companyProfile)}
                  ${companyProfile?.email ? `<span>${escapeHtml(companyProfile.email)}</span>` : ""}
                  ${companyProfile?.phone ? `<span>${escapeHtml(companyProfile.phone)}</span>` : ""}
                </div>
              </div>
            </div>
          </div>
          <div class="party-card">
            <div class="party-card-head">
              <div class="party-mark">${clientLogoMarkup || `<div class="brand-badge">${escapeHtml((client?.name ?? "Client").slice(0, 2).toUpperCase())}</div>`}</div>
              <div class="party-main">
                <div class="party-copy">
                  <span>Client company</span>
                  <strong>${escapeHtml(client?.legalName || client?.name || run.clientName || "Client company")}</strong>
                  ${client?.contactName ? `<small>${escapeHtml(client.contactName)}</small>` : ""}
                </div>
                <div class="address-lines">
                  ${renderAddress(client)}
                  ${client?.email ? `<span>${escapeHtml(client.email)}</span>` : ""}
                  ${client?.phone ? `<span>${escapeHtml(client.phone)}</span>` : ""}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div class="employee-grid">
          <div class="stat">
            <span>Employee</span>
            <strong>${escapeHtml(run.employeeName)}</strong>
          </div>
          <div class="stat">
            <span>Role</span>
            <strong>${escapeHtml(run.role)}</strong>
          </div>
          <div class="stat">
            <span>Client</span>
            <strong>${escapeHtml(client?.name ?? run.clientName ?? "Client")}</strong>
          </div>
          <div class="stat">
            <span>Worker type</span>
            <strong>${escapeHtml(employee?.workerClassification ?? "Saved run")}</strong>
          </div>
        </div>
        <div class="summary">
          <div class="stat">
            <span>Gross pay</span>
            <strong>${escapeHtml(formatCurrency(current.grossPay))}</strong>
          </div>
          <div class="stat">
            <span>Net pay</span>
            <strong>${escapeHtml(formatCurrency(current.netPay))}</strong>
          </div>
          <div class="stat">
            <span>Employer cost</span>
            <strong>${escapeHtml(formatCurrency(current.employerCost))}</strong>
          </div>
          <div class="stat">
            <span>Regular hours</span>
            <strong>${escapeHtml(String(current.regularHours))}</strong>
          </div>
          <div class="stat">
            <span>Overtime hours</span>
            <strong>${escapeHtml(String(current.overtimeHours))}</strong>
          </div>
        </div>
        <div class="details">
          <section class="section section-wide">
            <h2>Earnings</h2>
            <table><thead><tr><th>Item</th><th>Current</th><th>YTD</th></tr></thead><tbody>${renderRows(earningsRows)}</tbody></table>
          </section>
          <section class="section">
            <h2>Deductions</h2>
            <table><thead><tr><th>Item</th><th>Current</th><th>YTD</th></tr></thead><tbody>${renderRows(deductionRows)}</tbody></table>
          </section>
          <section class="section">
            <h2>Employer burden</h2>
            <table><thead><tr><th>Item</th><th>Current</th><th>YTD</th></tr></thead><tbody>${renderRows(employerRows)}</tbody></table>
          </section>
        </div>
        ${notesMarkup}
      </section>
    </main>
  </body>
</html>`;
  */
};

const printPayStub = (
  run: PayRunRecord,
  fallbackEmployee?: Employee,
  fallbackCompanyProfile?: CompanyProfile,
  fallbackClient?: Client,
  autoOpenPrintDialog = true,
) => {
  const printWindow = window.open("", "_blank", "width=1440,height=980");
  if (!printWindow) {
    throw new Error("The browser blocked the print window. Please allow pop-ups for this site.");
  }

  printWindow.document.write(buildPayStubMarkup(run, fallbackEmployee, fallbackCompanyProfile, fallbackClient));
  printWindow.document.close();
  printWindow.focus();
  if (!autoOpenPrintDialog) {
    return;
  }

  printWindow.onload = () => {
    printWindow.print();
    printWindow.onafterprint = () => {
      printWindow.close();
    };
  };
};

const emailPayStubFromHistory = (
  run: PayRunRecord,
  fallbackEmployee?: Employee,
  fallbackClient?: Client,
) => {
  const recipient = fallbackEmployee?.email?.trim();
  if (!recipient) {
    throw new Error(`No employee email is set for ${run.employeeName}.`);
  }

  const subject = encodeURIComponent(`Paystub - ${run.employeeName} - ${formatPayPeriod(run.payPeriodStart, run.payPeriodEnd)}`);
  const bodyLines = [
    `Hello ${run.employeeName},`,
    "",
    "Please find your paystub details below:",
    `Client: ${run.clientName ?? fallbackClient?.name ?? "Client"}`,
    `Pay period: ${formatPayPeriod(run.payPeriodStart, run.payPeriodEnd)}`,
    `Net pay: ${formatCurrency(run.netPay)}`,
    "",
    "To print or save the official paystub PDF, use the Payroll app history and click Print.",
  ];
  const body = encodeURIComponent(bodyLines.join("\n"));
  const mailtoUrl = `mailto:${encodeURIComponent(recipient)}?subject=${subject}&body=${body}`;
  const desktopApi = getDesktopBridge();
  if (desktopApi?.openMailto) {
    void desktopApi.openMailto(mailtoUrl);
    return;
  }
  window.location.href = mailtoUrl;
};

const openCraPayrollTables = () => {
  window.open(
    "https://www.canada.ca/en/revenue-agency/services/forms-publications/payroll/t4127-payroll-deductions-formulas.html",
    "_blank",
    "noopener,noreferrer",
  );
};

const openOntarioTaxSource = () => {
  window.open(
    "https://data.ontario.ca/en/dataset/6e252f87-6578-4929-a4f0-21b6fc0bfe4f",
    "_blank",
    "noopener,noreferrer",
  );
};

const parseExpectedValue = (value: string) => {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const getDisplayName = (employee: Pick<Employee, "fullName" | "firstName" | "lastName">) =>
  employee.fullName || [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() || "Employee";

const DEFAULT_REGULAR_HOURS_BY_FREQUENCY: Record<PayFrequency, number> = {
  weekly: 40,
  biweekly: 80,
  "semi-monthly": 86.67,
  monthly: 165,
};

const getDefaultRegularHours = (frequency: PayFrequency) => DEFAULT_REGULAR_HOURS_BY_FREQUENCY[frequency];

const buildPd7aReportMarkup = ({
  remitterName,
  grossPayroll,
  employeeCount,
  periodStart,
  periodEnd,
  generatedAt,
  runCount,
  employeeCpp,
  employeeCpp2,
  employerCpp,
  employerCpp2,
  employeeEi,
  employerEi,
  incomeTax,
}: Pd7aReportInput) => {
  const monthLabel = new Intl.DateTimeFormat("en-CA", { month: "short", year: "2-digit" }).format(new Date(periodEnd));
  const totalCpp = employeeCpp + employeeCpp2 + employerCpp + employerCpp2;
  const totalEi = employeeEi + employerEi;
  const remittanceForPeriod = incomeTax + totalCpp + totalEi;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>PD7A Summary - ${escapeHtml(remitterName)}</title>
    <style>
      @page { size: Letter portrait; margin: 0.5in; }
      :root { font-family: Arial, Helvetica, sans-serif; color-scheme: light; --ink: #111; --muted: #5d5d5d; }
      * { box-sizing: border-box; }
      body { margin: 0; color: var(--ink); }
      .sheet { max-width: 7.8in; margin: 0 auto; }
      .top { display: flex; justify-content: space-between; align-items: flex-end; gap: 14px; }
      .title { font-weight: 700; font-size: 20px; margin: 0; }
      .sub { font-size: 13px; margin: 2px 0 0; color: var(--muted); }
      .meta { text-align: right; font-size: 12px; line-height: 1.35; }
      .month { margin-top: 14px; font-size: 22px; font-weight: 700; }
      table { width: 100%; border-collapse: collapse; margin-top: 10px; }
      td { padding: 6px 0; font-size: 15px; vertical-align: top; }
      td:last-child { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
      .section { margin-top: 10px; font-size: 16px; font-weight: 700; }
      .indent td:first-child { padding-left: 16px; }
      .total td:first-child { font-weight: 700; }
      .footer { margin-top: 16px; color: var(--muted); font-size: 12px; display: flex; justify-content: space-between; }
    </style>
  </head>
  <body>
    <main class="sheet">
      <div class="top">
        <div>
          <h1 class="title">PD7A Summary</h1>
          <p class="sub">${escapeHtml(remitterName)}</p>
        </div>
        <div class="meta">
          <div>${escapeHtml(formatStatementDate(generatedAt))}</div>
          <div>Runs included: ${escapeHtml(String(runCount))}</div>
        </div>
      </div>
      <div class="month">${escapeHtml(monthLabel)}</div>

      <table>
        <tbody>
          <tr><td>Gross payroll for period</td><td>${escapeHtml(formatCurrency(grossPayroll))}</td></tr>
          <tr><td>No. of employees paid in period</td><td>${escapeHtml(String(employeeCount || runCount))}</td></tr>
        </tbody>
      </table>

      <div class="section">Remittance for period</div>
      <table>
        <tbody>
          <tr><td>Tax deductions</td><td>${escapeHtml(formatCurrency(incomeTax))}</td></tr>
        </tbody>
      </table>

      <div class="section">Total CPP contributions</div>
      <table>
        <tbody>
          <tr class="indent"><td>CPP - Employee</td><td>${escapeHtml(formatCurrency(employeeCpp))}</td></tr>
          <tr class="indent"><td>CPP - Company</td><td>${escapeHtml(formatCurrency(employerCpp))}</td></tr>
          <tr class="indent"><td>Second CPP - Employee</td><td>${escapeHtml(formatCurrency(employeeCpp2))}</td></tr>
          <tr class="indent"><td>Second CPP - Company</td><td>${escapeHtml(formatCurrency(employerCpp2))}</td></tr>
          <tr class="total"><td>Total CPP contributions</td><td>${escapeHtml(formatCurrency(totalCpp))}</td></tr>
        </tbody>
      </table>

      <div class="section">Total EI premiums</div>
      <table>
        <tbody>
          <tr class="indent"><td>EI - Employee</td><td>${escapeHtml(formatCurrency(employeeEi))}</td></tr>
          <tr class="indent"><td>EI - Company</td><td>${escapeHtml(formatCurrency(employerEi))}</td></tr>
          <tr class="total"><td>Total EI premiums</td><td>${escapeHtml(formatCurrency(totalEi))}</td></tr>
        </tbody>
      </table>

      <table>
        <tbody>
          <tr class="total"><td>Remittance for period</td><td>${escapeHtml(formatCurrency(remittanceForPeriod))}</td></tr>
        </tbody>
      </table>

      <div class="footer">
        <span>${escapeHtml(formatPayPeriod(periodStart, periodEnd))}</span>
        <span>Page 1</span>
      </div>
    </main>
  </body>
</html>`;
};

const printPd7aReportWindow = (input: Pd7aReportInput) => {
  const printWindow = window.open("", "_blank", "width=1440,height=980");
  if (!printWindow) {
    throw new Error("The browser blocked the print window. Please allow pop-ups for this site.");
  }

  printWindow.document.write(buildPd7aReportMarkup(input));
  printWindow.document.close();
  printWindow.focus();
  printWindow.onload = () => {
    printWindow.print();
    printWindow.onafterprint = () => {
      printWindow.close();
    };
  };
};

const getFieldLabel = (config: Record<string, { label: string; required: boolean }>, key: string, fallback: string) =>
  config[key]?.label || fallback;

const renderFieldTitle = (config: Record<string, { label: string; required: boolean }>, key: string, fallback: string) =>
  `${getFieldLabel(config, key, fallback)}${config[key]?.required ? " *" : ""}`;

const looksLikeHttpUrl = (value: string) =>
  /^(https?:\/\/)/i.test(value.trim());

const looksLikePostalCode = (value: string) =>
  /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/.test(value.trim());

const formatPhonePlaceholder = "(555) 123-4567";
const formatPostalCodePlaceholder = "A1A 1A1";
const httpUrlPattern = /^https?:\/\/\S+$/i;
const postalCodePattern = /^[A-Za-z]\d[A-Za-z][ -]?\d[A-Za-z]\d$/;

const isValidEmail = (value: string) => {
  if (!value.trim()) {
    return true;
  }
  return emailPattern.test(value.trim());
};

const isValidHttpUrl = (value: string) => {
  if (!value.trim()) {
    return true;
  }
  return httpUrlPattern.test(value.trim());
};

const isValidPostalCode = (value: string) => {
  if (!value.trim()) {
    return true;
  }
  return postalCodePattern.test(value.trim());
};

function AppV2() {
  const [viewMode, setViewMode] = useState<ViewMode>("payroll");
  const [adminTab, setAdminTab] = useState<AdminTab>("company");
  const [companyProfile, setCompanyProfile] = useState<CompanyProfile>(emptyCompanyProfile);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [complianceTasks, setComplianceTasks] = useState<ComplianceTask[]>([]);
  const [recentPayRuns, setRecentPayRuns] = useState<PayRunRecord[]>([]);
  const [draft, setDraft] = useState<PayRunDraft>(defaultDraft);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [payroll, setPayroll] = useState<PayrollBreakdown | null>(null);
  const [previewYtd, setPreviewYtd] = useState<PayStubTotals | null>(null);
  const [editingPayRunId, setEditingPayRunId] = useState<string | null>(null);
  const [newClient, setNewClient] = useState(emptyClient);
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [clientSearchQuery, setClientSearchQuery] = useState("");
  const [clientDirectorySort, setClientDirectorySort] = useState<ClientDirectorySort>("name-asc");
  const [openClientActionId, setOpenClientActionId] = useState<string | null>(null);
  const [newEmployee, setNewEmployee] = useState(emptyEmployee);
  const [editingEmployeeId, setEditingEmployeeId] = useState<string | null>(null);
  const [openEmployeeActionId, setOpenEmployeeActionId] = useState<string | null>(null);
  const [pendingClientDeleteTarget, setPendingClientDeleteTarget] = useState<ClientDeleteIntent | null>(null);
  const [pendingEmployeeDeleteTarget, setPendingEmployeeDeleteTarget] = useState<EmployeeDeleteIntent | null>(null);
  const [isDeletingClient, setIsDeletingClient] = useState(false);
  const [isDeletingEmployee, setIsDeletingEmployee] = useState(false);
  const [activeTaxTable, setActiveTaxTable] = useState<TaxTableSummary | null>(null);
  const [showTaxTableWorkflow, setShowTaxTableWorkflow] = useState(false);
  const [pdocCompareForm, setPdocCompareForm] = useState<PdocCompareForm>(defaultPdocCompareForm);
  const [pdocExpectedValues, setPdocExpectedValues] = useState<PdocExpectedValues>(defaultPdocExpectedValues);
  const [loading, setLoading] = useState(true);
  const [isSavingRun, setIsSavingRun] = useState(false);
  const [isSavingCompany, setIsSavingCompany] = useState(false);
  const [isSavingClient, setIsSavingClient] = useState(false);
  const [isAddingEmployee, setIsAddingEmployee] = useState(false);
  const [isExportingDatabase, setIsExportingDatabase] = useState(false);
  const [isImportingDatabase, setIsImportingDatabase] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Connecting payroll studio...");
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const clientMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const employeeMenuContainerRef = useRef<HTMLDivElement | null>(null);
  const clientMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const employeeMenuButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    let active = true;

    void (async () => {
      try {
        const payload = await getJson<BootstrapPayload>("/api/bootstrap");
        if (!active) {
          return;
        }

        setCompanyProfile(payload.companyProfile);
        setClients(payload.clients);
        setEmployees(payload.employees);
        setComplianceTasks(payload.complianceTasks);
        setRecentPayRuns(payload.recentPayRuns);
        setActiveTaxTable(payload.taxTable);
        const firstClientId = payload.clients.find((client) => client.active)?.id ?? payload.clients[0]?.id ?? "";
        const firstEmployeeId = payload.employees.find((employee) => employee.active && employee.clientId === firstClientId)?.id
          ?? payload.employees.find((employee) => employee.active)?.id
          ?? "";
        setSelectedClientId(firstClientId);
        setNewEmployee((current) => ({ ...current, clientId: firstClientId }));
        setDraft((current) => ({
          ...current,
          employeeId: current.employeeId || firstEmployeeId,
        }));
        setStatusMessage("Backend connected. Payroll data is now loading from SQLite.");
      } catch (error) {
        if (active) {
          setStatusMessage(error instanceof Error ? error.message : "Could not load payroll data.");
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const activeClients = useMemo(() => clients.filter((client) => client.active), [clients]);
  const activeClientIds = useMemo(() => new Set(activeClients.map((client) => client.id)), [activeClients]);
  const activeEmployees = useMemo(
    () => employees.filter((employee) => employee.active && activeClientIds.has(employee.clientId)),
    [activeClientIds, employees],
  );
  const visibleRecentPayRuns = useMemo(
    () => recentPayRuns.filter((run) => !run.clientId || activeClientIds.has(run.clientId)),
    [activeClientIds, recentPayRuns],
  );
  const selectedClient = activeClients.find((client) => client.id === selectedClientId) ?? activeClients[0];
  const clientEmployees = useMemo(
    () => activeEmployees.filter((employee) => employee.clientId === (selectedClient?.id ?? selectedClientId)),
    [activeEmployees, selectedClient, selectedClientId],
  );
  const selectableEmployees = clientEmployees.length > 0 ? clientEmployees : activeEmployees;
  const selectedEmployee = selectableEmployees.find((employee) => employee.id === draft.employeeId) ?? selectableEmployees[0];
  const calculatedVacationPayout = useMemo(() => {
    if (!selectedEmployee) {
      return 0;
    }

    return estimateVacationPayoutForRun(selectedEmployee, draft);
  }, [draft, selectedEmployee]);

  useEffect(() => {
    if (!selectedClient || editingEmployeeId) {
      return;
    }

    setNewEmployee((current) => {
      // Never override an in-progress add form that already has user-entered data.
      const hasTypedData = Boolean(
        current.firstName.trim()
        || current.lastName.trim()
        || current.role.trim()
        || (current.email ?? "").trim()
        || (current.phone ?? "").trim()
        || (current.attachments ?? []).length > 0,
      );

      if (hasTypedData) {
        return current;
      }

      return { ...current, clientId: selectedClient.id };
    });
    setDraft((current) => {
      const employeeStillMatchesClient = activeEmployees.some(
        (employee) => employee.id === current.employeeId && employee.clientId === selectedClient.id,
      );

      if (employeeStillMatchesClient) {
        return current;
      }

      const nextEmployeeForClient = activeEmployees.find((employee) => employee.clientId === selectedClient.id)?.id;
      if (nextEmployeeForClient) {
        return {
          ...current,
          employeeId: nextEmployeeForClient,
        };
      }

      // Keep a valid fallback when the selected client has no employees yet.
      const currentEmployeeIsStillActive = activeEmployees.some((employee) => employee.id === current.employeeId);
      return {
        ...current,
        employeeId: currentEmployeeIsStillActive ? current.employeeId : (activeEmployees[0]?.id ?? ""),
      };
    });
  }, [activeEmployees, editingEmployeeId, selectedClient]);

  useEffect(() => {
    if (!selectedEmployee) {
      setPayroll(null);
      setPreviewYtd(null);
      return;
    }

    let active = true;

    void (async () => {
      try {
        const preview = await getJson<PayrollPreviewResponse>("/api/pay-runs/preview", {
          method: "POST",
          body: JSON.stringify({
            employeeId: selectedEmployee.id,
            excludedPayRunId: editingPayRunId ?? undefined,
            draft: {
              ...draft,
              employeeId: selectedEmployee.id,
            },
          }),
        });

        if (active) {
          setPayroll(preview.breakdown);
          setPreviewYtd(preview.ytd);
          setActiveTaxTable(preview.taxTable);
        }
      } catch (error) {
        if (active) {
          setPayroll(null);
          setPreviewYtd(null);
          setStatusMessage(error instanceof Error ? error.message : "Could not preview payroll.");
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [draft, editingPayRunId, selectedEmployee]);

  useEffect(() => {
    if (!selectedEmployee || editingPayRunId) {
      return;
    }

    setDraft((current) => {
      if (current.employeeId !== selectedEmployee.id) {
        return current;
      }

      return {
        ...current,
        regularHours: selectedEmployee.defaultHoursPerPeriod,
      };
    });
  }, [editingPayRunId, selectedEmployee?.id]);

  useEffect(() => {
    if (!selectedEmployee || draft.vacationHandling !== "pay") {
      return;
    }

    const autoVacationPayout = estimateVacationPayoutForRun(selectedEmployee, draft);
    if (Math.abs(draft.vacationPayoutAmount - autoVacationPayout) < 0.005 && draft.accrueVacation === false) {
      return;
    }

    setDraft((current) => ({
      ...current,
      accrueVacation: false,
      vacationPayoutAmount: autoVacationPayout,
    }));
  }, [
    draft.payFrequency,
    draft.regularHours,
    draft.overtimeHours,
    draft.salaryOverrideAmount,
    draft.vacationHandling,
    draft.vacationPayoutAmount,
    draft.accrueVacation,
    selectedEmployee,
  ]);

  const totalMonthlyBase = useMemo(() => {
    return activeEmployees.reduce((sum, employee) => {
      if (employee.employmentType === "salary") {
        return sum + (employee.annualSalary ?? 0) / 12;
      }
      return sum + (((employee.hourlyRate ?? 0) * employee.defaultHoursPerPeriod) * 26) / 12;
    }, 0);
  }, [activeEmployees]);
  const supportedTaxYears = useMemo(() => getSupportedTaxYears(), []);
  const activeTaxTableDetails = useMemo(
    () => (activeTaxTable ? getTaxTable(activeTaxTable.taxYear) : null),
    [activeTaxTable],
  );
  const pdocCompareDraft = useMemo<PayRunDraft>(() => ({
    employeeId: selectedEmployee?.id ?? "pdoc-compare",
    payFrequency: pdocCompareForm.payFrequency,
    payPeriodStart: pdocCompareForm.payPeriodStart,
    payPeriodEnd: pdocCompareForm.payPeriodEnd,
    salaryOverrideAmount: 0,
    salaryOverrideReason: "",
    vacationHandling: "custom",
    accrueVacation: false,
    vacationPayoutAmount: pdocCompareForm.vacationPayoutAmount,
    regularHours: pdocCompareForm.regularHours,
    overtimeHours: pdocCompareForm.overtimeHours,
    bonusAmount: pdocCompareForm.bonusAmount,
    taxableBenefits: pdocCompareForm.taxableBenefits,
  }), [pdocCompareForm, selectedEmployee]);
  const pdocCompareTaxYear = useMemo(() => getTaxYearFromDraft(pdocCompareDraft), [pdocCompareDraft]);
  const pdocCompareResult = useMemo(() => {
    const compareEmployee: Employee = {
      id: selectedEmployee?.id ?? "pdoc-compare",
      clientId: selectedClient?.id ?? "client-compare",
      firstName: selectedEmployee?.firstName ?? "PDOC",
      lastName: selectedEmployee?.lastName ?? "Compare",
      fullName: selectedEmployee?.fullName ?? "PDOC compare employee",
      role: selectedEmployee?.role ?? "Payroll test case",
      employmentType: pdocCompareForm.employmentType,
      workerClassification: "employee",
      hourlyRate: pdocCompareForm.hourlyRate,
      annualSalary: pdocCompareForm.annualSalary,
      defaultHoursPerPeriod: pdocCompareForm.defaultHoursPerPeriod,
      provinceOfEmployment: "ON",
      federalClaimAmount: pdocCompareForm.federalClaimAmount,
      provincialClaimAmount: pdocCompareForm.provincialClaimAmount,
      vacationRate: selectedEmployee?.vacationRate ?? 0.04,
      rrspRppPrppContributionPerPeriod: 0,
      unionDuesPerPeriod: 0,
      prescribedZoneDeductionAnnual: 0,
      otherAnnualDeductionsAnnual: 0,
      cppStatus: pdocCompareForm.cppStatus,
      eiStatus: pdocCompareForm.eiStatus,
      active: true,
    };

    return calculatePayroll(compareEmployee, pdocCompareDraft, undefined, pdocCompareTaxYear);
  }, [pdocCompareDraft, pdocCompareForm, pdocCompareTaxYear, selectedClient, selectedEmployee]);
  const pdocCompareRows = useMemo(() => {
    const rows = [
      { label: "Gross pay", actual: pdocCompareResult.grossPay, expected: parseExpectedValue(pdocExpectedValues.grossPay) },
      { label: "CPP", actual: pdocCompareResult.cpp, expected: parseExpectedValue(pdocExpectedValues.cpp) },
      { label: "EI", actual: pdocCompareResult.ei, expected: parseExpectedValue(pdocExpectedValues.ei) },
      { label: "Federal tax", actual: pdocCompareResult.federalTax, expected: parseExpectedValue(pdocExpectedValues.federalTax) },
      { label: "Ontario tax", actual: pdocCompareResult.provincialTax, expected: parseExpectedValue(pdocExpectedValues.provincialTax) },
      { label: "Net pay", actual: pdocCompareResult.netPay, expected: parseExpectedValue(pdocExpectedValues.netPay) },
    ];

    return rows.map((row) => ({
      ...row,
      delta: row.expected == null ? null : Math.round((row.actual - row.expected) * 100) / 100,
    }));
  }, [pdocCompareResult, pdocExpectedValues]);
  const ytdGraphItems = useMemo(() => {
    if (!previewYtd) {
      return [];
    }

    const items = [
      { label: "Gross pay", value: previewYtd.grossPay, tone: "gross" },
      { label: "Net pay", value: previewYtd.netPay, tone: "net" },
      { label: "Taxes", value: previewYtd.federalTax + previewYtd.provincialTax, tone: "tax" },
      { label: "CPP / CPP2 / EI", value: previewYtd.cpp + previewYtd.cpp2 + previewYtd.ei, tone: "stat" },
      { label: "Vacation balance", value: previewYtd.vacationBalance, tone: "vacation" },
    ] as const;

    const maxValue = Math.max(...items.map((item) => item.value), 1);

    return items.map((item) => ({
      ...item,
      width: `${Math.max((item.value / maxValue) * 100, item.value > 0 ? 8 : 0)}%`,
    }));
  }, [previewYtd]);
  const recentPayRunsForClient = useMemo(
    () => visibleRecentPayRuns.filter((run) => !selectedClient || run.clientId === selectedClient.id),
    [selectedClient, visibleRecentPayRuns],
  );
  const appSettings = companyProfile.settings ?? defaultAppSettings;
  const payrollFieldConfig = appSettings.payrollFormFields ?? defaultAppSettings.payrollFormFields;
  const employeeFieldConfig = appSettings.employeeFormFields ?? defaultAppSettings.employeeFormFields;
  const clientFieldConfig = appSettings.clientFormFields ?? defaultAppSettings.clientFormFields;
  const filteredClients = useMemo(() => {
    const query = clientSearchQuery.trim().toLowerCase();
    if (!query) {
      return activeClients;
    }

    return activeClients.filter((client) =>
      [client.name, client.legalName, client.contactName, client.email, client.phone, client.city]
        .some((value) => value.toLowerCase().includes(query)));
  }, [activeClients, clientSearchQuery]);
  const sortedClients = useMemo(() => {
    const clientsToSort = [...filteredClients];
    if (clientDirectorySort === "employees-desc") {
      return clientsToSort.sort((left, right) => {
        const leftCount = employees.filter((employee) => employee.clientId === left.id && employee.active).length;
        const rightCount = employees.filter((employee) => employee.clientId === right.id && employee.active).length;
        if (leftCount === rightCount) {
          return left.name.localeCompare(right.name);
        }
        return rightCount - leftCount;
      });
    }

    return clientsToSort.sort((left, right) => left.name.localeCompare(right.name));
  }, [clientDirectorySort, employees, filteredClients]);
  const selectedClientEmployeeCount = useMemo(
    () => (selectedClient ? employees.filter((employee) => employee.active && employee.clientId === selectedClient.id).length : 0),
    [employees, selectedClient],
  );
  const pendingClientDeleteEmployeeCount = pendingClientDeleteTarget?.employeeCount ?? 0;
  const pendingClientDeleteRunCount = pendingClientDeleteTarget?.payRunCount ?? 0;
  const pendingEmployeeDeleteRunCount = pendingEmployeeDeleteTarget?.payRunCount ?? 0;
  const editingClient = useMemo(
    () => (editingClientId ? clients.find((client) => client.id === editingClientId) ?? null : null),
    [clients, editingClientId],
  );
  const baselineClientForm = useMemo(
    () => normalizeClientForm(editingClient ?? undefined),
    [editingClient],
  );
  const currentClientForm = useMemo(
    () => normalizeClientForm(newClient),
    [newClient],
  );
  const clientFormHasChanges = useMemo(
    () => clientFormFieldKeys.some((key) => currentClientForm[key].trim() !== baselineClientForm[key].trim()),
    [baselineClientForm, currentClientForm],
  );
  const clientValidation = useMemo(() => {
    const errors: Partial<Record<keyof ClientFormValues, string>> = {};
    if (clientFieldConfig.name.required && !currentClientForm.name.trim()) {
      errors.name = `${clientFieldConfig.name.label} is required.`;
    }
    if (currentClientForm.email.trim() && !isValidEmail(currentClientForm.email)) {
      errors.email = "Enter a valid email address.";
    }
    if (currentClientForm.logoUrl.trim() && !isValidHttpUrl(currentClientForm.logoUrl)) {
      errors.logoUrl = "Use a full URL starting with http:// or https://.";
    }
    if (currentClientForm.postalCode.trim() && !isValidPostalCode(currentClientForm.postalCode)) {
      errors.postalCode = "Use a valid Canadian postal code format (A1A 1A1).";
    }

    return {
      errors,
      isValid: Object.keys(errors).length === 0,
    };
  }, [clientFieldConfig.name.label, clientFieldConfig.name.required, currentClientForm]);
  const clientFieldErrors = clientValidation.errors;
  const clientFormCanSave = clientValidation.isValid;
  const handleDraftChange = <K extends keyof PayRunDraft>(key: K, value: PayRunDraft[K]) => {
    setDraft((current) => {
      if (key === "payFrequency") {
        const nextFrequency = value as PayFrequency;
        return {
          ...current,
          payFrequency: nextFrequency,
          regularHours: getDefaultRegularHours(nextFrequency),
        };
      }

      return { ...current, [key]: value };
    });
  };

  const handlePayFrequencyChange = (frequency: PayFrequency) => {
    handleDraftChange("payFrequency", frequency);
  };

  const handleDraftEmployeeChange = (employeeId: string) => {
    const employee = activeEmployees.find((item) => item.id === employeeId);
    if (!employee) {
      handleDraftChange("employeeId", employeeId);
      return;
    }

    // Keep client and employee selectors in sync even if client filter was stale.
    setSelectedClientId(employee.clientId);
    setDraft((current) => ({ ...current, employeeId }));
  };

  const handleVacationModeChange = (mode: VacationHandling) => {
    setDraft((current) => {
      const autoVacationPayout = selectedEmployee ? estimateVacationPayoutForRun(selectedEmployee, current) : 0;

      if (mode === "pay") {
        return {
          ...current,
          vacationHandling: "pay",
          accrueVacation: false,
          vacationPayoutAmount: autoVacationPayout,
        };
      }

      if (mode === "accrue") {
        return {
          ...current,
          vacationHandling: "accrue",
          accrueVacation: true,
          vacationPayoutAmount: 0,
        };
      }

      return {
        ...current,
        vacationHandling: "custom",
        accrueVacation: false,
        vacationPayoutAmount: current.vacationHandling === "custom" ? current.vacationPayoutAmount : autoVacationPayout,
      };
    });
  };

  const handlePdocCompareInput = <K extends keyof PdocCompareForm>(key: K, value: PdocCompareForm[K]) => {
    setPdocCompareForm((current) => ({ ...current, [key]: value }));
  };

  const handlePdocExpectedInput = <K extends keyof PdocExpectedValues>(key: K, value: PdocExpectedValues[K]) => {
    setPdocExpectedValues((current) => ({ ...current, [key]: value }));
  };

  const handleCompanyProfileChange = <K extends keyof CompanyProfile>(key: K, value: CompanyProfile[K]) => {
    setCompanyProfile((current) => ({ ...current, [key]: value }));
  };

  const handleSalaryOverrideReasonsChange = (value: string) => {
    const reasons = value
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean);

    setCompanyProfile((current) => ({
      ...current,
      settings: {
        ...current.settings,
        salaryOverrideReasons: reasons,
      },
    }));
  };

  const handleFieldConfigChange = (
    section: keyof Pick<AppSettings, "payrollFormFields" | "employeeFormFields" | "clientFormFields">,
    fieldKey: string,
    property: "label" | "required",
    value: string | boolean,
  ) => {
    setCompanyProfile((current) => ({
      ...current,
      settings: {
        ...current.settings,
        [section]: {
          ...current.settings[section],
          [fieldKey]: {
            ...current.settings[section][fieldKey],
            [property]: value,
          },
        },
      },
    }));
  };

  const handleClientInput = <K extends keyof typeof emptyClient>(key: K, value: (typeof emptyClient)[K]) => {
    setNewClient((current) => ({ ...current, [key]: value }));
  };

  const resetPayRunForm = () => {
    setDraft((current) => ({
      ...defaultDraft,
      employeeId: current.employeeId || clientEmployees[0]?.id || "",
      vacationPayoutAmount: 0,
    }));
    setEditingPayRunId(null);
  };

  const handleEmployeeInput = <K extends keyof typeof emptyEmployee>(key: K, value: (typeof emptyEmployee)[K]) => {
    setNewEmployee((current) => ({ ...current, [key]: value }));
  };

  const addEmployeeAttachments = async (files: FileList | null) => {
    if (!files || files.length === 0) {
      return;
    }

    const attachments = await Promise.all(
      Array.from(files).map(
        (file) =>
          new Promise<EmployeeAttachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () =>
              resolve({
                id: `attachment-${crypto.randomUUID()}`,
                name: file.name,
                type: file.type || "application/octet-stream",
                size: file.size,
                uploadedAt: new Date().toISOString(),
                dataUrl: String(reader.result ?? ""),
              });
            reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
            reader.readAsDataURL(file);
          }),
      ),
    );

    setNewEmployee((current) => ({
      ...current,
      attachments: [...(current.attachments ?? []), ...attachments],
    }));
    setStatusMessage(`Attached ${attachments.length} document${attachments.length === 1 ? "" : "s"} to the employee profile.`);

    if (attachmentInputRef.current) {
      attachmentInputRef.current.value = "";
    }
  };

  const removeEmployeeAttachment = (attachmentId: string) => {
    setNewEmployee((current) => ({
      ...current,
      attachments: (current.attachments ?? []).filter((attachment) => attachment.id !== attachmentId),
    }));
    setStatusMessage("Removed the selected employee document.");
  };

  const resetEmployeeForm = () => {
    setNewEmployee({ ...emptyEmployee, clientId: selectedClient?.id ?? "" });
    setEditingEmployeeId(null);
  };

  const resetClientForm = () => {
    setNewClient(emptyClient);
    setEditingClientId(null);
  };

  const loadSelectedEmployeeIntoPdocCompare = () => {
    if (!selectedEmployee) {
      setStatusMessage("Select an employee first, then load their defaults into PDOC compare.");
      return;
    }

    setPdocCompareForm((current) => ({
      ...current,
      employmentType: selectedEmployee.employmentType,
      annualSalary: selectedEmployee.annualSalary ?? current.annualSalary,
      hourlyRate: selectedEmployee.hourlyRate ?? current.hourlyRate,
      defaultHoursPerPeriod: selectedEmployee.defaultHoursPerPeriod,
      regularHours: selectedEmployee.defaultHoursPerPeriod,
      federalClaimAmount: selectedEmployee.federalClaimAmount,
      provincialClaimAmount: selectedEmployee.provincialClaimAmount,
      cppStatus: selectedEmployee.cppStatus,
      eiStatus: selectedEmployee.eiStatus,
    }));
    setStatusMessage(`Loaded ${getDisplayName(selectedEmployee)} into PDOC compare.`);
  };

  const saveCompanyProfile = async () => {
    if (!companyProfile.name.trim()) {
      setStatusMessage("Add your company name before saving company settings.");
      return;
    }

    setIsSavingCompany(true);
    try {
      const saved = await getJson<CompanyProfile>("/api/company-profile", {
        method: "PUT",
        body: JSON.stringify(companyProfile),
      });
      setCompanyProfile(saved);
      setStatusMessage(`Saved company profile for ${saved.name}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save company profile.");
    } finally {
      setIsSavingCompany(false);
    }
  };

  const saveClient = async () => {
    if (clientFieldConfig.name.required && !newClient.name.trim()) {
      setStatusMessage(`Add ${clientFieldConfig.name.label.toLowerCase()} before saving the client.`);
      return;
    }

    setIsSavingClient(true);
    try {
      const isEditing = Boolean(editingClientId);
      const client = await getJson<Client>(isEditing ? `/api/clients/${editingClientId}` : "/api/clients", {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify(newClient),
      });

      setClients((current) => {
        if (!isEditing) {
          return [...current, client];
        }
        return current.map((item) => (item.id === client.id ? client : item));
      });
      setSelectedClientId(client.id);
      setNewEmployee((current) => ({ ...current, clientId: client.id }));
      resetClientForm();
      setStatusMessage(isEditing ? `Client updated: ${client.name}` : `Client saved: ${client.name}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save client.");
    } finally {
      setIsSavingClient(false);
    }
  };

  const saveEmployee = async () => {
    if (!newEmployee.clientId) {
      setStatusMessage("Choose a client before creating an employee.");
      return;
    }

    if (
      (employeeFieldConfig.firstName.required && !newEmployee.firstName.trim())
      || (employeeFieldConfig.lastName.required && !newEmployee.lastName.trim())
      || (employeeFieldConfig.role.required && !newEmployee.role.trim())
    ) {
      setStatusMessage("Add the required employee details before saving the employee.");
      return;
    }

    setIsAddingEmployee(true);
    try {
      const isEditing = Boolean(editingEmployeeId);
      const preparedEmployee = {
        ...newEmployee,
        fullName: [newEmployee.firstName, newEmployee.lastName].filter(Boolean).join(" ").trim(),
      };
      const employee = await getJson<Employee>(isEditing ? `/api/employees/${editingEmployeeId}` : "/api/employees", {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify(preparedEmployee),
      });

      setEmployees((current) => {
        if (!isEditing) {
          return [...current, employee];
        }
        return current.map((item) => (item.id === employee.id ? employee : item));
      });
      setSelectedClientId(employee.clientId);
      setNewEmployee((current) => ({ ...current, clientId: employee.clientId }));
      setDraft((current) => ({ ...current, employeeId: employee.id }));
      resetEmployeeForm();
      setStatusMessage(isEditing ? `Employee updated: ${getDisplayName(employee)}` : `Employee saved to SQLite: ${getDisplayName(employee)}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save employee.");
    } finally {
      setIsAddingEmployee(false);
    }
  };

  const startEditingEmployee = (employee: Employee) => {
    setEditingEmployeeId(employee.id);
    setSelectedClientId(employee.clientId);
    setNewEmployee({
      clientId: employee.clientId,
      employeeNumber: employee.employeeNumber ?? "",
      attachments: employee.attachments ?? [],
      firstName: employee.firstName,
      lastName: employee.lastName,
      fullName: employee.fullName,
      role: employee.role,
      email: employee.email ?? "",
      phone: employee.phone ?? "",
      addressLine1: employee.addressLine1 ?? "",
      addressLine2: employee.addressLine2 ?? "",
      city: employee.city ?? "",
      province: employee.province ?? "ON",
      postalCode: employee.postalCode ?? "",
      dateOfBirth: employee.dateOfBirth ?? "",
      hireDate: employee.hireDate ?? "",
      terminationDate: employee.terminationDate ?? "",
      employmentType: employee.employmentType,
      workerClassification: employee.workerClassification,
      hourlyRate: employee.hourlyRate ?? 24,
      annualSalary: employee.annualSalary ?? 52000,
      defaultHoursPerPeriod: employee.defaultHoursPerPeriod,
      federalClaimAmount: employee.federalClaimAmount,
      provincialClaimAmount: employee.provincialClaimAmount,
      vacationRate: employee.vacationRate,
      rrspRppPrppContributionPerPeriod: employee.rrspRppPrppContributionPerPeriod,
      unionDuesPerPeriod: employee.unionDuesPerPeriod,
      prescribedZoneDeductionAnnual: employee.prescribedZoneDeductionAnnual,
      otherAnnualDeductionsAnnual: employee.otherAnnualDeductionsAnnual,
      cppStatus: employee.cppStatus,
      eiStatus: employee.eiStatus,
    });
  };

  const startEditingClient = (client: Client) => {
    setEditingClientId(client.id);
    setSelectedClientId(client.id);
    setNewClient({
      name: client.name,
      legalName: client.legalName,
      contactName: client.contactName,
      email: client.email,
      phone: client.phone,
      logoUrl: client.logoUrl,
      addressLine1: client.addressLine1,
      addressLine2: client.addressLine2,
      city: client.city,
      province: client.province,
      postalCode: client.postalCode,
    });
  };

  const removeClient = async (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    if (!client) {
      return;
    }

    try {
      const response = await fetch(`/api/clients/${clientId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const remainingClients = clients.filter((item) => item.id !== clientId && item.active);
      const nextClientId = remainingClients[0]?.id ?? "";
      const removedEmployeeIds = new Set(
        employees.filter((employee) => employee.clientId === clientId).map((employee) => employee.id),
      );

      setClients((current) => current.filter((item) => item.id !== clientId));
      setEmployees((current) => current.filter((item) => item.clientId !== clientId));
      setRecentPayRuns((current) => current.filter((item) => item.clientId !== clientId));

      if (selectedClientId === clientId) {
        setSelectedClientId(nextClientId);
      }

      if (editingClientId === clientId) {
        resetClientForm();
      }

      setNewEmployee((current) => {
        if (current.clientId !== clientId) {
          return current;
        }
        return { ...current, clientId: nextClientId };
      });

      if (editingEmployeeId) {
        const editedEmployee = employees.find((item) => item.id === editingEmployeeId);
        if (editedEmployee?.clientId === clientId) {
          setEditingEmployeeId(null);
          setNewEmployee({ ...emptyEmployee, clientId: nextClientId });
        }
      }

      setDraft((current) => {
        if (!removedEmployeeIds.has(current.employeeId)) {
          return current;
        }

        const nextEmployeeId = employees.find(
          (employee) => employee.active && employee.clientId === nextClientId && !removedEmployeeIds.has(employee.id),
        )?.id ?? "";

        return {
          ...current,
          employeeId: nextEmployeeId,
        };
      });

      setStatusMessage(`Client removed: ${client.name}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not delete client.");
    }
  };

  const requestClientDelete = (clientId: string) => {
    const client = clients.find((item) => item.id === clientId);
    if (!client) {
      return;
    }

    const employeeCount = employees.filter((employee) => employee.clientId === clientId && employee.active).length;
    const payRunCount = recentPayRuns.filter((run) => run.clientId === clientId).length;
    setPendingClientDeleteTarget({
      id: client.id,
      name: client.name,
      employeeCount,
      payRunCount,
    });
  };

  const cancelClientDelete = () => {
    setPendingClientDeleteTarget(null);
  };

  const confirmClientDelete = async () => {
    if (!pendingClientDeleteTarget) {
      return;
    }

    setIsDeletingClient(true);
    try {
      await removeClient(pendingClientDeleteTarget.id);
      setPendingClientDeleteTarget(null);
    } finally {
      setIsDeletingClient(false);
    }
  };

  const removeEmployee = async (employeeId: string) => {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) {
      return;
    }

    try {
      const response = await fetch(`/api/employees/${employeeId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      setEmployees((current) => current.filter((item) => item.id !== employeeId));
      setRecentPayRuns((current) => current.filter((item) => item.employeeId !== employeeId));
      if (draft.employeeId === employeeId) {
        const nextEmployee = employees.find((item) => item.id !== employeeId && item.active && item.clientId === employee.clientId);
        setDraft((current) => ({ ...current, employeeId: nextEmployee?.id ?? "" }));
      }
      if (editingEmployeeId === employeeId) {
        resetEmployeeForm();
      }
      setStatusMessage(`Employee removed: ${employee.fullName}`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not delete employee.");
    }
  };

  const requestEmployeeDelete = (employeeId: string) => {
    const employee = employees.find((item) => item.id === employeeId);
    if (!employee) {
      return;
    }

    const payRunCount = recentPayRuns.filter((run) => run.employeeId === employeeId).length;
    setPendingEmployeeDeleteTarget({
      id: employee.id,
      name: getDisplayName(employee),
      payRunCount,
    });
  };

  const cancelEmployeeDelete = () => {
    setPendingEmployeeDeleteTarget(null);
  };

  const confirmEmployeeDelete = async () => {
    if (!pendingEmployeeDeleteTarget) {
      return;
    }

    setIsDeletingEmployee(true);
    try {
      await removeEmployee(pendingEmployeeDeleteTarget.id);
      setPendingEmployeeDeleteTarget(null);
    } finally {
      setIsDeletingEmployee(false);
    }
  };

  const savePayRun = async () => {
    if (!selectedEmployee) {
      return;
    }

    if ((payrollFieldConfig.salaryOverrideReason.required || draft.salaryOverrideAmount > 0) && draft.salaryOverrideAmount > 0 && !draft.salaryOverrideReason.trim()) {
      setStatusMessage("Pick a reason for the salary override before saving this run.");
      return;
    }

    setIsSavingRun(true);
    try {
      const isEditing = Boolean(editingPayRunId);
      const payRun = await getJson<PayRunRecord>(isEditing ? `/api/pay-runs/${editingPayRunId}` : "/api/pay-runs", {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify({
          ...draft,
          employeeId: selectedEmployee.id,
        }),
      });

      setRecentPayRuns((current) => {
        const next = isEditing
          ? current.map((item) => (item.id === payRun.id ? payRun : item))
          : [payRun, ...current];
        return next
          .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
          .slice(0, 8);
      });
      setStatusMessage(isEditing ? `Updated pay run for ${payRun.employeeName}.` : `Saved pay run for ${payRun.employeeName}.`);
      setEditingPayRunId(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not save pay run.");
    } finally {
      setIsSavingRun(false);
    }
  };

  const startEditingPayRun = (run: PayRunRecord) => {
      const sourceDraft = run.payStub?.draft ?? {
      employeeId: run.employeeId,
      payFrequency: run.payFrequency,
      payPeriodStart: run.payPeriodStart,
      payPeriodEnd: run.payPeriodEnd,
      salaryOverrideAmount: 0,
      salaryOverrideReason: run.payStub?.draft.salaryOverrideReason ?? "",
      vacationHandling: inferVacationHandling(run.payStub?.draft ?? run),
      accrueVacation: run.accrueVacation,
      vacationPayoutAmount: run.vacationPayoutAmount,
      regularHours: run.regularHours,
      overtimeHours: run.overtimeHours,
      bonusAmount: run.bonusAmount,
      taxableBenefits: run.taxableBenefits,
    };

    setEditingPayRunId(run.id);
    setSelectedClientId(run.clientId ?? run.payStub?.client?.id ?? selectedClientId);
    setDraft(sourceDraft);
    setStatusMessage(`Editing pay run for ${run.employeeName}.`);
  };

  const removePayRun = async (payRunId: string) => {
    try {
      const response = await fetch(`/api/pay-runs/${payRunId}`, { method: "DELETE" });
      if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
      }
      setRecentPayRuns((current) => current.filter((item) => item.id !== payRunId));
      if (editingPayRunId === payRunId) {
        resetPayRunForm();
      }
      setStatusMessage("Pay run deleted.");
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not delete pay run.");
    }
  };

  const printCurrentPayStub = () => {
    if (!selectedEmployee || !payroll) {
      setStatusMessage("Preview a payroll run before printing a pay stub.");
      return;
    }

    try {
      const currentTotals: PayStubTotals = {
        regularHours: draft.regularHours,
        overtimeHours: draft.overtimeHours,
        bonusAmount: draft.bonusAmount,
        taxableBenefits: draft.taxableBenefits,
        grossRegular: payroll.grossRegular,
        grossOvertime: payroll.grossOvertime,
        vacationAccrual: payroll.vacationAccrual,
        vacationPaid: payroll.vacationPaid,
        vacationBalance: (previewYtd?.vacationBalance ?? 0) - payroll.vacationAccrual + payroll.vacationPaid,
        grossPay: payroll.grossPay,
        rrspRppPrppContribution: payroll.rrspRppPrppContribution,
        unionDues: payroll.unionDues,
        cpp: payroll.cpp,
        cpp2: payroll.cpp2,
        ei: payroll.ei,
        federalTax: payroll.federalTax,
        provincialTax: payroll.provincialTax,
        totalDeductions: payroll.totalDeductions,
        netPay: payroll.netPay,
        employerCpp: payroll.employerCpp,
        employerCpp2: payroll.employerCpp2,
        employerEi: payroll.employerEi,
        employerCost: payroll.employerCost,
      };

      printPayStub(
        {
          id: "preview-pay-stub",
          employeeId: selectedEmployee.id,
          clientId: selectedEmployee.clientId,
          clientName: selectedClient?.name ?? "Client",
          employeeName: selectedEmployee.fullName,
          role: selectedEmployee.role,
          taxYear: activeTaxTable?.taxYear,
          payFrequency: draft.payFrequency,
          payPeriodStart: draft.payPeriodStart,
          payPeriodEnd: draft.payPeriodEnd,
          accrueVacation: draft.accrueVacation,
          vacationPayoutAmount: draft.vacationPayoutAmount,
          regularHours: draft.regularHours,
          overtimeHours: draft.overtimeHours,
          bonusAmount: draft.bonusAmount,
          taxableBenefits: draft.taxableBenefits,
          grossPay: payroll.grossPay,
          netPay: payroll.netPay,
          employerCost: payroll.employerCost,
          createdAt: new Date().toISOString(),
          payStub: {
            companyProfile,
            client: selectedClient,
            employee: selectedEmployee,
            draft: {
              ...draft,
              employeeId: selectedEmployee.id,
            },
            breakdown: payroll,
            taxTable: activeTaxTable ?? undefined,
            ytd: previewYtd ?? currentTotals,
          },
        },
        selectedEmployee,
        companyProfile,
        selectedClient,
      );
      setStatusMessage(`Opened printable pay stub preview for ${selectedEmployee.fullName}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not print the pay stub.");
    }
  };

  const printSavedPayStub = (run: PayRunRecord) => {
    try {
      const fallbackEmployee = employees.find((item) => item.id === run.employeeId);
      const fallbackClient = clients.find((item) => item.id === (run.clientId ?? fallbackEmployee?.clientId));
      const shouldAutoOpenPrint = !getDesktopBridge();
      printPayStub(run, fallbackEmployee, companyProfile, fallbackClient, shouldAutoOpenPrint);
      setStatusMessage(`Opened printable pay stub for ${run.employeeName}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not print the pay stub.");
    }
  };

  const exportDatabaseBackup = async () => {
    const desktopApi = getDesktopBridge();
    if (!desktopApi?.exportDatabase) {
      setStatusMessage("Database export is available in the desktop app only.");
      return;
    }

    setIsExportingDatabase(true);
    try {
      const result = await desktopApi.exportDatabase();
      if (result.canceled) {
        setStatusMessage("Database export canceled.");
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "Could not export database backup.");
      }
      setStatusMessage(`Database backup exported: ${result.path ?? "saved"}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not export database backup.");
    } finally {
      setIsExportingDatabase(false);
    }
  };

  const importDatabaseBackup = async () => {
    const desktopApi = getDesktopBridge();
    if (!desktopApi?.importDatabase) {
      setStatusMessage("Database import is available in the desktop app only.");
      return;
    }

    setIsImportingDatabase(true);
    try {
      const result = await desktopApi.importDatabase();
      if (result.canceled) {
        setStatusMessage("Database import canceled.");
        return;
      }
      if (!result.ok) {
        throw new Error(result.error || "Could not import database.");
      }
      if (result.restarted) {
        setStatusMessage("Database imported. Restarting app now...");
        return;
      }
      const backupNote = result.backupPath ? ` Pre-import backup: ${result.backupPath}.` : "";
      setStatusMessage(`Database imported successfully.${backupNote} Restart the app to load imported data.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not import database.");
    } finally {
      setIsImportingDatabase(false);
    }
  };

  const emailSavedPayStub = (run: PayRunRecord) => {
    try {
      const fallbackEmployee = employees.find((item) => item.id === run.employeeId);
      const fallbackClient = clients.find((item) => item.id === (run.clientId ?? fallbackEmployee?.clientId));
      emailPayStubFromHistory(run, fallbackEmployee, fallbackClient);
      setStatusMessage(`Opened email draft for ${run.employeeName}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not prepare paystub email.");
    }
  };

  const printPd7aReport = () => {
    const periodStart = draft.payPeriodStart;
    const periodEnd = draft.payPeriodEnd;
    if (!periodStart || !periodEnd) {
      setStatusMessage("Set the pay period start and end dates before printing PD7A.");
      return;
    }

    const matchingRuns = recentPayRuns
      .filter((run) => run.payPeriodStart >= periodStart && run.payPeriodEnd <= periodEnd)
      .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

    if (matchingRuns.length === 0) {
      setStatusMessage("No saved pay runs were found for the selected period. Save at least one run first.");
      return;
    }

    const totals = matchingRuns.reduce(
      (accumulator, run) => {
        const breakdown = run.payStub?.breakdown;
        if (!breakdown) {
          return accumulator;
        }

        accumulator.employeeCpp += breakdown.cpp;
        accumulator.employeeCpp2 += breakdown.cpp2;
        accumulator.employerCpp += breakdown.employerCpp;
        accumulator.employerCpp2 += breakdown.employerCpp2;
        accumulator.employeeEi += breakdown.ei;
        accumulator.employerEi += breakdown.employerEi;
        accumulator.incomeTax += breakdown.federalTax + breakdown.provincialTax;
        return accumulator;
      },
      {
        employeeCpp: 0,
        employeeCpp2: 0,
        employerCpp: 0,
        employerCpp2: 0,
        employeeEi: 0,
        employerEi: 0,
        incomeTax: 0,
      },
    );

    try {
      printPd7aReportWindow({
        remitterName: companyProfile.legalName || companyProfile.name || "Payroll remitter",
        periodStart,
        periodEnd,
        generatedAt: new Date().toISOString(),
        grossPayroll: matchingRuns.reduce((sum, run) => sum + (run.grossPay ?? 0), 0),
        employeeCount: new Set(matchingRuns.map((run) => run.employeeId)).size,
        runCount: matchingRuns.length,
        employeeCpp: totals.employeeCpp,
        employeeCpp2: totals.employeeCpp2,
        employerCpp: totals.employerCpp,
        employerCpp2: totals.employerCpp2,
        employeeEi: totals.employeeEi,
        employerEi: totals.employerEi,
        incomeTax: totals.incomeTax,
      });

      setStatusMessage(`Opened PD7A report for ${formatPayPeriod(periodStart, periodEnd)}.`);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Could not print the PD7A report.");
    }
  };

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Midas Tech Inc.</span>
          <h1>You Run Your Business. We Run Payroll</h1>
          <p>This version stores employees and pay runs in SQLite and calculates previews through the API.</p>
        </div>

        <div className="hero-metrics">
          <div className="metric-card accent-sun">
            <span>Active employees</span>
            <strong>{activeEmployees.length}</strong>
            <small>persisted in SQLite</small>
          </div>
          <div className="metric-card accent-ice">
            <span>Base monthly payroll</span>
            <strong>{formatCurrency(totalMonthlyBase)}</strong>
            <small>before deductions</small>
          </div>
          <div className="metric-card accent-clay">
            <span>Saved pay runs</span>
            <strong>{visibleRecentPayRuns.length}</strong>
            <small>latest runs on file</small>
          </div>
        </div>
      </header>

      <div className="view-toggle">
        <button className={viewMode === "payroll" ? "toggle-button active" : "toggle-button"} type="button" onClick={() => setViewMode("payroll")}>
          Payroll workspace
        </button>
        <button className={viewMode === "history" ? "toggle-button active" : "toggle-button"} type="button" onClick={() => setViewMode("history")}>
          Pay run history
        </button>
        <button className={viewMode === "admin" ? "toggle-button nav-end active" : "toggle-button nav-end"} type="button" onClick={() => setViewMode("admin")}>
          Admin dashboard
        </button>
      </div>

      <main className={viewMode === "history" ? "dashboard-grid history-layout" : "dashboard-grid"}>
        <section className="panel payroll-panel">
          <div className="panel-heading">
            <div>
              <span className="section-tag">
                {viewMode === "payroll" ? "Pay run studio" : viewMode === "admin" ? "Admin dashboard" : "History"}
              </span>
              <h2>
                {viewMode === "payroll"
                  ? (editingPayRunId ? "Edit payroll run" : "Draft and save payroll runs")
                  : viewMode === "admin"
                    ? "Firm settings and client setup"
                    : (selectedClient ? `${selectedClient.name} pay runs` : "Recent pay runs")}
              </h2>
            </div>
            <p>
              {viewMode === "payroll"
                ? "Payroll previews now come from the backend so the browser is no longer the system of record."
                : viewMode === "admin"
                  ? "Manage your firm profile, client companies, and the branding that prints on every payroll stub."
                  : "Review saved payroll runs, reopen them for edits, and print past payroll statements."}
            </p>
          </div>

          <div className="status-banner">
            <strong>{loading ? "Loading..." : "System status"}</strong>
            <span>{statusMessage}</span>
            {activeTaxTable ? <span>Using {activeTaxTable.label}. Source updated {formatStatementDate(activeTaxTable.sourceUpdatedAt)}.</span> : null}
          </div>

          {viewMode === "payroll" ? (
            <>
          <div className="form-grid">
            <label className="span-2">
              {clientFieldConfig.name.label}
              <select value={selectedClient?.id ?? ""} onChange={(event) => setSelectedClientId(event.target.value)} disabled={loading || activeClients.length === 0}>
                {activeClients.map((client) => (
                  <option key={client.id} value={client.id}>
                    {client.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="span-2">
              {payrollFieldConfig.employeeId.label}
              <select value={draft.employeeId} onChange={(event) => handleDraftEmployeeChange(event.target.value)} disabled={loading || selectableEmployees.length === 0}>
                {selectableEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {getDisplayName(employee)} - {employee.role}
                  </option>
                ))}
              </select>
              {clientEmployees.length === 0 && activeEmployees.length > 0 ? (
                <small>No employees are assigned to this client yet. Showing all active employees.</small>
              ) : null}
            </label>

            <label className="pay-frequency-field">
              {payrollFieldConfig.payFrequency.label}
              <select value={draft.payFrequency} onChange={(event) => handlePayFrequencyChange(event.target.value as PayFrequency)}>
                {payFrequencyOptions.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {getFrequencyLabel(frequency)}
                  </option>
                ))}
              </select>
            </label>

            <div className="paired-field span-3">
              <span>{payrollFieldConfig.payPeriod.label}</span>
              <div className="paired-field-grid period-grid">
                <label>
                  Start
                  <input type="date" value={draft.payPeriodStart} onChange={(event) => handleDraftChange("payPeriodStart", event.target.value)} />
                </label>
                <label>
                  End
                  <input type="date" value={draft.payPeriodEnd} onChange={(event) => handleDraftChange("payPeriodEnd", event.target.value)} />
                </label>
                <label>
                  {payrollFieldConfig.regularHours.label}
                  <input type="number" min="0" value={draft.regularHours} onChange={(event) => handleDraftChange("regularHours", Number(event.target.value))} />
                </label>
              </div>
              <small>Pay frequency, pay period dates, and regular hours are set together for this run.</small>
            </div>

            {selectedEmployee?.employmentType === "salary" ? (
              <label>
                {payrollFieldConfig.salaryOverrideAmount.label}
                <input
                  type="number"
                  min="0"
                  value={draft.salaryOverrideAmount}
                  onChange={(event) => handleDraftChange("salaryOverrideAmount", Number(event.target.value))}
                />
              </label>
            ) : null}

            {selectedEmployee?.employmentType === "salary" ? (
              <label>
                {payrollFieldConfig.salaryOverrideReason.label}
                <select value={draft.salaryOverrideReason} onChange={(event) => handleDraftChange("salaryOverrideReason", event.target.value)}>
                  <option value="">Select a reason</option>
                  {appSettings.salaryOverrideReasons.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            <label>
              {payrollFieldConfig.vacationHandling.label}
              <select value={draft.vacationHandling} onChange={(event) => handleVacationModeChange(event.target.value as VacationHandling)}>
                <option value="pay">Pay vacation automatically</option>
                <option value="accrue">Accrue vacation only</option>
                <option value="custom">Custom vacation payout</option>
              </select>
            </label>

            <label>
              {payrollFieldConfig.vacationPayoutAmount.label}
              <input
                type="number"
                min="0"
                value={draft.vacationPayoutAmount}
                disabled={draft.vacationHandling !== "custom"}
                onChange={(event) => handleDraftChange("vacationPayoutAmount", Number(event.target.value))}
              />
              <small>
                {draft.vacationHandling === "pay"
                  ? `Auto-calculated from the employee vacation rate: ${formatCurrency(calculatedVacationPayout)}`
                  : draft.vacationHandling === "accrue"
                    ? "Vacation is accruing on this run, so nothing is paid out."
                    : `Custom payout starts from the calculated amount of ${formatCurrency(calculatedVacationPayout)}.`}
              </small>
            </label>

            <label>
              {payrollFieldConfig.overtimeHours.label}
              <input type="number" min="0" value={draft.overtimeHours} onChange={(event) => handleDraftChange("overtimeHours", Number(event.target.value))} />
            </label>

            <label>
              {payrollFieldConfig.bonusAmount.label}
              <input type="number" min="0" value={draft.bonusAmount} onChange={(event) => handleDraftChange("bonusAmount", Number(event.target.value))} />
            </label>

            <label>
              {payrollFieldConfig.taxableBenefits.label}
              <input type="number" min="0" value={draft.taxableBenefits} onChange={(event) => handleDraftChange("taxableBenefits", Number(event.target.value))} />
            </label>
          </div>

          {selectedClient ? (
            <div className="client-banner">
              <strong>{selectedClient.name}</strong>
              <span>{companyProfile.name || "Your firm"} prepares payroll for this client.</span>
            </div>
          ) : null}

          {selectedEmployee && payroll ? (
            <div className="breakdown-grid">
              <article className="statement-card warm">
                <span>Employee</span>
                <strong>{getDisplayName(selectedEmployee)}</strong>
                <small>{selectedEmployee.role} · {selectedEmployee.employmentType === "salary" ? "Salary" : "Hourly"}</small>
              </article>

              <article className="statement-card amount-card">
                <span>Gross pay</span>
                <strong>{formatCurrency(payroll.grossPay)}</strong>
                <small>Calculated on the API</small>
              </article>

              <article className="statement-card amount-card">
                <span>Net pay</span>
                <strong>{formatCurrency(payroll.netPay)}</strong>
                <small>Estimated take-home</small>
              </article>

              <article className="statement-card amount-card">
                <span>Employer cost</span>
                <strong>{formatCurrency(payroll.employerCost)}</strong>
                <small>Includes vacation accrual and statutory costs</small>
              </article>
            </div>
          ) : null}

          {previewYtd ? (
            <div className="detail-card compare-card">
              <h3>Current vs year to date</h3>
              <div className="compare-table">
                <div className="compare-table-header">
                  <span>Item</span>
                  <span>Current</span>
                  <span>YTD</span>
                </div>
                {[
                  { label: "Gross pay", current: payroll?.grossPay ?? 0, ytd: previewYtd.grossPay },
                  { label: "Net pay", current: payroll?.netPay ?? 0, ytd: previewYtd.netPay },
                  { label: "Income tax", current: (payroll?.federalTax ?? 0) + (payroll?.provincialTax ?? 0), ytd: previewYtd.federalTax + previewYtd.provincialTax },
                  { label: "CPP", current: payroll?.cpp ?? 0, ytd: previewYtd.cpp },
                  { label: "CPP2", current: payroll?.cpp2 ?? 0, ytd: previewYtd.cpp2 },
                  { label: "EI", current: payroll?.ei ?? 0, ytd: previewYtd.ei },
                  { label: "Vacation accrued", current: payroll?.vacationAccrual ?? 0, ytd: previewYtd.vacationAccrual },
                  { label: "Vacation paid", current: payroll?.vacationPaid ?? 0, ytd: previewYtd.vacationPaid },
                  { label: "Vacation balance", current: previewYtd.vacationBalance - (payroll?.vacationAccrual ?? 0) + (payroll?.vacationPaid ?? 0), ytd: previewYtd.vacationBalance },
                  { label: "Regular hours", current: draft.regularHours, ytd: previewYtd.regularHours, hours: true },
                ].map((row) => (
                  <div key={row.label} className="compare-table-row">
                    <span>{row.label}</span>
                    <strong>{row.hours ? row.current : formatCurrency(row.current)}</strong>
                    <strong>{row.hours ? row.ytd : formatCurrency(row.ytd)}</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {payroll ? (
            <div className="detail-grid">
              <div className="detail-card">
                <h3>Earnings</h3>
                <ul>
                  <li><span>Regular pay</span><strong>{formatCurrency(payroll.grossRegular)}</strong></li>
                  <li><span>Overtime pay</span><strong>{formatCurrency(payroll.grossOvertime)}</strong></li>
                  <li><span>Vacation accrual</span><strong>{formatCurrency(payroll.vacationAccrual)}</strong></li>
                  <li><span>Vacation paid</span><strong>{formatCurrency(payroll.vacationPaid)}</strong></li>
                  <li><span>Gross pay</span><strong>{formatCurrency(payroll.grossPay)}</strong></li>
                </ul>
              </div>

              <div className="detail-card">
                <h3>Employee deductions</h3>
                <ul>
                  <li><span>RRSP/RPP/PRPP</span><strong>{formatCurrency(payroll.rrspRppPrppContribution)}</strong></li>
                  <li><span>Union dues</span><strong>{formatCurrency(payroll.unionDues)}</strong></li>
                  <li><span>CPP</span><strong>{formatCurrency(payroll.cpp)}</strong></li>
                  <li><span>CPP2</span><strong>{formatCurrency(payroll.cpp2)}</strong></li>
                  <li><span>EI</span><strong>{formatCurrency(payroll.ei)}</strong></li>
                  <li><span>Federal tax</span><strong>{formatCurrency(payroll.federalTax)}</strong></li>
                  <li><span>Ontario tax</span><strong>{formatCurrency(payroll.provincialTax)}</strong></li>
                  <li><span>Total deductions</span><strong>{formatCurrency(payroll.totalDeductions)}</strong></li>
                </ul>
              </div>

              <div className="detail-card">
                <h3>Employer Cost</h3>
                <ul>
                  <li><span>Employer CPP</span><strong>{formatCurrency(payroll.employerCpp)}</strong></li>
                  <li><span>Employer CPP2</span><strong>{formatCurrency(payroll.employerCpp2)}</strong></li>
                  <li><span>Employer EI</span><strong>{formatCurrency(payroll.employerEi)}</strong></li>
                  <li><span>Total employer cost</span><strong>{formatCurrency(payroll.employerCost)}</strong></li>
                </ul>
              </div>
            </div>
          ) : null}

          <div className="panel-actions">
            <button className="primary-button" type="button" onClick={savePayRun} disabled={isSavingRun || !selectedEmployee}>
              {isSavingRun ? "Saving pay run..." : editingPayRunId ? "Save pay run changes" : "Save pay run"}
            </button>
            <button className="secondary-button wide-button" type="button" onClick={printCurrentPayStub} disabled={!selectedEmployee || !payroll}>
              Print current pay stub
            </button>
            <button className="secondary-button wide-button" type="button" onClick={printPd7aReport} disabled={recentPayRuns.length === 0}>
              Print PD7A report
            </button>
            {editingPayRunId ? (
              <button className="secondary-button wide-button" type="button" onClick={resetPayRunForm}>
                Cancel pay run edit
              </button>
            ) : null}
          </div>

          {payroll ? (
            <div className="notes-card">
              <h3>V2 guardrails</h3>
              <ul>
                {payroll.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
            </>
          ) : viewMode === "admin" ? (
            <div className="admin-section-grid">
              <div className="admin-tabs">
                <button className={adminTab === "company" ? "toggle-button active" : "toggle-button"} type="button" onClick={() => setAdminTab("company")}>
                  Company settings
                </button>
                <button className={adminTab === "people" ? "toggle-button active" : "toggle-button"} type="button" onClick={() => setAdminTab("people")}>
                  Client settings
                </button>
                <button className={adminTab === "tables" ? "toggle-button active" : "toggle-button"} type="button" onClick={() => setAdminTab("tables")}>
                  Payroll tables
                </button>
              </div>

              {adminTab === "company" ? (
                <>
                  <div className="detail-card">
                    <h3>Company settings</h3>
                    <p className="admin-copy">This is the firm branding that appears on pay stubs and payroll statements.</p>
                    <div className="mini-form-grid admin-form-grid">
                      <label>Company name<input value={companyProfile.name} onChange={(event) => handleCompanyProfileChange("name", event.target.value)} /></label>
                      <label>Legal name<input value={companyProfile.legalName} onChange={(event) => handleCompanyProfileChange("legalName", event.target.value)} /></label>
                      <label>Contact name<input value={companyProfile.contactName} onChange={(event) => handleCompanyProfileChange("contactName", event.target.value)} /></label>
                      <label>Email<input value={companyProfile.email} onChange={(event) => handleCompanyProfileChange("email", event.target.value)} /></label>
                      <label>Phone<input value={companyProfile.phone} onChange={(event) => handleCompanyProfileChange("phone", event.target.value)} /></label>
                      <label className="span-2">Logo URL<input value={companyProfile.logoUrl} onChange={(event) => handleCompanyProfileChange("logoUrl", event.target.value)} /></label>
                      <label className="span-2">Address line 1<input value={companyProfile.addressLine1} onChange={(event) => handleCompanyProfileChange("addressLine1", event.target.value)} /></label>
                      <label>Address line 2<input value={companyProfile.addressLine2} onChange={(event) => handleCompanyProfileChange("addressLine2", event.target.value)} /></label>
                      <label>City<input value={companyProfile.city} onChange={(event) => handleCompanyProfileChange("city", event.target.value)} /></label>
                      <label>Province<input value={companyProfile.province} onChange={(event) => handleCompanyProfileChange("province", event.target.value)} /></label>
                      <label>Postal code<input value={companyProfile.postalCode} onChange={(event) => handleCompanyProfileChange("postalCode", event.target.value)} /></label>
                    </div>
                    <button className="primary-button" type="button" onClick={saveCompanyProfile} disabled={isSavingCompany}>
                      {isSavingCompany ? "Saving company..." : "Save company settings"}
                    </button>
                  </div>

                  <div className="detail-card">
                    <h3>Data backup and restore</h3>
                    <p className="admin-copy">
                      Export a full SQLite backup before updates, or import an existing SQLite file to restore prior data.
                    </p>
                    <div className="panel-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={exportDatabaseBackup}
                        disabled={isExportingDatabase || isImportingDatabase}
                      >
                        {isExportingDatabase ? "Exporting backup..." : "Export database backup"}
                      </button>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={importDatabaseBackup}
                        disabled={isExportingDatabase || isImportingDatabase}
                      >
                        {isImportingDatabase ? "Importing database..." : "Import database backup"}
                      </button>
                    </div>
                  </div>

                  <div className="detail-card">
                    <h3>Salary override reasons</h3>
                    <p className="admin-copy">One reason per line. These options will appear on the payroll run form whenever a salary override is used.</p>
                    <label>
                      Override reason list
                      <textarea className="admin-textarea" value={appSettings.salaryOverrideReasons.join("\n")} onChange={(event) => handleSalaryOverrideReasonsChange(event.target.value)} rows={6} />
                    </label>
                  </div>

                  <div className="detail-card">
                    <h3>Custom field titles and required options</h3>
                    <p className="admin-copy">Update labels and required flags for the payroll run, employee form, and client form.</p>
                    <div className="field-config-grid">
                      {[
                        { title: "Payroll run form", section: "payrollFormFields" as const, config: payrollFieldConfig },
                        { title: "Employee form", section: "employeeFormFields" as const, config: employeeFieldConfig },
                        { title: "Client form", section: "clientFormFields" as const, config: clientFieldConfig },
                      ].map(({ title, section, config }, index) => (
                        <details key={title} className="field-config-card field-config-dropdown" open={index === 0}>
                          <summary className="field-config-summary">
                            <span>{title}</span>
                            <small>{Object.keys(config).length} fields</small>
                          </summary>
                          <div className="field-config-list">
                            <div className="field-config-list-head">
                              <span>Label</span>
                              <span>Required</span>
                            </div>
                            {Object.entries(config).map(([key, value]) => (
                              <div key={key} className="field-config-row">
                                <label className="field-config-input">
                                  <input value={value.label} onChange={(event) => handleFieldConfigChange(section, key, "label", event.target.value)} />
                                </label>
                                <label className="checkbox-row field-config-checkbox">
                                  <input type="checkbox" checked={value.required} onChange={(event) => handleFieldConfigChange(section, key, "required", event.target.checked)} />
                                </label>
                              </div>
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </div>
                </>
              ) : null}

              {adminTab === "people" ? (
                <>
                  <div className="client-settings-layout">
                    <aside className="detail-card client-directory-card">
                      <div className="panel-heading compact">
                        <div>
                          <span className="section-tag">Clients</span>
                          <h3>Client directory</h3>
                        </div>
                        <span className="client-directory-count">{activeClients.length}</span>
                      </div>

                      <label className="compact-field">
                        Search clients
                        <input
                          type="search"
                          placeholder="Search by name, contact, city, email..."
                          value={clientSearchQuery}
                          onChange={(event) => setClientSearchQuery(event.target.value)}
                        />
                      </label>

                      <div className="client-directory-list">
                        {filteredClients.map((client) => {
                          const isSelected = selectedClient?.id === client.id;
                          const employeeCount = employees.filter(
                            (employee) => employee.clientId === client.id && employee.active,
                          ).length;

                          return (
                            <article key={client.id} className={`client-directory-item${isSelected ? " active" : ""}`}>
                              <button
                                className="client-directory-main"
                                type="button"
                                onClick={() => setSelectedClientId(client.id)}
                              >
                                <span className="client-directory-initials">
                                  {(client.name || "Client").slice(0, 2).toUpperCase()}
                                </span>
                                <span className="client-directory-copy">
                                  <strong>{client.name}</strong>
                                  <small>{client.contactName || client.legalName || "Client company"}</small>
                                  <small>{employeeCount} employees</small>
                                </span>
                              </button>
                              <div className="client-directory-actions">
                                <button
                                  className="secondary-button icon-button"
                                  type="button"
                                  aria-label={`Client actions for ${client.name}`}
                                  onClick={() => setOpenClientActionId((current) => (current === client.id ? null : client.id))}
                                >
                                  ⋯
                                </button>
                                {openClientActionId === client.id ? (
                                  <div className="row-action-menu">
                                    <button className="secondary-button" type="button" onClick={() => {
                                      setSelectedClientId(client.id);
                                      setOpenClientActionId(null);
                                    }}>
                                      Open
                                    </button>
                                    <button className="secondary-button" type="button" onClick={() => {
                                      startEditingClient(client);
                                      setOpenClientActionId(null);
                                    }}>
                                      Edit
                                    </button>
                                    <button className="danger-button" type="button" onClick={() => {
                                      requestClientDelete(client.id);
                                      setOpenClientActionId(null);
                                    }}>
                                      Delete
                                    </button>
                                  </div>
                                ) : null}
                              </div>
                            </article>
                          );
                        })}
                        {filteredClients.length === 0 ? (
                          <p className="admin-copy no-margin">No clients match this search yet.</p>
                        ) : null}
                      </div>
                    </aside>

                    <div className="client-settings-detail">
                      <div className="detail-card client-profile-card">
                        <div className="client-profile-mark">
                          {(selectedClient?.name || newClient.name || "CL").slice(0, 2).toUpperCase()}
                        </div>
                        <div className="client-profile-copy">
                          <span className="section-tag">Selected client</span>
                          <h3>{selectedClient?.name || "No client selected"}</h3>
                          <p className="admin-copy">
                            {selectedClient
                              ? `Managing ${selectedClientEmployeeCount} employee profiles for this client.`
                              : "Create your first client to start organizing employees and pay run history."}
                          </p>
                          <div className="client-profile-meta">
                            <span>{selectedClient?.contactName || "No contact set"}</span>
                            <span>{selectedClient?.email || "No email set"}</span>
                            <span>{selectedClient?.city || "No city set"}</span>
                          </div>
                        </div>
                      </div>

                      <div className="detail-card">
                        <div className="client-form-head">
                          <div>
                            <h3>{editingClientId ? "Edit client company" : "Client settings"}</h3>
                            <p className="admin-copy">Keep client companies separate so each one can hold its own employees and payroll history.</p>
                          </div>
                          {clientFormHasChanges ? <span className="draft-pill">Unsaved changes</span> : null}
                        </div>

                        <div className="client-form-sections">
                          <section className="client-form-section">
                            <h4>Company basics</h4>
                            <div className="mini-form-grid admin-form-grid">
                              <label className={clientFieldErrors.name ? "field-error" : undefined}>
                                {renderFieldTitle(clientFieldConfig, "name", "Client company")}
                                <input
                                  value={newClient.name}
                                  placeholder="Acme Manufacturing Ltd."
                                  aria-invalid={Boolean(clientFieldErrors.name)}
                                  onChange={(event) => handleClientInput("name", event.target.value)}
                                />
                                {clientFieldErrors.name ? <small className="field-error-text">{clientFieldErrors.name}</small> : null}
                              </label>
                              <label>
                                {renderFieldTitle(clientFieldConfig, "legalName", "Legal name")}
                                <input
                                  value={newClient.legalName}
                                  placeholder="Acme Manufacturing Limited"
                                  onChange={(event) => handleClientInput("legalName", event.target.value)}
                                />
                              </label>
                              <label className={clientFieldErrors.logoUrl ? "field-error" : undefined}>
                                {renderFieldTitle(clientFieldConfig, "logoUrl", "Logo URL")}
                                <input
                                  value={newClient.logoUrl}
                                  placeholder="https://example.com/logo.png"
                                  aria-invalid={Boolean(clientFieldErrors.logoUrl)}
                                  onChange={(event) => handleClientInput("logoUrl", event.target.value)}
                                />
                                {clientFieldErrors.logoUrl
                                  ? <small className="field-error-text">{clientFieldErrors.logoUrl}</small>
                                  : <small>Optional. Use a full URL starting with http:// or https://.</small>}
                              </label>
                            </div>
                          </section>

                          <section className="client-form-section">
                            <h4>Primary contact</h4>
                            <div className="mini-form-grid admin-form-grid">
                              <label>
                                {renderFieldTitle(clientFieldConfig, "contactName", "Contact name")}
                                <input
                                  value={newClient.contactName}
                                  placeholder="Jane Doe"
                                  onChange={(event) => handleClientInput("contactName", event.target.value)}
                                />
                              </label>
                              <label className={clientFieldErrors.email ? "field-error" : undefined}>
                                {renderFieldTitle(clientFieldConfig, "email", "Email")}
                                <input
                                  value={newClient.email}
                                  type="email"
                                  placeholder="payroll@acme.ca"
                                  aria-invalid={Boolean(clientFieldErrors.email)}
                                  onChange={(event) => handleClientInput("email", event.target.value)}
                                />
                                {clientFieldErrors.email ? <small className="field-error-text">{clientFieldErrors.email}</small> : null}
                              </label>
                              <label>
                                {renderFieldTitle(clientFieldConfig, "phone", "Phone")}
                                <input
                                  value={newClient.phone}
                                  placeholder="+1 416 555 0182"
                                  onChange={(event) => handleClientInput("phone", event.target.value)}
                                />
                              </label>
                            </div>
                          </section>

                          <section className="client-form-section">
                            <h4>Address</h4>
                            <div className="mini-form-grid admin-form-grid">
                              <label className="span-2">
                                {renderFieldTitle(clientFieldConfig, "addressLine1", "Address line 1")}
                                <input
                                  value={newClient.addressLine1}
                                  placeholder="123 Front Street West"
                                  onChange={(event) => handleClientInput("addressLine1", event.target.value)}
                                />
                              </label>
                              <label>
                                {renderFieldTitle(clientFieldConfig, "addressLine2", "Address line 2")}
                                <input
                                  value={newClient.addressLine2}
                                  placeholder="Suite 400"
                                  onChange={(event) => handleClientInput("addressLine2", event.target.value)}
                                />
                              </label>
                              <label>
                                {renderFieldTitle(clientFieldConfig, "city", "City")}
                                <input
                                  value={newClient.city}
                                  placeholder="Toronto"
                                  onChange={(event) => handleClientInput("city", event.target.value)}
                                />
                              </label>
                              <label>
                                {renderFieldTitle(clientFieldConfig, "province", "Province")}
                                <input
                                  value={newClient.province}
                                  placeholder="ON"
                                  onChange={(event) => handleClientInput("province", event.target.value)}
                                />
                              </label>
                              <label className={clientFieldErrors.postalCode ? "field-error" : undefined}>
                                {renderFieldTitle(clientFieldConfig, "postalCode", "Postal code")}
                                <input
                                  value={newClient.postalCode}
                                  placeholder="A1A 1A1"
                                  aria-invalid={Boolean(clientFieldErrors.postalCode)}
                                  onChange={(event) => handleClientInput("postalCode", event.target.value)}
                                />
                                {clientFieldErrors.postalCode ? <small className="field-error-text">{clientFieldErrors.postalCode}</small> : null}
                              </label>
                            </div>
                          </section>
                        </div>

                        <div className="client-action-bar">
                          <button className="primary-button" type="button" onClick={saveClient} disabled={isSavingClient || !clientFormCanSave}>
                            {isSavingClient ? "Saving client..." : editingClientId ? "Save client changes" : "Add client"}
                          </button>
                          {editingClientId ? (
                            <button className="secondary-button wide-button" type="button" onClick={resetClientForm}>
                              Cancel client edit
                            </button>
                          ) : (
                            <button className="secondary-button wide-button" type="button" onClick={resetClientForm} disabled={!clientFormHasChanges}>
                              Reset draft
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="detail-card">
                    <h3>{editingEmployeeId ? "Edit employee" : "Employees"}</h3>
                    <p className="admin-copy">
                      Manage the team for {selectedClient?.name ?? "the selected client"} from the main setup area.
                    </p>

                    <div className="employee-list">
                      {clientEmployees.map((employee) => (
                        <article key={employee.id} className="employee-card">
                          <div>
                            <strong>{getDisplayName(employee)}</strong>
                            <span>{employee.role} · {employee.workerClassification}</span>
                          </div>
                          <div className="employee-side">
                            <small>
                              {employee.employmentType === "salary"
                                ? `${formatCurrency(employee.annualSalary ?? 0)} / year`
                                : `${formatCurrency(employee.hourlyRate ?? 0)} / hour`}
                            </small>
                            <small>Termination: {employee.terminationDate || "Active"}</small>
                            <small>{(employee.attachments ?? []).length} documents</small>
                            <div className="employee-actions">
                              <button
                                className="secondary-button icon-button"
                                type="button"
                                aria-label={`Employee actions for ${getDisplayName(employee)}`}
                                onClick={() => setOpenEmployeeActionId((current) => (current === employee.id ? null : employee.id))}
                              >
                                ⋯
                              </button>
                              {openEmployeeActionId === employee.id ? (
                                <div className="row-action-menu">
                                  <button className="secondary-button" type="button" onClick={() => {
                                    startEditingEmployee(employee);
                                    setOpenEmployeeActionId(null);
                                  }}>
                                    Edit
                                  </button>
                                  <button className="danger-button" type="button" onClick={() => {
                                    requestEmployeeDelete(employee.id);
                                    setOpenEmployeeActionId(null);
                                  }}>
                                    Delete
                                  </button>
                                </div>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="detail-card">
                    <h3>{editingEmployeeId ? "Edit employee" : "Add employee"}</h3>
                    <div className="mini-form-grid employee-form-grid">
                      <label className="compact-field">{renderFieldTitle(employeeFieldConfig, "clientId", "Client")}
                        <select value={newEmployee.clientId} onChange={(event) => handleEmployeeInput("clientId", event.target.value)}>
                          {activeClients.map((client) => (
                            <option key={client.id} value={client.id}>
                              {client.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="compact-field">{renderFieldTitle(employeeFieldConfig, "employeeNumber", "Employee number")}<input value={newEmployee.employeeNumber} onChange={(event) => handleEmployeeInput("employeeNumber", event.target.value)} /></label>
                      <label className="compact-field">{renderFieldTitle(employeeFieldConfig, "hireDate", "Hire date")}<input type="date" value={newEmployee.hireDate} onChange={(event) => handleEmployeeInput("hireDate", event.target.value)} /></label>
                      <label className="compact-field">{renderFieldTitle(employeeFieldConfig, "terminationDate", "Termination date")}<input type="date" value={newEmployee.terminationDate ?? ""} onChange={(event) => handleEmployeeInput("terminationDate", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "firstName", "First name")}<input value={newEmployee.firstName} onChange={(event) => handleEmployeeInput("firstName", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "lastName", "Last name")}<input value={newEmployee.lastName} onChange={(event) => handleEmployeeInput("lastName", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "role", "Job title")}<input value={newEmployee.role} onChange={(event) => handleEmployeeInput("role", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "email", "Email")}<input value={newEmployee.email} onChange={(event) => handleEmployeeInput("email", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "dateOfBirth", "Date of birth")}<input type="date" value={newEmployee.dateOfBirth} onChange={(event) => handleEmployeeInput("dateOfBirth", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "phone", "Phone")}<input value={newEmployee.phone} onChange={(event) => handleEmployeeInput("phone", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "addressLine1", "Address line 1")}<input value={newEmployee.addressLine1} onChange={(event) => handleEmployeeInput("addressLine1", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "addressLine2", "Address line 2")}<input value={newEmployee.addressLine2} onChange={(event) => handleEmployeeInput("addressLine2", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "city", "City")}<input value={newEmployee.city} onChange={(event) => handleEmployeeInput("city", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "province", "Province")}<input value={newEmployee.province} onChange={(event) => handleEmployeeInput("province", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "postalCode", "Postal code")}<input value={newEmployee.postalCode} onChange={(event) => handleEmployeeInput("postalCode", event.target.value)} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "employmentType", "Employment type")}
                        <select value={newEmployee.employmentType} onChange={(event) => handleEmployeeInput("employmentType", event.target.value as Employee["employmentType"])}>
                          <option value="hourly">Hourly</option>
                          <option value="salary">Salary</option>
                        </select>
                      </label>
                      <label>{renderFieldTitle(employeeFieldConfig, "workerClassification", "Worker classification")}
                        <select value={newEmployee.workerClassification} onChange={(event) => handleEmployeeInput("workerClassification", event.target.value as WorkerClassification)}>
                          {workerClassificationOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      {newEmployee.employmentType === "hourly" ? (
                        <label>{renderFieldTitle(employeeFieldConfig, "hourlyRate", "Hourly rate")}<input type="number" min="0" value={newEmployee.hourlyRate} onChange={(event) => handleEmployeeInput("hourlyRate", Number(event.target.value))} /></label>
                      ) : (
                        <label>{renderFieldTitle(employeeFieldConfig, "annualSalary", "Annual salary")}<input type="number" min="0" value={newEmployee.annualSalary} onChange={(event) => handleEmployeeInput("annualSalary", Number(event.target.value))} /></label>
                      )}
                      <label>{renderFieldTitle(employeeFieldConfig, "defaultHoursPerPeriod", "Default regular hours")}<input type="number" min="0" step="0.01" value={newEmployee.defaultHoursPerPeriod} onChange={(event) => handleEmployeeInput("defaultHoursPerPeriod", Number(event.target.value))} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "vacationRate", "Vacation rate")}<input type="number" min="0" step="0.01" value={newEmployee.vacationRate} onChange={(event) => handleEmployeeInput("vacationRate", Number(event.target.value))} /></label>
                      <label>CPP status
                        <select value={newEmployee.cppStatus} onChange={(event) => handleEmployeeInput("cppStatus", event.target.value as CppStatus)}>
                          {cppStatusOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>EI status
                        <select value={newEmployee.eiStatus} onChange={(event) => handleEmployeeInput("eiStatus", event.target.value as EiStatus)}>
                          {eiStatusOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>{renderFieldTitle(employeeFieldConfig, "federalClaimAmount", "Federal TD1 amount")}<input type="number" min="0" step="0.01" value={newEmployee.federalClaimAmount} onChange={(event) => handleEmployeeInput("federalClaimAmount", Number(event.target.value))} /></label>
                      <label>{renderFieldTitle(employeeFieldConfig, "provincialClaimAmount", "Ontario TD1 amount")}<input type="number" min="0" step="0.01" value={newEmployee.provincialClaimAmount} onChange={(event) => handleEmployeeInput("provincialClaimAmount", Number(event.target.value))} /></label>
                    </div>

                    <div className="detail-card attachment-card">
                      <div className="attachment-header">
                        <div>
                          <h3>Employee documents</h3>
                          <p className="admin-copy">Attach profile documents like ID, signed forms, or onboarding files.</p>
                        </div>
                        <button className="secondary-button" type="button" onClick={() => attachmentInputRef.current?.click()}>
                          Attach document
                        </button>
                      </div>
                      <input
                        ref={attachmentInputRef}
                        className="hidden-file-input"
                        type="file"
                        multiple
                        onChange={(event) => void addEmployeeAttachments(event.target.files)}
                      />

                      {(newEmployee.attachments ?? []).length > 0 ? (
                        <div className="attachment-list">
                          {(newEmployee.attachments ?? []).map((attachment) => (
                            <article key={attachment.id} className="attachment-row">
                              <div className="attachment-copy">
                                <strong>{attachment.name}</strong>
                                <small>
                                  {Math.max(1, Math.round(attachment.size / 1024))} KB · {new Date(attachment.uploadedAt).toLocaleDateString("en-CA")}
                                </small>
                              </div>
                              <div className="attachment-actions">
                                <a className="secondary-button attachment-link" href={attachment.dataUrl} download={attachment.name}>
                                  Open
                                </a>
                                <button className="danger-button" type="button" onClick={() => removeEmployeeAttachment(attachment.id)}>
                                  Remove
                                </button>
                              </div>
                            </article>
                          ))}
                        </div>
                      ) : (
                        <p className="admin-copy no-margin">No documents attached yet.</p>
                      )}
                    </div>

                    <button className="primary-button" type="button" onClick={saveEmployee} disabled={isAddingEmployee}>
                      {isAddingEmployee ? "Saving employee..." : editingEmployeeId ? "Save changes" : "Add employee"}
                    </button>
                    {editingEmployeeId ? (
                      <button className="secondary-button wide-button" type="button" onClick={resetEmployeeForm}>
                        Cancel edit
                      </button>
                    ) : null}
                  </div>
                </>
              ) : null}

              {adminTab === "tables" && activeTaxTable && activeTaxTableDetails ? (
                <div className="tax-table-card">
                  <div className="panel-heading compact">
                    <div>
                      <span className="section-tag">Payroll tables</span>
                      <h2>{activeTaxTable.label}</h2>
                    </div>
                  </div>

                  <p className="tax-table-kicker">Payroll settings and official deduction thresholds</p>
                  <p className="tax-table-copy">{activeTaxTable.sourceSummary}</p>

                  <div className="tax-table-meta">
                    <span>Source updated</span>
                    <strong>{formatStatementDate(activeTaxTable.sourceUpdatedAt)}</strong>
                  </div>

                  <div className="tax-pill-row">
                    {supportedTaxYears.map((year) => (
                      <span key={year} className={`tax-pill${year === activeTaxTable.taxYear ? " active" : ""}`}>
                        {year}
                      </span>
                    ))}
                  </div>

                  <button className="secondary-button wide-button" type="button" onClick={openCraPayrollTables}>
                    Open CRA payroll formulas
                  </button>
                  <button className="secondary-button wide-button" type="button" onClick={openOntarioTaxSource}>
                    Open Ontario tax source
                  </button>
                  <button className="secondary-button wide-button" type="button" onClick={() => setShowTaxTableWorkflow((current) => !current)}>
                    {showTaxTableWorkflow ? "Hide update workflow" : "Show update workflow"}
                  </button>

                  <ul className="tax-table-list">
                    <li><span>CPP max</span><strong>{formatCurrency(activeTaxTableDetails.rates.cppMaxCombined)}</strong></li>
                    <li><span>CPP max earnings</span><strong>{formatCurrency(activeTaxTableDetails.rates.ympe)}</strong></li>
                    <li><span>CPP2 max</span><strong>{formatCurrency(activeTaxTableDetails.rates.cpp2Max)}</strong></li>
                    <li><span>CPP2 top band</span><strong>{formatCurrency(activeTaxTableDetails.rates.yampe)}</strong></li>
                    <li><span>EI max</span><strong>{formatCurrency(activeTaxTableDetails.rates.eiMax)}</strong></li>
                    <li><span>EI max earnings</span><strong>{formatCurrency(activeTaxTableDetails.rates.eiMaxInsurableEarnings)}</strong></li>
                    <li><span>Basic CPP exemption</span><strong>{formatCurrency(activeTaxTableDetails.rates.cppBasicExemption)}</strong></li>
                  </ul>

                  {showTaxTableWorkflow ? (
                    <div className="tax-update-card">
                      <h3>CRA update workflow</h3>
                      <p>
                        This app uses reviewed payroll tables, not live scraping. Use the official sources above,
                        verify the values, then update the versioned table file for the new tax year.
                      </p>
                      <ol className="tax-update-steps">
                        <li>Check the CRA T4127 payroll formulas for the new effective date.</li>
                        <li>Check the Ontario tax dataset for provincial thresholds and rates.</li>
                        <li>Compare CPP, CPP2, EI, YMPE, YAMPE, and tax brackets to the current app values.</li>
                        <li>Add the new year table and source date to the app after review.</li>
                      </ol>
                      <div className="tax-update-meta">
                        <span>Current app table</span>
                        <strong>{activeTaxTable.label}</strong>
                      </div>
                      <div className="tax-update-meta">
                        <span>Current source date</span>
                        <strong>{formatStatementDate(activeTaxTable.sourceUpdatedAt)}</strong>
                      </div>
                    </div>
                  ) : null}

                  <div className="tax-update-card pdoc-compare-card">
                    <h3>PDOC compare</h3>
                    <p>
                      Use this to compare the live payroll formula against a CRA PDOC test case. This keeps the
                      CRA-style TD1, CPP, EI, and vacation-pay logic visible in the Admin dashboard.
                    </p>

                    <div className="compare-button-row">
                      <button className="secondary-button" type="button" onClick={loadSelectedEmployeeIntoPdocCompare}>
                        Load selected employee defaults
                      </button>
                      <button className="secondary-button" type="button" onClick={() => {
                        setPdocCompareForm(defaultPdocCompareForm);
                        setPdocExpectedValues(defaultPdocExpectedValues);
                        setStatusMessage("Loaded the standard monthly PDOC sample into compare.");
                      }}>
                        Load CRA sample case
                      </button>
                    </div>

                    <div className="compare-grid">
                      <label>
                        Employment type
                        <select value={pdocCompareForm.employmentType} onChange={(event) => handlePdocCompareInput("employmentType", event.target.value as Employee["employmentType"])}>
                          <option value="salary">salary</option>
                          <option value="hourly">hourly</option>
                        </select>
                      </label>
                      <label>
                        Pay frequency
                        <select value={pdocCompareForm.payFrequency} onChange={(event) => handlePdocCompareInput("payFrequency", event.target.value as PayFrequency)}>
                          {payFrequencyOptions.map((frequency) => (
                            <option key={frequency} value={frequency}>
                              {frequency}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Annual salary
                        <input type="number" min="0" value={pdocCompareForm.annualSalary} onChange={(event) => handlePdocCompareInput("annualSalary", Number(event.target.value))} />
                      </label>
                      <label>
                        Hourly rate
                        <input type="number" min="0" value={pdocCompareForm.hourlyRate} onChange={(event) => handlePdocCompareInput("hourlyRate", Number(event.target.value))} />
                      </label>
                      <label>
                        Hours per period
                        <input type="number" min="0" step="0.01" value={pdocCompareForm.defaultHoursPerPeriod} onChange={(event) => handlePdocCompareInput("defaultHoursPerPeriod", Number(event.target.value))} />
                      </label>
                      <label>
                        Regular hours
                        <input type="number" min="0" step="0.01" value={pdocCompareForm.regularHours} onChange={(event) => handlePdocCompareInput("regularHours", Number(event.target.value))} />
                      </label>
                      <label>
                        Overtime hours
                        <input type="number" min="0" step="0.01" value={pdocCompareForm.overtimeHours} onChange={(event) => handlePdocCompareInput("overtimeHours", Number(event.target.value))} />
                      </label>
                      <label>
                        Vacation paid
                        <input type="number" min="0" step="0.01" value={pdocCompareForm.vacationPayoutAmount} onChange={(event) => handlePdocCompareInput("vacationPayoutAmount", Number(event.target.value))} />
                      </label>
                      <label>
                        Bonus
                        <input type="number" min="0" step="0.01" value={pdocCompareForm.bonusAmount} onChange={(event) => handlePdocCompareInput("bonusAmount", Number(event.target.value))} />
                      </label>
                      <label>
                        Taxable benefits
                        <input type="number" min="0" step="0.01" value={pdocCompareForm.taxableBenefits} onChange={(event) => handlePdocCompareInput("taxableBenefits", Number(event.target.value))} />
                      </label>
                      <label>
                        Federal TD1
                        <input type="number" min="0" step="0.01" value={pdocCompareForm.federalClaimAmount} onChange={(event) => handlePdocCompareInput("federalClaimAmount", Number(event.target.value))} />
                      </label>
                      <label>
                        Ontario TD1
                        <input type="number" min="0" step="0.01" value={pdocCompareForm.provincialClaimAmount} onChange={(event) => handlePdocCompareInput("provincialClaimAmount", Number(event.target.value))} />
                      </label>
                      <label>
                        CPP status
                        <select value={pdocCompareForm.cppStatus} onChange={(event) => handlePdocCompareInput("cppStatus", event.target.value as CppStatus)}>
                          {cppStatusOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        EI status
                        <select value={pdocCompareForm.eiStatus} onChange={(event) => handlePdocCompareInput("eiStatus", event.target.value as EiStatus)}>
                          {eiStatusOptions.map((option) => (
                            <option key={option} value={option}>
                              {option}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label>
                        Pay period start
                        <input type="date" value={pdocCompareForm.payPeriodStart} onChange={(event) => handlePdocCompareInput("payPeriodStart", event.target.value)} />
                      </label>
                      <label>
                        Pay period end
                        <input type="date" value={pdocCompareForm.payPeriodEnd} onChange={(event) => handlePdocCompareInput("payPeriodEnd", event.target.value)} />
                      </label>
                    </div>

                    <div className="compare-meta-grid">
                      <div className="tax-update-meta">
                        <span>Derived tax year</span>
                        <strong>{pdocCompareTaxYear}</strong>
                      </div>
                      <div className="tax-update-meta">
                        <span>Formula source</span>
                        <strong>{getTaxTable(pdocCompareTaxYear).summary.label}</strong>
                      </div>
                    </div>

                    <div className="compare-expected-grid">
                      <label>
                        Expected gross pay
                        <input type="number" min="0" step="0.01" value={pdocExpectedValues.grossPay} onChange={(event) => handlePdocExpectedInput("grossPay", event.target.value)} />
                      </label>
                      <label>
                        Expected CPP
                        <input type="number" min="0" step="0.01" value={pdocExpectedValues.cpp} onChange={(event) => handlePdocExpectedInput("cpp", event.target.value)} />
                      </label>
                      <label>
                        Expected EI
                        <input type="number" min="0" step="0.01" value={pdocExpectedValues.ei} onChange={(event) => handlePdocExpectedInput("ei", event.target.value)} />
                      </label>
                      <label>
                        Expected federal tax
                        <input type="number" min="0" step="0.01" value={pdocExpectedValues.federalTax} onChange={(event) => handlePdocExpectedInput("federalTax", event.target.value)} />
                      </label>
                      <label>
                        Expected Ontario tax
                        <input type="number" min="0" step="0.01" value={pdocExpectedValues.provincialTax} onChange={(event) => handlePdocExpectedInput("provincialTax", event.target.value)} />
                      </label>
                      <label>
                        Expected net pay
                        <input type="number" min="0" step="0.01" value={pdocExpectedValues.netPay} onChange={(event) => handlePdocExpectedInput("netPay", event.target.value)} />
                      </label>
                    </div>

                    <div className="compare-results">
                      <div className="compare-results-header">
                        <span>Item</span>
                        <span>App</span>
                        <span>PDOC</span>
                        <span>Delta</span>
                      </div>
                      {pdocCompareRows.map((row) => (
                        <div key={row.label} className="compare-results-row">
                          <span>{row.label}</span>
                          <strong>{formatCurrency(row.actual)}</strong>
                          <strong>{row.expected == null ? "—" : formatCurrency(row.expected)}</strong>
                          <strong className={row.delta == null ? "" : Math.abs(row.delta) < 0.01 ? "delta-match" : "delta-gap"}>
                            {row.delta == null ? "—" : `${row.delta > 0 ? "+" : ""}${formatCurrency(row.delta)}`}
                          </strong>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="history-card no-top-margin">
              <div className="history-table">
                <div className="history-table-header">
                  <span>Employee</span>
                  <span>Pay period</span>
                  <span>Net</span>
                  <span>Employer</span>
                  <span>Actions</span>
                </div>
                {recentPayRunsForClient.map((run) => (
                  <article key={run.id} className="history-row">
                    <div className="history-cell history-primary">
                      <strong>{run.employeeName}</strong>
                      <small>{run.clientName ?? selectedClient?.name ?? "Client"} · {getFrequencyLabel(run.payFrequency)}</small>
                    </div>
                    <div className="history-cell">
                      <strong>{formatPayPeriod(run.payPeriodStart, run.payPeriodEnd)}</strong>
                      <small>Created {formatStatementDate(run.createdAt)}</small>
                    </div>
                    <div className="history-cell">
                      <strong>{formatCurrency(run.netPay)}</strong>
                      <small>Net pay</small>
                    </div>
                    <div className="history-cell">
                      <strong>{formatCurrency(run.employerCost)}</strong>
                      <small>Employer cost</small>
                    </div>
                    <div className="history-cell history-actions">
                      <button className="secondary-button" type="button" onClick={() => printSavedPayStub(run)}>
                        Print
                      </button>
                      <button className="secondary-button" type="button" onClick={() => emailSavedPayStub(run)}>
                        Email paystub
                      </button>
                      <button className="secondary-button" type="button" onClick={() => {
                        setViewMode("payroll");
                        startEditingPayRun(run);
                      }}>
                        Edit
                      </button>
                      <button className="danger-button" type="button" onClick={() => removePayRun(run.id)}>
                        Delete
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>

        {viewMode !== "history" ? (
        <section className="panel sidebar-panel">
          {viewMode === "admin" ? (
            <div className="panel-heading compact">
              <div>
                <span className="section-tag">{adminTab === "people" ? "Employees" : adminTab === "tables" ? "Reference" : "Admin"}</span>
                <h2>
                  {adminTab === "people"
                    ? selectedClient ? `${selectedClient.name} team` : "Employee setup"
                    : adminTab === "tables"
                      ? "Update notes"
                      : "Admin summary"}
                </h2>
              </div>
            </div>
          ) : null}

          {viewMode === "admin" ? (
            <>
              {adminTab === "people" ? (
                <div className="detail-card">
                  <h3>Employee workspace moved</h3>
                  <p className="admin-copy">
                    The employee list and employee form now sit in the left content area under Client directory so you have more space to work.
                  </p>
                </div>
              ) : adminTab === "tables" ? (
                <div className="detail-card">
                  <h3>Payroll tables</h3>
                  <p className="admin-copy">
                    The full payroll tables workspace is now on the left side so it has more room for the CRA workflow,
                    thresholds, and PDOC compare tools.
                  </p>
                  <ul className="tax-table-list compact-list">
                    <li><span>Why moved</span><strong>More working space</strong></li>
                    <li><span>Best use</span><strong>Review rates and compare cases</strong></li>
                    <li><span>Tip</span><strong>Use the main panel for tables updates</strong></li>
                  </ul>
                </div>
              ) : (
                <>
                  <div className="detail-card">
                    <h3>Admin quick guide</h3>
                    <ul className="tax-table-list compact-list">
                      <li><span>Company settings</span><strong>Branding, reasons, labels</strong></li>
                      <li><span>Client settings</span><strong>Clients and employees</strong></li>
                      <li><span>Payroll tables</span><strong>Rates, source links, PDOC check</strong></li>
                    </ul>
                  </div>

                  <div className="compliance-card">
                    <div className="panel-heading compact">
                      <div>
                        <span className="section-tag">Compliance</span>
                        <h2>Launch checklist</h2>
                      </div>
                    </div>

                    <div className="task-list">
                      {complianceTasks.map((task) => (
                        <article key={task.id} className={`task-card status-${task.status}`}>
                          <div className="task-meta">
                            <span>{task.cadence}</span>
                            <span>{task.owner}</span>
                          </div>
                          <strong>{task.title}</strong>
                          <small>{task.dueLabel}</small>
                        </article>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          ) : (
            <>
              <div className="panel-heading compact">
                <div>
                  <span className="section-tag">Team setup</span>
                  <h2>{selectedClient ? `${selectedClient.name} employees` : "Employees"}</h2>
                </div>
              </div>

              <div className="employee-list">
                {clientEmployees.map((employee) => (
                  <article key={employee.id} className="employee-card">
                    <div>
                      <strong>{getDisplayName(employee)}</strong>
                      <span>{employee.role}</span>
                    </div>
                    <div className="employee-side">
                      <small>
                        {employee.employmentType === "salary"
                          ? `${formatCurrency(employee.annualSalary ?? 0)} / year`
                          : `${formatCurrency(employee.hourlyRate ?? 0)} / hour`}
                      </small>
                      <small>Termination: {employee.terminationDate || "Active"}</small>
                    </div>
                  </article>
                ))}
              </div>

              <div className="compliance-card">
                <div className="panel-heading compact">
                  <div>
                    <span className="section-tag">Compliance</span>
                    <h2>Launch checklist</h2>
                  </div>
                </div>

                <div className="task-list">
                  {complianceTasks.map((task) => (
                    <article key={task.id} className={`task-card status-${task.status}`}>
                      <div className="task-meta">
                        <span>{task.cadence}</span>
                        <span>{task.owner}</span>
                      </div>
                      <strong>{task.title}</strong>
                      <small>{task.dueLabel}</small>
                    </article>
                  ))}
                </div>
              </div>
            </>
          )}
        </section>
        ) : null}
      </main>

      {pendingClientDeleteTarget ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-client-title">
            <h3 id="delete-client-title">Delete client: {pendingClientDeleteTarget.name}</h3>
            <p className="admin-copy">
              This will also delete {pendingClientDeleteEmployeeCount} employee profile{pendingClientDeleteEmployeeCount === 1 ? "" : "s"}
              {" "}and {pendingClientDeleteRunCount} pay run{pendingClientDeleteRunCount === 1 ? "" : "s"} for this client.
            </p>
            <p className="admin-copy">This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={cancelClientDelete}>
                Cancel
              </button>
              <button className="danger-button" type="button" onClick={() => void confirmClientDelete()} disabled={isDeletingClient}>
                {isDeletingClient ? "Deleting client..." : "Delete client"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingEmployeeDeleteTarget ? (
        <div className="modal-backdrop" role="presentation">
          <div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="delete-employee-title">
            <h3 id="delete-employee-title">Delete employee: {pendingEmployeeDeleteTarget.name}</h3>
            <p className="admin-copy">
              This will remove the employee profile and {pendingEmployeeDeleteRunCount} related pay run
              {pendingEmployeeDeleteRunCount === 1 ? "" : "s"}.
            </p>
            <p className="admin-copy">This action cannot be undone.</p>
            <div className="modal-actions">
              <button className="secondary-button" type="button" onClick={cancelEmployeeDelete}>
                Cancel
              </button>
              <button className="danger-button" type="button" onClick={() => void confirmEmployeeDelete()} disabled={isDeletingEmployee}>
                {isDeletingEmployee ? "Deleting employee..." : "Delete employee"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default AppV2;
