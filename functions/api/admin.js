// Cloudflare Pages Function: POST /api/admin
// Protected endpoint to load promo codes into KV
//
// Usage: POST /api/admin with JSON body:
// {
//   "secret": "<your admin secret>",
//   "action": "load_codes",
//   "codes": ["CODE1", "CODE2", ...]
// }
//
// Or to check status:
// {
//   "secret": "<your admin secret>",
//   "action": "status"
// }
//
// Or to view all claims:
// {
//   "secret": "<your admin secret>",
//   "action": "claims"
// }
//
// Set the ADMIN_SECRET environment variable in Cloudflare Pages settings.

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data, null, 2), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
        },
    });
}

export async function onRequestPost(context) {
    const { request, env } = context;
    const KV = env.PROMO;

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    // Verify admin secret
    const adminSecret = env.ADMIN_SECRET;
    if (!adminSecret || body.secret !== adminSecret) {
        return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const action = body.action;

    if (action === "load_codes") {
        const codes = body.codes;
        if (!Array.isArray(codes) || codes.length === 0) {
            return jsonResponse({ error: "Provide a 'codes' array" }, 400);
        }

        // Store codes
        await KV.put("codes", JSON.stringify(codes));

        // Reset claimed count if specified, otherwise preserve it
        if (body.reset) {
            await KV.put("claimed_count", "0");
        }

        const claimedCount = parseInt(await KV.get("claimed_count") || "0", 10);

        return jsonResponse({
            success: true,
            totalCodes: codes.length,
            claimedSoFar: claimedCount,
            remaining: codes.length - claimedCount,
        });
    }

    if (action === "status") {
        const codesJson = await KV.get("codes");
        const codes = codesJson ? JSON.parse(codesJson) : [];
        const claimedCount = parseInt(await KV.get("claimed_count") || "0", 10);

        return jsonResponse({
            totalCodes: codes.length,
            claimed: claimedCount,
            remaining: codes.length - claimedCount,
        });
    }

    if (action === "claims") {
        // List all claims (iterate KV keys with prefix "claim:")
        const list = await KV.list({ prefix: "claim:" });
        const claims = [];

        for (const key of list.keys) {
            const val = await KV.get(key.name);
            if (val) {
                claims.push(JSON.parse(val));
            }
        }

        // Sort by claimed time
        claims.sort((a, b) => new Date(a.claimedAt) - new Date(b.claimedAt));

        return jsonResponse({
            totalClaims: claims.length,
            claims,
        });
    }

    return jsonResponse({ error: "Unknown action. Use: load_codes, status, claims" }, 400);
}

export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
