import { Router } from "express";
import { calculatePayroll } from "../../src/lib/payroll.js";
import { getTaxTableSummary, getTaxYearFromDraft } from "../../src/lib/taxTables.js";
import { addClient, addEmployee, deleteClient, deleteEmployee, getClients, getComplianceTasks, getCompanyProfile, getEmployees, getEmployeeYtdTotals, getPayRunById, recalculatePayRuns, getRecentPayRuns, deletePayRun, savePayRun, updatePayRun, updateClient, updateCompanyProfile, updateEmployee, } from "../db/database.js";
export const apiRouter = Router();
apiRouter.get("/bootstrap", (_request, response) => {
    response.json({
        companyProfile: getCompanyProfile(),
        clients: getClients(),
        employees: getEmployees(),
        complianceTasks: getComplianceTasks(),
        recentPayRuns: getRecentPayRuns(),
        taxTable: getTaxTableSummary(),
    });
});
apiRouter.put("/company-profile", (request, response) => {
    const incoming = request.body;
    response.json(updateCompanyProfile(incoming));
});
apiRouter.post("/clients", (request, response) => {
    const incoming = request.body;
    const client = {
        id: `client-${crypto.randomUUID()}`,
        active: true,
        ...incoming,
    };
    addClient(client);
    response.status(201).json(client);
});
apiRouter.put("/clients/:clientId", (request, response) => {
    const clientId = request.params.clientId;
    const currentClient = getClients().find((item) => item.id === clientId);
    if (!currentClient) {
        response.status(404).json({ message: "Client not found" });
        return;
    }
    const incoming = request.body;
    const client = {
        ...currentClient,
        ...incoming,
        id: currentClient.id,
        active: true,
    };
    response.json(updateClient(client));
});
apiRouter.delete("/clients/:clientId", (request, response) => {
    const clientId = request.params.clientId;
    const currentClient = getClients().find((item) => item.id === clientId);
    if (!currentClient) {
        response.status(404).json({ message: "Client not found" });
        return;
    }
    deleteClient(clientId);
    response.status(204).send();
});
apiRouter.post("/employees", (request, response) => {
    const incoming = request.body;
    const employee = {
        id: `emp-${crypto.randomUUID()}`,
        provinceOfEmployment: "ON",
        active: true,
        ...incoming,
    };
    addEmployee(employee);
    response.status(201).json(employee);
});
apiRouter.put("/employees/:employeeId", (request, response) => {
    const employeeId = request.params.employeeId;
    const currentEmployee = getEmployees().find((item) => item.id === employeeId);
    if (!currentEmployee) {
        response.status(404).json({ message: "Employee not found" });
        return;
    }
    const incoming = request.body;
    const employee = {
        ...currentEmployee,
        ...incoming,
        id: currentEmployee.id,
        provinceOfEmployment: "ON",
        active: true,
    };
    response.json(updateEmployee(employee));
});
apiRouter.delete("/employees/:employeeId", (request, response) => {
    const employeeId = request.params.employeeId;
    const currentEmployee = getEmployees().find((item) => item.id === employeeId);
    if (!currentEmployee) {
        response.status(404).json({ message: "Employee not found" });
        return;
    }
    deleteEmployee(employeeId);
    response.status(204).send();
});
apiRouter.post("/pay-runs/preview", (request, response) => {
    const { employeeId, draft, excludedPayRunId } = request.body;
    const employee = getEmployees().find((item) => item.id === employeeId);
    if (!employee) {
        response.status(404).json({ message: "Employee not found" });
        return;
    }
    const year = getTaxYearFromDraft(draft);
    const priorYtd = getEmployeeYtdTotals(employee.id, year, excludedPayRunId);
    const breakdown = calculatePayroll(employee, draft, priorYtd, year);
    response.json({
        breakdown,
        ytd: {
            regularHours: priorYtd.regularHours + draft.regularHours,
            overtimeHours: priorYtd.overtimeHours + draft.overtimeHours,
            bonusAmount: priorYtd.bonusAmount + draft.bonusAmount,
            taxableBenefits: priorYtd.taxableBenefits + draft.taxableBenefits,
            grossRegular: priorYtd.grossRegular + breakdown.grossRegular,
            grossOvertime: priorYtd.grossOvertime + breakdown.grossOvertime,
            vacationAccrual: priorYtd.vacationAccrual + breakdown.vacationAccrual,
            vacationPaid: priorYtd.vacationPaid + breakdown.vacationPaid,
            vacationBalance: priorYtd.vacationBalance + breakdown.vacationAccrual - breakdown.vacationPaid,
            grossPay: priorYtd.grossPay + breakdown.grossPay,
            rrspRppPrppContribution: priorYtd.rrspRppPrppContribution + breakdown.rrspRppPrppContribution,
            unionDues: priorYtd.unionDues + breakdown.unionDues,
            cpp: priorYtd.cpp + breakdown.cpp,
            cpp2: priorYtd.cpp2 + breakdown.cpp2,
            ei: priorYtd.ei + breakdown.ei,
            federalTax: priorYtd.federalTax + breakdown.federalTax,
            provincialTax: priorYtd.provincialTax + breakdown.provincialTax,
            totalDeductions: priorYtd.totalDeductions + breakdown.totalDeductions,
            netPay: priorYtd.netPay + breakdown.netPay,
            employerCpp: priorYtd.employerCpp + breakdown.employerCpp,
            employerCpp2: priorYtd.employerCpp2 + breakdown.employerCpp2,
            employerEi: priorYtd.employerEi + breakdown.employerEi,
            employerCost: priorYtd.employerCost + breakdown.employerCost,
        },
        taxTable: getTaxTableSummary(year),
    });
});
apiRouter.post("/pay-runs", (request, response) => {
    const draft = request.body;
    const employee = getEmployees().find((item) => item.id === draft.employeeId);
    if (!employee) {
        response.status(404).json({ message: "Employee not found" });
        return;
    }
    const client = getClients().find((item) => item.id === employee.clientId);
    const companyProfile = getCompanyProfile();
    const year = getTaxYearFromDraft(draft);
    const priorYtd = getEmployeeYtdTotals(employee.id, year);
    const breakdown = calculatePayroll(employee, draft, priorYtd, year);
    const payRun = {
        id: `run-${crypto.randomUUID()}`,
        employeeId: employee.id,
        clientId: employee.clientId,
        clientName: client?.name ?? "Client",
        employeeName: employee.fullName,
        role: employee.role,
        taxYear: year,
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
            taxTable: getTaxTableSummary(year),
            ytd: {
                regularHours: priorYtd.regularHours + draft.regularHours,
                overtimeHours: priorYtd.overtimeHours + draft.overtimeHours,
                bonusAmount: priorYtd.bonusAmount + draft.bonusAmount,
                taxableBenefits: priorYtd.taxableBenefits + draft.taxableBenefits,
                grossRegular: priorYtd.grossRegular + breakdown.grossRegular,
                grossOvertime: priorYtd.grossOvertime + breakdown.grossOvertime,
                vacationAccrual: priorYtd.vacationAccrual + breakdown.vacationAccrual,
                vacationPaid: priorYtd.vacationPaid + breakdown.vacationPaid,
                vacationBalance: priorYtd.vacationBalance + breakdown.vacationAccrual - breakdown.vacationPaid,
                grossPay: priorYtd.grossPay + breakdown.grossPay,
                rrspRppPrppContribution: priorYtd.rrspRppPrppContribution + breakdown.rrspRppPrppContribution,
                unionDues: priorYtd.unionDues + breakdown.unionDues,
                cpp: priorYtd.cpp + breakdown.cpp,
                cpp2: priorYtd.cpp2 + breakdown.cpp2,
                ei: priorYtd.ei + breakdown.ei,
                federalTax: priorYtd.federalTax + breakdown.federalTax,
                provincialTax: priorYtd.provincialTax + breakdown.provincialTax,
                totalDeductions: priorYtd.totalDeductions + breakdown.totalDeductions,
                netPay: priorYtd.netPay + breakdown.netPay,
                employerCpp: priorYtd.employerCpp + breakdown.employerCpp,
                employerCpp2: priorYtd.employerCpp2 + breakdown.employerCpp2,
                employerEi: priorYtd.employerEi + breakdown.employerEi,
                employerCost: priorYtd.employerCost + breakdown.employerCost,
            },
        },
    };
    savePayRun(payRun);
    response.status(201).json(payRun);
});
apiRouter.put("/pay-runs/:payRunId", (request, response) => {
    const payRunId = request.params.payRunId;
    const existingRun = getPayRunById(payRunId);
    if (!existingRun) {
        response.status(404).json({ message: "Pay run not found" });
        return;
    }
    const draft = request.body;
    const employee = getEmployees().find((item) => item.id === draft.employeeId);
    const client = getClients().find((item) => item.id === employee?.clientId);
    const companyProfile = getCompanyProfile();
    if (!employee) {
        response.status(404).json({ message: "Employee not found" });
        return;
    }
    const year = getTaxYearFromDraft(draft);
    const priorYtd = getEmployeeYtdTotals(employee.id, year, payRunId);
    const breakdown = calculatePayroll(employee, draft, priorYtd, year);
    const payRun = {
        id: payRunId,
        employeeId: employee.id,
        clientId: employee.clientId,
        clientName: client?.name ?? "Client",
        employeeName: employee.fullName,
        role: employee.role,
        taxYear: year,
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
        createdAt: existingRun.createdAt,
        payStub: {
            companyProfile,
            client,
            employee,
            draft,
            breakdown,
            taxTable: getTaxTableSummary(year),
            ytd: {
                regularHours: priorYtd.regularHours + draft.regularHours,
                overtimeHours: priorYtd.overtimeHours + draft.overtimeHours,
                bonusAmount: priorYtd.bonusAmount + draft.bonusAmount,
                taxableBenefits: priorYtd.taxableBenefits + draft.taxableBenefits,
                grossRegular: priorYtd.grossRegular + breakdown.grossRegular,
                grossOvertime: priorYtd.grossOvertime + breakdown.grossOvertime,
                vacationAccrual: priorYtd.vacationAccrual + breakdown.vacationAccrual,
                vacationPaid: priorYtd.vacationPaid + breakdown.vacationPaid,
                vacationBalance: priorYtd.vacationBalance + breakdown.vacationAccrual - breakdown.vacationPaid,
                grossPay: priorYtd.grossPay + breakdown.grossPay,
                rrspRppPrppContribution: priorYtd.rrspRppPrppContribution + breakdown.rrspRppPrppContribution,
                unionDues: priorYtd.unionDues + breakdown.unionDues,
                cpp: priorYtd.cpp + breakdown.cpp,
                cpp2: priorYtd.cpp2 + breakdown.cpp2,
                ei: priorYtd.ei + breakdown.ei,
                federalTax: priorYtd.federalTax + breakdown.federalTax,
                provincialTax: priorYtd.provincialTax + breakdown.provincialTax,
                totalDeductions: priorYtd.totalDeductions + breakdown.totalDeductions,
                netPay: priorYtd.netPay + breakdown.netPay,
                employerCpp: priorYtd.employerCpp + breakdown.employerCpp,
                employerCpp2: priorYtd.employerCpp2 + breakdown.employerCpp2,
                employerEi: priorYtd.employerEi + breakdown.employerEi,
                employerCost: priorYtd.employerCost + breakdown.employerCost,
            },
        },
    };
    response.json(updatePayRun(payRun));
});
apiRouter.delete("/pay-runs/:payRunId", (request, response) => {
    const payRunId = request.params.payRunId;
    const existingRun = getPayRunById(payRunId);
    if (!existingRun) {
        response.status(404).json({ message: "Pay run not found" });
        return;
    }
    deletePayRun(payRunId);
    response.status(204).send();
});
apiRouter.post("/pay-runs/recalculate", (_request, response) => {
    response.json({
        recentPayRuns: recalculatePayRuns(),
    });
});
