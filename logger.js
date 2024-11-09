// logger.js
const fs = require('fs').promises;

class Logger {
  constructor(accessLogPath, serverLogPath) {
    this.accessLogPath = accessLogPath;
    this.serverLogPath = serverLogPath;
  }

  async logAccess(entry) {
    try {
      await fs.appendFile(this.accessLogPath, JSON.stringify(entry) + '\n');
    } catch (err) {
      console.error('Error writing to access log:', err);
    }
  }

  async logServer(message) {
    const logEntry = `${new Date().toISOString()} - ${message}\n`;
    try {
      await fs.appendFile(this.serverLogPath, logEntry);
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
}

module.exports = Logger;