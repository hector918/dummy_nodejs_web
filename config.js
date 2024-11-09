// config.js
const path = require('path');

const config = {
  server: {
    port: 443,
    sslOptions: {
      keyPath: './ssl/server.key',
      certPath: './ssl/server.cert'
    }
  },
  files: {
    basePath: 'shared_files',
    allowedExtensions: ['.txt', '.pdf', '.jpg', '.png', '.mp4']
  },
  logging: {
    accessLogPath: 'access.log',
    serverLogPath: 'server.log'
  }
};

module.exports = config;
