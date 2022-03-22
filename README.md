# SaltyRTC WebRTC Task for JavaScript

[![CircleCI](https://circleci.com/gh/saltyrtc/saltyrtc-task-webrtc-js/tree/master.svg?style=shield)](https://circleci.com/gh/saltyrtc/saltyrtc-task-webrtc-js/tree/master)
[![Supported ES Standard](https://img.shields.io/badge/javascript-ES5%20%2F%20ES2015-yellow.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)
[![npm Version](https://img.shields.io/npm/v/@saltyrtc/task-webrtc.svg?maxAge=2592000)](https://www.npmjs.com/package/@saltyrtc/task-webrtc)
[![npm Downloads](https://img.shields.io/npm/dt/@saltyrtc/task-webrtc.svg?maxAge=3600)](https://www.npmjs.com/package/@saltyrtc/task-webrtc)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/saltyrtc/saltyrtc-task-webrtc-js)
[![Chat on Gitter](https://badges.gitter.im/saltyrtc/Lobby.svg)](https://gitter.im/saltyrtc/Lobby)

This is a [SaltyRTC](https://saltyrtc.org/) WebRTC task version 1
implementation for JavaScript (ES5 / ES2015), written in TypeScript.

**Warning: This is beta software. Use at your own risk. Testing and review is
welcome!**

## Installing

### Via npm

You can install this library via `npm`:

```bash
npm install --save @saltyrtc/task-webrtc @saltyrtc/client
```

## Usage

To create the task instance, you need to use the `WebRTCTaskBuilder` instance
which can be used to configure the task before creating it.

The below configuration represents the default values chosen by the builder as
if you had not configured the builder and just called `.build()` directly.

```js
const task = new WebRTCTaskBuilder()
    .withLoggingLevel('none')
    .withVersion('v1')
    .withHandover(true)
    .withMaxChunkLength(262144)
    .build();
```

To send offers, answers and candidates, use the following task methods:

* `task.sendOffer(offer: RTCSessionDescriptionInit): void`
* `task.sendAnswer(answer: RTCSessionDescriptionInit): void`
* `task.sendCandidate(candidate: RTCIceCandidateInit): void`
* `task.sendCandidates(candidates: RTCIceCandidateInit[]): void`

You can register and deregister event handlers with the `on`, `once` and `off`
methods:

```js
task.on('candidates', (e) => {
    for (let candidateInit of e.data) {
        pc.addIceCandidate(candidateInit);
    }
});
````

The following events are available:

* `offer(saltyrtc.tasks.webrtc.Offer)`: An offer message was received.
* `answer(saltyrtc.tasks.webrtc.Answer)`: An answer message was received.
* `candidates(saltyrtc.tasks.webrtc.Candidates)`: A candidates message was
  received.
* `disconnected(number)`: A previously authenticated peer disconnected from the
  signaling server.

### Data Channel Crypto Context

The task provides another security layer for data channels which can be
leveraged by usage of a `DataChannelCryptoContext` instance. To retrieve such
an instance, call:

```js
const context = task.createCryptoContext(dataChannel.id);
```

You can encrypt messages on the sending end in the following way:

```js
const box = context.encrypt(yourData);
dataChannel.send(box.toUint8Array());
```

On the receiving end, decrypt the message by the use of the crypto context:

```js
const box = saltyrtcClient.Box.fromUint8Array(message, DataChannelCryptoContext.NONCE_LENGTH);
const yourData = context.decrypt(box);
```

Note, that you should not use a crypto context for a data channel that is being
used for handover. The task will take care of encryption and decryption itself.

### Handover

Before initiating the handover, the application needs to fetch the
`SignalingTransportLink` instance which contains the necessary information to
create a data channel.

```js
const link = task.getTransportLink();

const dataChannel = peerConnection.createDataChannel(link.label, {
    id: link.id,
    negotiated: true,
    ordered: true,
    protocol: link.protocol,
});
```

Note that the data channel used for handover **must** be created with the
label and parameters as shown in the above code snippet.

Now that you have created the channel, you need to implement the
`SignalingTransportHandler` interface. Below is a minimal handler that forwards
the necessary events and messages to the created data channel.

```js
const handler = {
    get maxMessageSize() {
        return peerConnection.sctp.maxMessageSize;
    },
    close() {
        dataChannel.close();
    },
    send(message) {
        dataChannel.send(message);
    },
}
```

Furthermore, you have to bind all necessary events in order to connect the data
channel to the `SignalingTransportLink`.

```js
dataChannel.onopen = () => task.handover(handler);
dataChannel.onclose = () => link.closed();
dataChannel.binaryType = 'arraybuffer';
dataChannel.onmessage = (event) => link.receive(new Uint8Array(event.data));
```

The above setup will forward the `close` event and all messages to the task by
the use of the `SignalingTransportLink`. On `open`, the handover will be
initiated.

To be signalled once the handover is finished, you need to subscribe to the
`handover` event on the SaltyRTC client instance.

## Testing

### 1. Preparing the Server

First, clone the `saltyrtc-server-python` repository.

```bash
git clone https://github.com/saltyrtc/saltyrtc-server-python
cd saltyrtc-server-python
```

Then create a test certificate for localhost, valid for 5 years.

```bash
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
```

You can import this file into your browser certificate store. For Chrome/Chromium, use this command:

```bash
certutil -d sql:$HOME/.pki/nssdb -A -t "P,," -n saltyrtc-test-ca -i saltyrtc.crt
```

Additionally, you need to open `chrome://flags/#allow-insecure-localhost` and
enable it.

In Firefox the easiest way to add your certificate to the browser is to start
the SaltyRTC server (e.g. on `localhost` port 8765), then to visit the
corresponding URL via https (e.g. `https://localhost:8765`). Then, in the
certificate warning dialog that pops up, choose "Advanced" and add a permanent
exception.

Create a Python virtualenv with dependencies:

```bash
python3 -m virtualenv venv
venv/bin/pip install .[logging]
```

Finally, start the server with the following test permanent key:

```bash
export SALTYRTC_SERVER_PERMANENT_KEY=0919b266ce1855419e4066fc076b39855e728768e3afa773105edd2e37037c20 # Public: 09a59a5fa6b45cb07638a3a6e347ce563a948b756fd22f9527465f7c79c2a864
venv/bin/saltyrtc-server -v 5 serve -p 8765 \
    -sc saltyrtc.crt -sk saltyrtc.key \
    -k $SALTYRTC_SERVER_PERMANENT_KEY
```

### 2. Running Tests

To compile the test sources, run:

```bash
npm run rollup_tests
```

Then simply open `tests/testsuite.html` in your browser!

Alternatively, run the tests automatically in Firefox and Chrome:

```bash
npm test
```

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
