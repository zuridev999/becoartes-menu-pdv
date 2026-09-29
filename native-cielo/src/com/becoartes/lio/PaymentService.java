package com.becoartes.lio;
import android.app.*;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

public final class PaymentService extends Service {
    @Override public int onStartCommand(Intent i,int flags,int id){
        String channel="lio_payment";
        if(Build.VERSION.SDK_INT>=26)((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(new NotificationChannel(channel,"Pagamento em andamento",NotificationManager.IMPORTANCE_LOW));
        Notification.Builder b=Build.VERSION.SDK_INT>=26?new Notification.Builder(this,channel):new Notification.Builder(this);
        PendingIntent pending=PendingIntent.getActivity(this,0,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        startForeground(11,b.setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Becoartes • pagamento")
            .setContentText("Conclua ou consulte a operação. Não repita a cobrança.").setContentIntent(pending).setOngoing(true).build());
        return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent i){return null;}
}
