/**
 * modal.js
 * This script contains all the logic for the AI Assistant chat interface
 * that runs inside the modal window.
 */
document.addEventListener('DOMContentLoaded', () => {

    /**
     * Main async function to initialize the app logic inside the modal.
     * This structure avoids race conditions by ensuring the client object is available
     * before any other logic runs.
     */
    async function initModal() {
        // --- DOM Element Selection ---
        const chatHistoryEl = document.getElementById('chat-history');
        const chatForm = document.getElementById('chat-form');
        const userInputEl = document.getElementById('user-input');
        const sendButton = document.getElementById('send-button');
        const productTypesContainer = document.getElementById('product-types-container');
        const useTicketContextCheckbox = document.getElementById('use-ticket-context');
        const chatHistory = []; // Use const as the array reference itself doesn't change

        // --- Core App Initialization ---
        let client;
        try {
            client = await app.initialized();
        } catch (error) {
            console.error("Modal initialization failed:", error);
            renderMessage('error', 'Could not initialize the app. Please try closing and reopening the modal.');
            return; // Stop execution if client fails to initialize
        }

        // --- Event Listeners ---
        chatForm.addEventListener('submit', (e) => onFormSubmit(e, client));
        chatHistoryEl.addEventListener('click', (e) => onRatingClick(e, client));

        // --- Initial Data Loading ---
        loadProductTypes(client);


        // --- Helper Functions ---

        /**
         * Renders a message in the chat history.
         * @param {string} sender - 'user', 'assistant', or 'error'.
         * @param {string|object} data - The message text or data object for the assistant.
         */
        function renderMessage(sender, data) {
            const lastRatingContainer = chatHistoryEl.querySelector('.rating-buttons');
            if (lastRatingContainer) {
                lastRatingContainer.remove();
            }

            const div = document.createElement('div');
            div.className = `message ${sender}-message`;

            if (sender === 'assistant' && typeof data === 'object') {
                const textNode = document.createElement('span');
                textNode.textContent = data.answer;
                div.appendChild(textNode);
                div.dataset.conversationId = data.conversation_id;
                div.dataset.sourceTicketIds = JSON.stringify(data.source_ticket_ids);

                const ratingContainer = document.createElement('div');
                ratingContainer.className = 'rating-buttons';
                ratingContainer.innerHTML = `
          <span class="rating-prompt">How helpful was this answer?</span>
          <button class="smiley-btn rating-1" data-rating="1" title="Very poor"><i class="fas fa-sad-tear"></i></button>
          <button class="smiley-btn rating-2" data-rating="2" title="Poor"><i class="fas fa-frown"></i></button>
          <button class="smiley-btn rating-3" data-rating="3" title="Neutral"><i class="fas fa-meh"></i></button>
          <button class="smiley-btn rating-4" data-rating="4" title="Good"><i class="fas fa-smile"></i></button>
          <button class="smiley-btn rating-5" data-rating="5" title="Excellent"><i class="fas fa-laugh-beam"></i></button>
        `;
                div.appendChild(ratingContainer);
            } else {
                div.textContent = data;
            }

            chatHistoryEl.prepend(div);
            chatHistoryEl.scrollTop = 0;
        }

        /** Shows or hides the loading indicator. */
        function showLoading(isLoading) {
            if (sendButton) sendButton.disabled = isLoading;
            const loadingDiv = document.getElementById('loading');
            if (isLoading && !loadingDiv) {
                const div = document.createElement('div');
                div.id = 'loading';
                div.className = 'message loading-indicator';
                div.textContent = 'Assistant is thinking...';
                chatHistoryEl.prepend(div);
                chatHistoryEl.scrollTop = 0;
            } else if (!isLoading && loadingDiv) {
                loadingDiv.remove();
            }
        }

        /** Safely parses a JSON response string. */
        function safeParseResponse(resp) {
            try {
                if (!resp) return null;
                if (resp.response && typeof resp.response === 'string') return JSON.parse(resp.response);
                if (typeof resp === 'string') return JSON.parse(resp);
                return resp;
            } catch {
                return null;
            }
        }

        /** Parses an error object to get a user-friendly message. (Reduced Complexity) */
        function getErrorMessage(error) {
            if (!error) return "An unknown error occurred.";
            if (error.response) {
                try {
                    const parsed = JSON.parse(error.response);
                    return parsed?.detail || error.message || "An unknown error occurred.";
                } catch {
                    // Response was not valid JSON
                }
            }
            return error.message || JSON.stringify(error);
        }

        // --- Data Fetching Functions (Refactored for lower complexity) ---

        /** Formats conversations into a string for the LLM. */
// NEUE, VERBESSERTE VERSION
        function formatConversations(conversations) {
            const header = "Current Ticket Conversation:\n---\n";

            const formattedParts = conversations.map(convo => {
                const author = convo.private ? "Support Agent (Internal Note):" : (convo.incoming ? "Customer:" : "Support Agent:");
                const body = convo.body_text ? convo.body_text.trim() : 'No content';
                return `${author}\n${body}\n---`;
            });

            return header + formattedParts.join('\n');
        }

        /** Fetches the simple ticket context as a fallback. */
        async function getSimpleTicketContext(client) {
            try {
                const data = await client.data.get('ticket');
                const subject = data.ticket.subject || '';
                const desc = data.ticket.description_text || '';
                return `Ticket Context:\nSubject: ${subject}\nDescription: ${desc}\n---`;
            } catch {
                return '';
            }
        }

        /** Fetches the full ticket conversation history. (Reduced Complexity) */
        async function fetchTicketContext(client) {
            try {
                const ticketData = await client.data.get('ticket');
                if (!ticketData?.ticket?.id) {
                    console.warn('Ticket ID not available.');
                    return '';
                }

                const conversationData = await client.request.invokeTemplate("getTicketConversations", {
                    context: { ticket_id: ticketData.ticket.id }
                });
                const conversations = safeParseResponse(conversationData);

                if (conversations && conversations.length > 0) {
                    return formatConversations(conversations);
                }
                // Fallback if there are no conversations
                return `Ticket Context:\nSubject: ${ticketData.ticket.subject}\nDescription: ${ticketData.ticket.description_text || ''}\n---`;
            } catch (error) {
                console.error('Failed to fetch full ticket context, using fallback:', error);
                return await getSimpleTicketContext(client);
            }
        }

        /** Loads and renders the available product types. */
        async function loadProductTypes(client) {
            try {
                const resp = await client.request.invokeTemplate("getProductTypes", {});
                const productArray = safeParseResponse(resp) || [];

                productTypesContainer.innerHTML = '';
                productArray.forEach(pt => {
                    const div = document.createElement('div');
                    div.className = 'product-item';

                    const input = document.createElement('input');
                    input.type = 'checkbox';
                    input.id = `pt-${pt}`;
                    input.value = pt;

                    const label = document.createElement('label');
                    label.htmlFor = `pt-${pt}`;
                    label.textContent = pt;

                    div.appendChild(input);
                    div.appendChild(label);
                    productTypesContainer.appendChild(div);
                });
            } catch (error) {
                console.error("Failed to load product types:", error);
                productTypesContainer.innerHTML = '<p class="error-text">Could not load product areas.</p>';
            }
        }

        /** Sends a query to the backend service. */
        async function queryBackend(client, payload) {
            const options = { body: JSON.stringify(payload) };
            const resp = await client.request.invokeTemplate("postQuery", options);
            return safeParseResponse(resp);
        }

        /** Submits a rating for a conversation. */
        async function submitRating(client, conversationId, sourceTicketIds, rating) {
            try {
                const payload = { conversation_id: conversationId, source_ticket_ids: sourceTicketIds, rating: rating };
                await client.request.invokeTemplate("postRating", { body: JSON.stringify(payload) });
                console.log("Rating submitted successfully.");
            } catch (error) {
                console.error("Failed to submit rating:", error);
                client.interface.trigger("showNotify", { type: "danger", message: "Could not save rating." });
            }
        }

        // --- Main Event Handlers ---

        /** Handles the submission of the chat form. */
        async function onFormSubmit(event, client) {
            event.preventDefault();
            const userQuery = userInputEl.value.trim();
            if (!userQuery) return;

            renderMessage('user', userQuery);
            userInputEl.value = '';
            showLoading(true);

            try {
                const context = useTicketContextCheckbox.checked ? await fetchTicketContext(client) : '';
                const selectedProductTypes = Array.from(productTypesContainer.querySelectorAll('input:checked')).map(cb => cb.value);

                const payload = {
                    user_query: userQuery,
                    chat_history: chatHistory.slice(-4),
                    product_types_to_search: selectedProductTypes,
                    ticket_conversation_context: context
                };
                const responseData = await queryBackend(client, payload);

                if (responseData && responseData.answer) {
                    renderMessage('assistant', responseData);
                    chatHistory.push({ question: userQuery, answer: responseData.answer });
                } else {
                    renderMessage('error', 'No valid response received from the assistant.');
                }
            } catch (error) {
                console.error('Backend query failed:', error);
                renderMessage('error', `Error: ${getErrorMessage(error)}`);
            } finally {
                showLoading(false);
            }
        }

        /** Handles clicks on the rating smileys. */
        function onRatingClick(event, client) {
            const target = event.target.closest('.smiley-btn');
            if (!target) return;

            const buttonsContainer = target.closest('.rating-buttons');
            if (buttonsContainer.classList.contains('disabled')) return;

            const rating = parseInt(target.dataset.rating, 10);
            const messageDiv = target.closest('.assistant-message');
            const { conversationId, sourceTicketIds } = messageDiv.dataset;

            if (conversationId && sourceTicketIds) {
                submitRating(client, conversationId, JSON.parse(sourceTicketIds), rating);

                buttonsContainer.classList.add('disabled');
                target.classList.add('selected');
                const feedbackText = document.createElement('span');
                feedbackText.className = 'rating-feedback';
                feedbackText.textContent = 'Thanks!';
                buttonsContainer.appendChild(feedbackText);
            }
        }
    }

    // Start the modal application
    initModal();
});