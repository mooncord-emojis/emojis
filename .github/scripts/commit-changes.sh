#!/bin/bash
# Commit and push changes to the repository
#
# Required env vars:
#   TARGET_BRANCH - branch to push to
#   COMMIT_MESSAGE - commit message
#   GITHUB_OUTPUT - path to output file
#
# Outputs:
#   committed - "true" if a commit was made, "false" otherwise

set -e

configureGit() {
    git config --local user.email "github-actions[bot]@users.noreply.github.com"
    git config --local user.name "github-actions[bot]"
}

hasChangesToCommit() {
    ! git diff --cached --quiet
}

commitAndPush() {
    git commit -m "$COMMIT_MESSAGE"
    git push origin "HEAD:${TARGET_BRANCH}"
    echo "committed=true" >> "$GITHUB_OUTPUT"
}

skipCommit() {
    echo "No changes staged, skipping commit"
    echo "committed=false" >> "$GITHUB_OUTPUT"
}

main() {
    configureGit
    git add -A

    if hasChangesToCommit; then
        commitAndPush
    else
        skipCommit
    fi
}

main
