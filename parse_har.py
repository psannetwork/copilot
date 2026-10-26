import json
import sys

har_path = 'copilot.cloud.microsoft.har'

try:
    with open(har_path, 'r', encoding='utf-8') as f:
        data = json.load(f)
except Exception as e:
    print(f"HARファイルの読み込みエラー: {e}")
    sys.exit(1)

entries = data.get('log', {}).get('entries', [])
print(f"総エントリ数: {len(entries)}")

websocket_urls = []
api_requests = []

for entry in entries:
    request = entry.get('request', {})
    url = request.get('url', '')
    
    # WebSocketやChathubに関連するURLを探す
    if 'Chathub' in url or 'wss://' in url or 'websocket' in request.get('queryString', str([])):
        websocket_urls.append(url)
        
    # POSTリクエストなどのAPIを探す
    if request.get('method') == 'POST' and ('copilot' in url or 'substrate' in url):
        api_requests.append({
            'url': url,
            'headers': {h['name']: h['value'] for h in request.get('headers', [])},
            'postData': request.get('postData', {}).get('text', '')
        })

print("\n--- 検出されたChathub / WebSocket関連URL ---")
for u in set(websocket_urls):
    print(u)

print(f"\n--- 検出された主要なAPI POSTリクエスト数: {len(api_requests)} ---")
if api_requests:
    print("最新のPOSTリクエスト例:")
    latest = api_requests[-1]
    print(f"URL: {latest['url']}")
    print(f"Headers: {list(latest['headers'].keys())}")
    print(f"Body snippet: {latest['postData'][:200]}...")
