// Configuration
const API_BASE_URL = '';
const ESCALATION_THRESHOLD = 0.6; // Confidence threshold for escalation

// DOM Elements
const chatMessages = document.getElementById('chatMessages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const statusElement = document.getElementById('status');
const charCount = document.getElementById('charCount');
const clearBtn = document.getElementById('clearBtn');
const statsBtn = document.getElementById('statsBtn');
const statsModal = document.getElementById('statsModal');
const browseBtn = document.getElementById('browseBtn');
const browseModal = document.getElementById('browseModal');
const newTicketBtn = document.getElementById('newTicketBtn');
const newTicketModal = document.getElementById('newTicketModal');
const historyBtn = document.getElementById('historyBtn');
const historyModal = document.getElementById('historyModal');
const logoutBtn = document.getElementById('logoutBtn');
const userProfile = document.getElementById('userProfile');

// Info Panel Elements
const classificationCard = document.getElementById('classificationCard');
const escalationCard = document.getElementById('escalationCard');
const metricsCard = document.getElementById('metricsCard');
const similarCard = document.getElementById('similarCard');

// State
let conversationHistory = [];
let currentTicketData = null;
let viewingBrowseTicket = false; // Flag to track if viewing a browse ticket
let browseTicketData = null; // Store the browse ticket data

document.addEventListener('DOMContentLoaded', () => {
    // Configure session refresh endpoint to point at backend refresh route if session helper is available
    if (typeof setRefreshConfig === 'function') {
        try {
            setRefreshConfig({
                endpoint: `${API_BASE_URL}/refresh_token`,
                method: 'POST',
                requestField: 'refresh_token',
                responseTokenField: 'token',
                responseRefreshField: 'refresh_token'
            });
        } catch (e) {
            console.warn('Failed to set refresh config:', e);
        }
    }

    displayUserInfo();
    checkServerHealth();
    setupEventListeners();
    autoResizeTextarea();
    loadInitialDashboard();
});

// Auth Helpers
function displayUserInfo() {
    const userInfo = (typeof getUserInfo === 'function') ? getUserInfo() : JSON.parse(localStorage.getItem('user_info') || '{}');
    if (userInfo && userInfo.username && userProfile) {
        userProfile.textContent = `User: ${userInfo.username}`;
        userProfile.style.display = 'inline-block';
    }
}

function logout() {
    if (typeof clearAuth === 'function') {
        clearAuth();
    } else {
        // Fallback: clear known session keys
        localStorage.removeItem('auth_token');
        localStorage.removeItem('refresh_token');
        localStorage.removeItem('user_info');
    }
    window.location.href = '/';
}

// Setup Event Listeners
function setupEventListeners() {
    messageInput.addEventListener('input', handleInputChange);
    messageInput.addEventListener('keydown', handleKeyPress);
    sendBtn.addEventListener('click', sendMessage);
    clearBtn.addEventListener('click', clearChat);
    statsBtn.addEventListener('click', openStatsModal);
    browseBtn.addEventListener('click', openBrowseModal);
    newTicketBtn.addEventListener('click', openNewTicketModal);
    historyBtn.addEventListener('click', openHistoryModal);
    logoutBtn.addEventListener('click', logout);
    document.getElementById('expandBtn').addEventListener('click', toggleExpandChat);
    document.getElementById('chatPanelToggle').addEventListener('click', toggleExpandChat);
}

// Toggle Expand/Collapse Chat
function toggleExpandChat() {
    const mainContent = document.querySelector('.main-content');
    const expandIcon = document.getElementById('expandIcon');
    const expandBtn = document.getElementById('expandBtn');
    const chatToggleIcon = document.getElementById('chatToggleIcon');
    const isExpanded = mainContent.classList.contains('expanded');

    if (isExpanded) {
        // Show info panel (collapse button state)
        mainContent.classList.remove('expanded');
        expandIcon.style.transform = 'rotate(180deg)';
        chatToggleIcon.style.transform = 'rotate(180deg)';
        expandBtn.title = 'Collapse Panel';
    } else {
        // Hide info panel (expand button state)
        mainContent.classList.add('expanded');
        expandIcon.style.transform = 'rotate(0deg)';
        chatToggleIcon.style.transform = 'rotate(0deg)';
        expandBtn.title = 'Expand Panel';
    }
}

// Check Server Health
async function checkServerHealth() {
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/health`);
        const data = await response.json();

        if (data.status === 'healthy' && data.rag_ready) {
            updateStatus('Ready', 'healthy');
        } else {
            updateStatus('Initializing...', 'initializing');
            // Retry after 2 seconds
            setTimeout(checkServerHealth, 2000);
        }
    } catch (error) {
        updateStatus('Backend Offline', 'error');
        console.error('Health check failed:', error);
        setTimeout(checkServerHealth, 5000);
    }
}

// Update Status
function updateStatus(message, type) {
    statusElement.textContent = message;
    statusElement.className = 'status';

    if (type === 'healthy') {
        statusElement.style.color = '#d1fae5';
    } else if (type === 'error') {
        statusElement.style.color = '#fecaca';
    } else {
        statusElement.style.color = '#fef3c7';
    }
}

// Handle Input Change
function handleInputChange() {
    const length = messageInput.value.length;
    charCount.textContent = `${length}/1000`;
    sendBtn.disabled = length === 0;
}

// Handle Key Press
function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (messageInput.value.trim()) {
            sendMessage();
        }
    }
}

// Auto Resize Textarea
function autoResizeTextarea() {
    messageInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = Math.min(this.scrollHeight, 120) + 'px';
    });
}

// Send Sample Question
function sendSampleQuestion(question) {
    messageInput.value = question;
    handleInputChange();
    sendMessage();
}

// Send Message
async function sendMessage() {
    const message = messageInput.value.trim();
    if (!message) return;

    // Remove welcome message if exists
    const welcomeMsg = chatMessages.querySelector('.welcome-message');
    if (welcomeMsg) {
        welcomeMsg.remove();
    }

    // Add user message to chat
    addMessage(message, 'user');

    // Clear input
    messageInput.value = '';
    handleInputChange();
    messageInput.style.height = 'auto';

    // Create and show typing indicator dynamically
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'typing-indicator';
    typingIndicator.id = 'typingIndicator';
    typingIndicator.innerHTML = `
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
    `;
    chatMessages.appendChild(typingIndicator);
    scrollToBottom();

    // Send to backend
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/chat`, {
            method: 'POST',
            body: JSON.stringify({ message })
        });

        if (!response.ok) {
            throw new Error('Server error');
        }

        const data = await response.json();

        // Remove typing indicator
        typingIndicator.remove();

        // Check for API errors in response
        if (data.error_type) {
            displayApiError(data);
            return;
        }

        // Store current ticket data
        currentTicketData = data;

        // Add bot response
        addMessage(data.response, 'bot');

        // Always update info panel with response data (includes similarity)
        // This ensures similarity data is shown after chat responses
        updateInfoPanel(data);

        // Clear the browse ticket flag after showing response
        viewingBrowseTicket = false;

        // Store in history
        conversationHistory.push({
            user: message,
            bot: data.response,
            metadata: data
        });

    } catch (error) {
        typingIndicator.remove();

        // Display error message
        displayApiError({
            error_type: 'network_error',
            message: 'Network Error: Unable to connect to the server. Please check if the backend is running.',
            action: 'Ensure the Flask server is running on http://localhost:5000'
        });

        console.error('Chat error:', error);
    }
}

// Format text with markdown-like syntax
function formatText(text) {
    // Convert **text** to <strong>text</strong>
    text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

    // Convert "Step X:" headers to bold with spacing
    text = text.replace(/(Step \d+:)/g, '<br><br><strong>$1</strong>');

    // Convert numbered steps to formatted list (single line break)
    text = text.replace(/(\d+)\.\s/g, '<br><strong>$1.</strong> ');

    // Convert bullet points
    text = text.replace(/^[-•]\s/gm, '<br>• ');

    // Convert line breaks (preserve existing)
    text = text.replace(/\n/g, '<br>');

    return text;
}

