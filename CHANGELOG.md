# Changelog

This project follows semantic versioning.

Possible log types:

- `[added]` for new features.
- `[changed]` for changes in existing functionality.
- `[deprecated]` for once-stable features removed in upcoming releases.
- `[removed]` for deprecated features removed in this release.
- `[fixed]` for any bug fixes.
- `[security]` to invite users to upgrade in case of vulnerabilities.


### v0.9.0 (2017-02-07)

- [changed] Update saltyrtc-client to v0.9.x

### v0.5.2 (2016-12-15)

- [fixed] Fix typings for WebRTCTask constructor

### v0.5.1 (2016-12-15)

- [added] Make max packet size configurable (#8)

### v0.5.0 (2016-12-12)

- [changed] Update saltyrtc-client peer dependency to latest version

### v0.4.0 (2016-11-09)

- [changed] Update saltyrtc-client to latest version
- [changed] Make handover optional (#1)
- [changed] Use type declarations from npm instead of bundling them
- [removed] Remove sendClose method (#7)
- [fixed] Properly catch `SignalingError`

### v0.3.2 (2016-11-07)

- [fixed] Fix bug in data handling in `SecureDataChannel.onmessage`

### v0.3.1 (2016-11-03)

- [changed] Update saltyrtc-client to latest version
- [changed] Close entire signaling channel when a secure dc receives an invalid nonce
- [changed] Explain close code when closing signaling data channel

### v0.3.0 (2016-10-20)

- [added] Add sendCandidate() method
- [added] Add 5ms of buffering for candidates
- [changed] Emit data directly in offer/answer/candidates events
- [changed] Update saltyrtc-client to latest version
- [removed] Remove handover event on task

### v0.2.4 (2016-10-19)

- [changed] Update saltyrtc-client to latest version

### v0.2.3 (2016-10-19)

- [fixed] Don't include polyfill in regular ES5 version

### v0.2.2 (2016-10-19)

- [fixed] Fix filename of polyfilled dist file

### v0.2.1 (2016-10-19)

- [changed] Changed iife dist namespace to `saltyrtcTaskWebrtc`

### v0.2.0 (2016-10-19)

- [changed] Updated RTCPeerConnection.d.ts file

### v0.1.2 (2016-10-18)

- [changed] Move type declarations to root directory
- [fixed] Fix types in RTCPeerConnection.d.ts

### v0.1.1 (2016-10-18)

- [changed] Make saltyrtc-client and tweetnacl peer dependencies

### v0.1.0 (2016-10-18)

- Initial release
