/**
 * Copyright (C) 2016-2019 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path='../saltyrtc-task-webrtc.d.ts' />

import {DataChannelCryptoContext} from "./crypto";
import {SignalingTransport, SignalingTransportLink} from "./transport";

/**
 * Builds a WebRTCTask instance.
 *
 * The following default values are being used:
 *
 * - Version defaults to `v1`.
 * - The log level defaults to `none`.
 * - Handover is enabled by default.
 * - The maximum chunk length for the handed over signalling channel is
 *   256 KiB.
 */
export class WebRTCTaskBuilder implements saltyrtc.tasks.webrtc.WebRTCTaskBuilder {
    private version: saltyrtc.tasks.webrtc.WebRTCTaskVersion = 'v1';
    private logLevel: saltyrtc.LogLevel = 'none';
    private handover: boolean = true;
    private maxChunkLength: number = 262144;

    /**
     * Set the logging level.
     *
     * @param level The desired logging level.
     */
    public withLoggingLevel(level: saltyrtc.LogLevel): WebRTCTaskBuilder {
        this.logLevel = level;
        return this;
    }

    /**
     * Set the task version.
     *
     * @param version The desired task version.
     */
    public withVersion(version: saltyrtc.tasks.webrtc.WebRTCTaskVersion): WebRTCTaskBuilder {
        this.version = version;
        return this;
    }

    /**
     * Set whether handover should be negotiated.
     *
     * @param on Enable or disable handover.
     */
    public withHandover(on: boolean): WebRTCTaskBuilder {
        this.handover = on;
        return this;
    }

    /**
     * Set the maximum chunk length in bytes for the handed over
     * signalling channel.
     *
     * @param length The maximum byte length of a chunk.
     *
     * @throws Error in case the maximum chunk length is less or equal
     *   to the chunking header.
     */
    public withMaxChunkLength(length: number): WebRTCTaskBuilder {
        if (length <= chunkedDc.UNRELIABLE_UNORDERED_HEADER_LENGTH) {
            throw new Error('Maximum chunk length must be greater than chunking overhead');
        }
        this.maxChunkLength = length;
        return this;
    }

    /**
     * Build the WebRTCTask instance.
     * @returns WebRTCTask
     */
    public build(): WebRTCTask {
        return new WebRTCTask(
            this.version, this.logLevel, this.handover, this.maxChunkLength);
    }
}

/**
 * WebRTC Task Version 1.
 *
 * This task uses the end-to-end encryption techniques of SaltyRTC to set up a
 * secure WebRTC peer-to-peer connection. It also adds another security layer
 * for data channels that is available to applications. The signalling channel
 * will persist after being handed over to a dedicated data channel once the
 * peer-to-peer connection has been set up. Therefore, further signalling
 * communication between the peers does not require a dedicated WebSocket
 * connection over a SaltyRTC server.
 *
 * The task needs to be initialized with the WebRTC peer connection.
 *
 * To send offer/answer/candidates, use the corresponding public methods on
 * this task.
 */
export class WebRTCTask implements saltyrtc.tasks.webrtc.WebRTCTask {
    // Data fields
    private static FIELD_EXCLUDE = 'exclude';
    private static FIELD_HANDOVER = 'handover';
    private static FIELD_MAX_PACKET_SIZE = 'max_packet_size'; // legacy v0

    // Protocol version
    public readonly version: saltyrtc.tasks.webrtc.WebRTCTaskVersion;

    // Logging
    private readonly log: saltyrtc.Log;
    private logTag = '[SaltyRTC.WebRTC]';

    // Initialization state
    private initialized = false;

    // Channel ID and ID exclusion list
    private readonly exclude: Set<number> = new Set();
    private channelId: number;

    // Signaling
    private _signaling: saltyrtc.Signaling;

    // Signalling transport
    private doHandover: boolean;
    private maxChunkLength: number;
    private link: SignalingTransportLink | null = null;
    private transport: SignalingTransport | null = null;

    // Events
    private eventRegistry: saltyrtc.EventRegistry = new saltyrtcClient.EventRegistry();

    // Candidate buffering
    private static CANDIDATE_BUFFERING_MS = 5;
    private candidates: saltyrtc.tasks.webrtc.Candidate[] = [];
    private sendCandidatesTimeout: number | null = null;

    /**
     * Create a new task instance.
     */
    public constructor(
        version: saltyrtc.tasks.webrtc.WebRTCTaskVersion, logLevel: saltyrtc.LogLevel,
        handover: boolean, maxChunkLength: number,
    ) {
        this.version = version;
        this.log = new saltyrtcClient.Log(logLevel);
        this.doHandover = handover;
        this.maxChunkLength = maxChunkLength;
    }

