package app.onstandard.rollcall

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * OnStandard — taps recorded while JS was not running, Android half.
 *
 * The mirror of iOS's `RollCallPendingStore`, and it exists for the same reason: the alarm screen
 * and the notification action run in a process slice with no access to the signed ack code or the
 * retry queue, both of which live in JS (`src/core/rollcall.ts`). So the native side records the
 * FACT of the tap and nothing else, and JS drains it on the next launch or foreground and feeds it
 * through the one queue that already knows how to retry, dedupe and give up.
 *
 * SharedPreferences rather than a database: one small additive write, on a path that must not do
 * real I/O.
 */
object RollCallPendingTaps {
  private const val PREFS = "rollcall.pendingTaps"
  private const val KEY = "taps"

  /**
   * Append one tap. One entry per instance: pressing twice is one answer, and the FIRST tap is the
   * one that counts - the same first-tap-wins rule the server already applies.
   */
  fun record(context: Context, instanceId: String, at: Long) {
    if (instanceId.isEmpty()) return
    try {
      val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
      val existing = JSONArray(prefs.getString(KEY, "[]") ?: "[]")
      for (i in 0 until existing.length()) {
        if (existing.optJSONObject(i)?.optString("instanceId") == instanceId) return
      }
      existing.put(JSONObject().put("instanceId", instanceId).put("at", at))
      prefs.edit().putString(KEY, existing.toString()).apply()
    } catch (_: Throwable) {
      // A lost tap is recoverable - the athlete can answer in the app. A crash here is not.
    }
  }

  /** Read and clear. `at` is epoch milliseconds, matching the iOS payload exactly. */
  fun drain(context: Context): List<Map<String, Any>> = try {
    val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    val raw = JSONArray(prefs.getString(KEY, "[]") ?: "[]")
    val out = ArrayList<Map<String, Any>>(raw.length())
    for (i in 0 until raw.length()) {
      val o = raw.optJSONObject(i) ?: continue
      val id = o.optString("instanceId")
      if (id.isNotEmpty()) out.add(mapOf("instanceId" to id, "at" to o.optLong("at")))
    }
    if (raw.length() > 0) prefs.edit().remove(KEY).apply()
    out
  } catch (_: Throwable) {
    emptyList()
  }
}
