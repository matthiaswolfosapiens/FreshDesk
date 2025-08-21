async function initReplyHelper() {
    // --- Core App Initialization ---
    let client;
    try {
        client = await app.initialized();
    } catch (error) {
        console.error("Reply Helper initialization failed:", error);
        return;
    }

    // --- DOM Element Selection for all views ---
    const views = {
        initial: document.getElementById('initial-view'),
        loading: document.getElementById('loading-view'),
        draft: document.getElementById('draft-view'),
        summary: document.getElementById('summary-view'),
    };

    const buttons = {
        draftReply: document.getElementById('draft-reply-btn'),
        summarize: document.getElementById('summarize-btn'),
        accept: document.getElementById('accept-btn'),
        discard: document.getElementById('discard-btn'),
        regenerate: document.getElementById('regenerate-btn'),
        close: document.getElementById('close-btn'),
        draftBack: document.getElementById('draft-back-btn'),
        copyDraft: document.getElementById('copy-draft-btn'),
        copySummary: document.getElementById('copy-summary-btn'),
        summaryBack: document.getElementById('summary-back-btn'),
    };

    const content = {
        loadingText: document.getElementById('loading-text'),
        draftText: document.getElementById('draft-text-content'),
        summaryText: document.getElementById('summary-text-content'),
    };

    const draftActionGroups = {
        initial: document.getElementById('draft-actions-initial'),
        discarded: document.getElementById('draft-actions-discarded'),
    };

    // --- View Management ---
    function showView(viewName) {
        Object.values(views).forEach(view => view.classList.add('hidden'));
        if (views[viewName]) {
            views[viewName].classList.remove('hidden');
        }
    }

    async function handleCopyToClipboard(textSourceElement, buttonElement) {
        if (!textSourceElement || !buttonElement) return;
        const textToCopy = textSourceElement.textContent;
        const originalIcon = buttonElement.innerHTML;
        const textArea = document.createElement("textarea");
        textArea.value = textToCopy;
        textArea.style.position = "fixed";
        textArea.style.top = "-9999px";
        textArea.style.left = "-9999px";
        document.body.appendChild(textArea);
        try {
            textArea.select();
            document.execCommand('copy');
            buttonElement.innerHTML = '<i class="fas fa-check"></i>';
            await client.interface.trigger("showNotify", { type: "success", message: "Copied to clipboard!" });
            setTimeout(() => {
                buttonElement.innerHTML = originalIcon;
            }, 2000);
        } catch (err) {
            console.error('Failed to copy using execCommand:', err);
            await client.interface.trigger("showNotify", { type: "danger", message: "Could not copy text." });
        } finally {
            document.body.removeChild(textArea);
        }
    }

    async function getTicketContextAndProductType() {
        const ticketData = await client.data.get('ticket');
        const productType = ticketData?.ticket?.custom_fields?.cf_track_and_trace;
        const conversationData = await client.request.invokeTemplate("getTicketConversations", {
            context: { ticket_id: ticketData?.ticket?.id }
        });
        const conversations = safeParseResponse(conversationData) || [];
        const contextParts = [];
        if (ticketData?.ticket?.description_text) {
            const body = ticketData.ticket.description_text.trim();
            if (body) {
                contextParts.push(`Customer:\n${body}\n---`);
            }
        }
        if (conversations.length > 0) {
            conversations.forEach(convo => {
                const author = convo.private ? "Support Agent (Internal Note):" : (convo.incoming ? "Customer:" : "Support Agent:");
                const body = convo.body_text ? convo.body_text.trim() : 'No content';
                contextParts.push(`${author}\n${body}\n---`);
            });
        }
        let context = '';
        if (contextParts.length > 0) {
            context = "Current Ticket Conversation:\n---\n" + contextParts.join('\n');
        }
        return { context, productType };
    }

    async function handleDraftReply() {
        console.log("Entered Draft Reply");

        const draftActionsContainer = document.getElementById('draft-actions-container');
        if (draftActionsContainer) {
            draftActionsContainer.style.display = 'none';
        }

        showView('loading');
        content.loadingText.textContent = 'Drafting reply...';
        try {
            const { context, productType } = await getTicketContextAndProductType();
            console.log(`Context: ${context}`);
            console.log(`ProductType: ${productType}`);
            const payload = { ticket_conversation_context: context, product_type: productType };
            const startResponse = await client.request.invokeTemplate("startDraftTask", {
                body: JSON.stringify(payload)
            });
            console.log(JSON.stringify(startResponse));
            const { task_id } = safeParseResponse(startResponse);
            console.log(`Task id: ${task_id}`);
            let streamingStarted = false;

            pollTaskStatus(
                client,
                task_id,
                (currentText) => { // onToken Callback
                    if (currentText && !streamingStarted) {
                        streamingStarted = true;
                        showView('draft');
                    }
                    if (streamingStarted) {
                        content.draftText.textContent = currentText;
                    }
                },
                (finalResult) => { // onComplete Callback
                    if (!streamingStarted) {
                        showView('draft');
                    }

                    const draftContent = finalResult.draft || '';
                    content.draftText.textContent = draftContent;
                    buttons.accept.dataset.draft = draftContent;

                    if (draftActionsContainer) {
                        draftActionsContainer.style.display = 'flex';
                    }

                    draftActionGroups.initial.classList.remove('hidden');
                    draftActionGroups.discarded.classList.add('hidden');
                },
                (errorMessage) => { // onError Callback
                    client.interface.trigger("showNotify", { type: "danger", message: `Could not draft reply: ${errorMessage}` });
                    showView('initial');
                }
            );

        } catch (error) {
            client.interface.trigger("showNotify", { type: "danger", message: `Could not draft reply: ${getErrorMessage(error)}` });
            showView('initial');
        }
    }
    async function handleSummarize() {
        showView('loading');
        content.loadingText.textContent = 'Summarizing...';
        try {
            const { context } = await getTicketContextAndProductType();
            const payload = { ticket_conversation_context: context };
            const startResponse = await client.request.invokeTemplate("startSummarizeTask", {
                body: JSON.stringify(payload)
            });
            const { task_id } = safeParseResponse(startResponse);

            let streamingStarted = false;

            pollTaskStatus(
                client,
                task_id,
                (currentText) => { // onToken Callback
                    if (currentText && !streamingStarted) {
                        streamingStarted = true;
                        showView('summary');
                    }
                    if (streamingStarted) {
                        content.summaryText.textContent = currentText;
                    }
                },
                (finalResult) => { // onComplete Callback
                    if (!streamingStarted) {
                        showView('summary');
                    }
                    content.summaryText.textContent = finalResult.summary || '';
                },
                (errorMessage) => { // onError Callback
                    client.interface.trigger("showNotify", { type: "danger", message: `Could not summarize: ${errorMessage}` });
                    showView('initial');
                }
            );

        } catch (error) {
            client.interface.trigger("showNotify", { type: "danger", message: `Could not summarize: ${getErrorMessage(error)}` });
            showView('initial');
        }
    }

    // --- Event Listeners ---
    buttons.draftReply.addEventListener('click', handleDraftReply);
    buttons.summarize.addEventListener('click', handleSummarize);
    buttons.draftBack.addEventListener('click', () => showView('initial'));
    buttons.summaryBack.addEventListener('click', () => showView('initial'));
    buttons.copyDraft.addEventListener('click', () => handleCopyToClipboard(content.draftText, buttons.copyDraft));
    buttons.copySummary.addEventListener('click', () => handleCopyToClipboard(content.summaryText, buttons.copySummary));
    buttons.accept.addEventListener('click', async () => {
        const draftRaw = buttons.accept.dataset.draft || '';
        const draftHtml = ensureHtml(draftRaw);
        try {
            await client.interface.trigger("setValue", { id: "editor", text: draftHtml });
        } catch (err) {
            console.error("Draft insert failed:", err);
            await client.interface.trigger("showNotify", { type: "danger", message: "Could not insert draft." });
            return;
        }
        await client.interface.trigger("showNotify", { type: "success", message: "Draft inserted into reply." });
        showView('initial');
    });
    function ensureHtml(str) {
        if (!str) return '';
        if (/<[a-z][\s\S]*>/i.test(str)) return str;
        const paragraphs = str.split(/\n\s*\n/);
        return paragraphs
            .map(p => {
                if (p.trim() === '') {
                    return '<p>&nbsp;</p>';
                }
                const safe = escapeHtml(p);
                return `<p>${safe.replace(/\n/g, '<br>')}</p>`;
            })
            .join('');
    }

    function escapeHtml(s) {
        if (!s) return '';
        return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    }

    buttons.discard.addEventListener('click', () => {
        draftActionGroups.initial.classList.add('hidden');
        draftActionGroups.discarded.classList.remove('hidden');
    });
    buttons.regenerate.addEventListener('click', handleDraftReply);
    buttons.close.addEventListener('click', () => showView('initial'));
    showView('initial');
}

initReplyHelper();