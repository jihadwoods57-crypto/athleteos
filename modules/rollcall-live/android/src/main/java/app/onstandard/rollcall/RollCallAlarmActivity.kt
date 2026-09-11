package app.onstandard.rollcall

import android.app.Activity
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.Context
import android.graphics.Color
import android.graphics.drawable.GradientDrawable
import android.media.AudioAttributes
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.TypedValue
import android.view.Gravity
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

/**
 * OnStandard — the screen a coach's wake-up takes over the phone with.
 *
 * Built in Kotlin rather than an XML layout on purpose: this module is autolinked from `modules/`
 * and has no resource merging of its own to rely on, and a layout that fails to resolve at 5:45
 * in the morning is the one failure this feature cannot have.
 *
 * THREE THINGS MAKE IT AN ALARM RATHER THAN A SCREEN:
 *   1. `setShowWhenLocked` / `setTurnScreenOn` - it appears over the lock screen and lights the
 *      display. Without these it waits politely behind the keyguard until somebody unlocks.
 *   2. The sound plays with `USAGE_ALARM`, which is routed to the alarm volume and is exempt from
 *      Do Not Disturb and from the ringer being silenced.
 *   3. It loops until answered. An alarm that plays once and gives up is a notification.
 *
 * The two buttons mirror iOS: "Attack the day" records the answer and opens the app, snooze puts
 * it back for nine minutes. Both stop the noise.
 */
class RollCallAlarmActivity : Activity() {
  private var player: MediaPlayer? = null
  private var vibrator: Vibrator? = null
  private var instanceId: String = ""
  private var title: String = "Wake up"
  private var button: String = "Attack the day"

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    instanceId = intent.getStringExtra(RollCallAlarmScheduler.EXTRA_INSTANCE_ID).orEmpty()
    title = intent.getStringExtra(RollCallAlarmScheduler.EXTRA_TITLE) ?: "Wake up"
    button = (intent.getStringExtra(RollCallAlarmScheduler.EXTRA_BUTTON) ?: "").ifBlank { "Attack the day" }

