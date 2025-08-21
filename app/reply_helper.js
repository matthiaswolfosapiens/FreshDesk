// reply_helper.js

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
        console.log('getTicketContextAndProductType');

        const ticketData = await client.data.get('ticket');
        console.log("loading ticket data: ", ticketData);
        const productType = ticketData?.ticket?.custom_fields?.cf_track_and_trace;
        console.log("product type: ", productType);
        console.log("ticket id : ", ticketData?.ticket?.id);

        const conversationData = await client.request.invokeTemplate("getTicketConversations", {
            context: { ticket_id: ticketData?.ticket?.id }
        });
        console.log("conversationData: ", conversationData);
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

        console.log("Constructed Context:", context);

        return { context, productType };
    }
    // --- Main Logic Functions ---
    async function handleDraftReply() {
        content.loadingText.textContent = 'Drafting reply...';
        showView('loading');
        try {
            const { context, productType } = await getTicketContextAndProductType();
            const payload = { ticket_conversation_context: context, product_type: productType };
            console.log("handle Draft Reply payload: ", payload);

            const options = {
                body: JSON.stringify(payload),
                timeout: 60000
            };
            const responseData = await client.request.invokeTemplate("postDraftReply", options);

            console.log("handle DraftReply response Data: ", responseData);
            const response = safeParseResponse(responseData);
            console.log("handle DraftReply response: ", response);
            if (response && response.draft) {
                content.draftText.textContent = response.draft;
                buttons.accept.dataset.draft = response.draft;

                draftActionGroups.initial.classList.remove('hidden');
                draftActionGroups.discarded.classList.add('hidden');
                showView('draft');
            } else {
                throw new Error("Invalid response from draft service.");
            }
        } catch (error) {
            client.interface.trigger("showNotify", { type: "danger", message: `Could not draft reply: ${getErrorMessage(error)}` });
            showView('initial');
        }
    }

    async function handleSummarize() {
        content.loadingText.textContent = 'Summarizing...';
        showView('loading');
        try {
            const { context } = await getTicketContextAndProductType();
            const payload = { ticket_conversation_context: context };
            console.log("handle Summarize payload: ", payload);

            const options = {
                body: JSON.stringify(payload),
                timeout: 60000
            };
            const responseData = await client.request.invokeTemplate("postSummarize", options);

            console.log("handle Summarize response data: ", responseData);
            const response = safeParseResponse(responseData);
            console.log("handle Summarize response: ", response);
            if (response && response.summary) {
                content.summaryText.textContent = response.summary;
                showView('summary');
            } else {
                throw new Error("Invalid response from summarize service.");
            }
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
        console.log("found click. adding draftHtml", draftHtml);
        try {
            await client.interface.trigger("setValue", { id: "editor", text: draftHtml });
        } catch (err) {
            console.error("Draft insert failed:", err);
            await client.interface.trigger("showNotify", { type: "danger", message: "Could not insert draft." });
            return;
        }

        await client.interface.trigger("showNotify", { type: "success", message: "Draft inserted into reply." });
        await client.interface.trigger("hide");
    });

    function ensureHtml(str) {
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
        return s.replace(/[&<>"]/g, c => (
            { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]
        ));
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