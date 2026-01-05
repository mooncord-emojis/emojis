import { verifyAuthToken } from './auth.js';

const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = 'cman85';
const REPO_NAME = 'mooncord-emojis';
const BASE_BRANCH = 'ratbranch';

// Valid target folders
const VALID_FOLDERS = [
    'Animated',
    'Static',
    'MOONMOON',
    'MOONMOON/7TV',
    'MOONMOON/BTTV',
    'PEPCELSCLICKME',
    'PEPCELSCLICKME/GOONER SHIT',
    'Zero Width'
];

// Rate limiting map (in-memory, resets on worker restart)
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

export async function handleEmojiSubmission(request, env) {
    // Verify authentication
    const authPayload = await verifyAuthToken(request, env);

    if (!authPayload) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Check rate limit
    const rateLimitResult = checkRateLimit(authPayload.discordId);
    if (!rateLimitResult.allowed) {
        return new Response(JSON.stringify({
            error: `Rate limit exceeded. You can submit ${RATE_LIMIT_MAX} emojis per hour. Try again later.`
        }), {
            status: 429,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Parse request body
    let body;
    try {
        body = await request.json();
    } catch (e) {
        return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    const { emojiName, targetFolder, imageData, fileExtension } = body;

    // Validate inputs
    const validationError = validateInputs(emojiName, targetFolder, imageData, fileExtension);
    if (validationError) {
        return new Response(JSON.stringify({ error: validationError }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        // Create the PR
        const prUrl = await createPullRequest(
            env.GITHUB_TOKEN,
            emojiName,
            targetFolder,
            imageData,
            fileExtension,
            authPayload.username
        );

        return new Response(JSON.stringify({ prUrl }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        console.error('GitHub API error:', error);
        return new Response(JSON.stringify({ error: error.message || 'Failed to create pull request' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

function validateInputs(emojiName, targetFolder, imageData, fileExtension) {
    if (!emojiName || typeof emojiName !== 'string') {
        return 'Emoji name is required';
    }

    // Validate emoji name format
    const namePattern = /^[a-zA-Z0-9_-]+$/;
    if (!namePattern.test(emojiName)) {
        return 'Emoji name can only contain letters, numbers, hyphens, and underscores';
    }

    if (emojiName.length < 2 || emojiName.length > 32) {
        return 'Emoji name must be between 2 and 32 characters';
    }

    if (!targetFolder || !VALID_FOLDERS.includes(targetFolder)) {
        return 'Invalid target folder';
    }

    if (!imageData || typeof imageData !== 'string') {
        return 'Image data is required';
    }

    // Check image data size (rough estimate, base64 is ~1.37x larger than binary)
    const estimatedSize = (imageData.length * 3) / 4;
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (estimatedSize > maxSize) {
        return 'Image file is too large (max 10MB)';
    }

    const validExtensions = ['png', 'gif', 'webp', 'jpg', 'jpeg'];
    if (!fileExtension || !validExtensions.includes(fileExtension.toLowerCase())) {
        return 'Invalid file extension. Must be png, gif, webp, or jpg';
    }

    return null;
}

function checkRateLimit(userId) {
    const now = Date.now();
    const userLimit = rateLimitMap.get(userId);

    if (!userLimit) {
        rateLimitMap.set(userId, { count: 1, windowStart: now });
        return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
    }

    // Reset window if expired
    if (now - userLimit.windowStart > RATE_LIMIT_WINDOW_MS) {
        rateLimitMap.set(userId, { count: 1, windowStart: now });
        return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
    }

    // Check if under limit
    if (userLimit.count < RATE_LIMIT_MAX) {
        userLimit.count++;
        return { allowed: true, remaining: RATE_LIMIT_MAX - userLimit.count };
    }

    return { allowed: false, remaining: 0 };
}

async function createPullRequest(githubToken, emojiName, targetFolder, imageData, fileExtension, discordUsername) {
    const headers = {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Mooncord-Emoji-Submission-Bot',
        'Content-Type': 'application/json'
    };

    // 1. Get the base branch reference
    const baseRefResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${BASE_BRANCH}`,
        { headers }
    );

    if (!baseRefResponse.ok) {
        throw new Error('Failed to get base branch reference');
    }

    const baseRef = await baseRefResponse.json();
    const baseSha = baseRef.object.sha;

    // 2. Get the base commit to get the tree SHA
    const baseCommitResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${baseSha}`,
        { headers }
    );

    if (!baseCommitResponse.ok) {
        throw new Error('Failed to get base commit');
    }

    const baseCommit = await baseCommitResponse.json();
    const baseTreeSha = baseCommit.tree.sha;

    // 3. Create blob for the image
    const blobResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                content: imageData,
                encoding: 'base64'
            })
        }
    );

    if (!blobResponse.ok) {
        throw new Error('Failed to create blob for image');
    }

    const blob = await blobResponse.json();

    // 4. Create tree with the new file
    const filePath = `${targetFolder}/${emojiName}.${fileExtension}`;
    const treeResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                base_tree: baseTreeSha,
                tree: [{
                    path: filePath,
                    mode: '100644',
                    type: 'blob',
                    sha: blob.sha
                }]
            })
        }
    );

    if (!treeResponse.ok) {
        throw new Error('Failed to create tree');
    }

    const tree = await treeResponse.json();

    // 5. Create commit
    const commitMessage = `Add emoji: ${emojiName}\n\nSubmitted by Discord user: ${discordUsername}\nFolder: ${targetFolder}/`;
    const commitResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                message: commitMessage,
                tree: tree.sha,
                parents: [baseSha]
            })
        }
    );

    if (!commitResponse.ok) {
        throw new Error('Failed to create commit');
    }

    const commit = await commitResponse.json();

    // 6. Create new branch
    const timestamp = Date.now();
    const sanitizedUsername = discordUsername.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
    const branchName = `emoji/${sanitizedUsername}-${emojiName}-${timestamp}`;

    const branchResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/refs`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                ref: `refs/heads/${branchName}`,
                sha: commit.sha
            })
        }
    );

    if (!branchResponse.ok) {
        const errorData = await branchResponse.text();
        console.error('Branch creation failed:', errorData);
        throw new Error('Failed to create branch');
    }

    // 7. Create pull request
    const imageUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branchName}/${encodeURIComponent(targetFolder)}/${emojiName}.${fileExtension}`;
    const prBody = `## New Emoji Submission

**Emoji Name:** \`${emojiName}\`
**Target Folder:** \`${targetFolder}/\`
**Submitted by:** ${discordUsername} (via Discord)

### Preview
![${emojiName}](${imageUrl})

---
*This PR was automatically created by the Mooncord Emoji Submission system.*`;

    const prResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({
                title: `Add emoji: ${emojiName}`,
                body: prBody,
                head: branchName,
                base: BASE_BRANCH
            })
        }
    );

    if (!prResponse.ok) {
        const errorData = await prResponse.text();
        console.error('PR creation failed:', errorData);
        throw new Error('Failed to create pull request');
    }

    const pr = await prResponse.json();
    return pr.html_url;
}