// Add Message to Chat
function addMessage(content, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message message-${type}`;

    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';

    // For bot messages, format the text; for user messages, use plain text
    if (type === 'bot') {
        contentDiv.innerHTML = formatText(content);
    } else {
        contentDiv.textContent = content;
    }

    messageDiv.appendChild(contentDiv);

    // Add action buttons for bot messages
    if (type === 'bot') {
        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'message-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'action-btn';
        copyBtn.innerHTML = '<img src="/static/icon/copy-svgrepo-com (1).svg" alt="Copy">';
        copyBtn.title = 'Copy';
        copyBtn.onclick = () => copyMessage(content, copyBtn);

        const shareBtn = document.createElement('button');
        shareBtn.className = 'action-btn';
        shareBtn.innerHTML = '<img src="/static/icon/share-2-svgrepo-com.svg" alt="Share">';
        shareBtn.title = 'Share';
        shareBtn.onclick = () => shareMessage(content);

        actionsDiv.appendChild(copyBtn);
        actionsDiv.appendChild(shareBtn);
        messageDiv.appendChild(actionsDiv);
    }

    chatMessages.appendChild(messageDiv);

    scrollToBottom();
}


// Update Info Panel
function updateInfoPanel(data) {
    // Show all cards
    classificationCard.style.display = 'block';
    escalationCard.style.display = 'block';
    metricsCard.style.display = 'block';
    similarCard.style.display = 'block';

    // Show and update ticket ID if available
    const ticketIdDisplay = document.getElementById('ticketIdDisplay');
    const ticketIdValue = document.getElementById('currentTicketId');
    if (data.metadata && data.metadata.ticket_id) {
        ticketIdDisplay.style.display = 'flex';
        ticketIdValue.textContent = data.metadata.ticket_id;
    } else {
        ticketIdDisplay.style.display = 'none';
    }

    // Check for API warnings and display
    const classification = data.classification || {};
    if (classification.api_warning) {
        displayApiWarning(classification.api_warning);
    } else {
        hideApiWarning();
    }

    // Update Classification Card
    const category = classification.category || 'Unknown';
    const confidence = classification.confidence || 0;
    const priority = data.metadata?.priority || 'Medium';

    document.getElementById('infoCategory').textContent = category;

    // Update Priority with badge styling
    const priorityElement = document.getElementById('infoPriority');
    const priorityClass = priority === 'High' ? 'badge-high' : 
                         priority === 'Medium' ? 'badge-medium' : 'badge-low';
    priorityElement.innerHTML = `<span class="badge ${priorityClass}">${priority}</span>`;

    document.getElementById('infoConfidence').textContent = `${(confidence * 100).toFixed(1)}%`;
    document.getElementById('confidenceFill').style.width = `${confidence * 100}%`;

    // Use routing data from backend
    const routing = data.routing || {};
    const routingTeam = routing.team || getRoutingDepartment(category);
    const routingElement = document.getElementById('infoRouting');
    routingElement.textContent = routingTeam;

    // Make routing clickable
    routingElement.onclick = () => handleRoutingClick(routingTeam, data);

    // Update Escalation Card based on routing level
    const teamLevel = routing.level || '';
    const needsEscalation = teamLevel.includes('Manual Review') || teamLevel.includes('L2');
    const estTime = data.metadata?.estimated_time || 0;

    let escalationBadge;
    if (teamLevel.includes('Manual Review')) {
        escalationBadge = '<span class="badge badge-escalate">Manual Review Required</span>';
    } else if (teamLevel === 'L1 Support') {
        escalationBadge = '<span class="badge badge-auto">Auto-Resolve (L1)</span>';
    } else if (teamLevel === 'L2 Support') {
        escalationBadge = '<span class="badge badge-medium">L2 Support</span>';
    } else {
        escalationBadge = needsEscalation 
            ? '<span class="badge badge-escalate">Required</span>' 
            : '<span class="badge badge-auto">Auto-Resolve</span>';
    }
    
    document.getElementById('infoEscalation').innerHTML = escalationBadge;
    document.getElementById('infoEstTime').textContent = `${estTime.toFixed(1)} hours`;
    
    // Update Evaluation Metrics with real LLM Judge data
    updateEvaluationMetrics(data);
    
    // Update Similar Tickets
    updateSimilarTickets(data.similar_tickets || []);
}

// Get Routing Department
function getRoutingDepartment(category) {
    const routing = {
        'Infrastructure': 'Infrastructure Team',
        'Database': 'Database Admin Team',
        'Security': 'Security Operations',
        'Network': 'Network Operations',
        'Access Management': 'IAM Team',
        'Application': 'Application Support'
    };
    return routing[category] || 'General Support';
}

// Update Evaluation Metrics
function updateEvaluationMetrics(data) {
    const classification = data.classification || {};
    const confidence = classification.confidence || 0;
    const similarTickets = data.similar_tickets || [];
    const llmJudge = data.llm_judge || {};
    
    // Accuracy: Use LLM Judge accuracy score
    const accuracy = llmJudge.accuracy ? (llmJudge.accuracy * 100).toFixed(1) : (confidence * 100).toFixed(1);
    document.getElementById('metricAccuracy').textContent = `${accuracy}%`;
    
    // F1 Score: Use real F1 score from backend
    const f1Score = llmJudge.f1_score ? llmJudge.f1_score.toFixed(2) : (confidence * 0.95).toFixed(2);
    document.getElementById('metricF1').textContent = f1Score;
    
    // Semantic Similarity: Maximum similarity of retrieved tickets (best match)
    let maxSimilarity = 0;
    if (similarTickets.length > 0) {
        maxSimilarity = Math.max(...similarTickets.map(t => t.similarity || 0));
    }
    document.getElementById('metricSimilarity').textContent = (maxSimilarity * 100).toFixed(1) + '%';
    
    // LLM Judge: Use real quality grade from backend
    const llmJudgeScore = llmJudge.quality_grade || calculateLLMJudgeScore(data.response, confidence);
    document.getElementById('metricLLM').textContent = llmJudgeScore;
}

// Calculate LLM Judge Score
function calculateLLMJudgeScore(response, confidence) {
    // Simulated LLM-as-judge evaluation
    // In production, this would call a separate LLM endpoint
    
    let score = 0;
    
    // Length factor (good responses are detailed)
    if (response.length > 100) score += 0.3;
    
    // Confidence factor
    score += confidence * 0.5;
    
    // Structure factor (check for steps, lists, etc.)
    if (response.includes('1.') || response.includes('-')) score += 0.2;
    
    // Cap at 1.0
    score = Math.min(score, 1.0);
    
    // Convert to letter grade
    if (score >= 0.9) return 'A';
    if (score >= 0.8) return 'B+';
    if (score >= 0.7) return 'B';
    if (score >= 0.6) return 'C+';
    if (score >= 0.5) return 'C';
    return 'D';
}

// Update Similar Tickets
function updateSimilarTickets(tickets) {
    const container = document.getElementById('similarTicketsContainer');
    container.innerHTML = '';
    
    if (tickets.length === 0) {
        container.innerHTML = '<p style="color: #9ca3af; font-size: 13px;">No similar tickets found</p>';
        return;
    }
    
    tickets.slice(0, 3).forEach(ticket => {
        const ticketDiv = document.createElement('div');
        ticketDiv.className = 'similar-ticket';
        ticketDiv.style.cursor = 'pointer';
        ticketDiv.onclick = () => viewSimilarTicket(ticket);
        
        ticketDiv.innerHTML = `
            <div class="similar-ticket-header">
                <span class="ticket-id">${ticket.ticket_id}</span>
                <span class="similarity-score">${(ticket.similarity * 100).toFixed(0)}% match</span>
            </div>
            <div class="similar-ticket-title">${ticket.title}</div>
            <div class="similar-ticket-resolution">${ticket.resolution.substring(0, 80)}...</div>
        `;
        
        container.appendChild(ticketDiv);
    });
}

// View Similar Ticket Details
function viewSimilarTicket(ticket) {
    // Create a query to get full details about this ticket
    const query = `Tell me more about ticket ${ticket.ticket_id}: ${ticket.title}. Show the complete resolution.`;
    
    // Set it in the input field and send
    messageInput.value = query;
    handleInputChange();
    sendMessage();
    
    // Focus on input for follow-up
    setTimeout(() => {
        messageInput.focus();
    }, 500);
}

// Scroll to Bottom
function scrollToBottom() {
    setTimeout(() => {
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }, 100);
}

// Clear Chat
function clearChat() {
    // Create small, smart confirmation popup
    const dialogHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.4); z-index: 2000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.2s;" id="clearChatDialog" onclick="if(event.target.id==='clearChatDialog') closeClearChatDialog()">
            <div style="background: white; border-radius: 12px; padding: 20px 24px; box-shadow: 0 8px 24px rgba(0,0,0,0.2); animation: popIn 0.2s; min-width: 320px; max-width: 400px;" onclick="event.stopPropagation()">
                <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                    <div style="width: 40px; height: 40px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-size: 24px; font-weight: bold; flex-shrink: 0;">
                        !
                    </div>
                    <div>
                        <h4 style="margin: 0; font-size: 16px; font-weight: 700; color: #1f2937;">Clear Chat?</h4>
                        <p style="margin: 2px 0 0 0; font-size: 13px; color: #6b7280;">This will remove all messages</p>
                    </div>
                </div>
                
                <div style="display: flex; gap: 10px; justify-content: flex-end;">
                    <button onclick="closeClearChatDialog()" style="padding: 10px 20px; background: #f3f4f6; color: #374151; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.background='#e5e7eb'" onmouseout="this.style.background='#f3f4f6'">
                        No
                    </button>
                    <button onclick="confirmClearChat()" style="padding: 10px 20px; background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%); color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s; box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);" onmouseover="this.style.transform='translateY(-1px)'; this.style.boxShadow='0 4px 12px rgba(239, 68, 68, 0.4)'" onmouseout="this.style.transform=''; this.style.boxShadow='0 2px 8px rgba(239, 68, 68, 0.3)'">
                        Yes, Clear
                    </button>
                </div>
            </div>
        </div>
        
        <style>
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes popIn {
                from { transform: scale(0.9); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }
        </style>
    `;
    
    // Add dialog to page
    const dialogDiv = document.createElement('div');
    dialogDiv.innerHTML = dialogHTML;
    document.body.appendChild(dialogDiv);
    
    // Add ESC key listener
    const escHandler = (e) => {
        if (e.key === 'Escape') {
            closeClearChatDialog();
            document.removeEventListener('keydown', escHandler);
        }
    };
    document.addEventListener('keydown', escHandler);
}

// Confirm Clear Chat
function confirmClearChat() {
    closeClearChatDialog();
    
    // Clear the chat
    chatMessages.innerHTML = `
            <div class="welcome-message">
                <div class="bot-avatar-large"></div>
                <h2>Welcome to AI Ticket Support!</h2>
                <p>I'm your intelligent IT support assistant.</p>
                <p>I can help you with ticket classification, resolution suggestions, and escalation management.</p>
                
                <div style="background: linear-gradient(135deg, #f3f4ff 0%, #faf5ff 100%); border-radius: 12px; padding: 20px; margin-top: 25px; border: 2px solid #e9d5ff;">
                    <h3 style="color: #667eea; margin-bottom: 15px; font-size: 16px;">
                        Quick Start Guide
                    </h3>
                    
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <div style="background: white; padding: 12px 15px; border-radius: 8px; border-left: 4px solid #667eea; cursor: pointer; transition: all 0.2s;" onmouseover="this.style.transform='translateX(5px)'" onmouseout="this.style.transform='translateX(0)'>
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                                <strong style="color: #374151;">Type Your Issue</strong>
                            </div>
                            <div style="font-size: 13px; color: #6b7280;">
                                Describe your IT problem and get instant AI-powered solutions
                            </div>
                        </div>
                        
                        <div style="background: white; padding: 12px 15px; border-radius: 8px; border-left: 4px solid #f59e0b; cursor: pointer; transition: all 0.2s;" onclick="openNewTicketModal()" onmouseover="this.style.transform='translateX(5px)'" onmouseout="this.style.transform='translateX(0)'>
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                                <strong style="color: #374151;">New Tickets</strong>
                                <span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;">EXPLORE</span>
                            </div>
                            <div style="font-size: 13px; color: #6b7280;">
                                Review New Tickets with AI similarity analysis & routing
                            </div>
                        </div>
                        
                        <div style="background: white; padding: 12px 15px; border-radius: 8px; border-left: 4px solid #10b981; cursor: pointer; transition: all 0.2s;" onclick="openBrowseModal()" onmouseover="this.style.transform='translateX(5px)'" onmouseout="this.style.transform='translateX(0)'>
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                                <strong style="color: #374151;">Browse Tickets</strong>
                            </div>
                            <div style="font-size: 13px; color: #6b7280;">
                                Explore 1000+ historical tickets organized by category
                            </div>
                        </div>
                        
                        <div style="background: white; padding: 12px 15px; border-radius: 8px; border-left: 4px solid #8b5cf6; cursor: pointer; transition: all 0.2s;" onclick="openStatsModal()" onmouseover="this.style.transform='translateX(5px)'" onmouseout="this.style.transform='translateX(0)'>
                            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
                                <strong style="color: #374151;">Database Stats</strong>
                            </div>
                            <div style="font-size: 13px; color: #6b7280;">
                                View comprehensive statistics & insights from ticket database
                            </div>
                        </div>
                    </div>
                </div>
                
                <p style="margin-top: 20px; font-size: 13px; color: #9ca3af; text-align: center;">
                    <em>Powered by shailendra</em>
                </p>
            </div>
        `;
        
    // Clear history
    conversationHistory = [];
    currentTicketData = null;
    
    // Reload initial dashboard to keep Current Ticket Analysis panel visible
    loadInitialDashboard();
    
    // Show success notification
    showClearSuccessNotification();
}

