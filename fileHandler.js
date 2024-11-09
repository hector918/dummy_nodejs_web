const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class FileHandler {
  constructor(config, logger) {
    if (!config?.files?.basePath) {
      throw new Error('Invalid configuration: basePath is required');
    }
    
    this.config = this.validateConfig(config);
    this.logger = logger;
    this.createBaseDirectory();
    
    // 基础 MIME 类型映射
    this.mimeTypes = {
      '.html': 'text/html',
      '.htm': 'text/html',
      '.css': 'text/css',
      '.js': 'application/javascript',
      '.json': 'application/json',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.svg': 'image/svg+xml',
      '.pdf': 'application/pdf',
      '.txt': 'text/plain',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
      '.zip': 'application/zip'
    };
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return this.mimeTypes[ext] || 'application/octet-stream';
  }

  validateConfig(config) {
    const absoluteBasePath = path.resolve(config.files.basePath);
    console.log('Configured base path:', absoluteBasePath);
    
    return {
      files: {
        basePath: absoluteBasePath,
        allowedExtensions: new Set(
          (config.files.allowedExtensions || []).map(ext => ext.toLowerCase())
        ),
        maxFileSize: config.files.maxFileSize || 50 * 1024 * 1024,
        streamTimeout: config.files.streamTimeout || 30000,
      }
    };
  }

  createBaseDirectory() {
    try {
      if (!fs.existsSync(this.config.files.basePath)) {
        fs.mkdirSync(this.config.files.basePath, { 
          recursive: true,
          mode: 0o755
        });
        this.logger.info(`Base directory created: ${this.config.files.basePath}`);
      }
      
      fs.accessSync(this.config.files.basePath, fs.constants.R_OK);
      this.logger.info(`Base directory is readable: ${this.config.files.basePath}`);
    } catch (error) {
      this.logger.error('Base directory error:', error);
      throw new Error('INITIALIZATION_ERROR');
    }
  }

  async handleRequest(req, res) {
    if (!req.url?.startsWith('/files/')) {
      return false;
    }

    const requestId = crypto.randomUUID();
    const logEntry = this.logger.createAccessEntry(req, requestId);
    const rawFilePath = req.url.slice(7);
    const decodedPath = decodeURIComponent(rawFilePath).trim();
    
    this.logger.info({
      requestId,
      message: 'File request received',
      rawPath: rawFilePath,
      decodedPath: decodedPath
    });

    try {
      await this.validateRequest(decodedPath, req);
      await this.streamFile(decodedPath, req, res, logEntry);
      logEntry.status = 'success';
      logEntry.result = 'File streamed successfully';
    } catch (error) {
      this.handleError(error, res, logEntry);
    } finally {
      logEntry.duration = Date.now() - logEntry.timestamp;
      this.logger.logAccess(logEntry);
    }

    return true;
  }

  async validateRequest(filePath, req) {
    this.logger.debug({
      message: 'Starting path validation',
      originalPath: filePath,
      basePath: this.config.files.basePath
    });

    const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(this.config.files.basePath, normalizedPath);
    
    this.logger.debug({
      message: 'Path processing result',
      normalizedPath,
      fullPath,
      basePathCheck: fullPath.startsWith(this.config.files.basePath)
    });

    if (!fullPath.startsWith(this.config.files.basePath)) {
      this.logger.warn({
        message: 'Path validation failed - outside base directory',
        attemptedPath: fullPath,
        basePath: this.config.files.basePath
      });
      throw new Error('ACCESS_DENIED');
    }

    const extension = path.extname(filePath).toLowerCase();
    if (!this.config.files.allowedExtensions.has(extension)) {
      this.logger.warn({
        message: 'Invalid file extension',
        extension,
        allowedExtensions: Array.from(this.config.files.allowedExtensions)
      });
      throw new Error('INVALID_FILE_TYPE');
    }

    try {
      const stats = await fs.promises.stat(fullPath);
      
      if (!stats.isFile()) {
        this.logger.warn({
          message: 'Path is not a file',
          path: fullPath,
          fileType: stats.isDirectory() ? 'directory' : 'other'
        });
        throw new Error('NOT_A_FILE');
      }

      if (stats.size > this.config.files.maxFileSize) {
        this.logger.warn({
          message: 'File too large',
          size: stats.size,
          maxSize: this.config.files.maxFileSize
        });
        throw new Error('FILE_TOO_LARGE');
      }

      await fs.promises.access(fullPath, fs.constants.R_OK);
      
      req.fileStats = stats;
      req.fullPath = fullPath;
      
      this.logger.info({
        message: 'File validation successful',
        path: fullPath,
        size: stats.size,
        permissions: stats.mode
      });

    } catch (error) {
      if (error.code === 'ENOENT') {
        this.logger.warn({
          message: 'File not found',
          path: fullPath
        });
        throw new Error('FILE_NOT_FOUND');
      }
      if (error.code === 'EACCES') {
        this.logger.warn({
          message: 'Permission denied',
          path: fullPath,
          error: error.message
        });
        throw new Error('ACCESS_DENIED');
      }
      this.logger.error({
        message: 'Validation error',
        path: fullPath,
        error: error.message
      });
      throw new Error('VALIDATION_ERROR');
    }
  }

  async streamFile(filePath, req, res, logEntry) {
    const { fullPath, fileStats } = req;
    
    // 使用内置的 MIME 类型映射
    const mimeType = this.getMimeType(fullPath);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', fileStats.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.setHeader('Last-Modified', fileStats.mtime.toUTCString());

    // 处理范围请求
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileStats.size - 1;

      if (start >= fileStats.size || end >= fileStats.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${fileStats.size}` });
        return res.end();
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileStats.size}`,
        'Content-Length': end - start + 1
      });

      const fileStream = fs.createReadStream(fullPath, { start, end });
      await this.pipeStream(fileStream, res, logEntry);
    } else {
      res.writeHead(200);
      const fileStream = fs.createReadStream(fullPath);
      await this.pipeStream(fileStream, res, logEntry);
    }
  }

  pipeStream(fileStream, res, logEntry) {
    return new Promise((resolve, reject) => {
      const streamTimeout = setTimeout(() => {
        fileStream.destroy();
        reject(new Error('STREAM_TIMEOUT'));
      }, this.config.files.streamTimeout);

      fileStream
        .on('error', (error) => {
          clearTimeout(streamTimeout);
          logEntry.result = 'READ_ERROR';
          reject(new Error('READ_ERROR'));
        })
        .on('end', () => {
          clearTimeout(streamTimeout);
          resolve();
        })
        .pipe(res);

      res.on('close', () => {
        clearTimeout(streamTimeout);
        fileStream.destroy();
      });
    });
  }

  handleError(error, res, logEntry) {
    const errorResponses = {
      'ACCESS_DENIED': { status: 403, message: 'Access denied' },
      'INVALID_FILE_TYPE': { status: 403, message: 'File type not allowed' },
      'FILE_NOT_FOUND': { status: 404, message: 'File not found' },
      'NOT_A_FILE': { status: 400, message: 'Requested path is not a file' },
      'FILE_TOO_LARGE': { status: 413, message: 'File exceeds maximum size limit' },
      'READ_ERROR': { status: 500, message: 'Error reading file' },
      'STREAM_TIMEOUT': { status: 504, message: 'Stream timeout' },
      'VALIDATION_ERROR': { status: 500, message: 'Error validating request' },
      'INITIALIZATION_ERROR': { status: 500, message: 'Service initialization error' }
    };

    const response = errorResponses[error.message] || 
                    { status: 500, message: 'Internal server error' };

    this.logger.error({
      message: 'Request handling error',
      errorType: error.message,
      status: response.status,
      errorMessage: response.message,
      stack: error.stack
    });

    if (!res.headersSent) {
      res.writeHead(response.status);
      res.end(response.message);
    }

    logEntry.status = 'error';
    logEntry.result = response.message;
    logEntry.error = error.stack;
  }
}

module.exports = FileHandler;