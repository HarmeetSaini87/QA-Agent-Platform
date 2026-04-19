import winston from 'winston';
import * as dotenv from 'dotenv';

dotenv.config();

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack }) => {
  return stack
    ? `[${timestamp}] ${level}: ${message}\n${stack}`
    : `[${timestamp}] ${level}: ${message}`;
});

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    colorize(),
    logFormat
  ),
  transports: [
    new winston.transports.Console(),
  ],
});

// Convenience helpers for step-level logging
export const logStep = (stepNum: number, description: string) =>
  logger.info(`  ▶ Step ${stepNum}: ${description}`);

export const logStepPass = (stepNum: number, durationMs: number) =>
  logger.info(`  ✔ Step ${stepNum} PASSED (${durationMs}ms)`);

export const logStepFail = (stepNum: number, error: string) =>
  logger.error(`  ✘ Step ${stepNum} FAILED: ${error}`);

export const logHeal = (original: string, healed: string) =>
  logger.warn(`  ⚕ Healing selector: "${original}" → "${healed}"`);

export const logTestStart = (tcId: string, title: string) =>
  logger.info(`\n━━━ Running: [${tcId}] ${title} ━━━`);

export const logTestPass = (tcId: string) =>
  logger.info(`✅ PASS: ${tcId}`);

export const logTestFail = (tcId: string) =>
  logger.error(`❌ FAIL: ${tcId}`);
