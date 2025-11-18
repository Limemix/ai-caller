/**
 * SipMessageBuilder is a utility class for constructing various SIP (Session Initiation Protocol) messages.
 * It provides methods to build SIP requests and responses, including REGISTER, INVITE, ACK, and OPTIONS messages.
 * The class also supports generating SDP (Session Description Protocol) offers and answers for media negotiation.
 *
 * @class
 * @param {Object} config - Configuration object for the SIP message builder.
 * @param {Object} config.sip - SIP-specific configuration.
 * @param {string} config.sip.server - The SIP server address.
 * @param {string} config.sip.localIp - The local IP address for SIP communication.
 * @param {number} config.sip.localPort - The local port for SIP communication.
 * @param {string} config.sip.username - The username for SIP authentication.
 * @param {string} config.sip.userAgent - The User-Agent string to include in SIP messages.
 */

class SipMessageBuilder {
    constructor(config) {
        this.config = config;
    }

    /**
     * Builds a SIP REGISTER message.
     * @param {string} callId - Unique identifier for the SIP call.
     * @param {string} fromTag - Tag for the "From" header.
     * @param {number} cseq - Sequence number for the SIP message.
     * @returns {string} - The constructed SIP REGISTER message.
     */
    buildRegister(callId, fromTag, cseq) {
        const branch = this.generateBranch();
        return `REGISTER sip:${this.config.sip.server} SIP/2.0\r
Via: SIP/2.0/UDP ${this.config.sip.localIp}:${this.config.sip.localPort};branch=${branch};rport\r
Max-Forwards: 70\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${fromTag}\r
To: <sip:${this.config.sip.username}@${this.config.sip.server}>\r
Call-ID: ${callId}\r
CSeq: ${cseq} REGISTER\r
Contact: <sip:${this.config.sip.username}@${this.config.sip.localIp}:${this.config.sip.localPort}>\r
Expires: 3600\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: 0\r
\r
`;
    }

    /**
     * Builds a SIP INVITE message with authentication.
     * @param {string} callId - Unique identifier for the SIP call.
     * @param {string} fromTag - Tag for the "From" header.
     * @param {number} cseq - Sequence number for the SIP message.
     * @param {string} targetNumber - Target phone number to invite.
     * @param {number} rtpPort - RTP port for media negotiation.
     * @param {string} authHeader - Authentication header for the request.
     * @returns {string} - The constructed SIP INVITE message.
     */
    buildAuthenticatedInvite(callId, fromTag, cseq, targetNumber, rtpPort, authHeader) {
        const branch = this.generateBranch();
        const sdp = this.buildSdpOffer(rtpPort);

        return `INVITE sip:${targetNumber}@${this.config.sip.server} SIP/2.0\r
Via: SIP/2.0/UDP ${this.config.sip.localIp}:${this.config.sip.localPort};branch=${branch};rport\r
Max-Forwards: 70\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${fromTag}\r
To: <sip:${targetNumber}@${this.config.sip.server}>\r
Call-ID: ${callId}\r
CSeq: ${cseq} INVITE\r
Contact: <sip:${this.config.sip.username}@${this.config.sip.localIp}:${this.config.sip.localPort}>\r
Proxy-Authorization: ${authHeader}\r
Content-Type: application/sdp\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: ${sdp.length}\r
\r
${sdp}`;
    }

    /**
     * Builds a SIP REGISTER message with authentication.
     * @param {string} callId - Unique identifier for the SIP call.
     * @param {string} fromTag - Tag for the "From" header.
     * @param {number} cseq - Sequence number for the SIP message.
     * @param {string} authHeader - Authentication header for the request.
     * @returns {string} - The constructed SIP REGISTER message.
     */
    buildAuthenticatedRegister(callId, fromTag, cseq, authHeader) {
        const branch = this.generateBranch();
        return `REGISTER sip:${this.config.sip.server} SIP/2.0\r
Via: SIP/2.0/UDP ${this.config.sip.localIp}:${this.config.sip.localPort};branch=${branch};rport\r
Max-Forwards: 70\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${fromTag}\r
To: <sip:${this.config.sip.username}@${this.config.sip.server}>\r
Call-ID: ${callId}\r
CSeq: ${cseq} REGISTER\r
Contact: <sip:${this.config.sip.username}@${this.config.sip.localIp}:${this.config.sip.localPort}>\r
Authorization: ${authHeader}\r
Expires: 3600\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: 0\r
\r
`;
    }

