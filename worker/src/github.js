import { verifyAuthToken } from './auth.js';

const GITHUB_API_BASE = 'https://api.github.com';
const REPO_OWNER = 'mooncord-emojis';
const REPO_NAME = 'emojis';
const BASE_BRANCH = 'ratbranch';

// Encode a file path for use in URLs, preserving slashes but encoding spaces and special characters
function encodeFilePath(path) {
    return path.split('/').map(segment => encodeURIComponent(segment)).join('/');
}

// Folders to exclude from the dropdown
const EXCLUDED_FOLDERS = [
    '.github',
    'docs'
];

// Cache for folder list (refreshed once per hour)
let cachedFolders = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 60 * 60 * 1000; // 1 hour

// Cache for user submissions (keyed by username:state)
const submissionsCache = new Map();
const SUBMISSIONS_CACHE_DURATION_MS = 2 * 60 * 1000; // 2 minutes

// Fetch folders from the repository using REST API
async function fetchFoldersFromRepo(githubToken) {
    const now = Date.now();

    // Return cached if still valid
    if (cachedFolders && (now - cacheTimestamp) < CACHE_DURATION_MS) {
        return cachedFolders;
    }

    const headers = {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Mooncord-Emoji-Submission-Bot'
    };

    // Get the tree recursively (1 API call)
    const treeResponse = await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${BASE_BRANCH}?recursive=1`,
        { headers }
    );

    // Log rate limit status
    const rateLimitRemaining = treeResponse.headers.get('x-ratelimit-remaining');
    const rateLimitLimit = treeResponse.headers.get('x-ratelimit-limit');
    console.log(`GitHub API rate limit (folders): ${rateLimitRemaining}/${rateLimitLimit} remaining`);

    if (!treeResponse.ok) {
        const rateLimitReset = treeResponse.headers.get('x-ratelimit-reset');
        console.error(`GitHub API error: ${treeResponse.status} ${treeResponse.statusText}`);
        console.error(`Rate limit resets at: ${rateLimitReset}`);
        throw new Error(`Failed to fetch repository tree: ${treeResponse.status}`);
    }

    const treeData = await treeResponse.json();

    // Filter to only directories, exclude hidden/system folders
    const folderPaths = treeData.tree
        .filter(item => item.type === 'tree')
        .map(item => item.path)
        .filter(path => {
            const topLevel = path.split('/')[0];
            return !EXCLUDED_FOLDERS.includes(topLevel);
        })
        .sort();

    // Find all description.txt files and their SHAs
    const descriptionFiles = treeData.tree
        .filter(item => item.type === 'blob' && item.path.endsWith('/description.txt'))
        .reduce((map, item) => {
            const folderPath = item.path.replace('/description.txt', '');
            map[folderPath] = item.sha;
            return map;
        }, {});

    // Fetch description contents in parallel
    const descriptionPromises = Object.entries(descriptionFiles).map(async ([folderPath, sha]) => {
        try {
            const blobResponse = await fetch(
                `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs/${sha}`,
                { headers }
            );
            if (blobResponse.ok) {
                const blobData = await blobResponse.json();
                const content = atob(blobData.content).trim();
                return { folderPath, description: content };
            }
        } catch (err) {
            console.error(`Failed to fetch description for ${folderPath}:`, err);
        }
        return { folderPath, description: null };
    });

    const descriptionResults = await Promise.all(descriptionPromises);
    const descriptionMap = descriptionResults.reduce((map, result) => {
        if (result.description) {
            map[result.folderPath] = result.description;
        }
        return map;
    }, {});

    // Build folder objects with descriptions
    const folders = folderPaths.map(path => ({
        path: path,
        description: descriptionMap[path] || null
    }));

    // Update cache
    cachedFolders = folders;
    cacheTimestamp = now;

    return folders;
}

// Handle GET /api/folders request
export async function handleGetFolders(request, env) {
    try {
        const folders = await fetchFoldersFromRepo(env.GITHUB_TOKEN);

        return new Response(JSON.stringify({ folders }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching folders:', error.message, error.stack);
        return new Response(JSON.stringify({ error: 'Failed to fetch folders: ' + error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

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

    console.log(`Emoji submission request from user: ${authPayload.username}`);

    // Check if user is blocked
    const blockedEntry = await env.BLOCKLIST.get(`blocked:${authPayload.discordId}`);
    if (blockedEntry !== null) {
        return new Response(JSON.stringify({
            error: 'You have been banned from submitting emojis. You know what you did.'
        }), {
            status: 403,
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

    const { emojiName, targetFolder, imageData, fileExtension, updateExisting } = body;

    // Validate inputs
    const validationError = await validateInputs(emojiName, targetFolder, imageData, fileExtension, env.GITHUB_TOKEN);
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
            authPayload.username,
            updateExisting === true
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

async function validateInputs(emojiName, targetFolder, imageData, fileExtension, githubToken) {
    if (!emojiName || typeof emojiName !== 'string') {
        return 'Emoji name is required';
    }

    // Validate emoji name - disallow characters invalid in filenames
    const invalidChars = /[\/\\:*?"<>|]/;
    if (invalidChars.test(emojiName)) {
        return 'Emoji name cannot contain: / \\ : * ? " < > |';
    }

    if (emojiName.length < 2 || emojiName.length > 80) {
        return 'Emoji name must be between 2 and 80 characters';
    }

    // Validate target folder against dynamic list from repo
    const validFolders = await fetchFoldersFromRepo(githubToken);
    const folderExists = validFolders.some(folder => folder.path === targetFolder);
    if (!targetFolder || !folderExists) {
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

async function createPullRequest(githubToken, emojiName, targetFolder, imageData, fileExtension, discordUsername, updateExisting) {
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
    const actionWord = updateExisting ? 'Update' : 'Add';
    const commitMessage = `${actionWord} emoji: ${emojiName}\n\nSubmitted by Discord user: ${discordUsername}\nFolder: ${targetFolder}/`;
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
    const imageUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branchName}/${encodeFilePath(targetFolder)}/${encodeURIComponent(emojiName)}.${fileExtension}`;
    const prBody = `## ${updateExisting ? 'Emoji Update' : 'New Emoji Submission'}

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
                title: `${actionWord} emoji: ${emojiName}`,
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

    // 8. Add label to the PR
    const labelName = updateExisting ? 'Update' : 'New';
    await fetch(
        `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/issues/${pr.number}/labels`,
        {
            method: 'POST',
            headers,
            body: JSON.stringify({ labels: [labelName] })
        }
    );

    return pr.html_url;
}

// Extract username from PR body
function extractSubmitterFromBody(body) {
    if (!body) {
        return null;
    }
    const match = body.match(/\*\*Submitted by:\*\* ([^\s]+) \(via Discord\)/);
    return match ? match[1] : null;
}

// Extract emoji info from PR body
function extractEmojiInfoFromBody(body) {
    if (!body) {
        return { emojiName: null, folder: null };
    }
    const nameMatch = body.match(/\*\*Emoji Name:\*\* `([^`]+)`/);
    const folderMatch = body.match(/\*\*Target Folder:\*\* `([^`]+)\/?`/);
    return {
        emojiName: nameMatch ? nameMatch[1] : null,
        folder: folderMatch ? folderMatch[1].replace(/\/$/, '') : null
    };
}

// Extract the sha parameter from an image URL if present
function extractShaFromImageUrl(imageUrl) {
    if (!imageUrl) {
        return null;
    }
    const shaMatch = imageUrl.match(/[?&]sha=([a-f0-9]+)/i);
    return shaMatch ? shaMatch[1] : null;
}

// Get the actual image file path from the PR branch tree
async function getImageFilePathFromBranch(headers, branchName, emojiName, folder) {
    try {
        const treeResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${branchName}?recursive=1`,
            { headers }
        );

        if (!treeResponse.ok) {
            return null;
        }

        const treeData = await treeResponse.json();
        const expectedPathPrefix = `${folder}/${emojiName}.`;

        const imageFile = treeData.tree.find(item =>
            item.type === 'blob' && item.path.startsWith(expectedPathPrefix)
        );

        return imageFile ? imageFile.path : null;
    } catch (err) {
        console.error('Error getting image file path:', err);
        return null;
    }
}

