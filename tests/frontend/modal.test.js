// tests/frontend/modal.test.js (FINALE VERSION)

const fs = require('fs');
const path = require('path');
const { mockClient } = require('./mocks');

describe('Modal Logic (modal.js)', () => {
    let consoleErrorSpy, consoleWarnSpy;

    beforeEach(() => {
        jest.resetModules();
        const html = fs.readFileSync(path.resolve(__dirname, '../../app/modal.html'), 'utf8');
        document.body.innerHTML = html;
        jest.clearAllMocks();

        global.app.initialized.mockResolvedValue(mockClient);

        // Standard-Mocks
        mockClient.data.get.mockResolvedValue({
            ticket: { id: 123, subject: 'Test', description_text: 'Test desc', custom_fields: { application: 'ProductA' } }
        });
        mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
            if (templateName === 'getProductTypes') return { response: JSON.stringify(['ProductA', 'ProductB']) };
            if (templateName === 'postQuery') return { response: JSON.stringify({ answer: 'Test Answer' }) };
            return { response: '[]' }; // Default empty response for conversations etc.
        });

        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('Initialization and Product Loading', () => {
        test('should load and render product types', async () => {
            require('../../app/modal.js');
            await new Promise(r => setTimeout(r, 0));
            const container = document.getElementById('product-types-container');
            expect(container.textContent).toContain('ProductA');
        });

        test('should auto-select product type from ticket', async () => {
            document.getElementById('use-ticket-context').checked = true;
            require('../../app/modal.js');
            await new Promise(r => setTimeout(r, 0));

            const checkbox = document.getElementById('pt-ProductA');
            expect(checkbox.checked).toBe(true);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith('showNotify', expect.any(Object));
        });

        test('should handle failure when loading product types', async () => {
            mockClient.request.invokeTemplate.mockRejectedValue(new Error('API Error'));
            require('../../app/modal.js');
            await new Promise(r => setTimeout(r, 0));
            const container = document.getElementById('product-types-container');
            expect(container.textContent).toContain('Could not load product areas.');
        });

        test('should handle failure during auto-selection of product type', async () => {
            mockClient.data.get.mockRejectedValue(new Error('Ticket data fetch failed'));
            document.getElementById('use-ticket-context').checked = true;
            require('../../app/modal.js');
            await new Promise(r => setTimeout(r, 0));

            document.getElementById('use-ticket-context').dispatchEvent(new Event('change'));
            await new Promise(r => setTimeout(r, 0));

            expect(consoleWarnSpy).toHaveBeenCalledWith("Could not auto-select product type from ticket:", expect.any(Error));
        });
    });

    describe('Form Submission and Querying', () => {
        beforeEach(() => { require('../../app/modal.js'); });

        test('should do nothing if user submits an empty query', async () => {
            document.getElementById('user-input').value = '';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(r => setTimeout(r, 0));
            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(call => call[0] === 'postQuery');
            expect(postQueryCall).toBeUndefined();
        });

        test('should send query without context', async () => {
            document.getElementById('use-ticket-context').checked = false;
            document.getElementById('user-input').value = 'Query';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(r => setTimeout(r, 0));

            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(call => call[0] === 'postQuery');
            expect(JSON.parse(postQueryCall[1].body).ticket_conversation_context).toBe('');
        });

        test('should use fallback if fetching conversations fails', async () => {
            mockClient.request.invokeTemplate.mockImplementation(async (name) => {
                if (name === 'getTicketConversations') throw new Error('Conv API Failed');
                if (name === 'postQuery') return { response: JSON.stringify({ answer: 'Fallback answer' }) };
                return { response: '[]' };
            });

            document.getElementById('use-ticket-context').checked = true;
            document.getElementById('user-input').value = 'Test fallback';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(r => setTimeout(r, 0));

            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch full ticket context, using fallback:', expect.any(Error));
        });

        test('should handle empty context if all fallbacks fail', async () => {
            mockClient.request.invokeTemplate.mockRejectedValue(new Error('Conversations API failed'));
            mockClient.data.get.mockRejectedValue(new Error('Ticket API failed'));

            document.getElementById('use-ticket-context').checked = true;
            document.getElementById('user-input').value = 'Test deep failure';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(r => setTimeout(r, 0));

            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(call => call[0] === 'postQuery');
            expect(JSON.parse(postQueryCall[1].body).ticket_conversation_context).toBe('');
        });
    });

    describe('Rating Interaction', () => {
        beforeEach(() => { require('../../app/modal.js'); });

        test('should submit a rating successfully', async () => {
            document.getElementById('chat-history').innerHTML = `<div class="message assistant-message" data-conversation-id="c1" data-source-ticket-ids="[]"><div class="rating-buttons"><button class="smiley-btn" data-rating="5"></button></div></div>`;
            document.querySelector('.smiley-btn').click();
            await new Promise(process.nextTick);

            expect(mockClient.request.invokeTemplate).toHaveBeenCalledWith('postRating', expect.any(Object));
        });

        test('should not submit rating if data attributes are missing', async () => {
            document.getElementById('chat-history').innerHTML = `<div class="message assistant-message"><div class="rating-buttons"><button class="smiley-btn" data-rating="5"></button></div></div>`; // No data-conversation-id
            document.querySelector('.smiley-btn').click();
            await new Promise(process.nextTick);

            const postRatingCall = mockClient.request.invokeTemplate.mock.calls.find(call => call[0] === 'postRating');
            expect(postRatingCall).toBeUndefined();
        });
    });
});