# SaltyRTC WebRTC Task for JavaScript

[![CircleCI](https://circleci.com/gh/saltyrtc/saltyrtc-task-webrtc-js/tree/master.svg?style=shield)](https://circleci.com/gh/saltyrtc/saltyrtc-task-webrtc-js/tree/master)
[![Supported ES Standard](https://img.shields.io/badge/javascript-ES5%20%2F%20ES2015-yellow.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)
[![npm Version](https://img.shields.io/npm/v/@saltyrtc/task-webrtc.svg?maxAge=2592000)](https://www.npmjs.com/package/@saltyrtc/task-webrtc)
[![npm Downloads](https://img.shields.io/npm/dt/@saltyrtc/task-webrtc.svg?maxAge=3600)](https://www.npmjs.com/package/@saltyrtc/task-webrtc)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)
[![Chat on Gitter](https://badges.gitter.im/saltyrtc/Lobby.svg)](https://gitter.im/saltyrtc/Lobby)

This is a [SaltyRTC](https://saltyrtc.org/) WebRTC task implementation for
JavaScript (ES5 / ES2015), written in TypeScript 2.

**Warning: This is beta software. Use at your own risk. Testing and review is
welcome!**

## Installing

### Via npm

You can install this library via `npm`:

    npm install --save @saltyrtc/task-webrtc @saltyrtc/client

## Usage

When creating the task instance, you can specify whether or not a handover to a secure data channel is desired.

    let task = new WebRTCTask(true);

You can also specify the max DataChannel chunk size:

    let task = new WebRTCTask(true, 65536);

If you don't specify any values, handover defaults to `true` and the chunk size defaults to `16384`.

The handover can be initiated using the handover method:

    let started = task.handover(peerConnection);

*Note: You should call this method before creating offer/answer!*

To send offers, answers and candidates, use the following task methods:

* `.sendOffer(offer: RTCSessionDescriptionInit): void`
* `.sendAnswer(answer: RTCSessionDescriptionInit): void`
* `.sendCandidate(candidate: RTCIceCandidateInit): void`
* `.sendCandidates(candidates: RTCIceCandidateInit[]): void`

You can register and deregister event handlers with the `on`, `once` and `off` methods:

    task.on('candidates', (e) => {
        for (let candidateInit of e.data) {
            pc.addIceCandidate(candidateInit);
        }
    });

The following events are available:

* `offer(saltyrtc.tasks.webrtc.Offer)`: An offer message was received.
* `answer(saltyrtc.tasks.webrtc.Answer)`: An answer message was received.
* `candidates(saltyrtc.tasks.webrtc.Candidates)`: A candidates message was received.
* `disconnected(number)`: A previously authenticated peer disconnected from the signaling server.

To know when the handover is finished, please subscribe to the `handover` event on the client directly.

## Testing

To compile the test sources, run:

    $ npm run rollup_tests

Then simply open `tests/testsuite.html` in your browser!

Alternatively, run the tests automatically in Firefox and Chrome:

    $ npm test

## Security

### Responsible Disclosure / Reporting Security Issues

Please report security issues directly to one or both of the following contacts:

- Danilo Bargen
    - Email: mail@dbrgn.ch
    - Threema: EBEP4UCA
    - GPG: [EA456E8BAF0109429583EED83578F667F2F3A5FA][keybase-dbrgn]
- Lennart Grahl
    - Email: lennart.grahl@gmail.com
    - Threema: MSFVEW6C
    - GPG: [3FDB14868A2B36D638F3C495F98FBED10482ABA6][keybase-lgrahl]

[keybase-dbrgn]: https://keybase.io/dbrgn
[keybase-lgrahl]: https://keybase.io/lgrahl

## Coding Guidelines

- Write clean ES2015
- Favor `const` over `let`

## License

MIT, see `LICENSE.md`.
