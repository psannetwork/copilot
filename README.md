# Copilot WebSocket (SignalR) Chat Wrapper in Node.js

M365 Copilot等の WebSocket (SignalR) エンドポイントに接続し、チャットを送受信するNode.jsラッパーです。

## 使い方

1. 依存関係のインストール:
   ```bash
   npm install
   ```

2. `cookie.txt` に以下の形式で接続情報（WebSocketのURL、Cookie、アクセストークン）を記述します。
   ```text
   wss://substrate.office.com/m365Copilot/Chathub/your_session_id?...
   Cookie: OH.SID=...; OhpToken=...
   Authorization: Bearer eyJ...
   ```

3. スクリプトの実行:
   ```bash
   npm start
   ```
