#!/usr/bin/env python3
"""
Download emotes for a Twitch streamer from 7TV, BetterTTV, and Twitch.
"""

import os
import sys
import time
import requests
from pathlib import Path


SEVENTV_API = "https://7tv.io/v3"
SEVENTV_GQL = "https://7tv.io/v3/gql"
BTTV_API = "https://api.betterttv.net/3"

SEARCH_USERS_QUERY = """
query SearchUsers($query: String!) {
    users(query: $query) {
        id
        username
        connections {
            id
            platform
            username
        }
    }
}
"""

INVALID_FILENAME_CHARS = '<>:"/\\|?*'


def sanitizeFilename(name: str) -> str:
    """Remove characters that are invalid in Windows filenames."""
    for char in INVALID_FILENAME_CHARS:
        name = name.replace(char, "")
    return name


def getRepoEmoteNames(repoPath: Path) -> set[str]:
    """Find all unique emote names in the repository."""
    extensions = {".gif", ".png", ".webp", ".avif"}
    excludeDirs = {".git", ".github", ".claude", ".vscode", "worker"}
    names = set()

    for root, dirs, files in os.walk(repoPath):
        dirs[:] = [d for d in dirs if d not in excludeDirs]

        for filename in files:
            ext = Path(filename).suffix.lower()
            if ext in extensions:
                name = Path(filename).stem
                names.add(name.lower())

    return names


def searchUser7TV(username: str) -> tuple[str | None, str | None]:
    """
    Search for a user on 7TV by username.
    Returns (twitchId, twitchUsername) or (None, None) if not found.
    """
    try:
        response = requests.post(
            SEVENTV_GQL,
            json={
                "query": SEARCH_USERS_QUERY,
                "variables": {"query": username}
            },
            timeout=30
        )

        if response.status_code != 200:
            return (None, None)

        data = response.json()
        users = data.get("data", {}).get("users", [])

        for user in users:
            connections = user.get("connections", [])
            for conn in connections:
                if conn.get("platform") == "TWITCH":
                    connUsername = conn.get("username", "").lower()
                    if connUsername == username.lower():
                        return (conn.get("id"), conn.get("username"))

        if users:
            for conn in users[0].get("connections", []):
                if conn.get("platform") == "TWITCH":
                    return (conn.get("id"), conn.get("username"))

    except requests.RequestException as e:
        print(f"  Error searching for user: {e}")

    return (None, None)


def get7TVEmotes(twitchId: str) -> list[dict]:
    """Get emotes enabled for a user on 7TV using their Twitch ID."""
    emotes = []

    try:
        response = requests.get(
            f"{SEVENTV_API}/users/twitch/{twitchId}",
            timeout=30
        )

        if response.status_code != 200:
            print(f"  7TV: User not found")
            return emotes

        data = response.json()
        emoteSet = data.get("emote_set", {})
        emoteList = emoteSet.get("emotes", [])

        for emote in emoteList:
            emoteData = emote.get("data", {})
            host = emoteData.get("host", {})

            emoteInfo = {
                "id": emote.get("id"),
                "name": emote.get("name"),
                "animated": emoteData.get("animated", False),
                "baseUrl": host.get("url", ""),
                "files": host.get("files", [])
            }
            emotes.append(emoteInfo)

        print(f"  7TV: Found {len(emotes)} emotes")

    except requests.RequestException as e:
        print(f"  7TV Error: {e}")

    return emotes


def getBTTVEmotes(twitchUserId: str) -> list[dict]:
    """Get emotes enabled for a user on BetterTTV."""
    emotes = []

    try:
        response = requests.get(
            f"{BTTV_API}/cached/users/twitch/{twitchUserId}",
            timeout=30
        )

        if response.status_code != 200:
            print(f"  BTTV: User not found")
            return emotes

        data = response.json()

        channelEmotes = data.get("channelEmotes", [])
        sharedEmotes = data.get("sharedEmotes", [])

        for emote in channelEmotes + sharedEmotes:
            emoteInfo = {
                "id": emote.get("id"),
                "name": emote.get("code"),
                "animated": emote.get("animated", False) or emote.get("imageType") == "gif"
            }
            emotes.append(emoteInfo)

        print(f"  BTTV: Found {len(emotes)} emotes ({len(channelEmotes)} channel, {len(sharedEmotes)} shared)")

    except requests.RequestException as e:
        print(f"  BTTV Error: {e}")

    return emotes