    /**
     * Builds a SIP INVITE message for outgoing calls.
     * @param {string} callId - Unique identifier for the SIP call.
     * @param {string} fromTag - Tag for the "From" header.
     * @param {number} cseq - Sequence number for the SIP message.
     * @param {string} targetNumber - Target phone number to invite.
     * @param {number} rtpPort - RTP port for media negotiation.
     * @returns {string} - The constructed SIP INVITE message.
     */
    buildOutgoingInvite(callId, fromTag, cseq, targetNumber, rtpPort) {
        const branch = this.generateBranch();
        const sdp = this.buildSdpOffer(rtpPort);

        return `INVITE sip:${targetNumber}@${this.config.sip.server} SIP/2.0\r
Via: SIP/2.0/UDP ${this.config.sip.localIp}:${this.config.sip.localPort};branch=${branch};rport\r
Max-Forwards: 70\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${fromTag}\r
To: <sip:${targetNumber}@${this.config.sip.server}>\r
Call-ID: ${callId}\r
CSeq: ${cseq} INVITE\r
Contact: <sip:${this.config.sip.username}@${this.config.sip.localIp}:${this.config.sip.localPort}>\r
Content-Type: application/sdp\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: ${sdp.length}\r
\r
${sdp}`;
    }

    /**
     * Builds an SDP offer for media negotiation.
     * @param {number} rtpPort - RTP port for media negotiation.
     * @returns {string} - The constructed SDP offer.
     */
    buildSdpOffer(rtpPort) {
        const sessionId = Math.floor(Math.random() * 1000000000);
        const version = Math.floor(Math.random() * 1000000000);
        
        return `v=0
o=- ${sessionId} ${version} IN IP4 ${this.config.sip.localIp}
s=-
c=IN IP4 ${this.config.sip.localIp}
t=0 0
m=audio ${rtpPort} RTP/AVP 8 0 101
a=rtpmap:8 PCMA/8000
a=rtpmap:0 PCMU/8000
a=rtpmap:101 telephone-event/8000
a=fmtp:101 0-16
a=sendrecv
a=ptime:20
a=label:1
`;
    }

    /**
     * Builds a SIP ACK message.
     * @param {string} callId - Unique identifier for the SIP call.
     * @param {string} fromTag - Tag for the "From" header.
     * @param {string} toTag - Tag for the "To" header.
     * @param {number} cseq - Sequence number for the SIP message.
     * @param {string} targetNumber - Target phone number.
     * @returns {string} - The constructed SIP ACK message.
     */
    buildAck(callId, fromTag, toTag, cseq, targetNumber) {
        const branch = this.generateBranch();

        return `ACK sip:${targetNumber}@${this.config.sip.server} SIP/2.0\r
Via: SIP/2.0/UDP ${this.config.sip.localIp}:${this.config.sip.localPort};branch=${branch};rport\r
Max-Forwards: 70\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${fromTag}\r
To: <sip:${targetNumber}@${this.config.sip.server}>;tag=${toTag}\r
Call-ID: ${callId}\r
CSeq: ${cseq} ACK\r
Contact: <sip:${this.config.sip.username}@${this.config.sip.localIp}:${this.config.sip.localPort}>\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: 0\r
\r
`;
    }

    /**
     * Builds a SIP OPTIONS response message.
     * @param {string} callId - Unique identifier for the SIP call.
     * @param {string} fromTag - Tag for the "From" header.
     * @param {number} cseq - Sequence number for the SIP message.
     * @param {string} viaBranch - Branch parameter for the "Via" header.
     * @returns {string} - The constructed SIP OPTIONS response message.
     */
    buildOptionsResponse(callId, fromTag, cseq, viaBranch) {
        const toTag = this.generateTag();
        return `SIP/2.0 200 OK\r
Via: SIP/2.0/UDP ${this.config.sip.server};branch=${viaBranch}\r
From: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${fromTag}\r
To: <sip:${this.config.sip.username}@${this.config.sip.server}>;tag=${toTag}\r
Call-ID: ${callId}\r
CSeq: ${cseq}\r
Contact: <sip:${this.config.sip.username}@${this.config.sip.localIp}:${this.config.sip.localPort}>\r
User-Agent: ${this.config.sip.userAgent}\r
Content-Length: 0\r
\r
`;
    }

    /**
     * Generates a unique branch parameter for the "Via" header.
     * @returns {string} - The generated branch parameter.
     */
    generateBranch() {
        return 'z9hG4bK' + Math.random().toString(36).substring(2, 15);
    }

    /**
     * Generates a unique tag for the "To" or "From" header.
     * @returns {string} - The generated tag.
     */
    generateTag() {
        return Math.random().toString(36).substring(2, 15);
    }
}

module.exports = SipMessageBuilder;
