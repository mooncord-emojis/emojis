// Configuration - UPDATE THIS after deploying the Cloudflare Worker
const API_BASE_URL = 'https://mooncord-emojis.workers.dev';

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
const usernameSpan = document.getElementById('username');

const emojiForm = document.getElementById('emojiForm');
const emojiNameInput = document.getElementById('emojiName');
const targetFolderSelect = document.getElementById('targetFolder');
const imageFileInput = document.getElementById('imageFile');
const previewContainer = document.getElementById('previewContainer');
const imagePreview = document.getElementById('imagePreview');
const submitBtn = document.getElementById('submitBtn');

const prLink = document.getElementById('prLink');
const submitAnotherBtn = document.getElementById('submitAnotherBtn');
const tryAgainBtn = document.getElementById('tryAgainBtn');
const errorMessage = document.getElementById('errorMessage');

// State
let authToken = null;
let currentUsername = null;

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
    emojiForm.addEventListener('submit', handleSubmit);
    submitAnotherBtn.addEventListener('click', resetForm);
    tryAgainBtn.addEventListener('click', resetForm);
}

// Check for OAuth callback in URL
function checkAuthCallback() {
    const urlParams = new URLSearchParams(window.location.search);
    const token = urlParams.get('token');
    const username = urlParams.get('username');
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
        sessionStorage.setItem('authToken', token);
        sessionStorage.setItem('username', username);
        showSection('form');
        usernameSpan.textContent = username;
    }
}

// Check for existing session
function checkExistingSession() {
    const storedToken = sessionStorage.getItem('authToken');
    const storedUsername = sessionStorage.getItem('username');

    if (storedToken && storedUsername) {
        authToken = storedToken;
        currentUsername = storedUsername;
        showSection('form');
        usernameSpan.textContent = storedUsername;
    }
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

    switch (section) {
        case 'login':
            loginSection.classList.remove('hidden');
            break;
        case 'notMember':
            notMemberSection.classList.remove('hidden');
            break;
        case 'form':
            formSection.classList.remove('hidden');
            break;
        case 'loading':
            statusSection.classList.remove('hidden');
            loadingStatus.classList.remove('hidden');
            break;
        case 'success':
            statusSection.classList.remove('hidden');
            successStatus.classList.remove('hidden');
            break;
        case 'error':
            statusSection.classList.remove('hidden');
            errorStatus.classList.remove('hidden');
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
    sessionStorage.removeItem('authToken');
    sessionStorage.removeItem('username');
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
    const validTypes = ['image/png', 'image/gif', 'image/webp'];
    if (!validTypes.includes(file.type)) {
        alert('Invalid file type. Please upload a PNG, GIF, or WebP image.');
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

// Handle form submission
async function handleSubmit(event) {
    event.preventDefault();

    const emojiName = emojiNameInput.value.trim();
    const targetFolder = targetFolderSelect.value;
    const imageFile = imageFileInput.files[0];

    if (!emojiName || !targetFolder || !imageFile) {
        alert('Please fill in all fields.');
        return;
    }

    // Validate emoji name
    const namePattern = /^[a-zA-Z0-9_-]+$/;
    if (!namePattern.test(emojiName)) {
        alert('Emoji name can only contain letters, numbers, hyphens, and underscores.');
        return;
    }

    showSection('loading');

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
                fileExtension: extension
            })
        });

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
}
