import http from 'http';
import { parse } from 'url';
import * as path from 'path';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const PORT = 3000;

// Get the project root directory
const projectRoot = path.resolve(__dirname, '..');

// Direct imports of handlers (avoiding dynamic import issues)
import healthHandler from '../api/health';
import addressResolveHandler from '../api/address/resolve';
import addressSearchHandler from '../api/address/search';
import valuationHandler from '../api/valuation';

// Handler map
const handlers: Record<string, any> = {
  '/api/health': healthHandler,
  '/api/address/resolve': addressResolveHandler,
  '/api/address/search': addressSearchHandler,
  '/api/valuation': valuationHandler,
};

const server = http.createServer(async (req, res) => {
  const parsedUrl = parse(req.url || '', true);
  const pathname = parsedUrl.pathname || '';
  
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve docs page at root
  if (pathname === '/' || pathname === '') {
    const indexPath = path.join(projectRoot, 'public', 'index.html');
    try {
      const html = fs.readFileSync(indexPath, 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
      return;
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Could not load docs page' }));
      return;
    }
  }

  // Create mock request/response objects similar to Vercel's
  const mockReq: any = {
    method: req.method,
    url: req.url,
    headers: req.headers,
    query: parsedUrl.query,
    body: null,
  };

  const mockRes: any = {
    statusCode: 200,
    _headers: {} as Record<string, string>,
    _body: '',
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    setHeader(name: string, value: string) {
      this._headers[name] = value;
      return this;
    },
    json(data: any) {
      this._headers['Content-Type'] = 'application/json';
      this._body = JSON.stringify(data);
      return this;
    },
    send(data: any) {
      this._body = typeof data === 'string' ? data : JSON.stringify(data);
      return this;
    },
    end() {
      return this;
    }
  };

  // Parse body for POST requests
  if (req.method === 'POST') {
    const bodyChunks: Buffer[] = [];
    req.on('data', (chunk) => bodyChunks.push(chunk));
    await new Promise<void>((resolve) => req.on('end', resolve));
    const bodyStr = Buffer.concat(bodyChunks).toString();
    try {
      mockReq.body = JSON.parse(bodyStr);
    } catch {
      mockReq.body = bodyStr;
    }
  }

  // Route handling - use pre-imported handlers
  const handler = handlers[pathname];

  if (handler) {
    try {
      await handler(mockReq, mockRes);
      
      // Write response
      res.writeHead(mockRes.statusCode, mockRes._headers);
      res.end(mockRes._body);
    } catch (error: any) {
      console.error('Handler error:', error);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Internal server error', details: error.message }));
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found', path: pathname }));
  }
});

server.listen(PORT, () => {
  console.log(`Dev server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  GET  /api/health');
  console.log('  POST /api/address/resolve');
  console.log('  POST /api/address/search');
  console.log('  POST /api/valuation');
});

