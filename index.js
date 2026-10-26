import readline from 'readline';
import fs from 'fs';
import path from 'path';
import WebSocket from 'ws';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

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
    console.error('HARファイルの解析エラー:', err.message);
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
    } catch (err) {
      console.error('cookie.txtの読み込みエラー:', err.message);
    }
  }

  const finalWsUrl = wsUrl || process.env.WS_URL || '';
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

async function fetchConversationHistory(config) {
  try {
    const headers = {
      'Content-Type': 'application/json',
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

    const res = await fetch('https://copilot.cloud.microsoft/resources/app-shell-action', {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({
        action: 'RefreshNavPane',
        conversationHistoryFilter: null,
        skipNotebooks: false,
        skipAgentListCache: true,
        enableLastMessage: false
      })
    });

    if (!res.ok) {
      return [];
    }

    const text = await res.text();
    if (text.trim().startsWith('<')) {
      return [];
    }

    const data = JSON.parse(text);
    const chats = data?.store?.conversationPageHistoryList?.chats || [];
    return chats;
  } catch (err) {
    return [];
  }
}

let isStartOfSession = true;
let turnCount = 1;
let currentConversationId = null;

async function startChatSession() {
  const config = loadConfig();

  if (!config.wsUrl) {
    console.log('\n[エラー] WebSocketのURLが見つかりません。');
    console.log('copilot.cloud.microsoft.har を配置するか、cookie.txtに wss:// のURLを記載してください。');
    rl.close();
    return;
  }

  console.log('\n会話履歴を読み込み中...');
  const chats = await fetchConversationHistory(config);

  if (chats.length > 0) {
    console.log('\n=== 過去の会話履歴 ===');
    console.log('  0: 新規チャットを開始');
    chats.slice(0, 15).forEach((chat, idx) => {
      console.log(`  ${idx + 1}: ${chat.chatName || '無題'} (ID: ${chat.conversationId})`);
    });

    rl.question('\n番号を選択してください (0 = 新規): ', (answer) => {
      const choice = parseInt(answer.trim(), 10);
      if (!isNaN(choice) && choice > 0 && choice <= chats.length) {
        const selectedChat = chats[choice - 1];
        currentConversationId = selectedChat.conversationId;
        isStartOfSession = false; // 既存の会話を続ける場合はセッションの最初ではない
        console.log(`\n[選択された会話]: "${selectedChat.chatName}" (ID: ${currentConversationId})`);
      } else {
        console.log('\n新規チャットを開始します。');
        currentConversationId = null;
        isStartOfSession = true;
      }
      promptUser(config);
    });
  } else {
    console.log('\n会話履歴を取得できなかったため、新規チャットを開始します。');
    promptUser(config);
  }
}

function promptUser(config) {
  rl.question('\nプロンプトを入力してください (終了するには exit): ', (input) => {
    if (input.toLowerCase() === 'exit') {
      rl.close();
      return;
    }

    sendTurn(config, input);
  });
}

function sendTurn(config, input) {
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
    if (currentConversationId) {
      urlObj.searchParams.set('ConversationId', currentConversationId);
    } else {
      urlObj.searchParams.delete('ConversationId');
    }
    wsUrl = urlObj.toString();
  } catch (e) {}

  console.log('\nWebSocket接続を確立中...');
  const ws = new WebSocket(wsUrl, { headers });

  let lastCopilotText = '';
  let lastPrintedLength = 0;
  let hasPrintedHeader = false;
  let handshaken = false;

  ws.on('open', () => {
    console.log('SignalRハンドシェイクを送信します...');
    ws.send(JSON.stringify({ protocol: 'json', version: 1 }) + '\x1e');
  });

  ws.on('message', (data) => {
    const messageStr = data.toString();
    const messages = messageStr.split('\x1e');
    for (const msg of messages) {
      if (!msg.trim()) continue;
      try {
        const parsed = JSON.parse(msg);
        if (Object.keys(parsed).length === 0 && !handshaken) {
          handshaken = true;
          console.log('SignalRハンドシェイク完了。メッセージ送信中...');

          const chatArgs = {
            source: 'officeweb',
            tone: 'magic',
            isStartOfSession: isStartOfSession,
            message: {
              author: 'user',
              inputMethod: 'Keyboard',
              text: input,
              messageType: 'Chat',
              contentOrigin: 'officeweb',
              locale: 'ja-jp',
              market: 'en-us',
              turnCount: turnCount++
            },
            clientInfo: {
              clientPlatform: 'mcmcopilot-web',
              clientAppName: 'Office'
            }
          };

          if (currentConversationId) {
            chatArgs.conversationId = currentConversationId;
          }

          const chatMessage = {
            arguments: [chatArgs],
            invocationId: '0',
            target: 'chat',
            type: 4
          };

          isStartOfSession = false;

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

        if (parsed.arguments?.[0]?.conversationId) {
          currentConversationId = parsed.arguments[0].conversationId;
        }
        if (parsed.result?.conversationId) {
          currentConversationId = parsed.result.conversationId;
        }

        if (parsed.target === 'update' && parsed.arguments?.[0]) {
          const arg = parsed.arguments[0];
          if (arg.conversationId) {
            currentConversationId = arg.conversationId;
          }
          const text = arg.messages?.[0]?.text;
          if (text) {
            if (!hasPrintedHeader) {
              process.stdout.write('\n[Copilot]: ');
              hasPrintedHeader = true;
            }
            if (text.length > lastPrintedLength) {
              const delta = text.substring(lastPrintedLength);
              process.stdout.write(delta);
              lastPrintedLength = text.length;
            }
            lastCopilotText = text;
          }
          if (arg.isLastUpdate) {
            if (!hasPrintedHeader) {
              if (lastCopilotText) {
                console.log('\n[Copilot]:', lastCopilotText);
              } else {
                console.log('\n[Copilot]: (応答本文なし)');
              }
            } else {
              console.log();
            }
            ws.close();
            promptUser(config);
          }
        }

        if (parsed.type === 3) {
          // 応答完了
        }
      } catch (e) {
        console.log('\n[受信生データ]:', msg);
      }
    }
  });

  ws.on('error', (error) => {
    console.error('WebSocketエラー:', error.message);
  });

  ws.on('close', (code, reason) => {
    // connection closed for this turn
  });
}

console.log('=== Copilot HAR-based WebSocket Chat Wrapper ===');
startChatSession();
