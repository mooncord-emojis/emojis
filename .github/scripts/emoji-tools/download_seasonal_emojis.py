#!/usr/bin/env python3
"""
Download seasonal/tagged emojis from 7TV that match emojis in this repo.
"""

import sys
import time
from pathlib import Path

from emoji_utils import (
    EMOJI_EXTENSIONS,
    getRepoEmojiNames,
    downloadFile,
    search7TVEmojis,
    filterEmojisByTag,
    filterEmojisByExactName,
    get7TVSearchEmojiDownloadUrl,
    printBanner,
    printSeparator,
    printProgress,
)


def main():
    repoPath = Path(__file__).resolve().parent.parent.parent.parent

    printBanner("7TV Seasonal Emoji Downloader")

    tag = input("Enter the tag to search for (e.g., christmas, halloween): ").strip()
    if not tag:
        print("No tag entered. Exiting.")
        return

    limitInput = input("Max emojis to download (leave blank for unlimited): ").strip()
    maxMatches = int(limitInput) if limitInput.isdigit() else None

    outputDir = repoPath / "Seasonal" / tag.capitalize()
    outputDir.mkdir(parents=True, exist_ok=True)

    print(f"\nOutput directory: {outputDir}")
    print()

    existingNames = set()
    for f in outputDir.iterdir():
        if f.is_file() and f.suffix.lower() in EMOJI_EXTENSIONS:
            existingNames.add(f.stem)

    if existingNames:
        print(f"Found {len(existingNames)} emojis already in {tag.capitalize()} folder (will skip).")
        print()

    print("Scanning repository for emoji names...")
    excludeDirs = {".git", ".github", ".claude", ".vscode", "Seasonal", "worker"}
    emojiNames = getRepoEmojiNames(repoPath, excludeDirs, lowercase=False)
    print(f"Found {len(emojiNames)} unique emoji names in the repo.")

    emojiNames = emojiNames - existingNames
    print(f"Searching {len(emojiNames)} emojis (excluding already downloaded).")
    print()

    matchingEmojis = []

    print(f"Searching 7TV for emojis with '{tag}' tag...")
    printSeparator()

    for i, name in enumerate(sorted(emojiNames), 1):
        sys.stdout.write(f"\r[{i}/{len(emojiNames)}] Searching: {name[:30]:<30}")
        sys.stdout.flush()

        results = search7TVEmojis(name)
        exactMatches = filterEmojisByExactName(results, name)
        taggedMatches = filterEmojisByTag(exactMatches, tag)

        if taggedMatches:
            matchingEmojis.append((name, taggedMatches[0]))
            print(f"\r[{i}/{len(emojiNames)}] Found: {name} -> {taggedMatches[0]['name']}")

            if maxMatches and len(matchingEmojis) >= maxMatches:
                print(f"\nReached limit of {maxMatches} matches.")
                break

        time.sleep(0.1)

    print()
    printSeparator()
    print(f"Found {len(matchingEmojis)} matching emojis with '{tag}' tag.")
    print()

    if not matchingEmojis:
        print("No matching emojis found.")
        return

    print("Downloading emojis...")
    printSeparator()

    downloaded = 0
    failed = 0
    total = len(matchingEmojis)

    for i, (name, emoji) in enumerate(matchingEmojis, 1):
        urlInfo = get7TVSearchEmojiDownloadUrl(emoji)
        if not urlInfo:
            printProgress(i, total, f"Skipping: {name} (no URL)")
            failed += 1
            continue

        url, ext = urlInfo
        destPath = outputDir / f"{name}{ext}"

        printProgress(i, total, f"{name}{ext}")
        if downloadFile(url, destPath):
            downloaded += 1
        else:
            failed += 1

        time.sleep(0.1)

    print()
    printBanner("Download complete!")
    print(f"  Downloaded: {downloaded}")
    print(f"  Failed: {failed}")
    print(f"  Output: {outputDir}")


if __name__ == "__main__":
    main()
