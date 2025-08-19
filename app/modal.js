/**
 * modal.js
 * This script contains all the logic for the AI Assistant chat interface
 * that runs inside the modal window.
 */
const { safeParseResponse, getErrorMessage, formatConversations } = require('./utils.js');


async function initModal() {
    const chatHistoryEl = document.getElementById('chat-history');
    const chatForm = document.getElementById('chat-form');
    const userInputEl = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const productTypesContainer = document.getElementById('product-types-container');
    const useTicketContextCheckbox = document.getElementById('use-ticket-context');
    const chatHistory = [];

    let client;
    try {
        client = await app.initialized();
    } catch (error) {
        console.error("Modal initialization failed:", error);
        renderMessage('error', 'Could not initialize the app. Please try closing and reopening the modal.');
        return;
    }

    async function checkAndSelectProductType() {
        try {
            const ticketData = await client.data.get('ticket');
            const productTypeFromTicket = ticketData.ticket.custom_fields.application;
            if (productTypeFromTicket) {
                const checkbox = document.getElementById(`pt-${productTypeFromTicket}`);
                if (checkbox) {
                    checkbox.checked = true;
                    client.interface.trigger("showNotify", { type: "info", message: `Product area '${productTypeFromTicket}' auto-selected.` });
                }
            }
        } catch (error) {
            console.warn("Could not auto-select product type from ticket:", error);
        }
    }

    chatForm.addEventListener('submit', onFormSubmit);
    chatHistoryEl.addEventListener('click', onRatingClick);
    useTicketContextCheckbox.addEventListener('change', async (event) => {
        if (event.target.checked) {
            await checkAndSelectProductType();
        }
    });

    function renderMessage(sender, data) {
        const lastRatingContainer = chatHistoryEl.querySelector('.rating-buttons');
        if (lastRatingContainer) {
            lastRatingContainer.remove();
        }

        const div = document.createElement('div');
        div.className = `message ${sender}-message`;

        if (sender === 'assistant' && typeof data === 'object' && data.answer) {
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

    async function getSimpleTicketContext() {
        try {
            const data = await client.data.get('ticket');
            return `Ticket Context:\nSubject: ${data.ticket.subject || ''}\nDescription: ${data.ticket.description_text || ''}\n---`;
        } catch { return ''; }
    }

    async function fetchTicketContext() {
        try {
            const ticketData = await client.data.get('ticket');
            if (!ticketData?.ticket?.id) return '';

            const conversationData = await client.request.invokeTemplate("getTicketConversations", {
                context: { ticket_id: ticketData.ticket.id }
            });

            const conversations = safeParseResponse(conversationData);
            if (conversations && conversations.length > 0) {
                return formatConversations(conversations);
            }
            return await getSimpleTicketContext(); // Fallback
        } catch (error) {
            console.error('Failed to fetch full ticket context, using fallback:', error);
            return await getSimpleTicketContext();
        }
    }

    async function loadProductTypes() {
        try {
            const data = await client.request.invokeTemplate("getProductTypes", {});
            const productArray = safeParseResponse(data) || [];
            productTypesContainer.innerHTML = '';
            productArray.forEach(pt => {
                const div = document.createElement('div');
                div.className = 'product-item';
                div.innerHTML = `<input type="checkbox" id="pt-${pt}" value="${pt}"><label for="pt-${pt}">${pt}</label>`;
                productTypesContainer.appendChild(div);
            });

            if (useTicketContextCheckbox.checked) {
                await checkAndSelectProductType();
            }
        } catch (error) {
            console.error("Failed to load product types:", error);
            productTypesContainer.innerHTML = `<p class="error-text">Could not load product areas.</p>`;
        }
    }

    async function queryBackend(payload) {
        const options = { body: JSON.stringify(payload) };
        const resp = await client.request.invokeTemplate("postQuery", options);
        return safeParseResponse(resp);
    }

    async function submitRating(conversationId, sourceTicketIds, rating) {
        try {
            const payload = { conversation_id: conversationId, source_ticket_ids: sourceTicketIds, rating: rating };
            await client.request.invokeTemplate("postRating", { body: JSON.stringify(payload) });
            console.log("Rating submitted successfully.");
        } catch (error) {
            console.error("Failed to submit rating:", error);
            client.interface.trigger("showNotify", { type: "danger", message: "Could not save rating." });
        }
    }

    async function onFormSubmit(event) {
        event.preventDefault();
        const userQuery = userInputEl.value.trim();
        if (!userQuery) return;

        renderMessage('user', userQuery);
        userInputEl.value = '';
        showLoading(true);

        try {
            const context = useTicketContextCheckbox.checked ? await fetchTicketContext() : '';
            const selectedProductTypes = Array.from(productTypesContainer.querySelectorAll('input:checked')).map(cb => cb.value);

            const payload = {
                user_query: userQuery,
                chat_history: chatHistory.slice(-4),
                product_types_to_search: selectedProductTypes,
                ticket_conversation_context: context
            };
            const responseData = await queryBackend(payload);

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

    function onRatingClick(event) {
        const target = event.target.closest('.smiley-btn');
        if (!target) return;

        const buttonsContainer = target.closest('.rating-buttons');
        if (buttonsContainer.classList.contains('disabled')) return;

        const rating = parseInt(target.dataset.rating, 10);
        const messageDiv = target.closest('.assistant-message');
        const { conversationId, sourceTicketIds } = messageDiv.dataset;

        if (conversationId && sourceTicketIds) {
            submitRating(conversationId, JSON.parse(sourceTicketIds), rating);
            buttonsContainer.classList.add('disabled');
            target.classList.add('selected');
            const feedbackText = document.createElement('span');
            feedbackText.className = 'rating-feedback';
            feedbackText.textContent = 'Thanks!';
            buttonsContainer.appendChild(feedbackText);
        }
    }

    // --- Initial Data Loading ---
    loadProductTypes();
    if (useTicketContextCheckbox.checked) {
        checkAndSelectProductType();
    }
}

document.addEventListener('DOMContentLoaded', initModal);

// NEU: Exportieren für Tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { safeParseResponse, getErrorMessage, formatConversations };
}