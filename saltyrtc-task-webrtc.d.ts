/**
 * Copyright (C) 2016 Threema GmbH / SaltyRTC Contributors
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types='saltyrtc-client' />
/// <reference types='webrtc' />

declare namespace saltyrtc.tasks.webrtc {

    interface SecureDataChannel extends RTCDataChannel {
        addEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void;
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void;
        dispatchEvent(e: Event): boolean;
    }

    interface WebRTCTask extends saltyrtc.Task {
        getMaxPacketSize(): number;
        getSignaling(): saltyrtc.Signaling;
        sendOffer(offer: RTCSessionDescriptionInit): void;
        sendAnswer(answer: RTCSessionDescriptionInit): void;
        sendCandidates(candidates: RTCIceCandidateInit[]): void;
        handover(pc: RTCPeerConnection): void;
        wrapDataChannel(dc: RTCDataChannel): saltyrtc.tasks.webrtc.SecureDataChannel;
        sendClose(): void;

        // Events
        on(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void;
        once(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void;
        off(event: string | string[], handler?: saltyrtc.SaltyRTCEventHandler): void;
    }

}
