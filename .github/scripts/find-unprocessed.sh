#!/bin/bash
# Find files that haven't been processed yet
#
# Required env vars:
#   FILE_TYPE - "gif" or "webp"
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
JSON_KEY="${FILE_TYPE}s"  # "gifs" or "webps"

clearProcessedList() {
    echo "Force reprocess requested - clearing ${FILE_TYPE} list"
    if [ -f "$PROCESSED_FILE" ]; then
        jq ".${JSON_KEY} = []" "$PROCESSED_FILE" > "${PROCESSED_FILE}.tmp"
        mv "${PROCESSED_FILE}.tmp" "$PROCESSED_FILE"
    fi
}

getChangedFilesFromPR() {
    gh api "repos/${REPOSITORY}/pulls/${PR_NUMBER}/files" --jq '.[].filename' | grep -iE "\.${FILE_TYPE}$" || true
}

getChangedFilesFromCommit() {
    git diff-tree --no-commit-id --name-only -r HEAD | grep -iE "\.${FILE_TYPE}$" || true
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
    allFiles=$(find . -type f -iname "*.${FILE_TYPE}" | sed 's|^\./||' | sort)

    local initialFiles="[]"
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if ! echo "$currentCommitFiles" | grep -qxF "$file"; then
            initialFiles=$(echo "$initialFiles" | jq --arg f "$file" '. + [$f]')
        fi
    done <<< "$allFiles"

    echo "{\"gifs\": [], \"webps\": []}" | jq ".${JSON_KEY} = ${initialFiles}" > "$PROCESSED_FILE"
    echo "Created with $(echo "$initialFiles" | jq 'length') pre-existing ${FILE_TYPE}s"
}

ensureProcessedFileExists() {
    if [ ! -f "$PROCESSED_FILE" ]; then
        echo "{\"gifs\": [], \"webps\": []}" | jq '.' > "$PROCESSED_FILE"
    fi
}

findUnprocessedFiles() {
    local allFiles
    allFiles=$(find . -type f -iname "*.${FILE_TYPE}" | sed 's|^\./||' | sort)

    local unprocessed=""
    while IFS= read -r file; do
        [ -z "$file" ] && continue
        if ! jq -e --arg f "$file" ".${JSON_KEY} | index(\$f)" "$PROCESSED_FILE" > /dev/null 2>&1; then
            unprocessed="${unprocessed}${file}"$'\n'
        fi
    done <<< "$allFiles"

    echo "$unprocessed"
}

writeOutput() {
    local unprocessed="$1"
    echo "${FILE_TYPE}s to process:"
    echo "$unprocessed"
    {
        echo "unprocessed<<EOF"
        echo "$unprocessed"
        echo "EOF"
    } >> "$GITHUB_OUTPUT"
}

main() {
    if [ -z "$FILE_TYPE" ]; then
        echo "ERROR: FILE_TYPE env var is required (gif or webp)"
        exit 1
    fi

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

    writeOutput "$unprocessed"
}

main
