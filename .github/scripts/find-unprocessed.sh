#!/bin/bash
# Find animated GIF files that haven't been processed yet
#
# Required env vars:
#   FORCE_REPROCESS - "true" to clear processed list
#   SPECIFIC_FILE - optional, process only this file (bypasses normal search)
#   EVENT_NAME - github.event_name
#   REPOSITORY - github.repository
#   PR_NUMBER - github.event.pull_request.number (for PR events)
#   GITHUB_OUTPUT - path to output file
#
# Outputs:
#   unprocessed - newline-separated list of file paths to process

set -e

PROCESSED_FILE=".github/processed-files.json"

clearProcessedList() {
    echo "Force reprocess requested - clearing gifs list"
    if [ -f "$PROCESSED_FILE" ]; then
        jq ".gifs = []" "$PROCESSED_FILE" > "${PROCESSED_FILE}.tmp"
        mv "${PROCESSED_FILE}.tmp" "$PROCESSED_FILE"
    fi
}

getChangedFilesFromPR() {
    gh api "repos/${REPOSITORY}/pulls/${PR_NUMBER}/files" --jq '.[].filename' | grep -iE "\.gif$" || true
}

getChangedFilesFromCommit() {
    git diff-tree --no-commit-id --name-only -r HEAD | grep -iE "\.gif$" || true
}

getCurrentCommitFiles() {
    if [ "$EVENT_NAME" = "pull_request" ]; then
        getChangedFilesFromPR
    else
        getChangedFilesFromCommit
    fi
}

initializeProcessedFile() {
    local currentCommitFiles="$1"

    echo "Creating processed-files.json..."
    mkdir -p .github

    local allFiles
    allFiles=$(find . -type f -iname "*.gif" | sed 's|^\./||' | sort)

    local initialFiles="[]"
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if ! echo "$currentCommitFiles" | grep -qxF "$file"; then
            initialFiles=$(echo "$initialFiles" | jq --arg f "$file" '. + [$f]')
        fi
    done <<< "$allFiles"

    echo "{\"gifs\": []}" | jq ".gifs = ${initialFiles}" > "$PROCESSED_FILE"
    echo "Created with $(echo "$initialFiles" | jq 'length') pre-existing gifs"
}

ensureProcessedFileExists() {
    if [ ! -f "$PROCESSED_FILE" ]; then
        echo "{\"gifs\": []}" | jq '.' > "$PROCESSED_FILE"
    fi
}

isAnimated() {
    local file="$1"
    local frameCount
    frameCount=$(identify -format "%n\n" "$file" 2>/dev/null | head -1)
    [ "$frameCount" -gt 1 ] 2>/dev/null
}

filterAnimatedFiles() {
    local files="$1"
    local result=""

    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if isAnimated "$file"; then
            result="${result}${file}"$'\n'
        fi
    done <<< "$files"

    echo "$result"
}

findUnprocessedFiles() {
    local allFiles
    allFiles=$(find . -type f -iname "*.gif" | sed 's|^\./||' | sort)

    local unprocessed=""
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if ! jq -e --arg f "$file" ".gifs | index(\$f)" "$PROCESSED_FILE" > /dev/null 2>&1; then
            if isAnimated "$file"; then
                unprocessed="${unprocessed}${file}"$'\n'
            fi
        fi
    done <<< "$allFiles"

    echo "$unprocessed"
}

writeOutput() {
    local unprocessed="$1"
    echo "gifs to process:"
    echo "$unprocessed"
    {
        echo "unprocessed<<EOF"
        echo "$unprocessed"
        echo "EOF"
    } >> "$GITHUB_OUTPUT"
}

main() {
    if [ -n "$SPECIFIC_FILE" ]; then
        echo "Processing specific file: $SPECIFIC_FILE"
        writeOutput "$SPECIFIC_FILE"
        return
    fi

    if [ "$FORCE_REPROCESS" = "true" ]; then
        clearProcessedList
    fi

    local currentCommitFiles
    currentCommitFiles=$(getCurrentCommitFiles)

    if [ ! -f "$PROCESSED_FILE" ]; then
        initializeProcessedFile "$currentCommitFiles"
    else
        ensureProcessedFileExists
    fi

    local unprocessed
    unprocessed=$(findUnprocessedFiles)

    echo "Files changed in PR/commit:"
    echo "$currentCommitFiles"

    local changedAnimated
    changedAnimated=$(filterAnimatedFiles "$currentCommitFiles")

    echo "Changed files that are animated:"
    echo "$changedAnimated"

    local combined
    combined=$(printf "%s\n%s" "$unprocessed" "$changedAnimated" | sort -u | grep -v '^$' || true)

    writeOutput "$combined"
}

main
