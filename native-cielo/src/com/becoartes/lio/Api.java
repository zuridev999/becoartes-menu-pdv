package com.becoartes.lio;

import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import android.os.Handler;
import android.os.Looper;

final class Api {
    interface Done { void accept(JSONObject result) throws Exception; }
    interface Failed { void accept(String message,int status); }
    final SecureStore store;
    final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final Handler main=new Handler(Looper.getMainLooper());
    Demo demo;
    Api(SecureStore store){this.store=store;}
    void call(String path,JSONObject body,Done done,Failed failed) {
        worker.execute(()->{
            JSONObject output=null;String error=null;int status=0;
            try {
                if(demo!=null)output=demo.call(path,body);
                else {
                    // Production host is fixed. Enrollment credentials cannot be redirected by a QR or deep link.
                    URL url=new URL("https://pdv.becoartes.com/api/lio/"+path);
                    HttpsURLConnection c=(HttpsURLConnection)url.openConnection();
                    try {
                        c.setInstanceFollowRedirects(false);c.setConnectTimeout(15000);c.setReadTimeout(30000);
                        c.setRequestProperty("Accept","application/json");c.setRequestProperty("Content-Type","application/json");
                        c.setRequestProperty("X-Lio-Device",store.get("device"));c.setRequestProperty("X-Lio-Session",store.get("session"));
                        if(body!=null){c.setRequestMethod("POST");c.setDoOutput(true);byte[] bytes=body.toString().getBytes("UTF-8");c.setFixedLengthStreamingMode(bytes.length);try(java.io.OutputStream out=c.getOutputStream()){out.write(bytes);}}
                        status=c.getResponseCode();InputStream stream=status<400?c.getInputStream():c.getErrorStream();
                        if(stream==null)throw new Exception("Servidor indisponível.");
                        ByteArrayOutputStream buffer=new ByteArrayOutputStream();byte[] chunk=new byte[4096];int n;
                        try(InputStream input=stream){while((n=input.read(chunk))!=-1){buffer.write(chunk,0,n);if(buffer.size()>4*1024*1024)throw new Exception("Resposta muito grande.");}}
                        output=new JSONObject(buffer.toString("UTF-8"));
                        if(status<200||status>=300)throw new Exception(output.optString("error","Não foi possível concluir."));
                    }finally{c.disconnect();}
                }
            }catch(Exception e){error=e.getMessage()==null?"Sem conexão. Tente consultar novamente.":e.getMessage();}
            JSONObject result=output;String message=error;int code=status;
            main.post(()->{if(message!=null)failed.accept(message,code);else try{done.accept(result);}catch(Exception e){failed.accept("Não foi possível atualizar a tela: "+e.getMessage(),0);}});
        });
    }
}
