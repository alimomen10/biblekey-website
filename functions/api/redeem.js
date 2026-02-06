// Cloudflare Pages Function: POST /api/redeem
// Uses KV namespace "PROMO" to store code state
//
// KV keys:
//   "codes"       → JSON array of all promo codes (set once via /api/admin)
//   "claimed_count" → number of codes given out so far
//   "claim:<email>" → JSON { code, name, email, claimedAt } (one per email)

const CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json",
            ...CORS_HEADERS,
        },
    });
}

// GET /api/redeem — returns remaining count
export async function onRequestGet(context) {
    const { env } = context;
    const KV = env.PROMO;

    const codesJson = await KV.get("codes");
    if (!codesJson) {
        return jsonResponse({ total: 0, claimed: 0, remaining: 0 });
    }

    const codes = JSON.parse(codesJson);
    const claimedCount = parseInt(await KV.get("claimed_count") || "0", 10);
    const remaining = Math.max(0, codes.length - claimedCount);

    return jsonResponse({
        total: codes.length,
        claimed: claimedCount,
        remaining,
    });
}

// POST /api/redeem — claim a code
export async function onRequestPost(context) {
    const { request, env } = context;
    const KV = env.PROMO;

    let body;
    try {
        body = await request.json();
    } catch {
        return jsonResponse({ error: "Invalid JSON body" }, 400);
    }

    const name = (body.name || "").trim();
    const email = (body.email || "").trim().toLowerCase();

    if (!name || !email || !email.includes("@") || !email.includes(".")) {
        return jsonResponse({ error: "Please provide a valid name and email." }, 400);
    }

    // Check if this email already claimed
    const existingClaim = await KV.get(`claim:${email}`);
    if (existingClaim) {
        const claim = JSON.parse(existingClaim);
        return jsonResponse({
            status: "already_claimed",
            code: claim.code,
            name: claim.name,
        });
    }

    // Get all codes
    const codesJson = await KV.get("codes");
    if (!codesJson) {
        return jsonResponse({ error: "No promo codes available.", status: "exhausted" }, 200);
    }

    const codes = JSON.parse(codesJson);

    // Atomically claim the next code
    // KV doesn't have true atomic increment, but for ~100 codes this race window is tiny
    const claimedCount = parseInt(await KV.get("claimed_count") || "0", 10);

    if (claimedCount >= codes.length) {
        return jsonResponse({ status: "exhausted" });
    }

    const code = codes[claimedCount];
    const newCount = claimedCount + 1;

    // Store the claim
    const claim = {
        code,
        name,
        email,
        claimedAt: new Date().toISOString(),
        index: claimedCount,
    };

    await KV.put(`claim:${email}`, JSON.stringify(claim));
    await KV.put("claimed_count", newCount.toString());

    return jsonResponse({
        status: "success",
        code,
        remaining: codes.length - newCount,
        total: codes.length,
    });
}

// OPTIONS — CORS preflight
export async function onRequestOptions() {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
}
