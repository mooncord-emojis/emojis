#!/usr/bin/env python3
"""
Review interface for seasonal emojis with automatic deletion.
Runs a local server so the browser can delete files directly.
"""

import json
import os
from pathlib import Path

from emoji_utils import EMOJI_EXTENSIONS, getEmojisInFolder, printBanner
from review_utils import (
    getBaseStyles,
    getStatsHtml,
    BaseReviewHandler,
    runReviewServer,
    loadReviewedFiles,
    saveReviewedFiles,
)


PORT = 8754


def findOriginalEmoji(repoPath: Path, emojiName: str) -> Path | None:
    """Find the original emoji in the repo by name."""
    excludeDirs = {".git", ".github", ".claude", ".vscode", "Seasonal", "worker"}

    for root, dirs, files in os.walk(repoPath):
        dirs[:] = [d for d in dirs if d not in excludeDirs]

        for filename in files:
            filePath = Path(root) / filename
            if filePath.stem.lower() == emojiName.lower() and filePath.suffix.lower() in EMOJI_EXTENSIONS:
                return filePath

    return None


def generateHtml(emojiData: list[dict], tag: str, repoPath: Path) -> str:
    """Generate the HTML review interface."""
    emojiDataJson = json.dumps(emojiData)
    repoPathStr = str(repoPath).replace("\\", "/")

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Review {tag} Emojis</title>
    <style>{getBaseStyles()}</style>
