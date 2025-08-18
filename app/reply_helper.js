/**
 * reply_helper.js
 * This script provides AI-powered actions ("Draft Reply", "Summarize")
 * inside the ticket conversation editor.
 */
document.addEventListener('DOMContentLoaded', () => {

    /**
     * Main async function to initialize the app logic.
     * This avoids race conditions by ensuring the client object is initialized first.
     */
    async function initReplyHelper() {
        // --- DOM Element Selection ---
        const draftReplyBtn = document.getElementById('draft-reply-btn');
        const summarizeBtn = document.getElementById('summarize-btn');

        // --- Core App Initialization ---
        let client;
        try {
            client = await app.initialized();
        } catch (error) {
            console.error("Reply Helper initialization failed:", error);
            if (draftReplyBtn) draftReplyBtn.disabled = true;
            if (summarizeBtn) summarizeBtn.disabled = true;
            return;
        }

        // --- Helper Functions (self-contained) ---

        /** Shows or hides the loading spinner. */
        function showLoading(isLoading, text = 'Generating...') {
            const spinner = document.getElementById('loading-spinner');
            const loadingText = document.getElementById('loading-text');
            const buttons = document.querySelectorAll('.button-group button');

            buttons.forEach(btn => btn.disabled = isLoading);

            if (isLoading) {
                loadingText.textContent = text;
                spinner.classList.remove('hidden');
            } else {
                spinner.classList.add('hidden');
            }
        }

        /** Safely parses a JSON response string. */
        function safeParseResponse(resp) {
            try {
                if (!resp) return null;
                if (resp.response && typeof resp.response === 'string') {
                    return JSON.parse(resp.response);
                }
                if (typeof resp === 'string') return JSON.parse(resp);
                return resp;
            } catch (e) {
                console.error("Failed to parse response:", e, resp);
                return null; // Return null on parsing error
            }
        }


        /** Parses an error object to get a user-friendly message. */
        function getErrorMessage(error) {
            if (!error) return "An unknown error occurred.";
            if (error.response) {
                try {
                    const parsed = JSON.parse(error.response);
                    return parsed?.detail || error.message || "An unknown error occurred.";
                } catch { /* Response was not valid JSON */ }
            }
            return error.message || JSON.stringify(error);
        }

        /** Formats an array of conversation objects into a single string. */
        function formatConversations(conversations) {
            const header = "Current Ticket Conversation:\n---\n";
            const formattedParts = conversations.map(convo => {
                const author = convo.private ? "Support Agent (Internal Note):" : (convo.incoming ? "Customer:" : "Support Agent:");
                const body = convo.body_text ? convo.body_text.trim() : 'No content';
                return `${author}\n${body}\n---`;
            });
            return header + formattedParts.join('\n');
        }

        /** Fetches the full ticket context (conversations) and the product type. */
        async function getTicketContextAndProductType() {
            const ticketData = await client.data.get('ticket');
            const productType = ticketData.ticket.custom_fields.application;

            const conversationData = await client.request.invokeTemplate("getTicketConversations", {
                context: { ticket_id: ticketData.ticket.id }
            });

            const conversations = safeParseResponse(conversationData);
            const context = (conversations && conversations.length > 0) ? formatConversations(conversations) : '';
            return { context, productType, ticketId: ticketData.ticket.id };
        }

        // --- Event Listeners ---

        /** Handles click on the "Draft Reply" button. */
        draftReplyBtn.addEventListener('click', async () => {
            showLoading(true, 'Drafting reply...');
            try {
                const { context, productType, ticketId } = await getTicketContextAndProductType();
                const payload = {
                    ticket_conversation_context: context,
                    product_type: productType,
                    ticket_id: ticketId
                };

                const responseData = await client.request.invokeTemplate("postDraftReply", {
                    body: JSON.stringify(payload)
                });

                const response = safeParseResponse(responseData);

                if (response && response.draft) {
                    await client.interface.trigger("setValue", { id: "editor", text: response.draft });
                } else {
                    throw new Error("Invalid response format from draft reply service.");
                }

            } catch (error) {
                console.error("Failed to draft reply:", error);
                client.interface.trigger("showNotify", { type: "danger", message: `Could not draft reply: ${getErrorMessage(error)}` });
            } finally {
                showLoading(false);
            }
        });

        /** Handles click on the "Summarize" button. */
        summarizeBtn.addEventListener('click', async () => {
            showLoading(true, 'Summarizing...');
            try {
                const { context, ticketId } = await getTicketContextAndProductType();
                const payload = {
                    ticket_conversation_context: context,
                    ticket_id: ticketId
                };

                const responseData = await client.request.invokeTemplate("postSummarize", {
                    body: JSON.stringify(payload)
                });

                const response = safeParseResponse(responseData);

                if (response && response.summary) {
                    await client.interface.trigger("setValue", { id: "editor", text: response.summary, options: { isNote: true } });
                } else {
                    throw new Error("Invalid response format from summarize service.");
                }

            } catch (error) {
                console.error("Failed to summarize:", error);
                client.interface.trigger("showNotify", { type: "danger", message: `Could not summarize: ${getErrorMessage(error)}` });
            } finally {
                showLoading(false);
            }
        });
    }

    initReplyHelper();
});