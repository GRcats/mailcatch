const test = require("node:test");
const assert = require("node:assert/strict");
const { normalizeClientIp } = require("../src/domain/clientIp");

test("IPv4 매핑 IPv6 주소를 IPv4로 정규화한다", () => {
    assert.equal(normalizeClientIp("::ffff:192.168.0.10"), "192.168.0.10");
});

test("IPv6 루프백 주소를 IPv4 루프백으로 정규화한다", () => {
    assert.equal(normalizeClientIp("::1"), "127.0.0.1");
});
