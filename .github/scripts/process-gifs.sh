#!/bin/bash
# Process (coalesce) GIF files to fix frame rendering issues
#
# Required env vars:
#   UNPROCESSED - newline-separated list of GIF paths
#   GITHUB_OUTPUT - path to output file
#
# Outputs:
#   processed - newline-separated list of successfully processed GIF paths

set -e

MAX_SIZE=10485760  # 10 MB

getFrameCount() {
    local gif="$1"
    gifsicle --info "$gif" 2>/dev/null | grep -c "image #" || echo "1"
}

coalesceWithImageMagick() {
    local gif="$1"
    if convert "$gif" -coalesce "${gif}.tmp" 2>/dev/null; then
        mv "${gif}.tmp" "$gif"
        echo "  ImageMagick coalesce done"
        return 0
    fi
    return 1
}

coalesceWithGifsicle() {
    local gif="$1"
    if gifsicle --unoptimize "$gif" -o "${gif}.tmp" 2>/dev/null; then
        mv "${gif}.tmp" "$gif"
        echo "  Gifsicle unoptimize done"
        return 0
    fi
    rm -f "${gif}.tmp"
    return 1
}

scaleDownIfNeeded() {
    local gif="$1"
    local fileSize
    fileSize=$(stat -c%s "$gif")

    if [ "$fileSize" -le "$MAX_SIZE" ]; then
        return 0
    fi

    echo "  File is $(($fileSize / 1024 / 1024)) MB, scaling down..."

    for scale in 0.9 0.8 0.7 0.6 0.5 0.4 0.3; do
        echo "    Trying scale ${scale}..."

        if ! gifsicle --scale "$scale" "$gif" -o "${gif}.tmp" 2>/dev/null; then
            echo "    Scale failed"
            break
        fi

        local newSize
        newSize=$(stat -c%s "${gif}.tmp")
        echo "    Result: $(($newSize / 1024 / 1024)) MB"

        if [ "$newSize" -le "$MAX_SIZE" ]; then
            mv "${gif}.tmp" "$gif"
            echo "  Scaled to ${scale}x successfully"
            return 0
        fi

        rm -f "${gif}.tmp"
    done

    return 0
}

processAnimatedGif() {
    local gif="$1"
    local frameCount
    frameCount=$(getFrameCount "$gif")

    echo "  Found $frameCount frames, coalescing..."

    coalesceWithImageMagick "$gif" || true

    if ! coalesceWithGifsicle "$gif"; then
        echo "  Failed to coalesce"
        return 1
    fi

    scaleDownIfNeeded "$gif"
    return 0
}

processSingleGif() {
    local gif="$1"

    if [ ! -f "$gif" ]; then
        echo "Skipping missing file: $gif"
        return 1
    fi

    echo "Processing: $gif"

    local frameCount
    frameCount=$(getFrameCount "$gif")

    if [ "$frameCount" -gt 1 ] 2>/dev/null; then
        if processAnimatedGif "$gif"; then
            echo "  Successfully processed"
            return 0
        fi
        return 1
    fi

    echo "  Single frame or not animated, marking as processed"
    return 0
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
        echo "No GIF files to process"
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
