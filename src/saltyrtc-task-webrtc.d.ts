/**                                                                                                                                                                                                                 
 * Copyright (C) 2016 Threema GmbH / SaltyRTC Contributors
 *
 * This software may be modified and distributed under the terms
 * of the MIT license.  See the `LICENSE.md` file for details.
 */

declare namespace saltyrtc.tasks.webrtc {

    interface SecureDataChannel extends RTCDataChannel {                                                                                                                                                            
        send(data: string | Blob | ArrayBuffer | ArrayBufferView): void;
        label: string;
        ordered: boolean;
        maxPacketLifeTime: number;
        maxRetransmits: number;
        protocol: string;
        negotiated: boolean;
        id: number;
        readyState: RTCDataChannelState;
        bufferedAmount: number;
        bufferedAmountLowThreshold: number;
        binaryType: RTCBinaryType;
        onopen: EventHandler;
        onbufferedamountlow: EventHandler;
        onerror: EventHandler;
        onclose: EventHandler;
        onmessage: MessageEventHandler;
        close(): void;
        addEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void;
        removeEventListener(type: string, listener: EventListenerOrEventListenerObject, useCapture?: boolean): void;
        dispatchEvent(e: Event): boolean;
    }

}
