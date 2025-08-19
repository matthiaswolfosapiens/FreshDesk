// app/reply_helper.js
const { safeParseResponse, getErrorMessage, formatConversations } = require('./utils.js');

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

    async function getTicketContextAndProductType() {
        const ticketData = await client.data.get('ticket');
        const productType = ticketData.ticket.custom_fields.application;

        const conversationData = await client.request.invokeTemplate("getTicketConversations", {
            context: { ticket_id: ticketData.ticket.id }
        });

        const conversations = safeParseResponse(conversationData);
        const context = (conversations && conversations.length > 0) ? formatConversations(conversations) : '';
        return { context, productType };
    }

    // --- Main Logic Functions ---
    async function handleDraftReply() {
        content.loadingText.textContent = 'Drafting reply...';
        showView('loading');
        try {
            const { context, productType } = await getTicketContextAndProductType();
            const payload = { ticket_conversation_context: context, product_type: productType };

            const responseData = await client.request.invokeTemplate("postDraftReply", { body: JSON.stringify(payload) });
            const response = safeParseResponse(responseData);

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

            const responseData = await client.request.invokeTemplate("postSummarize", { body: JSON.stringify(payload) });
            const response = safeParseResponse(responseData);

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

    buttons.accept.addEventListener('click', async () => {
        try {
            const draftToInsert = buttons.accept.dataset.draft || '';
            await client.interface.trigger("setValue", { id: "editor", text: draftToInsert });
            client.interface.trigger("showNotify", { type: "success", message: "Draft inserted into reply." });
            showView('initial');
        } catch (error) {
            console.error("Failed to set editor value:", error);
            client.interface.trigger("showNotify", { type: "danger", message: "Could not insert draft." });
        }
    });

    buttons.discard.addEventListener('click', () => {
        draftActionGroups.initial.classList.add('hidden');
        draftActionGroups.discarded.classList.remove('hidden');
    });

    buttons.regenerate.addEventListener('click', handleDraftReply);
    buttons.close.addEventListener('click', () => showView('initial'));
    showView('initial');
}

initReplyHelper();

// NEU: Exportieren für Tests
if (typeof module !== 'undefined' && module.exports) {
    module.exports = { safeParseResponse, getErrorMessage, formatConversations };
}