def getTwitchEmotes(twitchUserId: str, username: str) -> list[dict]:
    """
    Get Twitch native emotes for a channel.
    Note: This uses an unofficial endpoint and may not work for all channels.
    """
    emotes = []

    try:
        response = requests.get(
            f"https://api.ivr.fi/v2/twitch/emotes/channel/{username}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30
        )

        if response.status_code != 200:
            print("  Twitch: Could not fetch emotes")
            return emotes

        data = response.json()

        for product in data.get("subProducts", []):
            for emote in product.get("emotes", []):
                isAnimated = emote.get("assetType") == "ANIMATED"
                emoteInfo = {
                    "id": emote.get("id"),
                    "name": emote.get("code"),
                    "animated": isAnimated
                }
                emotes.append(emoteInfo)

        followerEmote = data.get("followerEmote")
        if followerEmote:
            isAnimated = followerEmote.get("assetType") == "ANIMATED"
            emoteInfo = {
                "id": followerEmote.get("id"),
                "name": followerEmote.get("code"),
                "animated": isAnimated
            }
            emotes.append(emoteInfo)

        print(f"  Twitch: Found {len(emotes)} emotes")

    except requests.RequestException as e:
        print(f"  Twitch Error: {e}")

    return emotes


def get7TVDownloadUrl(emote: dict) -> tuple[str, str] | None:
    """Get download URL for a 7TV emote."""
    baseUrl = emote.get("baseUrl", "")
    files = emote.get("files", [])
    isAnimated = emote.get("animated", False)

    if not baseUrl or not files:
        return None

    if not baseUrl.startswith("http"):
        baseUrl = "https:" + baseUrl

    formatPriority = ["GIF", "WEBP", "AVIF", "PNG"] if isAnimated else ["PNG", "WEBP", "AVIF", "GIF"]

    formatFiles = {}
    for f in files:
        fmt = f.get("format", "")
        width = f.get("width", 0)
        if fmt not in formatFiles or width > formatFiles[fmt].get("width", 0):
            formatFiles[fmt] = f

    for fmt in formatPriority:
        if fmt in formatFiles:
            fileName = formatFiles[fmt]["name"]
            extension = "." + fmt.lower()
            return (f"{baseUrl}/{fileName}", extension)

    return None


def getBTTVDownloadUrl(emote: dict) -> tuple[str, str] | None:
    """Get download URL for a BTTV emote."""
    emoteId = emote.get("id")
    isAnimated = emote.get("animated", False)

    if not emoteId:
        return None

    extension = ".gif" if isAnimated else ".png"
    url = f"https://cdn.betterttv.net/emote/{emoteId}/3x.{extension[1:]}"

    return (url, extension)


def getTwitchDownloadUrl(emote: dict) -> tuple[str, str] | None:
    """Get download URL for a Twitch emote."""
    emoteId = emote.get("id")
    isAnimated = emote.get("animated", False)

    if not emoteId:
        return None

    if isAnimated:
        url = f"https://static-cdn.jtvnw.net/emoticons/v2/{emoteId}/animated/dark/3.0"
        extension = ".gif"
    else:
        url = f"https://static-cdn.jtvnw.net/emoticons/v2/{emoteId}/static/dark/3.0"
        extension = ".png"

    return (url, extension)


def downloadEmote(url: str, destPath: Path) -> bool:
    """Download an emote to the specified path."""
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        destPath.parent.mkdir(parents=True, exist_ok=True)
        destPath.write_bytes(response.content)
        return True
    except requests.RequestException as e:
        print(f"    Error downloading: {e}")
        return False


