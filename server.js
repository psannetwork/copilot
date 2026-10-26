import http from 'http';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

function getDetailsFromHar() {
  const harPath = path.resolve('copilot.cloud.microsoft.har');
  if (!fs.existsSync(harPath)) {
    return { wsUrl: null, cookie: null };
  }

  try {
    const data = JSON.parse(fs.readFileSync(harPath, 'utf8'));
    const entries = data.get?.('log')?.entries || data.log?.entries || [];
    
    let latestWsUrl = null;
    let cookieHeader = null;

    for (const entry of entries) {
      const url = entry.request?.url || '';
      if (url.includes('Chathub') && url.startsWith('wss://')) {
        latestWsUrl = url;
        const headers = entry.request?.headers || [];
        for (const h of headers) {
          if (h.name.toLowerCase() === 'cookie') {
            cookieHeader = h.value;
          }
        }
      }
    }
    return { wsUrl: latestWsUrl, cookie: cookieHeader };
  } catch (err) {
    return { wsUrl: null, cookie: null };
  }
}

function loadConfig() {
  const harDetails = getDetailsFromHar();
  const cookiePath = path.resolve('cookie.txt');
  let wsUrl = harDetails.wsUrl;
  let cookies = harDetails.cookie || '';
  let accessToken = '';

  if (fs.existsSync(cookiePath)) {
    try {
      const content = fs.readFileSync(cookiePath, 'utf8');
      const lines = content.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        if (!wsUrl && (trimmed.startsWith('wss://') || trimmed.startsWith('ws://'))) {
          wsUrl = trimmed;
        } else if (trimmed.startsWith('Authorization:')) {
          accessToken = trimmed.replace('Authorization:', '').trim();
        } else if (trimmed.startsWith('Cookie:')) {
          cookies = trimmed.replace('Cookie:', '').trim();
        } else if (trimmed.startsWith('Bearer ') || trimmed.startsWith('eyJ')) {
          accessToken = trimmed;
        } else if (!cookies && trimmed.includes('=')) {
          cookies = trimmed;
        }
      }
    } catch (err) {}
  }

  let finalWsUrl = wsUrl || process.env.WS_URL || '';
  let finalAccessToken = accessToken || process.env.ACCESS_TOKEN || '';

  if (finalWsUrl && !finalAccessToken) {
    try {
      const urlObj = new URL(finalWsUrl);
      const tokenFromUrl = urlObj.searchParams.get('access_token');
      if (tokenFromUrl) {
        finalAccessToken = tokenFromUrl;
      }
    } catch (e) {}
  }

  return {
    wsUrl: finalWsUrl,
    cookies: cookies || process.env.COPILOT_COOKIES || '',
    accessToken: finalAccessToken
  };
}

