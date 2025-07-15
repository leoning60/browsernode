import fs from "fs";
import path from "path";
import winston, { Logger } from "winston";

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
	fs.mkdirSync(logsDir);
}

// Create filename with timestamp
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const logFilename = path.join(logsDir, `${timestamp}.log`);

const bnLogger: Logger = winston.createLogger({
	level: "debug",
	format: winston.format.combine(
		winston.format.label({ label: "browsernode/logging_config" }),
		winston.format.timestamp(),
		winston.format.errors({ stack: true }),
		winston.format.printf(({ level, message, timestamp, stack }) => {
			if (stack) {
				return `${timestamp} ${level}: ${message}\n${stack}`;
			}
			return `${timestamp} ${level}: ${message}`;
		}),
	),
	transports: [
		new winston.transports.Console(),
		new winston.transports.File({ filename: logFilename }),
	],
});

export default bnLogger;