def downloadPlatformEmotes(
    emotes: list[dict],
    outputDir: Path,
    existingNames: set[str],
    getUrlFunc,
    platformName: str
) -> tuple[int, int]:
    """Download emotes for a platform, skipping existing ones."""
    downloaded = 0
    skipped = 0
    failed = 0

    for emote in emotes:
        name = emote.get("name", "")
        nameLower = name.lower()

        if nameLower in existingNames:
            skipped += 1
            continue

        urlInfo = getUrlFunc(emote)
        if not urlInfo:
            print(f"    Skipping {name}: No download URL")
            failed += 1
            continue

        url, ext = urlInfo
        safeName = sanitizeFilename(name)
        destPath = outputDir / f"{safeName}{ext}"

        print(f"    Downloading: {safeName}{ext}")
        if downloadEmote(url, destPath):
            downloaded += 1
            existingNames.add(nameLower)
        else:
            failed += 1

        time.sleep(0.05)

    print(f"  {platformName}: Downloaded {downloaded}, Skipped {skipped} existing, Failed {failed}")
    return (downloaded, failed)


def main():
    repoPath = Path(__file__).resolve().parent.parent.parent
    staticPath = repoPath / "Static"

    print("=" * 60)
    print("Streamer Emote Downloader")
    print("Downloads from: 7TV, BetterTTV, Twitch")
    print("=" * 60)
    print()

    username = input("Enter streamer username: ").strip()
    if not username:
        print("No username entered. Exiting.")
        return

    print()
    print(f"Looking up '{username}'...")
    print("-" * 60)

    twitchUserId, twitchUsername = searchUser7TV(username)
    if twitchUserId:
        print(f"  Found Twitch ID: {twitchUserId}")
        print(f"  Twitch username: {twitchUsername}")
    else:
        print("  Error: Could not find user on 7TV")
        print("  Make sure the username is correct and they have a 7TV account.")
        return

    print()
    print("Fetching emotes from each platform...")
    print("-" * 60)

    emotes7TV = get7TVEmotes(twitchUserId)
    emotesBTTV = getBTTVEmotes(twitchUserId)
    emotesTwitch = getTwitchEmotes(twitchUserId, twitchUsername)

    totalFound = len(emotes7TV) + len(emotesBTTV) + len(emotesTwitch)

    if totalFound == 0:
        print()
        print("No emotes found for this user on any platform.")
        return

    print()
    print(f"Total emotes found: {totalFound}")
    print()

    print("Scanning repository for existing emotes...")
    existingNames = getRepoEmoteNames(repoPath)
    print(f"Found {len(existingNames)} unique emote names in repo.")
    print()

    streamerFolder = staticPath / twitchUsername.upper()
    folder7TV = streamerFolder / "7TV"
    folderBTTV = streamerFolder / "BTTV"
    folderTwitch = streamerFolder / "Twitch"

    print(f"Output folder: {streamerFolder}")
    print()

    totalDownloaded = 0
    totalFailed = 0

    if emotes7TV:
        print("Downloading 7TV emotes...")
        downloaded, failed = downloadPlatformEmotes(
            emotes7TV, folder7TV, existingNames, get7TVDownloadUrl, "7TV"
        )
        totalDownloaded += downloaded
        totalFailed += failed
        print()

    if emotesBTTV:
        print("Downloading BTTV emotes...")
        downloaded, failed = downloadPlatformEmotes(
            emotesBTTV, folderBTTV, existingNames, getBTTVDownloadUrl, "BTTV"
        )
        totalDownloaded += downloaded
        totalFailed += failed
        print()

    if emotesTwitch:
        print("Downloading Twitch emotes...")
        downloaded, failed = downloadPlatformEmotes(
            emotesTwitch, folderTwitch, existingNames, getTwitchDownloadUrl, "Twitch"
        )
        totalDownloaded += downloaded
        totalFailed += failed
        print()

    print("=" * 60)
    print("Download complete!")
    print(f"  Total downloaded: {totalDownloaded}")
    print(f"  Total failed: {totalFailed}")
    print(f"  Output: {streamerFolder}")
    print("=" * 60)


if __name__ == "__main__":
    main()
