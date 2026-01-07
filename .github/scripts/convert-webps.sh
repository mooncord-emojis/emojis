#!/bin/bash
# Convert WebP files to GIF (animated) or PNG (static)
#
# Required env vars:
#   UNPROCESSED - newline-separated list of WebP paths
#   GITHUB_OUTPUT - path to output file
#
# Outputs:
#   processed - newline-separated list of successfully converted WebP paths
#   convertedGifs - newline-separated list of GIF paths that were created (for coalescing)

set -e

getFrameCount() {
    local webp="$1"
    webpmux -info "$webp" 2>/dev/null | grep -c "^[[:space:]]*[0-9]*:" || echo "1"
}

convertAnimatedWebpToGif() {
    local webp="$1"
    local gif="${webp%.*}.gif"

    echo "  Animated WebP, converting to GIF..."

    if ! convert "$webp" -coalesce -dither FloydSteinberg -colors 256 -layers OptimizeTransparency "$gif" 2>&1; then
        echo "  Failed to convert"
        return 1
    fi

    local minSize=100
    if [ ! -f "$gif" ] || [ "$(stat -c%s "$gif")" -le "$minSize" ]; then
        echo "  Failed to convert (output file empty or missing)"
        rm -f "$gif"
        return 1
    fi

    echo "  Converted to: $gif"
    rm "$webp"
    echo "  Removed original WebP"
    echo "$gif" >> /tmp/converted-gifs.txt
    return 0
}

convertStaticWebpToPng() {
    local webp="$1"
    local png="${webp%.*}.png"

    echo "  Static WebP, converting to PNG..."

    if ! ffmpeg -y -i "$webp" "$png" 2>/dev/null; then
        echo "  Failed to convert"
        return 1
    fi

    echo "  Converted to: $png"
    rm "$webp"
    echo "  Removed original WebP"
    return 0
}

processSingleWebp() {
    local webp="$1"

    if [ ! -f "$webp" ]; then
        echo "Skipping missing file: $webp"
        return 1
    fi

    echo "Processing: $webp"

    local frameCount
    frameCount=$(getFrameCount "$webp")

    if [ "$frameCount" -gt 1 ] 2>/dev/null; then
        echo "  Found $frameCount frames"
        if convertAnimatedWebpToGif "$webp"; then
            echo "  Successfully processed"
            return 0
        fi
        return 1
    fi

    if convertStaticWebpToPng "$webp"; then
        echo "  Successfully processed"
        return 0
    fi
    return 1
}

writeOutput() {
    if [ -f /tmp/processed-webps.txt ]; then
        {
            echo "processed<<EOF"
            cat /tmp/processed-webps.txt
            echo "EOF"
        } >> "$GITHUB_OUTPUT"
    fi

    if [ -f /tmp/converted-gifs.txt ]; then
        {
            echo "convertedGifs<<EOF"
            cat /tmp/converted-gifs.txt
            echo "EOF"
        } >> "$GITHUB_OUTPUT"
    fi
}

main() {
    if [ -z "$UNPROCESSED" ]; then
        echo "No WebP files to process"
        exit 0
    fi

    rm -f /tmp/processed-webps.txt /tmp/converted-gifs.txt

    echo "$UNPROCESSED" | while read -r webp; do
        [ -z "$webp" ] && continue

        if processSingleWebp "$webp"; then
            echo "$webp" >> /tmp/processed-webps.txt
        fi
    done

    writeOutput
}

main
