import config from './es2015.js';
import babel from 'rollup-plugin-babel';

config.output.file= 'dist/saltyrtc-task-webrtc-v2.es5.js';
config.output.format = 'iife';
config.output.name = 'saltyrtcTaskWebrtc';
config.output.strict = true;
config.output.globals = {
    'tweetnacl': 'nacl',
    '@saltyrtc/client': 'saltyrtcClient',
    '@saltyrtc/chunked-dc': 'chunkedDc'
};
config.plugins.push(
    babel({
        babelrc: false,
        exclude: 'node_modules/**',
        externalHelpers: true,
        presets: [
            ['@babel/preset-env', {
                modules: false,
                forceAllTransforms: true,
            }]
        ],
    })
);

export default config;