// Close Clear Chat Dialog
function closeClearChatDialog() {
    const dialog = document.getElementById('clearChatDialog');
    if (dialog) {
        dialog.parentElement.remove();
    }
}

// Show Clear Success Notification
function showClearSuccessNotification() {
    const notification = document.createElement('div');
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 18px 24px; border-radius: 12px; box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4); z-index: 3000; animation: slideInRight 0.3s; font-size: 15px; font-weight: 600; max-width: 350px;';
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div>
                <div style="font-size: 16px; margin-bottom: 4px; font-weight: 700;">Chat Cleared Successfully</div>
                <div style="font-size: 13px; opacity: 0.9;">Ready for a fresh conversation</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Add animation style
    const style = document.createElement('style');
    style.textContent = '@keyframes slideInRight { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }';
    document.head.appendChild(style);
    
    // Remove after 3 seconds
    setTimeout(() => {
        notification.style.animation = 'slideInRight 0.3s reverse';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// Open Stats Modal
async function openStatsModal() {
    statsModal.classList.add('active');
    
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/stats`);
        const data = await response.json();
        
        displayStats(data);
    } catch (error) {
        document.getElementById('statsContent').innerHTML = `
            <p style="color: #dc2626;">Error loading statistics. Please ensure the backend is running.</p>
        `;
        console.error('Stats error:', error);
    }
}

// Close Stats Modal
function closeStatsModal() {
    statsModal.classList.remove('active');
}

// Display Stats
function displayStats(data) {
    const statsContent = document.getElementById('statsContent');
    
    let html = `
        <div class="stats-section">
            <h3>Overview</h3>
            <div class="stats-grid">
                <div class="stat-item">
                    <div class="stat-label">Total Tickets</div>
                    <div class="stat-value">${data.total_tickets || 0}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Avg Resolution</div>
                    <div class="stat-value">${(data.avg_resolution_time || 0).toFixed(1)}h</div>
                </div>
            </div>
        </div>
        
        <div class="stats-section">
            <h3>Categories <span style="font-size: 12px; color: #9ca3af; font-weight: normal;">(Click to view tickets)</span></h3>
            <div class="stats-grid">
    `;
    
    if (data.categories) {
        Object.entries(data.categories).forEach(([category, count]) => {
            html += `
                <div class="stat-item clickable-stat" onclick="viewCategoryFromStats('${category}')" style="cursor: pointer; transition: all 0.2s;">
                    <div class="stat-label">${category}</div>
                    <div class="stat-value">${count}</div>
                </div>
            `;
        });
    }
    
    html += `
            </div>
        </div>
        
        <div class="stats-section">
            <h3>Priorities <span style="font-size: 12px; color: #9ca3af; font-weight: normal;">(Click to view tickets)</span></h3>
            <div class="stats-grid">
    `;
    
    if (data.priorities) {
        Object.entries(data.priorities).forEach(([priority, count]) => {
            html += `
                <div class="stat-item clickable-stat" onclick="viewPriorityFromStats('${priority}')" style="cursor: pointer; transition: all 0.2s;">
                    <div class="stat-label">${priority}</div>
                    <div class="stat-value">${count}</div>
                </div>
            `;
        });
    }
    
    html += `
            </div>
        </div>
    `;
    
    statsContent.innerHTML = html;
}

// View Category from Stats Modal
async function viewCategoryFromStats(category) {
    closeStatsModal();
    
    // Load all tickets if not already loaded
    if (allTicketsData.length === 0) {
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/all_tickets`);
            const data = await response.json();
            allTicketsData = data.tickets || [];
        } catch (error) {
            console.error('Error loading tickets:', error);
            return;
        }
    }
    
    // Open browse modal and show category tickets
    browseModal.classList.add('active');
    showCategoryTickets(category);
}

// View Priority from Stats Modal
async function viewPriorityFromStats(priority) {
    closeStatsModal();
    
    // Load all tickets if not already loaded
    if (allTicketsData.length === 0) {
        try {
            const response = await fetchWithAuth(`${API_BASE_URL}/all_tickets`);
            const data = await response.json();
            allTicketsData = data.tickets || [];
        } catch (error) {
            console.error('Error loading tickets:', error);
            return;
        }
    }
    
    // Open browse modal and show priority tickets
    browseModal.classList.add('active');
    showPriorityTickets(priority);
}

// Show Priority Tickets
function showPriorityTickets(priority) {
    const browseContent = document.getElementById('browseContent');
    const tickets = allTicketsData.filter(t => t.priority === priority);
    
    let html = `
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button class="back-btn" onclick="displayCategoryView()">← Back to Categories</button>
            <button class="back-btn" onclick="closeBrowseModal()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; display: flex; align-items: center; gap: 8px;" title="Return to Chat">
                <img src="/static/icon/house.png" alt="Home" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">
                Home
            </button>
        </div>
        <h3 style="margin-bottom: 20px; color: #1f2937;">${priority} Priority Tickets (${tickets.length})</h3>
        <div class="ticket-list">
    `;
    
    tickets.forEach(ticket => {
        const priorityClass = ticket.priority === 'High' ? 'badge-high' : 
                            ticket.priority === 'Medium' ? 'badge-medium' : 'badge-low';
        
        html += `
            <div class="ticket-item" onclick='chatAboutTicket(${JSON.stringify(ticket).replace(/'/g, "&#39;")})'>
                <div class="ticket-header">
                    <div class="ticket-title">${ticket.title}</div>
                    <span class="ticket-priority ${priorityClass}">${ticket.priority}</span>
                </div>
                <div class="ticket-desc">${ticket.description}</div>
                <div class="ticket-footer">
                    <span>ID: ${ticket.ticket_id}</span>
                    <span>Category: ${ticket.category}</span>
                    <span>${ticket.resolution_time}h</span>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    browseContent.innerHTML = html;
}

// Close modal when clicking outside
statsModal.addEventListener('click', (e) => {
    if (e.target === statsModal) {
        closeStatsModal();
    }
});

browseModal.addEventListener('click', (e) => {
    if (e.target === browseModal) {
        closeBrowseModal();
    }
});

newTicketModal.addEventListener('click', (e) => {
    if (e.target === newTicketModal) {
        closeNewTicketModal();
    }
});

historyModal.addEventListener('click', (e) => {
    if (e.target === historyModal) {
        closeHistoryModal();
    }
});

// Chat History Functions
let historyFilterType = 'All';
let historySortOrder = 'newest';

function openHistoryModal() {
    historyModal.classList.add('active');
    displayChatHistory();
}

function closeHistoryModal() {
    historyModal.classList.remove('active');
}

function displayChatHistory() {
    const historyContent = document.getElementById('historyContent');
    
    if (conversationHistory.length === 0) {
        historyContent.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <h3 style="color: #6b7280; font-size: 20px; margin-bottom: 10px;">No Chat History</h3>
                <p style="color: #9ca3af; font-size: 14px;">Start a conversation to see your chat history here</p>
            </div>
        `;
        return;
    }
    
    let filteredHistory = [...conversationHistory];
    if (historySortOrder === 'oldest') {
        filteredHistory = filteredHistory.reverse();
    }
    
    let html = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; flex-wrap: wrap; gap: 15px;">
            <div style="display: flex; gap: 10px; flex-wrap: wrap;">
                <button class="filter-btn ${historyFilterType === 'All' ? 'active' : ''}" onclick="filterChatHistory('All')">
                    All Messages (${conversationHistory.length})
                </button>
            </div>
            
            <div style="display: flex; gap: 10px; align-items: center;">
                <select onchange="sortChatHistory(this.value)" style="padding: 8px 14px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 13px; cursor: pointer; background: white;">
                    <option value="newest" ${historySortOrder === 'newest' ? 'selected' : ''}>Newest First</option>
                    <option value="oldest" ${historySortOrder === 'oldest' ? 'selected' : ''}>Oldest First</option>
                </select>
                
                <button onclick="clearAllHistory()" style="padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer;">
                    Clear All
                </button>
            </div>
        </div>
        
        <div style="background: #f9fafb; padding: 15px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #667eea;">
            <div style="font-size: 13px; color: #6b7280; line-height: 1.6;">
                <strong style="color: #374151;">Tip:</strong> Click on any message to reload it into the chat input box
            </div>
        </div>
        
        <div style="display: flex; flex-direction: column; gap: 15px;">
    `;
    
    filteredHistory.forEach((conversation, index) => {
        const actualIndex = historySortOrder === 'oldest' ? conversationHistory.length - 1 - index : index;
        const timeAgo = `${actualIndex + 1} exchange${actualIndex !== 0 ? 's' : ''} ago`;
        
        const category = conversation.metadata?.classification?.category || 'General';
        const priority = conversation.metadata?.metadata?.priority || 'Medium';
        const priorityClass = priority === 'High' ? 'badge-high' : priority === 'Medium' ? 'badge-medium' : 'badge-low';
        
        html += `
            <div style="background: white; border: 2px solid #e7e7eb; border-radius: 12px; padding: 18px;">
                <div onclick='reloadMessageToInput(${JSON.stringify(conversation.user).replace(/'/g, "&#39;")})' style="cursor: pointer; padding: 12px; background: linear-gradient(135deg, #f3f4ff 0%, #faf5ff 100%); border-radius: 8px; margin-bottom: 12px; border: 2px solid #e9d5ff; transition: all 0.2s;" onmouseover="this.style.transform='translateX(5px)'" onmouseout="this.style.transform='translateX(0)'">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700;">U</div>
                        <div style="flex: 1;">
                            <div style="font-size: 12px; color: #9ca3af;">${timeAgo}</div>
                            <div style="font-size: 13px; font-weight: 600; color: #667eea;">Your Question</div>
                        </div>
                        <div style="font-size: 11px; color: #667eea; font-weight: 600;">Click to reload →</div>
                    </div>
                    <div style="color: #374151; font-size: 14px; padding-left: 42px;">${conversation.user.length > 150 ? conversation.user.substring(0, 150) + '...' : conversation.user}</div>
                </div>
                
                <div style="padding: 12px; background: #f9fafb; border-radius: 8px; border: 2px solid #e5e7eb;">
                    <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 8px;">
                        <div style="width: 32px; height: 32px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: 700;">AI</div>
                        <div style="flex: 1;">
                            <div style="font-size: 13px; font-weight: 600; color: #10b981;">AI Response</div>
                            <div style="font-size: 11px; color: #6b7280;">
                                Category: <span class="badge" style="padding: 2px 6px; font-size: 10px; background: #e9d5ff; color: #667eea;">${category}</span>
                                Priority: <span class="badge ${priorityClass}" style="padding: 2px 6px; font-size: 10px;">${priority}</span>
                            </div>
                        </div>
                    </div>
                    <div style="color: #6b7280; font-size: 13px; padding-left: 42px;">${conversation.bot.length > 200 ? conversation.bot.substring(0, 200) + '...' : conversation.bot}</div>
                </div>
            </div>
        `;
    });
    
    html += '</div>';
    historyContent.innerHTML = html;
}

function filterChatHistory(type) {
    historyFilterType = type;
    displayChatHistory();
}

function sortChatHistory(order) {
    historySortOrder = order;
    displayChatHistory();
}

function reloadMessageToInput(message) {
    closeHistoryModal();
    messageInput.value = message;
    handleInputChange();
    messageInput.focus();
    messageInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
    const notification = document.createElement('div');
    notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 20px; border-radius: 10px; box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4); z-index: 3000; animation: slideInRight 0.3s;';
    notification.innerHTML = '<div style="display: flex; align-items: center; gap: 10px;"><div>Message loaded to input box</div></div>';
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2000);
}

function clearAllHistory() {
    if (conversationHistory.length === 0) return;
    
    if (confirm(`Clear all ${conversationHistory.length} conversation(s)? This cannot be undone.`)) {
        conversationHistory = [];
        displayChatHistory();
        
        const notification = document.createElement('div');
        notification.style.cssText = 'position: fixed; top: 20px; right: 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 18px 24px; border-radius: 12px; box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4); z-index: 3000; animation: slideInRight 0.3s;';
        notification.innerHTML = '<div style="display: flex; align-items: center; gap: 12px;"><div><div style="font-size: 16px; font-weight: 700;">History Cleared</div><div style="font-size: 13px; opacity: 0.9;">All chat history has been deleted</div></div></div>';
        document.body.appendChild(notification);
        setTimeout(() => notification.remove(), 3000);
    }
}

// Browse Tickets Functions
let allTicketsData = [];

async function openBrowseModal() {
    browseModal.classList.add('active');
    
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/all_tickets`);
        const data = await response.json();
        
        allTicketsData = data.tickets || [];
        displayCategoryView();
    } catch (error) {
        document.getElementById('browseContent').innerHTML = `
            <p style="color: #dc2626;">Error loading tickets. Please ensure the backend is running.</p>
        `;
        console.error('Browse error:', error);
    }
}

