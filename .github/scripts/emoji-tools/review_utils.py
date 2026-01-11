#!/usr/bin/env python3
"""
Shared utilities for emoji review scripts.
Provides HTTP server base class and common HTML/CSS generation.
"""

import json
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote


CONTENT_TYPES = {
    '.gif': 'image/gif',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.avif': 'image/avif'
}


def loadReviewedFiles(repoPath: Path) -> set[str]:
    """Load all reviewed emoji names (lowercase stems) from reviewed-files.json."""
    reviewedFile = repoPath / ".github" / "reviewed-files.json"
    reviewed = set()

    if reviewedFile.exists():
        try:
            data = json.loads(reviewedFile.read_text())
            for path in data.get("files", []):
                name = Path(path).stem.lower()
                reviewed.add(name)
        except Exception:
            pass

    return reviewed


def saveReviewedFiles(repoPath: Path, filePaths: list[str]):
    """Add file paths to reviewed-files.json."""
    reviewedFile = repoPath / ".github" / "reviewed-files.json"

    existingFiles = []
    if reviewedFile.exists():
        try:
            data = json.loads(reviewedFile.read_text())
            existingFiles = data.get("files", [])
        except Exception:
            pass

    allFiles = sorted(set(existingFiles) | set(filePaths))
    reviewedFile.write_text(json.dumps({"files": allFiles}, indent=2) + "\n")


def getBaseStyles() -> str:
    """Get the common CSS styles for review interfaces."""
    return '''
        * { box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }
        .container { max-width: 900px; margin: 0 auto; }
        h1 { text-align: center; color: #fff; margin-bottom: 10px; }
        .progress { text-align: center; font-size: 18px; margin-bottom: 20px; color: #888; }
        .emoji-box {
            background: #252540;
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            min-width: 300px;
        }
        .emoji-box h3 { margin: 0 0 15px 0; color: #aaa; font-weight: normal; }
        .emoji-box img {
            max-width: 256px;
            max-height: 256px;
            image-rendering: pixelated;
            background: #333;
            border-radius: 8px;
        }
        .emoji-name {
            margin-top: 15px;
            font-size: 24px;
            font-weight: bold;
            color: #fff;
            text-align: center;
            margin-bottom: 20px;
        }
        .emoji-path { margin-top: 5px; font-size: 12px; color: #666; word-break: break-all; }
        .controls { display: flex; gap: 15px; justify-content: center; margin-bottom: 30px; flex-wrap: wrap; }
        button {
            padding: 15px 40px;
            font-size: 18px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: transform 0.1s;
        }
        button:hover { transform: scale(1.05); }
        button:active { transform: scale(0.95); }
        button:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .approve { background: #4ade80; color: #000; }
        .deny { background: #f87171; color: #000; }
        .rename { background: #fbbf24; color: #000; }
        .skip { background: #666; color: #fff; }
        .finish { background: #6366f1; color: #fff; }
        .stats { display: flex; justify-content: center; gap: 30px; margin-bottom: 20px; flex-wrap: wrap; }
        .stat { text-align: center; }
        .stat-value { font-size: 32px; font-weight: bold; }
        .stat-label { font-size: 14px; color: #888; }
        .stat-approved .stat-value { color: #4ade80; }
        .stat-denied .stat-value { color: #f87171; }
        .stat-renamed .stat-value { color: #fbbf24; }
        .stat-skipped .stat-value { color: #888; }
        .keyboard-hint { text-align: center; color: #555; font-size: 14px; margin-bottom: 20px; }
        kbd { background: #333; padding: 3px 8px; border-radius: 4px; font-family: monospace; }
        .results { display: none; background: #252540; border-radius: 12px; padding: 20px; text-align: center; }
        .results h2 { margin-top: 0; }
        .status-message { margin: 20px 0; padding: 15px; border-radius: 8px; }
        .status-message.success { background: #065f46; }
        .status-message.error { background: #7f1d1d; }
        .no-original { color: #f87171; font-style: italic; }
        .rename-dialog {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0,0,0,0.8);
            justify-content: center;
            align-items: center;
            z-index: 1000;
        }
        .rename-dialog.active { display: flex; }
        .rename-box {
            background: #252540;
            border-radius: 12px;
            padding: 30px;
            text-align: center;
            min-width: 400px;
        }
        .rename-box h3 { margin-top: 0; color: #fff; }
        .rename-box input {
            width: 100%;
            padding: 12px;
            font-size: 18px;
            border: 2px solid #444;
            border-radius: 8px;
            background: #1a1a2e;
            color: #fff;
            margin: 15px 0;
        }
        .rename-box input:focus { border-color: #fbbf24; outline: none; }
        .rename-buttons { display: flex; gap: 15px; justify-content: center; }
        .rename-cancel { background: #666; color: #fff; }
        .rename-confirm { background: #fbbf24; color: #000; }
        .comparison {
            display: flex;
            gap: 40px;
            justify-content: center;
            align-items: flex-start;
            margin-bottom: 30px;
        }
    '''


