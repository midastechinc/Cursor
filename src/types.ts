export type PayFrequency = "weekly" | "biweekly" | "semi-monthly" | "monthly";

export type EmploymentType = "hourly" | "salary";
export type VacationHandling = "pay" | "accrue" | "custom";
export type WorkerClassification = "employee" | "owner-employee" | "self-employed-contractor";
export type CppStatus =
  | "standard"
  | "exempt-under-18"
  | "exempt-70-plus"
  | "cpp-working-beneficiary-exempt";
export type EiStatus =
  | "standard"
  | "non-insurable-cra-ruling"
  | "owner-related-pending-ruling"
  | "self-employed-non-insurable";

export interface FieldConfig {
  label: string;
  required: boolean;
}

export interface AppSettings {
  salaryOverrideReasons: string[];
  payrollFormFields: Record<string, FieldConfig>;
  employeeFormFields: Record<string, FieldConfig>;
  clientFormFields: Record<string, FieldConfig>;
}

export interface CompanyProfile {
  name: string;
  legalName: string;
  contactName: string;
  email: string;
  phone: string;
  logoUrl: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  settings: AppSettings;
}

export interface Client {
  id: string;
  name: string;
  legalName: string;
  contactName: string;
  email: string;
  phone: string;
  logoUrl: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  province: string;
  postalCode: string;
  active: boolean;
}

export interface EmployeeAttachment {
  id: string;
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  dataUrl: string;
}

export interface Employee {
  id: string;
  clientId: string;
  employeeNumber?: string;
  attachments?: EmployeeAttachment[];
  firstName: string;
  lastName: string;
  fullName: string;
  role: string;
  email?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  city?: string;
  province?: string;
  postalCode?: string;
  dateOfBirth?: string;
  hireDate?: string;
  employmentType: EmploymentType;
  workerClassification: WorkerClassification;
  hourlyRate?: number;
  annualSalary?: number;
  defaultHoursPerPeriod: number;
  provinceOfEmployment: "ON";
  federalClaimAmount: number;
  provincialClaimAmount: number;
  vacationRate: number;
  rrspRppPrppContributionPerPeriod: number;
  unionDuesPerPeriod: number;
  prescribedZoneDeductionAnnual: number;
  otherAnnualDeductionsAnnual: number;
  cppStatus: CppStatus;
  eiStatus: EiStatus;
  active: boolean;
}

export interface PayRunDraft {
  employeeId: string;
  payFrequency: PayFrequency;
  payPeriodStart: string;
  payPeriodEnd: string;
  salaryOverrideAmount: number;
  salaryOverrideReason: string;
  vacationHandling: VacationHandling;
  accrueVacation: boolean;
  vacationPayoutAmount: number;
  regularHours: number;
  overtimeHours: number;
  bonusAmount: number;
  taxableBenefits: number;
}

export interface PayrollBreakdown {
  grossRegular: number;
  grossOvertime: number;
  vacationAccrual: number;
  vacationPaid: number;
  grossPay: number;
  rrspRppPrppContribution: number;
  unionDues: number;
  cpp: number;
  cpp2: number;
  ei: number;
  federalTax: number;
  provincialTax: number;
  totalDeductions: number;
  netPay: number;
  employerCpp: number;
  employerCpp2: number;
  employerEi: number;
  employerCost: number;
  notes: string[];
}

export interface PayStubTotals {
  regularHours: number;
  overtimeHours: number;
  bonusAmount: number;
  taxableBenefits: number;
  grossRegular: number;
  grossOvertime: number;
  vacationAccrual: number;
  vacationPaid: number;
  vacationBalance: number;
  grossPay: number;
  rrspRppPrppContribution: number;
  unionDues: number;
  cpp: number;
  cpp2: number;
  ei: number;
  federalTax: number;
  provincialTax: number;
  totalDeductions: number;
  netPay: number;
  employerCpp: number;
  employerCpp2: number;
  employerEi: number;
  employerCost: number;
}

export interface Pd7aReportInput {
  remitterName: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  grossPayroll: number;
  employeeCount: number;
  runCount: number;
  employeeCpp: number;
  employeeCpp2: number;
  employerCpp: number;
  employerCpp2: number;
  employeeEi: number;
  employerEi: number;
  incomeTax: number;
}

export interface TaxTableSummary {
  taxYear: number;
  label: string;
  sourceUpdatedAt: string;
  sourceSummary: string;
}

export interface PayStubSnapshot {
  companyProfile?: CompanyProfile;
  client?: Client;
  employee: Employee;
  draft: PayRunDraft;
  breakdown: PayrollBreakdown;
  ytd: PayStubTotals;
  taxTable?: TaxTableSummary;
}

export interface PayrollPreviewResponse {
  breakdown: PayrollBreakdown;
  ytd: PayStubTotals;
  taxTable: TaxTableSummary;
}

export interface ComplianceTask {
  id: string;
  title: string;
  owner: string;
  cadence: string;
  dueLabel: string;
  status: "ready" | "watch" | "action";
}

export interface PayRunRecord {
  id: string;
  employeeId: string;
  clientId?: string;
  clientName?: string;
  employeeName: string;
  role: string;
  taxYear?: number;
  payFrequency: PayFrequency;
  payPeriodStart: string;
  payPeriodEnd: string;
  accrueVacation: boolean;
  vacationPayoutAmount: number;
  regularHours: number;
  overtimeHours: number;
  bonusAmount: number;
  taxableBenefits: number;
  grossPay: number;
  netPay: number;
  employerCost: number;
  createdAt: string;
  payStub?: PayStubSnapshot;
}

export interface BootstrapPayload {
  companyProfile: CompanyProfile;
  clients: Client[];
  employees: Employee[];
  complianceTasks: ComplianceTask[];
  recentPayRuns: PayRunRecord[];
  taxTable: TaxTableSummary;
}
