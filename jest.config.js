// jest.config.js
module.exports = {
    testEnvironment: 'jsdom',
    verbose: true,
    roots: ['<rootDir>/tests'],
    coverageProvider: 'v8',
    coverageReporters: [
        'json-summary',
        'text',
        'lcov'
    ]
};