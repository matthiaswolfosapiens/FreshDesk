// jest.config.js
module.exports = {
    testEnvironment: 'jsdom',
    verbose: true,
    roots: ['<rootDir>/tests'],

    coverageReporters: [
        'json-summary',
        'text',
        'lcov'
    ]
};