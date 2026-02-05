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
    let isClientConnected = true;
    let abortController: AbortController | null = null;

    const gladiaApiKey = process.env.GLADIA_API_KEY;
    if (!gladiaApiKey) {
        console.error("GLADIA_API_KEY environment variable not set!");
        clientWs.close(1011, "Server configuration error: Gladia API key not found.");
        return;
    }

    const cleanup = () => {
        isClientConnected = false;
        
        // 진행 중인 fetch 요청 취소
        if (abortController) {
            abortController.abort();
            abortController = null;
        }
        
        // Gladia WebSocket 연결 정리 (모든 상태에서)
        if (gladiaWs) {
            if (gladiaWs.readyState === WebSocket.OPEN || gladiaWs.readyState === WebSocket.CONNECTING) {
                gladiaWs.close();
            }
            gladiaWs = null;
        }
    };

    const startGladiaConnection = async (config: { sample_rate: number, languages: string[] }) => {
        try {
            // AbortController 생성
            abortController = new AbortController();
            
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
                signal: abortController.signal,
            });

            // 클라이언트가 이미 떠났으면 연결 진행하지 않음
            if (!isClientConnected) {
                console.log('Client already disconnected, aborting Gladia connection');
                return;
            }

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

            // 다시 한번 클라이언트 상태 확인
            if (!isClientConnected) {
                console.log('Client already disconnected, aborting Gladia WebSocket connection');
                return;
            }

            console.log('Got Gladia URL, connecting to WebSocket...');

            // 2. Connect to the tokenized WebSocket URL
            gladiaWs = new WebSocket(gladiaWsUrl);

            gladiaWs.onopen = () => {
                console.log('Proxy connected to Gladia WebSocket');
                if (isClientConnected) {
                    // Notify the client that we are ready to receive audio
                    clientWs.send(JSON.stringify({ status: 'ready' }));
                } else {
                    // 클라이언트가 이미 떠났으면 Gladia 연결도 닫기
                    gladiaWs?.close();
                }
            };

            gladiaWs.onmessage = (event) => {
                if (isClientConnected) {
                    clientWs.send(event.data.toString());
                }
            };

            gladiaWs.onerror = (error) => {
                console.error('Gladia WebSocket error:', error);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

            gladiaWs.onclose = (event) => {
                console.log('Gladia connection closed:', event.code, event.reason);
                if (isClientConnected) {
                    clientWs.close();
                }
            };

        } catch (error) {
            // AbortError는 정상적인 취소이므로 무시
            if (error instanceof Error && error.name === 'AbortError') {
                console.log('Gladia connection request was aborted');
                return;
            }
            console.error('Error starting Gladia connection:', error);
            if (isClientConnected) {
                clientWs.close(1011, 'Failed to connect to transcription service.');
            }
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
        cleanup();
    };
});

server.listen(PORT, () => {
    console.log(`STT WebSocket proxy server listening on port ${PORT}`);
});