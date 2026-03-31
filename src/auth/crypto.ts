import crypto from "crypto";
import { config } from "../config";

// We need a stable 32-byte key for AES-256. 
// We will derive it from the JWT_SECRET or a dedicated ENCRYPTION_KEY if provided.
function getEncryptionKey(): Buffer {
    const rawSecret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || "fallback-secret-key-must-be-min-32-chars-long";
    return crypto.createHash("sha256").update(String(rawSecret)).digest();
}

/**
 * Encrypts a plain text string using AES-256-GCM.
 * Returns a hex string containing: iv:authTag:encryptedData
 */
export function encryptText(text: string): string {
    if (!text) return text;
    
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(12); // 96-bit IV recommended for GCM
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    
    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag().toString("hex");
    
    // Format: iv:authTag:encryptedValue
    return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a hex string formatted as iv:authTag:encryptedData created by encryptText.
 */
export function decryptText(encryptedBlob: string): string {
    if (!encryptedBlob || !encryptedBlob.includes(":")) return encryptedBlob;
    
    const parts = encryptedBlob.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid encrypted data format");
    }
    
    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
}
