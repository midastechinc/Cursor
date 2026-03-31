import type { Employee, PayFrequency, PayRunDraft, PayrollBreakdown, PayStubTotals, VacationHandling } from "../types.js";
import { getTaxTable, getTaxYearFromDraft } from "./taxTables.js";

const PERIODS_PER_YEAR: Record<PayFrequency, number> = {
  weekly: 52,
  biweekly: 26,
  "semi-monthly": 24,
  monthly: 12,
};

type TaxBracket = {
  upper: number;
  rate: number;
  constant: number;
};

const currency = new Intl.NumberFormat("en-CA", {
  style: "currency",
  currency: "CAD",
  maximumFractionDigits: 2,
});

const roundMoney = (value: number) => Math.round(value * 100) / 100;
const createZeroTotals = (): PayStubTotals => ({
  regularHours: 0,
  overtimeHours: 0,
  bonusAmount: 0,
  taxableBenefits: 0,
  grossRegular: 0,
  grossOvertime: 0,
  vacationAccrual: 0,
  vacationPaid: 0,
  vacationBalance: 0,
  grossPay: 0,
  rrspRppPrppContribution: 0,
  unionDues: 0,
  cpp: 0,
  cpp2: 0,
  ei: 0,
  federalTax: 0,
  provincialTax: 0,
  totalDeductions: 0,
  netPay: 0,
  employerCpp: 0,
  employerCpp2: 0,
  employerEi: 0,
  employerCost: 0,
});

const getPeriodsPerYear = (frequency: PayFrequency) => PERIODS_PER_YEAR[frequency];

const getBasePayForRun = (employee: Employee, draft: Pick<PayRunDraft, "payFrequency" | "regularHours" | "overtimeHours" | "salaryOverrideAmount">) => {
  const periods = getPeriodsPerYear(draft.payFrequency);
  const salaryOverrideAmount = Math.max(0, draft.salaryOverrideAmount ?? 0);
  const hourlyRate =
    employee.employmentType === "hourly"
      ? employee.hourlyRate ?? 0
      : (employee.annualSalary ?? 0) / employee.defaultHoursPerPeriod / periods;

  const grossRegular = employee.employmentType === "salary"
    ? (salaryOverrideAmount > 0 ? salaryOverrideAmount : (employee.annualSalary ?? 0) / periods)
    : hourlyRate * draft.regularHours;
  const grossOvertime = hourlyRate * 1.5 * draft.overtimeHours;

  return {
    grossRegular,
    grossOvertime,
  };
};

export const inferVacationHandling = (draft: Pick<PayRunDraft, "accrueVacation" | "vacationPayoutAmount"> & Partial<Pick<PayRunDraft, "vacationHandling">>): VacationHandling => {
  if (draft.vacationHandling) {
    return draft.vacationHandling;
  }

  if (draft.accrueVacation) {
    return "accrue";
  }

  return draft.vacationPayoutAmount > 0 ? "custom" : "pay";
};

export const estimateVacationPayoutForRun = (
  employee: Employee,
  draft: Pick<PayRunDraft, "payFrequency" | "regularHours" | "overtimeHours" | "salaryOverrideAmount">,
) => {
  const { grossRegular, grossOvertime } = getBasePayForRun(employee, draft);
  return roundMoney((grossRegular + grossOvertime) * employee.vacationRate);
};

const getBracketTax = (taxableIncome: number, brackets: TaxBracket[]) => {
  const bracket = brackets.find((candidate) => taxableIncome <= candidate.upper) ?? brackets[brackets.length - 1];
  return taxableIncome * bracket.rate - bracket.constant;
};

const calculateOntarioHealthPremium = (annualIncome: number, taxYear: number) => {
  const table = getTaxTable(taxYear);
  const threshold = table.ontarioHealthPremium.find((item) => annualIncome <= item.maxIncome) ?? table.ontarioHealthPremium[table.ontarioHealthPremium.length - 1];

  if (threshold.rate === 0) {
    return threshold.maxPremium;
  }

  const previousLimit = table.ontarioHealthPremium
    .slice(0, table.ontarioHealthPremium.indexOf(threshold))
    .reduce((max, item) => Math.max(max, item.maxIncome), 0);

  return Math.min(threshold.maxPremium, threshold.baseTax + (annualIncome - previousLimit) * threshold.rate);
};

