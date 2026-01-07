// Configuration - UPDATE THIS after deploying the Cloudflare Worker
const API_BASE_URL = 'https://mooncord-emoji-api.mooncord-emojis.workers.dev';

// DOM Elements
const loginSection = document.getElementById('loginSection');
const notMemberSection = document.getElementById('notMemberSection');
const formSection = document.getElementById('formSection');
const statusSection = document.getElementById('statusSection');
const loadingStatus = document.getElementById('loadingStatus');
const successStatus = document.getElementById('successStatus');
const errorStatus = document.getElementById('errorStatus');

const loginBtn = document.getElementById('loginBtn');
const retryLoginBtn = document.getElementById('retryLoginBtn');
const logoutBtn = document.getElementById('logoutBtn');

const accountDropdown = document.getElementById('accountDropdown');
const accountBtn = document.getElementById('accountBtn');
const accountAvatar = document.getElementById('accountAvatar');
const accountName = document.getElementById('accountName');

const emojiForm = document.getElementById('emojiForm');
const emojiNameInput = document.getElementById('emojiName');
const targetFolderInput = document.getElementById('targetFolder');
const folderTree = document.getElementById('folderTree');
const imageFileInput = document.getElementById('imageFile');
const updateExistingCheckbox = document.getElementById('updateExisting');
const previewContainer = document.getElementById('previewContainer');
const imagePreview = document.getElementById('imagePreview');
const submitBtn = document.getElementById('submitBtn');

const prLink = document.getElementById('prLink');
const submitAnotherBtn = document.getElementById('submitAnotherBtn');
const tryAgainBtn = document.getElementById('tryAgainBtn');
const errorMessage = document.getElementById('errorMessage');

const confirmModal = document.getElementById('confirmModal');
const confirmEmojiName = document.getElementById('confirmEmojiName');
const confirmTargetFolder = document.getElementById('confirmTargetFolder');
const confirmImagePreview = document.getElementById('confirmImagePreview');
const confirmCancelBtn = document.getElementById('confirmCancelBtn');
const confirmSubmitBtn = document.getElementById('confirmSubmitBtn');
const modalBackdrop = document.querySelector('.modal-backdrop');

// Submissions section elements
const submissionsSection = document.getElementById('submissionsSection');
const submissionsLoading = document.getElementById('submissionsLoading');
const submissionsEmpty = document.getElementById('submissionsEmpty');
const submissionsList = document.getElementById('submissionsList');

// Edit modal elements
const editModal = document.getElementById('editModal');
const editEmojiNameInput = document.getElementById('editEmojiName');
const editFolderTree = document.getElementById('editFolderTree');
const editTargetFolderInput = document.getElementById('editTargetFolder');
const editImageFileInput = document.getElementById('editImageFile');
const editPreviewContainer = document.getElementById('editPreviewContainer');
const editImagePreview = document.getElementById('editImagePreview');
const editCancelBtn = document.getElementById('editCancelBtn');
const editSubmitBtn = document.getElementById('editSubmitBtn');
const editModalBackdrop = document.querySelector('.edit-modal-backdrop');

// Close modal elements
const closeModal = document.getElementById('closeModal');
const closeEmojiName = document.getElementById('closeEmojiName');
const closeImagePreview = document.getElementById('closeImagePreview');
const closeCancelBtn = document.getElementById('closeCancelBtn');
const closeConfirmBtn = document.getElementById('closeConfirmBtn');
const closeModalBackdrop = document.querySelector('.close-modal-backdrop');

// State
let authToken = null;
let refreshToken = null;
let currentUsername = null;
let currentAvatar = null;
let foldersLoaded = false;
let editFoldersLoaded = false;
let userSubmissions = [];
let editingSubmission = null;
let closingSubmission = null;

