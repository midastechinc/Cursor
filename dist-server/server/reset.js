import { initializeDatabase, resetDatabase } from "./db/database.js";
const main = async () => {
    await initializeDatabase();
    resetDatabase();
    console.log("Payroll database reset to seeded defaults.");
};
void main();
