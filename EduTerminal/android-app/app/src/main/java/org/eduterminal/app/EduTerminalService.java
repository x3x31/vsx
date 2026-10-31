package org.eduterminal.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

public class EduTerminalService extends Service {
    private static final String CHANNEL_ID = "eduterminal";
    private static final int NOTIFICATION_ID = 41;

    private ScheduledExecutorService executor;
    private ScheduledFuture<?> poller;

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForegroundCompat(buildNotification(getString(R.string.service_running)));

        executor = Executors.newSingleThreadScheduledExecutor();
        poller = executor.scheduleWithFixedDelay(this::refreshNotification, 0, 5, TimeUnit.SECONDS);
    }

    private void refreshNotification() {
        try {
            boolean online = ConnectorClient.health();
            String text = online
                    ? "Ambiente on-line em " + NetworkUtils.lanUrl()
                    : "Ambiente parado - abra o app e inicie";
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                manager.notify(NOTIFICATION_ID, buildNotification(text));
            }
        } catch (Exception ignored) {
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                getString(R.string.service_channel),
                NotificationManager.IMPORTANCE_LOW);
        channel.setDescription(getString(R.string.service_running));
        NotificationManager manager = getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.createNotificationChannel(channel);
        }
    }

    private Notification buildNotification(String text) {
        Intent open = new Intent(this, MainActivity.class);
        PendingIntent pending = PendingIntent.getActivity(
                this,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new Notification.Builder(this, CHANNEL_ID)
                .setContentTitle(getString(R.string.notification_title))
                .setContentText(text)
                .setSmallIcon(R.drawable.ic_eduterminal)
                .setContentIntent(pending)
                .setOngoing(true)
                .build();
    }

    private void startForegroundCompat(Notification notification) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        if (poller != null) {
            poller.cancel(true);
        }
        if (executor != null) {
            executor.shutdownNow();
        }
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