// Check if a JWT token is expired
function isTokenExpired(token) {
    if (!token) {
        return true;
    }
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expirationTime = payload.exp * 1000;
        // Consider expired if less than 30 seconds remaining
        return Date.now() >= expirationTime - 30000;
    } catch (e) {
        return true;
    }
}

// Refresh the access token using the refresh token
async function refreshAccessToken() {
    if (!refreshToken) {
        return false;
    }

    try {
        const response = await fetch(API_BASE_URL + '/auth/refresh', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refreshToken: refreshToken })
        });

        if (!response.ok) {
            return false;
        }

        const data = await response.json();
        authToken = data.token;
        localStorage.setItem('authToken', authToken);
        return true;
    } catch (e) {
        console.error('Failed to refresh token:', e);
        return false;
    }
}

// Ensure we have a valid access token, refreshing if needed
async function ensureValidToken() {
    if (!isTokenExpired(authToken)) {
        return true;
    }

    const refreshed = await refreshAccessToken();
    if (!refreshed) {
        clearAuthState();
        return false;
    }
    return true;
}

// Clear all auth state
function clearAuthState() {
    authToken = null;
    refreshToken = null;
    currentUsername = null;
    currentAvatar = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('username');
    localStorage.removeItem('avatar');
}

// Initialize
document.addEventListener('DOMContentLoaded', function() {
    checkAuthCallback();
    checkExistingSession();
    setupEventListeners();
});

function setupEventListeners() {
    loginBtn.addEventListener('click', handleLogin);
    retryLoginBtn.addEventListener('click', handleLogin);
    logoutBtn.addEventListener('click', handleLogout);
    imageFileInput.addEventListener('change', handleImageSelect);
    emojiForm.addEventListener('submit', handleFormSubmit);
    submitAnotherBtn.addEventListener('click', resetForm);
    tryAgainBtn.addEventListener('click', resetForm);

    // Modal event listeners
    confirmCancelBtn.addEventListener('click', hideConfirmModal);
    confirmSubmitBtn.addEventListener('click', handleConfirmedSubmit);
    modalBackdrop.addEventListener('click', hideConfirmModal);

    // Edit modal event listeners
    editCancelBtn.addEventListener('click', hideEditModal);
    editSubmitBtn.addEventListener('click', handleEditSubmit);
    editModalBackdrop.addEventListener('click', hideEditModal);
    editImageFileInput.addEventListener('change', handleEditImageSelect);

    // Close modal event listeners
    closeCancelBtn.addEventListener('click', hideCloseModal);
    closeConfirmBtn.addEventListener('click', handleCloseSubmission);
    closeModalBackdrop.addEventListener('click', hideCloseModal);

    // Account dropdown
    accountBtn.addEventListener('click', toggleAccountDropdown);
    document.addEventListener('click', function(event) {
        if (!accountDropdown.contains(event.target)) {
            accountDropdown.classList.remove('open');
        }
    });
}

// Check for OAuth callback in URL
function checkAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const refresh = urlParams.get('refreshToken');
    const username = urlParams.get('username');
    const avatar = urlParams.get('avatar');
    const error = urlParams.get('error');

    // Clear URL params
    if (token || error) {
        window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (error === 'not_a_member') {
        showSection('notMember');
        return;
    }

    if (error) {
        showSection('login');
        alert('Login failed: ' + error);
        return;
    }

    if (token && refresh && username) {
        authToken = token;
        refreshToken = refresh;
        currentUsername = username;
        currentAvatar = avatar || '';
        localStorage.setItem('authToken', token);
        localStorage.setItem('refreshToken', refresh);
        localStorage.setItem('username', username);
        localStorage.setItem('avatar', avatar || '');
        showSection('form');
        updateAccountDisplay();
    }
}

// Toggle account dropdown
function toggleAccountDropdown(event) {
    event.stopPropagation();
    accountDropdown.classList.toggle('open');
}

