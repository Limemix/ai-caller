module.exports = {
    sip: {
        server: 'pbx.zadarma.com',
        port: 5060,
        username: '528107-101',
        password: 'JedP72cyUF',
        localPort: 5080,
        localIp: process.env.LOCAL_IP || '0.0.0.0',
        userAgent: 'Titan Dnipro/Call2Telegram'
    },
    audio: {
        sampleRate: 8000,
        bitsPerSample: 8,
        channels: 1,
        packetSize: 320, 
        packetInterval: 20,
        geminiSampleRate: 24000
    }
};