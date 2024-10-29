const https = require('https');
const fs = require('fs');

// SSL certificate options
const options = {
  key: fs.readFileSync('server.key'),
  cert: fs.readFileSync('server.cert')
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
