const { mockClient } = require('./mocks');
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

describe('Helper Functions', () => {

    describe('safeParseResponse', () => {
        it('should return null for null or undefined input', () => {
            expect(safeParseResponse(null)).toBeNull();
            expect(safeParseResponse(undefined)).toBeNull();
        });

        it('should parse a JSON string from the "response" property', () => {
            const resp = { response: '{"key":"value"}' };
            expect(safeParseResponse(resp)).toEqual({ key: 'value' });
        });

        it('should parse a direct JSON string', () => {
            const resp = '{"key":"value"}';
            expect(safeParseResponse(resp)).toEqual({ key: 'value' });
        });

        it('should return the object if it is already parsed', () => {
            const resp = { key: 'value' };
            expect(safeParseResponse(resp)).toEqual({ key: 'value' });
        });

        it('should return null for invalid JSON', () => {
            const resp = '{"key":}';
            expect(safeParseResponse(resp)).toBeNull();
            const respWithProp = { response: 'not-json' };
            expect(safeParseResponse(respWithProp)).toBeNull();
        });
    });

    describe('getErrorMessage', () => {
        it('should return a default message for null or undefined error', () => {
            expect(getErrorMessage(null)).toBe('An unknown error occurred.');
            expect(getErrorMessage(undefined)).toBe('An unknown error occurred.');
        });

        it('should extract "detail" from a JSON error response', () => {
            const error = { response: '{"detail":"Specific API error."}' };
            expect(getErrorMessage(error)).toBe('Specific API error.');
        });

        it('should fall back to error.message if "detail" is not in response', () => {
            const error = { message: 'Fallback message', response: '{"other_key":"value"}' };
            expect(getErrorMessage(error)).toBe('Fallback message');
        });

        it('should fall back to a default message if response contains no known keys', () => {
            const error = { response: '{"other_key":"value"}' };
            expect(getErrorMessage(error)).toBe('An unknown error occurred.');
        });

        it('should use error.message if response is not valid JSON', () => {
            const error = { message: 'Network error', response: 'Internal Server Error' };
            expect(getErrorMessage(error)).toBe('Network error');
        });

        it('should use error.message if there is no response object', () => {
            const error = { message: 'Simple error' };
            expect(getErrorMessage(error)).toBe('Simple error');
        });

        it('should stringify the error if no message is available', () => {
            const error = { code: 500 };
            expect(getErrorMessage(error)).toBe('{"code":500}');
        });
    });

    describe('formatConversations', () => {
        const conversations = [
            { private: false, incoming: true, body_text: 'Hello, I have a problem.' },
            { private: false, incoming: false, body_text: '  Hi, how can I help?  ' },
            { private: true, incoming: false, body_text: 'User seems angry.' },
            { body_text: null } // Edge case for missing content
        ];

        it('should format a conversation array correctly', () => {
            const result = formatConversations(conversations);
            expect(result).toContain('Customer:');
            expect(result).toContain('Hello, I have a problem.');
            expect(result).toContain('Support Agent:');
            expect(result).toContain('Hi, how can I help?');
            expect(result).toContain('Support Agent (Internal Note):');
            expect(result).toContain('User seems angry.');
            expect(result).toContain('No content');
        });
    });
});