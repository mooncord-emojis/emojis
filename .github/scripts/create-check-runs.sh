#!/bin/bash
# Create a check run on the new commit for this workflow
#
# Required env vars:
#   REPOSITORY - github.repository
#   GH_TOKEN - GitHub token for API calls
#   CHECK_NAME - name of the check to create
#   CHECK_CONCLUSION - conclusion (success/failure)

set -e

main() {
    local newSha
    newSha=$(git rev-parse HEAD)

    echo "Creating check run '$CHECK_NAME' on commit $newSha with conclusion: $CHECK_CONCLUSION"

    gh api "repos/${REPOSITORY}/check-runs" \
        -f name="$CHECK_NAME" \
        -f head_sha="$newSha" \
        -f status="completed" \
        -f conclusion="$CHECK_CONCLUSION"

    echo "  Done"
}

main
