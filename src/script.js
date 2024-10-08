import './styles.css';
import tmi from 'tmi.js';

// OAuth and tmi.js setup
const clientId = process.env.CLIENT_ID;
const redirectUri = process.env.REDIRECT_URI;
const scopes = 'chat:read chat:edit';

const chatContainer = document.getElementById('chat-container');
const loginContainer = document.getElementById('login-container');
const loginForm = document.getElementById('login-form');
const channelNameElement = document.getElementById('channel-name');
const channelLogoElement = document.getElementById('channel-logo');
const increaseFontButton = document.getElementById('increase-font');
const decreaseFontButton = document.getElementById('decrease-font');
const increaseBoxSizeButton = document.getElementById('increase-box-size');
const decreaseBoxSizeButton = document.getElementById('decrease-box-size');
const loadingOverlay = document.getElementById('loading-overlay');
const toggleTimestampsCheckbox = document.getElementById('toggle-timestamps');
const toggleBadgesCheckbox = document.getElementById('toggle-badges');

let currentFontSize = 10; // Default font size
let currentBoxHeight = 200; // Default box height
let currentBoxWidth = 200; // Default box width
let client; // Declare client variable outside the function
let isListenerAttached = false; // Flag to track event listener attachment
const recentMessages = new Map(); // Map to store recent messages with timestamps
const messageTimeout = 5000; // Time window in milliseconds to consider messages as duplicates

const profileImageCache = new Map(); // Cache for profile image URLs

let currentLayout = 'boxes'; // Default layout
let allMessages = []; // Store all messages

const pinnedUsers = new Set();

