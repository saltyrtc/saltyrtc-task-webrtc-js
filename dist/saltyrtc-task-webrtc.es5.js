/**
 * saltyrtc-task-webrtc v0.15.0
 * A SaltyRTC WebRTC task v1 implementation.
 * https://github.com/saltyrtc/saltyrtc-task-webrtc-js#readme
 *
 * Copyright (C) 2016-2022 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license:
 * 
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * 
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * 
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
'use strict';

var saltyrtcTaskWebrtc = (function (exports) {
    'use strict';

    class DataChannelNonce {
        constructor(cookie, channelId, overflow, sequenceNumber) {
            this.cookie = cookie;
            this.overflow = overflow;
            this.sequenceNumber = sequenceNumber;
            this.channelId = channelId;
        }
        get combinedSequenceNumber() {
            return (this.overflow * (Math.pow(2, 32))) + this.sequenceNumber;
        }
        static fromUint8Array(data) {
            if (data.byteLength !== this.TOTAL_LENGTH) {
                throw new saltyrtcClient.exceptions.ValidationError('Bad packet length');
            }
            const view = new DataView(data.buffer, data.byteOffset, this.TOTAL_LENGTH);
            const slice = new Uint8Array(data.buffer, data.byteOffset, saltyrtcClient.Cookie.COOKIE_LENGTH);
            const cookie = new saltyrtcClient.Cookie(slice);
            const channelId = view.getUint16(16);
            const overflow = view.getUint16(18);
            const sequenceNumber = view.getUint32(20);
            return new DataChannelNonce(cookie, channelId, overflow, sequenceNumber);
        }
        toUint8Array() {
            const buffer = new Uint8Array(DataChannelNonce.TOTAL_LENGTH);
            buffer.set(this.cookie.bytes);
            const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
            view.setUint16(16, this.channelId);
            view.setUint16(18, this.overflow);
            view.setUint32(20, this.sequenceNumber);
            return buffer;
        }
    }
    DataChannelNonce.TOTAL_LENGTH = 24;

    class DataChannelCryptoContext {
        constructor(channelId, signaling) {
            this.lastIncomingCsn = null;
            this.channelId = channelId;
            this.signaling = signaling;
            this.cookiePair = new saltyrtcClient.CookiePair();
            this.csnPair = new saltyrtcClient.CombinedSequencePair();
        }
        encrypt(data) {
            const csn = this.csnPair.ours.next();
            const nonce = new DataChannelNonce(this.cookiePair.ours, this.channelId, csn.overflow, csn.sequenceNumber);
            return this.signaling.encryptForPeer(data, nonce.toUint8Array());
        }
        decrypt(box) {
            let nonce;
            try {
                nonce = DataChannelNonce.fromUint8Array(box.nonce);
            }
            catch (error) {
                throw new saltyrtcClient.exceptions.ValidationError(`Unable to create nonce, reason: ${error}`);
            }
            if (nonce.cookie.equals(this.cookiePair.ours)) {
                throw new saltyrtcClient.exceptions.ValidationError('Local and remote cookie are equal');
            }
            if (this.cookiePair.theirs === null || this.cookiePair.theirs === undefined) {
                this.cookiePair.theirs = nonce.cookie;
            }
            else if (!nonce.cookie.equals(this.cookiePair.theirs)) {
                throw new saltyrtcClient.exceptions.ValidationError('Remote cookie changed');
            }
            if (this.lastIncomingCsn !== null &&
                nonce.combinedSequenceNumber === this.lastIncomingCsn) {
                throw new saltyrtcClient.exceptions.ValidationError('CSN reuse detected');
            }
            if (nonce.channelId !== this.channelId) {
                const error = 'Data channel id in nonce does not match';
                throw new saltyrtcClient.exceptions.ValidationError(error);
            }
            this.lastIncomingCsn = nonce.combinedSequenceNumber;
            return this.signaling.decryptFromPeer(box);
        }
    }
    DataChannelCryptoContext.OVERHEAD_LENGTH = 40;
    DataChannelCryptoContext.NONCE_LENGTH = DataChannelNonce.TOTAL_LENGTH;

    class SignalingTransportLink {
        constructor(id, protocol) {
            this.label = 'saltyrtc-signaling';
            this.id = id;
            this.protocol = protocol;
            this.untie();
        }
        untie() {
            this.closed = () => { throw new Error('closed: Not tied to a SignalingTransport'); };
            this.receive = () => { throw new Error('receive: Not tied to a SignalingTransport'); };
        }
        tie(transport) {
            this.closed = transport.closed.bind(transport);
            this.receive = transport.receiveChunk.bind(transport);
        }
    }
    class SignalingTransport {
        constructor(link, handler, task, signaling, crypto, logLevel, maxChunkLength) {
            this.logTag = '[SaltyRTC.WebRTC.SignalingTransport]';
            this.messageId = 0;
            this.log = new saltyrtcClient.Log(logLevel);
            this.link = link;
            this.handler = handler;
            this.task = task;
            this.signaling = signaling;
            this.crypto = crypto;
            this.chunkLength = Math.min(this.handler.maxMessageSize, maxChunkLength);
            this.chunkBuffer = new ArrayBuffer(this.chunkLength);
            this.messageQueue = this.signaling.handoverState.peer ? null : [];
            this.unchunker = new chunkedDc.UnreliableUnorderedUnchunker();
            this.unchunker.onMessage = this.receiveMessage.bind(this);
            this.link.tie(this);
            this.log.info(this.logTag, 'Signaling transport created');
        }
        closed() {
            this.log.info('Closed (remote)');
            this.unbind();
            if (this.signaling.handoverState.any) {
                this.signaling.setState('closed');
            }
        }
        receiveChunk(chunk) {
            this.log.debug(this.logTag, 'Received chunk');
            try {
                this.unchunker.add(chunk);
            }
            catch (error) {
                this.log.error(this.logTag, 'Invalid chunk:', error);
                return this.die();
            }
        }
        receiveMessage(message) {
            this.log.debug(this.logTag, 'Received message');
            const box = saltyrtcClient.Box.fromUint8Array(message, DataChannelCryptoContext.NONCE_LENGTH);
            try {
                message = this.crypto.decrypt(box);
            }
            catch (error) {
                this.log.error(this.logTag, 'Invalid nonce:', error);
                return this.die();
            }
            if (!this.signaling.handoverState.peer) {
                this.messageQueue.push(message);
                return;
            }
            this.signaling.onSignalingPeerMessage(message);
        }
        flushMessageQueue() {
            if (!this.signaling.handoverState.peer) {
                throw new Error('Remote did not request handover');
            }
            for (const message of this.messageQueue) {
                this.signaling.onSignalingPeerMessage(message);
            }
            this.messageQueue = null;
        }
        send(message) {
            this.log.debug(this.logTag, 'Sending message');
            const box = this.crypto.encrypt(message);
            message = box.toUint8Array();
            const chunker = new chunkedDc.UnreliableUnorderedChunker(this.messageId++, message, this.chunkLength, this.chunkBuffer);
            for (let chunk of chunker) {
                this.log.debug(this.logTag, 'Sending chunk');
                try {
                    this.handler.send(chunk);
                }
                catch (error) {
                    this.log.error(this.logTag, 'Unable to send chunk:', error);
                    return this.die();
                }
            }
        }
        close() {
            try {
                this.handler.close();
            }
            catch (error) {
                this.log.error(this.logTag, 'Unable to close data channel:', error);
            }
            this.log.info('Closed (local)');
            this.unbind();
        }
        die() {
            this.log.warn(this.logTag, 'Closing task due to an error');
            this.task.close(saltyrtcClient.CloseCode.ProtocolError);
        }
        unbind() {
            this.link.untie();
            this.unchunker.onMessage = undefined;
        }
    }

    class WebRTCTaskBuilder {
        constructor() {
            this.version = 'v1';
            this.logLevel = 'none';
            this.handover = true;
            this.maxChunkLength = 262144;
        }
        withLoggingLevel(level) {
            this.logLevel = level;
            return this;
        }
        withVersion(version) {
            this.version = version;
            return this;
        }
        withHandover(on) {
            this.handover = on;
            return this;
        }
        withMaxChunkLength(length) {
            if (length <= chunkedDc.UNRELIABLE_UNORDERED_HEADER_LENGTH) {
                throw new Error('Maximum chunk length must be greater than chunking overhead');
            }
            this.maxChunkLength = length;
            return this;
        }
        build() {
            return new WebRTCTask(this.version, this.logLevel, this.handover, this.maxChunkLength);
        }
    }
    class WebRTCTask {
        constructor(version, logLevel, handover, maxChunkLength) {
            this.logTag = '[SaltyRTC.WebRTC]';
            this.initialized = false;
            this.exclude = new Set();
            this.link = null;
            this.transport = null;
            this.eventRegistry = new saltyrtcClient.EventRegistry();
            this.candidates = [];
            this.sendCandidatesTimeout = null;
            this.version = version;
            this.log = new saltyrtcClient.Log(logLevel);
            this.doHandover = handover;
            this.maxChunkLength = maxChunkLength;
        }
        set signaling(signaling) {
            this._signaling = signaling;
            this.logTag = '[SaltyRTC.WebRTC.' + signaling.role + ']';
        }
        get signaling() {
            return this._signaling;
        }
        init(signaling, data) {
            this.processExcludeList(data[WebRTCTask.FIELD_EXCLUDE]);
            this.processHandover(data[WebRTCTask.FIELD_HANDOVER]);
            if (this.version === 'v0') {
                this.processMaxPacketSize(data[WebRTCTask.FIELD_MAX_PACKET_SIZE]);
            }
            this.signaling = signaling;
            this.initialized = true;
        }
        processExcludeList(ids) {
            for (const id of ids) {
                this.exclude.add(id);
            }
            for (let i = 0; i < 65535; i++) {
                if (!this.exclude.has(i)) {
                    this.channelId = i;
                    break;
                }
            }
            if (this.channelId === undefined && this.doHandover) {
                throw new Error('No free data channel id can be found');
            }
        }
        processHandover(handover) {
            if (handover === false) {
                this.doHandover = false;
            }
        }
        processMaxPacketSize(remoteMaxPacketSize) {
            const localMaxPacketSize = this.maxChunkLength;
            if (!Number.isInteger(remoteMaxPacketSize)) {
                throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be an integer');
            }
            if (remoteMaxPacketSize < 0) {
                throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be positive');
            }
            else if (remoteMaxPacketSize > 0) {
                this.maxChunkLength = Math.min(localMaxPacketSize, remoteMaxPacketSize);
            }
            this.log.debug(this.logTag, `Max packet size: Local requested ${localMaxPacketSize}` +
                ` bytes, remote requested ${remoteMaxPacketSize} bytes. Using ${this.maxChunkLength}.`);
        }
        onPeerHandshakeDone() {
        }
        onDisconnected(id) {
            this.emit({ type: 'disconnected', data: id });
        }
        onTaskMessage(message) {
            this.log.debug(this.logTag, 'New task message arrived: ' + message.type);
            switch (message.type) {
                case 'offer':
                    if (this.validateOffer(message) !== true)
                        return;
                    this.emit({ type: 'offer', data: message['offer'] });
                    break;
                case 'answer':
                    if (this.validateAnswer(message) !== true)
                        return;
                    this.emit({ type: 'answer', data: message['answer'] });
                    break;
                case 'candidates':
                    if (this.validateCandidates(message) !== true)
                        return;
                    this.emit({ type: 'candidates', data: message['candidates'] });
                    break;
                case 'handover':
                    if (!this.doHandover) {
                        this.log.error(this.logTag, 'Received unexpected handover message from peer');
                        this.signaling.resetConnection(saltyrtcClient.CloseCode.ProtocolError);
                        break;
                    }
                    if (this.signaling.handoverState.peer) {
                        this.log.warn(this.logTag, 'Handover already received');
                        break;
                    }
                    this.signaling.handoverState.peer = true;
                    if (this.transport !== null) {
                        this.transport.flushMessageQueue();
                    }
                    if (this.signaling.handoverState.both) {
                        this.log.info(this.logTag, 'Handover to data channel finished');
                    }
                    break;
                default:
                    this.log.error(this.logTag, 'Received message with unknown type:', message.type);
            }
        }
        validateOffer(message) {
            if (message['offer'] === undefined) {
                this.log.warn(this.logTag, 'Offer message does not contain offer');
                return false;
            }
            if (message['offer']['sdp'] === undefined) {
                this.log.warn(this.logTag, 'Offer message does not contain offer sdp');
                return false;
            }
            return true;
        }
        validateAnswer(message) {
            if (message['answer'] === undefined) {
                this.log.warn(this.logTag, 'Answer message does not contain answer');
                return false;
            }
            if (message['answer']['sdp'] === undefined) {
                this.log.warn(this.logTag, 'Answer message does not contain answer sdp');
                return false;
            }
            return true;
        }
        validateCandidates(message) {
            if (message['candidates'] === undefined) {
                this.log.warn(this.logTag, 'Candidates message does not contain candidates');
                return false;
            }
            if (message['candidates'].length < 1) {
                this.log.warn(this.logTag, 'Candidates message contains empty candidate list');
                return false;
            }
            for (let candidate of message['candidates']) {
                if (candidate !== null) {
                    if (typeof candidate['candidate'] !== 'string'
                        && !(candidate['candidate'] instanceof String)) {
                        this.log.warn(this.logTag, 'Candidates message contains invalid candidate (candidate field)');
                        return false;
                    }
                    if (typeof candidate['sdpMid'] !== 'string'
                        && !(candidate['sdpMid'] instanceof String) && candidate['sdpMid'] !== null) {
                        this.log.warn(this.logTag, 'Candidates message contains invalid candidate (sdpMid field)');
                        return false;
                    }
                    if (candidate['sdpMLineIndex'] !== null
                        && !Number.isInteger(candidate['sdpMLineIndex'])) {
                        this.log.warn(this.logTag, 'Candidates message contains invalid candidate (sdpMLineIndex field)');
                        return false;
                    }
                }
            }
            return true;
        }
        sendSignalingMessage(payload) {
            if (this.signaling.getState() != 'task') {
                throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError, "Could not send signaling message: Signaling state is not 'task'.");
            }
            if (!this.signaling.handoverState.local) {
                throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError, "Could not send signaling message: Handover hasn't happened yet.");
            }
            if (this.transport === null) {
                throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError, 'Could not send signaling message: Data channel is not established, yet.');
            }
            this.transport.send(payload);
        }
        getName() {
            return `${this.version}.webrtc.tasks.saltyrtc.org`;
        }
        getSupportedMessageTypes() {
            return ['offer', 'answer', 'candidates', 'handover'];
        }
        getData() {
            const data = {};
            data[WebRTCTask.FIELD_EXCLUDE] = Array.from(this.exclude.values());
            data[WebRTCTask.FIELD_HANDOVER] = this.doHandover;
            if (this.version === 'v0') {
                data[WebRTCTask.FIELD_MAX_PACKET_SIZE] = this.maxChunkLength;
            }
            return data;
        }
        sendOffer(offer) {
            this.log.debug(this.logTag, 'Sending offer');
            try {
                this.signaling.sendTaskMessage({
                    'type': 'offer',
                    'offer': {
                        'type': offer.type,
                        'sdp': offer.sdp,
                    }
                });
            }
            catch (e) {
                if (e.name === 'SignalingError') {
                    this.log.error(this.logTag, 'Could not send offer:', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            }
        }
        sendAnswer(answer) {
            this.log.debug(this.logTag, 'Sending answer');
            try {
                this.signaling.sendTaskMessage({
                    'type': 'answer',
                    'answer': {
                        'type': answer.type,
                        'sdp': answer.sdp,
                    }
                });
            }
            catch (e) {
                if (e.name === 'SignalingError') {
                    this.log.error(this.logTag, 'Could not send answer:', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            }
        }
        sendCandidate(candidate) {
            this.sendCandidates([candidate]);
        }
        sendCandidates(candidates) {
            this.log.debug(this.logTag, 'Buffering', candidates.length, 'candidate(s)');
            this.candidates.push(...candidates);
            const sendFunc = () => {
                try {
                    this.log.debug(this.logTag, 'Sending', this.candidates.length, 'candidate(s)');
                    this.signaling.sendTaskMessage({
                        'type': 'candidates',
                        'candidates': this.candidates
                    });
                }
                catch (e) {
                    if (e.name === 'SignalingError') {
                        this.log.error(this.logTag, 'Could not send candidates:', e.message);
                        this.signaling.resetConnection(e.closeCode);
                    }
                }
                finally {
                    this.candidates = [];
                    this.sendCandidatesTimeout = null;
                }
            };
            if (this.sendCandidatesTimeout === null) {
                this.sendCandidatesTimeout = self.setTimeout(sendFunc, WebRTCTask.CANDIDATE_BUFFERING_MS);
            }
        }
        getTransportLink() {
            this.log.debug(this.logTag, 'Create signalling transport link');
            if (!this.doHandover) {
                throw new Error('Handover has not been negotiated');
            }
            if (this.channelId === undefined) {
                const error = 'Data channel id not set';
                throw new Error(error);
            }
            if (this.link === null) {
                this.link = new SignalingTransportLink(this.channelId, this.getName());
            }
            return this.link;
        }
        handover(handler) {
            this.log.debug(this.logTag, 'Initiate handover');
            if (!this.doHandover) {
                throw new Error('Handover has not been negotiated');
            }
            if (this.signaling.handoverState.local || this.transport !== null) {
                throw new Error('Handover already requested');
            }
            const crypto = this.createCryptoContext(this.channelId);
            this.transport = new SignalingTransport(this.link, handler, this, this.signaling, crypto, this.log.level, this.maxChunkLength);
            this.sendHandover();
        }
        sendHandover() {
            this.log.debug(this.logTag, 'Sending handover');
            try {
                this.signaling.sendTaskMessage({ 'type': 'handover' });
            }
            catch (e) {
                if (e.name === 'SignalingError') {
                    this.log.error(this.logTag, 'Could not send handover message', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            }
            this.signaling.handoverState.local = true;
            if (this.signaling.handoverState.both) {
                this.log.info(this.logTag, 'Handover to data channel finished');
            }
        }
        createCryptoContext(channelId) {
            return new DataChannelCryptoContext(channelId, this.signaling);
        }
        close(reason) {
            this.log.debug(this.logTag, 'Closing signaling data channel:', saltyrtcClient.explainCloseCode(reason));
            if (this.transport !== null) {
                this.transport.close();
            }
            this.transport = null;
        }
        on(event, handler) {
            this.eventRegistry.register(event, handler);
        }
        once(event, handler) {
            const onceHandler = (ev) => {
                try {
                    handler(ev);
                }
                catch (e) {
                    this.off(ev.type, onceHandler);
                    throw e;
                }
                this.off(ev.type, onceHandler);
            };
            this.eventRegistry.register(event, onceHandler);
        }
        off(event, handler) {
            if (event === undefined) {
                this.eventRegistry.unregisterAll();
            }
            else {
                this.eventRegistry.unregister(event, handler);
            }
        }
        emit(event) {
            this.log.debug(this.logTag, 'New event:', event.type);
            const handlers = this.eventRegistry.get(event.type);
            for (let handler of handlers) {
                try {
                    this.callHandler(handler, event);
                }
                catch (e) {
                    this.log.error(this.logTag, 'Unhandled exception in', event.type, 'handler:', e);
                }
            }
        }
        callHandler(handler, event) {
            const response = handler(event);
            if (response === false) {
                this.eventRegistry.unregister(event.type, handler);
            }
        }
    }
    WebRTCTask.FIELD_EXCLUDE = 'exclude';
    WebRTCTask.FIELD_HANDOVER = 'handover';
    WebRTCTask.FIELD_MAX_PACKET_SIZE = 'max_packet_size';
    WebRTCTask.CANDIDATE_BUFFERING_MS = 5;

    exports.DataChannelCryptoContext = DataChannelCryptoContext;
    exports.WebRTCTaskBuilder = WebRTCTaskBuilder;

    Object.defineProperty(exports, '__esModule', { value: true });

    return exports;

})({});
//# sourceMappingURL=saltyrtc-task-webrtc.es5.js.map
