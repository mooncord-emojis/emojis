import { handleDiscordAuth, handleDiscordCallback } from './auth.js';
import { handleEmojiSubmission, handleGetFolders } from './github.js';

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        const path = url.pathname;

        // CORS headers - extract just the origin (without path) from FRONTEND_URL
        let allowedOrigin = '*';
        if (env.FRONTEND_URL) {
            const frontendUrl = new URL(env.FRONTEND_URL);
            allowedOrigin = frontendUrl.origin;
        }

        const corsHeaders = {
            'Access-Control-Allow-Origin': allowedOrigin,
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        };

        // Handle CORS preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        try {
            let response;

            // Route handling
            if (path === '/auth/discord' && request.method === 'GET') {
                response = await handleDiscordAuth(request, env);
            } else if (path === '/auth/callback' && request.method === 'GET') {
                response = await handleDiscordCallback(request, env);
            } else if (path === '/api/submit' && request.method === 'POST') {
                response = await handleEmojiSubmission(request, env);
            } else if (path === '/api/folders' && request.method === 'GET') {
                response = await handleGetFolders(request, env);
            } else if (path === '/health') {
                response = new Response(JSON.stringify({ status: 'ok' }), {
                    headers: { 'Content-Type': 'application/json' }
                });
            } else {
                response = new Response(JSON.stringify({ error: 'Not found' }), {
                    status: 404,
                    headers: { 'Content-Type': 'application/json' }
                });
            }

            // Add CORS headers to response
            const newHeaders = new Headers(response.headers);
            Object.entries(corsHeaders).forEach(([key, value]) => {
                newHeaders.set(key, value);
            });

            return new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: newHeaders
            });

        } catch (error) {
            console.error('Worker error:', error);
            return new Response(JSON.stringify({ error: 'Internal server error' }), {
                status: 500,
                headers: {
                    'Content-Type': 'application/json',
                    ...corsHeaders
                }
            });
        }
    }
};