const calculateOntarioSurtax = (basicProvincialTax: number, taxYear: number) => {
  const { ontarioSurtax } = getTaxTable(taxYear);
  if (basicProvincialTax <= ontarioSurtax.firstThreshold) {
    return 0;
  }
  if (basicProvincialTax <= ontarioSurtax.secondThreshold) {
    return (basicProvincialTax - ontarioSurtax.firstThreshold) * ontarioSurtax.firstRate;
  }
  return (
    (basicProvincialTax - ontarioSurtax.firstThreshold) * ontarioSurtax.firstRate +
    (basicProvincialTax - ontarioSurtax.secondThreshold) * ontarioSurtax.secondRate
  );
};

const calculateOntarioTaxReduction = (ontarioTaxBeforeReduction: number, taxYear: number) => {
  const reductionThreshold = getTaxTable(taxYear).ontarioTaxReductionBase * 2;
  return Math.max(0, Math.min(ontarioTaxBeforeReduction, reductionThreshold - ontarioTaxBeforeReduction));
};

const calculateAnnualIncomeTax = (
  annualTaxableIncome: number,
  annualBaseCppContribution: number,
  annualEiPremium: number,
  employee: Employee,
  taxYear: number,
) => {
  const taxTable = getTaxTable(taxYear);
  const rateTable = taxTable.rates;
  const lowestFederalRate = taxTable.federalBrackets[0]?.rate ?? 0;
  const lowestProvincialRate = taxTable.ontarioBrackets[0]?.rate ?? 0;
  const baseFederalTax = Math.max(0, getBracketTax(annualTaxableIncome, taxTable.federalBrackets));
  const federalCppEiCredits = (Math.min(annualBaseCppContribution, rateTable.cppBaseMax) + Math.min(annualEiPremium, rateTable.eiMax)) * lowestFederalRate;
  const federalCredits =
    (Math.max(employee.federalClaimAmount, 0) + rateTable.federalCanadaEmploymentCredit) * rateTable.federalCreditRate
    + federalCppEiCredits;
  const federalTaxAnnual = Math.max(0, baseFederalTax - federalCredits);

  const basicProvincialTax = Math.max(0, getBracketTax(annualTaxableIncome, taxTable.ontarioBrackets));
  const provincialCppEiCredits = (Math.min(annualBaseCppContribution, rateTable.cppBaseMax) + Math.min(annualEiPremium, rateTable.eiMax)) * lowestProvincialRate;
  const provincialCredits = Math.max(employee.provincialClaimAmount, 0) * rateTable.provincialCreditRate + provincialCppEiCredits;
  const provincialTaxAfterCredits = Math.max(0, basicProvincialTax - provincialCredits);
  const surtax = calculateOntarioSurtax(provincialTaxAfterCredits, taxYear);
  const ontarioTaxBeforeReduction = provincialTaxAfterCredits + surtax;
  const taxReduction = calculateOntarioTaxReduction(ontarioTaxBeforeReduction, taxYear);
  const healthPremium = calculateOntarioHealthPremium(annualTaxableIncome, taxYear);
  const provincialTaxAnnual = Math.max(
    0,
    ontarioTaxBeforeReduction - taxReduction + healthPremium,
  );

  return { federalTaxAnnual, provincialTaxAnnual };
};

const calculateAnnualGross = (employee: Employee, draft: PayRunDraft) => {
  const periods = getPeriodsPerYear(draft.payFrequency);
  const { grossRegular: regular, grossOvertime: overtime } = getBasePayForRun(employee, draft);
  const vacationHandling = inferVacationHandling(draft);
  const vacationPaid = vacationHandling === "accrue"
    ? 0
    : vacationHandling === "pay"
      ? estimateVacationPayoutForRun(employee, draft)
      : Math.max(0, draft.vacationPayoutAmount);
  const gross = regular + overtime + draft.bonusAmount + draft.taxableBenefits + vacationPaid;

  return {
    annualizedGross: gross * periods,
    grossRegular: regular,
    grossOvertime: overtime,
    vacationPaid,
    grossPerPeriod: gross,
  };
};

export const formatCurrency = (value: number) => currency.format(value);

