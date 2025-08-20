// tests/frontend/modal.test.js

const fs = require('fs');
const path = require('path');
const { mockClient } = require('./mocks');

const initApp = async () => {
    require('../../app/modal.js');
    document.dispatchEvent(new Event('DOMContentLoaded'));
    await new Promise(process.nextTick);
};

describe('Modal Logic (modal.js)', () => {
    let consoleErrorSpy, consoleWarnSpy, consoleLogSpy;

    beforeEach(() => {
        jest.resetModules();
        const html = fs.readFileSync(path.resolve(__dirname, '../../app/modal.html'), 'utf8');
        document.body.innerHTML = html;
        jest.clearAllMocks();

        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

        global.app.initialized.mockResolvedValue(mockClient);
        mockClient.data.get.mockResolvedValue({
            ticket: { id: 123, subject: 'Test', description_text: 'Test desc', custom_fields: { application: 'ProductA' } }
        });
        mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
            if (templateName === 'getProductTypes') return { response: JSON.stringify(['ProductA', 'ProductB']) };
            if (templateName === 'postQuery') return { response: JSON.stringify({ answer: 'Test Answer', conversation_id: 'c1', source_ticket_ids: [1] }) };
            if (templateName === 'getTicketConversations') return { response: JSON.stringify([{ body_text: 'Test conversation' }]) };
            return { response: '{}' };
        });
    });

    afterEach(() => {
        consoleErrorSpy.mockRestore();
        consoleWarnSpy.mockRestore();
        consoleLogSpy.mockRestore();
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
            document.getElementById('user-input').value = 'First q';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            expect(document.querySelectorAll('.rating-buttons').length).toBe(1);

            document.getElementById('user-input').value = 'Second q';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            expect(document.querySelectorAll('.rating-buttons').length).toBe(1);
        });

        it('should not submit the form if the input is empty or only whitespace', async () => {
            await initApp();
            document.getElementById('user-input').value = '   ';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(c => c[0] === 'postQuery');
            expect(postQueryCall).toBeUndefined();
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
    });

    describe('Rating System', () => {
        it('should submit a rating successfully', async () => {
            await initApp();
            document.getElementById('user-input').value = 'Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            document.querySelector('.smiley-btn[data-rating="5"]').click();
            await new Promise(process.nextTick);
            expect(mockClient.request.invokeTemplate).toHaveBeenCalledWith('postRating', {
                body: JSON.stringify({ conversation_id: 'c1', source_ticket_ids: [1], rating: 5 })
            });
            expect(document.querySelector('.rating-buttons').classList.contains('disabled')).toBe(true);
            expect(document.querySelector('.rating-feedback').textContent).toBe('Thanks!');
        });

        it('should not do anything if a non-button part of the rating area is clicked', async () => {
            await initApp();
            document.getElementById('user-input').value = 'Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            document.querySelector('.rating-prompt').click();
            await new Promise(process.nextTick);
            expect(mockClient.request.invokeTemplate).not.toHaveBeenCalledWith('postRating', expect.any(Object));
        });

        it('should not do anything if a disabled rating button is clicked', async () => {
            await initApp();
            document.getElementById('user-input').value = 'Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            const ratingButton = document.querySelector('.smiley-btn');
            ratingButton.click();
            await new Promise(process.nextTick);
            mockClient.request.invokeTemplate.mockClear();
            ratingButton.click();
            await new Promise(process.nextTick);
            expect(mockClient.request.invokeTemplate).not.toHaveBeenCalledWith('postRating', expect.any(Object));
        });
    });

    describe('Failure Modes', () => {
        it('should render an error if app.initialized fails', async () => {
            global.app.initialized.mockRejectedValue(new Error('Init failed'));
            await initApp();
            expect(document.getElementById('chat-history').textContent).toContain('Could not initialize');
        });

        it('should show an error if loading product types fails', async () => {
            mockClient.request.invokeTemplate.mockRejectedValue(new Error('API Down'));
            await initApp();
            expect(document.getElementById('product-types-container').textContent).toContain('Could not load product areas');
        });

        it('should render an error in chat if the backend query itself fails', async () => {
            mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
                if (templateName === 'postQuery') {
                    throw new Error('Backend is down');
                }
                if (templateName === 'getProductTypes') return { response: '[]' };
            });
            await initApp();
            document.getElementById('user-input').value = 'My Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            expect(document.querySelector('.error-message').textContent).toContain('Error: Backend is down');
            expect(consoleErrorSpy).toHaveBeenCalledWith('Backend query failed:', expect.any(Error));
        });

        it('should show a notification if submitting a rating fails', async () => {
            mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
                if (templateName === 'postRating') throw new Error('Rating API failed');
                if (templateName === 'postQuery') return { response: JSON.stringify({ answer: 'Test Answer', conversation_id: 'c1', source_ticket_ids: [1] }) };
                return { response: '[]' };
            });
            await initApp();
            document.getElementById('user-input').value = 'Question';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            document.querySelector('.smiley-btn').click();
            await new Promise(process.nextTick);
            expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
                type: "danger",
                message: "Could not save rating."
            });
        });

        it('should return empty string and not fail if simple context fetch fails', async () => {
            mockClient.data.get.mockRejectedValue(new Error("data.get failed"));
            await initApp();
            document.getElementById('user-input').value = 'test no context';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(c => c[0] === 'postQuery');
            expect(JSON.parse(postQueryCall[1].body).ticket_conversation_context).toBe('');
        });
    });

    describe('Ticket Context Logic', () => {
        it('should auto-select product type when checkbox is checked on change', async () => {
            await initApp();
            const checkbox = document.getElementById('use-ticket-context');
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change'));
            await new Promise(process.nextTick);
            mockClient.data.get.mockClear();
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event('change'));
            await new Promise(process.nextTick);
            expect(mockClient.data.get).toHaveBeenCalledWith('ticket');
        });

        it('should do nothing when the context checkbox is unchecked', async () => {
            await initApp();
            const checkbox = document.getElementById('use-ticket-context');
            checkbox.checked = true;
            mockClient.data.get.mockClear();
            checkbox.checked = false;
            checkbox.dispatchEvent(new Event('change'));
            await new Promise(process.nextTick);
            expect(mockClient.data.get).not.toHaveBeenCalled();
        });

        it('should not check a box and should warn if product type from ticket does not exist', async () => {
            mockClient.data.get.mockResolvedValue({
                ticket: { id: 123, custom_fields: { application: 'ProductC' } }
            });
            await initApp();
            expect(document.getElementById('pt-producta').checked).toBe(false);
            expect(consoleWarnSpy).toHaveBeenCalledWith("Product type 'ProductC' from ticket not found in the available list.");
        });

        it('should fall back to simple context and log error if conversations API fails', async () => {
            mockClient.request.invokeTemplate.mockImplementation(async (name) => {
                if (name === 'getTicketConversations') throw new Error('Conversations API Down');
                if (name === 'postQuery') return { response: JSON.stringify({ answer: 'OK' }) };
                if (name === 'getProductTypes') return { response: '[]' };
                return { response: '{}' };
            });
            await initApp();
            document.getElementById('user-input').value = 'Test API failure';
            document.getElementById('chat-form').dispatchEvent(new Event('submit'));
            await new Promise(process.nextTick);
            const postQueryCall = mockClient.request.invokeTemplate.mock.calls.find(c => c[0] === 'postQuery');
            expect(JSON.parse(postQueryCall[1].body).ticket_conversation_context).toContain('Subject: Test');
            expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to fetch full ticket context, using fallback:', expect.any(Error));
        });

        it('should handle array of product types from ticket', async () => {
            mockClient.data.get.mockResolvedValue({
                ticket: { id: 123, custom_fields: { application: ['ProductA', 'ProductB'] } }
            });
            await initApp();
            expect(document.getElementById('pt-producta').checked).toBe(true);
            expect(document.getElementById('pt-productb').checked).toBe(true);
        });

        it('should handle non-string product type from ticket gracefully', async () => {
            mockClient.data.get.mockResolvedValue({
                ticket: { id: 123, custom_fields: { application: 123 } }
            });
            mockClient.request.invokeTemplate.mockImplementation(async (templateName) => {
                if (templateName === 'getProductTypes') return { response: JSON.stringify(['ProductA', '123']) };
                return { response: '[]' };
            });
            await initApp();
            expect(document.getElementById('pt-123').checked).toBe(true);
        });

        it('should not throw error when clearing a removed auto-selected type', async () => {
            await initApp();
            expect(document.getElementById('pt-producta').checked).toBe(true);

            document.getElementById('pt-producta').remove();

            const checkbox = document.getElementById('use-ticket-context');

            expect(() => {
                checkbox.checked = false;
                checkbox.dispatchEvent(new Event('change'));
            }).not.toThrow();

            await new Promise(process.nextTick);

            expect(consoleWarnSpy).not.toHaveBeenCalled();
        });
    });
});