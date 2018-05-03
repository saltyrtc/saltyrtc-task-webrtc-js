/**
 * Copyright (C) 2016-2017 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path='../saltyrtc-task-webrtc.d.ts' />

/**
 * WebRTC Task.
 *
 * This task uses the end-to-end encryption techniques of SaltyRTC to set up a
 * secure WebRTC peer-to-peer connection. It also adds another security layer
 * for data channels that is available to users. The signalling channel will
 * persist after being handed over to a dedicated data channel once the
 * peer-to-peer connection has been set up. Therefore, further signalling
 * communication between the peers does not require a dedicated WebSocket
 * connection over a SaltyRTC server.
 *
 * The task needs to be initialized with the WebRTC peer connection.
 *
 * To send offer/answer/candidates, use the corresponding public methods on
 * this task.
 */
import {SecureDataChannel} from "./datachannel";

export class WebRTCTask implements saltyrtc.tasks.webrtc.WebRTCTask {

    // Constants as defined by the specification
    private static PROTOCOL_NAME = 'v0.webrtc.tasks.saltyrtc.org';
    private static DEFAULT_MAX_PACKET_SIZE = 16384;

    // Data fields
    private static FIELD_EXCLUDE = 'exclude';
    private static FIELD_MAX_PACKET_SIZE = 'max_packet_size';
    private static FIELD_HANDOVER = 'handover';

    // Other constants
    private static DC_LABEL = 'saltyrtc-signaling';

    // Initialization state
    private initialized = false;

    // Exclude list
    private exclude: Set<number> = new Set();
    private sdcId: number;

    // Effective max packet size
    private requestedMaxPacketSize: number;
    private negotiatedMaxPacketSize: number;

    // Whether to hand over
    private doHandover = true;

    // Signaling
    private signaling: saltyrtc.Signaling;

    // Data channel
    private sdc: saltyrtc.tasks.webrtc.SecureDataChannel = null;

    // Events
    private eventRegistry: saltyrtc.EventRegistry = new saltyrtcClient.EventRegistry();

    // Candidate buffering
    private static CANDIDATE_BUFFERING_MS = 5;
    private candidates: saltyrtc.tasks.webrtc.Candidate[] = [];
    private sendCandidatesTimeout: number | null = null;

    // Log tag
    private get logTag(): string {
        if (this.signaling === null || this.signaling === undefined) {
            return '[SaltyRTC.WebRTC]';
        }
        return '[SaltyRTC.WebRTC.' + this.signaling.role + ']';
    }

    /**
     * Create a new task instance.
     *
     * @param handover Set this parameter to `false` if you want to disable
     *                 the signaling handover to a secure data channel.
     * @param maxPacketSize The max packet size in bytes for a DataChannel chunk.
     */
    constructor(handover: boolean = true, maxPacketSize: number = WebRTCTask.DEFAULT_MAX_PACKET_SIZE) {
        this.doHandover = handover;
        this.requestedMaxPacketSize = maxPacketSize;
    }

    /**
     * Initialize the task with the task data from the peer.
     *
     * This method should only be called by the signalig class, not by the end user!
     */
    init(signaling: saltyrtc.Signaling, data: Object): void {
        this.processExcludeList(data[WebRTCTask.FIELD_EXCLUDE] as number[]);
        this.processMaxPacketSize(data[WebRTCTask.FIELD_MAX_PACKET_SIZE] as number);
        this.processHandover(data[WebRTCTask.FIELD_HANDOVER] as boolean);
        this.signaling = signaling;
        this.initialized = true;
    }

    /**
     * The exclude field MUST contain an Array of WebRTC data channel IDs
     * (non-negative integers) that SHALL not be used for the signalling
     * channel. The client SHALL store this list for usage during handover.
     */
    private processExcludeList(ids: number[]): void {
        for (let id of ids) {
            this.exclude.add(id);
        }
        for (let i = 0; i <= 65535; i++) {
            if (!this.exclude.has(i)) {
                this.sdcId = i;
                break;
            }
        }
        if (this.sdcId === undefined && this.doHandover === true) {
            throw new Error('Exclude list is too big, no free data channel id can be found');
        }
    }