// Update account display
function updateAccountDisplay() {
    accountName.textContent = currentUsername;
    if (currentAvatar) {
        accountAvatar.src = currentAvatar;
        accountAvatar.style.display = 'block';
    } else {
        accountAvatar.style.display = 'none';
    }
}

// Check for existing session
async function checkExistingSession() {
    const storedToken = localStorage.getItem('authToken');
    const storedRefreshToken = localStorage.getItem('refreshToken');
    const storedUsername = localStorage.getItem('username');
    const storedAvatar = localStorage.getItem('avatar');

    if (!storedRefreshToken || !storedUsername) {
        return;
    }

    authToken = storedToken;
    refreshToken = storedRefreshToken;
    currentUsername = storedUsername;
    currentAvatar = storedAvatar || '';

    // If access token is expired, try to refresh it
    if (isTokenExpired(authToken)) {
        const refreshed = await refreshAccessToken();
        if (!refreshed) {
            clearAuthState();
            return;
        }
    }

    showSection('form');
    updateAccountDisplay();
}

// Fetch folders from API and build tree UI
async function loadFolders() {
    if (foldersLoaded) {
        return;
    }

    try {
        const response = await fetch(API_BASE_URL + '/api/folders');
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch folders');
        }

        // Build tree structure from flat folder list
        const tree = buildFolderTree(data.folders);

        // Render the tree
        folderTree.innerHTML = '';
        renderFolderTree(tree, folderTree);

        foldersLoaded = true;

    } catch (err) {
        console.error('Failed to load folders:', err);
        folderTree.innerHTML = '<div class="folder-tree-error">Error loading folders - refresh page</div>';
    }
}

// Build hierarchical tree from flat folder paths
function buildFolderTree(folders) {
    const tree = {};

    folders.forEach(function(path) {
        const parts = path.split('/');
        let current = tree;

        parts.forEach(function(part, index) {
            if (!current[part]) {
                current[part] = {
                    fullPath: parts.slice(0, index + 1).join('/'),
                    children: {}
                };
            }
            current = current[part].children;
        });
    });

    return tree;
}

// Render folder tree recursively
function renderFolderTree(tree, container) {
    const sortedKeys = Object.keys(tree).sort();

    sortedKeys.forEach(function(name) {
        const node = tree[name];
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'folder-node';

        const itemDiv = document.createElement('div');
        itemDiv.className = 'folder-item';
        itemDiv.dataset.path = node.fullPath;
        itemDiv.innerHTML = '<span class="folder-icon">📁</span><span class="folder-name">' + name + '</span>';

        itemDiv.addEventListener('click', function() {
            selectFolder(node.fullPath, itemDiv);
        });

        nodeDiv.appendChild(itemDiv);

        // Render children if any
        const hasChildren = Object.keys(node.children).length > 0;
        if (hasChildren) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'folder-children';
            renderFolderTree(node.children, childrenDiv);
            nodeDiv.appendChild(childrenDiv);
        }

        container.appendChild(nodeDiv);
    });
}

// Handle folder selection
function selectFolder(path, element) {
    // Remove selected class from all items
    const allItems = folderTree.querySelectorAll('.folder-item');
    allItems.forEach(function(item) {
        item.classList.remove('selected');
    });

    // Add selected class to clicked item
    element.classList.add('selected');

    // Update hidden input value
    targetFolderInput.value = path;
}

