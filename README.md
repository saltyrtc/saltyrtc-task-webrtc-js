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

When creating the task instance, you can specify whether or not a handover to a secure data channel is desired.

    let task = new WebRTCTask(true);

You can also specify the max DataChannel chunk size:

    let task = new WebRTCTask(true, 65536);

If you don't specify any values, handover defaults to `true` and the chunk size defaults to `16384`.

To send offers, answers and candidates, use the following task methods:

* `.sendOffer(offer: RTCSessionDescriptionInit): void`
* `.sendAnswer(answer: RTCSessionDescriptionInit): void`
* `.sendCandidate(candidate: RTCIceCandidateInit): void`
* `.sendCandidates(candidates: RTCIceCandidateInit[]): void`

The handover can be initiated using the handover method:

    let started = task.handover(peerConnection);

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

To know when the handover is finished, please subscribe to the `handover` event on the client directly.

## Coding Guidelines

- Write clean ES2015
- Favor `const` over `let`

## License

MIT, see `LICENSE.md`.