    /**
     * The max_packet_size field MUST contain either 0 or a positive integer.
     * If one client's value is 0 but the other client's value is greater than
     * 0, the larger of the two values SHALL be stored to be used for data
     * channel communication. Otherwise, the minimum of both clients' maximum
     * size SHALL be stored.
     */
    private processMaxPacketSize(maxPacketSize: number): void {
        if (!Number.isInteger(maxPacketSize)) {
            throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be an integer');
        }
        if (maxPacketSize < 0) {
            throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be positive');
        }
        if (maxPacketSize === 0 && this.requestedMaxPacketSize === 0) {
            this.negotiatedMaxPacketSize = 0;
        } else if (maxPacketSize === 0 || this.requestedMaxPacketSize === 0) {
            this.negotiatedMaxPacketSize = Math.max(maxPacketSize, this.requestedMaxPacketSize);
        } else {
            this.negotiatedMaxPacketSize = Math.min(maxPacketSize, this.requestedMaxPacketSize);
        }
        console.debug(this.logTag, 'Max packet size: We requested', this.requestedMaxPacketSize,
                      'bytes, peer requested', maxPacketSize, 'bytes. Using', this.negotiatedMaxPacketSize + '.');
    }

    /**
     * Process the handover field from the peer.
     */
    private processHandover(handover: boolean): void {
        if (handover === false) {
            this.doHandover = false;
        }
    }

    /**
     * Used by the signaling class to notify task that the peer handshake is over.
     *
     * This method should only be called by the signalig class, not by the end user!
     */
    onPeerHandshakeDone(): void {
        // Do nothing.
        // The user should wait for a signaling state change to TASK.
        // Then he can start by sending an offer.
    }

    /**
     * This method is called by SaltyRTC when a 'disconnected' message
     * arrives through the WebSocket.
     *
     * @param id The responder ID of the peer that disconnected.
     */
    onDisconnected(id: number): void {
        // A 'disconnected' message arrived.
        // Notify the user application.
        this.emit({type: 'disconnected', data: id});
    }

    /**
     * Handle incoming task messages.
     *
     * This method should only be called by the signalig class, not by the end user!
     */
    onTaskMessage(message: saltyrtc.messages.TaskMessage): void {
        console.debug(this.logTag, 'New task message arrived: ' + message.type);
        switch (message.type) {
            case 'offer':
                if (this.validateOffer(message) !== true) return;
                this.emit({type: 'offer', data: message['offer']});
                break;
            case 'answer':
                if (this.validateAnswer(message) !== true) return;
                this.emit({type: 'answer', data: message['answer']});
                break;
            case 'candidates':
                if (this.validateCandidates(message) !== true) return;
                this.emit({type: 'candidates', data: message['candidates']});
                break;
            case 'handover':
                if (this.doHandover === false) {
                    console.error(this.logTag, 'Received unexpected handover message from peer');
                    this.signaling.resetConnection(saltyrtcClient.CloseCode.ProtocolError);
                    break;
                }
                if (this.signaling.handoverState.local === false) {
                    this.sendHandover();
                }
                this.signaling.handoverState.peer = true;
                if (this.signaling.handoverState.both) {
                    console.info(this.logTag, 'Handover to data channel finished');
                }
                break;
            default:
                console.error(this.logTag, 'Received message with unknown type:', message.type);
        }
    }

