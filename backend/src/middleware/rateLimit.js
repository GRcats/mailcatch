const attempts = new Map();

function authRateLimit(req, res, next) {
    const key = req.ip || req.socket.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (attempts.get(key) || []).filter((time) => now - time < 10 * 60 * 1000);
    if (recent.length >= 20) return res.status(429).json({ message: "로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요." });
    recent.push(now);
    attempts.set(key, recent);
    next();
}

module.exports = { authRateLimit };
