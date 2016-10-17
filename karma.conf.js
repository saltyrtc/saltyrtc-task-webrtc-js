module.exports = function(config) {

    var configuration = {
        frameworks: ['jasmine'],
        files: [
            'node_modules/webrtc-adapter/out/adapter.js',
            'node_modules/saltyrtc-client/dist/saltyrtc-client.es5.js',
            'node_modules/chunked-dc/dist/chunked-dc.es5.js',
            'node_modules/tweetnacl/nacl-fast.js',
            'tests/testsuite.js',
        ],
        customLaunchers: {
            Chrome_travis_ci: {
                base: 'Chrome',
                flags: ['--no-sandbox']
            },
            Firefox_travis_ci: {
                base: 'Firefox',
                profile: '~/.mozilla/firefox/saltyrtc',
            }
        }
    };

    if (process.env.TRAVIS) {
        //configuration.browsers = ['Chrome_travis_ci', 'Firefox_travis_ci'];
        configuration.browsers = ['Chrome_travis_ci'];
    } else {
        configuration.browsers = ['Chrome', 'Firefox'];
    }

    config.set(configuration);

}
