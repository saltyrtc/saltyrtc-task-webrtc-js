import config from './es5.js';

config.entry = 'tests/main.ts';
config.dest = 'tests/testsuite.js';
config.sourceMap = true;
config.globals = {
    'tweetnacl': 'nacl',
    'saltyrtc-client': 'saltyrtc.client',
    'chunked-dc': 'chunkedDc'
};

export default config;
