#!/bin/bash
# Update the processed files JSON with newly processed files
#
# Required env vars:
#   FILE_TYPE - "gif" or "webp"
#   PROCESSED - newline-separated list of processed file paths
#   TARGET_BRANCH - branch to push to
#
# Optional env vars:
#   PREVIOUS_COMMIT - "true" if a previous commit was made in this run
#   SKIP_COMMIT - "true" to only update the file without committing

set -e

PROCESSED_FILE=".github/processed-files.json"
JSON_KEY="${FILE_TYPE}s"  # "gifs" or "webps"

addToProcessedList() {
    echo "Adding successfully processed ${FILE_TYPE}s to processed list..."

    while IFS= read -r file; do
        [ -z "$file" ] && continue

        jq --arg f "$file" ".${JSON_KEY} += [\$f] | .${JSON_KEY} |= unique" "$PROCESSED_FILE" > "${PROCESSED_FILE}.tmp"
        mv "${PROCESSED_FILE}.tmp" "$PROCESSED_FILE"
        echo "  Added: $file"
    done <<< "$PROCESSED"
}

hasChangesToCommit() {
    ! git diff --cached --quiet
}

commitChanges() {
    if [ "$PREVIOUS_COMMIT" = "true" ]; then
        git commit --amend --no-edit
        git push origin "HEAD:${TARGET_BRANCH}" --force-with-lease
    else
        git commit -m "Update processed files list [skip ci]"
        git push origin "HEAD:${TARGET_BRANCH}" --force-with-lease
    fi
}

main() {
    if [ -z "$FILE_TYPE" ]; then
        echo "ERROR: FILE_TYPE env var is required (gif or webp)"
        exit 1
    fi

    if [ -z "$PROCESSED" ]; then
        echo "No processed ${FILE_TYPE}s to record"
        exit 0
    fi

    addToProcessedList
    git add "$PROCESSED_FILE"

    if [ "$SKIP_COMMIT" = "true" ]; then
        echo "Skipping commit (SKIP_COMMIT=true)"
        exit 0
    fi

    if hasChangesToCommit; then
        commitChanges
    else
        echo "Processed list unchanged"
    fi
}

main
