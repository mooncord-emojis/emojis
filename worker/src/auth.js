import { SignJWT, jwtVerify } from 'jose';

const DISCORD_API_BASE = 'https://discord.com/api/v10';

// Redirect to Discord OAuth
export async function handleDiscordAuth(request, env) {
    const url = new URL(request.url);
    const redirectUrl = url.searchParams.get('redirect') || env.FRONTEND_URL;

    // Store redirect URL in state parameter
    const state = btoa(JSON.stringify({ redirect: redirectUrl }));

    const params = new URLSearchParams({
        client_id: env.DISCORD_CLIENT_ID,
        redirect_uri: getCallbackUrl(request),
        response_type: 'code',
        scope: 'identify guilds',
        state: state
    });

    const discordAuthUrl = `${DISCORD_API_BASE}/oauth2/authorize?${params.toString()}`;

    return Response.redirect(discordAuthUrl, 302);
}

// Handle Discord OAuth callback
export async function handleDiscordCallback(request, env) {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    // Parse state to get redirect URL
    let redirectUrl = env.FRONTEND_URL;
    if (state) {
        try {
            const stateData = JSON.parse(atob(state));
            redirectUrl = stateData.redirect || env.FRONTEND_URL;
        } catch (e) {
            console.error('Failed to parse state:', e);
        }
    }

    // Handle OAuth errors
    if (error) {
        return Response.redirect(`${redirectUrl}?error=${encodeURIComponent(error)}`, 302);
    }

    if (!code) {
        return Response.redirect(`${redirectUrl}?error=no_code`, 302);
    }

    try {
        // Exchange code for access token
        const tokenResponse = await fetch(`${DISCORD_API_BASE}/oauth2/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: new URLSearchParams({
                client_id: env.DISCORD_CLIENT_ID,
                client_secret: env.DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code: code,
                redirect_uri: getCallbackUrl(request)
            })
        });

        if (!tokenResponse.ok) {
            const errorData = await tokenResponse.text();
            console.error('Token exchange failed:', errorData);
            return Response.redirect(`${redirectUrl}?error=token_exchange_failed`, 302);
        }

        const tokenData = await tokenResponse.json();
        const accessToken = tokenData.access_token;

        // Get user info
        const userResponse = await fetch(`${DISCORD_API_BASE}/users/@me`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!userResponse.ok) {
            return Response.redirect(`${redirectUrl}?error=user_fetch_failed`, 302);
        }

        const userData = await userResponse.json();

        // Get user's guilds (servers)
        const guildsResponse = await fetch(`${DISCORD_API_BASE}/users/@me/guilds`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!guildsResponse.ok) {
            return Response.redirect(`${redirectUrl}?error=guilds_fetch_failed`, 302);
        }

        const guilds = await guildsResponse.json();

        // Check if user is a member of the required server
        const requiredServerId = env.DISCORD_SERVER_ID;
        const isMember = guilds.some(guild => guild.id === requiredServerId);

        if (!isMember) {
            return Response.redirect(`${redirectUrl}?error=not_a_member`, 302);
        }

        // Create JWT token
        const username = userData.global_name || userData.username;
        const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);

        const token = await new SignJWT({
            discordId: userData.id,
            username: username
        })
            .setProtectedHeader({ alg: 'HS256' })
            .setIssuedAt()
            .setExpirationTime('1h')
            .sign(jwtSecret);

        // Redirect back to frontend with token
        const successUrl = `${redirectUrl}?token=${encodeURIComponent(token)}&username=${encodeURIComponent(username)}`;
        return Response.redirect(successUrl, 302);

    } catch (error) {
        console.error('OAuth callback error:', error);
        return Response.redirect(`${redirectUrl}?error=internal_error`, 302);
    }
}

// Verify JWT token from request
export async function verifyAuthToken(request, env) {
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.substring(7);

    try {
        const jwtSecret = new TextEncoder().encode(env.JWT_SECRET);
        const { payload } = await jwtVerify(token, jwtSecret);
        return payload;
    } catch (error) {
        console.error('JWT verification failed:', error);
        return null;
    }
}

// Get the callback URL for this worker
function getCallbackUrl(request) {
    const url = new URL(request.url);
    return `${url.origin}/auth/callback`;
}
