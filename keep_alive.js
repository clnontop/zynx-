const express = require('express');
const app = express();
const PORT = process.env.PORT || 8080;

// Track uptime
const startTime = Date.now();

// Home route with status page
app.get('/', (req, res) => {
    const uptime = Math.floor((Date.now() - startTime) / 1000);
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);
    const seconds = uptime % 60;

    res.send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Zynx Bot - Status</title>
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                    min-height: 100vh;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: white;
                }
                .container {
                    background: rgba(255, 255, 255, 0.1);
                    backdrop-filter: blur(10px);
                    border-radius: 20px;
                    padding: 40px;
                    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
                    text-align: center;
                    max-width: 500px;
                    width: 90%;
                }
                h1 {
                    font-size: 2.5em;
                    margin-bottom: 10px;
                    text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
                }
                .status {
                    display: inline-flex;
                    align-items: center;
                    gap: 10px;
                    background: rgba(0, 255, 0, 0.2);
                    padding: 10px 20px;
                    border-radius: 50px;
                    margin: 20px 0;
                }
                .status-dot {
                    width: 12px;
                    height: 12px;
                    background: #00ff00;
                    border-radius: 50%;
                    animation: pulse 2s infinite;
                }
                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
                .info {
                    background: rgba(255, 255, 255, 0.1);
                    border-radius: 10px;
                    padding: 20px;
                    margin-top: 20px;
                }
                .info-item {
                    display: flex;
                    justify-content: space-between;
                    padding: 10px 0;
                    border-bottom: 1px solid rgba(255, 255, 255, 0.2);
                }
                .info-item:last-child { border-bottom: none; }
                .label { opacity: 0.8; }
                .value { font-weight: bold; }
                .footer {
                    margin-top: 20px;
                    opacity: 0.7;
                    font-size: 0.9em;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>🤖 Zynx Bot</h1>
                <div class="status">
                    <div class="status-dot"></div>
                    <span>Online & Running</span>
                </div>
                <div class="info">
                    <div class="info-item">
                        <span class="label">Uptime:</span>
                        <span class="value">${hours}h ${minutes}m ${seconds}s</span>
                    </div>
                    <div class="info-item">
                        <span class="label">Server:</span>
                        <span class="value">Render</span>
                    </div>
                    <div class="info-item">
                        <span class="label">Type:</span>
                        <span class="value">Discord Ticket Bot</span>
                    </div>
                    <div class="info-item">
                        <span class="label">Auto-Ping:</span>
                        <span class="value">✅ Active</span>
                    </div>
                </div>
                <div class="footer">
                    Keep-Alive System Active 🟢
                </div>
            </div>
        </body>
        </html>
    `);
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor((Date.now() - startTime) / 1000),
        timestamp: new Date().toISOString()
    });
});

// Ping endpoint
app.get('/ping', (req, res) => {
    res.send('Pong! 🏓');
});

// Start server
app.listen(PORT, () => {
    console.log(`✅ Keep-Alive server running on port ${PORT}`);
    console.log(`🌐 Server URL: http://localhost:${PORT}`);
});

// Self-ping function to keep the bot alive
function selfPing() {
    const url = process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`;

    // Only ping if we have a Render URL (in production)
    if (process.env.RENDER_EXTERNAL_URL) {
        const https = require('https');
        const http = require('http');
        const protocol = url.startsWith('https') ? https : http;

        protocol.get(url + '/health', (res) => {
            console.log(`🔄 Self-ping successful - Status: ${res.statusCode}`);
        }).on('error', (err) => {
            console.error('❌ Self-ping failed:', err.message);
        });
    }
}

// Ping every 5 minutes (300000ms) to prevent sleeping
setInterval(selfPing, 5 * 60 * 1000);

// Initial ping after 1 minute
setTimeout(selfPing, 60000);

module.exports = app;
