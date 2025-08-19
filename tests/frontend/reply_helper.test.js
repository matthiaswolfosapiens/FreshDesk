// tests/frontend/reply_helper.test.js

const fs = require('fs');
const path = require('path');
const { mockClient } = require('./mocks');

describe('Reply Helper Logic', () => {
    let consoleErrorSpy;

    beforeEach(() => {
        jest.resetModules();
        const html = fs.readFileSync(path.resolve(__dirname, '../../app/reply_helper.html'), 'utf8');
        document.body.innerHTML = html;
        jest.clearAllMocks();

        global.app.initialized.mockResolvedValue(mockClient);
        // Default happy path mocks
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
            ticket: { id: 123, custom_fields: { application: 'ProductA' } }
        });

        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
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

            // Re-require to catch error during context fetch
            require('../../app/reply_helper.js');
            await new Promise(process.nextTick);

            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);

            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not draft reply: Ticket data missing"
            });
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
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("setValue", { id: "editor", text: "Final draft" });
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", { type: "success", message: "Draft inserted into reply." });
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

            // Should call handleDraftReply again
            mockClient.request.invokeTemplate.mockClear();
            regenerateBtn.click();
            await new Promise(process.nextTick);
            expect(mockClient.request.invokeTemplate).toHaveBeenCalledWith("postDraftReply", expect.any(Object));

            // Go back to discarded view to test the close button
            discardBtn.click();
            closeBtn.click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });

        it('should navigate back from draft and summary views', () => {
            document.getElementById('draft-back-btn').click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);

            // Helper function to quickly switch view for test
            function showView(viewName) {
                document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
                document.getElementById(`${viewName}-view`).classList.remove('hidden');
            }
            showView('summary');
            document.getElementById('summary-back-btn').click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });
    });

    describe('Internal functions', () => {
        // This is the safe way to test this behavior.
        it('should do nothing when showing a non-existent view', async () => {
            require('../../app/reply_helper.js');
            await new Promise(process.nextTick);

            const backButton = document.getElementById('draft-back-btn');

            // Manually remove a view to test the 'if (views[viewName])' check
            document.getElementById('initial-view').remove();
            expect(() => backButton.click()).not.toThrow();
        });
    });
});