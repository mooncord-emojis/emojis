#!/usr/bin/env python3
"""
Review interface for seasonal emotes with automatic deletion.
Runs a local server so the browser can delete files directly.
"""

import json
import os
import threading
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote

PORT = 8754
approvedFilePath = None


def loadApprovedEmotes(folder: Path) -> set[str]:
    """Load the list of already-approved emote names."""
    approvedFile = folder / "approved.json"
    if approvedFile.exists():
        try:
            data = json.loads(approvedFile.read_text())
            return set(data.get("approved", []))
        except:
            pass
    return set()


def saveApprovedEmotes(folder: Path, names: list[str]):
    """Save the list of approved emote names."""
    approvedFile = folder / "approved.json"
    existingApproved = loadApprovedEmotes(folder)
    allApproved = sorted(existingApproved | set(names))
    approvedFile.write_text(json.dumps({"approved": allApproved}, indent=2))


def findOriginalEmote(repoPath: Path, emoteName: str) -> Path | None:
    """Find the original emote in the repo by name."""
    extensions = {".gif", ".png", ".webp", ".avif"}
    excludeDirs = {".git", ".github", ".claude", ".vscode", "Seasonal", "worker"}

    for root, dirs, files in os.walk(repoPath):
        dirs[:] = [d for d in dirs if d not in excludeDirs]

        for filename in files:
            filePath = Path(root) / filename
            if filePath.stem.lower() == emoteName.lower() and filePath.suffix.lower() in extensions:
                return filePath

    return None


def getEmotesInFolder(folder: Path) -> list[Path]:
    """Get all emote files in a folder."""
    extensions = {".gif", ".png", ".webp", ".avif"}
    emotes = []

    if not folder.exists():
        return emotes

    for f in sorted(folder.iterdir()):
        if f.is_file() and f.suffix.lower() in extensions:
            emotes.append(f)

    return emotes