function closeBrowseModal() {
    browseModal.classList.remove('active');
}

function displayCategoryView() {
    const browseContent = document.getElementById('browseContent');
    
    // Group tickets by category
    const categoryMap = {};
    allTicketsData.forEach(ticket => {
        const cat = ticket.category || 'Unknown';
        if (!categoryMap[cat]) {
            categoryMap[cat] = [];
        }
        categoryMap[cat].push(ticket);
    });
    
    let html = `
        <button class="back-btn" onclick="closeBrowseModal()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; width: fit-content;" title="Return to Chat">
            <img src="/static/icon/house.png" alt="Home" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">
            Home
        </button>
        <div class="category-grid">
    `;
    
    Object.entries(categoryMap).forEach(([category, tickets]) => {
        html += `
            <div class="category-card" onclick="showCategoryTickets('${category}')">
                <div class="category-name">${category}</div>
                <div class="category-count">${tickets.length} ticket${tickets.length !== 1 ? 's' : ''}</div>
            </div>
        `;
    });
    
    html += '</div>';
    browseContent.innerHTML = html;
}

// Browse tickets state
let browsePriorityFilter = 'All';
let browseSearchQuery = '';
let browseSortField = 'ticket_id';
let browseSortOrder = 'asc';
let browseCurrentPage = 1;
let browseRecordsPerPage = 20;

function showCategoryTickets(category) {
    const browseContent = document.getElementById('browseContent');
    let tickets = allTicketsData.filter(t => t.category === category);
    
    // Apply priority filter
    if (browsePriorityFilter !== 'All') {
        tickets = tickets.filter(t => t.priority === browsePriorityFilter);
    }
    
    // Apply search filter
    if (browseSearchQuery) {
        const query = browseSearchQuery.toLowerCase();
        tickets = tickets.filter(t => 
            t.title.toLowerCase().includes(query) || 
            t.description.toLowerCase().includes(query) ||
            t.ticket_id.toLowerCase().includes(query)
        );
    }
    
    // Apply sorting
    tickets.sort((a, b) => {
        let aVal = a[browseSortField];
        let bVal = b[browseSortField];
        
        if (browseSortField === 'priority') {
            const priorityOrder = { 'High': 3, 'Medium': 2, 'Low': 1 };
            aVal = priorityOrder[aVal] || 0;
            bVal = priorityOrder[bVal] || 0;
        }
        
        if (browseSortField === 'resolution_time') {
            aVal = parseFloat(aVal) || 0;
            bVal = parseFloat(bVal) || 0;
        }
        
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }
        
        if (aVal < bVal) return browseSortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return browseSortOrder === 'asc' ? 1 : -1;
        return 0;
    });
    
    const totalTickets = allTicketsData.filter(t => t.category === category).length;
    
    // Calculate pagination
    const totalPages = Math.ceil(tickets.length / browseRecordsPerPage);
    const startIndex = (browseCurrentPage - 1) * browseRecordsPerPage;
    const endIndex = Math.min(startIndex + browseRecordsPerPage, tickets.length);
    const paginatedTickets = tickets.slice(startIndex, endIndex);
    
    let html = `
        <div style="display: flex; gap: 10px; margin-bottom: 20px;">
            <button class="back-btn" onclick="displayCategoryView()">← Back to Categories</button>
            <button class="back-btn" onclick="closeBrowseModal()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; display: flex; align-items: center; gap: 8px;" title="Return to Chat">
                <img src="/static/icon/house.png" alt="Home" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">
                Home
            </button>
        </div>
        <h3 style="margin-bottom: 20px; color: #1f2937;">${category} Tickets</h3>
        
        <!-- Search and Filter Section -->
        <div style="background: #f9fafb; padding: 16px; border-radius: 10px; margin-bottom: 20px; border: 2px solid #e5e7eb;">
            <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center;">
                <!-- Search Box -->
                <div style="flex: 1; min-width: 250px;">
                    <input type="text" 
                        id="browseSearchInput" 
                        placeholder="Search by title, description, or ticket ID..." 
                        value="${browseSearchQuery}"
                        oninput="handleBrowseSearch(this.value, '${category}')"
                        style="width: 100%; padding: 10px 14px; border: 2px solid #d1d5db; border-radius: 8px; font-size: 14px; outline: none; transition: all 0.2s;"
                        onfocus="this.style.borderColor='#667eea'"
                        onblur="this.style.borderColor='#d1d5db'">
                </div>
                
                <!-- Priority Filter -->
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="font-size: 13px; color: #6b7280; font-weight: 600; white-space: nowrap;">Priority:</label>
                    <select onchange="handleBrowsePriorityFilter(this.value, '${category}')" 
                        style="padding: 8px 12px; border: 2px solid #d1d5db; border-radius: 8px; font-size: 13px; cursor: pointer; outline: none; background: white;">
                        <option value="All" ${browsePriorityFilter === 'All' ? 'selected' : ''}>All</option>
                        <option value="High" ${browsePriorityFilter === 'High' ? 'selected' : ''}>High</option>
                        <option value="Medium" ${browsePriorityFilter === 'Medium' ? 'selected' : ''}>Medium</option>
                        <option value="Low" ${browsePriorityFilter === 'Low' ? 'selected' : ''}>Low</option>
                    </select>
                </div>
                
                <!-- Sort By -->
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="font-size: 13px; color: #6b7280; font-weight: 600; white-space: nowrap;">Sort:</label>
                    <select onchange="handleBrowseSort(this.value, '${category}')" 
                        style="padding: 8px 12px; border: 2px solid #d1d5db; border-radius: 8px; font-size: 13px; cursor: pointer; outline: none; background: white;">
                        <option value="ticket_id-asc" ${browseSortField === 'ticket_id' && browseSortOrder === 'asc' ? 'selected' : ''}>ID (A-Z)</option>
                        <option value="ticket_id-desc" ${browseSortField === 'ticket_id' && browseSortOrder === 'desc' ? 'selected' : ''}>ID (Z-A)</option>
                        <option value="title-asc" ${browseSortField === 'title' && browseSortOrder === 'asc' ? 'selected' : ''}>Title (A-Z)</option>
                        <option value="title-desc" ${browseSortField === 'title' && browseSortOrder === 'desc' ? 'selected' : ''}>Title (Z-A)</option>
                        <option value="priority-desc" ${browseSortField === 'priority' && browseSortOrder === 'desc' ? 'selected' : ''}>Priority (High-Low)</option>
                        <option value="priority-asc" ${browseSortField === 'priority' && browseSortOrder === 'asc' ? 'selected' : ''}>Priority (Low-High)</option>
                        <option value="resolution_time-asc" ${browseSortField === 'resolution_time' && browseSortOrder === 'asc' ? 'selected' : ''}>Time (Low-High)</option>
                        <option value="resolution_time-desc" ${browseSortField === 'resolution_time' && browseSortOrder === 'desc' ? 'selected' : ''}>Time (High-Low)</option>
                    </select>
                </div>
                
                <!-- Records per page -->
                <div style="display: flex; align-items: center; gap: 8px;">
                    <label style="font-size: 13px; color: #6b7280; font-weight: 600; white-space: nowrap;">Per page:</label>
                    <select onchange="handleBrowseRecordsPerPage(this.value, '${category}')" 
                        style="padding: 8px 12px; border: 2px solid #d1d5db; border-radius: 8px; font-size: 13px; cursor: pointer; outline: none; background: white;">
                        <option value="10" ${browseRecordsPerPage === 10 ? 'selected' : ''}>10</option>
                        <option value="20" ${browseRecordsPerPage === 20 ? 'selected' : ''}>20</option>
                        <option value="50" ${browseRecordsPerPage === 50 ? 'selected' : ''}>50</option>
                        <option value="100" ${browseRecordsPerPage === 100 ? 'selected' : ''}>100</option>
                    </select>
                </div>
                
                <!-- Clear Filters Button -->
                ${browsePriorityFilter !== 'All' || browseSearchQuery ? `
                    <button onclick="clearBrowseFilters('${category}')" 
                        style="padding: 8px 14px; background: #ef4444; color: white; border: none; border-radius: 8px; font-size: 13px; font-weight: 600; cursor: pointer; white-space: nowrap;">
                        Clear Filters
                    </button>
                ` : ''}
            </div>
            
            <!-- Results Summary -->
            <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                <div style="font-size: 13px; color: #6b7280;">
                    Showing <strong style="color: #374151;">${startIndex + 1}-${endIndex}</strong> of <strong style="color: #374151;">${tickets.length}</strong> tickets
                    ${browsePriorityFilter !== 'All' ? `<span style="color: #667eea; font-weight: 600;"> • Filtered by: ${browsePriorityFilter} Priority</span>` : ''}
                    ${browseSearchQuery ? `<span style="color: #667eea; font-weight: 600;"> • Search: "${browseSearchQuery}"</span>` : ''}
                </div>
            </div>
        </div>
        
        <!-- Pagination Controls (Top) -->
        ${tickets.length > 0 ? generateBrowsePaginationHTML(category, tickets.length, totalPages, startIndex, endIndex) : ''}
        
        <div class="ticket-list">
    `;
    
    if (paginatedTickets.length === 0) {
        html += `
            <div style="text-align: center; padding: 60px 20px; color: #9ca3af;">
                <div style="font-size: 48px; margin-bottom: 16px;"></div>
                <div style="font-size: 18px; font-weight: 600; color: #6b7280; margin-bottom: 8px;">No tickets found</div>
                <div style="font-size: 14px;">Try adjusting your search or filters</div>
            </div>
        `;
    } else {
        paginatedTickets.forEach(ticket => {
            const priorityClass = ticket.priority === 'High' ? 'badge-high' : 
                                ticket.priority === 'Medium' ? 'badge-medium' : 'badge-low';
            
            html += `
                <div class="ticket-item" onclick='chatAboutTicket(${JSON.stringify(ticket).replace(/'/g, "&#39;")})'>
                    <div class="ticket-header">
                        <div class="ticket-title">${ticket.title}</div>
                        <span class="ticket-priority ${priorityClass}">${ticket.priority}</span>
                    </div>
                    <div class="ticket-desc">${ticket.description}</div>
                    <div class="ticket-footer">
                        <span>ID: ${ticket.ticket_id}</span>
                        <span>${ticket.resolution_time}h</span>
                    </div>
                </div>
            `;
        });
    }
    
    html += '</div>';
    
    // Add pagination controls (bottom)
    if (tickets.length > 0) {
        html += generateBrowsePaginationHTML(category, tickets.length, totalPages, startIndex, endIndex);
    }
    
    browseContent.innerHTML = html;
}

