function validateSecrets() {
    const names = ["JWT_SECRET", "BACKUP_ENCRYPTION_KEY", "MAIL_CREDENTIAL_KEY"];
    for (const name of names) {
        const value = String(process.env[name] || "");
        if (value.length < 32 || /^replace-with/i.test(value)) {
            throw new Error(`${name} must be set to a unique random value of at least 32 characters.`);
        }
    }
    if (new Set(names.map((name) => process.env[name])).size !== names.length) {
        throw new Error("JWT_SECRET, BACKUP_ENCRYPTION_KEY, and MAIL_CREDENTIAL_KEY must use different values.");
    }
}

module.exports = { validateSecrets };
