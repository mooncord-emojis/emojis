#!/bin/bash
# Create check runs on the new commit for required status checks
#
# Required env vars:
#   REPOSITORY - github.repository
#   GH_TOKEN - GitHub token for API calls
#   ORIGINAL_SHA - the original commit SHA to check for existing check results

set -e

getCheckConclusion() {
    local checkName="$1"
    local sha="$2"

    local result
    result=$(gh api "repos/${REPOSITORY}/commits/${sha}/check-runs" \
        --jq ".check_runs[] | select(.name == \"${checkName}\") | .conclusion" 2>/dev/null | head -1)

    if [ -z "$result" ]; then
        echo "success"
    else
        echo "$result"
    fi
}

main() {
    local newSha
    newSha=$(git rev-parse HEAD)
    echo "Creating check runs on commit $newSha"
    echo "Original commit: $ORIGINAL_SHA"

    # Always create success for optimize (this workflow succeeded)
    gh api "repos/${REPOSITORY}/check-runs" \
        -f name="optimize" \
        -f head_sha="$newSha" \
        -f status="completed" \
        -f conclusion="success"
    echo "  Created check run: optimize (success)"

    # Propagate check-duplicates result from original commit
    # Look up using full workflow name format (how GitHub reports it)
    local duplicateConclusion
    duplicateConclusion=$(getCheckConclusion "Check Emoji Duplicates / check-duplicates" "$ORIGINAL_SHA")
    echo "  check-duplicates on original commit: $duplicateConclusion"

    gh api "repos/${REPOSITORY}/check-runs" \
        -f name="check-duplicates" \
        -f head_sha="$newSha" \
        -f status="completed" \
        -f conclusion="$duplicateConclusion"
    echo "  Created check run: check-duplicates ($duplicateConclusion)"
}

main
