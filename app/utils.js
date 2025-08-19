// app/utils.js

function safeParseResponse(resp) {
    try {
        if (!resp) return null;
        if (resp.response && typeof resp.response === 'string') return JSON.parse(resp.response);
        if (typeof resp === 'string') return JSON.parse(resp);
        return resp;
    } catch { return null; }
}

function getErrorMessage(error) {
    if (!error) return "An unknown error occurred.";
    if (error.response) {
        try {
            const parsed = JSON.parse(error.response);
            return parsed?.detail || error.message || "An unknown error occurred.";
        } catch { /* Not valid JSON */ }
    }
    return error.message || JSON.stringify(error);
}

function formatConversations(conversations) {
    const header = "Current Ticket Conversation:\n---\n";
    const formattedParts = conversations.map(convo => {
        const author = convo.private ? "Support Agent (Internal Note):" : (convo.incoming ? "Customer:" : "Support Agent:");
        const body = convo.body_text ? convo.body_text.trim() : 'No content';
        return `${author}\n${body}\n---`;
    });
    return header + formattedParts.join('\n');
}

module.exports = {
    safeParseResponse,
    getErrorMessage,
    formatConversations
};