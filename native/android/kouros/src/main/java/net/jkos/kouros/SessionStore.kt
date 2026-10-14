package net.jkos.kouros

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import org.json.JSONObject
import java.io.File
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * AES-256-GCM under a key that lives in the Android Keystore: the key material never enters
 * this process, cannot be exported, and does not survive a backup or a device transfer. What
 * this seals is useless anywhere but on this device, in this app.
 *
 * ⚠️ THE ONLY WAY A TOKEN REACHES STORAGE. check:native fails if any other file in this module
 * writes one (SharedPreferences, a plain file): a refresh token is a 30-day credential, and a
 * copy in plain text is one root shell, adb backup or forensic image away from being somebody
 * else's session.
 */
internal class KeystoreBox(private val alias: String) {
    private fun key(): SecretKey {
        val ks = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (ks.getKey(alias, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setRandomizedEncryptionRequired(true)
                .build(),
        )
        return gen.generateKey()
    }

    /** [iv length][iv][ciphertext+tag]. The Keystore picks the IV (randomized encryption). */
    fun seal(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.ENCRYPT_MODE, key())
        val iv = c.iv
        return byteArrayOf(iv.size.toByte()) + iv + c.doFinal(plain)
    }

    /** The plaintext, or null when the blob is damaged or the key is gone (treated as signed out). */
    fun open(blob: ByteArray): ByteArray? = try {
        val n = blob[0].toInt()
        require(n in 12..16 && blob.size > 1 + n)
        val c = Cipher.getInstance(TRANSFORM)
        c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, blob, 1, n))
        c.doFinal(blob, 1 + n, blob.size - 1 - n)
    } catch (_: GeneralSecurityException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    }

    companion object {
        private const val KEYSTORE = "AndroidKeyStore"
        private const val TRANSFORM = "AES/GCM/NoPadding"
    }
}

/** What survives a restart: the refresh token and who it belongs to. Never the access token. */
internal data class StoredSession(val refreshToken: String, val user: User)

/** A sign-in in flight: the PKCE verifier and state, kept across the app being killed while
 *  the Custom Tab is in front (the redirect then starts a fresh process). */
internal data class PendingSignIn(val verifier: String, val state: String, val createdAtMs: Long)

/**
 * The two sealed files, in noBackupFilesDir — the one directory Android promises never to
 * back up, on top of allowBackup="false" and the data-extraction rules. Each write is atomic
 * (AtomicFile): a rotated refresh token half-written is a signed-out phone, because the old
 * token is already spent on the server.
 */
internal class SessionStore(context: Context) {
    private val dir = context.noBackupFilesDir
    private val box = KeystoreBox("net.jkos.kouros.session")

    private fun write(name: String, json: JSONObject) {
        val f = AtomicFile(File(dir, name))
        val out = f.startWrite()
        try {
            out.write(box.seal(json.toString().toByteArray(Charsets.UTF_8)))
            f.finishWrite(out)
        } catch (e: Exception) {
            f.failWrite(out)
            throw e
        }
    }

    private fun read(name: String): JSONObject? {
        val file = File(dir, name)
        if (!file.exists()) return null
        val plain = try {
            box.open(AtomicFile(file).readFully())
        } catch (_: java.io.IOException) {
            null
        } ?: run {
            AtomicFile(file).delete()
            return null
        }
        return try {
            JSONObject(String(plain, Charsets.UTF_8))
        } catch (_: org.json.JSONException) {
            null
        }
    }

    fun readSession(): StoredSession? = read(SESSION)?.let {
        try {
            StoredSession(it.getString("refresh_token"), Models.user(it.getJSONObject("user")))
        } catch (_: org.json.JSONException) {
            null
        }
    }

    fun writeSession(refreshToken: String, user: User) = write(
        SESSION,
        JSONObject()
            .put("refresh_token", refreshToken)
            .put("user", JSONObject().put("id", user.id).put("email", user.email).put("name", user.name ?: JSONObject.NULL).put("role", user.role)),
    )

    fun clearSession() = AtomicFile(File(dir, SESSION)).delete()

    fun readPending(): PendingSignIn? = read(PENDING)?.let {
        try {
            PendingSignIn(it.getString("verifier"), it.getString("state"), it.getLong("created"))
        } catch (_: org.json.JSONException) {
            null
        }
    }

    fun writePending(p: Pkce, nowMs: Long) =
        write(PENDING, JSONObject().put("verifier", p.verifier).put("state", p.state).put("created", nowMs))

    fun clearPending() = AtomicFile(File(dir, PENDING)).delete()

    companion object {
        private const val SESSION = "session.bin"
        private const val PENDING = "pending.bin"
    }
}
