package com.rpmdelivery.courier.auth

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import io.github.jan.supabase.auth.CodeVerifierCache
import io.github.jan.supabase.auth.SessionManager
import io.github.jan.supabase.auth.user.UserSession
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

interface SecretStore {
    suspend fun read(name: String): String?
    suspend fun write(name: String, value: String)
    suspend fun remove(name: String)
}

/** AES-GCM with a non-exportable Android Keystore key, app-private/noBackup files. */
class ProtectedStorage(context: Context) : SecretStore {
    private val directory = File(context.noBackupFilesDir, "courier-auth-v1")
    private val lock = Any()
    private fun file(name: String): AtomicFile {
        require(name == "session" || name == "pkce")
        check(directory.exists() || directory.mkdirs())
        return AtomicFile(File(directory, name))
    }
    private fun key(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey("rpm-courier-auth-v1", null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder("rpm-courier-auth-v1", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setRandomizedEncryptionRequired(true).build())
        }.generateKey()
    }
    override suspend fun read(name: String): String? = withContext(Dispatchers.IO) {
        synchronized(lock) {
            val source = file(name)
            if (!source.baseFile.exists()) return@synchronized null
            val bytes = source.readFully()
            SessionCipher.open(key(), name, bytes)
        }
    }
    override suspend fun write(name: String, value: String) = withContext(Dispatchers.IO) {
        synchronized(lock) {
            val bytes = SessionCipher.seal(key(), name, value)
            val target = file(name)
            val stream = target.startWrite()
            try { stream.write(bytes); target.finishWrite(stream) }
            catch (error: Exception) { target.failWrite(stream); throw error }
        }
    }
    override suspend fun remove(name: String) = withContext(Dispatchers.IO) {
        synchronized(lock) {
            val target = file(name)
            target.delete()
            check(!target.baseFile.exists())
        }
    }
}

internal object SessionCipher {
    fun seal(key: SecretKey, name: String, value: String): ByteArray {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, key)
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        return cipher.iv + cipher.doFinal(value.toByteArray(Charsets.UTF_8))
    }
    fun open(key: SecretKey, name: String, bytes: ByteArray): String {
        require(bytes.size > 28)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
        cipher.updateAAD(name.toByteArray(Charsets.UTF_8))
        return String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8)
    }
}

class ProtectedSessionManager(private val store: SecretStore) : SessionManager {
    override suspend fun saveSession(session: UserSession) = store.write("session", Json.encodeToString(UserSession.serializer(), session))
    override suspend fun loadSession(): UserSession = store.read("session")?.let {
        Json.decodeFromString(UserSession.serializer(), it)
    } ?: error("No stored session")
    override suspend fun loadSessionOrNull(): UserSession? = store.read("session")?.let {
        Json.decodeFromString(UserSession.serializer(), it)
    }
    override suspend fun deleteSession() = store.remove("session")
}

class ProtectedVerifierCache(private val store: SecretStore, private val now: () -> Long = System::currentTimeMillis) : CodeVerifierCache {
    override suspend fun saveCodeVerifier(codeVerifier: String) = store.write("pkce", "${now()}\n$codeVerifier")
    override suspend fun loadCodeVerifier(): String? {
        val parts = store.read("pkce")?.split('\n', limit = 2) ?: return null
        val timestamp = parts.first().toLongOrNull() ?: return null
        if (parts.size != 2 || now() - timestamp !in 0..86_400_000) { deleteCodeVerifier(); return null }
        return parts[1]
    }
    override suspend fun deleteCodeVerifier() = store.remove("pkce")
}
