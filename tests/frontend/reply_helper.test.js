// tests/frontend/reply_helper.test.js (FINALE KORRIGIERTE VERSION)

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

        mockClient.request.invokeTemplate.mockResolvedValue({ response: '{}' });
        mockClient.data.get.mockResolvedValue({
            ticket: { id: 123, custom_fields: { application: 'ProductA' } }
        });

        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    test('should log an error if initialization fails', async () => {
        global.app.initialized.mockRejectedValue(new Error('Init Failed'));
        require('../../app/reply_helper.js');
        await new Promise(process.nextTick);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Reply Helper initialization failed:", expect.any(Error));
    });

    describe('Core Features', () => {
        beforeEach(() => { require('../../app/reply_helper.js'); });

        test('should draft reply on button click', async () => {
            mockClient.request.invokeTemplate.mockResolvedValue({ response: JSON.stringify({ draft: 'Test draft' }) });
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(document.getElementById('draft-text-content').textContent).toBe('Test draft');
        });

        test('should summarize on button click', async () => {
            mockClient.request.invokeTemplate.mockResolvedValue({ response: JSON.stringify({ summary: 'Test summary' }) });
            document.getElementById('summarize-btn').click();
            await new Promise(process.nextTick);
            expect(document.getElementById('summary-text-content').textContent).toBe('Test summary');
        });

        test('should insert draft into editor on "Accept" click', async () => {
            document.getElementById('accept-btn').dataset.draft = 'Final draft';
            document.getElementById('accept-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("setValue", { id: "editor", text: "Final draft" });
        });
    });

    describe('Error Handling and Edge Cases', () => {
        beforeEach(() => { require('../../app/reply_helper.js'); });

        test('should show notification if drafting API call fails', async () => {
            mockClient.request.invokeTemplate.mockRejectedValue(new Error('API Failure'));
            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", expect.objectContaining({ type: "danger" }));
        });

        test('should show notification if summarizing API call fails', async () => {
            mockClient.request.invokeTemplate.mockRejectedValue(new Error('API Failure'));
            document.getElementById('summarize-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", expect.objectContaining({ type: "danger" }));
        });

        test('should show notification if setting editor value fails', async () => {
            mockClient.interface.trigger.mockImplementation(async (action) => {
                if (action === 'setValue') throw new Error('Editor failed');
            });
            document.getElementById('accept-btn').dataset.draft = 'test';
            document.getElementById('accept-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", { type: "danger", message: "Could not insert draft." });
        });

        // KORRIGIERTER TEST
        test('should handle unparsable JSON in safeParseResponse', async () => {
            // Der Mock wird spezifischer: Nur der 'postDraftReply'-Aufruf schlägt fehl.
            mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
                if (templateName === 'postDraftReply') {
                    return { response: 'this-is-not-json' };
                }
                return { response: '[]' }; // Gültige Antwort für getTicketConversations
            });

            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);

            // Die Erwartung wird spezifischer: Wir prüfen das Objekt, das geloggt wird.
            expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to parse response:", expect.any(Error), { response: 'this-is-not-json' });
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", expect.objectContaining({ message: expect.stringContaining("Invalid response") }));
        });

        test('should handle unparsable error response in getErrorMessage', async () => {
            const errorWithUnparsableResponse = new Error("API Error");
            errorWithUnparsableResponse.response = '{ not-json }';
            mockClient.request.invokeTemplate.mockRejectedValue(errorWithUnparsableResponse);

            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not draft reply: API Error"
            });
        });

        test('should correctly format conversation with no body text', async () => {
            const mockConversation = { response: JSON.stringify([{ body_text: null, private: false }]) };
            mockClient.request.invokeTemplate.mockImplementation(async (name) => name === 'getTicketConversations' ? mockConversation : { response: '{"draft": "D"}' });

            document.getElementById('draft-reply-btn').click();
            await new Promise(process.nextTick);

            const postDraftCall = mockClient.request.invokeTemplate.mock.calls.find(call => call[0] === 'postDraftReply');
            const contextBody = JSON.parse(postDraftCall[1].body);
            expect(contextBody.ticket_conversation_context).toContain("No content");
        });
    });

    describe('UI Navigation', () => {
        beforeEach(() => require('../../app/reply_helper.js'));

        test('should show discard options on "Discard" click', () => {
            document.getElementById('discard-btn').click();
            expect(document.getElementById('draft-actions-discarded').classList.contains('hidden')).toBe(false);
        });

        test('should return to initial view on "Close" click', () => {
            document.getElementById('close-btn').click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });

        test('should return to initial view on "Back" from draft click', () => {
            document.getElementById('draft-back-btn').click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });

        test('should return to initial view on "Back" from summary click', () => {
            document.getElementById('summary-back-btn').click();
            expect(document.getElementById('initial-view').classList.contains('hidden')).toBe(false);
        });
    });
});