import { useEffect, useMemo, useState } from "react";
import { complianceTasks, sampleClients, sampleDraft, sampleEmployees } from "./data/sampleData";
import { calculatePayroll, formatCurrency, getFrequencyLabel } from "./lib/payroll";
import type { Employee, PayFrequency, PayRunDraft } from "./types";

const STORAGE_KEY = "ontario-payroll-v1-state";

type PersistedState = {
  employees: Employee[];
  draft: PayRunDraft;
};

const defaultState: PersistedState = {
  employees: sampleEmployees,
  draft: sampleDraft,
};

const payFrequencyOptions: PayFrequency[] = ["weekly", "biweekly", "semi-monthly", "monthly"];

const emptyEmployee: Omit<Employee, "id" | "provinceOfEmployment" | "active"> = {
  clientId: sampleClients[0]?.id ?? "client-001",
  firstName: "",
  lastName: "",
  fullName: "",
  role: "",
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

const loadState = (): PersistedState => {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return defaultState;
  }

  try {
    return JSON.parse(raw) as PersistedState;
  } catch {
    return defaultState;
  }
};

function App() {
  const [{ employees, draft }, setState] = useState<PersistedState>(loadState);
  const [newEmployee, setNewEmployee] = useState(emptyEmployee);

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ employees, draft }));
  }, [employees, draft]);

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.active), [employees]);
  const selectedEmployee = activeEmployees.find((employee) => employee.id === draft.employeeId) ?? activeEmployees[0];

  const payroll = useMemo(() => {
    if (!selectedEmployee) {
      return null;
    }
    return calculatePayroll(selectedEmployee, draft);
  }, [draft, selectedEmployee]);

  const totalMonthlyBase = useMemo(() => {
    return activeEmployees.reduce((sum, employee) => {
      if (employee.employmentType === "salary") {
        return sum + (employee.annualSalary ?? 0) / 12;
      }
      return sum + (((employee.hourlyRate ?? 0) * employee.defaultHoursPerPeriod) * 26) / 12;
    }, 0);
  }, [activeEmployees]);

  const handleDraftChange = <K extends keyof PayRunDraft>(key: K, value: PayRunDraft[K]) => {
    setState((current) => ({
      ...current,
      draft: {
        ...current.draft,
        [key]: value,
      },
    }));
  };

  const handleEmployeeInput = <K extends keyof typeof emptyEmployee>(key: K, value: (typeof emptyEmployee)[K]) => {
    setNewEmployee((current) => ({
      ...current,
      [key]: value,
    }));
  };

  const addEmployee = () => {
    if (!newEmployee.fullName.trim() || !newEmployee.role.trim()) {
      return;
    }

    const [firstName, ...lastParts] = newEmployee.fullName.trim().split(" ");
    const lastName = lastParts.join(" ");

    const employee: Employee = {
      id: `emp-${crypto.randomUUID()}`,
      provinceOfEmployment: "ON",
      active: true,
      ...newEmployee,
      firstName,
      lastName,
    };

    setState((current) => ({
      employees: [...current.employees, employee],
      draft: {
        ...current.draft,
        employeeId: employee.id,
      },
    }));

    setNewEmployee(emptyEmployee);
  };

  return (
    <div className="app-shell">
      <div className="backdrop backdrop-left" />
      <div className="backdrop backdrop-right" />

      <header className="hero">
        <div className="hero-copy">
          <span className="eyebrow">Ontario payroll V1</span>
          <h1>Build your payroll operation before you automate filings.</h1>
          <p>
            This first version gives you a polished payroll command center for employees, pay runs,
            employer costs, and compliance checkpoints using 2026 Ontario assumptions.
          </p>
        </div>

        <div className="hero-metrics">
          <div className="metric-card accent-sun">
            <span>Active employees</span>
            <strong>{activeEmployees.length}</strong>
            <small>Ontario only</small>
          </div>
          <div className="metric-card accent-ice">
            <span>Base monthly payroll</span>
            <strong>{formatCurrency(totalMonthlyBase)}</strong>
            <small>before deductions</small>
          </div>
          <div className="metric-card accent-clay">
            <span>Live pay frequency</span>
            <strong>{getFrequencyLabel(draft.payFrequency)}</strong>
            <small>current draft</small>
          </div>
        </div>
      </header>

      <main className="dashboard-grid">
        <section className="panel payroll-panel">
          <div className="panel-heading">
            <div>
              <span className="section-tag">Pay run studio</span>
              <h2>Draft a payroll run</h2>
            </div>
            <p>Use this as your operating screen before we wire in approvals, exports, and year-end slips.</p>
          </div>

          <div className="form-grid">
            <label>
              Employee
              <select
                value={draft.employeeId}
                onChange={(event) => handleDraftChange("employeeId", event.target.value)}
              >
                {activeEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.fullName} - {employee.role}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Pay frequency
              <select
                value={draft.payFrequency}
                onChange={(event) => handleDraftChange("payFrequency", event.target.value as PayFrequency)}
              >
                {payFrequencyOptions.map((frequency) => (
                  <option key={frequency} value={frequency}>
                    {getFrequencyLabel(frequency)}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Regular hours
              <input
                type="number"
                min="0"
                value={draft.regularHours}
                onChange={(event) => handleDraftChange("regularHours", Number(event.target.value))}
              />
            </label>

            <label>
              Overtime hours
              <input
                type="number"
                min="0"
                value={draft.overtimeHours}
                onChange={(event) => handleDraftChange("overtimeHours", Number(event.target.value))}
              />
            </label>

            <label>
              Bonus
              <input
                type="number"
                min="0"
                value={draft.bonusAmount}
                onChange={(event) => handleDraftChange("bonusAmount", Number(event.target.value))}
              />
            </label>

            <label>
              Taxable benefits
              <input
                type="number"
                min="0"
                value={draft.taxableBenefits}
                onChange={(event) => handleDraftChange("taxableBenefits", Number(event.target.value))}
              />
            </label>
          </div>

          {selectedEmployee && payroll ? (
            <div className="breakdown-grid">
              <article className="statement-card warm">
                <span>Employee</span>
                <strong>{selectedEmployee.fullName}</strong>
                <small>
                  {selectedEmployee.role} · {selectedEmployee.employmentType === "salary" ? "Salary" : "Hourly"}
                </small>
              </article>

              <article className="statement-card">
                <span>Gross pay</span>
                <strong>{formatCurrency(payroll.grossPay)}</strong>
                <small>Regular + overtime + bonus + taxable benefits</small>
              </article>

              <article className="statement-card">
                <span>Net pay</span>
                <strong>{formatCurrency(payroll.netPay)}</strong>
                <small>Estimated take-home for this draft run</small>
              </article>

              <article className="statement-card">
                <span>Employer cost</span>
                <strong>{formatCurrency(payroll.employerCost)}</strong>
                <small>Gross pay + statutory costs + vacation accrual</small>
              </article>
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
                  <li><span>Gross pay</span><strong>{formatCurrency(payroll.grossPay)}</strong></li>
                </ul>
              </div>

              <div className="detail-card">
                <h3>Employee deductions</h3>
                <ul>
                  <li><span>CPP</span><strong>{formatCurrency(payroll.cpp)}</strong></li>
                  <li><span>CPP2</span><strong>{formatCurrency(payroll.cpp2)}</strong></li>
                  <li><span>EI</span><strong>{formatCurrency(payroll.ei)}</strong></li>
                  <li><span>Federal tax</span><strong>{formatCurrency(payroll.federalTax)}</strong></li>
                  <li><span>Ontario tax</span><strong>{formatCurrency(payroll.provincialTax)}</strong></li>
                  <li><span>Total deductions</span><strong>{formatCurrency(payroll.totalDeductions)}</strong></li>
                </ul>
              </div>

              <div className="detail-card">
                <h3>Employer burden</h3>
                <ul>
                  <li><span>Employer CPP</span><strong>{formatCurrency(payroll.employerCpp)}</strong></li>
                  <li><span>Employer CPP2</span><strong>{formatCurrency(payroll.employerCpp2)}</strong></li>
                  <li><span>Employer EI</span><strong>{formatCurrency(payroll.employerEi)}</strong></li>
                  <li><span>Total employer cost</span><strong>{formatCurrency(payroll.employerCost)}</strong></li>
                </ul>
              </div>
            </div>
          ) : null}

          {payroll ? (
            <div className="notes-card">
              <h3>V1 guardrails</h3>
              <ul>
                {payroll.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="panel sidebar-panel">
          <div className="panel-heading compact">
            <div>
              <span className="section-tag">Team setup</span>
              <h2>Employees</h2>
            </div>
          </div>

          <div className="employee-list">
            {activeEmployees.map((employee) => (
              <article key={employee.id} className="employee-card">
                <div>
                  <strong>{employee.fullName}</strong>
                  <span>{employee.role}</span>
                </div>
                <small>
                  {employee.employmentType === "salary"
                    ? `${formatCurrency(employee.annualSalary ?? 0)} / year`
                    : `${formatCurrency(employee.hourlyRate ?? 0)} / hour`}
                </small>
              </article>
            ))}
          </div>

          <div className="mini-form">
            <h3>Add employee</h3>
            <div className="mini-form-grid">
              <label>
                Full name
                <input
                  value={newEmployee.fullName}
                  onChange={(event) => handleEmployeeInput("fullName", event.target.value)}
                />
              </label>
              <label>
                Role
                <input
                  value={newEmployee.role}
                  onChange={(event) => handleEmployeeInput("role", event.target.value)}
                />
              </label>
              <label>
                Employment type
                <select
                  value={newEmployee.employmentType}
                  onChange={(event) =>
                    handleEmployeeInput("employmentType", event.target.value as Employee["employmentType"])
                  }
                >
                  <option value="hourly">Hourly</option>
                  <option value="salary">Salary</option>
                </select>
              </label>
              {newEmployee.employmentType === "hourly" ? (
                <label>
                  Hourly rate
                  <input
                    type="number"
                    min="0"
                    value={newEmployee.hourlyRate}
                    onChange={(event) => handleEmployeeInput("hourlyRate", Number(event.target.value))}
                  />
                </label>
              ) : (
                <label>
                  Annual salary
                  <input
                    type="number"
                    min="0"
                    value={newEmployee.annualSalary}
                    onChange={(event) => handleEmployeeInput("annualSalary", Number(event.target.value))}
                  />
                </label>
              )}
              <label>
                Default hours
                <input
                  type="number"
                  min="0"
                  value={newEmployee.defaultHoursPerPeriod}
                  onChange={(event) => handleEmployeeInput("defaultHoursPerPeriod", Number(event.target.value))}
                />
              </label>
              <label>
                Vacation rate
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={newEmployee.vacationRate}
                  onChange={(event) => handleEmployeeInput("vacationRate", Number(event.target.value))}
                />
              </label>
            </div>
            <button className="primary-button" type="button" onClick={addEmployee}>
              Add employee
            </button>
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
        </section>
      </main>
    </div>
  );
}

export default App;
