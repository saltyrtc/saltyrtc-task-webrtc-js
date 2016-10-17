# SaltyRTC WebRTC Task for JavaScript

[![Travis branch](https://img.shields.io/travis/saltyrtc/saltyrtc-task-webrtc-js/master.svg)](https://travis-ci.org/saltyrtc/saltyrtc-task-webrtc-js)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)

This is a [SaltyRTC](https://github.com/saltyrtc/saltyrtc-meta) WebRTC task implementation
for JavaScript, written in TypeScript.

The development is still ongoing, the current version is only at alpha-level
and should not be used for production yet.

## Usage

The following events are available:

* `offer(saltyrtc.messages.TaskMessage)`: An offer message was received.
* `answer(saltyrtc.messages.TaskMessage)`: An answer message was received.
* `candidates(saltyrtc.messages.TaskMessage)`: A candidates message was received.
* `handover(void)`: Handover to the data channel is done.

## Coding Guidelines

- Write clean ES2015
- Favor `const` over `let`

## License

MIT, see `LICENSE.md`.