function addChatMessage(username, message, badges, profileImageUrl, profileColor) {
    if (!username || !message) {
        console.log('Skipping empty message or username:', { username, message });
        return; // Ensure username and message are not empty
    }

    const now = Date.now();

    // Check if a similar message has been received from the same user within the time window
    if (recentMessages.has(username)) {
       const { lastMessage, timestamp } = recentMessages.get(username); 
        if (lastMessage === message && (now - timestamp) < messageTimeout) {
            console.log('Duplicate message detected, skipping:', message);
            return; // Skip adding the message
        }
    }

    // Update the recent messages map
    recentMessages.set(username, { lastMessage: message, timestamp: now });

    // Store the message in allMessages
    allMessages.push({ username, message, badges, profileImageUrl, profileColor, timestamp: now });
    
    if (currentLayout === 'boxes') {
        let chatBox = document.getElementById(username);
        if (!chatBox) {
            chatBox = createChatBox(username, badges, profileImageUrl, profileColor);
            chatContainer.insertBefore(chatBox, chatContainer.firstChild);
        } else {
            chatContainer.insertBefore(chatBox, chatContainer.firstChild);
        }
        const messagesDiv = chatBox.querySelector('.messages');
        const messageElement = createMessageElement(message);
        messagesDiv.insertBefore(messageElement, messagesDiv.firstChild);
        
        // Apply current size to the chat box
        chatBox.style.height = `${currentBoxHeight}px`;
        chatBox.style.width = `${currentBoxWidth}px`;
    } else {
        const chatBox = createChatBox(username, badges, profileImageUrl, profileColor);
        const messagesDiv = chatBox.querySelector('.messages');
        const messageElement = createMessageElement(message);
        messagesDiv.appendChild(messageElement);
        chatContainer.insertBefore(chatBox, chatContainer.firstChild); // Insert at the top for standard layout
        
        // Scroll to the bottom of the chat container
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Show the chat container if it's hidden
    chatContainer.classList.remove('hidden');
}

function createChatBox(username, badges, profileImageUrl, profileColor) {
    const chatBox = document.createElement('div');
    chatBox.id = username;
    chatBox.className = 'chat-box';
    chatBox.style.height = `${currentBoxHeight}px`;
    chatBox.style.width = `${currentBoxWidth}px`;
    chatBox.innerHTML = `
        <div class="username" data-username="${username}" data-display-name="${username}">
            <img src="${profileImageUrl}" class="profile-image" alt="${username}">
            <span class="badges">${getBadgesHTML(badges)}</span>
            <span class="username-text" style="color: ${profileColor};">${username}</span>
            <button class="pin-button" onclick="togglePin('${username}')">📌</button>
        </div>
        <div class="messages"></div>`;
    return chatBox;
}

function createMessageElement(message) {
    const messageElement = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    messageElement.innerHTML = `<span class="timestamp" style="font-size: ${Math.max(currentFontSize - 2, 8)}px">${timestamp}</span> ${message}`;
    messageElement.style.fontSize = `${currentFontSize}px`;
    return messageElement;
}

function getBadgesHTML(badges) {
    if (!badges) return '';
    return Object.keys(badges).map(badge => {
        const badgeVersion = badges[badge];
        const badgeUrl = `https://static-cdn.jtvnw.net/badges/v1/${badge}/${badgeVersion}/1`;
        return `<img src="${badgeUrl}" class="badge" alt="${badge}">`;
    }).join('');
}

async function fetchProfileImageUrl(username, token, callback) {
     //console.log('Fetching profile image URL for:', username); 
     //console.log('Using token:', token); 

    return fetch(`https://api.twitch.tv/helix/users?login=${username}`, {
        headers: {
            'Authorization': `Bearer ${token}`, // Ensure the token is correct
            'Client-Id': clientId // Ensure the client ID is correct
        }
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        const profileImageUrl = data.data[0].profile_image_url;
        callback(profileImageUrl);
    })
    .catch(error => {
        console.error('There was a problem with the fetch operation:', error);
        callback(null); // Pass null if there was an error
    });
}

function getOAuthToken() {
    const urlParams = new URLSearchParams(window.location.hash.substring(1));
    const token = urlParams.get('access_token');
    
    // // Remove the access token from the URL
    // if (token) {
    //     history.replaceState(null, null, ' ');
    // }
    
    return token;
}

async function authenticate(username, channelName) {
    const token = getOAuthToken();
    if (!token) {
        const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&response_type=token&scope=${scopes}`;
        window.location = authUrl;
    } else {
        return connectToTwitchChat(token, username, channelName);
    }
}

async function connectToTwitchChat(token, username, channelName) {
    console.log('Connecting to Twitch chat...');
    if (client) {
        console.log('Disconnecting existing client...');
        client.disconnect(); // Disconnect existing client if any
        isListenerAttached = false; // Reset the flag when disconnecting
    }

    client = new tmi.Client({
        // set debug to false to stop receiving debug messages
        options: { debug: false },
        connection: {
            reconnect: true,
            secure: true
        },
        identity: {
            username: username,
            password: `oauth:${token}`
        },
        channels: [ channelName ]
    });

    await client.connect();

    // Ensure the event listener is attached only once
    if (!isListenerAttached) {
        console.log('Attaching event listener...');
        client.on('message', (channel, tags, message, self) => {
            if(self) return; // Ignore messages from the bot itself

            const displayName = tags['display-name'] || tags['username'];
            const badges = tags['badges']; // Get badges from tags
            const profileColor = tags['color']; // Get profile color from tags
            //console.log(`Message received from ${displayName}: ${message}`);

            const token = getOAuthToken(); // Get the token

            if (!token) {
                console.error('OAuth token is missing or invalid');
                return;
            }

            if (profileImageCache.has(displayName)) {
                const profileImageUrl = profileImageCache.get(displayName);
                addChatMessage(displayName, message, badges, profileImageUrl, profileColor);
            } else {
                fetchProfileImageUrl(displayName, token, (profileImageUrl) => {
                    if (profileImageUrl) {
                        profileImageCache.set(displayName, profileImageUrl);
                    }
                    addChatMessage(displayName, message, badges, profileImageUrl, profileColor);
                });
            }
        });
        isListenerAttached = true; // Set the flag to true after attaching the listener
    }

    // Fetch and display channel information
    fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Client-ID': clientId
        }
    })
    .then(response => response.json())
    .then(data => {
        if (data.data && data.data.length > 0) {
            const channelInfo = data.data[0];
            channelNameElement.textContent = channelInfo.display_name;
            channelLogoElement.src = channelInfo.profile_image_url;
            localStorage.setItem('channelLogoUrl', channelInfo.profile_image_url); // Store the channel logo URL
        }
    })
    .catch(error => {
        console.error('Error fetching channel information:', error);
    });
}

// Check for access token on page load
window.addEventListener('load', async() => {
    const token = getOAuthToken();
    const channelIcon = document.getElementById('channel-logo');
    const channelNameElement = document.getElementById('channel-name');
    if (token) {
        const username = localStorage.getItem('username');
        const channelName = localStorage.getItem('channelName');
        const channelLogoUrl = localStorage.getItem('channelLogoUrl'); // Assuming you store the channel logo URL
        if (username && channelName) {
            loginContainer.style.display = 'none';
            chatContainer.classList.remove('hidden');
            await connectToTwitchChat(token, username, channelName);
            // Set the channel logo source
            channelIcon.src = channelLogoUrl;
            channelNameElement.textContent = channelName;
        }
    }
    // Hide the loading overlay once the page is fully loaded
    loadingOverlay.style.display = 'none';

    // Hide the chat container initially
    chatContainer.classList.add('hidden');

    // Set the initial layout
    currentLayout = localStorage.getItem('chatLayout') || 'boxes';
    document.querySelector(`input[name="chat-layout"][value="${currentLayout}"]`).checked = true;
    updateChatLayout();
    toggleBoxSizeControls(currentLayout === 'boxes'); // Set initial visibility of box size controls

    // Set initial badge visibility
    toggleBadges(toggleBadgesCheckbox.checked);
});

loginForm.addEventListener('submit', function(event) {
    event.preventDefault();
    const username = document.getElementById('username').value;
    const channelName = document.getElementById('channel').value;
    localStorage.setItem('username', username);
    localStorage.setItem('channelName', channelName);
    loginContainer.style.display = 'none';
    chatContainer.classList.remove('hidden');
    authenticate(username, channelName);
});

// Font size adjustment controls
increaseFontButton.addEventListener('click', () => {
    currentFontSize += 2;
    updateFontSize();
});

decreaseFontButton.addEventListener('click', () => {
    currentFontSize -= 2;
    updateFontSize();
});

function updateFontSize() {
    const messageElements = document.querySelectorAll('.messages div');
    messageElements.forEach(element => {
        element.style.fontSize = `${currentFontSize}px`;
        const timestamp = element.querySelector('.timestamp');
        if (timestamp) {
            timestamp.style.fontSize = `${Math.max(currentFontSize - 2, 8)}px`; // Slightly smaller, but not less than 8px
        }
    });
}

// Box size adjustment controls
document.addEventListener('DOMContentLoaded', () => {
    const increaseBoxHeightButton = document.getElementById('increase-box-height');
    const decreaseBoxHeightButton = document.getElementById('decrease-box-height');
    const increaseBoxWidthButton = document.getElementById('increase-box-width');
    const decreaseBoxWidthButton = document.getElementById('decrease-box-width');

    increaseBoxHeightButton.addEventListener('click', () => {
        currentBoxHeight += 20;
        updateBoxSizes();
    });

    decreaseBoxHeightButton.addEventListener('click', () => {
        currentBoxHeight = Math.max(100, currentBoxHeight - 20); // Minimum height of 100px
        updateBoxSizes();
    });

    increaseBoxWidthButton.addEventListener('click', () => {
        currentBoxWidth += 20;
        updateBoxSizes();
    });

    decreaseBoxWidthButton.addEventListener('click', () => {
        currentBoxWidth = Math.max(150, currentBoxWidth - 20); // Minimum width of 150px
        updateBoxSizes();
    });
});

function updateBoxSizes() {
    if (currentLayout === 'boxes') {
        const chatBoxes = document.querySelectorAll('.chat-box');
        chatBoxes.forEach(chatBox => {
            chatBox.style.height = `${currentBoxHeight}px`;
            chatBox.style.width = `${currentBoxWidth}px`;
        });
        updateGridLayout();
    }
}

function updateGridLayout() {
    const chatContainer = document.getElementById('chat-container');
    chatContainer.style.gridTemplateColumns = `repeat(auto-fill, minmax(${currentBoxWidth}px, 1fr))`;
}

function updateChatLayout() {
    chatContainer.innerHTML = ''; // Clear existing messages
    
    if (currentLayout === 'boxes') {
        chatContainer.className = 'boxes-layout';
        const userBoxes = {};
        
        // Add pinned boxes first
        pinnedUsers.forEach(username => {
            const messageData = allMessages.find(msg => msg.username === username);
            if (messageData) {
                const { badges, profileImageUrl, profileColor } = messageData;
                const chatBox = createChatBox(username, badges, profileImageUrl, profileColor);
                chatBox.classList.add('pinned');
                userBoxes[username] = chatBox;
                chatContainer.appendChild(chatBox);
            }
        });
        
        // Add remaining boxes
        allMessages.slice().reverse().forEach(({ username, message, badges, profileImageUrl, profileColor }) => {
            if (!userBoxes[username]) {
                const chatBox = createChatBox(username, badges, profileImageUrl, profileColor);
                userBoxes[username] = chatBox;
                chatContainer.appendChild(chatBox);
            }
            const messagesDiv = userBoxes[username].querySelector('.messages');
            const messageElement = createMessageElement(message);
            messagesDiv.insertBefore(messageElement, messagesDiv.firstChild);
        });
        updateBoxSizes();
        toggleBoxSizeControls(true); // Show box size controls
    } else {
        chatContainer.className = 'standard-layout';
        
        allMessages.slice().reverse().forEach(({ username, message, badges, profileImageUrl, profileColor }) => {
            const chatBox = createChatBox(username, badges, profileImageUrl, profileColor);
            const messagesDiv = chatBox.querySelector('.messages');
            const messageElement = createMessageElement(message);
            messagesDiv.appendChild(messageElement);
            chatContainer.appendChild(chatBox);
        });
        toggleBoxSizeControls(false); // Hide box size controls
    }

    updateBoxSizes();
    updateGridLayout();
}

// Event listener for the toggle timestamps checkbox
toggleTimestampsCheckbox.addEventListener('change', (event) => {
    if (event.target.checked) {
        chatContainer.classList.add('show-timestamps');
    } else {
        chatContainer.classList.remove('show-timestamps');
    }
});

// Add display name beside username if different
document.querySelectorAll('.chat-box .username').forEach(usernameElement => {
    const username = usernameElement.getAttribute('data-username');
    const displayName = usernameElement.getAttribute('data-display-name');

    if (displayName && displayName !== username) {
        const displayNameElement = document.createElement('span');
        displayNameElement.className = 'display-name';
        displayNameElement.textContent = `(${displayName})`;
        usernameElement.appendChild(displayNameElement);
    }
});

// Settings pane toggle functionality
const toggleSettingsButton = document.getElementById('toggle-settings');
const settingsPane = document.getElementById('settings-pane');
const closeSettingsButton = document.getElementById('close-settings');

toggleSettingsButton.addEventListener('click', () => {
  settingsPane.classList.toggle('open');
});

closeSettingsButton.addEventListener('click', () => {
  settingsPane.classList.remove('open');
});

// Close settings pane when clicking outside of it
document.addEventListener('click', (event) => {
  if (!settingsPane.contains(event.target) && event.target !== toggleSettingsButton) {
    settingsPane.classList.remove('open');
  }
});

// Add event listener for layout change
document.querySelectorAll('input[name="chat-layout"]').forEach(radio => {
  radio.addEventListener('change', (event) => {
    currentLayout = event.target.value;
    localStorage.setItem('chatLayout', currentLayout);
    updateChatLayout();
    chatContainer.style.flexDirection = currentLayout === 'boxes' ? 'row' : 'column';
    toggleBoxSizeControls(currentLayout === 'boxes'); // Show/hide box size controls based on layout
  });
});

function toggleBoxSizeControls(show) {
    const boxSizeControls = document.querySelectorAll('#increase-box-height, #decrease-box-height, #increase-box-width, #decrease-box-width');
    boxSizeControls.forEach(button => {
        button.style.display = show ? 'inline-block' : 'none';
    });
}

// Add this function to toggle badge visibility
function toggleBadges(show) {
    chatContainer.classList.toggle('hide-badges', !show);
}

// Add this event listener with the other event listeners
toggleBadgesCheckbox.addEventListener('change', (event) => {
    toggleBadges(event.target.checked);
});

function togglePin(username) {
    const chatBox = document.getElementById(username);
    if (pinnedUsers.has(username)) {
        pinnedUsers.delete(username);
        chatBox.classList.remove('pinned');
    } else {
        pinnedUsers.add(username);
        chatBox.classList.add('pinned');
    }
    updateChatLayout();
}