// Show/hide sections
function showSection(section) {
    loginSection.classList.add('hidden');
    notMemberSection.classList.add('hidden');
    formSection.classList.add('hidden');
    statusSection.classList.add('hidden');
    loadingStatus.classList.add('hidden');
    successStatus.classList.add('hidden');
    errorStatus.classList.add('hidden');
    accountDropdown.classList.add('hidden');
    accountDropdown.classList.remove('open');

    switch (section) {
        case 'login':
            loginSection.classList.remove('hidden');
            break;
        case 'notMember':
            notMemberSection.classList.remove('hidden');
            break;
        case 'form':
            formSection.classList.remove('hidden');
            accountDropdown.classList.remove('hidden');
            loadFolders();
            loadUserSubmissions();
            break;
        case 'loading':
            statusSection.classList.remove('hidden');
            loadingStatus.classList.remove('hidden');
            accountDropdown.classList.remove('hidden');
            break;
        case 'success':
            statusSection.classList.remove('hidden');
            successStatus.classList.remove('hidden');
            accountDropdown.classList.remove('hidden');
            break;
        case 'error':
            statusSection.classList.remove('hidden');
            errorStatus.classList.remove('hidden');
            accountDropdown.classList.remove('hidden');
            break;
    }
}

// Handle Discord login
function handleLogin() {
    const currentUrl = window.location.origin + window.location.pathname;
    const authUrl = API_BASE_URL + '/auth/discord?redirect=' + encodeURIComponent(currentUrl);
    window.location.href = authUrl;
}

// Handle logout
function handleLogout() {
    clearAuthState();
    showSection('login');
    resetFormFields();
}

// Handle image selection
function handleImageSelect(event) {
    const file = event.target.files[0];

    if (!file) {
        previewContainer.classList.add('hidden');
        return;
    }

    // Validate file size (10MB max)
    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        alert('File is too large. Maximum size is 10MB.');
        imageFileInput.value = '';
        previewContainer.classList.add('hidden');
        return;
    }

    // Validate file type
    const validTypes = ['image/png', 'image/gif', 'image/webp', 'image/jpeg'];
    if (!validTypes.includes(file.type)) {
        alert('Invalid file type. Please upload a GIF, JPG, PNG, or WEBP image.');
        imageFileInput.value = '';
        previewContainer.classList.add('hidden');
        return;
    }

    // Show preview
    const reader = new FileReader();
    reader.onload = function(e) {
        imagePreview.src = e.target.result;
        previewContainer.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

// Handle form submission - show confirmation modal
function handleFormSubmit(event) {
    event.preventDefault();

    const emojiName = emojiNameInput.value.trim();
    const targetFolder = targetFolderInput.value;
    const imageFile = imageFileInput.files[0];

    if (!emojiName || !targetFolder || !imageFile) {
        alert('Please fill in all fields.');
        return;
    }

    // Validate emoji name - disallow characters invalid in filenames
    const invalidChars = /[\/\\:*?"<>|]/;
    if (invalidChars.test(emojiName)) {
        alert('Emoji name cannot contain: / \\ : * ? " < > |');
        return;
    }

    // Show confirmation modal
    showConfirmModal(emojiName, targetFolder);
}

// Show confirmation modal
function showConfirmModal(emojiName, targetFolder) {
    confirmEmojiName.textContent = emojiName;
    confirmTargetFolder.textContent = targetFolder + '/';
    confirmImagePreview.src = imagePreview.src;
    confirmModal.classList.remove('hidden');
}

// Hide confirmation modal
function hideConfirmModal() {
    confirmModal.classList.add('hidden');
}

// Handle confirmed submission
async function handleConfirmedSubmit() {
    hideConfirmModal();
    showSection('loading');

    const emojiName = emojiNameInput.value.trim();
    const targetFolder = targetFolderInput.value;
    const imageFile = imageFileInput.files[0];
    const updateExisting = updateExistingCheckbox.checked;

    try {
        // Ensure we have a valid token before submitting
        const hasValidToken = await ensureValidToken();
        if (!hasValidToken) {
            handleLogin();
            return;
        }

        // Read file as base64
        const base64Data = await readFileAsBase64(imageFile);

        // Get file extension
        const extension = getFileExtension(imageFile.name);

        // Submit to API
        let response = await fetch(API_BASE_URL + '/api/submit', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify({
                emojiName: emojiName,
                targetFolder: targetFolder,
                imageData: base64Data,
                fileExtension: extension,
                updateExisting: updateExisting
            })
        });

        // If unauthorized, try refreshing token and retry once
        if (response.status === 401) {
            const refreshed = await refreshAccessToken();
            if (refreshed) {
                response = await fetch(API_BASE_URL + '/api/submit', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': 'Bearer ' + authToken
                    },
                    body: JSON.stringify({
                        emojiName: emojiName,
                        targetFolder: targetFolder,
                        imageData: base64Data,
                        fileExtension: extension,
                        updateExisting: updateExisting
                    })
                });
            } else {
                clearAuthState();
                handleLogin();
                return;
            }
        }

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to create pull request');
        }

        // Success
        prLink.href = result.prUrl;
        showSection('success');

    } catch (err) {
        console.error('Submission error:', err);
        errorMessage.textContent = err.message || 'Something went wrong. Please try again.';
        showSection('error');
    }
}

