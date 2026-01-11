#!/usr/bin/env python3
"""
Download seasonal/tagged emotes from 7TV that match emotes in this repo.
"""

import os
import sys
import json
import time
import requests
from pathlib import Path


API_URL = "https://7tv.io/v3/gql"
GRAPHQL_QUERY = """
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


def getRepoEmoteNames(repoPath: Path) -> set[str]:
    """Find all unique emote names in the repository."""
    extensions = {".gif", ".png", ".webp", ".avif"}
    excludeDirs = {".git", ".github", ".claude", ".vscode", "Seasonal", "worker"}
    names = set()

    for root, dirs, files in os.walk(repoPath):
        dirs[:] = [d for d in dirs if d not in excludeDirs]

        for filename in files:
            ext = Path(filename).suffix.lower()
            if ext in extensions:
                name = Path(filename).stem
                names.add(name)

    return names


def search7TVEmotes(emoteName: str, limit: int = 50) -> list[dict]:
    """Search 7TV for emotes matching the given name."""
    payload = {
        "query": GRAPHQL_QUERY,
        "variables": {
            "query": emoteName,
            "limit": limit
        }
    }

    try:
        response = requests.post(API_URL, json=payload, timeout=30)
        response.raise_for_status()
        data = response.json()

        if "data" in data and "emotes" in data["data"]:
            return data["data"]["emotes"]["items"]
    except requests.RequestException as e:
        print(f"  Error searching for '{emoteName}': {e}")

    return []


def filterByTag(emotes: list[dict], tag: str) -> list[dict]:
    """Filter emotes that have the specified tag (case-insensitive)."""
    tagLower = tag.lower()
    matching = []

    for emote in emotes:
        emoteTags = [t.lower() for t in emote.get("tags", [])]
        if tagLower in emoteTags:
            matching.append(emote)

    return matching


def filterByExactName(emotes: list[dict], name: str) -> list[dict]:
    """Filter emotes that exactly match the name (case-insensitive)."""
    nameLower = name.lower()
    return [e for e in emotes if e.get("name", "").lower() == nameLower]


def getDownloadUrl(emote: dict, preferGif: bool = True) -> tuple[str, str] | None:
    """Get the best download URL for an emote. Returns (url, extension)."""
    host = emote.get("host", {})
    baseUrl = host.get("url", "")
    files = host.get("files", [])

    if not baseUrl or not files:
        return None

    if not baseUrl.startswith("http"):
        baseUrl = "https:" + baseUrl

    isAnimated = emote.get("animated", False)

    # Priority order based on whether it's animated
    if isAnimated:
        formatPriority = ["GIF", "WEBP", "AVIF", "PNG"]
    else:
        formatPriority = ["PNG", "WEBP", "AVIF", "GIF"]

    # Find the largest file for each format
    formatFiles = {}
    for f in files:
        fmt = f.get("format", "")
        width = f.get("width", 0)
        if fmt not in formatFiles or width > formatFiles[fmt].get("width", 0):
            formatFiles[fmt] = f

    # Pick the best format available
    for fmt in formatPriority:
        if fmt in formatFiles:
            fileName = formatFiles[fmt]["name"]
            extension = "." + fmt.lower()
            return (f"{baseUrl}/{fileName}", extension)

    return None


def downloadEmote(url: str, destPath: Path) -> bool:
    """Download an emote to the specified path."""
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()

        destPath.parent.mkdir(parents=True, exist_ok=True)
        destPath.write_bytes(response.content)
        return True
    except requests.RequestException as e:
        print(f"  Error downloading: {e}")
        return False


def main():
    repoPath = Path(__file__).parent.parent.resolve()

    print("=" * 60)
    print("7TV Seasonal Emote Downloader")
    print("=" * 60)
    print()

    tag = input("Enter the tag to search for (e.g., christmas, halloween): ").strip()
    if not tag:
        print("No tag entered. Exiting.")
        return

    limitInput = input("Max emotes to download (leave blank for unlimited): ").strip()
    maxMatches = int(limitInput) if limitInput.isdigit() else None

    outputDir = repoPath / "Seasonal" / tag.capitalize()
    outputDir.mkdir(parents=True, exist_ok=True)

    print(f"\nOutput directory: {outputDir}")
    print()

    # Get names of emotes already in the output folder
    existingNames = set()
    extensions = {".gif", ".png", ".webp", ".avif"}
    for f in outputDir.iterdir():
        if f.is_file() and f.suffix.lower() in extensions:
            existingNames.add(f.stem)

    if existingNames:
        print(f"Found {len(existingNames)} emotes already in {tag.capitalize()} folder (will skip).")
        print()

    print("Scanning repository for emote names...")
    emoteNames = getRepoEmoteNames(repoPath)
    print(f"Found {len(emoteNames)} unique emote names in the repo.")

    # Remove names we already have
    emoteNames = emoteNames - existingNames
    print(f"Searching {len(emoteNames)} emotes (excluding already downloaded).")
    print()

    matchingEmotes = []

    print(f"Searching 7TV for emotes with '{tag}' tag...")
    print("-" * 60)

    for i, name in enumerate(sorted(emoteNames), 1):
        sys.stdout.write(f"\r[{i}/{len(emoteNames)}] Searching: {name[:30]:<30}")
        sys.stdout.flush()

        results = search7TVEmotes(name)

        # Filter to exact name matches first
        exactMatches = filterByExactName(results, name)

        # Then filter by tag
        taggedMatches = filterByTag(exactMatches, tag)

        if taggedMatches:
            # Take the first (most popular) match
            matchingEmotes.append((name, taggedMatches[0]))
            print(f"\r[{i}/{len(emoteNames)}] Found: {name} -> {taggedMatches[0]['name']}")

            # Stop if we hit the limit
            if maxMatches and len(matchingEmotes) >= maxMatches:
                print(f"\nReached limit of {maxMatches} matches.")
                break

        # Rate limiting - be nice to the API
        time.sleep(0.1)

    print()
    print("-" * 60)
    print(f"Found {len(matchingEmotes)} matching emotes with '{tag}' tag.")
    print()

    if not matchingEmotes:
        print("No matching emotes found.")
        return

    print("Downloading emotes...")
    print("-" * 60)

    downloaded = 0
    failed = 0

    for name, emote in matchingEmotes:
        urlInfo = getDownloadUrl(emote)
        if not urlInfo:
            print(f"  Skipping {name}: No download URL found")
            failed += 1
            continue

        url, ext = urlInfo
        destPath = outputDir / f"{name}{ext}"

        print(f"  Downloading: {name}{ext}")
        if downloadEmote(url, destPath):
            downloaded += 1
        else:
            failed += 1

        time.sleep(0.1)

    print()
    print("=" * 60)
    print(f"Download complete!")
    print(f"  Downloaded: {downloaded}")
    print(f"  Failed: {failed}")
    print(f"  Output: {outputDir}")
    print("=" * 60)


if __name__ == "__main__":
    main()
