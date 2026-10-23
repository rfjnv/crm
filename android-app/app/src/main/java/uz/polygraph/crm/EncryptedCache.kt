package uz.polygraph.crm

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.webkit.JavascriptInterface
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.security.KeyStore
import java.util.zip.GZIPInputStream
import java.util.zip.GZIPOutputStream
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Кэш данных CRM для фронта (frontend/src/lib/appCache.ts), доступен в JS как window.PolygraphNative.
 * Файл лежит во внутренней папке приложения и зашифрован AES-GCM ключом из Android Keystore:
 * ключ не извлекается из телефона, так что скопированный файл без него не прочитать.
 *
 * [isAllowed] не даёт читать кэш странице с чужого адреса.
 */
class EncryptedCache(context: Context, private val isAllowed: () -> Boolean) {

    private val file = AtomicFile(File(context.noBackupFilesDir, "query-cache.bin"))
    private val lock = Any()

    @JavascriptInterface
    fun read(): String? {
        if (!isAllowed()) return null
        return synchronized(lock) {
            try {
                val bytes = file.readFully()
                val cipher = Cipher.getInstance(TRANSFORMATION)
                cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes, 0, IV_SIZE))
                val plain = cipher.doFinal(bytes, IV_SIZE, bytes.size - IV_SIZE)
                GZIPInputStream(ByteArrayInputStream(plain)).use { it.readBytes().toString(Charsets.UTF_8) }
            } catch (_: java.io.FileNotFoundException) {
                null
            } catch (_: Exception) {
                // Файл повреждён или ключ сменился — начинаем с чистого кэша.
                file.delete()
                null
            }
        }
    }

    @JavascriptInterface
    fun write(data: String) {
        if (!isAllowed()) return
        val packed = ByteArrayOutputStream().also { out ->
            GZIPOutputStream(out).use { it.write(data.toByteArray(Charsets.UTF_8)) }
        }.toByteArray()
        synchronized(lock) {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, key())
            val encrypted = cipher.doFinal(packed)
            val stream = file.startWrite()
            try {
                stream.write(cipher.iv)
                stream.write(encrypted)
                file.finishWrite(stream)
            } catch (e: Exception) {
                file.failWrite(stream)
            }
        }
    }

    @JavascriptInterface
    fun clear() {
        if (!isAllowed()) return
        synchronized(lock) { file.delete() }
    }

    private fun key(): SecretKey {
        val store = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as SecretKey?)?.let { return it }
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE).apply {
            init(
                KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setKeySize(256)
                    .build(),
            )
        }.generateKey()
    }

    private companion object {
        const val KEYSTORE = "AndroidKeyStore"
        const val KEY_ALIAS = "crm-query-cache"
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val IV_SIZE = 12
    }
}
