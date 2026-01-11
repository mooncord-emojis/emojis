#!/usr/bin/env python3
"""
Review interface for streamer emojis with delete and rename functionality.
Reviews any emoji in the repo that isn't in reviewed-files.json.
Runs a local server so the browser can manage files directly.
"""

import json
import os
from pathlib import Path

from emoji_utils import EMOJI_EXTENSIONS, printBanner
from review_utils import (
    getBaseStyles,
    getStatsHtml,
    getRenameDialogHtml,
    BaseReviewHandler,
    runReviewServer,
    loadReviewedFiles,
    saveReviewedFiles,
)


PORT = 8755


def getAllEmojis(repoPath: Path) -> list[Path]:
    """Get all emoji files in the repository."""
    excludeDirs = {".git", ".github", ".claude", ".vscode", "worker", "Seasonal"}
    emojis = []

    for root, dirs, files in os.walk(repoPath):
        dirs[:] = [d for d in dirs if d not in excludeDirs]

        for filename in files:
            filePath = Path(root) / filename
            if filePath.suffix.lower() in EMOJI_EXTENSIONS:
                emojis.append(filePath)

    return sorted(emojis)


def generateHtml(emojiData: list[dict], repoPath: Path) -> str:
    """Generate the HTML review interface."""
    emojiDataJson = json.dumps(emojiData)
    repoPathStr = str(repoPath).replace("\\", "/")

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Review Emojis</title>
    <style>{getBaseStyles()}</style>
