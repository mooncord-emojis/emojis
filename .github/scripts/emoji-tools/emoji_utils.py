#!/usr/bin/env python3
"""
Shared utilities for emoji download and management scripts.
"""

import os
import time
import requests
from pathlib import Path


EMOJI_EXTENSIONS = {".gif", ".png", ".webp", ".avif"}
DEFAULT_EXCLUDE_DIRS = {".git", ".github", ".claude", ".vscode", "worker"}
INVALID_FILENAME_CHARS = '<>:"/\\|?*'

SEVENTV_API = "https://7tv.io/v3"
SEVENTV_GQL = "https://7tv.io/v3/gql"
BTTV_API = "https://api.betterttv.net/3"
IVR_API = "https://api.ivr.fi/v2"


def sanitizeFilename(name: str) -> str:
    """Remove characters that are invalid in Windows filenames."""
    for char in INVALID_FILENAME_CHARS:
        name = name.replace(char, "")
    return name


def getRepoEmojiNames(repoPath: Path, excludeDirs: set[str] = None, lowercase: bool = True) -> set[str]:
    """
    Find all unique emoji names in the repository.

    Args:
        repoPath: Root path of the repository
        excludeDirs: Directories to skip (defaults to DEFAULT_EXCLUDE_DIRS)
        lowercase: Whether to lowercase the names (default True)

    Returns:
        Set of emoji names (without extensions)
    """
    if excludeDirs is None:
        excludeDirs = DEFAULT_EXCLUDE_DIRS.copy()

    names = set()

    for root, dirs, files in os.walk(repoPath):
        dirs[:] = [d for d in dirs if d not in excludeDirs]

        for filename in files:
            ext = Path(filename).suffix.lower()
            if ext in EMOJI_EXTENSIONS:
                name = Path(filename).stem
                if lowercase:
                    name = name.lower()
                names.add(name)

    return names


def downloadFile(url: str, destPath: Path, timeout: int = 30) -> bool:
    """
    Download a file from a URL to the specified path.

    Args:
        url: URL to download from
        destPath: Destination file path
        timeout: Request timeout in seconds

    Returns:
        True if successful, False otherwise
    """
    try:
        response = requests.get(url, timeout=timeout)
        response.raise_for_status()

        destPath.parent.mkdir(parents=True, exist_ok=True)
        destPath.write_bytes(response.content)
        return True
    except requests.RequestException as e:
        print(f"  Error downloading: {e}")
        return False


def get7TVFormatPriority(isAnimated: bool) -> list[str]:
    """Get format priority order for 7TV emojis based on animation status."""
    if isAnimated:
        return ["GIF", "WEBP", "AVIF", "PNG"]
    return ["PNG", "WEBP", "AVIF", "GIF"]


def pickBest7TVFile(files: list[dict], isAnimated: bool) -> tuple[str, str] | None:
    """
    Pick the best file from a 7TV emoji's file list.

    Args:
        files: List of file dicts from 7TV API
        isAnimated: Whether the emoji is animated

    Returns:
        (filename, extension) or None if no suitable file
    """
    if not files:
        return None

    formatPriority = get7TVFormatPriority(isAnimated)

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
            return (fileName, extension)

    return None


def build7TVDownloadUrl(baseUrl: str, files: list[dict], isAnimated: bool) -> tuple[str, str] | None:
    """
    Build a download URL for a 7TV emoji.

    Args:
        baseUrl: Base URL from the emoji's host
        files: List of file dicts
        isAnimated: Whether the emoji is animated

    Returns:
        (full_url, extension) or None
    """
    if not baseUrl or not files:
        return None

    if not baseUrl.startswith("http"):
        baseUrl = "https:" + baseUrl

    result = pickBest7TVFile(files, isAnimated)
    if not result:
        return None

    fileName, extension = result
    return (f"{baseUrl}/{fileName}", extension)


def isZeroWidthName(name: str) -> bool:
    """
    Check if name ends with non-digit + '00' (e.g., 'wide00' but not 'wide100').
    These are typically zero-width emojis.
    """
    if len(name) < 3:
        return False
    return name.endswith("00") and not name[-3].isdigit()


def getEmojisInFolder(folder: Path, extensions: set[str] = None) -> list[Path]:
    """
    Get all emoji files in a folder.

    Args:
        folder: Folder to scan
        extensions: File extensions to include (defaults to EMOJI_EXTENSIONS)

    Returns:
        Sorted list of emoji file paths
    """
    if extensions is None:
        extensions = EMOJI_EXTENSIONS

    emojis = []

    if not folder.exists():
        return emojis

    for f in sorted(folder.iterdir()):
        if f.is_file() and f.suffix.lower() in extensions:
            emojis.append(f)

    return emojis


