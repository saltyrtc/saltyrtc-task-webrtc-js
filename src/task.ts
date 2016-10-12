/**
 * Copyright (C) 2016 Threema GmbH / SaltyRTC Contributors
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference path='../node_modules/saltyrtc-client/saltyrtc/saltyrtc.d.ts' />
/// <reference path ='saltyrtc-task-webrtc.d.ts' />

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
import { EventRegistry } from "saltyrtc-client/saltyrtc/main";

export class WebRTCTask implements saltyrtc.Task {

    // Constants as defined by the specification
    private static PROTOCOL_NAME = 'v0.webrtc.tasks.saltyrtc.org';
    private static MAX_PACKET_SIZE = 16384;

    // Data fields
    private static FIELD_EXCLUDE = 'exclude';
    private static FIELD_MAX_PACKET_SIZE = 'max_packet_size';

    // Other constants
    private static DC_LABEL = 'saltyrtc-signaling';

    // Initialization state
    private initialized = false;

    // Exclude list
    private exclude: Set<number> = new Set();
    private dcId;

    // Effective max packet size
    private maxPacketSize: number;

    // Signaling
    private signaling: saltyrtc.Signaling;

    // Data channel
    private sdc: saltyrtc.tasks.webrtc.SecureDataChannel;

    // Events
    private eventRegistry: saltyrtc.EventRegistry = new EventRegistry();

    public init(signaling: saltyrtc.Signaling, data: Object): void {
        this.processExcludeList(data[WebRTCTask.FIELD_EXCLUDE] as number[]);
        this.processMaxPacketSize(data[WebRTCTask.FIELD_MAX_PACKET_SIZE]);
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
                this.dcId = i;
                break;
            }
        }
        if (this.dcId === undefined) {
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
        if (maxPacketSize === 0 && WebRTCTask.MAX_PACKET_SIZE === 0) {
            this.maxPacketSize = 0;
        } else if (maxPacketSize === 0 || WebRTCTask.MAX_PACKET_SIZE === 0) {
            this.maxPacketSize = Math.max(maxPacketSize, WebRTCTask.MAX_PACKET_SIZE);
        } else {
            this.maxPacketSize = Math.min(maxPacketSize, WebRTCTask.MAX_PACKET_SIZE);
        }
    }

    public onPeerHandshakeDone(): void {
        // Do nothing.
        // The user should wait for a signaling state change to TASK.
        // Then he can start by sending an offer.
    }

    /**
     * Handle incoming task messages.
     */
    public onTaskMessage(message: saltyrtc.messages.TaskMessage): void {
        console.debug('New task message arrived: ' + message.type);
        // TODO: Validation
        switch (message.type) {
            case 'offer':
            case 'answer':
            case 'candidates':
                this.emit({type: message.type, data: message});
                break;
            case 'handover':
                if (this.signaling.handoverState.local === false) {
                    this.sendHandover();
                }
                this.signaling.handoverState.peer = true;
                if (this.signaling.handoverState.local && this.signaling.handoverState.peer) {
                    console.info('Handover to data channel finished');
                }
                break;
            default:
                console.error('Received message with unknown type:', message.type);
        }
    }

    public sendSignalingMessage(payload: Uint8Array) {
        // TODO
    }

    public getName(): string {
        return WebRTCTask.PROTOCOL_NAME;
    }

    public getSupportedMessageTypes(): string[] {
        return ['offer', 'answer', 'candidates', 'handover'];
    }

    /**
     * Return the max packet size, or `null` if the task has not yet been initialized.
     */
    public getMaxPacketSize(): number {
        if (this.initialized === true) {
            return this.maxPacketSize;
        }
        return null;
    }

    public getData(): Object {
        const data = {};
        data[WebRTCTask.FIELD_EXCLUDE] = this.exclude;
        data[WebRTCTask.FIELD_MAX_PACKET_SIZE] = this.maxPacketSize;
        return data;
    }

    /**
     * Return a reference to the signaling instance.
     */
    public getSignaling(): saltyrtc.Signaling {
        return this.signaling;
    }

    /**
     * Send an offer message to the responder.
     */
    // TODO

    /**
     * Send an answer message to the initiator.
     */
    // TODO

    /**
     * Send one or more candidates to the peer.
     */
    // TODO

    /**
     * Do the handover from WebSocket to WebRTC data channel on the specified peer connection.
     *
     * This operation is asynchronous. To get notified when the handover is finished, subscribe to
     * the SaltyRTC `handover` event.
     */
    // TODO

    private sendHandover(): void {
        // TODO
    }

    /**
     * Return a wrapped data channel.
     *
     * Only call this method *after* handover has taken place!
     *
     * @param dc The data channel to be wrapped.
     * @return A `SecureDataChannel` instance.
     */
    // TODO

    /**
     * Send a 'close' message to the peer and close the connection.
     */
    // TODO

    /**
     * Close the data channel.
     *
     * @param reason The close code.
     */
    public close(reason: number): void {
        console.debug('Closing signaling data channel:', reason);
        this.sdc.close();
        // TODO: Is this correct?
    }

    /**
     * Attach an event handler to the specified event(s).
     *
     * Note: The same event handler object be registered twice. It will only
     * run once.
     */
    public on(event: string | string[], handler: saltyrtc.SaltyEventHandler): void {
        this.eventRegistry.register(event, handler);
    }

    /**
     * Attach a one-time event handler to the specified event(s).
     *
     * Note: If the same handler was already registered previously as a regular
     * event handler, it will be completely removed after running once.
     */
    public once(event: string | string[], handler: saltyrtc.SaltyEventHandler): void {
        const onceHandler: saltyrtc.SaltyEventHandler = (ev: saltyrtc.SaltyRTCEvent) => {
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
    public off(event: string | string[], handler?: saltyrtc.SaltyEventHandler): void {
        this.eventRegistry.unregister(event, handler);
    }

    /**
     * Emit an event.
     */
    public emit(event: saltyrtc.SaltyRTCEvent) {
        console.debug('SaltyRTC: New event:', event.type);
        const handlers = this.eventRegistry.get(event.type);
        for (let handler of handlers) {
            try {
                this.callHandler(handler, event);
            } catch (e) {
                console.error('SaltyRTC: Unhandled exception in', event.type, 'handler:', e);
            }
        }
    }

    /**
     * Call a handler with the specified event.
     *
     * If the handler returns `false`, unregister it.
     */
    private callHandler(handler: saltyrtc.SaltyEventHandler, event: saltyrtc.SaltyRTCEvent) {
        const response = handler(event);
        if (response === false) {
            this.eventRegistry.unregister(event.type, handler);
        }
    }

}
