

// server.js
const https = require('https');
const fs = require('fs');
const config = require('./config');
const Logger = require('./logger');
const FileHandler = require('./fileHandler');

class Server {
  constructor() {
    this.config = config;
    this.logger = new Logger(
      this.config.logging.accessLogPath,
      this.config.logging.serverLogPath
    );
    this.fileHandler = new FileHandler(this.config, this.logger);
  }

  async start() {
    const sslOptions = {
      key: fs.readFileSync(this.config.server.sslOptions.keyPath),
      cert: fs.readFileSync(this.config.server.sslOptions.certPath)
    };

    const server = https.createServer(sslOptions, (req, res) => 
      this.handleRequest(req, res));

    server.listen(this.config.server.port, () => {
      console.log(`HTTPS server listening on port ${this.config.server.port}`);
      this.logger.logServer(`Server started on port ${this.config.server.port}`);
    });
  }

  async handleRequest(req, res) {
    await this.logger.logServer(`${req.method} ${req.url}`);

    const isFileRequest = await this.fileHandler.handleRequest(req, res);
    if (!isFileRequest) {
      this.handleDefaultRequest(req, res);
    }
  }

  handleDefaultRequest(req, res) {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      if (body) {
        this.logger.logServer(`Request body: ${body}`);
      }
      res.writeHead(200);
      res.end('Server is running.');
    });
  }
}

// Start the server
const server = new Server();
server.start();