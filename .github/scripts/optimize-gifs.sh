#!/bin/bash
# Optimize GIF files using gifsicle lossy compression
#
# Required env vars:
#   UNPROCESSED - newline-separated list of GIF paths
#   GITHUB_OUTPUT - path to output file
#
# Outputs:
#   processed - newline-separated list of successfully processed GIF paths

set -e

optimizeGif() {
    local gif="$1"

    if gifsicle -O3 --lossy=30 "$gif" -o "${gif}.tmp" 2>/dev/null; then
        mv "${gif}.tmp" "$gif"
        return 0
    fi

    rm -f "${gif}.tmp"
    return 1
}

processSingleGif() {
    local gif="$1"

    if [ ! -f "$gif" ]; then
        echo "Skipping missing file: $gif"
        return 1
    fi

    echo "Optimizing: $gif"

    local originalSize
    originalSize=$(stat -c%s "$gif")

    if optimizeGif "$gif"; then
        local newSize
        newSize=$(stat -c%s "$gif")
        local savedBytes=$((originalSize - newSize))
        local savedPercent=0

        if [ "$originalSize" -gt 0 ]; then
            savedPercent=$((savedBytes * 100 / originalSize))
        fi

        echo "  Original: $((originalSize / 1024)) KB -> Optimized: $((newSize / 1024)) KB (saved ${savedPercent}%)"
        return 0
    fi

    echo "  Failed to optimize"
    return 1
}

writeOutput() {
    if [ -f /tmp/processed-gifs.txt ]; then
        {
            echo "processed<<EOF"
            cat /tmp/processed-gifs.txt
            echo "EOF"
        } >> "$GITHUB_OUTPUT"
    fi
}

main() {
    if [ -z "$UNPROCESSED" ]; then
        echo "No GIF files to optimize"
        exit 0
    fi

    rm -f /tmp/processed-gifs.txt

    echo "$UNPROCESSED" | while read -r gif; do
        [ -z "$gif" ] && continue

        if processSingleGif "$gif"; then
            echo "$gif" >> /tmp/processed-gifs.txt
        fi
    done

    writeOutput
}

main