export const calculatePayroll = (
  employee: Employee,
  draft: PayRunDraft,
  priorYtd: PayStubTotals = createZeroTotals(),
  taxYear = getTaxYearFromDraft(draft),
): PayrollBreakdown => {
  const taxTable = getTaxTable(taxYear);
  const rateTable = taxTable.rates;
  const periods = getPeriodsPerYear(draft.payFrequency);
  const { annualizedGross, grossRegular, grossOvertime, grossPerPeriod, vacationPaid } = calculateAnnualGross(employee, draft);
  const periodicIncome = grossRegular + grossOvertime + draft.taxableBenefits + vacationPaid;
  const nonPeriodicIncome = draft.bonusAmount;
  const rrspRppPrppContribution = roundMoney(employee.rrspRppPrppContributionPerPeriod ?? 0);
  const unionDues = roundMoney(employee.unionDuesPerPeriod ?? 0);
  const annualRegisteredPlanContributions = rrspRppPrppContribution * periods;
  const annualUnionDues = unionDues * periods;
  const cppExempt = employee.cppStatus !== "standard";
  const eiExempt = employee.eiStatus !== "standard";
  const pensionableAnnual = Math.max(0, annualizedGross - rateTable.cppBasicExemption);
  const cppAnnual = cppExempt ? 0 : Math.min(pensionableAnnual * rateTable.cppCombined, rateTable.cppMaxCombined);
  const cpp2Annual = cppExempt
    ? 0
    : Math.min(
        Math.max(0, Math.min(annualizedGross, rateTable.yampe) - rateTable.ympe) * rateTable.cpp2,
        rateTable.cpp2Max,
      );
  const eiAnnual = eiExempt ? 0 : Math.min(annualizedGross * rateTable.eiEmployee, rateTable.eiMax);
  const basicExemptionPerPeriod = rateTable.cppBasicExemption / periods;
  const cppMaxRemaining = Math.max(0, rateTable.cppMaxCombined - priorYtd.cpp);
  const cpp2MaxRemaining = Math.max(0, rateTable.cpp2Max - priorYtd.cpp2);
  const eiMaxRemaining = Math.max(0, rateTable.eiMax - priorYtd.ei);
  const eiEmployerMaxRemaining = Math.max(0, rateTable.eiEmployerMax - priorYtd.employerEi);
  const periodPensionable = Math.max(0, grossPerPeriod);
  const contributoryEarnings = Math.max(0, periodPensionable - basicExemptionPerPeriod);
  const cpp = cppExempt ? 0 : roundMoney(Math.min(contributoryEarnings * rateTable.cppCombined, cppMaxRemaining));
  const grossBeforeCurrent = Math.max(0, priorYtd.grossPay);
  const cpp2BandThisPeriod = Math.max(
    0,
    Math.min(grossBeforeCurrent + periodPensionable, rateTable.yampe) - Math.max(grossBeforeCurrent, rateTable.ympe),
  );
  const cpp2 = cppExempt ? 0 : roundMoney(Math.min(cpp2BandThisPeriod * rateTable.cpp2, cpp2MaxRemaining));
  const ei = eiExempt ? 0 : roundMoney(Math.min(periodPensionable * rateTable.eiEmployee, eiMaxRemaining));
  const additionalCppDeduction = cppExempt ? 0 : roundMoney(cpp * ((rateTable.cppCombined - rateTable.cppBase) / rateTable.cppCombined) + cpp2);
  const periodIncomeTotal = periodicIncome + nonPeriodicIncome;
  const periodicShare = periodIncomeTotal > 0 ? periodicIncome / periodIncomeTotal : 1;
  const nonPeriodicShare = periodIncomeTotal > 0 ? nonPeriodicIncome / periodIncomeTotal : 0;
  const f5a = roundMoney(additionalCppDeduction * periodicShare);
  const f5b = roundMoney(additionalCppDeduction * nonPeriodicShare);
  const annualBaseCppContribution = cppExempt
    ? 0
    : Math.min(cppAnnual * (rateTable.cppBase / rateTable.cppCombined), rateTable.cppBaseMax);
  const annualPeriodicTaxableIncome = Math.max(
    0,
    (periodicIncome - rrspRppPrppContribution - unionDues - f5a) * periods
      - (employee.prescribedZoneDeductionAnnual ?? 0)
      - (employee.otherAnnualDeductionsAnnual ?? 0),
  );
  const annualTaxableIncome = Math.max(
    0,
    annualPeriodicTaxableIncome + priorYtd.bonusAmount + priorYtd.vacationPaid + nonPeriodicIncome - f5b,
  );
  const annualTaxWithoutCurrentNonPeriodic = calculateAnnualIncomeTax(
    Math.max(0, annualPeriodicTaxableIncome + priorYtd.bonusAmount + priorYtd.vacationPaid),
    annualBaseCppContribution,
    eiAnnual,
    employee,
    taxYear,
  );
  const annualTaxWithCurrentNonPeriodic = calculateAnnualIncomeTax(
    annualTaxableIncome,
    annualBaseCppContribution,
    eiAnnual,
    employee,
    taxYear,
  );
  const federalTax = roundMoney(
    annualTaxWithoutCurrentNonPeriodic.federalTaxAnnual / periods
      + Math.max(0, annualTaxWithCurrentNonPeriodic.federalTaxAnnual - annualTaxWithoutCurrentNonPeriodic.federalTaxAnnual),
  );
  const provincialTax = roundMoney(
    annualTaxWithoutCurrentNonPeriodic.provincialTaxAnnual / periods
      + Math.max(0, annualTaxWithCurrentNonPeriodic.provincialTaxAnnual - annualTaxWithoutCurrentNonPeriodic.provincialTaxAnnual),
  );
  const vacationAccrual = draft.accrueVacation ? (grossPerPeriod - vacationPaid) * employee.vacationRate : 0;
  const totalDeductions = roundMoney(
    rrspRppPrppContribution + unionDues + cpp + cpp2 + ei + federalTax + provincialTax,
  );
  const netPay = roundMoney(grossPerPeriod - totalDeductions);
  const employerCpp = cppExempt ? 0 : cpp;
  const employerCpp2 = cppExempt ? 0 : cpp2;
  const employerEi = eiExempt
    ? 0
    : roundMoney(Math.min(periodPensionable * rateTable.eiEmployer, eiEmployerMaxRemaining));
  const employerCost = roundMoney(grossPerPeriod + vacationAccrual + employerCpp + employerCpp2 + employerEi);

  const notes = [
    `Annualized taxable income estimate: ${formatCurrency(annualTaxableIncome)}`,
    `Tax-only annual adjustments applied: ${formatCurrency((employee.prescribedZoneDeductionAnnual ?? 0) + (employee.otherAnnualDeductionsAnnual ?? 0))}`,
    `Ontario tax includes health premium and surtax estimates using ${taxTable.summary.label}.`,
    "Validate every live payroll against CRA PDOC before filing or remitting.",
  ];

  if (employee.employmentType === "salary" && (draft.salaryOverrideAmount ?? 0) > 0) {
    notes.unshift(`Salary override applied for this run: ${formatCurrency(draft.salaryOverrideAmount)}`);
  }

  if (cppExempt) {
    notes.unshift(`CPP excluded due to employee CPP status: ${employee.cppStatus}`);
  }

  if (eiExempt) {
    notes.unshift(`EI excluded due to employee EI status: ${employee.eiStatus}`);
  }

  if (employee.eiStatus === "owner-related-pending-ruling") {
    notes.unshift("EI status may require a CRA ruling for related-party or owner employment.");
  }

  if (employee.workerClassification === "self-employed-contractor") {
    notes.unshift("Self-employed or contractor classifications should not usually run through employee payroll deductions.");
  }

  return {
    grossRegular: roundMoney(grossRegular),
    grossOvertime: roundMoney(grossOvertime),
    vacationAccrual: roundMoney(vacationAccrual),
    vacationPaid: roundMoney(vacationPaid),
    grossPay: roundMoney(grossPerPeriod),
    rrspRppPrppContribution,
    unionDues,
    cpp,
    cpp2,
    ei,
    federalTax,
    provincialTax,
    totalDeductions,
    netPay,
    employerCpp,
    employerCpp2,
    employerEi,
    employerCost,
    notes,
  };
};

export const getFrequencyLabel = (frequency: PayFrequency) => {
  switch (frequency) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Biweekly";
    case "semi-monthly":
      return "Semi-monthly";
    case "monthly":
      return "Monthly";
  }
};