const server = http.createServer(async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [
        { id: 'copilot', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'gpt-4', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'gpt-4o', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'gpt-4o-mini', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'gpt-4-turbo', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'gpt-3.5-turbo', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'claude-3-5-sonnet', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'claude-3-5-sonnet-20241022', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'claude-3-5-sonnet-20240620', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'claude-3-7-sonnet', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'claude-3-7-sonnet-20250219', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'claude-3-opus-20240229', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'claude-3-haiku-20240307', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'o1-preview', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'o1-mini', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'o1', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'o3-mini', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'deepseek-chat', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'deepseek-coder', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'anthropic/claude-3-5-sonnet', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'anthropic/claude-3-opus', object: 'model', created: Date.now(), owned_by: 'microsoft' },
        { id: 'openai/gpt-4o', object: 'model', created: Date.now(), owned_by: 'microsoft' }
      ]
    }));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/v1/chat/completions') {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
    });

    req.on('end', async () => {
      try {
        const payload = JSON.parse(body);
        const messages = payload.messages || [];
        
        let systemPrompt = '';
        for (const msg of messages) {
          if (msg.role === 'system') {
            const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content || '');
            systemPrompt += `${content}\n\n`;
          }
        }

        const rawLastMessage = messages[messages.length - 1]?.content || 'Hello';
        const lastMessageContent = typeof rawLastMessage === 'string' ? rawLastMessage : JSON.stringify(rawLastMessage);
        
        const lastMessage = systemPrompt ? `${systemPrompt}---
${lastMessageContent}` : lastMessageContent;

        const stream = payload.stream === true;

        const config = loadConfig();
        if (!config.wsUrl) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'WebSocket URL not found in config or HAR', type: 'server_error' } }));
          return;
        }

        const headers = {
          'Host': 'substrate.office.com',
          'Origin': 'https://m365.cloud.microsoft',
          'Referer': 'https://m365.cloud.microsoft/',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        };

        if (config.cookies) {
          headers['Cookie'] = config.cookies;
        }
        if (config.accessToken) {
          headers['Authorization'] = config.accessToken.startsWith('Bearer') ? config.accessToken : `Bearer ${config.accessToken}`;
        }

        let wsUrl = config.wsUrl;
        try {
          const urlObj = new URL(wsUrl);
          urlObj.searchParams.delete('ConversationId');
          wsUrl = urlObj.toString();
        } catch (e) {}

        const ws = new WebSocket(wsUrl, { headers });

        let handshaken = false;
        let fullText = '';
        let lastPrintedLength = 0;
        let responseSent = false;

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive'
          });
        }

        ws.on('open', () => {
          ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + '\x1e');
        });

        ws.on('message', (data) => {
          const messageStr = data.toString();
          const messagesArr = messageStr.split('\x1e');
          for (const msg of messagesArr) {
            if (!msg.trim()) continue;
            try {
              const parsed = JSON.parse(msg);
              if (Object.keys(parsed).length === 0 && !handshaken) {
                handshaken = true;

                const chatArgs = {
                  source: 'officeweb',
                  tone: 'magic',
                  isStartOfSession: true,
                  message: {
                    author: 'user',
                    inputMethod: 'Keyboard',
                    text: lastMessage,
                    messageType: 'Chat',
                    contentOrigin: 'officeweb',
                    locale: 'ja-jp',
                    market: 'en-us',
                    turnCount: 1
                  },
                  clientInfo: {
                    clientPlatform: 'mcmcopilot-web',
                    clientAppName: 'Office'
                  }
                };

                const chatMessage = {
                  arguments: [chatArgs],
                  invocationId: '0',
                  target: 'chat',
                  type: 4
                };

                const now = new Date().toISOString();
                const metricsMessage = {
                  arguments: [{
                    Timestamps: {
                      ConnectionStart: now,
                      UserInputStart: now,
                      ConnectionEstablished: now,
                      UserInputSubmit: now
                    }
                  }],
                  target: 'Metrics',
                  type: 1
                };

                ws.send(
                  JSON.stringify(chatMessage) + '\x1e' +
                  JSON.stringify(metricsMessage) + '\x1e'
                );
                continue;
              }

              if (parsed.target === 'update' && parsed.arguments?.[0]) {
                const arg = parsed.arguments[0];
                const text = arg.messages?.[0]?.text;
                if (text) {
                  fullText = text;
                  if (stream && !responseSent) {
                    if (text.length > lastPrintedLength) {
                      const delta = text.substring(lastPrintedLength);
                      lastPrintedLength = text.length;
                      const chunk = {
                        id: 'chatcmpl-' + Date.now(),
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: payload.model || 'copilot',
                        choices: [{ index: 0, delta: { content: delta }, finish_reason: null }]
                      };
                      res.write(`data: ${JSON.stringify(chunk)}\n\n`);
                    }
                  }
                }

                if (arg.isLastUpdate) {
                  ws.close();
                  if (!responseSent) {
                    responseSent = true;
                    if (stream) {
                      const endChunk = {
                        id: 'chatcmpl-' + Date.now(),
                        object: 'chat.completion.chunk',
                        created: Math.floor(Date.now() / 1000),
                        model: payload.model || 'copilot',
                        choices: [{ index: 0, delta: {}, finish_reason: 'stop' }]
                      };
                      res.write(`data: ${JSON.stringify(endChunk)}\n\n`);
                      res.write('data: [DONE]\n\n');
                      res.end();
                    } else {
                      res.writeHead(200, { 'Content-Type': 'application/json' });
                      res.end(JSON.stringify({
                        id: 'chatcmpl-' + Date.now(),
                        object: 'chat.completion',
                        created: Math.floor(Date.now() / 1000),
                        model: payload.model || 'copilot',
                        choices: [{
                          index: 0,
                          message: { role: 'assistant', content: fullText },
                          finish_reason: 'stop'
                        }],
                        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }
                      }));
                    }
                  }
                }
              }
            } catch (e) {}
          }
        });

        ws.on('error', (err) => {
          if (!responseSent) {
            responseSent = true;
            if (stream) {
              res.end();
            } else {
              res.writeHead(500, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: { message: err.message, type: 'server_error' } }));
            }
          }
        });

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Invalid JSON body', type: 'invalid_request_error' } }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: { message: 'Not Found', type: 'invalid_request_error' } }));
});

let portArg = process.env.PORT || 3000;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if ((args[i] === '--port' || args[i] === '-p') && args[i + 1]) {
    portArg = parseInt(args[i + 1], 10);
    break;
  }
}
const PORT = portArg;

server.listen(PORT, () => {
  console.log(`=== Copilot OpenAI Compatible API Server running on port ${PORT} ===`);
  console.log(`Endpoints:`);
  console.log(`  POST /v1/chat/completions`);
  console.log(`  GET /v1/models`);
});
