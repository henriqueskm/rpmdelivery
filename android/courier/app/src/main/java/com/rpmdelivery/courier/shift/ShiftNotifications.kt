package com.rpmdelivery.courier.shift

import android.Manifest
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.ActivityCompat
import androidx.core.app.NotificationChannelCompat
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.rpmdelivery.courier.MainActivity
import com.rpmdelivery.courier.R
import com.rpmdelivery.courier.work.CourierHome
import com.rpmdelivery.courier.work.ShiftAlert
import com.rpmdelivery.courier.work.alertText

/** The two channels: the quiet "in shift" line, and the alerts that ring. */
object ShiftNotifications {
    const val ONGOING_ID = 2000
    private const val ONGOING_CHANNEL = "turno"
    private const val ALERT_CHANNEL = "avisos"

    fun createChannels(context: Context) {
        val manager = NotificationManagerCompat.from(context)
        manager.createNotificationChannel(NotificationChannelCompat.Builder(ONGOING_CHANNEL, NotificationManagerCompat.IMPORTANCE_LOW)
            .setName("Turno em andamento").setDescription("Mostra a fila ou a rota enquanto o turno está aberto.").build())
        manager.createNotificationChannel(NotificationChannelCompat.Builder(ALERT_CHANNEL, NotificationManagerCompat.IMPORTANCE_HIGH)
            .setName("Avisos da loja").setDescription("Turno aprovado, próximo da fila e rota pronta para retirada.").build())
    }

    private fun openApp(context: Context): PendingIntent = PendingIntent.getActivity(context, 0,
        Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

    /** The persistent line of the foreground service. It never carries a customer's data. */
    fun ongoing(context: Context, home: CourierHome?, tracking: Boolean) = NotificationCompat.Builder(context, ONGOING_CHANNEL)
        .setSmallIcon(R.drawable.navigation_arrow)
        .setContentTitle(home?.shift?.restaurantName?.let { "Em turno · $it" } ?: "Em turno")
        .setContentText(ongoingText(home, tracking))
        .setOngoing(true)
        .setOnlyAlertOnce(true)
        .setSilent(true)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .setContentIntent(openApp(context))
        .build()

    fun ongoingText(home: CourierHome?, tracking: Boolean): String {
        val shift = home?.shift
        val route = home?.route
        return when {
            route != null && route.status == "RETURNING" -> "Voltando para a loja" + if (tracking) " · localização ativa" else ""
            route != null && route.status == "ON_ROUTE" -> "Rota em andamento" + if (tracking) " · localização ativa" else ""
            route != null && route.pickupReleased -> "Rota pronta para retirada"
            route != null -> "A loja está montando sua rota"
            shift?.status == "PENDING" -> "Aguardando a loja aprovar seu turno"
            shift?.queuePosition != null -> "${shift.queuePosition}º da fila"
            else -> "Turno aberto"
        }
    }

    /** Rings once per moment. Without the notification permission (Android 13+) it stays silent. */
    fun alert(context: Context, alert: ShiftAlert, home: CourierHome) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        val notification = NotificationCompat.Builder(context, ALERT_CHANNEL)
            .setSmallIcon(R.drawable.navigation_arrow)
            .setContentTitle(alert.title)
            .setContentText(alertText(alert, home))
            .setStyle(NotificationCompat.BigTextStyle().bigText(alertText(alert, home)))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_STATUS)
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .build()
        NotificationManagerCompat.from(context).notify(alert.id, notification)
    }

    fun sessionEnded(context: Context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ActivityCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
        NotificationManagerCompat.from(context).notify(2009, NotificationCompat.Builder(context, ALERT_CHANNEL)
            .setSmallIcon(R.drawable.navigation_arrow)
            .setContentTitle("Entre de novo no aplicativo")
            .setContentText("Sua sessão expirou. Os avisos da fila e a localização pararam.")
            .setAutoCancel(true)
            .setContentIntent(openApp(context))
            .build())
    }
}
