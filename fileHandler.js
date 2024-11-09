const fs = require('fs');
const path = require('path');
const mime = require('mime-types');
const crypto = require('crypto');

class FileHandler {
  constructor(config, logger) {
    if (!config?.files?.basePath) {
      throw new Error('Invalid configuration: basePath is required');
    }
    
    this.config = this.validateConfig(config);
    this.logger = logger;
    this.createBaseDirectory();
  }

  validateConfig(config) {
    // 确保 basePath 是绝对路径
    const absoluteBasePath = path.resolve(config.files.basePath);
    
    // 记录基础路径配置
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
      
      // 验证目录权限
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
    
    // 解码并清理文件路径
    const rawFilePath = req.url.slice(7); // 移除 '/files/' 前缀
    const decodedPath = decodeURIComponent(rawFilePath).trim();
    
    // 记录请求信息
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
    // 详细的路径验证日志
    this.logger.debug({
      message: 'Starting path validation',
      originalPath: filePath,
      basePath: this.config.files.basePath
    });

    // 规范化路径，移除任何 "../" 序列
    const normalizedPath = path.normalize(filePath).replace(/^(\.\.(\/|\\|$))+/, '');
    const fullPath = path.join(this.config.files.basePath, normalizedPath);
    
    // 记录路径处理结果
    this.logger.debug({
      message: 'Path processing result',
      normalizedPath,
      fullPath,
      basePathCheck: fullPath.startsWith(this.config.files.basePath)
    });

    // 验证路径是否在基础目录内
    if (!fullPath.startsWith(this.config.files.basePath)) {
      this.logger.warn({
        message: 'Path validation failed - outside base directory',
        attemptedPath: fullPath,
        basePath: this.config.files.basePath
      });
      throw new Error('ACCESS_DENIED');
    }

    // 验证文件扩展名
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
      
      // 验证是否为文件
      if (!stats.isFile()) {
        this.logger.warn({
          message: 'Path is not a file',
          path: fullPath,
          fileType: stats.isDirectory() ? 'directory' : 'other'
        });
        throw new Error('NOT_A_FILE');
      }

      // 验证文件大小
      if (stats.size > this.config.files.maxFileSize) {
        this.logger.warn({
          message: 'File too large',
          size: stats.size,
          maxSize: this.config.files.maxFileSize
        });
        throw new Error('FILE_TOO_LARGE');
      }

      // 验证文件权限
      await fs.promises.access(fullPath, fs.constants.R_OK);
      
      // 存储验证通过的信息
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

  // streamFile 方法保持不变...

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

    // 记录详细的错误信息
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