def getStatsHtml(includeRenamed: bool = False) -> str:
    """Get the stats display HTML."""
    stats = '''
        <div class="stats">
            <div class="stat stat-approved">
                <div class="stat-value" id="approvedCount">0</div>
                <div class="stat-label">Approved</div>
            </div>
            <div class="stat stat-denied">
                <div class="stat-value" id="deniedCount">0</div>
                <div class="stat-label">Denied</div>
            </div>
    '''

    if includeRenamed:
        stats += '''
            <div class="stat stat-renamed">
                <div class="stat-value" id="renamedCount">0</div>
                <div class="stat-label">Renamed</div>
            </div>
        '''

    stats += '''
            <div class="stat stat-skipped">
                <div class="stat-value" id="skippedCount">0</div>
                <div class="stat-label">Skipped</div>
            </div>
        </div>
    '''

    return stats


def getRenameDialogHtml() -> str:
    """Get the rename dialog HTML."""
    return '''
        <div class="rename-dialog" id="renameDialog">
            <div class="rename-box">
                <h3>Rename Emoji</h3>
                <p>Enter new name (without extension):</p>
                <input type="text" id="renameInput" placeholder="new_name">
                <div class="rename-buttons">
                    <button class="rename-cancel" onclick="hideRenameDialog()">Cancel</button>
                    <button class="rename-confirm" onclick="confirmRename()">Rename & Approve</button>
                </div>
            </div>
        </div>
    '''


def getBaseJavaScript(port: int) -> str:
    """Get common JavaScript functions for review interfaces."""
    return f'''
        function updateStats() {{
            let approved = 0, denied = 0, renamed = 0, skipped = 0;
            for (const d of Object.values(decisions)) {{
                const action = typeof d === 'string' ? d : d.action;
                if (action === 'approve') approved++;
                else if (action === 'deny') denied++;
                else if (action === 'rename') renamed++;
                else if (action === 'skip') skipped++;
            }}
            document.getElementById('approvedCount').textContent = approved;
            document.getElementById('deniedCount').textContent = denied;
            if (document.getElementById('renamedCount')) {{
                document.getElementById('renamedCount').textContent = renamed;
            }}
            document.getElementById('skippedCount').textContent = skipped;
        }}

        function goBack() {{
            if (currentIndex > 0) {{
                currentIndex--;
                updateDisplay();
            }}
        }}

        function showRenameDialog() {{
            const emoji = emojis[currentIndex];
            document.getElementById('renameInput').value = emoji.name;
            document.getElementById('renameDialog').classList.add('active');
            document.getElementById('renameInput').focus();
            document.getElementById('renameInput').select();
        }}

        function hideRenameDialog() {{
            document.getElementById('renameDialog').classList.remove('active');
        }}

        function confirmRename() {{
            const newName = document.getElementById('renameInput').value.trim();
            if (newName && newName !== emojis[currentIndex].name) {{
                decide('rename', newName);
            }} else if (newName === emojis[currentIndex].name) {{
                decide('approve');
            }}
            hideRenameDialog();
        }}
    '''


class BaseReviewHandler(BaseHTTPRequestHandler):
    """Base HTTP request handler for review servers."""

    repoPath = None
    htmlContent = None
    port = 8754

    def logMessage(self, format, *args):
        pass

    def serveHtml(self):
        """Serve the main HTML page."""
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(self.__class__.htmlContent.encode('utf-8'))

    def serveFile(self, filePath: str):
        """Serve an image file."""
        try:
            with open(filePath, 'rb') as f:
                data = f.read()

            ext = Path(filePath).suffix.lower()

            self.send_response(200)
            self.send_header('Content-Type', CONTENT_TYPES.get(ext, 'application/octet-stream'))
            self.send_header('Cache-Control', 'no-cache')
            self.end_headers()
            self.wfile.write(data)
        except Exception:
            self.send_response(404)
            self.end_headers()

    def handleShutdown(self):
        """Handle shutdown request."""
        self.send_response(200)
        self.end_headers()
        threading.Thread(target=self.server.shutdown).start()

    def sendJsonResponse(self, data: dict, status: int = 200):
        """Send a JSON response."""
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def readPostData(self) -> dict:
        """Read and parse POST JSON data."""
        contentLength = int(self.headers['Content-Length'])
        postData = self.rfile.read(contentLength)
        return json.loads(postData)

    def doGet(self):
        if self.path == '/':
            self.serveHtml()
        elif self.path.startswith('/file/'):
            filePath = unquote(self.path[6:])
            self.serveFile(filePath)
        elif self.path == '/shutdown':
            self.handleShutdown()
        else:
            self.send_response(404)
            self.end_headers()

    def doPost(self):
        self.send_response(404)
        self.end_headers()

    do_GET = doGet
    do_POST = doPost
    log_message = logMessage


def runReviewServer(handlerClass, port: int, htmlContent: str, repoPath: Path):
    """Run the review HTTP server."""
    handlerClass.htmlContent = htmlContent
    handlerClass.repoPath = repoPath
    handlerClass.port = port

    server = HTTPServer(('localhost', port), handlerClass)

    print(f"Starting review server at http://localhost:{port}")
    print("Opening browser...")
    print()
    print("(Close the browser tab or click 'Close' when done)")

    webbrowser.open(f'http://localhost:{port}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

    server.server_close()
    print("\nReview complete!")
