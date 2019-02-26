# SaltyRTC WebRTC Task for JavaScript

[![CircleCI](https://circleci.com/gh/saltyrtc/saltyrtc-task-webrtc-js/tree/master.svg?style=shield)](https://circleci.com/gh/saltyrtc/saltyrtc-task-webrtc-js/tree/master)
[![Supported ES Standard](https://img.shields.io/badge/javascript-ES5%20%2F%20ES2015-yellow.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)
[![npm Version](https://img.shields.io/npm/v/@saltyrtc/task-webrtc.svg?maxAge=2592000)](https://www.npmjs.com/package/@saltyrtc/task-webrtc)
[![npm Downloads](https://img.shields.io/npm/dt/@saltyrtc/task-webrtc.svg?maxAge=3600)](https://www.npmjs.com/package/@saltyrtc/task-webrtc)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)
[![Chat on Gitter](https://badges.gitter.im/saltyrtc/Lobby.svg)](https://gitter.im/saltyrtc/Lobby)

This is a [SaltyRTC](https://saltyrtc.org/) WebRTC task version 1 implementation for
JavaScript (ES5 / ES2015), written in TypeScript.

**Warning: This is beta software. Use at your own risk. Testing and review is
welcome!**

## Installing

### Via npm

You can install this library via `npm`:

    npm install --save @saltyrtc/task-webrtc @saltyrtc/client

## Usage

When creating the task instance, you can specify whether or not a handover to a dedicated data channel is desired.
In case you want to apply a handover, you must implement the `SignalingTransportHandler` interface and provide a
factory function to create an instance of it. 

    let task = new WebRTCTask(signalingTransportHandlerFactory);

If you don't specify any values, no handover will be requested.

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

### 1. Preparing the Server

First, clone the `saltyrtc-server-python` repository.

    git clone https://github.com/saltyrtc/saltyrtc-server-python
    cd saltyrtc-server-python

Then create a test certificate for localhost, valid for 5 years.

    openssl req \
       -newkey rsa:1024 \
       -x509 \
       -nodes \
       -keyout saltyrtc.key \
       -new \
       -out saltyrtc.crt \
       -subj /CN=localhost \
       -reqexts SAN \
       -extensions SAN \
       -config <(cat /etc/ssl/openssl.cnf \
         <(printf '[SAN]\nsubjectAltName=DNS:localhost')) \
       -sha256 \
       -days 1825

You can import this file into your browser certificate store. For Chrome/Chromium, use this command:

    certutil -d sql:$HOME/.pki/nssdb -A -t "P,," -n saltyrtc-test-ca -i saltyrtc.crt

In Firefox the easiest way to add your certificate to the browser is to start
the SaltyRTC server (e.g. on `localhost` port 8765), then to visit the
corresponding URL via https (e.g. `https://localhost:8765`). Then, in the
certificate warning dialog that pops up, choose "Advanced" and add a permanent
exception.

Create a Python virtualenv with dependencies:

    python3 -m virtualenv venv
    venv/bin/pip install .[logging]

Finally, start the server with the following test permanent key:

    export SALTYRTC_SERVER_PERMANENT_KEY=0919b266ce1855419e4066fc076b39855e728768e3afa773105edd2e37037c20 # Public: 09a59a5fa6b45cb07638a3a6e347ce563a948b756fd22f9527465f7c79c2a864
    venv/bin/saltyrtc-server -v 5 serve -p 8765 \
        -sc saltyrtc.crt -sk saltyrtc.key \
        -k $SALTYRTC_SERVER_PERMANENT_KEY


### 2. Running Tests

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