    showOverLockScreen()
    setContentView(buildView())
    startRinging()
  }

  override fun onDestroy() {
    stopRinging()
    super.onDestroy()
  }

  /** The back button must not be a way to silence a coach's alarm without answering it. */
  @Deprecated("Deliberate: an alarm is not dismissible by the back gesture.")
  override fun onBackPressed() {
    // Intentionally empty.
  }

  // ---------------------------------------------------------------- presentation

  private fun showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
      (getSystemService(Context.KEYGUARD_SERVICE) as? KeyguardManager)?.requestDismissKeyguard(this, null)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
          WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD,
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
  }

  private fun dp(v: Int): Int = TypedValue.applyDimension(
    TypedValue.COMPLEX_UNIT_DIP, v.toFloat(), resources.displayMetrics,
  ).toInt()

  private fun buildView(): ViewGroup {
    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      // The app's near-black ground, not pure black: the same surface every other screen sits on.
      setBackgroundColor(Color.parseColor("#0A0F1A"))
      setPadding(dp(28), dp(48), dp(28), dp(48))
    }

    root.addView(TextView(this).apply {
      text = "YOUR COACH SET THIS"
      setTextColor(Color.parseColor("#7C8DA6"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 13f)
      letterSpacing = 0.14f
      gravity = Gravity.CENTER
    })

    root.addView(TextView(this).apply {
      text = title
      setTextColor(Color.WHITE)
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 34f)
      gravity = Gravity.CENTER
      setPadding(0, dp(12), 0, dp(8))
    })

    root.addView(TextView(this).apply {
      text = "Answer it and the morning counts toward today's score."
      setTextColor(Color.parseColor("#9BB0C9"))
      setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
      gravity = Gravity.CENTER
      setPadding(0, 0, 0, dp(40))
    })

    root.addView(primaryButton())
    root.addView(snoozeButton())
    return root
  }

  /** Blue into teal, the app's signature sweep, on the button that means "I am up". */
  private fun primaryButton(): Button = Button(this).apply {
    // The COACH'S words. They typed it in the composer; this is where the athlete reads it.
    text = button
    setTextColor(Color.WHITE)
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 17f)
    isAllCaps = false
    background = GradientDrawable(
      GradientDrawable.Orientation.LEFT_RIGHT,
      intArrayOf(Color.parseColor("#3B82F6"), Color.parseColor("#2DD4BF")),
    ).apply { cornerRadius = dp(16).toFloat() }
    layoutParams = LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT, dp(58),
    ).apply { bottomMargin = dp(12) }
    setOnClickListener { answer() }
  }

  private fun snoozeButton(): Button = Button(this).apply {
    text = "Snooze $SNOOZE_MINUTES min"
    setTextColor(Color.parseColor("#9BB0C9"))
    setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
    isAllCaps = false
    background = GradientDrawable().apply {
      cornerRadius = dp(16).toFloat()
      setColor(Color.parseColor("#141C2B"))
      setStroke(dp(1), Color.parseColor("#24304A"))
    }
    layoutParams = LinearLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT, dp(54),
    )
    setOnClickListener { snooze() }
  }

  // ---------------------------------------------------------------- actions

  /**
   * The athlete is up. Record it the SAME way the lock-screen notification action does - into the
   * pending store for the JS queue to drain - and then open the app. Swift's comment applies here
   * word for word: the signed code that authorises an ack and the retry policy both live in JS,
   * and a second implementation in Kotlin would be a second source of truth about the one thing
   * this product cannot get wrong.
   */
  private fun answer() {
    RollCallPendingTaps.record(this, instanceId, System.currentTimeMillis())
    stopRinging()
    clearNotification()
    try {
      packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
    } catch (_: Throwable) {
      // Opening the app is the courtesy, not the point. The answer is already recorded.
    }
    finish()
  }

  /**
   * Nine minutes, the interval every alarm clock has used since mechanical ones. The roll call
   * itself has no concept of a snooze - the server knows on time, late and never answered - so
   * this buys the athlete time against the LATE deadline rather than pausing it.
   */
  private fun snooze() {
    stopRinging()
    clearNotification()
    RollCallAlarmScheduler.scheduleIn(this, instanceId, SNOOZE_MINUTES, title, button)
    finish()
  }

  private fun clearNotification() {
    try {
      (getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager)
        .cancel(instanceId.hashCode())
    } catch (_: Throwable) {
      // best effort
    }
  }

  // ---------------------------------------------------------------- noise

  private fun startRinging() {
    try {
      val uri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
        ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        ?: return
      player = MediaPlayer().apply {
        setDataSource(this@RollCallAlarmActivity, uri)
        // USAGE_ALARM is what routes this to the alarm stream and past Do Not Disturb. A plain
        // media usage would be silenced by the very modes this feature exists to defeat.
        setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build(),
        )
        isLooping = true
        prepare()
        start()
      }
    } catch (_: Throwable) {
      // No sound is survivable; the screen and the vibration still wake somebody.
    }
    try {
      vibrator = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        (getSystemService(Context.VIBRATOR_MANAGER_SERVICE) as VibratorManager).defaultVibrator
      } else {
        @Suppress("DEPRECATION")
        getSystemService(Context.VIBRATOR_SERVICE) as Vibrator
      }
      val pattern = longArrayOf(0, 600, 600)
      vibrator?.vibrate(VibrationEffect.createWaveform(pattern, 0))
    } catch (_: Throwable) {
      // best effort
    }
  }

  private fun stopRinging() {
    try { player?.stop() } catch (_: Throwable) { /* best effort */ }
    try { player?.release() } catch (_: Throwable) { /* best effort */ }
    player = null
    try { vibrator?.cancel() } catch (_: Throwable) { /* best effort */ }
    vibrator = null
  }

  companion object {
    const val SNOOZE_MINUTES = 9
  }
}