</head>
<body>
    <div class="container">
        <h1>Review {tag} Emojis</h1>
        <div class="progress" id="progress">Loading...</div>

        {getStatsHtml(includeRenamed=False)}

        <div class="comparison" id="comparison">
            <div class="emoji-box">
                <h3>Original</h3>
                <img id="originalImg" src="" alt="Original">
                <div class="emoji-path" id="originalPath"></div>
            </div>
            <div class="emoji-box">
                <h3>Seasonal ({tag})</h3>
                <img id="seasonalImg" src="" alt="Seasonal">
                <div class="emoji-path" id="seasonalPath"></div>
            </div>
        </div>

        <div class="emoji-name" id="emojiName"></div>

        <div class="controls" id="controls">
            <button class="approve" onclick="decide('approve')">Approve</button>
            <button class="deny" onclick="decide('deny')">Deny</button>
            <button class="skip" onclick="decide('skip')">Skip</button>
        </div>

        <div class="keyboard-hint">
            <kbd>A</kbd> or <kbd>Enter</kbd> Approve &nbsp;&nbsp;
            <kbd>D</kbd> Deny &nbsp;&nbsp;
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

            document.getElementById('seasonalImg').src = 'http://localhost:{PORT}/file/' + encodeURIComponent(emoji.seasonalPath);
            document.getElementById('seasonalPath').textContent = emoji.seasonalPath.replace(repoPath + '/', '');

            if (emoji.originalPath) {{
                document.getElementById('originalImg').src = 'http://localhost:{PORT}/file/' + encodeURIComponent(emoji.originalPath);
                document.getElementById('originalImg').style.display = 'block';
                document.getElementById('originalPath').textContent = emoji.originalPath.replace(repoPath + '/', '');
                document.getElementById('originalPath').className = 'emoji-path';
            }} else {{
                document.getElementById('originalImg').style.display = 'none';
                document.getElementById('originalPath').textContent = 'Not found in repo';
                document.getElementById('originalPath').className = 'emoji-path no-original';
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
            document.getElementById('emojiName').style.display = 'none';
            document.querySelector('.keyboard-hint').style.display = 'none';
            document.getElementById('progress').textContent = 'Review Complete!';

            let denied = 0, approved = 0;
            for (const d of Object.values(decisions)) {{
                if (d === 'deny') denied++;
                else if (d === 'approve') approved++;
            }}

            document.getElementById('summaryText').textContent =
                `Approved: ${{approved}} | Denied: ${{denied}} | Skipped: ${{emojis.length - approved - denied}}`;

            if (denied === 0) {{
                document.getElementById('finishBtn').textContent = 'Close';
            }}

            document.getElementById('results').style.display = 'block';
        }}

        async function finishReview() {{
            const btn = document.getElementById('finishBtn');
            const statusDiv = document.getElementById('statusMessage');

            const reviewedPaths = [];
            const deniedFiles = [];
            for (const [idx, decision] of Object.entries(decisions)) {{
                if (decision === 'approve') {{
                    reviewedPaths.push(emojis[idx].relativePath);
                }} else if (decision === 'deny') {{
                    deniedFiles.push(emojis[idx].seasonalPath);
                    reviewedPaths.push(emojis[idx].relativePath);
                }}
            }}

            btn.disabled = true;
            btn.textContent = 'Saving...';

            try {{
                const response = await fetch('http://localhost:{PORT}/finish', {{
                    method: 'POST',
                    headers: {{ 'Content-Type': 'application/json' }},
                    body: JSON.stringify({{ reviewed: reviewedPaths, delete: deniedFiles }})
                }});

                const result = await response.json();

                statusDiv.style.display = 'block';
                if (result.success) {{
                    statusDiv.className = 'status-message success';
                    let msg = [];
                    if (result.reviewedSaved > 0) msg.push(`${{result.reviewedSaved}} reviewed`);
                    if (result.deleted > 0) msg.push(`${{result.deleted}} deleted`);
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


class SeasonalReviewHandler(BaseReviewHandler):

    def doPost(self):
        if self.path == '/finish':
            try:
                data = self.readPostData()
                reviewedPaths = data.get('reviewed', [])
                filesToDelete = data.get('delete', [])

                reviewedSaved = 0
                if reviewedPaths:
                    saveReviewedFiles(SeasonalReviewHandler.repoPath, reviewedPaths)
                    reviewedSaved = len(reviewedPaths)

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
    seasonalDir = repoPath / "Seasonal"

    printBanner("Seasonal Emoji Reviewer")

    if seasonalDir.exists():
        folders = [f.name for f in seasonalDir.iterdir() if f.is_dir()]
        if folders:
            print("Available folders:")
            for folder in sorted(folders):
                count = len(getEmojisInFolder(seasonalDir / folder))
                print(f"  - {folder} ({count} emojis)")
            print()

    tag = input("Enter the tag folder to review (e.g., Christmas): ").strip()
    if not tag:
        print("No tag entered. Exiting.")
        return

    folder = seasonalDir / tag
    if not folder.exists():
        print(f"Folder not found: {folder}")
        return

    print("Loading reviewed files from .github/reviewed-files.json...")
    alreadyReviewed = loadReviewedFiles(repoPath)
    print(f"Found {len(alreadyReviewed)} reviewed emoji names.")
    print()

    emojis = getEmojisInFolder(folder)
    if not emojis:
        print("No emojis found in folder.")
        return

    emojis = [e for e in emojis if e.stem.lower() not in alreadyReviewed]

    if not emojis:
        print("All emojis have already been reviewed.")
        return

    print(f"Found {len(emojis)} emojis to review.")

    emojiData = []
    for emojiPath in emojis:
        emojiName = emojiPath.stem
        relativePath = str(emojiPath.relative_to(repoPath)).replace("\\", "/")
        originalPath = findOriginalEmoji(repoPath, emojiName)

        emojiData.append({
            "name": emojiName,
            "relativePath": relativePath,
            "seasonalPath": str(emojiPath.absolute()).replace("\\", "/"),
            "originalPath": str(originalPath.absolute()).replace("\\", "/") if originalPath else None
        })

    htmlContent = generateHtml(emojiData, tag, repoPath)

    runReviewServer(SeasonalReviewHandler, PORT, htmlContent, repoPath)


if __name__ == "__main__":
    main()