// Read file as base64
function readFileAsBase64(file) {
    return new Promise(function(resolve, reject) {
        const reader = new FileReader();
        reader.onload = function() {
            // Remove data URL prefix to get just the base64 data
            const base64 = reader.result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = function() {
            reject(new Error('Failed to read file'));
        };
        reader.readAsDataURL(file);
    });
}

// Get file extension
function getFileExtension(filename) {
    const parts = filename.split('.');
    if (parts.length > 1) {
        return parts[parts.length - 1].toLowerCase();
    }
    return 'png';
}

// Reset form to submit another
function resetForm() {
    resetFormFields();
    showSection('form');
}

// Reset form fields
function resetFormFields() {
    emojiForm.reset();
    previewContainer.classList.add('hidden');
    imagePreview.src = '';

    // Clear folder tree selection
    const allItems = folderTree.querySelectorAll('.folder-item');
    allItems.forEach(function(item) {
        item.classList.remove('selected');
    });
    targetFolderInput.value = '';
}

// Load user submissions
async function loadUserSubmissions() {
    submissionsLoading.classList.remove('hidden');
    submissionsEmpty.classList.add('hidden');
    submissionsList.classList.add('hidden');

    try {
        const hasValidToken = await ensureValidToken();
        if (!hasValidToken) {
            return;
        }

        const response = await fetch(API_BASE_URL + '/api/submissions', {
            method: 'GET',
            headers: {
                'Authorization': 'Bearer ' + authToken
            }
        });

        if (!response.ok) {
            throw new Error('Failed to fetch submissions');
        }

        const data = await response.json();
        userSubmissions = data.submissions || [];

        submissionsLoading.classList.add('hidden');

        if (userSubmissions.length === 0) {
            submissionsEmpty.classList.remove('hidden');
        } else {
            renderSubmissionsList();
            submissionsList.classList.remove('hidden');
        }
    } catch (err) {
        console.error('Failed to load submissions:', err);
        submissionsLoading.classList.add('hidden');
        submissionsEmpty.classList.remove('hidden');
        submissionsEmpty.querySelector('p').textContent = 'Failed to load submissions.';
    }
}

// Render submissions list
function renderSubmissionsList() {
    submissionsList.innerHTML = '';

    userSubmissions.forEach(function(submission) {
        const card = document.createElement('div');
        card.className = 'submission-card';

        let labelsHtml = '';
        if (submission.labels && submission.labels.length > 0) {
            labelsHtml = '<div class="submission-labels">';
            submission.labels.forEach(function(label) {
                labelsHtml += '<span class="submission-label" style="background-color: #' + label.color + '">' + label.name + '</span>';
            });
            labelsHtml += '</div>';
        }

        card.innerHTML = `
            <div class="submission-image">
                <img src="${submission.imageUrl || ''}" alt="${submission.emojiName || 'Emoji'}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2248%22 height=%2248%22><rect fill=%22%23333%22 width=%22100%%22 height=%22100%%22/><text x=%2250%%22 y=%2250%%22 fill=%22%23666%22 text-anchor=%22middle%22 dy=%22.3em%22>?</text></svg>'">
            </div>
            <div class="submission-info">
                <div class="submission-name">${submission.emojiName || 'Unknown'}</div>
                <div class="submission-folder">${submission.folder || 'Unknown folder'}</div>
                ${labelsHtml}
            </div>
            <div class="submission-actions">
                <a href="${submission.htmlUrl}" target="_blank" class="submission-btn view-btn" title="View PR">View</a>
                <button class="submission-btn edit-btn" data-pr="${submission.number}" title="Edit">Edit</button>
                <button class="submission-btn close-btn" data-pr="${submission.number}" title="Close">Close</button>
            </div>
        `;

        // Add event listeners
        card.querySelector('.edit-btn').addEventListener('click', function() {
            showEditModal(submission);
        });
        card.querySelector('.close-btn').addEventListener('click', function() {
            showCloseModal(submission);
        });

        submissionsList.appendChild(card);
    });
}

// Load folders for edit modal
async function loadEditFolders() {
    if (editFoldersLoaded) {
        return;
    }

    try {
        const response = await fetch(API_BASE_URL + '/api/folders');
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Failed to fetch folders');
        }

        const tree = buildFolderTree(data.folders);
        editFolderTree.innerHTML = '';
        renderEditFolderTree(tree, editFolderTree);
        editFoldersLoaded = true;
    } catch (err) {
        console.error('Failed to load folders for edit:', err);
        editFolderTree.innerHTML = '<div class="folder-tree-error">Error loading folders</div>';
    }
}

