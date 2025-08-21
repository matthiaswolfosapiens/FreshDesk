// modal.js (überarbeitet: sichere interface-Aufrufe, ID-Sanitizing, zuverlässiges Aufräumen)

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

async function initModal() {
    const chatHistoryEl = document.getElementById('chat-history');
    const chatForm = document.getElementById('chat-form');
    const userInputEl = document.getElementById('user-input');
    const sendButton = document.getElementById('send-button');
    const productTypesContainer = document.getElementById('product-types-container');
    const useTicketContextCheckbox = document.getElementById('use-ticket-context');
    const chatHistory = [];

    // Track auto-selected product types (original values)
    const autoSelectedProductTypes = new Set();
    // Map product value -> sanitized DOM id
    const productValueToId = new Map();

    let client;
    try {
        client = await app.initialized();
    } catch (error) {
        console.error("Modal initialization failed:", error);
        renderMessage('error', 'Could not initialize the app. Please try closing and reopening the modal.');
        return;
    }

    // --- helper: safe trigger (prevents Interface API errors) ---
    async function safeTrigger(action, payload = {}) {
        try {
            if (client && client.interface && typeof client.interface.trigger === 'function') {
                return await client.interface.trigger(action, payload);
            } else {
                console.warn(`Interface API not available for action "${action}"`);
            }
        } catch (e) {
            // don't rethrow — log and continue
            console.warn(`safeTrigger failed for "${action}":`, e);
        }
    }

    // sanitize a string to a valid, predictable DOM id
    function makeSafeId(value) {
        return `pt-${String(value).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '')}`;
    }

    // Normalize ticket field into array of product type strings
    function parseTicketProductTypes(raw) {
        if (!raw) return [];
        if (Array.isArray(raw)) return raw.map(x => String(x).trim()).filter(Boolean);
        if (typeof raw === 'string') {
            // try JSON parse
            try {
                const maybe = JSON.parse(raw);
                if (Array.isArray(maybe)) return maybe.map(x => String(x).trim()).filter(Boolean);
            } catch (e) { /* not JSON */ }
            return raw.split(',').map(s => s.trim()).filter(Boolean);
        }
        return [String(raw).trim()].filter(Boolean);
    }

    async function checkAndSelectProductType() {
        autoSelectedProductTypes.clear();

        try {
            const ticketData = await client.data.get('ticket');
            const raw = ticketData?.ticket?.custom_fields?.cf_track_and_trace;
            const productTypesFromTicket = parseTicketProductTypes(raw);

            if (!productTypesFromTicket || productTypesFromTicket.length === 0) {
                console.warn("No product types found on ticket to auto-select.");
                return;
            }

            productTypesFromTicket.forEach(pt => {
                const safeId = productValueToId.get(pt) || makeSafeId(pt);
                const checkbox = document.getElementById(safeId);
                if (checkbox) {
                    // only mark as auto-selected if it wasn't already checked by the user
                    if (!checkbox.checked) {
                        checkbox.checked = true;
                        autoSelectedProductTypes.add(pt);
                    } else {
                        // If user already had it checked, we don't add to autoSelectedProductTypes
                        // so we won't uncheck it when context is removed.
                    }
                } else {
                    console.warn(`Product type '${pt}' from ticket not found in the available list.`);
                }
            });

            if (autoSelectedProductTypes.size > 0) {
                await safeTrigger("showNotify", { type: "info", message: `Auto-selected product area(s): ${Array.from(autoSelectedProductTypes).join(', ')}` });
            } else {
                await safeTrigger("showNotify", { type: "info", message: `Ticket product areas present but already selected or not available.` });
            }
        } catch (error) {
            console.warn("Could not auto-select product type(s) from ticket:", error);
        }
    }

    function clearAutoSelectedProductTypes() {
        try {
            // Uncheck only those we auto-selected
            autoSelectedProductTypes.forEach(pt => {
                const safeId = productValueToId.get(pt) || makeSafeId(pt);
                const checkbox = document.getElementById(safeId);
                if (checkbox) {
                    checkbox.checked = false;
                }
            });
        } catch (e) {
            console.warn("Error while clearing auto-selected product types:", e);
        } finally {
            // always clear the set, even if notification fails
            autoSelectedProductTypes.clear();
            // notify safely
            if (client && client.interface) {
                safeTrigger("showNotify", {
                    type: "info",
                    message: `Auto-selected product area(s) cleared.`
                });
            }
        }
    }

    chatForm.addEventListener('submit', onFormSubmit);
    chatHistoryEl.addEventListener('click', onRatingClick);

    useTicketContextCheckbox.addEventListener('change', async (event) => {
        if (event.target.checked) {
            // ensure product types are available
            const anyCheckbox = productTypesContainer.querySelector('input[type="checkbox"]');
            if (!anyCheckbox) {
                await loadProductTypes(); // loadProductTypes will call checkAndSelectProductType if checkbox is checked
                // still call again just to be robust
                await checkAndSelectProductType();
            } else {
                await checkAndSelectProductType();
            }
        } else {
            // clear only auto-selected entries, keep user selections intact
            clearAutoSelectedProductTypes();
        }
    });

    userInputEl.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            chatForm.requestSubmit();
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

            const filteredProducts = productArray.filter(pt => pt.toLowerCase() !== 'unknown');

            productTypesContainer.innerHTML = '';
            productValueToId.clear();

            filteredProducts.forEach(pt => {
                const div = document.createElement('div');
                div.className = 'product-item';
                const safeId = makeSafeId(pt);
                productValueToId.set(pt, safeId);

                div.innerHTML = `<input type="checkbox" id="${safeId}" value="${pt}"><label for="${safeId}">${pt}</label>`;
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
            safeTrigger("showNotify", { type: "danger", message: "Could not save rating." });
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

            console.log("Payload:", payload);
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
    await loadProductTypes();
    if (useTicketContextCheckbox.checked) {
        await checkAndSelectProductType();
    }
}

document.addEventListener('DOMContentLoaded', initModal);