def lookupTwitchUser(username: str) -> tuple[str | None, str | None, str | None]:
    """
    Look up a Twitch user by username using ivr.fi API.

    Args:
        username: Twitch username

    Returns:
        (twitchId, displayName, emojiPrefix) or (None, None, None) if not found
    """
    try:
        response = requests.get(
            f"{IVR_API}/twitch/user?login={username.lower()}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30
        )

        if response.status_code != 200:
            return (None, None, None)

        data = response.json()

        if not data or len(data) == 0:
            return (None, None, None)

        user = data[0]
        userId = user.get("id")
        displayName = user.get("displayName")
        emojiPrefix = user.get("emotePrefix")

        return (userId, displayName, emojiPrefix)

    except requests.RequestException as e:
        print(f"  Error looking up user: {e}")

    return (None, None, None)


def search7TVEmojis(emojiName: str, limit: int = 50) -> list[dict]:
    """
    Search 7TV for emojis matching the given name.

    Args:
        emojiName: Name to search for
        limit: Max number of results

    Returns:
        List of emoji dicts from 7TV
    """
    query = """
    query SearchEmotes($query: String!, $limit: Int) {
        emotes(query: $query, limit: $limit) {
            items {
                id
                name
                tags
                animated
                host {
                    url
                    files {
                        name
                        format
                        width
                        height
                    }
                }
            }
        }
    }
    """

    payload = {
        "query": query,
        "variables": {
            "query": emojiName,
            "limit": limit
        }
    }

    try:
        response = requests.post(SEVENTV_GQL, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()

        if "data" in data and "emotes" in data["data"]:
            return data["data"]["emotes"]["items"]
    except requests.RequestException as e:
        print(f"  Error searching for '{emojiName}': {e}")

    return []


def filterEmojisByTag(emojis: list[dict], tag: str) -> list[dict]:
    """Filter emojis that have the specified tag (case-insensitive)."""
    tagLower = tag.lower()
    matching = []

    for emoji in emojis:
        emojiTags = [t.lower() for t in emoji.get("tags", [])]
        if tagLower in emojiTags:
            matching.append(emoji)

    return matching


def filterEmojisByExactName(emojis: list[dict], name: str) -> list[dict]:
    """Filter emojis that exactly match the name (case-insensitive)."""
    nameLower = name.lower()
    return [e for e in emojis if e.get("name", "").lower() == nameLower]


def get7TVUserEmojis(twitchId: str) -> list[dict]:
    """
    Get emojis enabled for a user on 7TV using their Twitch ID.

    Args:
        twitchId: Twitch user ID

    Returns:
        List of emoji dicts with id, name, animated, baseUrl, files
    """
    emojis = []

    try:
        response = requests.get(
            f"{SEVENTV_API}/users/twitch/{twitchId}",
            timeout=30
        )

        if response.status_code != 200:
            print("  7TV: User not found")
            return emojis

        data = response.json()
        emojiSet = data.get("emote_set", {})
        emojiList = emojiSet.get("emotes", [])

        for emoji in emojiList:
            emojiData = emoji.get("data", {})
            host = emojiData.get("host", {})

            emojiInfo = {
                "id": emoji.get("id"),
                "name": emoji.get("name"),
                "animated": emojiData.get("animated", False),
                "baseUrl": host.get("url", ""),
                "files": host.get("files", [])
            }
            emojis.append(emojiInfo)

        print(f"  7TV: Found {len(emojis)} emojis")

    except requests.RequestException as e:
        print(f"  7TV Error: {e}")

    return emojis


def getBTTVUserEmojis(twitchUserId: str) -> list[dict]:
    """
    Get emojis enabled for a user on BetterTTV.

    Args:
        twitchUserId: Twitch user ID

    Returns:
        List of emoji dicts with id, name, animated
    """
    emojis = []

    try:
        response = requests.get(
            f"{BTTV_API}/cached/users/twitch/{twitchUserId}",
            timeout=30
        )

        if response.status_code != 200:
            print("  BTTV: User not found")
            return emojis

        data = response.json()

        channelEmojis = data.get("channelEmotes", [])
        sharedEmojis = data.get("sharedEmotes", [])

        for emoji in channelEmojis + sharedEmojis:
            emojiInfo = {
                "id": emoji.get("id"),
                "name": emoji.get("code"),
                "animated": emoji.get("animated", False) or emoji.get("imageType") == "gif"
            }
            emojis.append(emojiInfo)

        print(f"  BTTV: Found {len(emojis)} emojis ({len(channelEmojis)} channel, {len(sharedEmojis)} shared)")

    except requests.RequestException as e:
        print(f"  BTTV Error: {e}")

    return emojis


def getTwitchChannelEmojis(username: str) -> list[dict]:
    """
    Get Twitch native emojis for a channel.

    Args:
        username: Twitch username

    Returns:
        List of emoji dicts with id, name, animated
    """
    emojis = []

    try:
        response = requests.get(
            f"{IVR_API}/twitch/emotes/channel/{username}",
            headers={"User-Agent": "Mozilla/5.0"},
            timeout=30
        )

        if response.status_code != 200:
            print("  Twitch: Could not fetch emojis")
            return emojis

        data = response.json()

        for product in data.get("subProducts", []):
            for emoji in product.get("emotes", []):
                isAnimated = emoji.get("assetType") == "ANIMATED"
                emojiInfo = {
                    "id": emoji.get("id"),
                    "name": emoji.get("code"),
                    "animated": isAnimated
                }
                emojis.append(emojiInfo)

        followerEmoji = data.get("followerEmote")
        if followerEmoji:
            isAnimated = followerEmoji.get("assetType") == "ANIMATED"
            emojiInfo = {
                "id": followerEmoji.get("id"),
                "name": followerEmoji.get("code"),
                "animated": isAnimated
            }
            emojis.append(emojiInfo)

        print(f"  Twitch: Found {len(emojis)} emojis")

    except requests.RequestException as e:
        print(f"  Twitch Error: {e}")

    return emojis


def getBTTVDownloadUrl(emoji: dict) -> tuple[str, str] | None:
    """Get download URL for a BTTV emoji."""
    emojiId = emoji.get("id")
    isAnimated = emoji.get("animated", False)

    if not emojiId:
        return None

    extension = ".gif" if isAnimated else ".png"
    url = f"https://cdn.betterttv.net/emote/{emojiId}/3x.{extension[1:]}"

    return (url, extension)


def getTwitchDownloadUrl(emoji: dict) -> tuple[str, str] | None:
    """Get download URL for a Twitch emoji."""
    emojiId = emoji.get("id")
    isAnimated = emoji.get("animated", False)

    if not emojiId:
        return None

    if isAnimated:
        url = f"https://static-cdn.jtvnw.net/emoticons/v2/{emojiId}/animated/dark/3.0"
        extension = ".gif"
    else:
        url = f"https://static-cdn.jtvnw.net/emoticons/v2/{emojiId}/static/dark/3.0"
        extension = ".png"

    return (url, extension)


def get7TVEmojiDownloadUrl(emoji: dict) -> tuple[str, str] | None:
    """Get download URL for a 7TV user emoji (uses baseUrl/files structure)."""
    baseUrl = emoji.get("baseUrl", "")
    files = emoji.get("files", [])
    isAnimated = emoji.get("animated", False)

    return build7TVDownloadUrl(baseUrl, files, isAnimated)


def get7TVSearchEmojiDownloadUrl(emoji: dict) -> tuple[str, str] | None:
    """Get download URL for a 7TV search result emoji (uses host structure)."""
    host = emoji.get("host", {})
    baseUrl = host.get("url", "")
    files = host.get("files", [])
    isAnimated = emoji.get("animated", False)

    return build7TVDownloadUrl(baseUrl, files, isAnimated)


def deriveEmojiPrefix(twitchEmojis: list[dict]) -> str | None:
    """Derive the common emoji prefix from Twitch emojis."""
    codes = [e.get("name", "") for e in twitchEmojis if e.get("name")]

    if not codes:
        return None

    prefix = codes[0]
    for code in codes[1:]:
        while prefix and not code.lower().startswith(prefix.lower()):
            prefix = prefix[:-1]

    if len(prefix) < 2:
        return None

    return prefix


def printBanner(title: str, subtitle: str = None):
    """Print a formatted banner for scripts."""
    print("=" * 60)
    print(title)
    if subtitle:
        print(subtitle)
    print("=" * 60)
    print()


def printSeparator():
    """Print a separator line."""
    print("-" * 60)


def printProgress(current: int, total: int, message: str = ""):
    """Print a progress indicator like [5/100] message."""
    import sys
    line = f"  [{current}/{total}] {message}"
    sys.stdout.write(f"\r{line:<70}")
    sys.stdout.flush()
    if current >= total:
        print()