// Render folder tree for edit modal
function renderEditFolderTree(tree, container) {
    const sortedKeys = Object.keys(tree).sort();

    sortedKeys.forEach(function(name) {
        const node = tree[name];
        const nodeDiv = document.createElement('div');
        nodeDiv.className = 'folder-node';

        const itemDiv = document.createElement('div');
        itemDiv.className = 'folder-item';
        itemDiv.dataset.path = node.fullPath;
        itemDiv.innerHTML = '<span class="folder-icon">📁</span><span class="folder-name">' + name + '</span>';

        itemDiv.addEventListener('click', function() {
            selectEditFolder(node.fullPath, itemDiv);
        });

        nodeDiv.appendChild(itemDiv);

        const hasChildren = Object.keys(node.children).length > 0;
        if (hasChildren) {
            const childrenDiv = document.createElement('div');
            childrenDiv.className = 'folder-children';
            renderEditFolderTree(node.children, childrenDiv);
            nodeDiv.appendChild(childrenDiv);
        }

        container.appendChild(nodeDiv);
    });
}

// Handle folder selection in edit modal
function selectEditFolder(path, element) {
    const allItems = editFolderTree.querySelectorAll('.folder-item');
    allItems.forEach(function(item) {
        item.classList.remove('selected');
    });
    element.classList.add('selected');
    editTargetFolderInput.value = path;
}

// Show edit modal
function showEditModal(submission) {
    editingSubmission = submission;
    editEmojiNameInput.value = '';
    editTargetFolderInput.value = '';
    editImageFileInput.value = '';
    editPreviewContainer.classList.add('hidden');

    // Clear folder selection
    const allItems = editFolderTree.querySelectorAll('.folder-item');
    allItems.forEach(function(item) {
        item.classList.remove('selected');
    });

    loadEditFolders();
    editModal.classList.remove('hidden');
}

// Hide edit modal
function hideEditModal() {
    editModal.classList.add('hidden');
    editingSubmission = null;
}

