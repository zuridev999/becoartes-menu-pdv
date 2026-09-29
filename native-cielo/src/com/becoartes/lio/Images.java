package com.becoartes.lio;
import android.graphics.*;
import android.widget.ImageView;
import android.util.LruCache;
import java.util.concurrent.*;
import java.net.*;
import java.io.*;

final class Images {
    private static final ExecutorService workers=Executors.newFixedThreadPool(2);
    private static final LruCache<String,Bitmap> cache=new LruCache<String,Bitmap>(4*1024*1024){protected int sizeOf(String k,Bitmap b){return b.getByteCount();}};
    static void load(String source,ImageView view){
        if(source==null||source.isEmpty())return;String url=source.startsWith("/")?"https://pdv.becoartes.com"+source:source;
        if(!url.startsWith("https://"))return;view.setTag(url);Bitmap hit=cache.get(url);if(hit!=null){view.setImageBitmap(hit);return;}
        workers.execute(()->{try{javax.net.ssl.HttpsURLConnection c=(javax.net.ssl.HttpsURLConnection)new URL(url).openConnection();c.setConnectTimeout(5000);c.setReadTimeout(5000);c.setInstanceFollowRedirects(false);
            try{if(c.getResponseCode()!=200)return;ByteArrayOutputStream out=new ByteArrayOutputStream();try(InputStream in=c.getInputStream()){byte[] b=new byte[4096];int n;while((n=in.read(b))!=-1){out.write(b,0,n);if(out.size()>2*1024*1024)return;}}
                byte[] bytes=out.toByteArray();BitmapFactory.Options options=new BitmapFactory.Options();options.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);int sample=1;while(Math.max(options.outWidth,options.outHeight)/sample>160)sample*=2;options.inJustDecodeBounds=false;options.inSampleSize=sample;Bitmap image=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(image==null)return;cache.put(url,image);view.post(()->{if(url.equals(view.getTag()))view.setImageBitmap(image);});
            }finally{c.disconnect();}}catch(Exception ignored){/* Placeholder remains on unavailable image. */}});
    }
}
