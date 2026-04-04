"use strict";
/**
 * excel-to-plan.ts
 * Converts an Excel or CSV test case file into a test-plan.json.
 *
 * Usage:
 *   npx tsx scripts/excel-to-plan.ts --file=requirements/TC_Template.xlsx
 *   npx tsx scripts/excel-to-plan.ts --file=requirements/my-tests.csv --out=test-plans/
 *
 * Output: test-plans/<filename>-plan.json
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const path = __importStar(require("path"));
const dotenv = __importStar(require("dotenv"));
const excelReader_1 = require("../src/utils/excelReader");
const planWriter_1 = require("../src/utils/planWriter");
const logger_1 = require("../src/utils/logger");
dotenv.config();
// ── Argument parsing ──────────────────────────────────────────────────────────
function getArg(name) {
    const arg = process.argv.find(a => a.startsWith(`--${name}=`));
    return arg ? arg.split('=').slice(1).join('=') : undefined;
}
const inputFile = getArg('file');
const outputDir = getArg('out') || './test-plans';
if (!inputFile) {
    console.error('❌ Error: --file argument is required');
    console.error('   Example: npx tsx scripts/excel-to-plan.ts --file=requirements/TC_Template.xlsx');
    process.exit(1);
}
const resolvedFile = path.resolve(inputFile);
// ── Run ───────────────────────────────────────────────────────────────────────
logger_1.logger.info('━━━ Excel → Test Plan Converter ━━━');
logger_1.logger.info(`Input : ${resolvedFile}`);
logger_1.logger.info(`Output: ${path.resolve(outputDir)}`);
try {
    // Step 1: Read Excel file
    const doc = (0, excelReader_1.readExcelFile)(resolvedFile);
    logger_1.logger.info(`Read  : ${doc.rawRows?.length ?? 0} test case rows`);
    if (!doc.rawRows || doc.rawRows.length === 0) {
        logger_1.logger.warn('No valid rows found. Check that the TC ID and Title columns are populated.');
        process.exit(1);
    }
    // Step 2: Print a preview table
    console.log('\nPreview of parsed test cases:');
    console.log('─'.repeat(70));
    console.log('TC ID'.padEnd(12) +
        'Priority'.padEnd(10) +
        'Steps'.padEnd(8) +
        'Title');
    console.log('─'.repeat(70));
    for (const row of doc.rawRows) {
        const stepCount = row.steps.filter(s => s.trim()).length;
        console.log(row.tcId.padEnd(12) +
            row.priority.padEnd(10) +
            String(stepCount).padEnd(8) +
            row.title.slice(0, 50));
    }
    console.log('─'.repeat(70));
    // Step 3: Build plan
    const plan = (0, planWriter_1.buildTestPlan)(doc);
    // Step 4: Write plan JSON
    const outputPath = (0, planWriter_1.writePlan)(plan, path.resolve(outputDir));
    console.log(`\n✅ Plan written to: ${outputPath}`);
    console.log(`   Plan ID : ${plan.planId}`);
    console.log(`   Tests   : ${plan.testCases.length}`);
    console.log(`\nNext step: open the plan in your AI IDE and say:`);
    console.log(`  "Run the test plan at test-plans/${path.basename(outputPath)}"`);
}
catch (err) {
    logger_1.logger.error(`Failed: ${err.message}`);
    process.exit(1);
}
//# sourceMappingURL=excel-to-plan.js.map