// Handle image selection in edit modal
function handleEditImageSelect(event) {
    const file = event.target.files[0];

    if (!file) {
        editPreviewContainer.classList.add('hidden');
        return;
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
        alert('File is too large. Maximum size is 10MB.');
        editImageFileInput.value = '';
        editPreviewContainer.classList.add('hidden');
        return;
    }

    const validTypes = ['image/png', 'image/gif', 'image/webp', 'image/jpeg'];
    if (!validTypes.includes(file.type)) {
        alert('Invalid file type. Please upload a GIF, JPG, PNG, or WEBP image.');
        editImageFileInput.value = '';
        editPreviewContainer.classList.add('hidden');
        return;
    }

    const reader = new FileReader();
    reader.onload = function(e) {
        editImagePreview.src = e.target.result;
        editPreviewContainer.classList.remove('hidden');
    };
    reader.readAsDataURL(file);
}

// Handle edit submission
async function handleEditSubmit() {
    if (!editingSubmission) {
        return;
    }

    const newName = editEmojiNameInput.value.trim();
    const newFolder = editTargetFolderInput.value;
    const newImageFile = editImageFileInput.files[0];

    const hasNameChange = newName.length > 0;
    const hasFolderChange = newFolder.length > 0;
    const hasImageChange = newImageFile !== undefined;

    if (!hasNameChange && !hasFolderChange && !hasImageChange) {
        alert('Please make at least one change.');
        return;
    }

    if (hasNameChange) {
        const invalidChars = /[\/\\:*?"<>|]/;
        if (invalidChars.test(newName)) {
            alert('Emoji name cannot contain: / \\ : * ? " < > |');
            return;
        }
        if (newName.length < 2 || newName.length > 80) {
            alert('Emoji name must be between 2 and 80 characters.');
            return;
        }
    }

    editSubmitBtn.disabled = true;
    editSubmitBtn.textContent = 'Saving...';

    try {
        const hasValidToken = await ensureValidToken();
        if (!hasValidToken) {
            handleLogin();
            return;
        }

        const requestBody = {};
        if (hasNameChange) {
            requestBody.newName = newName;
        }
        if (hasFolderChange) {
            requestBody.newFolder = newFolder;
        }
        if (hasImageChange) {
            requestBody.newImageData = await readFileAsBase64(newImageFile);
            requestBody.fileExtension = getFileExtension(newImageFile.name);
        }

        const response = await fetch(API_BASE_URL + '/api/submissions/' + editingSubmission.number, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + authToken
            },
            body: JSON.stringify(requestBody)
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to update submission');
        }

        hideEditModal();
        loadUserSubmissions();
        alert('Submission updated successfully!');
    } catch (err) {
        console.error('Edit submission error:', err);
        alert('Failed to update: ' + err.message);
    } finally {
        editSubmitBtn.disabled = false;
        editSubmitBtn.textContent = 'Save Changes';
    }
}

// Show close confirmation modal
function showCloseModal(submission) {
    closingSubmission = submission;
    closeEmojiName.textContent = submission.emojiName || 'Unknown';
    closeImagePreview.src = submission.imageUrl || '';
    closeModal.classList.remove('hidden');
}

// Hide close modal
function hideCloseModal() {
    closeModal.classList.add('hidden');
    closingSubmission = null;
}

// Handle close submission
async function handleCloseSubmission() {
    if (!closingSubmission) {
        return;
    }

    closeConfirmBtn.disabled = true;
    closeConfirmBtn.textContent = 'Closing...';

    try {
        const hasValidToken = await ensureValidToken();
        if (!hasValidToken) {
            handleLogin();
            return;
        }

        const response = await fetch(API_BASE_URL + '/api/submissions/' + closingSubmission.number, {
            method: 'DELETE',
            headers: {
                'Authorization': 'Bearer ' + authToken
            }
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(result.error || 'Failed to close submission');
        }

        hideCloseModal();
        loadUserSubmissions();
        alert('Submission closed successfully.');
    } catch (err) {
        console.error('Close submission error:', err);
        alert('Failed to close: ' + err.message);
    } finally {
        closeConfirmBtn.disabled = false;
        closeConfirmBtn.textContent = 'Close Submission';
    }
}
