# SaltyRTC WebRTC Task for JavaScript

[![Travis branch](https://img.shields.io/travis/saltyrtc/saltyrtc-task-webrtc-js/master.svg)](https://travis-ci.org/saltyrtc/saltyrtc-task-webrtc-js)
[![Supported ES Standard](https://img.shields.io/badge/javascript-ES5%20%2F%20ES2015-yellow.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)
[![npm Version](https://img.shields.io/npm/v/saltyrtc-task-webrtc.svg?maxAge=2592000)](https://www.npmjs.com/package/saltyrtc-task-webrtc)
[![npm Downloads](https://img.shields.io/npm/dt/saltyrtc-task-webrtc.svg?maxAge=3600)](https://www.npmjs.com/package/saltyrtc-task-webrtc)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)

This is a [SaltyRTC](https://github.com/saltyrtc/saltyrtc-meta) WebRTC task implementation
for JavaScript, written in TypeScript.

The development is still ongoing, the current version is only at alpha-level
and should not be used for production yet.

## Installing

### Via npm

You can install this library via `npm`:

    npm install --save saltyrtc-task-webrtc saltyrtc-client

## Usage

The following events are available:

* `offer(saltyrtc.tasks.webrtc.Offer)`: An offer message was received.
* `answer(saltyrtc.tasks.webrtc.Answer)`: An answer message was received.
* `candidates(saltyrtc.tasks.webrtc.Candidates)`: A candidates message was received.

To know when the handover is finished, please subscribe to the `handover` event on the client directly.

## Releasing

Set variables:

    $ export VERSION=X.Y.Z
    $ export GPG_KEY=E7ADD9914E260E8B35DFB50665FDE935573ACDA6

Update version numbers:

    $ vim -p package.json CHANGELOG.md

Build dist files:

    $ npm run dist

Commit & tag:

    $ git commit -m "Release v${VERSION}"
    $ git tag -s -u ${GPG_KEY} v${VERSION} -m "Version ${VERSION}"

Push & publish:

    $ git push && git push --tags
    $ npm publish

## Coding Guidelines

- Write clean ES2015
- Favor `const` over `let`

## License

MIT, see `LICENSE.md`.