def generateHtml(emoteData: list[dict], tag: str, repoPath: Path) -> str:
    """Generate the HTML review interface."""
    emoteDataJson = json.dumps(emoteData)
    repoPathStr = str(repoPath).replace("\\", "/")

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Review {tag} Emotes</title>
    <style>
        * {{ box-sizing: border-box; }}
        body {{
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background: #1a1a2e;
            color: #eee;
            margin: 0;
            padding: 20px;
            min-height: 100vh;
        }}
        .container {{ max-width: 900px; margin: 0 auto; }}
        h1 {{ text-align: center; color: #fff; margin-bottom: 10px; }}
        .progress {{ text-align: center; font-size: 18px; margin-bottom: 20px; color: #888; }}
        .comparison {{
            display: flex;
            gap: 40px;
            justify-content: center;
            align-items: flex-start;
            margin-bottom: 30px;
        }}
        .emote-box {{
            background: #252540;
            border-radius: 12px;
            padding: 20px;
            text-align: center;
            min-width: 300px;
        }}
        .emote-box h3 {{ margin: 0 0 15px 0; color: #aaa; font-weight: normal; }}
        .emote-box img {{
            max-width: 256px;
            max-height: 256px;
            image-rendering: pixelated;
            background: #333;
            border-radius: 8px;
        }}
        .emote-name {{
            margin-top: 15px;
            font-size: 24px;
            font-weight: bold;
            color: #fff;
            text-align: center;
            margin-bottom: 20px;
        }}
        .emote-path {{ margin-top: 5px; font-size: 12px; color: #666; word-break: break-all; }}
        .controls {{ display: flex; gap: 15px; justify-content: center; margin-bottom: 30px; }}
        button {{
            padding: 15px 40px;
            font-size: 18px;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            transition: transform 0.1s;
        }}
        button:hover {{ transform: scale(1.05); }}
        button:active {{ transform: scale(0.95); }}
        button:disabled {{ opacity: 0.5; cursor: not-allowed; transform: none; }}
        .approve {{ background: #4ade80; color: #000; }}
        .deny {{ background: #f87171; color: #000; }}
        .skip {{ background: #666; color: #fff; }}
        .finish {{ background: #6366f1; color: #fff; }}
        .stats {{ display: flex; justify-content: center; gap: 30px; margin-bottom: 20px; }}
        .stat {{ text-align: center; }}
        .stat-value {{ font-size: 32px; font-weight: bold; }}
        .stat-label {{ font-size: 14px; color: #888; }}
        .stat-approved .stat-value {{ color: #4ade80; }}
        .stat-denied .stat-value {{ color: #f87171; }}
        .stat-skipped .stat-value {{ color: #888; }}
        .keyboard-hint {{ text-align: center; color: #555; font-size: 14px; margin-bottom: 20px; }}
        kbd {{ background: #333; padding: 3px 8px; border-radius: 4px; font-family: monospace; }}
        .results {{ display: none; background: #252540; border-radius: 12px; padding: 20px; text-align: center; }}
        .results h2 {{ margin-top: 0; }}
        .delete-status {{ margin: 20px 0; padding: 15px; border-radius: 8px; }}
        .delete-status.success {{ background: #065f46; }}
        .delete-status.error {{ background: #7f1d1d; }}
        .no-original {{ color: #f87171; font-style: italic; }}
    </style>
</head>
<body>
    <div class="container">
        <h1>Review {tag} Emotes</h1>
        <div class="progress" id="progress">Loading...</div>

        <div class="stats">
            <div class="stat stat-approved">
                <div class="stat-value" id="approvedCount">0</div>
                <div class="stat-label">Approved</div>
            </div>
            <div class="stat stat-denied">
                <div class="stat-value" id="deniedCount">0</div>
                <div class="stat-label">Denied</div>
            </div>
            <div class="stat stat-skipped">
                <div class="stat-value" id="skippedCount">0</div>
                <div class="stat-label">Skipped</div>
            </div>
        </div>

        <div class="comparison" id="comparison">
            <div class="emote-box">
                <h3>Original</h3>
                <img id="originalImg" src="" alt="Original">
                <div class="emote-path" id="originalPath"></div>
            </div>
            <div class="emote-box">
                <h3>Seasonal ({tag})</h3>
                <img id="seasonalImg" src="" alt="Seasonal">
                <div class="emote-path" id="seasonalPath"></div>
            </div>
        </div>

        <div class="emote-name" id="emoteName"></div>

        <div class="controls" id="controls">
            <button class="approve" onclick="decide('approve')">Approve</button>
            <button class="deny" onclick="decide('deny')">Deny</button>
            <button class="skip" onclick="decide('skip')">Skip</button>
        </div>

        <div class="keyboard-hint">
            <kbd>A</kbd> or <kbd>Enter</kbd> Approve &nbsp;&nbsp;
            <kbd>D</kbd> Deny &nbsp;&nbsp;
            <kbd>S</kbd> Skip &nbsp;&nbsp;
            <kbd>←</kbd> Go Back
        </div>

        <div class="results" id="results">
            <h2>Review Complete!</h2>
            <p id="summaryText"></p>
            <div class="delete-status" id="deleteStatus" style="display:none;"></div>
            <button class="finish" id="finishBtn" onclick="finishReview()">Save & Finish</button>
        </div>
    </div>

    <script>
        const emotes = {emoteDataJson};
        const repoPath = "{repoPathStr}";
        let currentIndex = 0;
        let decisions = {{}};

        function updateDisplay() {{
            if (currentIndex >= emotes.length) {{
                showResults();
                return;
            }}

            const emote = emotes[currentIndex];
            document.getElementById('progress').textContent = `${{currentIndex + 1}} of ${{emotes.length}}`;
            document.getElementById('emoteName').textContent = emote.name;

            document.getElementById('seasonalImg').src = 'http://localhost:{PORT}/file/' + encodeURIComponent(emote.seasonalPath);
            document.getElementById('seasonalPath').textContent = emote.seasonalPath.replace(repoPath + '/', '');

            if (emote.originalPath) {{
                document.getElementById('originalImg').src = 'http://localhost:{PORT}/file/' + encodeURIComponent(emote.originalPath);
                document.getElementById('originalImg').style.display = 'block';
                document.getElementById('originalPath').textContent = emote.originalPath.replace(repoPath + '/', '');
                document.getElementById('originalPath').className = 'emote-path';
            }} else {{
                document.getElementById('originalImg').style.display = 'none';
                document.getElementById('originalPath').textContent = 'Not found in repo';
                document.getElementById('originalPath').className = 'emote-path no-original';
            }}

            updateStats();
        }}

        function updateStats() {{
            let approved = 0, denied = 0, skipped = 0;
            for (const d of Object.values(decisions)) {{
                if (d === 'approve') approved++;
                else if (d === 'deny') denied++;
                else if (d === 'skip') skipped++;
            }}
            document.getElementById('approvedCount').textContent = approved;
            document.getElementById('deniedCount').textContent = denied;
            document.getElementById('skippedCount').textContent = skipped;
        }}

        function decide(decision) {{
            decisions[currentIndex] = decision;
            currentIndex++;
            updateDisplay();
        }}

        function goBack() {{
            if (currentIndex > 0) {{
                currentIndex--;
                updateDisplay();
            }}
        }}

        function showResults() {{
            document.getElementById('comparison').style.display = 'none';
            document.getElementById('controls').style.display = 'none';
            document.getElementById('emoteName').style.display = 'none';
            document.querySelector('.keyboard-hint').style.display = 'none';
            document.getElementById('progress').textContent = 'Review Complete!';

            let denied = 0, approved = 0;
            for (const d of Object.values(decisions)) {{
                if (d === 'deny') denied++;
                else if (d === 'approve') approved++;
            }}

            document.getElementById('summaryText').textContent =
                `Approved: ${{approved}} | Denied: ${{denied}} | Skipped: ${{emotes.length - approved - denied}}`;

            if (denied === 0) {{
                document.getElementById('finishBtn').textContent = 'Close';
            }}

            document.getElementById('results').style.display = 'block';
        }}

        async function finishReview() {{
            const btn = document.getElementById('finishBtn');
            const statusDiv = document.getElementById('deleteStatus');

            const approvedNames = [];
            const deniedFiles = [];
            for (const [idx, decision] of Object.entries(decisions)) {{
                if (decision === 'approve') {{
                    approvedNames.push(emotes[idx].name);
                }} else if (decision === 'deny') {{
                    deniedFiles.push(emotes[idx].seasonalPath);
                }}
            }}

            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {{
                const response = await fetch('http://localhost:{PORT}/finish', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ approved: approvedNames, delete: deniedFiles }})
                }});

                const result = await response.json();

                statusDiv.style.display = 'block';
                if (result.success) {{
                    statusDiv.className = 'delete-status success';
                    let msg = [];
                    if (result.approvedSaved > 0) msg.push(`${{result.approvedSaved}} approved`);
                    if (result.deleted > 0) msg.push(`${{result.deleted}} deleted`);
                    statusDiv.textContent = msg.length > 0 ? msg.join(', ') : 'Done!';
                    btn.textContent = 'Close';
                    btn.disabled = false;
                    btn.onclick = async () => {{
                        await fetch('http://localhost:{PORT}/shutdown');
                        window.close();
                    }};
                }} else {{
                    statusDiv.className = 'delete-status error';
                    statusDiv.textContent = `Error: ${{result.error}}`;
                    btn.textContent = 'Close';
                    btn.disabled = false;
                }}
            }} catch (e) {{
                statusDiv.style.display = 'block';
                statusDiv.className = 'delete-status error';
                statusDiv.textContent = `Error: ${{e.message}}`;
                btn.textContent = 'Close';
                btn.disabled = false;
            }}
        }}

        document.addEventListener('keydown', (e) => {{
            if (document.getElementById('results').style.display === 'block') return;

            switch(e.key.toLowerCase()) {{
                case 'a':
                case 'enter':
                    decide('approve');
                    break;
                case 'd':
                    decide('deny');
                    break;
                case 's':
                    decide('skip');
                    break;
                case 'arrowleft':
                    goBack();
                    break;
            }}
        }});

        updateDisplay();
    </script>
</body>
</html>'''


class ReviewHandler(BaseHTTPRequestHandler):
    repoPath = None
    htmlContent = None
    seasonalFolder = None

    def log_message(self, format, *args):
        pass  # Suppress logging

    def do_GET(self):
        if self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            self.wfile.write(ReviewHandler.htmlContent.encode('utf-8'))

        elif self.path.startswith('/file/'):
            filePath = unquote(self.path[6:])
            try:
                with open(filePath, 'rb') as f:
                    data = f.read()

                ext = Path(filePath).suffix.lower()
                contentTypes = {
                    '.gif': 'image/gif',
                    '.png': 'image/png',
                    '.webp': 'image/webp',
                    '.avif': 'image/avif'
                }

                self.send_response(200)
                self.send_header('Content-Type', contentTypes.get(ext, 'application/octet-stream'))
                self.send_header('Cache-Control', 'no-cache')
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                self.send_response(404)
                self.end_headers()

        elif self.path == '/shutdown':
            self.send_response(200)
            self.end_headers()
            threading.Thread(target=self.server.shutdown).start()

        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        contentLength = int(self.headers['Content-Length'])
        postData = self.rfile.read(contentLength)

        if self.path == '/finish':
            try:
                data = json.loads(postData)
                approvedNames = data.get('approved', [])
                filesToDelete = data.get('delete', [])

                # Save approved emotes
                if approvedNames and ReviewHandler.seasonalFolder:
                    saveApprovedEmotes(ReviewHandler.seasonalFolder, approvedNames)

                # Delete denied files
                deleted = 0
                for filePath in filesToDelete:
                    try:
                        Path(filePath).unlink()
                        deleted += 1
                    except Exception as e:
                        print(f"  Failed to delete {filePath}: {e}")

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'deleted': deleted,
                    'approvedSaved': len(approvedNames)
                }).encode())

            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()


def main():
    repoPath = Path(__file__).parent.parent.resolve()
    seasonalDir = repoPath / "Seasonal"

    print("=" * 60)
    print("Seasonal Emote Reviewer")
    print("=" * 60)
    print()

    if seasonalDir.exists():
        folders = [f.name for f in seasonalDir.iterdir() if f.is_dir()]
        if folders:
            print("Available folders:")
            for folder in sorted(folders):
                count = len(getEmotesInFolder(seasonalDir / folder))
                print(f"  - {folder} ({count} emotes)")
            print()

    tag = input("Enter the tag folder to review (e.g., Christmas): ").strip()
    if not tag:
        print("No tag entered. Exiting.")
        return

    folder = seasonalDir / tag
    if not folder.exists():
        print(f"Folder not found: {folder}")
        return

    # Load already-approved emotes
    alreadyApproved = loadApprovedEmotes(folder)
    if alreadyApproved:
        print(f"Found {len(alreadyApproved)} already-approved emotes (will skip).")

    emotes = getEmotesInFolder(folder)
    if not emotes:
        print("No emotes found in folder.")
        return

    # Filter out already-approved emotes
    emotes = [e for e in emotes if e.stem not in alreadyApproved]

    if not emotes:
        print("All emotes have already been reviewed.")
        return

    print(f"Found {len(emotes)} emotes to review.")

    emoteData = []
    for emotePath in emotes:
        emoteName = emotePath.stem
        originalPath = findOriginalEmote(repoPath, emoteName)

        emoteData.append({
            "name": emoteName,
            "seasonalPath": str(emotePath.absolute()).replace("\\", "/"),
            "originalPath": str(originalPath.absolute()).replace("\\", "/") if originalPath else None
        })

    ReviewHandler.repoPath = repoPath
    ReviewHandler.seasonalFolder = folder
    ReviewHandler.htmlContent = generateHtml(emoteData, tag, repoPath)

    server = HTTPServer(('localhost', PORT), ReviewHandler)

    print(f"Starting review server at http://localhost:{PORT}")
    print("Opening browser...")
    print()
    print("(Close the browser tab or click 'Close' when done)")

    webbrowser.open(f'http://localhost:{PORT}')

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass

    server.server_close()
    print("\nReview complete!")


if __name__ == "__main__":
    main()
