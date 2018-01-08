import config from './es5.js';

config.entry = 'tests/benchmark.ts';
config.dest = 'tests/benchmark.js';
config.sourceMap = true;

export default config;
