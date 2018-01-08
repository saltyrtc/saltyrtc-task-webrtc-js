/**
 * Copyright (C) 2017 Lennart Grahl
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types="webrtc" />
/// <reference path="jasmine.d.ts" />

import {SaltyRTCBuilder, KeyStore} from "@saltyrtc/client";
import {WebRTCTask} from "../src/main";
import {Config} from "./config";

class ChunkedDataChannel {
    dc: RTCDataChannel;
    _onmessage: (event: MessageEvent) => void;

    // Chunking
    static CHUNK_COUNT_GC = 32;
    static CHUNK_MAX_AGE = 60000;
    chunkSize;
    messageNumber = 0;
    chunkCount = 0;
    unchunker: chunkedDc.Unchunker;

    constructor(dc: RTCDataChannel, chunkSize: number) {
        this.chunkSize = chunkSize;
        this.unchunker = new chunkedDc.Unchunker();
        this.unchunker.onMessage = this._onMessage;
        this.dc = dc;
        this.dc.onmessage = this._onChunk;
    }

    send(data: string|Blob|Uint8Array|ArrayBuffer): void {
        // Validate input data
        let buffer: ArrayBuffer;
        if (typeof data === 'string') {
            throw new Error('ChunkedDataChannel can only handle binary data.');
        } else if (data instanceof Blob) {
            throw new Error('ChunkedDataChannel does not currently support Blob data. ' +
                'Please pass in an ArrayBuffer or a typed array (e.g. Uint8Array).');
        } else if (data instanceof Uint8Array) {
            buffer = data.buffer as ArrayBuffer;
        } else if (data instanceof ArrayBuffer) {
            buffer = data;
        } else {
            throw new Error('Unknown data type. Please pass in an ArrayBuffer ' +
                'or a typed array (e.g. Uint8Array).');
        }

        // Split into chunks and send
        // TODO: This needs to be buffered (onbufferedamountlow, ...)
        const chunker = new chunkedDc.Chunker(this.messageNumber++, buffer, this.chunkSize);
        for (let chunk of chunker) {
            this.dc.send(chunk);
        }
    }

    _onChunk = (event: MessageEvent) => {
        // If type is not supported, exit immediately
        if (event.data instanceof Blob) {
            console.warn(this.logTag, 'Received message in blob format, which is not currently supported.');
            return;
        } else if (typeof event.data == 'string') {
            console.warn(this.logTag, 'Received message in string format, which is not currently supported.');
            return;
        } else if (!(event.data instanceof ArrayBuffer)) {
            console.warn(this.logTag, 'Received message in unsupported format. Please send ArrayBuffer objects.');
            return;
        }

        // Register chunk
        this.unchunker.add(event.data as ArrayBuffer, event);

        // Clean up old chunks regularly
        if (this.chunkCount++ > ChunkedDataChannel.CHUNK_COUNT_GC) {
            this.unchunker.gc(ChunkedDataChannel.CHUNK_MAX_AGE);
            this.chunkCount = 0;
        }
    };

    _onMessage = (data: Uint8Array, context: MessageEvent[]) => {
        // If _onmessage is not defined, exit immediately.
        if (this._onmessage === undefined) {
            return;
        }

        // Create a new MessageEvent instance based on the context of the final chunk.
        const realEvent = context[context.length - 1];
        const fakeEvent = {};
        for (let x in realEvent) {
            fakeEvent[x] = realEvent[x];
        }
        fakeEvent['data'] = data;

        // Call original handler
        this._onmessage.bind(this.dc)(fakeEvent);
    };

    // Readonly attributes
    get label(): string { return this.dc.label; }
    get ordered(): boolean { return this.dc.ordered; }
    get maxPacketLifeTime(): number { return this.dc.maxPacketLifeTime; }
    get maxRetransmits(): number { return this.dc.maxRetransmits; }
    get protocol(): string { return this.dc.protocol; }
    get negotiated(): boolean { return this.dc.negotiated; }
    get id(): number { return this.dc.id; }
    get readyState(): RTCDataChannelState { return this.dc.readyState; }
    get bufferedAmount(): number { return this.dc.bufferedAmount; }

    // Read/write attributes
    get bufferedAmountLowThreshold(): number { return this.dc.bufferedAmountLowThreshold; }
    set bufferedAmountLowThreshold(value: number) { this.dc.bufferedAmountLowThreshold = value; }
    get binaryType(): RTCBinaryType { return this.dc.binaryType; }
    set binaryType(value: RTCBinaryType) { this.dc.binaryType = value; }

    // Event handlers
    get onopen(): EventHandler { return this.dc.onopen; }
    set onopen(value: EventHandler) { this.dc.onopen = value; }
    get onbufferedamountlow(): EventHandler { return this.dc.onbufferedamountlow; }
    set onbufferedamountlow(value: EventHandler) { this.dc.onbufferedamountlow = value; }
    get onerror(): EventHandler { return this.dc.onerror; }
    set onerror(value: EventHandler) { this.dc.onerror = value; }
    get onclose(): EventHandler { return this.dc.onclose; }
    set onclose(value: EventHandler) { this.dc.onclose = value; }
    get onmessage(): MessageEventHandler { return this.dc.onmessage; }
    set onmessage(value: MessageEventHandler) { this._onmessage = value; }

    // Regular methods
    close(): void { this.dc.close(); }

    // EventTarget API (according to https://developer.mozilla.org/de/docs/Web/API/EventTarget)
    addEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void {
        if (type === 'message') {
            throw new Error('addEventListener on message events is not currently supported by SaltyRTC.');
        } else {
            this.dc.addEventListener(type, listener, useCapture);
        }
    }
    removeEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void {
        if (type === 'message') {
            throw new Error('removeEventListener on message events is not currently supported by SaltyRTC.');
        } else {
            this.dc.removeEventListener(type, listener, useCapture);
        }
    }
    dispatchEvent(e: Event): boolean { return this.dc.dispatchEvent(e); }
}

// Note: Yeah, this is ugly, I know... let me know if you know how to make this less crappy.
const nTests = 8;
let testIndex = 0;
let results = [];
for (let _; _ < nTests; ++_) {
    results.push({});
}
function reportResults() {
    if (testIndex < nTests) {
        return;
    }

    setTimeout(() => {
        for (let i = 0; i < nTests; ++i) {
            const result = results[i];
            const specEl = window.document.getElementById('spec-spec' + i);
            let html = '<ul>' +
                '<li>Options:<pre>' + JSON.stringify(result.options, null, 2) + '</pre></li>';
            if (result.startTime && result.endTime && result.totalSize) {
                const time = (result.endTime - result.startTime) / 1000;
                const throughput = result.totalSize / time / 1024 / 128;
                html += '' +
                    '<li>Test complete after ' + time.toFixed(2) + ' seconds</li>' +
                    '<li>Throughput: ' + throughput.toFixed(2) + ' Mbit/s</li>';
            } else {
                html += '<li>Test failed, no results</li>';
            }
            html += '</ul>';
            specEl.innerHTML += html;
        }
    }, 100);
}

interface BenchmarkOptions {
    secure: boolean;
    chunkSize: number,
    binaryType: string,
    sendSize: number,
    nSends: number,
    lowWaterMark: number,
    highWaterMark: number,
}

export default () => { describe('Data Channel Benchmarks', function() {

    beforeEach(() => {
        // Set default timeout
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 3000;
    });

    afterEach(() => {
        // Report results when done
        reportResults();
    });

    /**
     * Do the initiator flow.
     */
    async function initiatorFlow(pc: RTCPeerConnection, task: WebRTCTask): Promise<void> {
        // Send offer
        let offer: RTCSessionDescriptionInit = await pc.createOffer();
        await pc.setLocalDescription(offer);
        console.debug('Initiator: Created offer, set local description');
        task.sendOffer(offer);

        // Receive answer
        function receiveAnswer(): Promise<RTCSessionDescriptionInit> {
            return new Promise((resolve) => {
                task.once('answer', (e: saltyrtc.tasks.webrtc.AnswerEvent) => {
                    resolve(e.data);
                });
            });
        }
        let answer: RTCSessionDescriptionInit = await receiveAnswer();
        await pc.setRemoteDescription(answer)
            .catch(error => console.error('Could not set remote description', error));
        console.debug('Initiator: Received answer, set remote description');
    }

    /**
     * Do the responder flow.
     */
    async function responderFlow(pc: RTCPeerConnection, task: WebRTCTask): Promise<void> {
        // Receive offer
        function receiveOffer(): Promise<RTCSessionDescriptionInit> {
            return new Promise((resolve) => {
                task.once('offer', (offer: saltyrtc.tasks.webrtc.OfferEvent) => {
                    resolve(offer.data);
                });
            });
        }
        let offer: RTCSessionDescriptionInit = await receiveOffer();
        await pc.setRemoteDescription(offer)
            .catch(error => console.error('Could not set remote description', error));
        console.debug('Initiator: Received offer, set remote description');

        // Send answer
        let answer: RTCSessionDescriptionInit = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.debug('Initiator: Created answer, set local description');
        task.sendAnswer(answer);
    }

    /**
     * Set up transmission and processing of ICE candidates.
     */
    function setupIceCandidateHandling(pc: RTCPeerConnection, task: WebRTCTask) {
        let role = task.getSignaling().role;
        let logTag = role.charAt(0).toUpperCase() + role.slice(1) + ':';
        console.debug(logTag, 'Setting up ICE candidate handling');
        pc.onicecandidate = (e: RTCPeerConnectionIceEvent) => {
            if (e.candidate !== null) {
                task.sendCandidate({
                    candidate: e.candidate.candidate,
                    sdpMid: e.candidate.sdpMid,
                    sdpMLineIndex: e.candidate.sdpMLineIndex,
                });
            } else {
                task.sendCandidate(null);
            }
        };
        pc.onicecandidateerror = (e: RTCPeerConnectionIceErrorEvent) => {
            console.error(logTag, 'ICE candidate error:', e);
        };
        task.on('candidates', (e: saltyrtc.tasks.webrtc.CandidatesEvent) => {
            for (let candidateInit of e.data) {
                pc.addIceCandidate(candidateInit);
            }
        });
        pc.oniceconnectionstatechange = (e: Event) => {
            console.debug(logTag, 'ICE connection state changed to', pc.iceConnectionState);
            console.debug(logTag, 'ICE gathering state changed to', pc.iceGatheringState);
        }
    }

    /**
     * Connect a peer.
     */
    function connect(salty: saltyrtc.SaltyRTC): Promise<{}> {
        return new Promise((resolve) => {
            salty.once('state-change:task', () => {
                resolve();
            });
            salty.connect();
        });
    }

    /**
     * Create two peer connections and do the handshake. Then, create a data channel
     * (normal or secure) pair and prepare them for benchmarking.
     */
    async function benchmark(options: BenchmarkOptions): Promise<void> {
        // Increase test index and add options
        ++testIndex;
        results[testIndex - 1] = {
            options: options,
        };

        // Validate parameters
        if (options.sendSize === 1) {
            throw 'Nope!';
        }
        if (options.chunkSize > 0 && options.binaryType !== 'arraybuffer') {
            throw 'Impossible!';
        }
        if (options.secure) {
            if (options.chunkSize === 0 || options.binaryType !== 'arraybuffer') {
                throw 'Impossible!';
            }
        }
        if (options.binaryType === 'blob') {
            throw 'Not implemented, yet!';
        }

        // Set up task, initiator and responder
        const initiatorTask = new WebRTCTask(false, options.chunkSize);
        const initiator = new SaltyRTCBuilder()
            .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
            .withKeyStore(new KeyStore())
            .usingTasks([initiatorTask])
            .asInitiator() as saltyrtc.SaltyRTC;
        const responderTask = new WebRTCTask(false, options.chunkSize);
        const responder = new SaltyRTCBuilder()
            .connectTo(Config.SALTYRTC_HOST, Config.SALTYRTC_PORT)
            .withKeyStore(new KeyStore())
            .initiatorInfo(initiator.permanentKeyBytes, initiator.authTokenBytes)
            .usingTasks([responderTask])
            .asResponder() as saltyrtc.SaltyRTC;
        
        // Create peer connections
        const initiatorConn = new RTCPeerConnection();
        const responderConn = new RTCPeerConnection();

        // Connect both peers
        const connectInitiator = connect(initiator);
        const connectResponder = connect(responder);
        await connectInitiator;
        await connectResponder;

        // Do initiator flow
        initiatorConn.onnegotiationneeded = (e: Event) => {
            initiatorFlow(initiatorConn, initiatorTask).then(
                (value) => console.debug('Initiator flow successful'),
                (error) => console.error('Initiator flow failed', error)
            );
        };

        // Do responder flow
        responderConn.onnegotiationneeded = (e: Event) => {
            responderFlow(responderConn, responderTask).then(
                (value) => console.debug('Responder flow successful'),
                (error) => console.error('Responder flow failed', error)
            );
        };

        // Set up ICE candidate handling
        setupIceCandidateHandling(initiatorConn, initiatorTask);
        setupIceCandidateHandling(responderConn, responderTask);

        // Create data channels
        let initiatorDc = initiatorConn.createDataChannel('benchmark', { id: 42 });
        let responderDc = responderConn.createDataChannel('benchmark', { id: 42 });

        // Set binary type
        initiatorDc.binaryType = options.binaryType;
        responderDc.binaryType = options.binaryType;

        // Wrap data channels (if secure or chunking is required)
        // Note: This automatically applies chunked-dc
        if (options.secure) {
            initiatorDc = initiatorTask.wrapDataChannel(initiatorDc);
            responderDc = responderTask.wrapDataChannel(responderDc);
        } else if (options.chunkSize > 0) {
            // Wrap with chunked-dc
            initiatorDc = new ChunkedDataChannel(initiatorDc, options.chunkSize);
            responderDc = new ChunkedDataChannel(responderDc, options.chunkSize);
        }

        // Calculate expected total size
        const expectedTotalSize = options.sendSize * options.nSends;
        let actualTotalSize = 0;
        let startTime;
        let endTime;

        // Pre-generate data
        let i = 0;
        let data = [];
        let currentlySending = false;
        for (let _ = 0; _ < options.nSends; ++_) {
            // data.push(nacl.randomBytes(sendSize));
            data.push(new Uint8Array(options.sendSize));
        }
        const terminator = new Uint8Array(1);

        const continueSending = () => {
            // There seems to be a race of some sort...
            if (currentlySending) {
                return;
            }

            currentlySending = true;
            while (i < data.length) {
                initiatorDc.send(data[i]);
                ++i;

                // Pause sending?
                if (initiatorDc.bufferedAmount >= options.highWaterMark) {
                    console.debug('Pause sending (bufferedAmount=' + initiatorDc.bufferedAmount + ')');
                    currentlySending = false;
                    return;
                }
            }
            initiatorDc.send(terminator);
        };

        // Initiator DC: Start sending (after some timeout)
        initiatorDc.onopen = () => {
            window.setTimeout(() => {
                console.info('Starting test');
                startTime = new Date();

                // Send buffered
                continueSending();
            }, 1000);
        };

        // Initiator DC: Continue sending when buffered amount is low
        initiatorDc.bufferedAmountLowThreshold = options.lowWaterMark;
        initiatorDc.onbufferedamountlow = () => {
            console.debug('Resume sending (bufferedAmount=' + initiatorDc.bufferedAmount + ')');
            continueSending();
        };

        return new Promise((resolve) => {
            // Responder DC: Receive and make sure the size is correct
            responderDc.onmessage = (e) => {
                // Validate length
                const length = e.data.byteLength || e.data.size;

                // Last packet?
                if (length === 1) {
                    // Done!
                    endTime = new Date();
                    const time = (endTime - startTime) / 1000;
                    console.info('Test complete after ' + time + ' seconds');
                    console.info('Throughput: ' + actualTotalSize / time / 1024 / 1024 + ' MiB');

                    // Add to results
                    const result = results[testIndex - 1];
                    result.startTime = startTime;
                    result.endTime = endTime;
                    result.totalSize = actualTotalSize;

                    // Validate total length
                    expect(actualTotalSize).toEqual(expectedTotalSize);
                    resolve();
                } else {
                    // Validate length
                    actualTotalSize += length;
                    expect(length).toEqual(options.sendSize);
                }
            };
        });
    }

    it('normal data channel (ArrayBuffer, not chunked)', async (done) => {
        // Normal data channel
        // Chunk size: 0 (not chunked)
        // Type: ArrayBuffer
        // Send size: 65536 Bytes
        // #Sends: 2048
        // Total size: 128 MiB
        // Water mark: 16384 KiB (low), 65536 KiB (high)
        // TODO: Fix this to 65536 again once adapter has been patched!
        await benchmark({
            secure: false,
            chunkSize: 0,
            binaryType: 'arraybuffer',
            sendSize: 65535,
            nSends: 2048,
            lowWaterMark: 16384,
            highWaterMark: 262144,
        });
        done();
    }, 30000);

    it('normal data channel (ArrayBuffer, not chunked)', async (done) => {
        // Normal data channel
        // Chunk size: 0 (not chunked)
        // Type: ArrayBuffer
        // Send size: 262144 Bytes
        // #Sends: 512
        // Total size: 128 MiB
        // Water mark: 1 MiB (low), 8 MiB (high)
        await benchmark({
            secure: false,
            chunkSize: 0,
            binaryType: 'arraybuffer',
            sendSize: 262144,
            nSends: 512,
            lowWaterMark: 1048576,
            highWaterMark: 8388608,
        });
        done();
    }, 30000);

    it('normal data channel (ArrayBuffer, chunked)', async (done) => {
        // Normal data channel
        // Chunk size: 16384
        // Type: ArrayBuffer
        // Send size: 65536 Bytes
        // #Sends: 2048
        // Total size: 128 MiB
        // Water mark: 16384 KiB (low), 65536 KiB (high)
        // TODO: Fix this to 65536 again once adapter has been patched!
        await benchmark({
            secure: false,
            chunkSize: 16384,
            binaryType: 'arraybuffer',
            sendSize: 65535,
            nSends: 2048,
            lowWaterMark: 16384,
            highWaterMark: 262144,
        });
        done();
    }, 60000);

    it('normal data channel (ArrayBuffer, chunked)', async (done) => {
        // Normal data channel
        // Chunk size: 65536
        // Type: ArrayBuffer
        // Send size: 65536 Bytes
        // #Sends: 2048
        // Total size: 128 MiB
        // Water mark: 16384 KiB (low), 65536 KiB (high)
        // TODO: Fix this to 65536 again once adapter has been patched!
        await benchmark({
            secure: true,
            chunkSize: 65535,
            binaryType: 'arraybuffer',
            sendSize: 65535,
            nSends: 2048,
            lowWaterMark: 16384,
            highWaterMark: 262144,
        });
        done();
    }, 60000);

    it('normal data channel (ArrayBuffer, chunked)', async (done) => {
        // Secure data channel
        // Chunk size: 262144
        // Type: ArrayBuffer
        // Send size: 262144 Bytes
        // #Sends: 512
        // Total size: 128 MiB
        // Water mark: 1 MiB (low), 8 MiB (high)
        await benchmark({
            secure: false,
            chunkSize: 262144,
            binaryType: 'arraybuffer',
            sendSize: 262144,
            nSends: 512,
            lowWaterMark: 1048576,
            highWaterMark: 8388608,
        });
        done();
    }, 60000);

    it('secure data channel (ArrayBuffer)', async (done) => {
        // Secure data channel
        // Chunk size: 16384
        // Type: ArrayBuffer
        // Send size: 65536 Bytes
        // #Sends: 2048
        // Total size: 128 MiB
        // Water mark: 16384 KiB (low), 65536 KiB (high)
        // TODO: Fix this to 65536 again once adapter has been patched!
        await benchmark({
            secure: true,
            chunkSize: 16384,
            binaryType: 'arraybuffer',
            sendSize: 65535,
            nSends: 2048,
            lowWaterMark: 16384,
            highWaterMark: 262144,
        });
        done();
    }, 60000);

    it('secure data channel (ArrayBuffer)', async (done) => {
        // Secure data channel
        // Chunk size: 65536
        // Type: ArrayBuffer
        // Send size: 65536 Bytes
        // #Sends: 2048
        // Total size: 128 MiB
        // Water mark: 16384 KiB (low), 65536 KiB (high)
        // TODO: Fix this to 65536 again once adapter has been patched!
        await benchmark({
            secure: true,
            chunkSize: 65535,
            binaryType: 'arraybuffer',
            sendSize: 65535,
            nSends: 2048,
            lowWaterMark: 16384,
            highWaterMark: 262144,
        });
        done();
    }, 60000);

    it('secure data channel (ArrayBuffer)', async (done) => {
        // Secure data channel
        // Chunk size: 262144
        // Type: ArrayBuffer
        // Send size: 262144 Bytes
        // #Sends: 512
        // Total size: 128 MiB
        // Water mark: 1 MiB (low), 8 MiB (high)
        await benchmark({
            secure: true,
            chunkSize: 262144,
            binaryType: 'arraybuffer',
            sendSize: 262144,
            nSends: 512,
            lowWaterMark: 1048576,
            highWaterMark: 8388608,
        });
        done();
    }, 60000);

}); }
