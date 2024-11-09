const https = require('https');
const fs = require('fs');

// SSL certificate options
const options = {
  key: fs.readFileSync('./ssl/server.key'),
  cert: fs.readFileSync('./ssl/server.cert')
};

// File sharing route handler
const handleFileRequest = (req, res) => {
  if (req.url.startsWith('/files/')) {
    const filePath = req.url.slice(7); // Remove '/files/' prefix
    
    // Security checks
    if (filePath.includes('..') || !filePath.startsWith('shared/')) {
      res.writeHead(403);
      res.end('Access denied');
      return true;
    }

    // Validate file extension
    const allowedExtensions = ['.txt', '.pdf', '.jpg', '.png', '.mp4'];
    const hasValidExtension = allowedExtensions.some(ext => filePath.toLowerCase().endsWith(ext));
    if (!hasValidExtension) {
      res.writeHead(403);
      res.end('File type not allowed');
      return true;
    }

    // Check if file exists
    fs.access(`shared/${filePath}`, fs.constants.F_OK, (err) => {
      if (err) {
        res.writeHead(404);
        res.end('File not found');
        return;
      }

      // Stream file to response
      const fileStream = fs.createReadStream(`shared/${filePath}`);
      fileStream.on('error', (error) => {
        res.writeHead(500);
        res.end('Error reading file');
      });

      // Pipe file to response
      fileStream.pipe(res);
    });
    return true;
  }
  return false;
};


// Create HTTPS server
const server = https.createServer(options, (req, res) => {
  // Log request details
  console.log('Request received:');
  console.log('- Method:', req.method);
  console.log('- URL:', req.url);
  console.log('- Headers:', req.headers);
  // Log to file
  const logEntry = `${new Date().toISOString()} - ${req.method} ${req.url}\n`;
  fs.appendFile('server.log', logEntry, err => {
    if (err) {
      console.error('Error writing to log file:', err);
    }
  });

  // Get request body if any
  let body = '';
  req.on('data', chunk => {
    body += chunk.toString();
  });

  req.on('end', () => {
    if (body) {
      console.log('- Body:', body);
    }

    // Send response
    res.writeHead(200);
    res.end('Request logged');
  });
});

// Start server
const PORT = 443;
server.listen(PORT, () => {
  console.log(`HTTPS server listening on port ${PORT}`);
});
