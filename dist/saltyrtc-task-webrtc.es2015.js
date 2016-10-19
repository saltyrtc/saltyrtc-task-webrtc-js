/**
 * saltyrtc-task-webrtc v0.2.0
 * A SaltyRTC WebRTC task implementation.
 * https://github.com/saltyrtc/saltyrtc-task-webrtc-js#readme
 *
 * Copyright (C) 2016 Threema GmbH
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

import { Box, CloseCode, CombinedSequencePair, Cookie, CookiePair, EventRegistry, SignalingError } from 'saltyrtc-client';
import { Chunker, Unchunker } from 'chunked-dc';

class DataChannelNonce {
    constructor(cookie, channelId, overflow, sequenceNumber) {
        this._cookie = cookie;
        this._overflow = overflow;
        this._sequenceNumber = sequenceNumber;
        this._channelId = channelId;
    }
    get cookie() { return this._cookie; }
    get overflow() { return this._overflow; }
    get sequenceNumber() { return this._sequenceNumber; }
    get combinedSequenceNumber() { return (this._overflow << 32) + this._sequenceNumber; }
    get channelId() { return this._channelId; }
    static fromArrayBuffer(packet) {
        if (packet.byteLength != DataChannelNonce.TOTAL_LENGTH) {
            throw 'bad-packet-length';
        }
        const view = new DataView(packet);
        const cookie = new Cookie(new Uint8Array(packet, 0, 16));
        const channelId = view.getUint16(16);
        const overflow = view.getUint16(18);
        const sequenceNumber = view.getUint32(20);
        return new DataChannelNonce(cookie, channelId, overflow, sequenceNumber);
    }
    toArrayBuffer() {
        const buf = new ArrayBuffer(DataChannelNonce.TOTAL_LENGTH);
        const uint8view = new Uint8Array(buf);
        uint8view.set(this._cookie.bytes);
        const view = new DataView(buf);
        view.setUint16(16, this._channelId);
        view.setUint16(18, this._overflow);
        view.setUint32(20, this._sequenceNumber);
        return buf;
    }
    toUint8Array() {
        return new Uint8Array(this.toArrayBuffer());
    }
}
DataChannelNonce.TOTAL_LENGTH = 24;

class SecureDataChannel {
    constructor(dc, task) {
        this.logTag = 'SecureDataChannel:';
        this.messageNumber = 0;
        this.chunkCount = 0;
        this.onChunk = (event) => {
            console.debug(this.logTag, 'Received chunk');
            if (event.data instanceof Blob) {
                console.warn(this.logTag, 'Received message in blob format, which is not currently supported.');
                return;
            }
            else if (typeof event.data == 'string') {
                console.warn(this.logTag, 'Received message in string format, which is not currently supported.');
                return;
            }
            else if (!(event.data instanceof ArrayBuffer)) {
                console.warn(this.logTag, 'Received message in unsupported format. Please send ArrayBuffer objects.');
                return;
            }
            this.unchunker.add(event.data, event);
            if (this.chunkCount++ > SecureDataChannel.CHUNK_COUNT_GC) {
                this.unchunker.gc(SecureDataChannel.CHUNK_MAX_AGE);
                this.chunkCount = 0;
            }
        };
        this.onEncryptedMessage = (data, context) => {
            if (this._onmessage === undefined) {
                return;
            }
            console.debug(this.logTag, 'Decrypting incoming data...');
            const realEvent = context[context.length - 1];
            const fakeEvent = {};
            for (let x in realEvent) {
                fakeEvent[x] = realEvent[x];
            }
            const box = Box.fromUint8Array(new Uint8Array(data), nacl.box.nonceLength);
            try {
                this.validateNonce(DataChannelNonce.fromArrayBuffer(box.nonce.buffer));
            }
            catch (e) {
                console.error(this.logTag, 'Invalid nonce:', e);
                console.error(this.logTag, 'Closing data channel');
                this.close();
                return;
            }
            const decrypted = this.task.getSignaling().decryptFromPeer(box);
            fakeEvent['data'] = decrypted.buffer.slice(decrypted.byteOffset, decrypted.byteOffset + decrypted.byteLength);
            this._onmessage.bind(this.dc)(fakeEvent);
        };
        if (dc.binaryType !== 'arraybuffer') {
            throw new Error('Currently SaltyRTC can only handle data channels ' +
                'with `binaryType` set to `arraybuffer`.');
        }
        this.dc = dc;
        this.task = task;
        this.cookiePair = new CookiePair();
        this.csnPair = new CombinedSequencePair();
        this.chunkSize = this.task.getMaxPacketSize();
        if (this.chunkSize === null) {
            throw new Error('Could not determine max chunk size');
        }
        if (this.chunkSize === 0) {
            this.dc.onmessage = (event) => this.onEncryptedMessage(event.data, [event]);
        }
        else {
            this.unchunker = new Unchunker();
            this.unchunker.onMessage = this.onEncryptedMessage;
            this.dc.onmessage = this.onChunk;
        }
    }
    send(data) {
        let buffer;
        if (typeof data === 'string') {
            throw new Error('SecureDataChannel can only handle binary data.');
        }
        else if (data instanceof Blob) {
            throw new Error('SecureDataChannel does not currently support Blob data. ' +
                'Please pass in an ArrayBuffer or a typed array (e.g. Uint8Array).');
        }
        else if (data instanceof Int8Array ||
            data instanceof Uint8ClampedArray ||
            data instanceof Int16Array ||
            data instanceof Uint16Array ||
            data instanceof Int32Array ||
            data instanceof Uint32Array ||
            data instanceof Float32Array ||
            data instanceof Float64Array ||
            data instanceof DataView) {
            const start = data.byteOffset || 0;
            const end = start + (data.byteLength || data.buffer.byteLength);
            buffer = data.buffer.slice(start, end);
        }
        else if (data instanceof Uint8Array) {
            buffer = data.buffer;
        }
        else if (data instanceof ArrayBuffer) {
            buffer = data;
        }
        else {
            throw new Error('Unknown data type. Please pass in an ArrayBuffer ' +
                'or a typed array (e.g. Uint8Array).');
        }
        const box = this.encryptData(new Uint8Array(buffer));
        const encryptedBytes = box.toUint8Array();
        if (this.chunkSize === 0) {
            this.dc.send(encryptedBytes);
        }
        else {
            const chunker = new Chunker(this.messageNumber++, encryptedBytes, this.chunkSize);
            for (let chunk of chunker) {
                this.dc.send(chunk);
            }
        }
    }
    encryptData(data) {
        const csn = this.csnPair.ours.next();
        const nonce = new DataChannelNonce(this.cookiePair.ours, this.dc.id, csn.overflow, csn.sequenceNumber);
        const encrypted = this.task.getSignaling().encryptForPeer(data, nonce.toUint8Array());
        return encrypted;
    }
    validateNonce(nonce) {
        if (nonce.cookie.equals(this.cookiePair.ours)) {
            throw new Error('Local and remote cookie are equal');
        }
        if (this.cookiePair.theirs === null || this.cookiePair.theirs === undefined) {
            this.cookiePair.theirs = nonce.cookie;
        }
        else if (!nonce.cookie.equals(this.cookiePair.theirs)) {
            throw new Error("Remote cookie changed");
        }
        if (this.lastIncomingCsn != null && nonce.combinedSequenceNumber == this.lastIncomingCsn) {
            throw new Error("CSN reuse detected!");
        }
        if (nonce.channelId != this.dc.id) {
            throw new Error("Data channel id in nonce does not match actual data channel id");
        }
        this.lastIncomingCsn = nonce.combinedSequenceNumber;
    }
    get label() { return this.dc.label; }
    get ordered() { return this.dc.ordered; }
    get maxPacketLifeTime() { return this.dc.maxPacketLifeTime; }
    get maxRetransmits() { return this.dc.maxRetransmits; }
    get protocol() { return this.dc.protocol; }
    get negotiated() { return this.dc.negotiated; }
    get id() { return this.dc.id; }
    get readyState() { return this.dc.readyState; }
    get bufferedAmount() { return this.dc.bufferedAmount; }
    get bufferedAmountLowThreshold() { return this.dc.bufferedAmountLowThreshold; }
    set bufferedAmountLowThreshold(value) { this.dc.bufferedAmountLowThreshold = value; }
    get binaryType() { return this.dc.binaryType; }
    set binaryType(value) { this.dc.binaryType = value; }
    get onopen() { return this.dc.onopen; }
    set onopen(value) { this.dc.onopen = value; }
    get onbufferedamountlow() { return this.dc.onbufferedamountlow; }
    set onbufferedamountlow(value) { this.dc.onbufferedamountlow = value; }
    get onerror() { return this.dc.onerror; }
    set onerror(value) { this.dc.onerror = value; }
    get onclose() { return this.dc.onclose; }
    set onclose(value) { this.dc.onclose = value; }
    get onmessage() { return this.dc.onmessage; }
    set onmessage(value) { this._onmessage = value; }
    close() { this.dc.close(); }
    addEventListener(type, listener, useCapture) {
        if (type === 'message') {
            throw new Error('addEventListener on message events is not currently supported by SaltyRTC.');
        }
        else {
            this.dc.addEventListener(type, listener, useCapture);
        }
    }
    removeEventListener(type, listener, useCapture) {
        if (type === 'message') {
            throw new Error('removeEventListener on message events is not currently supported by SaltyRTC.');
        }
        else {
            this.dc.removeEventListener(type, listener, useCapture);
        }
    }
    dispatchEvent(e) { return this.dc.dispatchEvent(e); }
}
SecureDataChannel.CHUNK_COUNT_GC = 32;
SecureDataChannel.CHUNK_MAX_AGE = 60000;

class WebRTCTask {
    constructor() {
        this.initialized = false;
        this.exclude = new Set();
        this.eventRegistry = new EventRegistry();
    }
    get logTag() {
        if (this.signaling === null || this.signaling === undefined) {
            return 'SaltyRTC.WebRTC:';
        }
        return 'SaltyRTC.WebRTC.' + this.signaling.role + ':';
    }
    init(signaling, data) {
        this.processExcludeList(data[WebRTCTask.FIELD_EXCLUDE]);
        this.processMaxPacketSize(data[WebRTCTask.FIELD_MAX_PACKET_SIZE]);
        this.signaling = signaling;
        this.initialized = true;
    }
    processExcludeList(ids) {
        for (let id of ids) {
            this.exclude.add(id);
        }
        for (let i = 0; i <= 65535; i++) {
            if (!this.exclude.has(i)) {
                this.dcId = i;
                break;
            }
        }
        if (this.dcId === undefined) {
            throw new Error('Exclude list is too big, no free data channel id can be found');
        }
    }
    processMaxPacketSize(maxPacketSize) {
        if (!Number.isInteger(maxPacketSize)) {
            throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be an integer');
        }
        if (maxPacketSize < 0) {
            throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be positive');
        }
        if (maxPacketSize === 0 && WebRTCTask.MAX_PACKET_SIZE === 0) {
            this.maxPacketSize = 0;
        }
        else if (maxPacketSize === 0 || WebRTCTask.MAX_PACKET_SIZE === 0) {
            this.maxPacketSize = Math.max(maxPacketSize, WebRTCTask.MAX_PACKET_SIZE);
        }
        else {
            this.maxPacketSize = Math.min(maxPacketSize, WebRTCTask.MAX_PACKET_SIZE);
        }
    }
    onPeerHandshakeDone() {
    }
    onTaskMessage(message) {
        console.debug('New task message arrived: ' + message.type);
        switch (message.type) {
            case 'offer':
                if (this.validateOffer(message) !== true)
                    return;
                this.emit({ type: 'offer', data: message });
                break;
            case 'answer':
                if (this.validateAnswer(message) !== true)
                    return;
                this.emit({ type: 'answer', data: message });
                break;
            case 'candidates':
                if (this.validateCandidates(message) !== true)
                    return;
                this.emit({ type: 'candidates', data: message });
                break;
            case 'handover':
                if (this.signaling.handoverState.local === false) {
                    this.sendHandover();
                }
                this.signaling.handoverState.peer = true;
                if (this.signaling.handoverState.local && this.signaling.handoverState.peer) {
                    console.info('Handover to data channel finished');
                    this.emit({ 'type': 'handover' });
                }
                break;
            default:
                console.error('Received message with unknown type:', message.type);
        }
    }
    validateOffer(message) {
        if (message['offer'] === undefined) {
            console.warn(this.logTag, 'Offer message does not contain offer');
            return false;
        }
        if (message['offer']['sdp'] === undefined) {
            console.warn(this.logTag, 'Offer message does not contain offer sdp');
            return false;
        }
        return true;
    }
    validateAnswer(message) {
        if (message['answer'] === undefined) {
            console.warn(this.logTag, 'Answer message does not contain answer');
            return false;
        }
        if (message['answer']['sdp'] === undefined) {
            console.warn(this.logTag, 'Answer message does not contain answer sdp');
            return false;
        }
        return true;
    }
    validateCandidates(message) {
        if (message['candidates'] === undefined) {
            console.warn(this.logTag, 'Candidates message does not contain candidates');
            return false;
        }
        if (message['candidates'].length < 1) {
            console.warn(this.logTag, 'Candidates message contains empty candidate list');
            return false;
        }
        for (let candidate of message['candidates']) {
            if (typeof candidate['candidate'] !== 'string' && !(candidate['candidate'] instanceof String)) {
                console.warn(this.logTag, 'Candidates message contains invalid candidate (candidate field)');
                return false;
            }
            if (typeof candidate['sdpMid'] !== 'string' && !(candidate['sdpMid'] instanceof String) && candidate['sdpMid'] !== null) {
                console.warn(this.logTag, 'Candidates message contains invalid candidate (sdpMid field)');
                return false;
            }
            if (candidate['sdpMLineIndex'] !== null && !Number.isInteger(candidate['sdpMLineIndex'])) {
                console.warn(this.logTag, 'Candidates message contains invalid candidate (sdpMLineIndex field)');
                return false;
            }
        }
        return true;
    }
    sendSignalingMessage(payload) {
        if (this.signaling.getState() != 'task') {
            throw new SignalingError(CloseCode.ProtocolError, 'Could not send signaling message: Signaling state is not open.');
        }
        if (this.signaling.handoverState.local === false) {
            throw new SignalingError(CloseCode.ProtocolError, 'Could not send signaling message: Handover hasn\'t happened yet.');
        }
        this.sdc.send(payload);
    }
    getName() {
        return WebRTCTask.PROTOCOL_NAME;
    }
    getSupportedMessageTypes() {
        return ['offer', 'answer', 'candidates', 'handover'];
    }
    getMaxPacketSize() {
        if (this.initialized === true) {
            return this.maxPacketSize;
        }
        return null;
    }
    getData() {
        const data = {};
        data[WebRTCTask.FIELD_EXCLUDE] = Array.from(this.exclude.values());
        data[WebRTCTask.FIELD_MAX_PACKET_SIZE] = WebRTCTask.MAX_PACKET_SIZE;
        return data;
    }
    getSignaling() {
        return this.signaling;
    }
    sendOffer(offer) {
        console.debug(this.logTag, 'Sending offer');
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
            if (e instanceof SignalingError) {
                console.error(this.logTag, 'Could not send offer:', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
    }
    sendAnswer(answer) {
        console.debug(this.logTag, 'Sending answer');
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
            if (e instanceof SignalingError) {
                console.error(this.logTag, 'Could not send answer:', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
    }
    sendCandidates(candidates) {
        console.debug(this.logTag, 'Sending', candidates.length, 'candidate(s)');
        try {
            this.signaling.sendTaskMessage({
                'type': 'candidates',
                'candidates': candidates
            });
        }
        catch (e) {
            if (e instanceof SignalingError) {
                console.error(this.logTag, 'Could not send candidates:', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
    }
    handover(pc) {
        console.debug(this.logTag, 'Initiate handover');
        if (this.signaling.handoverState.local || this.signaling.handoverState.peer) {
            console.error(this.logTag, 'Handover already in progress or finished');
            return;
        }
        if (this.dcId === undefined || this.dcId === null) {
            console.error(this.logTag, 'Data channel id not set');
            this.signaling.resetConnection(CloseCode.InternalError);
            throw new Error('Data channel id not set');
        }
        const dc = pc.createDataChannel(WebRTCTask.DC_LABEL, {
            id: this.dcId,
            negotiated: true,
            ordered: true,
            protocol: WebRTCTask.PROTOCOL_NAME,
        });
        dc.binaryType = 'arraybuffer';
        this.sdc = new SecureDataChannel(dc, this);
        this.sdc.onopen = (ev) => {
            this.sendHandover();
        };
        this.sdc.onclose = (ev) => {
            if (this.signaling.handoverState.local || this.signaling.handoverState.peer) {
                this.signaling.setState('closed');
            }
        };
        this.sdc.onerror = (ev) => {
            console.error(this.logTag, 'Signaling data channel error:', ev);
        };
        this.sdc.onbufferedamountlow = (ev) => {
            console.warn(this.logTag, 'Signaling data channel: Buffered amount low:', ev);
        };
        this.sdc.onmessage = (ev) => {
            this.signaling.onSignalingPeerMessage(ev.data);
        };
    }
    sendHandover() {
        console.debug(this.logTag, 'Sending handover');
        try {
            this.signaling.sendTaskMessage({ 'type': 'handover' });
        }
        catch (e) {
            if (e instanceof SignalingError) {
                console.error(this.logTag, 'Could not send handover message', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
        this.signaling.handoverState.local = true;
        if (this.signaling.handoverState.local && this.signaling.handoverState.peer) {
            console.info(this.logTag, 'Handover to data channel finished');
            this.emit({ 'type': 'handover' });
        }
    }
    wrapDataChannel(dc) {
        console.debug(this.logTag, "Wrapping data channel", dc.id);
        return new SecureDataChannel(dc, this);
    }
    sendClose() {
        this.close(CloseCode.goingAway);
        this.signaling.resetConnection(CloseCode.goingAway);
    }
    close(reason) {
        console.debug('Closing signaling data channel:', reason);
        this.sdc.close();
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
        this.eventRegistry.unregister(event, handler);
    }
    emit(event) {
        console.debug(this.logTag, 'New event:', event.type);
        const handlers = this.eventRegistry.get(event.type);
        for (let handler of handlers) {
            try {
                this.callHandler(handler, event);
            }
            catch (e) {
                console.error('SaltyRTC: Unhandled exception in', event.type, 'handler:', e);
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
WebRTCTask.PROTOCOL_NAME = 'v0.webrtc.tasks.saltyrtc.org';
WebRTCTask.MAX_PACKET_SIZE = 16384;
WebRTCTask.FIELD_EXCLUDE = 'exclude';
WebRTCTask.FIELD_MAX_PACKET_SIZE = 'max_packet_size';
WebRTCTask.DC_LABEL = 'saltyrtc-signaling';

export { WebRTCTask };