</head>
<body>
    <div class="container">
        <h1>Review Emojis</h1>
        <div class="progress" id="progress">Loading...</div>

        {getStatsHtml(includeRenamed=True)}

        <div class="emoji-display" id="emojiDisplay" style="display: flex; flex-direction: column; align-items: center; margin-bottom: 30px;">
            <div class="emoji-box" style="min-width: 350px; padding: 30px;">
                <img id="emojiImg" src="" alt="Emoji">
                <div class="emoji-name" id="emojiName" style="font-size: 28px;"></div>
                <div class="emoji-path" id="emojiPath" style="margin-top: 10px;"></div>
            </div>
        </div>

        <div class="controls" id="controls">
            <button class="approve" onclick="decide('approve')">Approve</button>
            <button class="deny" onclick="decide('deny')">Deny</button>
            <button class="rename" onclick="showRenameDialog()">Rename</button>
            <button class="skip" onclick="decide('skip')">Skip</button>
        </div>

        <div class="keyboard-hint">
            <kbd>A</kbd> or <kbd>Enter</kbd> Approve &nbsp;&nbsp;
            <kbd>D</kbd> Deny &nbsp;&nbsp;
            <kbd>R</kbd> Rename &nbsp;&nbsp;
            <kbd>S</kbd> Skip &nbsp;&nbsp;
            <kbd>&#8592;</kbd> Go Back
        </div>

        <div class="results" id="results">
            <h2>Review Complete!</h2>
            <p id="summaryText"></p>
            <div class="status-message" id="statusMessage" style="display:none;"></div>
            <button class="finish" id="finishBtn" onclick="finishReview()">Save & Finish</button>
        </div>
    </div>

    {getRenameDialogHtml()}

    <script>
        const emojis = {emojiDataJson};
        const repoPath = "{repoPathStr}";
        let currentIndex = 0;
        let decisions = {{}};

        function updateDisplay() {{
            if (currentIndex >= emojis.length) {{
                showResults();
                return;
            }}

            const emoji = emojis[currentIndex];
            document.getElementById('progress').textContent = `${{currentIndex + 1}} of ${{emojis.length}}`;
            document.getElementById('emojiName').textContent = emoji.name;
            document.getElementById('emojiImg').src = 'http://localhost:{PORT}/file/' + encodeURIComponent(emoji.path);
            document.getElementById('emojiPath').textContent = emoji.relativePath;

            updateStats();
        }}

        function updateStats() {{
            let approved = 0, denied = 0, renamed = 0, skipped = 0;
            for (const d of Object.values(decisions)) {{
                if (d.action === 'approve') approved++;
                else if (d.action === 'deny') denied++;
                else if (d.action === 'rename') renamed++;
                else if (d.action === 'skip') skipped++;
            }}
            document.getElementById('approvedCount').textContent = approved;
            document.getElementById('deniedCount').textContent = denied;
            document.getElementById('renamedCount').textContent = renamed;
            document.getElementById('skippedCount').textContent = skipped;
        }}

        function decide(action, newName = null) {{
            decisions[currentIndex] = {{ action, newName }};
            currentIndex++;
            updateDisplay();
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

        function showResults() {{
            document.getElementById('emojiDisplay').style.display = 'none';
            document.getElementById('controls').style.display = 'none';
            document.querySelector('.keyboard-hint').style.display = 'none';
            document.getElementById('progress').textContent = 'Review Complete!';

            let approved = 0, denied = 0, renamed = 0;
            for (const d of Object.values(decisions)) {{
                if (d.action === 'approve') approved++;
                else if (d.action === 'deny') denied++;
                else if (d.action === 'rename') renamed++;
            }}

            document.getElementById('summaryText').textContent =
                `Approved: ${{approved}} | Denied: ${{denied}} | Renamed: ${{renamed}} | Skipped: ${{emojis.length - approved - denied - renamed}}`;

            if (denied === 0 && renamed === 0 && approved === 0) {{
                document.getElementById('finishBtn').textContent = 'Close';
            }}

            document.getElementById('results').style.display = 'block';
        }}

        async function finishReview() {{
            const btn = document.getElementById('finishBtn');
            const statusDiv = document.getElementById('statusMessage');

            const reviewedFiles = [];
            const deniedFiles = [];
            const renames = [];

            for (const [idx, decision] of Object.entries(decisions)) {{
                const emoji = emojis[idx];
                if (decision.action === 'approve') {{
                    reviewedFiles.push(emoji.relativePath);
                }} else if (decision.action === 'deny') {{
                    deniedFiles.push(emoji.path);
                    reviewedFiles.push(emoji.relativePath);
                }} else if (decision.action === 'rename') {{
                    const dir = emoji.relativePath.substring(0, emoji.relativePath.lastIndexOf('/'));
                    const newRelativePath = dir + '/' + decision.newName + emoji.ext;
                    renames.push({{
                        oldPath: emoji.path,
                        newName: decision.newName,
                        ext: emoji.ext
                    }});
                    reviewedFiles.push(newRelativePath);
                }}
            }}

            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {{
                const response = await fetch('http://localhost:{PORT}/finish', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{
                        reviewed: reviewedFiles,
                        delete: deniedFiles,
                        renames: renames
                    }})
                }});

                const result = await response.json();

                statusDiv.style.display = 'block';
                if (result.success) {{
                    statusDiv.className = 'status-message success';
                    let msg = [];
                    if (result.reviewedSaved > 0) msg.push(`${{result.reviewedSaved}} reviewed`);
                    if (result.deleted > 0) msg.push(`${{result.deleted}} deleted`);
                    if (result.renamed > 0) msg.push(`${{result.renamed}} renamed`);
                    statusDiv.textContent = msg.length > 0 ? msg.join(', ') : 'Done!';
                    btn.textContent = 'Close';
                    btn.disabled = false;
                    btn.onclick = async () => {{
                        await fetch('http://localhost:{PORT}/shutdown');
                        window.close();
                    }};
                }} else {{
                    statusDiv.className = 'status-message error';
                    statusDiv.textContent = `Error: ${{result.error}}`;
                    btn.textContent = 'Close';
                    btn.disabled = false;
                }}
            }} catch (e) {{
                statusDiv.style.display = 'block';
                statusDiv.className = 'status-message error';
                statusDiv.textContent = `Error: ${{e.message}}`;
                btn.textContent = 'Close';
                btn.disabled = false;
            }}
        }}

        document.addEventListener('keydown', (e) => {{
            if (document.getElementById('renameDialog').classList.contains('active')) {{
                if (e.key === 'Escape') {{
                    hideRenameDialog();
                }} else if (e.key === 'Enter') {{
                    confirmRename();
                }}
                return;
            }}

            if (document.getElementById('results').style.display === 'block') return;

            switch(e.key.toLowerCase()) {{
                case 'a':
                case 'enter':
                    decide('approve');
                    break;
                case 'd':
                    decide('deny');
                    break;
                case 'r':
                    showRenameDialog();
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


class StreamerReviewHandler(BaseReviewHandler):

    def doPost(self):
        if self.path == '/finish':
            try:
                data = self.readPostData()
                reviewedFiles = data.get('reviewed', [])
                filesToDelete = data.get('delete', [])
                renames = data.get('renames', [])

                renamed = 0
                for renameInfo in renames:
                    oldPath = Path(renameInfo['oldPath'])
                    newName = renameInfo['newName']
                    ext = renameInfo['ext']
                    newPath = oldPath.parent / f"{newName}{ext}"

                    try:
                        oldPath.rename(newPath)
                        renamed += 1
                    except Exception as e:
                        print(f"  Failed to rename {oldPath} to {newPath}: {e}")

                reviewedSaved = 0
                if reviewedFiles:
                    saveReviewedFiles(StreamerReviewHandler.repoPath, reviewedFiles)
                    reviewedSaved = len(reviewedFiles)

                deleted = 0
                for filePath in filesToDelete:
                    try:
                        Path(filePath).unlink()
                        deleted += 1
                    except Exception as e:
                        print(f"  Failed to delete {filePath}: {e}")

                self.sendJsonResponse({
                    'success': True,
                    'deleted': deleted,
                    'renamed': renamed,
                    'reviewedSaved': reviewedSaved
                })

            except Exception as e:
                self.sendJsonResponse({'success': False, 'error': str(e)}, 500)
        else:
            self.send_response(404)
            self.end_headers()

    do_POST = doPost


def main():
    repoPath = Path(__file__).resolve().parent.parent.parent.parent

    printBanner("Emoji Reviewer")

    print("Loading reviewed files from .github/reviewed-files.json...")
    reviewedEmojis = loadReviewedFiles(repoPath)
    print(f"Found {len(reviewedEmojis)} reviewed emoji names.")
    print()

    print("Scanning repository for emojis...")
    allEmojis = getAllEmojis(repoPath)
    print(f"Found {len(allEmojis)} total emojis in repo.")

    pendingEmojis = [e for e in allEmojis if e.stem.lower() not in reviewedEmojis]

    if not pendingEmojis:
        print("All emojis have already been reviewed.")
        return

    print(f"Found {len(pendingEmojis)} emojis pending review.")
    print()

    emojiData = []
    for emojiPath in pendingEmojis:
        relativePath = str(emojiPath.relative_to(repoPath)).replace("\\", "/")
        emojiData.append({
            "name": emojiPath.stem,
            "path": str(emojiPath.absolute()).replace("\\", "/"),
            "relativePath": relativePath,
            "ext": emojiPath.suffix.lower()
        })

    htmlContent = generateHtml(emojiData, repoPath)

    runReviewServer(StreamerReviewHandler, PORT, htmlContent, repoPath)


if __name__ == "__main__":
    main()
