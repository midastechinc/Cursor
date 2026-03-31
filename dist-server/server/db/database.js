import fs from "node:fs";
import path from "node:path";
import initSqlJs from "sql.js";
import { complianceTasks, sampleClients, sampleCompanyProfile, sampleDraft, sampleEmployees } from "../../src/data/sampleData.js";
import { calculatePayroll } from "../../src/lib/payroll.js";
import { getTaxTableSummary, getTaxYearFromDraft } from "../../src/lib/taxTables.js";
const dataDir = path.resolve(process.cwd(), "data");
const dbPath = path.join(dataDir, "payroll.sqlite");
fs.mkdirSync(dataDir, { recursive: true });
let db;
const companyProfileId = "company-profile";
const defaultClientId = sampleClients[0]?.id ?? "client-001";
const roundMoney = (value) => Math.round(value * 100) / 100;
const createZeroTotals = () => ({
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
const addTotals = (left, right) => ({
    regularHours: roundMoney(left.regularHours + right.regularHours),
    overtimeHours: roundMoney(left.overtimeHours + right.overtimeHours),
    bonusAmount: roundMoney(left.bonusAmount + right.bonusAmount),
    taxableBenefits: roundMoney(left.taxableBenefits + right.taxableBenefits),
    grossRegular: roundMoney(left.grossRegular + right.grossRegular),
    grossOvertime: roundMoney(left.grossOvertime + right.grossOvertime),
    vacationAccrual: roundMoney(left.vacationAccrual + right.vacationAccrual),
    vacationPaid: roundMoney(left.vacationPaid + right.vacationPaid),
    vacationBalance: roundMoney(left.vacationBalance + right.vacationAccrual - right.vacationPaid),
    grossPay: roundMoney(left.grossPay + right.grossPay),
    rrspRppPrppContribution: roundMoney(left.rrspRppPrppContribution + right.rrspRppPrppContribution),
    unionDues: roundMoney(left.unionDues + right.unionDues),
    cpp: roundMoney(left.cpp + right.cpp),
    cpp2: roundMoney(left.cpp2 + right.cpp2),
    ei: roundMoney(left.ei + right.ei),
    federalTax: roundMoney(left.federalTax + right.federalTax),
    provincialTax: roundMoney(left.provincialTax + right.provincialTax),
    totalDeductions: roundMoney(left.totalDeductions + right.totalDeductions),
    netPay: roundMoney(left.netPay + right.netPay),
    employerCpp: roundMoney(left.employerCpp + right.employerCpp),
    employerCpp2: roundMoney(left.employerCpp2 + right.employerCpp2),
    employerEi: roundMoney(left.employerEi + right.employerEi),
    employerCost: roundMoney(left.employerCost + right.employerCost),
});
const getRunYear = (run) => {
    if (run.taxYear) {
        return run.taxYear;
    }
    const dateValue = run.payPeriodEnd || run.payPeriodStart || run.createdAt;
    const year = new Date(dateValue).getFullYear();
    return Number.isFinite(year) ? year : getTaxYearFromDraft({ payPeriodStart: run.payPeriodStart, payPeriodEnd: run.payPeriodEnd });
};
const getRunTotals = (run) => {
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
            vacationBalance: roundMoney(run.payStub.breakdown.vacationAccrual - run.payStub.breakdown.vacationPaid),
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
        ...createZeroTotals(),
        regularHours: run.regularHours,
        overtimeHours: run.overtimeHours,
        bonusAmount: run.bonusAmount,
        taxableBenefits: run.taxableBenefits,
        grossPay: run.grossPay,
        totalDeductions: roundMoney(run.grossPay - run.netPay),
        netPay: run.netPay,
        employerCost: run.employerCost,
    };
};
const deserializePayRun = (payload) => JSON.parse(payload);
const serializeCompanyProfile = (profile) => JSON.stringify(profile);
const deserializeCompanyProfile = (payload) => ({
    ...sampleCompanyProfile,
    ...JSON.parse(payload),
    settings: {
        ...sampleCompanyProfile.settings,
        ...(JSON.parse(payload).settings ?? {}),
        payrollFormFields: {
            ...sampleCompanyProfile.settings.payrollFormFields,
            ...(JSON.parse(payload).settings?.payrollFormFields ?? {}),
        },
        employeeFormFields: {
            ...sampleCompanyProfile.settings.employeeFormFields,
            ...(JSON.parse(payload).settings?.employeeFormFields ?? {}),
        },
        clientFormFields: {
            ...sampleCompanyProfile.settings.clientFormFields,
            ...(JSON.parse(payload).settings?.clientFormFields ?? {}),
        },
    },
});
const serializeClient = (client) => JSON.stringify(client);
const deserializeClient = (payload) => {
    const parsed = JSON.parse(payload);
    return {
        ...sampleClients[0],
        ...parsed,
        active: parsed.active ?? true,
    };
};
const getAllPayRuns = () => {
    const companyProfile = getCompanyProfile();
    const clientsById = new Map(getClients().map((client) => [client.id, client]));
    const employeesById = new Map(getEmployees().map((employee) => [employee.id, employee]));
    return queryPayloadRows("SELECT payload FROM pay_runs ORDER BY json_extract(payload, '$.createdAt') ASC")
        .map((payload) => deserializePayRun(payload))
        .map((run) => {
        const employee = employeesById.get(run.employeeId);
        const client = clientsById.get(run.clientId ?? employee?.clientId ?? defaultClientId);
        if (run.payStub) {
            return {
                ...run,
                clientId: run.clientId ?? client?.id ?? employee?.clientId ?? defaultClientId,
                clientName: run.clientName ?? client?.name ?? "Client",
                payStub: {
                    ...run.payStub,
                    companyProfile: run.payStub.companyProfile ?? companyProfile,
                    client: run.payStub.client ?? client,
                },
            };
        }
        if (!employee) {
            return run;
        }
        const date = new Date(run.createdAt).toISOString().slice(0, 10);
        const draft = {
            employeeId: run.employeeId,
            payFrequency: run.payFrequency,
            payPeriodStart: date,
            payPeriodEnd: date,
            salaryOverrideAmount: 0,
            salaryOverrideReason: "",
            vacationHandling: "accrue",
            accrueVacation: true,
            vacationPayoutAmount: 0,
            regularHours: run.regularHours,
            overtimeHours: run.overtimeHours,
            bonusAmount: run.bonusAmount,
            taxableBenefits: run.taxableBenefits,
        };
        const taxYear = getTaxYearFromDraft(draft);
        const breakdown = calculatePayroll(employee, draft, createZeroTotals(), taxYear);
        return {
            ...run,
            clientId: client?.id ?? employee.clientId,
            clientName: client?.name ?? "Client",
            taxYear,
            payStub: {
                companyProfile,
                client,
                employee,
                draft,
                breakdown,
                taxTable: getTaxTableSummary(taxYear),
                ytd: createZeroTotals(),
            },
        };
    });
};
const withCalculatedYtd = (payRuns) => {
    const totalsByEmployeeYear = new Map();
    return payRuns.map((run) => {
        const key = `${run.employeeId}:${getRunYear(run)}`;
        const currentTotals = getRunTotals(run);
        const priorTotals = totalsByEmployeeYear.get(key) ?? createZeroTotals();
        const ytd = addTotals(priorTotals, currentTotals);
        totalsByEmployeeYear.set(key, ytd);
        return {
            ...run,
            payStub: run.payStub
                ? {
                    ...run.payStub,
                    ytd,
                }
                : undefined,
        };
    });
};
const serializeEmployee = (employee) => JSON.stringify(employee);
const deserializeEmployee = (payload) => {
    const employee = JSON.parse(payload);
    return {
        clientId: defaultClientId,
        employeeNumber: "",
        attachments: [],
        firstName: "",
        lastName: "",
        workerClassification: "employee",
        email: "",
        phone: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        province: "ON",
        postalCode: "",
        dateOfBirth: "",
        hireDate: "",
        rrspRppPrppContributionPerPeriod: 0,
        unionDuesPerPeriod: 0,
        prescribedZoneDeductionAnnual: 0,
        otherAnnualDeductionsAnnual: 0,
        cppStatus: "standard",
        eiStatus: "standard",
        ...employee,
        fullName: employee.fullName ?? [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim(),
    };
};
const persistDatabase = () => {
    if (!db) {
        return;
    }
    fs.writeFileSync(dbPath, Buffer.from(db.export()));
};
const queryPayloadRows = (sql) => {
    const result = db.exec(sql)[0];
    if (!result) {
        return [];
    }
    return result.values.map((row) => String(row[0]));
};
const queryCount = (tableName) => {
    const result = db.exec(`SELECT COUNT(*) FROM ${tableName}`)[0];
    return Number(result?.values?.[0]?.[0] ?? 0);
};
const seedPayRun = (employee, draft) => {
    const taxYear = getTaxYearFromDraft(draft);
    const companyProfile = getCompanyProfile();
    const client = getClients().find((item) => item.id === employee.clientId);
    const breakdown = calculatePayroll(employee, draft, createZeroTotals(), taxYear);
    const currentTotals = {
        regularHours: draft.regularHours,
        overtimeHours: draft.overtimeHours,
        bonusAmount: draft.bonusAmount,
        taxableBenefits: draft.taxableBenefits,
        grossRegular: breakdown.grossRegular,
        grossOvertime: breakdown.grossOvertime,
        vacationAccrual: breakdown.vacationAccrual,
        vacationPaid: breakdown.vacationPaid,
        vacationBalance: roundMoney(breakdown.vacationAccrual - breakdown.vacationPaid),
        grossPay: breakdown.grossPay,
        rrspRppPrppContribution: breakdown.rrspRppPrppContribution,
        unionDues: breakdown.unionDues,
        cpp: breakdown.cpp,
        cpp2: breakdown.cpp2,
        ei: breakdown.ei,
        federalTax: breakdown.federalTax,
        provincialTax: breakdown.provincialTax,
        totalDeductions: breakdown.totalDeductions,
        netPay: breakdown.netPay,
        employerCpp: breakdown.employerCpp,
        employerCpp2: breakdown.employerCpp2,
        employerEi: breakdown.employerEi,
        employerCost: breakdown.employerCost,
    };
    return {
        id: `run-${crypto.randomUUID()}`,
        employeeId: employee.id,
        clientId: employee.clientId,
        clientName: client?.name ?? "Client",
        employeeName: employee.fullName,
        role: employee.role,
        taxYear,
        payFrequency: draft.payFrequency,
        payPeriodStart: draft.payPeriodStart,
        payPeriodEnd: draft.payPeriodEnd,
        accrueVacation: draft.accrueVacation,
        vacationPayoutAmount: draft.vacationPayoutAmount,
        regularHours: draft.regularHours,
        overtimeHours: draft.overtimeHours,
        bonusAmount: draft.bonusAmount,
        taxableBenefits: draft.taxableBenefits,
        grossPay: breakdown.grossPay,
        netPay: breakdown.netPay,
        employerCost: breakdown.employerCost,
        createdAt: new Date().toISOString(),
        payStub: {
            companyProfile,
            client,
            employee,
            draft,
            breakdown,
            taxTable: getTaxTableSummary(taxYear),
            ytd: currentTotals,
        },
    };
};
const createTables = () => {
    db.run(`
  CREATE TABLE IF NOT EXISTS employees (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS compliance_tasks (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS company_profile (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clients (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pay_runs (
    id TEXT PRIMARY KEY,
    payload TEXT NOT NULL
  );
`);
};
const seedDefaults = () => {
    if (queryCount("employees") === 0) {
        const statement = db.prepare("INSERT INTO employees (id, payload) VALUES (?, ?)");
        for (const employee of sampleEmployees) {
            statement.run([employee.id, serializeEmployee(employee)]);
        }
        statement.free();
    }
    if (queryCount("compliance_tasks") === 0) {
        const statement = db.prepare("INSERT INTO compliance_tasks (id, payload) VALUES (?, ?)");
        for (const task of complianceTasks) {
            statement.run([task.id, JSON.stringify(task)]);
        }
        statement.free();
    }
    if (queryCount("company_profile") === 0) {
        const statement = db.prepare("INSERT INTO company_profile (id, payload) VALUES (?, ?)");
        statement.run([companyProfileId, serializeCompanyProfile(sampleCompanyProfile)]);
        statement.free();
    }
    if (queryCount("clients") === 0) {
        const statement = db.prepare("INSERT INTO clients (id, payload) VALUES (?, ?)");
        for (const client of sampleClients) {
            statement.run([client.id, serializeClient(client)]);
        }
        statement.free();
    }
    if (queryCount("pay_runs") === 0) {
        const employee = sampleEmployees.find((item) => item.id === sampleDraft.employeeId) ?? sampleEmployees[0];
        const run = seedPayRun(employee, sampleDraft);
        const statement = db.prepare("INSERT INTO pay_runs (id, payload) VALUES (?, ?)");
        statement.run([run.id, JSON.stringify(run)]);
        statement.free();
    }
    persistDatabase();
};
export const initializeDatabase = async () => {
    const SQL = await initSqlJs();
    const existingFile = fs.existsSync(dbPath) ? fs.readFileSync(dbPath) : undefined;
    db = existingFile ? new SQL.Database(existingFile) : new SQL.Database();
    createTables();
    seedDefaults();
};
export const resetDatabase = () => {
    db.run(`
    DELETE FROM pay_runs;
    DELETE FROM compliance_tasks;
    DELETE FROM clients;
    DELETE FROM company_profile;
    DELETE FROM employees;
  `);
    seedDefaults();
};
export const getCompanyProfile = () => {
    const payload = queryPayloadRows("SELECT payload FROM company_profile WHERE id = 'company-profile'")[0];
    return payload ? deserializeCompanyProfile(payload) : sampleCompanyProfile;
};
export const updateCompanyProfile = (companyProfile) => {
    const statement = db.prepare("UPDATE company_profile SET payload = ? WHERE id = ?");
    statement.run([serializeCompanyProfile(companyProfile), companyProfileId]);
    statement.free();
    persistDatabase();
    return companyProfile;
};
export const getClients = () => {
    return queryPayloadRows("SELECT payload FROM clients ORDER BY json_extract(payload, '$.name')")
        .map((payload) => deserializeClient(payload));
};
export const addClient = (client) => {
    const statement = db.prepare("INSERT INTO clients (id, payload) VALUES (?, ?)");
    statement.run([client.id, serializeClient(client)]);
    statement.free();
    persistDatabase();
    return client;
};
export const updateClient = (client) => {
    const statement = db.prepare("UPDATE clients SET payload = ? WHERE id = ?");
    statement.run([serializeClient(client), client.id]);
    statement.free();
    persistDatabase();
    return client;
};
export const deleteClient = (clientId) => {
    const clientStatement = db.prepare("DELETE FROM clients WHERE id = ?");
    clientStatement.run([clientId]);
    clientStatement.free();
    const employeeStatement = db.prepare("DELETE FROM employees WHERE json_extract(payload, '$.clientId') = ?");
    employeeStatement.run([clientId]);
    employeeStatement.free();
    const payRunStatement = db.prepare("DELETE FROM pay_runs WHERE json_extract(payload, '$.clientId') = ?");
    payRunStatement.run([clientId]);
    payRunStatement.free();
    persistDatabase();
};
export const getEmployees = () => {
    return queryPayloadRows("SELECT payload FROM employees ORDER BY json_extract(payload, '$.fullName')")
        .map((payload) => deserializeEmployee(payload));
};
export const addEmployee = (employee) => {
    const statement = db.prepare("INSERT INTO employees (id, payload) VALUES (?, ?)");
    statement.run([employee.id, serializeEmployee(employee)]);
    statement.free();
    persistDatabase();
    return employee;
};
export const updateEmployee = (employee) => {
    const statement = db.prepare("UPDATE employees SET payload = ? WHERE id = ?");
    statement.run([serializeEmployee(employee), employee.id]);
    statement.free();
    persistDatabase();
    return employee;
};
export const deleteEmployee = (employeeId) => {
    const employeeStatement = db.prepare("DELETE FROM employees WHERE id = ?");
    employeeStatement.run([employeeId]);
    employeeStatement.free();
    const payRunStatement = db.prepare("DELETE FROM pay_runs WHERE json_extract(payload, '$.employeeId') = ?");
    payRunStatement.run([employeeId]);
    payRunStatement.free();
    persistDatabase();
};
export const getComplianceTasks = () => {
    return queryPayloadRows("SELECT payload FROM compliance_tasks")
        .map((payload) => JSON.parse(payload));
};
export const getRecentPayRuns = () => {
    return withCalculatedYtd(getAllPayRuns())
        .slice(-8)
        .reverse();
};
export const getPayRunById = (payRunId) => {
    return withCalculatedYtd(getAllPayRuns())
        .find((item) => item.id === payRunId);
};
export const getEmployeeYtdTotals = (employeeId, year, excludedPayRunId) => {
    const payRuns = withCalculatedYtd(getAllPayRuns())
        .filter((item) => item.employeeId === employeeId && getRunYear(item) === year && item.id !== excludedPayRunId);
    const run = payRuns[payRuns.length - 1];
    return run?.payStub?.ytd ?? createZeroTotals();
};
export const savePayRun = (payRun) => {
    const statement = db.prepare("INSERT INTO pay_runs (id, payload) VALUES (?, ?)");
    statement.run([payRun.id, JSON.stringify(payRun)]);
    statement.free();
    persistDatabase();
    return payRun;
};
export const updatePayRun = (payRun) => {
    const statement = db.prepare("UPDATE pay_runs SET payload = ? WHERE id = ?");
    statement.run([JSON.stringify(payRun), payRun.id]);
    statement.free();
    persistDatabase();
    return payRun;
};
export const deletePayRun = (payRunId) => {
    const statement = db.prepare("DELETE FROM pay_runs WHERE id = ?");
    statement.run([payRunId]);
    statement.free();
    persistDatabase();
};
export const recalculatePayRuns = () => {
    const payRuns = getAllPayRuns();
    const companyProfile = getCompanyProfile();
    const clientsById = new Map(getClients().map((client) => [client.id, client]));
    const totalsByEmployeeYear = new Map();
    const updateStatement = db.prepare("UPDATE pay_runs SET payload = ? WHERE id = ?");
    for (const run of payRuns) {
        const employee = run.payStub?.employee ?? getEmployees().find((item) => item.id === run.employeeId);
        if (!employee) {
            continue;
        }
        const draft = run.payStub?.draft ?? {
            employeeId: run.employeeId,
            payFrequency: run.payFrequency,
            payPeriodStart: run.payPeriodStart,
            payPeriodEnd: run.payPeriodEnd,
            salaryOverrideAmount: 0,
            salaryOverrideReason: "",
            vacationHandling: run.accrueVacation ? "accrue" : (run.vacationPayoutAmount > 0 ? "custom" : "pay"),
            accrueVacation: run.accrueVacation,
            vacationPayoutAmount: run.vacationPayoutAmount,
            regularHours: run.regularHours,
            overtimeHours: run.overtimeHours,
            bonusAmount: run.bonusAmount,
            taxableBenefits: run.taxableBenefits,
        };
        const taxYear = getTaxYearFromDraft(draft);
        const key = `${run.employeeId}:${taxYear}`;
        const client = clientsById.get(run.clientId ?? employee.clientId ?? defaultClientId);
        const priorYtd = totalsByEmployeeYear.get(key) ?? createZeroTotals();
        const breakdown = calculatePayroll(employee, draft, priorYtd, taxYear);
        const currentTotals = {
            regularHours: draft.regularHours,
            overtimeHours: draft.overtimeHours,
            bonusAmount: draft.bonusAmount,
            taxableBenefits: draft.taxableBenefits,
            grossRegular: breakdown.grossRegular,
            grossOvertime: breakdown.grossOvertime,
            vacationAccrual: breakdown.vacationAccrual,
            vacationPaid: breakdown.vacationPaid,
            vacationBalance: roundMoney(breakdown.vacationAccrual - breakdown.vacationPaid),
            grossPay: breakdown.grossPay,
            rrspRppPrppContribution: breakdown.rrspRppPrppContribution,
            unionDues: breakdown.unionDues,
            cpp: breakdown.cpp,
            cpp2: breakdown.cpp2,
            ei: breakdown.ei,
            federalTax: breakdown.federalTax,
            provincialTax: breakdown.provincialTax,
            totalDeductions: breakdown.totalDeductions,
            netPay: breakdown.netPay,
            employerCpp: breakdown.employerCpp,
            employerCpp2: breakdown.employerCpp2,
            employerEi: breakdown.employerEi,
            employerCost: breakdown.employerCost,
        };
        const ytd = addTotals(priorYtd, currentTotals);
        totalsByEmployeeYear.set(key, ytd);
        const recalculatedRun = {
            ...run,
            employeeId: employee.id,
            clientId: client?.id ?? employee.clientId,
            clientName: client?.name ?? "Client",
            employeeName: employee.fullName,
            role: employee.role,
            taxYear,
            payFrequency: draft.payFrequency,
            payPeriodStart: draft.payPeriodStart,
            payPeriodEnd: draft.payPeriodEnd,
            accrueVacation: draft.accrueVacation,
            vacationPayoutAmount: draft.vacationPayoutAmount,
            regularHours: draft.regularHours,
            overtimeHours: draft.overtimeHours,
            bonusAmount: draft.bonusAmount,
            taxableBenefits: draft.taxableBenefits,
            grossPay: breakdown.grossPay,
            netPay: breakdown.netPay,
            employerCost: breakdown.employerCost,
            payStub: {
                companyProfile,
                client,
                employee,
                draft,
                breakdown,
                taxTable: getTaxTableSummary(taxYear),
                ytd,
            },
        };
        updateStatement.run([JSON.stringify(recalculatedRun), recalculatedRun.id]);
    }
    updateStatement.free();
    persistDatabase();
    return getRecentPayRuns();
};
