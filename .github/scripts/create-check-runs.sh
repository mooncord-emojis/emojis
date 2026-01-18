#!/bin/bash
# Create check runs on the new commit for required status checks
#
# Required env vars:
#   REPOSITORY - github.repository
#   GH_TOKEN - GitHub token for API calls

set -e

CHECKS="optimize"

main() {
    local newSha
    newSha=$(git rev-parse HEAD)
    echo "Creating check runs on commit $newSha"

    for checkName in $CHECKS; do
        gh api "repos/${REPOSITORY}/check-runs" \
            -f name="$checkName" \
            -f head_sha="$newSha" \
            -f status="completed" \
            -f conclusion="success"
        echo "  Created check run: $checkName"
    done
}

main