// Build an image URL with cache-busting sha parameter
function buildImageUrlWithSha(branchName, filePath, sha) {
    const baseUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branchName}/${encodeFilePath(filePath)}`;
    return `${baseUrl}?sha=${sha}`;
}

// Update PR body with new image URL for cache busting
async function updatePrBodyWithCacheBustedImageUrl(headers, prNumber, emojiName, folder, username, newImageUrl) {
    const prBody = `## Emoji Submission

**Emoji Name:** \`${emojiName}\`
**Target Folder:** \`${folder}/\`
**Submitted by:** ${username} (via Discord)

### Preview
![${emojiName}](${newImageUrl})

---
*This PR was automatically created by the Mooncord Emoji Submission system.*`;

    try {
        await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ body: prBody })
            }
        );
    } catch (err) {
        console.error('Error updating PR body with cache-busted URL:', err);
    }
}

// Handle GET /api/submissions - list user's submissions (using GraphQL for efficiency)
export async function handleGetUserSubmissions(request, env) {
    const authPayload = await verifyAuthToken(request, env);
    if (!authPayload) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    console.log(`Get submissions request from user: ${authPayload.username}`);

    // Get the state query parameter (default to 'open' for backwards compatibility)
    const url = new URL(request.url);
    const stateParam = url.searchParams.get('state') || 'open';

    // Check cache first
    const cacheKey = `${authPayload.username}:${stateParam}`;
    const cachedEntry = submissionsCache.get(cacheKey);
    const now = Date.now();
    if (cachedEntry && (now - cachedEntry.timestamp) < SUBMISSIONS_CACHE_DURATION_MS) {
        return new Response(JSON.stringify({ submissions: cachedEntry.data }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    // Build GraphQL states array
    let prStates = ['OPEN'];
    if (stateParam === 'all') {
        prStates = ['OPEN', 'CLOSED', 'MERGED'];
    } else if (stateParam === 'closed') {
        prStates = ['CLOSED', 'MERGED'];
    }

    // GraphQL query to fetch PRs with check statuses in one request
    const graphqlQuery = `
        query($owner: String!, $name: String!, $states: [PullRequestState!]) {
            repository(owner: $owner, name: $name) {
                pullRequests(first: 100, states: $states, orderBy: {field: CREATED_AT, direction: DESC}) {
                    nodes {
                        number
                        title
                        body
                        state
                        merged
                        mergedAt
                        createdAt
                        url
                        headRefName
                        headRefOid
                        labels(first: 10) {
                            nodes {
                                name
                                color
                            }
                        }
                        commits(last: 1) {
                            nodes {
                                commit {
                                    statusCheckRollup {
                                        state
                                    }
                                }
                            }
                        }
                    }
                }
            }
            rateLimit {
                remaining
                limit
            }
        }
    `;

    try {
        const response = await fetch('https://api.github.com/graphql', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
                'Content-Type': 'application/json',
                'User-Agent': 'Mooncord-Emoji-Submission-Bot'
            },
            body: JSON.stringify({
                query: graphqlQuery,
                variables: {
                    owner: REPO_OWNER,
                    name: REPO_NAME,
                    states: prStates
                }
            })
        });

        if (!response.ok) {
            throw new Error(`GraphQL request failed: ${response.status}`);
        }

        const result = await response.json();

        if (result.errors) {
            console.error('GraphQL errors:', result.errors);
            throw new Error('GraphQL query failed');
        }

        // Log rate limit from GraphQL response
        const rateLimit = result.data.rateLimit;
        console.log(`GitHub GraphQL rate limit: ${rateLimit.remaining}/${rateLimit.limit} remaining`);

        const allPrs = result.data.repository.pullRequests.nodes;

        // Filter to user's PRs
        const allUserPrs = allPrs.filter(pr => {
            const submitter = extractSubmitterFromBody(pr.body);
            return submitter === authPayload.username;
        });

        // Transform PRs to submission format
        const userSubmissions = allUserPrs.map(pr => {
            const emojiInfo = extractEmojiInfoFromBody(pr.body);
            const imageMatch = pr.body ? pr.body.match(/!\[[^\]]*\]\(([^)]+)\)/) : null;
            let imageUrl = imageMatch ? imageMatch[1] : null;

            const isMerged = pr.merged;
            const isOpenPr = pr.state === 'OPEN';
            const isClosed = pr.state === 'CLOSED' && !isMerged;

            // For merged PRs, construct URL to base branch
            if (isMerged && emojiInfo.emojiName && emojiInfo.folder) {
                // Use a predictable URL pattern for merged PRs
                const possibleExtensions = ['gif', 'png', 'jpg', 'jpeg'];
                for (const ext of possibleExtensions) {
                    const testPath = `${emojiInfo.folder}/${emojiInfo.emojiName}.${ext}`;
                    imageUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BASE_BRANCH}/${encodeFilePath(testPath)}`;
                    break; // Just use the first one, frontend will handle 404
                }
            } else if (isClosed) {
                imageUrl = null;
            }

            // Get check status from GraphQL response
            let checkStatus = { state: 'unknown', checks: [] };
            const lastCommit = pr.commits.nodes[0];
            if (lastCommit && lastCommit.commit.statusCheckRollup) {
                const rollupState = lastCommit.commit.statusCheckRollup.state;
                let overallState = 'unknown';
                if (rollupState === 'SUCCESS') {
                    overallState = 'success';
                } else if (rollupState === 'FAILURE' || rollupState === 'ERROR') {
                    overallState = 'failure';
                } else if (rollupState === 'PENDING') {
                    overallState = 'pending';
                }
                checkStatus = { state: overallState, checks: [] };
            } else {
                checkStatus = { state: 'none', checks: [] };
            }

            return {
                number: pr.number,
                title: pr.title,
                emojiName: emojiInfo.emojiName,
                folder: emojiInfo.folder,
                imageUrl: imageUrl,
                htmlUrl: pr.url,
                createdAt: pr.createdAt,
                state: pr.state.toLowerCase(),
                merged: pr.merged,
                labels: pr.labels.nodes.map(label => ({
                    name: label.name,
                    color: label.color
                })),
                checkStatus: checkStatus
            };
        });

        // Cache the results
        submissionsCache.set(cacheKey, {
            data: userSubmissions,
            timestamp: Date.now()
        });

        return new Response(JSON.stringify({ submissions: userSubmissions }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error fetching submissions:', error.message, error.stack);
        return new Response(JSON.stringify({ error: 'Failed to fetch submissions: ' + error.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle PATCH /api/submissions/:number - update a submission
export async function handleUpdateSubmission(request, env, prNumber) {
    const authPayload = await verifyAuthToken(request, env);
    if (!authPayload) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    console.log(`Update submission request from user: ${authPayload.username} for PR #${prNumber}`);

    const headers = {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Mooncord-Emoji-Submission-Bot',
        'Content-Type': 'application/json'
    };

    try {
        // Get the PR details
        const prResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`,
            { headers }
        );

        if (!prResponse.ok) {
            return new Response(JSON.stringify({ error: 'Pull request not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const pr = await prResponse.json();

        // Verify ownership
        const submitter = extractSubmitterFromBody(pr.body);
        if (submitter !== authPayload.username) {
            return new Response(JSON.stringify({ error: 'You do not own this submission' }), {
                status: 403,
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

        const { newName, newFolder, newImageData, fileExtension } = body;
        const currentInfo = extractEmojiInfoFromBody(pr.body);
        const branchName = pr.head.ref;

        const finalName = newName || currentInfo.emojiName;
        const finalFolder = newFolder || currentInfo.folder;

        // Validate inputs if provided
        if (newName) {
            const invalidChars = /[\/\\:*?"<>|]/;
            if (invalidChars.test(newName)) {
                return new Response(JSON.stringify({ error: 'Emoji name cannot contain: / \\ : * ? " < > |' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
            if (newName.length < 2 || newName.length > 80) {
                return new Response(JSON.stringify({ error: 'Emoji name must be between 2 and 80 characters' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        if (newFolder) {
            const validFolders = await fetchFoldersFromRepo(env.GITHUB_TOKEN);
            const folderExists = validFolders.some(folder => folder.path === newFolder);
            if (!folderExists) {
                return new Response(JSON.stringify({ error: 'Invalid target folder' }), {
                    status: 400,
                    headers: { 'Content-Type': 'application/json' }
                });
            }
        }

        // Get current branch tree
        const branchRefResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${branchName}`,
            { headers }
        );

        if (!branchRefResponse.ok) {
            throw new Error('Failed to get branch reference');
        }

        const branchRef = await branchRefResponse.json();
        const branchSha = branchRef.object.sha;

        // Get the current commit
        const commitResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${branchSha}`,
            { headers }
        );

        if (!commitResponse.ok) {
            throw new Error('Failed to get commit');
        }

        const currentCommit = await commitResponse.json();
        const currentTreeSha = currentCommit.tree.sha;

        // Get the current tree to find the existing file
        const treeResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees/${currentTreeSha}?recursive=1`,
            { headers }
        );

        if (!treeResponse.ok) {
            throw new Error('Failed to get tree');
        }

        const treeData = await treeResponse.json();

        // Find the current emoji file
        const currentPath = `${currentInfo.folder}/${currentInfo.emojiName}`;
        const existingFile = treeData.tree.find(item =>
            item.type === 'blob' && item.path.startsWith(currentPath + '.')
        );

        if (!existingFile) {
            throw new Error('Could not find existing emoji file');
        }

        const currentExtension = existingFile.path.split('.').pop();
        const finalExtension = fileExtension || currentExtension;
        const newPath = `${finalFolder}/${finalName}.${finalExtension}`;

        // Build tree changes
        let treeChanges = [];
        let blobSha = existingFile.sha;

        // If new image data provided, create new blob
        if (newImageData) {
            const blobResponse = await fetch(
                `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/blobs`,
                {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        content: newImageData,
                        encoding: 'base64'
                    })
                }
            );

            if (!blobResponse.ok) {
                throw new Error('Failed to create blob');
            }

            const blob = await blobResponse.json();
            blobSha = blob.sha;
        }

        // If path changed, we need to delete old file and add new one
        const pathChanged = existingFile.path !== newPath;
        if (pathChanged) {
            // Delete old file (set sha to null)
            treeChanges.push({
                path: existingFile.path,
                mode: '100644',
                type: 'blob',
                sha: null
            });
        }

        // Add the new/updated file
        treeChanges.push({
            path: newPath,
            mode: '100644',
            type: 'blob',
            sha: blobSha
        });

        // Create new tree
        const newTreeResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/trees`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    base_tree: currentTreeSha,
                    tree: treeChanges
                })
            }
        );

        if (!newTreeResponse.ok) {
            throw new Error('Failed to create new tree');
        }

        const newTree = await newTreeResponse.json();

        // Create commit
        let commitMessage = 'Update emoji submission';
        if (newName && newFolder) {
            commitMessage = `Update emoji: renamed to ${finalName} and moved to ${finalFolder}/`;
        } else if (newName) {
            commitMessage = `Update emoji: renamed to ${finalName}`;
        } else if (newFolder) {
            commitMessage = `Update emoji: moved to ${finalFolder}/`;
        } else if (newImageData) {
            commitMessage = `Update emoji: replaced image for ${finalName}`;
        }

        const newCommitResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/commits`,
            {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    message: commitMessage,
                    tree: newTree.sha,
                    parents: [branchSha]
                })
            }
        );

        if (!newCommitResponse.ok) {
            throw new Error('Failed to create commit');
        }

        const newCommit = await newCommitResponse.json();

        // Update branch reference
        const updateRefResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${branchName}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({
                    sha: newCommit.sha
                })
            }
        );

        if (!updateRefResponse.ok) {
            throw new Error('Failed to update branch');
        }

        // Update PR title and body if name or folder changed
        if (newName || newFolder) {
            const imageUrl = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${branchName}/${encodeFilePath(finalFolder)}/${encodeURIComponent(finalName)}.${finalExtension}`;
            const prBody = `## Emoji Submission

**Emoji Name:** \`${finalName}\`
**Target Folder:** \`${finalFolder}/\`
**Submitted by:** ${authPayload.username} (via Discord)

### Preview
![${finalName}](${imageUrl})

---
*This PR was automatically created by the Mooncord Emoji Submission system.*`;

            await fetch(
                `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`,
                {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify({
                        title: `Add emoji: ${finalName}`,
                        body: prBody
                    })
                }
            );
        }

        return new Response(JSON.stringify({ success: true, message: 'Submission updated' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error updating submission:', error);
        return new Response(JSON.stringify({ error: error.message || 'Failed to update submission' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Handle DELETE /api/submissions/:number - close a submission
export async function handleCloseSubmission(request, env, prNumber) {
    const authPayload = await verifyAuthToken(request, env);
    if (!authPayload) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    console.log(`Close submission request from user: ${authPayload.username} for PR #${prNumber}`);

    const headers = {
        'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Mooncord-Emoji-Submission-Bot',
        'Content-Type': 'application/json'
    };

    try {
        // Get the PR details
        const prResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`,
            { headers }
        );

        if (!prResponse.ok) {
            return new Response(JSON.stringify({ error: 'Pull request not found' }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const pr = await prResponse.json();

        // Verify ownership
        const submitter = extractSubmitterFromBody(pr.body);
        if (submitter !== authPayload.username) {
            return new Response(JSON.stringify({ error: 'You do not own this submission' }), {
                status: 403,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Close the PR
        const closeResponse = await fetch(
            `${GITHUB_API_BASE}/repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`,
            {
                method: 'PATCH',
                headers,
                body: JSON.stringify({ state: 'closed' })
            }
        );

        if (!closeResponse.ok) {
            throw new Error('Failed to close pull request');
        }

        return new Response(JSON.stringify({ success: true, message: 'Submission closed' }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        console.error('Error closing submission:', error);
        return new Response(JSON.stringify({ error: error.message || 'Failed to close submission' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}
