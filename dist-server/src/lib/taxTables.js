const TAX_TABLES = {
    2026: {
        summary: {
            taxYear: 2026,
            label: "2026 CRA + Ontario payroll tables",
            sourceUpdatedAt: "2026-02-23",
            sourceSummary: "CRA PDOC updated February 23, 2026; Ontario tax dataset updated December 12, 2025.",
        },
        rates: {
            cppBase: 0.0495,
            cppCombined: 0.0595,
            cpp2: 0.04,
            cppBasicExemption: 3500,
            cppBaseMax: 3519.45,
            cppMaxCombined: 4230.45,
            cpp2Max: 416,
            ympe: 74600,
            yampe: 85000,
            eiEmployee: 0.0163,
            eiEmployer: 0.02282,
            eiMax: 1123.07,
            eiMaxInsurableEarnings: 68900,
            eiEmployerMax: 1572.3,
            federalCanadaEmploymentCredit: 1501,
            federalCreditRate: 0.14,
            provincialCreditRate: 0.0505,
        },
        federalBrackets: [
            { upper: 58523, rate: 0.14, constant: 0 },
            { upper: 117045, rate: 0.205, constant: 3804 },
            { upper: 181440, rate: 0.26, constant: 10241 },
            { upper: 258482, rate: 0.29, constant: 15685 },
            { upper: Number.POSITIVE_INFINITY, rate: 0.33, constant: 26024 },
        ],
        ontarioBrackets: [
            { upper: 53891, rate: 0.0505, constant: 0 },
            { upper: 107785, rate: 0.0915, constant: 2210 },
            { upper: 150000, rate: 0.1116, constant: 4376 },
            { upper: 220000, rate: 0.1216, constant: 5876 },
            { upper: Number.POSITIVE_INFINITY, rate: 0.1316, constant: 8076 },
        ],
        ontarioHealthPremium: [
            { maxIncome: 20000, baseTax: 0, rate: 0, maxPremium: 0 },
            { maxIncome: 36000, baseTax: 0, rate: 0.06, maxPremium: 300 },
            { maxIncome: 48000, baseTax: 300, rate: 0.06, maxPremium: 450 },
            { maxIncome: 72000, baseTax: 450, rate: 0.25, maxPremium: 600 },
            { maxIncome: 200000, baseTax: 600, rate: 0.25, maxPremium: 750 },
            { maxIncome: Number.POSITIVE_INFINITY, baseTax: 750, rate: 0.25, maxPremium: 900 },
        ],
        ontarioSurtax: {
            firstThreshold: 5818,
            secondThreshold: 7446,
            firstRate: 0.2,
            secondRate: 0.36,
        },
        ontarioTaxReductionBase: 294,
    },
};
export const getDefaultTaxYear = () => Math.max(...Object.keys(TAX_TABLES).map((year) => Number(year)));
export const getTaxYearFromDraft = (draft) => {
    const dateValue = draft.payPeriodEnd || draft.payPeriodStart;
    if (!dateValue) {
        return getDefaultTaxYear();
    }
    const year = new Date(dateValue).getFullYear();
    return Number.isFinite(year) && TAX_TABLES[year] ? year : getDefaultTaxYear();
};
export const getTaxTable = (year = getDefaultTaxYear()) => TAX_TABLES[year] ?? TAX_TABLES[getDefaultTaxYear()];
export const getTaxTableSummary = (year = getDefaultTaxYear()) => getTaxTable(year).summary;
export const getSupportedTaxYears = () => Object.keys(TAX_TABLES)
    .map((year) => Number(year))
    .sort((left, right) => right - left);