    /**
     * Return whether an offer message looks valid.
     */
    private validateOffer(message: saltyrtc.messages.TaskMessage): boolean {
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

    /**
     * Return whether an answer message looks valid.
     */
    private validateAnswer(message: saltyrtc.messages.TaskMessage): boolean {
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

    /**
     * Return whether a candidates message looks valid.
     */
    private validateCandidates(message: saltyrtc.messages.TaskMessage): boolean {
        if (message['candidates'] === undefined) {
            console.warn(this.logTag, 'Candidates message does not contain candidates');
            return false;
        }
        if ((message['candidates'] as any[]).length < 1) {
            console.warn(this.logTag, 'Candidates message contains empty candidate list');
            return false;
        }
        for (let candidate of message['candidates']) {
            if (candidate !== null) {
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
        }
        return true;
    }

    /**
     * Send a signaling message *through the data channel*.
     *
     * This method should only be called by the signalig class, not by the end user!
     *
     * @param payload Non-encrypted message. The message will be encrypted by
     *   the underlying secure data channel.
     * @throws SignalingError when signaling or handover state are not correct.
     */
    sendSignalingMessage(payload: Uint8Array) {
        if (this.signaling.getState() != 'task') {
            throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError,
                'Could not send signaling message: Signaling state is not open.');
        }
        if (this.signaling.handoverState.local === false) {
            throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError,
                'Could not send signaling message: Handover hasn\'t happened yet.');
        }
        this.sdc.send(payload);
    }

    /**
     * Return the task protocol name.
     */
    public getName(): string {
        return WebRTCTask.PROTOCOL_NAME;
    }

    /**
     * Return the list of supported message types.
     *
     * This method should only be called by the signalig class, not by the end user!
     */
    getSupportedMessageTypes(): string[] {
        return ['offer', 'answer', 'candidates', 'handover'];
    }

    /**
     * Return the negotiated max packet size, or `null` if the task has not yet been initialized.
     */
    public getMaxPacketSize(): number {
        if (this.initialized === true) {
            return this.negotiatedMaxPacketSize;
        }
        return null;
    }

    /**
     * Return the task data used for negotiation in the `auth` message.
     *
     * This method should only be called by the signalig class, not by the end user!
     */
    getData(): Object {
        const data = {};
        data[WebRTCTask.FIELD_EXCLUDE] = Array.from(this.exclude.values());
        data[WebRTCTask.FIELD_MAX_PACKET_SIZE] = this.requestedMaxPacketSize;
        data[WebRTCTask.FIELD_HANDOVER] = this.doHandover;
        return data;
    }

    /**
     * Return a reference to the signaling instance.
     *
     * This method should only be called by the signalig class, not by the end user!
     */
    getSignaling(): saltyrtc.Signaling {
        return this.signaling;
    }

    /**
     * Send an offer message to the responder.
     */
    public sendOffer(offer: RTCSessionDescriptionInit): void {
        console.debug(this.logTag, 'Sending offer');
        try {
            this.signaling.sendTaskMessage({
                'type': 'offer',
                'offer': {
                    'type': offer.type,
                    'sdp': offer.sdp,
                }
            });
        } catch (e) {
            if (e.name === 'SignalingError') {
                console.error(this.logTag, 'Could not send offer:', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
    }

    /**
     * Send an answer message to the initiator.
     */
    public sendAnswer(answer: RTCSessionDescriptionInit): void {
        console.debug(this.logTag, 'Sending answer');
        try {
            this.signaling.sendTaskMessage({
                'type': 'answer',
                'answer': {
                    'type': answer.type,
                    'sdp': answer.sdp,
                }
            });
        } catch (e) {
            if (e.name === 'SignalingError') {
                console.error(this.logTag, 'Could not send answer:', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
    }

    /**
     * Send a candidate to the peer.
     */
    public sendCandidate(candidate: saltyrtc.tasks.webrtc.Candidate): void {
        this.sendCandidates([candidate]);
    }

    /**
     * Send one or more candidates to the peer.
     */
    public sendCandidates(candidates: saltyrtc.tasks.webrtc.Candidate[]): void {
        // Add to buffer
        console.debug(this.logTag, 'Buffering', candidates.length, 'candidate(s)');
        this.candidates.push(...candidates);

        // Sending function
        const sendFunc = () => {
            try {
                console.debug(this.logTag, 'Sending', this.candidates.length, 'candidate(s)');
                this.signaling.sendTaskMessage({
                    'type': 'candidates',
                    'candidates': this.candidates
                });
            } catch (e) {
                if (e.name === 'SignalingError') {
                    console.error(this.logTag, 'Could not send candidates:', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            } finally {
                this.candidates = [];
                this.sendCandidatesTimeout = null;
            }
        };

        // Add a new timeout if one isn't in progress already
        if (this.sendCandidatesTimeout === null) {
            this.sendCandidatesTimeout = window.setTimeout(sendFunc, WebRTCTask.CANDIDATE_BUFFERING_MS);
        }
    }

    /**
     * Do the handover from WebSocket to WebRTC data channel on the specified peer connection.
     *
     * Return a boolean indicating whether the handover has been initiated.
     *
     * This operation is asynchronous. To get notified when the handover is finished, subscribe to
     * the SaltyRTC `handover` event.
     */
    public handover(pc: RTCPeerConnection): boolean {
        console.debug(this.logTag, 'Initiate handover');

        // Make sure this is intended
        if (this.doHandover === false) {
            console.error(this.logTag, 'Cannot do handover: Either us or our peer set handover=false');
            return false;
        }

        // Make sure handover hasn't already happened
        if (this.signaling.handoverState.any) {
            console.error(this.logTag, 'Handover already in progress or finished');
            return false;
        }

        // Make sure the dc id is set
        if (this.sdcId === undefined || this.sdcId === null) {
            console.error(this.logTag, 'Data channel id not set');
            this.signaling.resetConnection(saltyrtcClient.CloseCode.InternalError);
            throw new Error('Data channel id not set');
        }

        // Configure new data channel
        const dc: RTCDataChannel = pc.createDataChannel(WebRTCTask.DC_LABEL, {
            id: this.sdcId,
            negotiated: true,
            ordered: true,
            protocol: WebRTCTask.PROTOCOL_NAME,
        });
        dc.binaryType = 'arraybuffer';

        // Wrap data channel
        this.sdc = new SecureDataChannel(dc, this);

        // Attach event handlers

        this.sdc.onopen = (ev: Event) => {
            // Send handover message
            this.sendHandover();
        };

        this.sdc.onclose = (ev: Event) => {
            // If handover has already happened, set signaling state to closed
            if (this.signaling.handoverState.any) {
                this.signaling.setState('closed');
            }
        };

        this.sdc.onerror = (ev: Event) => {
            // Log error
            console.error(this.logTag, 'Signaling data channel error:', ev);
        };

        this.sdc.onbufferedamountlow = (ev: Event) => {
            // Log warning
            console.warn(this.logTag, 'Signaling data channel: Buffered amount low:', ev);
        };

        this.sdc.onmessage = (ev: MessageEvent) => {
            // Pass decrypted incoming signaling messages to signaling class
            let decryptedData = new Uint8Array(ev.data);
            this.signaling.onSignalingPeerMessage(decryptedData);
        };

        return true;
    }

    /**
     * Send a handover message to the peer.
     */
    private sendHandover(): void {
        console.debug(this.logTag, 'Sending handover');

        // Send handover message
        try {
            this.signaling.sendTaskMessage({'type': 'handover'});
        } catch (e) {
            if (e.name === 'SignalingError') {
                console.error(this.logTag, 'Could not send handover message', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }

        // Local handover finished
        this.signaling.handoverState.local = true;

        // Check whether we're done
        if (this.signaling.handoverState.both) {
            console.info(this.logTag, 'Handover to data channel finished');
        }
    }

    /**
     * Return a wrapped data channel.
     *
     * Only call this method *after* handover has taken place!
     *
     * @param dc The data channel to be wrapped.
     * @return A `SecureDataChannel` instance.
     */
    public wrapDataChannel(dc: RTCDataChannel): saltyrtc.tasks.webrtc.SecureDataChannel {
        console.debug(this.logTag, "Wrapping data channel", dc.id);
        return new SecureDataChannel(dc, this);
    }

    /**
     * Close the signaling data channel.
     *
     * @param reason The close code.
     */
    public close(reason: number): void {
        console.debug(this.logTag, 'Closing signaling data channel:', saltyrtcClient.explainCloseCode(reason));
        if (this.sdc !== null) {
            this.sdc.close();
        }
        this.sdc = null;
    }

    /**
     * Attach an event handler to the specified event(s).
     *
     * Note: The same event handler object be registered twice. It will only
     * run once.
     */
    public on(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void {
        this.eventRegistry.register(event, handler);
    }

    /**
     * Attach a one-time event handler to the specified event(s).
     *
     * Note: If the same handler was already registered previously as a regular
     * event handler, it will be completely removed after running once.
     */
    public once(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void {
        const onceHandler: saltyrtc.SaltyRTCEventHandler = (ev: saltyrtc.SaltyRTCEvent) => {
            try {
                handler(ev);
            } catch (e) {
                // Handle exceptions
                this.off(ev.type, onceHandler);
                throw e;
            }
            this.off(ev.type, onceHandler);
        };
        this.eventRegistry.register(event, onceHandler);
    }

    /**
     * Remove an event handler from the specified event(s).
     *
     * If no handler is specified, remove all handlers for the specified
     * event(s).
     */
    public off(event: string | string[], handler?: saltyrtc.SaltyRTCEventHandler): void {
        this.eventRegistry.unregister(event, handler);
    }

    /**
     * Emit an event.
     */
    private emit(event: saltyrtc.SaltyRTCEvent) {
        console.debug(this.logTag, 'New event:', event.type);
        const handlers = this.eventRegistry.get(event.type);
        for (let handler of handlers) {
            try {
                this.callHandler(handler, event);
            } catch (e) {
                console.error(this.logTag, 'Unhandled exception in', event.type, 'handler:', e);
            }
        }
    }

    /**
     * Call a handler with the specified event.
     *
     * If the handler returns `false`, unregister it.
     */
    private callHandler(handler: saltyrtc.SaltyRTCEventHandler, event: saltyrtc.SaltyRTCEvent) {
        const response = handler(event);
        if (response === false) {
            this.eventRegistry.unregister(event.type, handler);
        }
    }

}
