function safeParseResponse(resp) {
    try {
        if (!resp) return null;
        if (resp.response && typeof resp.response === 'string') return JSON.parse(resp.response);
        if (typeof resp === 'string') return JSON.parse(resp);
        return resp;
    } catch { return null; }
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
        console.log("Modal App: Client initialized");
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
        const div = document.createElement('div');
        div.className = `message ${sender}-message`;

        // Always create a span for the assistant to avoid null reference
        if (sender === 'assistant') {
            const textNode = document.createElement('span');
            if (typeof data === 'object' && data.answer) {
                textNode.textContent = data.answer;
                div.dataset.conversationId = data.conversation_id;
                div.dataset.sourceTicketIds = JSON.stringify(data.source_ticket_ids);
            } else if (typeof data === 'string') {
                textNode.textContent = data;
            }
            div.appendChild(textNode);
        } else {
            div.textContent = data;
        }

        chatHistoryEl.prepend(div);
        chatHistoryEl.scrollTop = 0;
        return div;
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

    async function onFormSubmit(event) {
        event.preventDefault();
        const userQuery = userInputEl.value.trim();
        if (!userQuery) return;

        renderMessage('user', userQuery);
        userInputEl.value = '';
        showLoading(true);

        try {
            console.log("Modal App: Fetching context for new query.");
            const context = useTicketContextCheckbox.checked ? await fetchTicketContext() : '';
            const selectedProductTypes = Array.from(productTypesContainer.querySelectorAll('input:checked')).map(cb => cb.value);

            const payload = {
                user_query: userQuery,
                chat_history: chatHistory.slice(-4),
                product_types_to_search: selectedProductTypes,
                ticket_conversation_context: context
            };

            console.log("Modal App: Sending payload to /start-task/query", payload);
            const startResponse = await client.request.invokeTemplate("startQueryTask", {
                body: JSON.stringify(payload)
            });

            const { task_id } = safeParseResponse(startResponse);
            console.log(`Modal App: Task started successfully. Task ID: ${task_id}`);

            if (!task_id) {
                throw new Error("Did not receive a valid task_id from the backend.");
            }

            console.log("Modal App: Starting to poll for task status.");

            let assistantMsgContainer = null;

            pollTaskStatus(
                client,
                task_id,
                (currentText) => { // onToken
                    if (currentText && !assistantMsgContainer) {
                        showLoading(false);
                        assistantMsgContainer = renderMessage('assistant', currentText);
                    } else if (assistantMsgContainer) {
                        assistantMsgContainer.querySelector('span').textContent = currentText;
                    }
                },
// Dies ist der onComplete-Teil innerhalb Ihrer pollTaskStatus-Funktion

                (finalResult) => { // onComplete
                    console.log("Modal App: Polling complete. Received final result:", finalResult);

                    if (!assistantMsgContainer) {
                        showLoading(false);
                        assistantMsgContainer = renderMessage('assistant', finalResult.answer);
                    } else {
                        assistantMsgContainer.querySelector('span').textContent = finalResult.answer;
                    }

                    const conversationId = finalResult.conversation_id || task_id;
                    const sourceTicketIds = finalResult.source_ticket_ids || [];

                    assistantMsgContainer.dataset.conversationId = conversationId;
                    assistantMsgContainer.dataset.sourceTicketIds = JSON.stringify(sourceTicketIds);

                    if (!assistantMsgContainer.querySelector('.rating-buttons')) {
                        const ratingContainer = document.createElement('div');
                        ratingContainer.className = 'rating-buttons';
                        ratingContainer.innerHTML = `
                              <span class="rating-prompt">How helpful was this answer?</span>
                              <button class="smiley-btn" data-rating="1" title="Very poor"><i class="fas fa-sad-tear"></i></button>
                              <button class="smiley-btn" data-rating="2" title="Poor"><i class="fas fa-frown"></i></button>
                              <button class="smiley-btn" data-rating="3" title="Neutral"><i class="fas fa-meh"></i></button>
                              <button class="smiley-btn" data-rating="4" title="Good"><i class="fas fa-smile"></i></button>
                              <button class="smiley-btn" data-rating="5" title="Excellent"><i class="fas fa-laugh-beam"></i></button>
                            `;
                        assistantMsgContainer.appendChild(ratingContainer);
                    }
                    const lastQuestion = chatHistory.length > 0 ? chatHistory[chatHistory.length - 1].question : null;
                    if (lastQuestion !== userQuery) {
                        chatHistory.push({ question: userQuery, answer: finalResult.answer });
                    }

                    console.log("Modal App: UI updated with final answer and rating buttons.");
                },
                (errorMessage) => { // onError
                    console.error("Modal App: Polling failed with error:", errorMessage);
                    showLoading(false);
                    renderMessage('error', `Error: ${errorMessage}`);
                }
            );

        } catch (error) {
            console.error("Modal App: Error in onFormSubmit:", error);
            showLoading(false);
            renderMessage('error', `Error: ${getErrorMessage(error)}`);
        }
    }

    async function submitRating(conversationId, sourceTicketIds, rating) {
        try {
            const payload = { conversation_id: conversationId, source_ticket_ids: sourceTicketIds, rating: rating };
            console.log("Modal App: Submitting rating:", payload);
            await client.request.invokeTemplate("postRating", { body: JSON.stringify(payload) });
            console.log("Modal App: Rating submitted successfully.");
        } catch (error) {
            console.error("Modal App: Failed to submit rating:", error);
            safeTrigger("showNotify", { type: "danger", message: "Could not save rating." });
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
    console.log("Modal App: Starting initial data load (product types).");
    await loadProductTypes();
    if (useTicketContextCheckbox.checked) {
        await checkAndSelectProductType();
    }
    console.log("Modal App: Initialization complete.");
}

document.addEventListener('DOMContentLoaded', initModal);