const mockClient = {
    interface: {
        trigger: jest.fn().mockResolvedValue({}),
    },
    data: {
        get: jest.fn().mockResolvedValue({
            ticket: {
                id: 123,
                subject: 'Default Test Subject',
                description_text: 'Default description',
                custom_fields: {
                    application: 'ProductA'
                }
            }
        }),
    },
    request: {
        invokeTemplate: jest.fn().mockResolvedValue({ response: '{}' }),
    },
};

global.app = {
    initialized: jest.fn().mockResolvedValue(mockClient),
};

module.exports = {
    mockClient,
};