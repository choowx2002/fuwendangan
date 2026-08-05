package com.tian_yue.fuwendangan

import android.app.Activity
import android.net.Uri
import android.util.Base64
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

/**
 * Storage Access Framework 读写插件。
 *
 * Android 的 save()/open() 对话框返回 content:// URI（SAF），Rust 端 std::fs 无法打开，
 * 需借助 ContentResolver 读写。供 lib.rs 中的 write_text_file / read_text_file /
 * copy_file / read_image_file 命令在遇到 content:// URI 时调用。
 */

@InvokeArg
class SAFWriteArgs {
  lateinit var uri: String
  var content: String? = null
}

@InvokeArg
class SAFReadArgs {
  lateinit var uri: String
}

@TauriPlugin
class SAFPlugin(private val activity: Activity) : Plugin(activity) {

  @Command
  fun writeText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SAFWriteArgs::class.java)
      val bytes = args.content?.toByteArray(Charsets.UTF_8) ?: ByteArray(0)
      writeToUri(args.uri, bytes)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "writeText failed", e)
    }
  }

  @Command
  fun writeBytes(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SAFWriteArgs::class.java)
      val base64 = args.content ?: ""
      val bytes = Base64.decode(base64, Base64.DEFAULT)
      writeToUri(args.uri, bytes)
      invoke.resolve()
    } catch (e: Exception) {
      invoke.reject(e.message ?: "writeBytes failed", e)
    }
  }

  @Command
  fun readText(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SAFReadArgs::class.java)
      val text = readFromUri(args.uri).toString(Charsets.UTF_8)
      invoke.resolveObject(text)
    } catch (e: Exception) {
      invoke.reject(e.message ?: "readText failed", e)
    }
  }

  @Command
  fun readBytes(invoke: Invoke) {
    try {
      val args = invoke.parseArgs(SAFReadArgs::class.java)
      val bytes = readFromUri(args.uri)
      val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
      invoke.resolveObject(base64)
    } catch (e: Exception) {
      invoke.reject(e.message ?: "readBytes failed", e)
    }
  }

  private fun writeToUri(uri: String, bytes: ByteArray) {
    val output = activity.contentResolver.openOutputStream(Uri.parse(uri)) ?: throw Exception("无法打开目标文件 (content uri)")
    output.use { it.write(bytes) }
  }

  private fun readFromUri(uri: String): ByteArray {
    val input = activity.contentResolver.openInputStream(Uri.parse(uri)) ?: throw Exception("无法打开源文件 (content uri)")
    return input.use { it.readBytes() }
  }
}