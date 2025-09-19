import { createServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import fetch from 'node-fetch';
import 'dotenv/config';

const PORT = 3001;
const GLADIA_API_URL = 'https://api.gladia.io/v2/live';

const server = createServer();
const wss = new WebSocketServer({ server });

console.log('Starting STT WebSocket proxy server...');

wss.on('connection', (clientWs) => {
    console.log('Client connected to proxy');

    let gladiaWs: WebSocket | null = null;

    const gladiaApiKey = process.env.GLADIA_API_KEY;
    if (!gladiaApiKey) {
        console.error("GLADIA_API_KEY environment variable not set!");
        clientWs.close(1011, "Server configuration error: Gladia API key not found.");
        return;
    }

    const startGladiaConnection = async (config: { sample_rate: number, languages: string[] }) => {
        try {
            // 1. Get a tokenized WebSocket URL from Gladia REST API
            console.log('Requesting Gladia audio URL with languages:', config.languages);
            const response = await fetch(GLADIA_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-gladia-key': gladiaApiKey,
                },
                body: JSON.stringify({
                    sample_rate: config.sample_rate,
                    encoding: 'wav/pcm',
                    bit_depth: 16,
                    channels: 1,
                    model: 'solaria-1',
                    language_config: {
                        languages: config.languages,
                        code_switching: config.languages.length > 1,
                    },
                    messages_config: {
                        receive_partial_transcripts: true,
                    },
                }),
            });

            if (!response.ok) {
                const errorBody = await response.text();
                throw new Error(`Failed to get Gladia URL: ${response.status} ${response.statusText} - ${errorBody}`);
            }

            const data = await response.json() as { url?: string };
            console.log("Full response from Gladia:", data);
            const gladiaWsUrl = data.url;

            if (!gladiaWsUrl) {
                throw new Error('No url in Gladia response');
            }

            console.log('Got Gladia URL, connecting to WebSocket...');

            // 2. Connect to the tokenized WebSocket URL
            gladiaWs = new WebSocket(gladiaWsUrl);

            gladiaWs.onopen = () => {
                console.log('Proxy connected to Gladia WebSocket');
                // Notify the client that we are ready to receive audio
                clientWs.send(JSON.stringify({ status: 'ready' }));
            };

            gladiaWs.onmessage = (event) => {
                clientWs.send(event.data.toString());
            };

            gladiaWs.onerror = (error) => {
                console.error('Gladia WebSocket error:', error);
                clientWs.close();
            };

            gladiaWs.onclose = (event) => {
                console.log('Gladia connection closed:', event.code, event.reason);
                clientWs.close();
            };

        } catch (error) {
            console.error('Error starting Gladia connection:', error);
            clientWs.close(1011, 'Failed to connect to transcription service.');
        }
    };

    // Handle messages from the client
    clientWs.onmessage = (event) => {
        const message = event.data.toString();
        const data = JSON.parse(message);

        if (data.sample_rate && data.languages) {
            // This is the first message from the client with config
            console.log("Received config from client:", data);
            startGladiaConnection(data);
        } else if (gladiaWs && gladiaWs.readyState === WebSocket.OPEN) {
            // These are subsequent audio frames
            gladiaWs.send(message);
        }
    };

    clientWs.onclose = () => {
        console.log('Client disconnected from proxy');
        if (gladiaWs && gladiaWs.readyState === WebSocket.OPEN) {
            gladiaWs.close();
        }
    };
});

server.listen(PORT, () => {
    console.log(`STT WebSocket proxy server listening on port ${PORT}`);
});