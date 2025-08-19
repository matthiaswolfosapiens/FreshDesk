// app.test.js

const fs = require('fs');
const path = require('path');
const { mockClient } = require('./mocks');

describe('Main App Logic (app.js)', () => {

    let consoleErrorSpy;
    beforeEach(() => {
        jest.resetModules();
        const html = fs.readFileSync(path.resolve(__dirname, '../../app/index.html'), 'utf8');
        document.body.innerHTML = html;
        jest.clearAllMocks();
        global.app.initialized.mockResolvedValue(mockClient);
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        consoleErrorSpy.mockRestore();
    });

    test('should trigger "showModal" when the open modal button is clicked', async () => {
        require('../../app/app.js');
        await new Promise(process.nextTick);
        document.getElementById('open-modal-btn').click();

        expect(mockClient.interface.trigger).toHaveBeenCalledWith("showModal", {
            title: "osapiens AI Assistant",
            template: "modal.html",
        });
    });

    test('should show a notification if opening the modal fails', async () => {
        require('../../app/app.js');
        await new Promise(process.nextTick);

        mockClient.interface.trigger.mockImplementation((action) => {
            if (action === 'showModal') {
                return Promise.reject(new Error('Modal Failure'));
            }
            return Promise.resolve({});
        });

        document.getElementById('open-modal-btn').click();
        await new Promise(process.nextTick);

        expect(mockClient.interface.trigger).toHaveBeenCalledWith("showNotify", {
            type: "danger",
            message: "Could not open the assistant modal."
        });
        expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to open modal", expect.any(Error));
    });

    test('should log an error if app initialization fails', async () => {
        global.app.initialized.mockRejectedValue(new Error('Initialization Failed'));

        require('../../app/app.js');
        await new Promise(process.nextTick);

        expect(consoleErrorSpy).toHaveBeenCalledWith("App initialization failed", expect.any(Error));
    });
});