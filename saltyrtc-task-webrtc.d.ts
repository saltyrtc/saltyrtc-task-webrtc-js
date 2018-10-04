/**
 * Copyright (C) 2016-2018 Threema GmbH
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

/// <reference types="@saltyrtc/client" />

declare namespace saltyrtc.tasks.webrtc {

    type Offer = RTCSessionDescriptionInit;
    type Answer = RTCSessionDescriptionInit;
    type Candidate = RTCIceCandidateInit | null;

    interface SecureDataChannel extends RTCDataChannel {
        addEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void;
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void;
        dispatchEvent(e: Event): boolean;
    }

    interface SecureDataChannelStatic {
        new(dc: RTCDataChannel, task: WebRTCTask);
    }

    interface WebRTCTask extends saltyrtc.Task {
        getMaxPacketSize(): number;
        getSignaling(): saltyrtc.Signaling;
        sendOffer(offer: RTCSessionDescriptionInit): void;
        sendAnswer(answer: RTCSessionDescriptionInit): void;
        sendCandidate(candidate: Candidate): void;
        sendCandidates(candidates: Candidate[]): void;
        handover(pc: RTCPeerConnection): boolean;
        wrapDataChannel(dc: RTCDataChannel): saltyrtc.tasks.webrtc.SecureDataChannel;

        // Events
        on(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void;
        once(event: string | string[], handler: saltyrtc.SaltyRTCEventHandler): void;
        off(event?: string | string[], handler?: saltyrtc.SaltyRTCEventHandler): void;
    }

    interface WebRTCTaskStatic {
        new(handover?: boolean, maxPacketSize?: number, logLevel?: saltyrtc.LogLevel): WebRTCTask;
    }

    interface OfferEvent extends saltyrtc.SaltyRTCEvent {
        data: Offer;
    }
    interface AnswerEvent extends saltyrtc.SaltyRTCEvent {
        data: Answer;
    }
    interface CandidatesEvent extends saltyrtc.SaltyRTCEvent {
        data: Candidate[];
    }
}

declare var saltyrtcTaskWebrtc: {
    SecureDataChannel: saltyrtc.tasks.webrtc.SecureDataChannelStatic,
    WebRTCTask: saltyrtc.tasks.webrtc.WebRTCTaskStatic,
};
