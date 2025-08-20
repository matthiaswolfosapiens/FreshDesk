// tests/frontend/reply_helper.test.js

const fs = require('fs');
const path = require('path');
const { mockClient } = require('./mocks');

describe('Reply Helper Logic', () => {
    let consoleErrorSpy, consoleLogSpy;

    beforeEach(() => {
        jest.resetModules();
        const html = fs.readFileSync(path.resolve(__dirname, '../../app/reply_helper.html'), 'utf8');
        document.body.innerHTML = html;
        jest.clearAllMocks();

        global.app.initialized.mockResolvedValue(mockClient);
        mockClient.request.invokeTemplate.mockImplementation(async (templateName, options) => {
            if (templateName === 'getTicketConversations') {
                return { response: JSON.stringify([{ body_text: 'conversation context' }]) };
            }
            if (templateName === 'postDraftReply') {
                return { response: JSON.stringify({ draft: 'Generated draft reply.' }) };
            }
            if (templateName === 'postSummarize') {
                return { response: JSON.stringify({ summary: 'Generated summary.' }) };
            }
            return { response: '{}' };
        });
        mockClient.data.get.mockResolvedValue({
            ticket: { id: 123, description_text: 'A description.', custom_fields: { application: 'ProductA' } }
        });

        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    describe('Initialization', () => {
        it('should log an error if initialization fails', async () => {
            global.app.initialized.mockRejectedValue(new Error('Init Failed'));
            require('../../app/reply_helper.js');
            await new Promise(process.nextTick);
            expect(consoleErrorSpy).toHaveBeenCalledWith("Reply Helper initialization failed:", expect.any(Error));
        });
    });

    describe('Core Functionality', () => {
        beforeEach(() => {
            require('../../app/reply_helper.js');
        });

        it('should draft reply and show draft view', async () => {
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(document.getElementById('draft-text-content').textContent).toBe('Generated draft reply.');
            expect(document.getElementById('draft-view').classList.contains('hidden')).toBe(false);
        });

        it('should summarize and show summary view', async () => {
            document.getElementById('summarize-btn').click();
            await new Promise(process.nextTick);
            expect(document.getElementById('summary-text-content').textContent).toBe('Generated summary.');
            expect(document.getElementById('summary-view').classList.contains('hidden')).toBe(false);
        });

        it('should handle API failure when drafting a reply', async () => {
            mockClient.request.invokeTemplate.mockRejectedValue(new Error('API Error'));
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not draft reply: API Error"
            });
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });

        it('should handle invalid response when summarizing', async () => {
            mockClient.request.invokeTemplate.mockResolvedValue({ response: JSON.stringify({ wrong_key: '...' }) });
            document.getElementById('summarize-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not summarize: Invalid response from summarize service."
            });
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });

        it('should show notification if getting ticket context fails', async () => {
            mockClient.data.get.mockRejectedValue(new Error('Ticket data missing'));
            require('../../app/reply_helper.js');
            await new Promise(process.nextTick);
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not draft reply: Ticket data missing"
            });
        });

        it('should build context correctly when ticket has no description', async () => {
            mockClient.data.get.mockResolvedValue({
                ticket: { id: 123, description_text: null, custom_fields: { application: 'ProductA' } }
            });
            require('../../app/reply_helper.js');
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            const postDraftCall = mockClient.request.invokeTemplate.mock.calls.find(call => call[0] === 'postDraftReply');
            const payload = JSON.parse(postDraftCall[1].body);
            expect(payload.ticket_conversation_context).not.toContain('Customer:');
            expect(payload.ticket_conversation_context).toContain('Support Agent:');
        });
    });

    describe('View and Action Buttons', () => {
        beforeEach(() => {
            require('../../app/reply_helper.js');
        });

        it('should insert draft into editor on "Accept" click', async () => {
            document.getElementById('accept-btn').dataset.draft = 'Final draft';
            document.getElementById('accept-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("setValue", { id: "editor", text: "<p>Final draft</p>" });
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", { type: "success", message: "Draft inserted into reply." });
        });

        it('should pass through strings containing HTML-like tags without escaping', async () => {
            const draftWithHtml = 'This is <b>bold</b>.';
            document.getElementById('accept-btn').dataset.draft = draftWithHtml;
            document.getElementById('accept-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("setValue", { id: "editor", text: draftWithHtml });
        });

        it('should correctly escape special characters in non-HTML draft', async () => {
            const draftWithSpecialChars = '5 > 3 & "quote"';
            document.getElementById('accept-btn').dataset.draft = draftWithSpecialChars;
            document.getElementById('accept-btn').click();
            await new Promise(process.nextTick);
            const expectedHtml = '<p>5 &gt; 3 &amp; &quot;quote&quot;</p>';
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("setValue", { id: "editor", text: expectedHtml });
        });

        it('should handle empty paragraphs (double newlines) in draft', async () => {
            document.getElementById('accept-btn').dataset.draft = 'Line 1\n\nLine 2';
            document.getElementById('accept-btn').click();
            await new Promise(process.nextTick);
            const expectedHtml = '<p>Line 1</p><p>Line 2</p>';
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("setValue", { id: "editor", text: expectedHtml });
        });

        it('should show notification if inserting draft fails', async () => {
            mockClient.interface.trigger.mockImplementation(async (action) => {
                if (action === 'setValue') {
                    throw new Error('Editor frozen');
                }
            });
            document.getElementById('accept-btn').dataset.draft = 'A draft';
            document.getElementById('accept-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not insert draft."
            });
        });

        it('should show discard options, then regenerate, then return home', async () => {
            const discardBtn = document.getElementById('discard-btn');
            const closeBtn = document.getElementById('close-btn');
            const regenerateBtn = document.getElementById('regenerate-btn');
            discardBtn.click();
            expect(document.getElementById('draft-actions-initial').classList.contains('hidden')).toBe(true);
            expect(document.getElementById('draft-actions-discarded').classList.contains('hidden')).toBe(false);
            mockClient.request.invokeTemplate.mockClear();
            regenerateBtn.click();
            await new Promise(process.nextTick);
            expect(mockClient.request.invokeTemplate).toHaveBeenCalledWith("postDraftReply", expect.any(Object));
            discardBtn.click();
            closeBtn.click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });

        it('should navigate back from draft and summary views', () => {
            document.getElementById('draft-back-btn').click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
            function showView(viewName) {
                document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
                document.getElementById(`${viewName}-view`).classList.remove('hidden');
            }
            showView('summary');
            document.getElementById('summary-back-btn').click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });

        it('should handle invalid response when drafting a reply', async () => {
            mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
                if (templateName === 'postDraftReply') {
                    return { response: JSON.stringify({ not_the_draft: 'data' }) };
                }
                if (templateName === 'getTicketConversations') {
                    return { response: JSON.stringify([{ body_text: 'context' }]) };
                }
            });
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not draft reply: Invalid response from draft service."
            });
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });
    });

    describe('Internal functions', () => {
        it('should do nothing when showing a non-existent view', async () => {
            require('../../app/reply_helper.js');
            await new Promise(process.nextTick);
            const backButton = document.getElementById('draft-back-btn');
            document.getElementById('initial-view').remove();
            expect(() => backButton.click()).not.toThrow();
        });
    });

    describe('Helper function edge cases', () => {
        beforeEach(() => {
            require('../../app/reply_helper.js');
        });

        it('should handle various error response formats in getErrorMessage', async () => {
            mockClient.data.get.mockRejectedValue({ response: '{"detail":"Specific detail from API."}' });
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", { type: "danger", message: "Could not draft reply: Specific detail from API." });

            mockClient.data.get.mockRejectedValue({ message: "Fallback message", response: '{"other_key":"value"}' });
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", { type: "danger", message: "Could not draft reply: Fallback message" });
        });

        it('should format different conversation author types correctly', async () => {
            const conversations = [
                { private: false, incoming: true, body_text: 'Customer says hello.' },
                { private: true, incoming: false, body_text: 'This is an internal note.' },
                { body_text: null }
            ];
            mockClient.request.invokeTemplate.mockResolvedValue({ response: JSON.stringify(conversations) });

            document.getElementById('summarize-btn').click();
            await new Promise(process.nextTick);

            const summarizeCall = mockClient.request.invokeTemplate.mock.calls.find(call => call[0] === 'postSummarize');
            const payload = JSON.parse(summarizeCall[1].body);

            expect(payload.ticket_conversation_context).toContain('Customer:\nCustomer says hello.');
            expect(payload.ticket_conversation_context).toContain('Support Agent (Internal Note):\nThis is an internal note.');
            expect(payload.ticket_conversation_context).toContain('Support Agent:\nNo content');
        });
    });
});