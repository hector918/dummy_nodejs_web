const fs = require('fs');
const path = require('path');

class FileHandler {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;

    // Ensure base directory exists on initialization
    this.createBaseDirectory();
  }

  createBaseDirectory() {
    if (!fs.existsSync(this.config.files.basePath)) {
      fs.mkdirSync(this.config.files.basePath, { recursive: true });
      console.log(`Base directory ${this.config.files.basePath} created.`);
    } else {
      console.log(`Base directory ${this.config.files.basePath} already exists.`);
    }
  }

  async handleRequest(req, res) {
    console.log(req.url)
    if (!req.url.startsWith('/files/')) {
      return false;
    }

    const logEntry = this.logger.createAccessEntry(req);
    const filePath = req.url.slice(7); // Remove '/files/' prefix

    try {
      await this.validateRequest(filePath);
      console.log(filePath)
      await this.streamFile(filePath, res, logEntry);
      logEntry.status = 'success';
      logEntry.result = 'File streamed successfully';
    } catch (error) {
      this.handleError(error, res, logEntry);
    } finally {
      // Ensure log entry records the reason for success or failure
      if (!logEntry.result) {
        logEntry.result = 'Request handled with unknown outcome';
      }
      this.logger.logAccess(logEntry);
    }

    return true;
  }

  async validateRequest(filePath) {
    
    if (filePath.includes('..') || !filePath.startsWith(this.config.files.basePath)) {
        console.log(this.config.files.basePath);

      throw new Error('ACCESS_DENIED');
    }

    const hasValidExtension = this.config.files.allowedExtensions
      .some(ext => filePath.toLowerCase().endsWith(ext));
    if (!hasValidExtension) {
      throw new Error('INVALID_FILE_TYPE');
    }

    try {
      await fs.promises.access(path.join(this.config.files.basePath, filePath), fs.constants.F_OK);
    } catch {
      throw new Error('FILE_NOT_FOUND');
    }
  }

  async streamFile(filePath, res, logEntry) {
    const fullPath = path.join(this.config.files.basePath, filePath);
    const fileStream = fs.createReadStream(fullPath);

    fileStream.on('error', (error) => {
      logEntry.result = 'READ_ERROR';
      throw new Error('READ_ERROR');
    });

    res.writeHead(200);
    fileStream.pipe(res);
  }

  handleError(error, res, logEntry) {
    const errorResponses = {
      'ACCESS_DENIED': { status: 403, message: 'Access denied' },
      'INVALID_FILE_TYPE': { status: 403, message: 'File type not allowed' },
      'FILE_NOT_FOUND': { status: 404, message: 'File not found' },
      'READ_ERROR': { status: 500, message: 'Error reading file' }
    };

    const response = errorResponses[error.message] || { status: 500, message: 'Internal server error' };

    res.writeHead(response.status);
    res.end(response.message);

    logEntry.status = 'error';
    logEntry.result = response.message;
  }
}

module.exports = FileHandler;
