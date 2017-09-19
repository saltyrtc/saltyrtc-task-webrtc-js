module.exports = function(config) {

    var configuration = {
        frameworks: ['jasmine'],
        files: [
            'node_modules/webrtc-adapter/out/adapter.js',
            'node_modules/msgpack-lite/dist/msgpack.min.js',
            'node_modules/tweetnacl/nacl-fast.js',
            'node_modules/@saltyrtc/client/dist/saltyrtc-client.es5.js',
            'node_modules/@saltyrtc/chunked-dc/dist/chunked-dc.es5.js',
            'tests/testsuite.js',
        ],
        customLaunchers: {
            Firefox_circle_ci: {
                base: 'Firefox',
                profile: '/home/ci/.mozilla/firefox/saltyrtc',
            }
        },
        browserNoActivityTimeout: 30000 // ms, default: 10'000
    };

    if (process.env.CIRCLECI) {
        configuration.browsers = ['ChromiumHeadless', 'Firefox_circle_ci'];
    } else {
        configuration.browsers = ['Chromium', 'Firefox'];
    }

    config.set(configuration);

}
