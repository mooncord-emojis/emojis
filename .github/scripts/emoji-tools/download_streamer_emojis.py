#!/usr/bin/env python3
"""
Download emojis for a Twitch streamer from 7TV, BetterTTV, and Twitch.
"""

import json
import time
from pathlib import Path

from emoji_utils import (
    downloadFile,
    sanitizeFilename,
    isZeroWidthName,
    lookupTwitchUser,
    deriveEmojiPrefix,
    get7TVUserEmojis,
    getBTTVUserEmojis,
    getTwitchChannelEmojis,
    get7TVEmojiDownloadUrl,
    getBTTVDownloadUrl,
    getTwitchDownloadUrl,
    printBanner,
    printSeparator,
)


def loadReviewedEmojiNames(repoPath: Path) -> set[str]:
    """
    Load emoji names from reviewed-files.json.
    Returns a set of lowercase emoji names (without extensions).
    """
    reviewedPath = repoPath / ".github" / "reviewed-files.json"

    if not reviewedPath.exists():
        return set()

    data = json.loads(reviewedPath.read_text())
    names = set()

    for filePath in data.get("files", []):
        filename = filePath.split("/")[-1]
        name = filename.rsplit(".", 1)[0].lower()
        names.add(name)

    return names


def downloadAllEmojis(
    emojis: list[dict],
    getUrlFunc,
    existingNames: set[str],
    emojiPrefix: str | None,
    streamerFolder: Path,
    animatedFolder: Path,
    staticFolder: Path,
    zeroWidthFolder: Path,
    platformName: str
) -> tuple[int, int, int, int]:
    """
    Download emojis, sorting them into the appropriate folder.
    Returns (downloaded, skipped, failed, toStreamerFolder).
    """
    downloaded = 0
    skipped = 0
    failed = 0
    toStreamerFolder = 0

    prefixLower = emojiPrefix.lower() if emojiPrefix else None

    for emoji in emojis:
        name = emoji.get("name", "")
        safeName = sanitizeFilename(name).lower()

        if not safeName:
            print("    Skipping: Empty name after sanitization")
            failed += 1
            continue

        if safeName in existingNames:
            skipped += 1
            continue

        urlInfo = getUrlFunc(emoji)
        if not urlInfo:
            print(f"    Skipping {name}: No download URL")
            failed += 1
            continue

        url, ext = urlInfo
        isAnimated = emoji.get("animated", False)

        hasPrefix = prefixLower and safeName.startswith(prefixLower)
        isZeroWidth = isZeroWidthName(safeName)

        if isZeroWidth:
            outputDir = zeroWidthFolder
        elif hasPrefix:
            outputDir = streamerFolder
            toStreamerFolder += 1
        elif isAnimated:
            outputDir = animatedFolder
        else:
            outputDir = staticFolder

        destPath = outputDir / f"{safeName}{ext}"

        print(f"    [{platformName}] {safeName}{ext} -> {outputDir.name}/")
        if downloadFile(url, destPath):
            downloaded += 1
            existingNames.add(safeName)
        else:
            failed += 1

        time.sleep(0.05)

    return (downloaded, skipped, failed, toStreamerFolder)


def main():
    repoPath = Path(__file__).resolve().parent.parent.parent.parent
    staticFolder = repoPath / "Static"
    animatedFolder = repoPath / "Animated"
    zeroWidthFolder = repoPath / "Zero Width"

    printBanner("Streamer Emoji Downloader", "Downloads from: 7TV, BetterTTV, Twitch")

    username = input("Enter streamer username: ").strip()
    if not username:
        print("No username entered. Exiting.")
        return

    print()
    print(f"Looking up '{username}'...")
    printSeparator()

    twitchUserId, twitchUsername, emojiPrefix = lookupTwitchUser(username)
    if twitchUserId:
        print(f"  Found Twitch ID: {twitchUserId}")
        print(f"  Twitch username: {twitchUsername}")
        if emojiPrefix:
            print(f"  Emoji prefix: {emojiPrefix}")
    else:
        print("  Error: Could not find user on Twitch")
        print("  Make sure the username is correct.")
        return

    print()
    print("Fetching emojis from each platform...")
    printSeparator()

    emojis7TV = get7TVUserEmojis(twitchUserId)
    emojisBTTV = getBTTVUserEmojis(twitchUserId)
    emojisTwitch = getTwitchChannelEmojis(twitchUsername)

    totalFound = len(emojis7TV) + len(emojisBTTV) + len(emojisTwitch)

    if totalFound == 0:
        print()
        print("No emojis found for this user on any platform.")
        return

    print()
    print(f"Total emojis found: {totalFound}")

    if not emojiPrefix:
        emojiPrefix = deriveEmojiPrefix(emojisTwitch)
        if emojiPrefix:
            print(f"Derived emoji prefix: {emojiPrefix}")
        else:
            print("Could not detect emoji prefix")

    print()
    print("Loading reviewed emojis from .github/reviewed-files.json...")
    existingNames = loadReviewedEmojiNames(repoPath)
    print(f"Found {len(existingNames)} reviewed emoji names.")
    print()

    streamerFolder = staticFolder / twitchUsername.upper()

    print("Folder routing:")
    print(f"  Zero width (*00) -> {zeroWidthFolder.relative_to(repoPath)}")
    print(f"  Prefix matches ({emojiPrefix}*) -> {streamerFolder.relative_to(repoPath)}")
    print(f"  Animated (no prefix) -> {animatedFolder.relative_to(repoPath)}")
    print(f"  Static (no prefix) -> {staticFolder.relative_to(repoPath)}")
    print()

    totalDownloaded = 0
    totalFailed = 0
    totalSkipped = 0
    totalToStreamer = 0

    allEmojis = [
        (emojis7TV, get7TVEmojiDownloadUrl, "7TV"),
        (emojisBTTV, getBTTVDownloadUrl, "BTTV"),
        (emojisTwitch, getTwitchDownloadUrl, "Twitch"),
    ]

    print("Downloading emojis...")
    printSeparator()

    for emojis, getUrlFunc, platformName in allEmojis:
        if not emojis:
            continue

        downloaded, skipped, failed, toStreamer = downloadAllEmojis(
            emojis,
            getUrlFunc,
            existingNames,
            emojiPrefix,
            streamerFolder,
            animatedFolder,
            staticFolder,
            zeroWidthFolder,
            platformName
        )

        totalDownloaded += downloaded
        totalSkipped += skipped
        totalFailed += failed
        totalToStreamer += toStreamer

    print()
    printBanner("Download complete!")
    print(f"  Downloaded: {totalDownloaded}")
    print(f"  Skipped (existing): {totalSkipped}")
    print(f"  Failed: {totalFailed}")
    print(f"  To streamer folder: {totalToStreamer}")
    print(f"  To Animated/Static: {totalDownloaded - totalToStreamer}")


if __name__ == "__main__":
    main()
