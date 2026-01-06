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

// State
let authToken = null;
let currentUsername = null;
let currentAvatar = null;
let foldersLoaded = false;

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

    if (token && username) {
        authToken = token;
        currentUsername = username;
        currentAvatar = avatar || '';
        localStorage.setItem('authToken', token);
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
function checkExistingSession() {
    const storedToken = localStorage.getItem('authToken');
    const storedUsername = localStorage.getItem('username');
    const storedAvatar = localStorage.getItem('avatar');

    if (storedToken && storedUsername) {
        authToken = storedToken;
        currentUsername = storedUsername;
        currentAvatar = storedAvatar || '';
        showSection('form');
        updateAccountDisplay();
    }
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
    authToken = null;
    currentUsername = null;
    localStorage.removeItem('authToken');
    localStorage.removeItem('username');
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
        // Read file as base64
        const base64Data = await readFileAsBase64(imageFile);

        // Get file extension
        const extension = getFileExtension(imageFile.name);

        // Submit to API
        const response = await fetch(API_BASE_URL + '/api/submit', {
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

        const result = await response.json();

        if (!response.ok) {
            // If unauthorized, token is expired/invalid - redirect to login
            if (response.status === 401) {
                localStorage.removeItem('authToken');
                localStorage.removeItem('username');
                localStorage.removeItem('avatar');
                authToken = null;
                currentUsername = null;
                currentAvatar = null;
                handleLogin();
                return;
            }
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
