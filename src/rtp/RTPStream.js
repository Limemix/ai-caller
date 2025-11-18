const dgram = require('dgram');
const Logger = require('../utils/Logger');

class RTPStream {
    constructor(config) {
        this.config = config;
        this.logger = new Logger();
        this.rtpSockets = new Map();
        this.audioIntervals = new Map();
    }

    async createRtpSocket() {
        return new Promise((resolve, reject) => {
            const socket = dgram.createSocket('udp4');
            let port = 0;

            socket.on('listening', () => {
                port = socket.address().port;
                this.rtpSockets.set(port, socket);
                this.logger.debug(`🔊 RTP socket listening on port ${port}`);
                resolve(port);
            });

            socket.on('error', (err) => {
                this.logger.error('RTP socket error:', err);
                reject(err);
            });

            socket.bind(0, this.config.sip.localIp);
        });
    }

    /**
     * Запускает непрерывный тон на протяжении всего звонка
     */
    startContinuousTone(localPort, remoteIp, remotePort, frequency = 440) {
        const socket = this.rtpSockets.get(localPort);
        if (!socket) {
            throw new Error(`RTP socket not found for port ${localPort}`);
        }
        this.logger.info(`🫀 RTP keep-alive enabled: sending packets every ${this.config.audio.packetInterval}ms`);

        this.logger.info(`🔊 Starting continuous ${frequency}Hz tone to ${remoteIp}:${remotePort}`);

        let sequenceNumber = 0;
        const packetSize = this.config.audio.packetSize;
        const sampleRate = this.config.audio.sampleRate;
        const generateTonePacket = (seqNum) => {
            const buffer = Buffer.alloc(12 + packetSize);

            buffer[0] = 0x80;
            buffer[1] = 0x00 | 0x08; 
            buffer[2] = (seqNum >> 8) & 0xFF;
            buffer[3] = seqNum & 0xFF;
            const timestamp = seqNum * packetSize * (8000 / sampleRate);
            buffer[4] = (timestamp >> 24) & 0xFF;
            buffer[5] = (timestamp >> 16) & 0xFF;
            buffer[6] = (timestamp >> 8) & 0xFF;
            buffer[7] = timestamp & 0xFF;
            const ssrc = 0x12345678;
            buffer[8] = (ssrc >> 24) & 0xFF;
            buffer[9] = (ssrc >> 16) & 0xFF;
            buffer[10] = (ssrc >> 8) & 0xFF;
            buffer[11] = ssrc & 0xFF;

            const amplitude = 0.7; // громкость (0.0 - 1.0)
            for (let i = 0; i < packetSize; i++) {
                const time = (seqNum * packetSize + i) / sampleRate;
                const sample = Math.sin(2 * Math.PI * frequency * time) * amplitude;
                const pcma = this.linearToALaw(sample);
                buffer[12 + i] = pcma;
            }

            return buffer;
        };

        const interval = setInterval(() => {
            try {
                const rtpPacket = generateTonePacket(sequenceNumber);
                socket.send(rtpPacket, 0, rtpPacket.length, remotePort, remoteIp, (err) => {
                    if (err) {
                        this.logger.error('Error sending RTP packet:', err);
                    }
                });
                sequenceNumber = (sequenceNumber + 1) % 65536;
            } catch (error) {
                this.logger.error('Error generating/sending tone packet:', error);
            }
        }, this.config.audio.packetInterval);

        this.audioIntervals.set(localPort, interval);

        return () => {
            this.stopAudio(localPort);
        };
    }

    linearToALaw(sample) {
        const pcm = Math.max(-32768, Math.min(32767, Math.floor(sample * 32767)));

        const sign = (pcm < 0) ? 0x80 : 0x00;
        let absPcm = Math.abs(pcm);

        if (absPcm < 32) {
            return sign | 0x70 | (absPcm >> 1);
        } else if (absPcm < 64) {
            return sign | 0x60 | (absPcm >> 2);
        } else if (absPcm < 128) {
            return sign | 0x50 | (absPcm >> 3);
        } else if (absPcm < 256) {
            return sign | 0x40 | (absPcm >> 4);
        } else if (absPcm < 512) {
            return sign | 0x30 | (absPcm >> 5);
        } else if (absPcm < 1024) {
            return sign | 0x20 | (absPcm >> 6);
        } else if (absPcm < 2048) {
            return sign | 0x10 | (absPcm >> 7);
        } else if (absPcm < 4096) {
            return sign | 0x00 | (absPcm >> 8);
        } else {
            return sign | 0x00 | (4095 >> 8); 
        }
    }

    stopAudio(localPort) {
        const interval = this.audioIntervals.get(localPort);
        if (interval) {
            clearInterval(interval);
            this.audioIntervals.delete(localPort);
            this.logger.info(`Stopped audio for port ${localPort}`);
        }
    }

    destroy() {
        for (const [port, interval] of this.audioIntervals) {
            clearInterval(interval);
        }
        this.audioIntervals.clear();

        for (const [port, socket] of this.rtpSockets) {
            socket.close();
        }
        this.rtpSockets.clear();
    }
}

module.exports = RTPStream;