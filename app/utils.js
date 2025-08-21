// app/utils.js

// --- Configuration ---
// Central place for your backend connection details

/**
 * Polls the task status endpoint until the task is completed or failed.
 * @param {string} taskId - The ID of the task to poll.
 * @param {function} onToken - Callback function executed with the latest text on each update.
 * @param {function} onComplete - Callback function executed with the final result on success.
 * @param {function} onError - Callback function executed on failure.
 */
function pollTaskStatus(client, taskId, onToken, onComplete, onError) {
    const intervalId = setInterval(async () => {
        try {
            const response = await client.request.invokeTemplate("getTaskStatus", { context: { task_id: taskId } });
            const data = safeParseResponse(response);

            if (data) {
                onToken(data.partial_result);

                if (data.status === 'completed' || data.status === 'failed') {
                    clearInterval(intervalId);
                    if (data.status === 'completed') {
                        onComplete(data.final_result);
                    } else {
                        onError(data.error_message || 'Task failed without a specific message.');
                    }
                }
            } else {
                throw new Error("Polling response was empty or invalid.");
            }
        } catch (error) {
            clearInterval(intervalId);
            onError(getErrorMessage(error));
        }
    }, 150);
}

/**
 * Safely parses a JSON response from an API call.
 * @param {object|string} resp - The response to parse.
 * @returns {object|null} The parsed object or null on error.
 */
function safeParseResponse(resp) {
    try {
        if (!resp) return null;
        if (resp.response && typeof resp.response === 'string') return JSON.parse(resp.response);
        if (typeof resp === 'string') return JSON.parse(resp);
        return resp;
    } catch { return null; }
}

/**
 * Extracts a user-friendly error message from an error object.
 * @param {object} error - The error object.
 * @returns {string} The error message.
 */
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

/**
 * Formats Freshdesk conversation data into a plain text string.
 * @param {Array} conversations - The array of conversation objects.
 * @returns {string} The formatted conversation text.
 */
function formatConversations(conversations) {
    const header = "Current Ticket Conversation:\n---\n";
    const formattedParts = conversations.map(convo => {
        const author = convo.private ? "Support Agent (Internal Note):" : (convo.incoming ? "Customer:" : "Support Agent:");
        const body = convo.body_text ? convo.body_text.trim() : 'No content';
        return `${author}\n${body}\n---`;
    });
    return header + formattedParts.join('\n');
}