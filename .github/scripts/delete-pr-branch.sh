#!/bin/bash
# Delete a PR branch if conditions are met
#
# Required env vars:
#   PR_MERGED - "true" if PR was merged
#   HEAD_REPO - full name of the head repo (e.g., "owner/repo")
#   BASE_REPO - full name of the base repo (e.g., "owner/repo")
#   HEAD_REF - branch name (e.g., "emoji/my-emoji-123456")
#   GH_TOKEN - GitHub token for API calls

set -e

shouldDelete() {
    if [ "$PR_MERGED" = "true" ]; then
        echo "PR was merged, skipping"
        return 1
    fi

    if [ "$HEAD_REPO" != "$BASE_REPO" ]; then
        echo "PR is from a fork, skipping"
        return 1
    fi

    if [[ ! "$HEAD_REF" == emoji/* ]]; then
        echo "Branch does not start with emoji/, skipping"
        return 1
    fi

    return 0
}

deleteBranch() {
    echo "Deleting branch: $HEAD_REF"
    gh api "repos/${BASE_REPO}/git/refs/heads/${HEAD_REF}" -X DELETE
    echo "Successfully deleted branch"
}

main() {
    echo "PR merged: $PR_MERGED"
    echo "Head repo: $HEAD_REPO"
    echo "Base repo: $BASE_REPO"
    echo "Head ref: $HEAD_REF"

    if shouldDelete; then
        echo "All conditions met, deleting branch"
        deleteBranch
    fi
}

main
