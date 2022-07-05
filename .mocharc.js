'use strict';

module.exports = {
    extension: ['ts'],
    spec: 'test/**/*.spec.ts',
    reporter: process.env.GITHUB_ACTIONS === 'true' ? 'mocha-reporter-gha' : 'spec',
    require: 'ts-node/register',
};