// Generate pagination HTML for Browse Tickets
function generateBrowsePaginationHTML(category, totalTickets, totalPages, startIndex, endIndex) {
    let paginationHTML = `
        <div style="margin-top: 20px; padding-top: 20px; border-top: 2px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
            <div style="color: #6b7280; font-size: 14px;">
                Showing <strong>${startIndex + 1}-${endIndex}</strong> of <strong>${totalTickets}</strong> tickets
            </div>
            
            <div style="display: flex; gap: 8px; align-items: center;">
                <button onclick="handleBrowsePageChange(${browseCurrentPage - 1}, '${category}')" ${browseCurrentPage === 1 ? 'disabled' : ''} 
                    style="padding: 8px 16px; border: 2px solid #e5e7eb; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; color: #374151; ${browseCurrentPage === 1 ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                    ← Previous
                </button>
                
                <div style="display: flex; gap: 4px;">
    `;
    
    // Show page numbers
    const maxPagesToShow = 5;
    let startPage = Math.max(1, browseCurrentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    
    if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    if (startPage > 1) {
        paginationHTML += `<button onclick="handleBrowsePageChange(1, '${category}')" style="padding: 8px 12px; border: 2px solid #e5e7eb; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; color: #374151;">1</button>`;
        if (startPage > 2) {
            paginationHTML += `<span style="padding: 8px 4px; color: #9ca3af;">...</span>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === browseCurrentPage;
        paginationHTML += `
            <button onclick="handleBrowsePageChange(${i}, '${category}')" 
                style="padding: 8px 12px; border: 2px solid ${isActive ? '#667eea' : '#e5e7eb'}; 
                background: ${isActive ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'white'}; 
                color: ${isActive ? 'white' : '#374151'}; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: ${isActive ? '600' : '500'};">
                ${i}
            </button>
        `;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            paginationHTML += `<span style="padding: 8px 4px; color: #9ca3af;">...</span>`;
        }
        paginationHTML += `<button onclick="handleBrowsePageChange(${totalPages}, '${category}')" style="padding: 8px 12px; border: 2px solid #e5e7eb; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; color: #374151;">${totalPages}</button>`;
    }
    
    paginationHTML += `
                </div>
                
                <button onclick="handleBrowsePageChange(${browseCurrentPage + 1}, '${category}')" ${browseCurrentPage === totalPages ? 'disabled' : ''} 
                    style="padding: 8px 16px; border: 2px solid #e5e7eb; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; color: #374151; ${browseCurrentPage === totalPages ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                    Next →
                </button>
            </div>
        </div>
    `;
    
    return paginationHTML;
}

// Handle browse search
function handleBrowseSearch(query, category) {
    browseSearchQuery = query;
    browseCurrentPage = 1; // Reset to first page
    showCategoryTickets(category);
}

// Handle browse priority filter
function handleBrowsePriorityFilter(priority, category) {
    browsePriorityFilter = priority;
    browseCurrentPage = 1; // Reset to first page
    showCategoryTickets(category);
}

// Handle browse sort
function handleBrowseSort(value, category) {
    const [field, order] = value.split('-');
    browseSortField = field;
    browseSortOrder = order;
    browseCurrentPage = 1; // Reset to first page
    showCategoryTickets(category);
}

// Handle browse page change
function handleBrowsePageChange(page, category) {
    browseCurrentPage = page;
    showCategoryTickets(category);
}

// Handle browse records per page
function handleBrowseRecordsPerPage(value, category) {
    browseRecordsPerPage = parseInt(value);
    browseCurrentPage = 1; // Reset to first page
    showCategoryTickets(category);
}

// Clear browse filters
function clearBrowseFilters(category) {
    browsePriorityFilter = 'All';
    browseSearchQuery = '';
    browseSortField = 'ticket_id';
    browseSortOrder = 'asc';
    browseCurrentPage = 1;
    browseRecordsPerPage = 20;
    showCategoryTickets(category);
}

function chatAboutTicket(ticket) {
    // Close browse modal
    closeBrowseModal();
    
    // Set flag and store browse ticket data
    viewingBrowseTicket = true;
    browseTicketData = ticket;
    
    // IMMEDIATELY update info panel with this ticket's data
    updateInfoPanelWithTicketData(ticket);
    
    // Prepare the query about this ticket
    const query = `Tell me about ticket ${ticket.ticket_id}: ${ticket.title}`;
    
    // Set it in the input field and send
    messageInput.value = query;
    handleInputChange();
    sendMessage();
    
    // Focus on input box for immediate follow-up questions
    setTimeout(() => {
        messageInput.focus();
        scrollToBottom();
    }, 500);
}

// Helper function to update info panel with ticket data
function updateInfoPanelWithTicketData(ticket) {
    // Show all cards
    classificationCard.style.display = 'block';
    escalationCard.style.display = 'block';
    metricsCard.style.display = 'block';
    similarCard.style.display = 'none'; // No similar tickets for browsed tickets
    
    // Show and update ticket ID
    const ticketIdDisplay = document.getElementById('ticketIdDisplay');
    const ticketIdValue = document.getElementById('currentTicketId');
    if (ticket.ticket_id) {
        ticketIdDisplay.style.display = 'flex';
        ticketIdValue.textContent = ticket.ticket_id;
    } else {
        ticketIdDisplay.style.display = 'none';
    }
    
    // Update Classification Card
    const category = ticket.category || 'Unknown';
    const confidence = ticket.confidence || 1.0; // Historical tickets have known categories
    const priority = ticket.priority || 'Medium';
    
    document.getElementById('infoCategory').textContent = category;
    
    // Update Priority with badge styling
    const priorityElement = document.getElementById('infoPriority');
    const priorityClass = priority === 'High' ? 'badge-high' : 
                         priority === 'Medium' ? 'badge-medium' : 'badge-low';
    priorityElement.innerHTML = `<span class="badge ${priorityClass}">${priority}</span>`;
    
    document.getElementById('infoConfidence').textContent = `${(confidence * 100).toFixed(1)}%`;
    document.getElementById('confidenceFill').style.width = `${confidence * 100}%`;
    
    // Update Routing
    const routingTeam = ticket.escalation_team || getRoutingDepartment(category);
    document.getElementById('infoRouting').textContent = routingTeam;
    
    // Update Escalation Card
    const estTime = ticket.resolution_time || ticket.resolution_time_hours || 0;
    
    // Check if it's from new tickets (has escalation_team) or browse tickets
    let escalationBadge;
    if (ticket.escalation_team) {
        // New ticket with escalation info
        if (ticket.escalation_team.includes('Manual Review')) {
            escalationBadge = '<span class="badge badge-escalate">Manual Review Required</span>';
        } else if (ticket.escalation_team.includes('L1')) {
            escalationBadge = '<span class="badge badge-auto">L1 Support</span>';
        } else if (ticket.escalation_team.includes('L2')) {
            escalationBadge = '<span class="badge badge-medium">L2 Support</span>';
        } else {
            escalationBadge = '<span class="badge badge-auto">Resolved</span>';
        }
    } else {
        // Historical ticket - already resolved
        escalationBadge = '<span class="badge badge-auto">Resolved (Historical)</span>';
    }
    
    document.getElementById('infoEscalation').innerHTML = escalationBadge;
    document.getElementById('infoEstTime').textContent = `${estTime.toFixed(1)} hours`;
    
    // Update Evaluation Metrics
    const accuracy = (confidence * 100).toFixed(1);
    document.getElementById('metricAccuracy').textContent = `${accuracy}%`;
    
    // For historical tickets, use confidence as F1 proxy
    const f1Score = confidence >= 0.9 ? confidence.toFixed(2) : (confidence * 0.95).toFixed(2);
    document.getElementById('metricF1').textContent = f1Score;
    
    // Similarity - for new tickets show max_similarity, for historical show N/A
    const similarity = ticket.max_similarity ? (ticket.max_similarity * 100).toFixed(1) : 'N/A';
    document.getElementById('metricSimilarity').textContent = similarity === 'N/A' ? similarity : similarity + '%';
    
    // LLM Judge - use quality indicator
    const llmJudge = confidence >= 0.9 ? 'A' : confidence >= 0.8 ? 'B+' : confidence >= 0.7 ? 'B' : 'C';
    document.getElementById('metricLLM').textContent = llmJudge;
    
    // Clear similar tickets
    document.getElementById('similarTicketsContainer').innerHTML = 
        '<p style="color: #9ca3af; font-size: 13px;">Viewing historical ticket</p>';
}

// New Tickets Functions
let newTicketsData = [];
let currentCategoryFilter = 'All';
let currentPage = 1;
let recordsPerPage = 10;
let currentSortField = 'ticket_id';
let currentSortOrder = 'asc';

async function openNewTicketModal() {
    newTicketModal.classList.add('active');
    
    // Show loading indicator with animated dots
    const newTicketContent = document.getElementById('newTicketContent');
    newTicketContent.innerHTML = `
        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 60px 20px; gap: 20px;">
            <div class="loading-spinner"></div>
            <div style="font-size: 16px; color: #6b7280; font-weight: 500;">
                Retrieving ticket data from database<span class="loading-dots"></span>
            </div>
            <div style="font-size: 14px; color: #9ca3af;">
                Please wait while we fetch the latest tickets...
            </div>
        </div>
    `;
    
    // Start animated dots
    startLoadingDots();
    
    try {
        const response = await fetchWithAuth(`${API_BASE_URL}/new_tickets`);
        const data = await response.json();
        
        // Stop animated dots
        stopLoadingDots();
        
        newTicketsData = data.tickets || [];
        displayNewTicketsTable();
    } catch (error) {
        stopLoadingDots();
        document.getElementById('newTicketContent').innerHTML = `
            <p style="color: #dc2626;">Error loading new tickets. Please ensure the backend is running.</p>
        `;
        console.error('New tickets error:', error);
    }
}

function closeNewTicketModal() {
    newTicketModal.classList.remove('active');
    currentCategoryFilter = 'All';
}

function displayNewTicketsTable() {
    const newTicketContent = document.getElementById('newTicketContent');
    
    // Get unique categories
    const categories = ['All', ...new Set(newTicketsData.map(t => t.category))];
    
    // Filter tickets based on current category
    const filteredTickets = currentCategoryFilter === 'All' 
        ? newTicketsData 
        : newTicketsData.filter(t => t.category === currentCategoryFilter);
    
    // Calculate pagination
    const totalRecords = filteredTickets.length;
    const totalPages = Math.ceil(totalRecords / recordsPerPage);
    const startIndex = (currentPage - 1) * recordsPerPage;
    const endIndex = Math.min(startIndex + recordsPerPage, totalRecords);
    const paginatedTickets = filteredTickets.slice(startIndex, endIndex);
    
    let html = `
        <button class="back-btn" onclick="closeNewTicketModal()" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; margin-bottom: 20px; display: flex; align-items: center; gap: 8px; width: fit-content;" title="Return to Chat">
            <img src="/static/icon/house.png" alt="Home" style="width: 18px; height: 18px; filter: brightness(0) invert(1);">
            Home
        </button>
        
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; flex-wrap: wrap; gap: 10px;">
            <div class="category-filter">
    `;
    
    categories.forEach(cat => {
        const activeClass = cat === currentCategoryFilter ? 'active' : '';
        html += `<button class="filter-btn ${activeClass}" onclick="filterNewTickets('${cat}')">${cat}</button>`;
    });
    
    html += `
            </div>
            
            <div style="display: flex; align-items: center; gap: 10px;">
                <label style="font-size: 13px; color: #6b7280; font-weight: 500;">Records per page:</label>
                <select id="recordsPerPageSelect" onchange="changeRecordsPerPage(this.value)" style="padding: 6px 12px; border: 2px solid #e5e7eb; border-radius: 6px; font-size: 13px; cursor: pointer;">
                    <option value="10" ${recordsPerPage === 10 ? 'selected' : ''}>10</option>
                    <option value="20" ${recordsPerPage === 20 ? 'selected' : ''}>20</option>
                    <option value="50" ${recordsPerPage === 50 ? 'selected' : ''}>50</option>
                    <option value="100" ${recordsPerPage === 100 ? 'selected' : ''}>100</option>
                    <option value="500" ${recordsPerPage === 500 ? 'selected' : ''}>500</option>
                </select>
            </div>
        </div>
        
        <div class="tickets-table-container">
            <table class="tickets-table">
                <thead>
                    <tr>
                        <th onclick="sortNewTickets('ticket_id')" style="cursor: pointer; user-select: none;">
                            Ticket ID ${getSortIcon('ticket_id')}
                        </th>
                        <th onclick="sortNewTickets('title')" style="cursor: pointer; user-select: none;">
                            Title ${getSortIcon('title')}
                        </th>
                        <th onclick="sortNewTickets('category')" style="cursor: pointer; user-select: none;">
                            Category ${getSortIcon('category')}
                        </th>
                        <th onclick="sortNewTickets('priority')" style="cursor: pointer; user-select: none;">
                            Priority ${getSortIcon('priority')}
                        </th>
                        <th onclick="sortNewTickets('max_similarity')" style="cursor: pointer; user-select: none;">
                            Similarity ${getSortIcon('max_similarity')}
                        </th>
                        <th onclick="sortNewTickets('escalation_team')" style="cursor: pointer; user-select: none;">
                            Escalation Team ${getSortIcon('escalation_team')}
                        </th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody>
    `;
    
    filteredTickets.forEach(ticket => {
        const priorityClass = ticket.priority === 'High' ? 'badge-high' : 
                            ticket.priority === 'Medium' ? 'badge-medium' : 'badge-low';
        
        const similarity = (ticket.max_similarity * 100).toFixed(0);
        let similarityClass = 'similarity-low';
        if (similarity >= 70) similarityClass = 'similarity-high';
        else if (similarity >= 50) similarityClass = 'similarity-medium';
        
        // Check if this is a new category
        const isNewCategory = ticket.is_new_category || false;
        const rowClass = isNewCategory ? 'new-category-row' : '';
        
        // Category display with NEW badge
        let categoryDisplay = ticket.category;
        if (isNewCategory) {
            categoryDisplay = `
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    <span>${ticket.category}</span>
                    <span class="badge badge-new-category">NEW CATEGORY</span>
                </div>
            `;
        }
        
        html += `
            <tr class="${rowClass}">
                <td class="ticket-id-cell">${ticket.ticket_id}</td>
                <td class="ticket-title-cell" title="${ticket.title}">${ticket.title}</td>
                <td>${categoryDisplay}</td>
                <td><span class="badge ${priorityClass}">${ticket.priority}</span></td>
                <td class="similarity-cell">
                    <span class="similarity-badge ${similarityClass}">${similarity}%</span>
                </td>
                <td class="escalation-cell">${ticket.escalation_team}</td>
                <td class="action-cell">
                    <button class="discuss-btn" onclick='discussNewTicket(${JSON.stringify(ticket).replace(/'/g, "&#39;")})'>
                        Discuss
                    </button>
                </td>
            </tr>
        `;
    });
    
    html += `
                </tbody>
            </table>
        </div>
        
        <!-- Pagination Controls -->
        <div style="margin-top: 20px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 15px;">
            <div style="color: #6b7280; font-size: 14px;">
                Showing <strong>${startIndex + 1}-${endIndex}</strong> of <strong>${totalRecords}</strong> tickets
            </div>
            
            <div style="display: flex; gap: 8px; align-items: center;">
                <button onclick="changePage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''} 
                    style="padding: 8px 16px; border: 2px solid #e5e7eb; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; color: #374151; ${currentPage === 1 ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                    ← Previous
                </button>
                
                <div style="display: flex; gap: 4px;">
    `;
    
    // Show page numbers (with ellipsis for many pages)
    const maxPagesToShow = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxPagesToShow / 2));
    let endPage = Math.min(totalPages, startPage + maxPagesToShow - 1);
    
    if (endPage - startPage < maxPagesToShow - 1) {
        startPage = Math.max(1, endPage - maxPagesToShow + 1);
    }
    
    if (startPage > 1) {
        html += `<button onclick="changePage(1)" style="padding: 8px 12px; border: 2px solid #e5e7eb; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; color: #374151;">1</button>`;
        if (startPage > 2) {
            html += `<span style="padding: 8px 4px; color: #9ca3af;">...</span>`;
        }
    }
    
    for (let i = startPage; i <= endPage; i++) {
        const isActive = i === currentPage;
        html += `
            <button onclick="changePage(${i})" 
                style="padding: 8px 12px; border: 2px solid ${isActive ? '#667eea' : '#e5e7eb'}; 
                background: ${isActive ? 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' : 'white'}; 
                color: ${isActive ? 'white' : '#374151'}; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: ${isActive ? '600' : '500'};">
                ${i}
            </button>
        `;
    }
    
    if (endPage < totalPages) {
        if (endPage < totalPages - 1) {
            html += `<span style="padding: 8px 4px; color: #9ca3af;">...</span>`;
        }
        html += `<button onclick="changePage(${totalPages})" style="padding: 8px 12px; border: 2px solid #e5e7eb; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; color: #374151;">${totalPages}</button>`;
    }
    
    html += `
                </div>
                
                <button onclick="changePage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''} 
                    style="padding: 8px 16px; border: 2px solid #e5e7eb; background: white; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 500; color: #374151; ${currentPage === totalPages ? 'opacity: 0.5; cursor: not-allowed;' : ''}">
                    Next →
                </button>
            </div>
        </div>
    `;
    
    newTicketContent.innerHTML = html;
}

function filterNewTickets(category) {
    currentCategoryFilter = category;
    displayNewTicketsTable();
}

function discussNewTicket(ticket) {
    // Close new ticket modal
    closeNewTicketModal();
    
    // IMMEDIATELY update info panel with this ticket's data
    updateInfoPanelWithTicketData(ticket);
    
    // Prepare detailed query about this ticket
    const query = `Analyze new ticket ${ticket.ticket_id}: ${ticket.title}. Category: ${ticket.category}, Priority: ${ticket.priority}. ${ticket.description}`;
    
    // Set it in the input field and send
    messageInput.value = query;
    handleInputChange();
    sendMessage();
    
    // Focus on input box for immediate follow-up questions
    setTimeout(() => {
        messageInput.focus();
        scrollToBottom();
    }, 500);
}

// Copy Message
function copyMessage(content, button) {
    // Remove HTML tags for clean copy
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const cleanText = tempDiv.textContent || tempDiv.innerText;
    
    navigator.clipboard.writeText(cleanText).then(() => {
        button.innerHTML = '&#10004;'; // Checkmark
        button.style.color = '#10b981';
        
        setTimeout(() => {
            button.innerHTML = '&#128203;'; // Copy icon
            button.style.color = '';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        button.innerHTML = '&#10008;'; // X mark
        button.style.color = '#ef4444';
        setTimeout(() => {
            button.innerHTML = '&#128203;';
            button.style.color = '';
        }, 2000);
    });
}

// Share Message
function shareMessage(content) {
    // Remove HTML tags for clean share
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = content;
    const cleanText = tempDiv.textContent || tempDiv.innerText;
    
    // Try to use Web Share API if available
    if (navigator.share) {
        navigator.share({
            title: 'AI Ticket Support Response',
            text: cleanText
        }).catch(err => console.log('Share cancelled or failed:', err));
    } else {
        // Fallback: Copy link to clipboard
        const shareText = `AI Ticket Support Response:\n\n${cleanText}`;
        navigator.clipboard.writeText(shareText).then(() => {
            alert('Response copied to clipboard! You can now share it.');
        }).catch(err => {
            console.error('Failed to copy for sharing:', err);
            alert('Unable to share. Please copy the message manually.');
        });
    }
}

// Display API Warning Banner
function displayApiWarning(warning) {
    // Check if warning banner already exists
    let banner = document.getElementById('apiWarningBanner');
    
    if (!banner) {
        // Create warning banner
        banner = document.createElement('div');
        banner.id = 'apiWarningBanner';
        banner.className = 'api-warning-banner';
        
        // Insert at top of chat container
        const chatContainer = document.querySelector('.chat-container');
        chatContainer.insertBefore(banner, chatContainer.firstChild);
    }
    
    // Set warning content based on type
    const bgColor = warning.type === 'rate_limit' ? '#fef3c7' : '#fee2e2';
    const borderColor = warning.type === 'rate_limit' ? '#f59e0b' : '#ef4444';
    const textColor = warning.type === 'rate_limit' ? '#92400e' : '#991b1b';
    
    banner.style.background = bgColor;
    banner.style.borderColor = borderColor;
    banner.style.color = textColor;
    
    banner.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="flex: 1;">
                <strong>${warning.type === 'rate_limit' ? 'Groq API Rate Limit' : 'Groq API Error'}</strong>
                <p style="margin: 4px 0 0 0; font-size: 13px;">${warning.message}</p>
            </div>
            <button onclick="hideApiWarning()" style="background: none; border: none; color: inherit; cursor: pointer; font-size: 20px; padding: 4px 8px;">×</button>
        </div>
    `;
    
    // Show banner with animation
    banner.style.display = 'block';
    setTimeout(() => banner.classList.add('show'), 10);
}

// Hide API Warning Banner
function hideApiWarning() {
    const banner = document.getElementById('apiWarningBanner');
    if (banner) {
        banner.classList.remove('show');
        setTimeout(() => {
            banner.style.display = 'none';
        }, 300);
    }
}

// Display API Error Banner (for critical errors like API key, rate limit, model errors)
function displayApiError(errorData) {
    // Remove any existing error banner
    const existingBanner = document.getElementById('apiErrorBanner');
    if (existingBanner) {
        existingBanner.remove();
    }
    
    // Create error banner
    const banner = document.createElement('div');
    banner.id = 'apiErrorBanner';
    banner.className = 'api-error-banner';
    
    // Determine error styling based on error type
    let iconImg = '<img src="/static/icon/api_key_error.png" alt="Error" style="width: 48px; height: 48px;">';
    let title = 'API Error';
    let bgColor = '#fee2e2';
    let borderColor = '#ef4444';
    
    switch(errorData.error_type) {
        case 'api_key_error':
            iconImg = '<img src="/static/icon/api_key_error.png" alt="API Key Error" style="width: 48px; height: 48px;">';
            title = 'API Key Error';
            bgColor = '#fee2e2';
            borderColor = '#dc2626';
            break;
        case 'rate_limit_error':
            iconImg = '<img src="/static/icon/api_key_error.png" alt="Rate Limit" style="width: 48px; height: 48px;">';
            title = 'Rate Limit Exceeded';
            bgColor = '#fef3c7';
            borderColor = '#f59e0b';
            break;
        case 'model_error':
            iconImg = '<img src="/static/icon/api_key_error.png" alt="Model Error" style="width: 48px; height: 48px;">';
            title = 'Model Configuration Error';
            bgColor = '#fef3c7';
            borderColor = '#f59e0b';
            break;
        case 'network_error':
            iconImg = '<img src="/static/icon/api_key_error.png" alt="Network Error" style="width: 48px; height: 48px;">';
            title = 'Network Connection Error';
            bgColor = '#fee2e2';
            borderColor = '#ef4444';
            break;
        default:
            iconImg = '<img src="/static/icon/api_key_error.png" alt="System Error" style="width: 48px; height: 48px;">';
            title = 'System Error';
    }
    
    banner.innerHTML = `
        <div style="display: flex; align-items: start; gap: 15px; padding: 20px; background: ${bgColor}; border: 3px solid ${borderColor}; border-radius: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
            <div style="line-height: 1;">${iconImg}</div>
            <div style="flex: 1;">
                <div style="font-size: 18px; font-weight: 700; color: #991b1b; margin-bottom: 8px;">${title}</div>
                <div style="font-size: 14px; color: #7f1d1d; margin-bottom: 12px; line-height: 1.6;">${errorData.message}</div>
                ${errorData.action ? `
                    <div style="background: white; padding: 12px; border-radius: 8px; border-left: 4px solid ${borderColor}; margin-bottom: 12px;">
                        <div style="font-size: 12px; font-weight: 600; color: #6b7280; margin-bottom: 4px;">ACTION REQUIRED:</div>
                        <div style="font-size: 13px; color: #374151;">${errorData.action}</div>
                    </div>
                ` : ''}
                <div style="display: flex; gap: 10px; margin-top: 12px;">
                    <button onclick="hideApiError()" style="padding: 8px 16px; background: white; border: 2px solid ${borderColor}; border-radius: 6px; color: ${borderColor}; font-weight: 600; cursor: pointer; font-size: 13px;">
                        Dismiss
                    </button>
                    ${errorData.error_type === 'network_error' ? `
                        <button onclick="location.reload()" style="padding: 8px 16px; background: ${borderColor}; border: 2px solid ${borderColor}; border-radius: 6px; color: white; font-weight: 600; cursor: pointer; font-size: 13px;">
                            Reload Page
                        </button>
                    ` : ''}
                </div>
            </div>
            <button onclick="hideApiError()" style="background: none; border: none; color: #991b1b; cursor: pointer; font-size: 24px; padding: 0; line-height: 1; font-weight: bold;">×</button>
        </div>
    `;
    
    // Insert at top of chat messages
    chatMessages.insertBefore(banner, chatMessages.firstChild);
    
    // Animate in
    setTimeout(() => banner.style.opacity = '1', 10);
    
    // Scroll to show error
    chatMessages.scrollTop = 0;
}

// Hide API Error Banner
function hideApiError() {
    const banner = document.getElementById('apiErrorBanner');
    if (banner) {
        banner.style.opacity = '0';
        setTimeout(() => banner.remove(), 300);
    }
}

// Loading Dots Animation
let loadingDotsInterval = null;

function startLoadingDots() {
    let dotCount = 0;
    const dotsElement = document.querySelector('.loading-dots');
    
    if (dotsElement) {
        loadingDotsInterval = setInterval(() => {
            dotCount = (dotCount + 1) % 4;
            dotsElement.textContent = '.'.repeat(dotCount);
        }, 400);
    }
}

function stopLoadingDots() {
    if (loadingDotsInterval) {
        clearInterval(loadingDotsInterval);
        loadingDotsInterval = null;
    }
}

// Sorting helper functions
function getSortIcon(field) {
    if (currentSortField !== field) {
        return '<span style="opacity: 0.3; font-size: 12px;">↕</span>';
    }
    return currentSortOrder === 'asc' 
        ? '<span style="font-size: 12px;">↑</span>' 
        : '<span style="font-size: 12px;">↓</span>';
}

function sortNewTickets(field) {
    // Toggle order if same field, otherwise default to ascending
    if (currentSortField === field) {
        currentSortOrder = currentSortOrder === 'asc' ? 'desc' : 'asc';
    } else {
        currentSortField = field;
        currentSortOrder = 'asc';
    }
    
    // Sort the filtered tickets
    const filteredTickets = currentCategoryFilter === 'All' 
        ? newTicketsData 
        : newTicketsData.filter(t => t.category === currentCategoryFilter);
    
    filteredTickets.sort((a, b) => {
        let aVal = a[field];
        let bVal = b[field];
        
        // Handle priority sorting with custom order
        if (field === 'priority') {
            const priorityOrder = { 'High': 3, 'Medium': 2, 'Low': 1 };
            aVal = priorityOrder[aVal] || 0;
            bVal = priorityOrder[bVal] || 0;
        }
        
        // Handle numeric fields
        if (field === 'max_similarity') {
            aVal = parseFloat(aVal) || 0;
            bVal = parseFloat(bVal) || 0;
        }
        
        // Handle string fields
        if (typeof aVal === 'string' && typeof bVal === 'string') {
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
        }
        
        // Compare
        if (aVal < bVal) return currentSortOrder === 'asc' ? -1 : 1;
        if (aVal > bVal) return currentSortOrder === 'asc' ? 1 : -1;
        return 0;
    });
    
    // Update the data with sorted tickets
    if (currentCategoryFilter === 'All') {
        newTicketsData = filteredTickets;
    } else {
        // Replace filtered tickets in original array
        newTicketsData = newTicketsData.filter(t => t.category !== currentCategoryFilter).concat(filteredTickets);
    }
    
    // Reset to first page after sorting
    currentPage = 1;
    
    // Redisplay table
    displayNewTicketsTable();
}

// Pagination helper functions
function changePage(page) {
    currentPage = page;
    displayNewTicketsTable();
}

function changeRecordsPerPage(value) {
    recordsPerPage = parseInt(value);
    currentPage = 1; // Reset to first page when changing page size
    displayNewTicketsTable();
}

// Handle Routing Click - Smart routing confirmation
function handleRoutingClick(routingTeam, ticketData) {
    const category = ticketData.classification?.category || 'Unknown';
    const priority = ticketData.metadata?.priority || 'Medium';
    const ticketId = ticketData.metadata?.ticket_id || 'Current Ticket';
    
    // Create custom confirmation dialog
    const dialogHTML = `
        <div style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.6); z-index: 2000; display: flex; align-items: center; justify-content: center; animation: fadeIn 0.3s;" id="routingDialog">
            <div style="background: white; border-radius: 16px; max-width: 500px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3); animation: slideUp 0.3s;">
                <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 16px 16px 0 0;">
                    <h3 style="margin: 0; font-size: 20px; font-weight: 700;">Route Ticket</h3>
                    <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Confirm AI-suggested routing</p>
                </div>
                
                <div style="padding: 25px;">
                    <div style="background: #f9fafb; padding: 15px; border-radius: 10px; margin-bottom: 20px; border-left: 4px solid #667eea;">
                        <div style="font-size: 13px; color: #6b7280; margin-bottom: 8px;">TICKET DETAILS</div>
                        <div style="font-size: 15px; color: #1f2937; margin-bottom: 6px;"><strong>ID:</strong> ${ticketId}</div>
                        <div style="font-size: 15px, color: #1f2937; margin-bottom: 6px;"><strong>Category:</strong> ${category}</div>
                        <div style="font-size: 15px; color: #1f2937;"><strong>Priority:</strong> <span class="badge badge-${priority === 'High' ? 'high' : priority === 'Medium' ? 'medium' : 'low'}">${priority}</span></div>
                    </div>
                    
                    <div style="background: linear-gradient(135deg, #f3f4ff 0%, #faf5ff 100%); padding: 18px; border-radius: 10px; margin-bottom: 25px; border: 2px solid #e9d5ff;">
                        <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
                            <div>
                                <div style="font-size: 13px; color: #6b7280; font-weight: 600;">AI RECOMMENDED ROUTING</div>
                                <div style="font-size: 16px; color: #667eea; font-weight: 700;">${routingTeam}</div>
                            </div>
                        </div>
                        <div style="font-size: 12px; color: #6b7280; line-height: 1.5;">
                            Based on ticket analysis, this is the optimal team to handle this issue.
                        </div>
                    </div>
                    
                    <div style="font-size: 14px; color: #374151; margin-bottom: 20px; text-align: center; font-weight: 500;">
                        Would you like to route this ticket to <strong style="color: #667eea;">${routingTeam}</strong>?
                    </div>
                    
                    <div style="display: flex; gap: 10px;">
                        <button onclick="confirmRouting('${routingTeam}', '${ticketId}')" style="flex: 1; padding: 14px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s;">
                            Confirm & Route
                        </button>
                        <button onclick="closeRoutingDialog()" style="flex: 1; padding: 14px; background: #e5e7eb; color: #374151; border: none; border-radius: 10px; font-size: 15px; font-weight: 600; cursor: pointer; transition: all 0.3s;">
                            Cancel
                        </button>
                    </div>
                    
                    <div style="margin-top: 15px; text-align: center;">
                        <button onclick="showAlternativeTeams('${category}')" style="background: none; border: none; color: #667eea; font-size: 13px; cursor: pointer; text-decoration: underline;">
                            View Alternative Teams
                        </button>
                    </div>
                </div>
            </div>
        </div>
        
        <style>
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            @keyframes slideUp {
                from { transform: translateY(30px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
        </style>
    `;
    
    // Add dialog to page
    const dialogDiv = document.createElement('div');
    dialogDiv.innerHTML = dialogHTML;
    document.body.appendChild(dialogDiv);
}

// Confirm Routing
function confirmRouting(team, ticketId) {
    closeRoutingDialog();
    
    // Show success message
    const successMsg = document.createElement('div');
    successMsg.style.cssText = 'position: fixed; top: 20px; right: 20px; background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 18px 24px; border-radius: 12px; box-shadow: 0 8px 20px rgba(16, 185, 129, 0.4); z-index: 3000; animation: slideInRight 0.3s; font-size: 15px; font-weight: 600;';
    successMsg.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div>
                <div style="font-size: 16px; margin-bottom: 4px; font-weight: 700;">Ticket Routed Successfully!</div>
                <div style="font-size: 13px; opacity: 0.9;">${ticketId} → ${team}</div>
            </div>
        </div>
    `;
    
    document.body.appendChild(successMsg);
    
    // Add slide in animation
    const style = document.createElement('style');
    style.textContent = '@keyframes slideInRight { from { transform: translateX(400px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }';
    document.head.appendChild(style);
    
    // Remove after 4 seconds
    setTimeout(() => {
        successMsg.style.animation = 'slideInRight 0.3s reverse';
        setTimeout(() => successMsg.remove(), 300);
    }, 4000);
}

// Close Routing Dialog
function closeRoutingDialog() {
    const dialog = document.getElementById('routingDialog');
    if (dialog) {
        dialog.parentElement.remove();
    }
}

// Show Alternative Teams
function showAlternativeTeams(category) {
    const teams = {
        'Infrastructure': ['Infrastructure Team', 'Cloud Operations', 'Server Management'],
        'Database': ['Database Admin Team', 'Data Engineering', 'Database Support'],
        'Security': ['Security Operations', 'Cybersecurity Team', 'InfoSec'],
        'Network': ['Network Operations', 'Network Engineering', 'Connectivity Support'],
        'Access Management': ['IAM Team', 'Identity Services', 'Access Control'],
        'Application': ['Application Support', 'Software Engineering', 'Dev Support']
    };
    
    const alternativeTeams = teams[category] || ['General Support', 'Help Desk', 'Technical Support'];
    
    const dialog = document.getElementById('routingDialog');
    const content = dialog.querySelector('div > div:last-child');
    
    content.innerHTML = `
        <h4 style="margin: 0 0 15px 0; color: #374151; font-size: 16px;">Alternative Teams for ${category}</h4>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-bottom: 20px;">
            ${alternativeTeams.map(team => `
                <button onclick="confirmRouting('${team}', 'Current Ticket')" style="padding: 14px; background: white; border: 2px solid #e5e7eb; border-radius: 10px; text-align: left; cursor: pointer; transition: all 0.2s; font-size: 14px; font-weight: 500; color: #374151;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <span>${team}</span>
                        <span style="color: #667eea;">→</span>
                    </div>
                </button>
            `).join('')}
        </div>
        <button onclick="closeRoutingDialog()" style="width: 100%; padding: 12px; background: #e5e7eb; color: #374151; border: none; border-radius: 10px; font-size: 14px; font-weight: 600; cursor: pointer;">
            Cancel
        </button>
    `;
}

// Load Initial Dashboard
async function loadInitialDashboard() {
    try {
        // Fetch stats and new tickets count
        const [statsResponse, newTicketsResponse] = await Promise.all([
            fetchWithAuth(`${API_BASE_URL}/stats`),
            fetchWithAuth(`${API_BASE_URL}/new_tickets`)
        ]);
        
        const statsData = await statsResponse.json();
        const newTicketsData = await newTicketsResponse.json();
        
        const totalTickets = statsData.total_tickets || 0;
        const newTickets = newTicketsData.tickets?.length || 0;
        const categories = statsData.categories || {};
        const priorities = statsData.priorities || {};
        
        // Hide ticket ID display
        document.getElementById('ticketIdDisplay').style.display = 'none';
        
        // Show all info cards
        classificationCard.style.display = 'block';
        escalationCard.style.display = 'block';
        metricsCard.style.display = 'block';
        similarCard.style.display = 'block';
        
        // Update Classification Card with Database Overview
        document.getElementById('infoCategory').innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 32px; font-weight: 700; color: #667eea; margin-bottom: 5px;">${totalTickets}</div>
                <div style="font-size: 12px; color: #6b7280;">Total Tickets in Database</div>
            </div>
        `;
        document.getElementById('infoPriority').innerHTML = `
            <div style="text-align: center;">
                <div style="font-size: 32px; font-weight: 700; color: #f59e0b; margin-bottom: 5px;">${newTickets}</div>
                <div style="font-size: 12px; color: #6b7280;">New Tickets to Review</div>
            </div>
        `;
        document.getElementById('infoConfidence').textContent = 'Ready';
        document.getElementById('confidenceFill').style.width = '100%';
        document.getElementById('infoRouting').textContent = 'AI-Powered Routing';
        
        // Update Escalation Card with Priority Breakdown
        const highPriority = priorities['High'] || 0;
        const mediumPriority = priorities['Medium'] || 0;
        const lowPriority = priorities['Low'] || 0;
        
        document.getElementById('infoEscalation').innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 8px;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 12px; color: #6b7280;">High Priority:</span>
                    <span class="badge badge-high">${highPriority}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 12px; color: #6b7280;">Medium Priority:</span>
                    <span class="badge badge-medium">${mediumPriority}</span>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <span style="font-size: 12px; color: #6b7280;">Low Priority:</span>
                    <span class="badge badge-low">${lowPriority}</span>
                </div>
            </div>
        `;
        document.getElementById('infoEstTime').textContent = `${(statsData.avg_resolution_time || 0).toFixed(1)} hours (avg)`;
        
        // Update Metrics Card with Top Categories
        const categoryEntries = Object.entries(categories).sort((a, b) => b[1] - a[1]).slice(0, 4);
        document.getElementById('metricAccuracy').innerHTML = `
            <div style="font-size: 14px; color: #667eea; font-weight: 600;">Ready to Assist</div>
        `;
        document.getElementById('metricF1').innerHTML = `
            <div style="font-size: 14px; color: #10b981; font-weight: 600;">100% Uptime</div>
        `;
        document.getElementById('metricSimilarity').innerHTML = `
            <div style="font-size: 14px; color: #f59e0b; font-weight: 600;">FAISS Enabled</div>
        `;
        document.getElementById('metricLLM').innerHTML = `
            <div style="font-size: 14px; color: #8b5cf6; font-weight: 600;">Groq AI</div>
        `;
        
        // Update Similar Tickets Card with Top Categories
        const similarContainer = document.getElementById('similarTicketsContainer');
        let categoryHTML = '<div style="display: flex; flex-direction: column; gap: 8px;">';
        categoryEntries.forEach(([category, count]) => {
            const percentage = ((count / totalTickets) * 100).toFixed(0);
            categoryHTML += `
                <div style="background: #f9fafb; padding: 10px; border-radius: 6px; border: 1px solid #e5e7eb;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                        <span style="font-size: 13px; font-weight: 600; color: #374151;">${category}</span>
                        <span style="font-size: 12px; color: #6b7280;">${count} tickets</span>
                    </div>
                    <div style="background: #e5e7eb; height: 4px; border-radius: 2px; overflow: hidden;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); height: 100%; width: ${percentage}%;"></div>
                    </div>
                </div>
            `;
        });
        categoryHTML += '</div>';
        similarContainer.innerHTML = categoryHTML;
        
    } catch (error) {
        console.error('Failed to load initial dashboard:', error);
        // Keep cards hidden on error
        classificationCard.style.display = 'none';
        escalationCard.style.display = 'none';
        metricsCard.style.display = 'none';
        similarCard.style.display = 'none';
    }
}
