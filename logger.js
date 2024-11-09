const fs = require('fs').promises;
const path = require('path');

const RETENTION_DAYS = 30; // Number of days to keep logs
const logsFolderName = './logs';

class Logger {
  constructor(logFileName) {
    // Create logs directory if it doesn't exist
    fs.mkdir(path.join(logsFolderName), { recursive: true })
      .catch(err => console.error('Error creating logs directory:', err));
    this.logDir = path.join(logsFolderName, logFileName); // Ensure logs are stored in a "logs" subdirectory
  }

  getLogFilePath(type) {
    const date = new Date().toISOString().split('T')[0]; // Format as YYYY-MM-DD
    return path.join(this.logDir, `${type}-log-${date}.txt`);
  }

  async logAccess(entry) {
    try {
      const accessLogPath = this.getLogFilePath('access');
      await fs.appendFile(accessLogPath, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error('Error writing to access log:', err);
    }
  }

  async logServer(message) {
    const logEntry = `${new Date().toISOString()} - ${message}\n`;
    try {
      const serverLogPath = this.getLogFilePath('server');
      await fs.appendFile(serverLogPath, logEntry);
    } catch (err) {
      console.error('Error writing to server log:', err);
    }
  }

  createAccessEntry(req) {
    return {
      timestamp: new Date().toISOString(),
      method: req.method,
      url: req.url,
      ip: req.socket.remoteAddress,
      userAgent: req.headers['user-agent'],
      referrer: req.headers.referer || 'direct',
      status: 'pending',
      result: null
    };
  }

  async cleanOldLogs() {
    try {
      const files = await fs.readdir(this.logDir);
      const now = new Date();
      for (const file of files) {
        const match = file.match(/-(\d{4}-\d{2}-\d{2})\.txt$/);
        if (match) {
          const fileDate = new Date(match[1]);
          const ageInDays = (now - fileDate) / (1000 * 60 * 60 * 24);
          if (ageInDays > RETENTION_DAYS) {
            await fs.unlink(path.join(this.logDir, file));
            console.log(`Deleted old log file: ${file}`);
          }
        }
      }
    } catch (err) {
      console.error('Error cleaning old logs:', err);
    }
  }
}

module.exports = Logger;
