// tests/frontend/modal.test.js

const fs = require('fs');
const path = require('path');
const { mockClient } = require('./mocks');

// Eine Hilfsfunktion, die die App in einem sauberen Zustand für jeden Test initialisiert
const initApp = async () => {
    require('../../app/modal.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise(process.nextTick);
};

describe('Modal Logic (modal.js)', () => {
    let consoleErrorSpy;
    let consoleWarnSpy;

    // Vor jedem Test werden Mocks, Module und das DOM zurückgesetzt
    beforeEach(() => {
        jest.resetModules();
        const html = fs.readFileSync(path.resolve(__dirname, '../../app/modal.html'), 'utf8');
        document.body.innerHTML = html;
        jest.clearAllMocks();

        // Konsolenausgaben abfangen, um das Testprotokoll sauber zu halten
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

        // Standard-Mock für erfolgreiche API-Aufrufe
        global.app.initialized.mockResolvedValue(mockClient);
        mockClient.data.get.mockResolvedValue({
            ticket: { id: 123, subject: 'Test', description_text: 'Test desc', custom_fields: { application: 'ProductA' } }
        });
        mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
            if (templateName === 'getProductTypes') return { response: JSON.stringify(['ProductA', 'ProductB']) };
            if (templateName === 'postQuery') return { response: JSON.stringify({ answer: 'Test Answer', conversation_id: 'c1', source_ticket_ids: [1] }) };
            if (templateName === 'getTicketConversations') return { response: JSON.stringify([{ body_text: 'Test conversation' }]) };
            return { response: '{}' }; // Default for postRating
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
    });

    describe('Core Functionality', () => {
        it('should submit a query and render a response', async () => {
            await initApp();
            document.getElementById('user-input').value = 'My Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            expect(document.getElementById('chat-history').innerHTML).toContain('Test Answer');
            expect(document.querySelector('.loading-indicator')).toBeNull();
        });

        it('should remove previous rating buttons when a new message is rendered', async () => {
            await initApp();
            // Simulate a first response
            document.getElementById('user-input').value = 'First q';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            expect(document.querySelectorAll('.rating-buttons').length).toBe(1);

            // Simulate a second response
            document.getElementById('user-input').value = 'Second q';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            expect(document.querySelectorAll('.rating-buttons').length).toBe(1);
        });

        it('should not submit the form if the input is empty or only whitespace', async () => {
            await initApp();
            document.getElementById('user-input').value = '   '; // Whitespace
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            // 'postQuery' should not have been called
            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(c => c[0] === 'postQuery');
            expect(postQueryCall).toBeUndefined();
        });
    });

    describe('Rating System', () => {
        it('should submit a rating successfully', async () => {
            await initApp();
            // Get a message with rating buttons
            document.getElementById('user-input').value = 'Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);

            document.querySelector('.smiley-btn[data-rating="5"]').click();
            await new Promise(process.nextTick);

            expect(mockClient.request.invokeTemplate).toHaveBeenCalledWith('postRating', {
                body: JSON.stringify({ conversation_id: 'c1', source_ticket_ids: [1], rating: 5 })
            });
            expect(document.querySelector('.rating-buttons').classList.contains('disabled')).toBe(true);
        });

        it('should not do anything if a disabled rating button is clicked', async () => {
            await initApp();
            document.getElementById('user-input').value = 'Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);

            const ratingButton = document.querySelector('.smiley-btn');
            ratingButton.click(); // First click
            await new Promise(process.nextTick);

            mockClient.request.invokeTemplate.mockClear(); // Clear mock history

            ratingButton.click(); // Second click
            await new Promise(process.nextTick);

            expect(mockClient.request.invokeTemplate).not.toHaveBeenCalledWith('postRating', expect.any(Object));
        });

        it('should do nothing if a non-button part of the rating area is clicked', async () => {
            await initApp();
            document.getElementById('user-input').value = 'Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);

            document.querySelector('.rating-prompt').click();
            await new Promise(process.nextTick);

            expect(mockClient.request.invokeTemplate).not.toHaveBeenCalledWith('postRating', expect.any(Object));
        });
    });

    describe('Failure Modes and Edge Cases', () => {
        it('should render an error if app.initialized fails', async () => {
            global.app.initialized.mockRejectedValue(new Error('Init failed'));
            await initApp();
            expect(document.getElementById('chat-history').textContent).toContain('Could not initialize');
            expect(consoleErrorSpy).toHaveBeenCalledWith("Modal initialization failed:", expect.any(Error));
        });

        it('should show an error if loading product types fails', async () => {
            mockClient.request.invokeTemplate.mockRejectedValue(new Error('API Down'));
            await initApp();
            expect(document.getElementById('product-types-container').textContent).toContain('Could not load product areas');
            expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to load product types:", expect.any(Error));
        });

        it('should render an error in chat if the backend query itself fails', async () => {
            mockClient.request.invokeTemplate.mockRejectedValue(new Error('Backend is down'));
            await initApp(); // Product types will fail here, but we proceed to test the form
            document.getElementById('user-input').value = 'My Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);

            expect(document.querySelector('.error-message').textContent).toContain('Error: Backend is down');
            expect(consoleErrorSpy).toHaveBeenCalledWith('Backend query failed:', expect.any(Error));
        });

        it('should render an error if the backend response is valid but lacks an answer', async () => {
            mockClient.request.invokeTemplate.mockImplementation(async (name) => {
                if (name === 'postQuery') return { response: JSON.stringify({ not_the_answer: 'data' }) };
                if (name === 'getProductTypes') return { response: '[]' };
            });
            await initApp();
            document.getElementById('user-input').value = 'My Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);

            expect(document.querySelector('.error-message').textContent).toBe('No valid response received from the assistant.');
        });

        it('should show a notification if submitting a rating fails', async () => {
            // Mock postRating to fail, but other calls to succeed
            mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
                if (templateName === 'postRating') throw new Error('Rating API failed');
                if (templateName === 'postQuery') return { response: JSON.stringify({ answer: 'Test Answer', conversation_id: 'c1', source_ticket_ids: [1] }) };
                return { response: '[]' };
            });
            await initApp();
            document.getElementById('user-input').value = 'My Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);

            document.querySelector('.smiley-btn').click();
            await new Promise(process.nextTick);

            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not save rating."
            });
            expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to submit rating:", expect.any(Error));
        });
    });

    describe('Ticket Context Logic', () => {
        // FIXED TEST
        it('should NOT get ticket data during init if checkbox is unchecked', async () => {
            document.getElementById('use-ticket-context').checked = false;
            await initApp();
            expect(mockClient.data.get).not.toHaveBeenCalled();
        });

        it('should handle ticket without a product type custom field', async () => {
            mockClient.data.get.mockResolvedValue({
                ticket: { id: 123, custom_fields: {} } // No 'application' field
            });
            await initApp(); // Auto-select runs by default
            // No notification should be triggered because nothing was found
            expect(mockClient.interface.trigger).not.toHaveBeenCalledWith("showNotify", expect.any(Object));
        });

        it('should not check a box if product type from ticket does not exist in the list', async () => {
            mockClient.data.get.mockResolvedValue({
                ticket: { id: 123, custom_fields: { application: 'ProductC' } }
            });
            await initApp(); // Auto-select runs
            expect(document.getElementById('pt-ProductA').checked).toBe(false);
            expect(document.getElementById('pt-ProductB').checked).toBe(false);
            expect(consoleWarnSpy).toHaveBeenCalled();
        });

        it('should fall back to simple context if conversations API returns an empty array', async () => {
            mockClient.request.invokeTemplate.mockImplementation(async (name) => {
                if (name === 'getTicketConversations') return { response: '[]' }; // Empty array
                if (name === 'postQuery') return { response: JSON.stringify({ answer: 'OK' }) };
                return { response: '{}' };
            });
            await initApp();
            document.getElementById('user-input').value = 'Test fallback';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);

            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(c => c[0] === 'postQuery');
            expect(JSON.parse(postQueryCall[1].body).ticket_conversation_context).toContain('Subject: Test');
        });

        it('should provide empty context if ticket data is fetched but has no ID', async () => {
            mockClient.data.get.mockResolvedValue({ ticket: { subject: 'no id here' } }); // No ID
            await initApp();
            document.getElementById('user-input').value = 'Test no id';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);

            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(c => c[0] === 'postQuery');
            expect(JSON.parse(postQueryCall[1].body).ticket_conversation_context).toBe('');
        });
    });
});