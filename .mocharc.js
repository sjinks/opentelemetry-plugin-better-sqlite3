'use strict';

module.exports = {
    extension: ['ts'],
    spec: 'test/**/*.spec.ts',
    reporter: process.env.GITHUB_ACTIONS === 'true' ? 'mocha-github-actions-reporter' : 'spec',
    require: 'ts-node/register',
};