    /**
     * Set the current signaling instance.
     */
    private set signaling(signaling: saltyrtc.Signaling) {
        this._signaling = signaling;
        this.logTag = '[SaltyRTC.WebRTC.' + signaling.role + ']';
    }

    /**
     * Get the current signaling instance.
     */
    private get signaling(): saltyrtc.Signaling {
        return this._signaling;
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Initialize the task with the task data from the peer.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     */
    public init(signaling: saltyrtc.Signaling, data: Object): void {
        this.processExcludeList(data[WebRTCTask.FIELD_EXCLUDE] as number[]);
        this.processHandover(data[WebRTCTask.FIELD_HANDOVER] as boolean);
        if (this.version === 'v0') {
            this.processMaxPacketSize(data[WebRTCTask.FIELD_MAX_PACKET_SIZE] as number);
        }
        this.signaling = signaling;
        this.initialized = true;
    }

    /**
     * The exclude field MUST contain an Array of WebRTC data channel IDs
     * (non-negative integers less than 65535) that SHALL not be used for the
     * signalling channel. The client SHALL store this list for usage during
     * handover.
     */
    private processExcludeList(ids: number[]): void {
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

    /**
     * Process the handover field from the peer.
     */
    private processHandover(handover: boolean): void {
        if (handover === false) {
            this.doHandover = false;
        }
    }

    /**
     * The max_packet_size field MUST contain either 0 or a positive integer.
     * If one client's value is 0 but the other client's value is greater than
     * 0, the larger of the two values SHALL be stored to be used for data
     * channel communication. Otherwise, the minimum of both clients' maximum
     * size SHALL be stored.
     *
     * Note: We don't care about the 0 case since this implementation will
     *       never choose 0.
     */
    private processMaxPacketSize(remoteMaxPacketSize: number): void {
        const localMaxPacketSize = this.maxChunkLength;
        if (!Number.isInteger(remoteMaxPacketSize)) {
            throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be an integer');
        }
        if (remoteMaxPacketSize < 0) {
            throw new RangeError(WebRTCTask.FIELD_MAX_PACKET_SIZE + ' field must be positive');
        } else if (remoteMaxPacketSize > 0) {
            this.maxChunkLength = Math.min(localMaxPacketSize, remoteMaxPacketSize);
        }
        this.log.debug(this.logTag, `Max packet size: Local requested ${localMaxPacketSize}` +
            ` bytes, remote requested ${remoteMaxPacketSize} bytes. Using ${this.maxChunkLength}.`);
    }

    /**
     * Used by the signaling class to notify task that the peer handshake is over.
     *
     * This method should only be called by the signaling class, not by the application!
     */
    public onPeerHandshakeDone(): void {
        // Do nothing.
        // The application should wait for a signaling state change to TASK.
        // Then it can start by sending an offer.
    }

    /**
     * This method is called by SaltyRTC when a 'disconnected' message
     * arrives through the WebSocket.
     *
     * @param id The responder ID of the peer that disconnected.
     */
    public onDisconnected(id: number): void {
        // A 'disconnected' message arrived.
        // Notify the application.
        this.emit({type: 'disconnected', data: id});
    }

    /**
     * Handle incoming task messages.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     */
    public onTaskMessage(message: saltyrtc.messages.TaskMessage): void {
        this.log.debug(this.logTag, 'New task message arrived: ' + message.type);
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
                // Ensure handover has been negotiated
                if (!this.doHandover) {
                    this.log.error(this.logTag, 'Received unexpected handover message from peer');
                    this.signaling.resetConnection(saltyrtcClient.CloseCode.ProtocolError);
                    break;
                }

                // Discard repeated handover requests
                if (this.signaling.handoverState.peer) {
                    // Note: This is not being treated as a protocol error since previous
                    //       versions had a race condition that could trigger multiple
                    //       sends of 'handover'.
                    this.log.warn(this.logTag, 'Handover already received');
                    break;
                }

                // Update state
                this.signaling.handoverState.peer = true;

                // Flush the message queue of the signaling transport (if any)
                if (this.transport !== null) {
                    this.transport.flushMessageQueue();
                }

                // Handover process completed?
                if (this.signaling.handoverState.both) {
                    this.log.info(this.logTag, 'Handover to data channel finished');
                }
                break;
            default:
                this.log.error(this.logTag, 'Received message with unknown type:', message.type);
        }
    }

    /**
     * Return whether an offer message looks valid.
     */
    private validateOffer(message: saltyrtc.messages.TaskMessage): boolean {
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

    /**
     * Return whether an answer message looks valid.
     */
    private validateAnswer(message: saltyrtc.messages.TaskMessage): boolean {
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

    /**
     * Return whether a candidates message looks valid.
     */
    private validateCandidates(message: saltyrtc.messages.TaskMessage): boolean {
        if (message['candidates'] === undefined) {
            this.log.warn(this.logTag, 'Candidates message does not contain candidates');
            return false;
        }
        if ((message['candidates'] as any[]).length < 1) {
            this.log.warn(this.logTag, 'Candidates message contains empty candidate list');
            return false;
        }
        for (let candidate of message['candidates']) {
            if (candidate !== null) {
                if (typeof candidate['candidate'] !== 'string'
                    && !(candidate['candidate'] instanceof String)) {
                    this.log.warn(this.logTag,
                        'Candidates message contains invalid candidate (candidate field)');
                    return false;
                }
                if (typeof candidate['sdpMid'] !== 'string'
                    && !(candidate['sdpMid'] instanceof String) && candidate['sdpMid'] !== null) {
                    this.log.warn(this.logTag,
                        'Candidates message contains invalid candidate (sdpMid field)');
                    return false;
                }
                if (candidate['sdpMLineIndex'] !== null
                    && !Number.isInteger(candidate['sdpMLineIndex'])) {
                    this.log.warn(this.logTag,
                        'Candidates message contains invalid candidate (sdpMLineIndex field)');
                    return false;
                }
            }
        }
        return true;
    }

    /**
     * Send a signaling message through a data channel.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     *
     * @param payload Non-encrypted message. The message will be encrypted by
     *   the underlying data channel.
     * @throws SignalingError when signaling or handover state are not correct.
     */
    public sendSignalingMessage(payload: Uint8Array) {
        if (this.signaling.getState() != 'task') {
            throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError,
                "Could not send signaling message: Signaling state is not 'task'.");
        }
        if (!this.signaling.handoverState.local) {
            throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError,
                "Could not send signaling message: Handover hasn't happened yet.");
        }
        if (this.transport === null) {
            throw new saltyrtcClient.SignalingError(saltyrtcClient.CloseCode.ProtocolError,
                'Could not send signaling message: Data channel is not established, yet.');
        }
        this.transport.send(payload);
    }

    // noinspection JSMethodCanBeStatic
    /**
     * Return the task protocol name.
     */
    public getName(): string {
        return `${this.version}.webrtc.tasks.saltyrtc.org`;
    }

    // noinspection JSMethodCanBeStatic
    /**
     * Return the list of supported message types.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     */
    public getSupportedMessageTypes(): string[] {
        return ['offer', 'answer', 'candidates', 'handover'];
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Return the task data used for negotiation in the `auth` message.
     *
     * This method should only be called by the signaling class, not by the
     * application!
     */
    public getData(): Object {
        const data = {};
        data[WebRTCTask.FIELD_EXCLUDE] = Array.from(this.exclude.values());
        data[WebRTCTask.FIELD_HANDOVER] = this.doHandover;
        if (this.version === 'v0') {
            data[WebRTCTask.FIELD_MAX_PACKET_SIZE] = this.maxChunkLength;
        }
        return data;
    }

    /**
     * Send an offer message to the responder.
     */
    public sendOffer(offer: RTCSessionDescriptionInit): void {
        this.log.debug(this.logTag, 'Sending offer');
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
                this.log.error(this.logTag, 'Could not send offer:', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }
    }

    /**
     * Send an answer message to the initiator.
     */
    public sendAnswer(answer: RTCSessionDescriptionInit): void {
        this.log.debug(this.logTag, 'Sending answer');
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
                this.log.error(this.logTag, 'Could not send answer:', e.message);
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
        this.log.debug(this.logTag, 'Buffering', candidates.length, 'candidate(s)');
        this.candidates.push(...candidates);

        // Sending function
        const sendFunc = () => {
            try {
                this.log.debug(this.logTag, 'Sending', this.candidates.length, 'candidate(s)');
                this.signaling.sendTaskMessage({
                    'type': 'candidates',
                    'candidates': this.candidates
                });
            } catch (e) {
                if (e.name === 'SignalingError') {
                    this.log.error(this.logTag, 'Could not send candidates:', e.message);
                    this.signaling.resetConnection(e.closeCode);
                }
            } finally {
                this.candidates = [];
                this.sendCandidatesTimeout = null;
            }
        };

        // Add a new timeout if one isn't in progress already
        if (this.sendCandidatesTimeout === null) {
            this.sendCandidatesTimeout = self.setTimeout(
                sendFunc, WebRTCTask.CANDIDATE_BUFFERING_MS);
        }
    }

    /**
     * Create a `SignalingTransportLink` to be used by the application for the
     * handover process.
     *
     * If the application wishes to hand over the signalling channel, it MUST
     * create an `RTCDataChannel` instance with the following properties:
     *
     * - `negotiated` must be `true`,
     * - `ordered` must be `true`, and
     * - further properties are `label`, `id` and `protocol` as passed to
     *   the factory (attributes of `SignalingTransportLink`) which SHALL NOT
     *   be modified by the application.
     *
     * Once the `RTCDataChannel` instance moves into the `open` state, the
     * `SignalingTransportHandler` SHALL be created. The handover process
     * MUST be initiated immediately (without yielding back to the event loop)
     * once the `open` event fires to prevent messages from being lost.
     *
     * In case the `RTCDataChannel` instance moves into the `closed` state or
     * errors before opening, the application SHALL NOT start the handover
     * process.
     *
     * @return all necessary information to create a dedicated `RTCDataChannel`
     * and contains functions for forwarding events and messages.
     *
     * @throws Error in case handover has not been negotiated or no free
     *   channel id could be determined during negotiation.
     */
    public getTransportLink(): saltyrtc.tasks.webrtc.SignalingTransportLink {
        this.log.debug(this.logTag, 'Create signalling transport link');

        // Make sure handover has been negotiated
        if (!this.doHandover) {
            throw new Error('Handover has not been negotiated');
        }

        // Make sure the data channel id is set
        if (this.channelId === undefined) {
            const error = 'Data channel id not set';
            throw new Error(error);
        }

        // Return the transport link
        if (this.link === null) {
            this.link = new SignalingTransportLink(this.channelId, this.getName());
        }
        return this.link;
    }

    /**
     * Initiate the handover from WebSocket to a dedicated data channel.
     *
     * This operation is asynchronous. To get notified when the handover is
     * finished, subscribe to the SaltyRTC `handover` event.
     *
     * @throws Error in case handover already requested or has not been
     *   negotiated.
     */
    public handover(handler: saltyrtc.tasks.webrtc.SignalingTransportHandler): void {
        this.log.debug(this.logTag, 'Initiate handover');

        // Make sure handover has been negotiated
        if (!this.doHandover) {
            throw new Error('Handover has not been negotiated');
        }

        // Make sure handover has not already been requested
        if (this.signaling.handoverState.local || this.transport !== null) {
            throw new Error('Handover already requested');
        }

        // Create crypto context and new signalling transport
        const crypto = this.createCryptoContext(this.channelId);
        this.transport = new SignalingTransport(
            this.link, handler, this, this.signaling, crypto, this.log.level, this.maxChunkLength);

        // Send handover message
        // Note: This will still be sent via the original transport since the
        //       switching logic depends on the local handover state which
        //       SHALL NOT be altered before this call.
        this.sendHandover();
    }

    /**
     * Send a handover message to the peer.
     */
    private sendHandover(): void {
        this.log.debug(this.logTag, 'Sending handover');

        // Send handover message
        try {
            this.signaling.sendTaskMessage({'type': 'handover'});
        } catch (e) {
            if (e.name === 'SignalingError') {
                this.log.error(this.logTag, 'Could not send handover message', e.message);
                this.signaling.resetConnection(e.closeCode);
            }
        }

        // Local handover finished
        this.signaling.handoverState.local = true;

        // Check whether we're done
        if (this.signaling.handoverState.both) {
            this.log.info(this.logTag, 'Handover to data channel finished');
        }
    }

    /**
     * Return a crypto context to encrypt and decrypt data for a data channel
     * with a specific id.
     *
     * @param channelId The data channel's id.
     */
    public createCryptoContext(channelId: number): DataChannelCryptoContext {
        return new DataChannelCryptoContext(channelId, this.signaling);
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Close the signaling data channel.
     *
     * @param reason The close code.
     */
    public close(reason: number): void {
        this.log.debug(this.logTag, 'Closing signaling data channel:',
            saltyrtcClient.explainCloseCode(reason));
        if (this.transport !== null) {
            this.transport.close();
        }
        this.transport = null;
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
     *
     * If no event name is specified, all event handlers will be cleared.
     */
    public off(event?: string | string[], handler?: saltyrtc.SaltyRTCEventHandler): void {
        if (event === undefined) {
            this.eventRegistry.unregisterAll();
        } else {
            this.eventRegistry.unregister(event, handler);
        }
    }

    /**
     * Emit an event.
     */
    private emit(event: saltyrtc.SaltyRTCEvent) {
        this.log.debug(this.logTag, 'New event:', event.type);
        const handlers = this.eventRegistry.get(event.type);
        for (let handler of handlers) {
            try {
                this.callHandler(handler, event);
            } catch (e) {
                this.log.error(this.logTag, 'Unhandled exception in', event.type, 'handler:', e);
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
