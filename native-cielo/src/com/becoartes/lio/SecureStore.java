package com.becoartes.lio;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Credentials and in-flight operations survive process death, not device backup. */
final class SecureStore {
    private final SharedPreferences prefs;
    private static final String ALIAS="becoartes.lio.credentials.v1";
    SecureStore(Context context) { prefs=context.getSharedPreferences("lio_secure",Context.MODE_PRIVATE); }
    private SecretKey key() throws Exception {
        KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);
        if(!ks.containsAlias(ALIAS)) {
            KeyGenerator generator=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            generator.init(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
            generator.generateKey();
        }
        return (SecretKey)ks.getKey(ALIAS,null);
    }
    synchronized String get(String name) {
        String saved=prefs.getString(name,"");if(saved.isEmpty())return "";
        try {String[] parts=saved.split(":");Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
            c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
            return new String(c.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),"UTF-8");
        }catch(Exception e){throw new IllegalStateException("Não foi possível ler os dados protegidos. Procure o administrador; não reinstale se há pagamento pendente.");}
    }
    synchronized void put(String name,String value) {
        try {if(value==null||value.isEmpty()){if(!prefs.edit().remove(name).commit())throw new Exception();return;}
            Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());
            String saved=Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(value.getBytes("UTF-8")),Base64.NO_WRAP);
            if(!prefs.edit().putString(name,saved).commit())throw new Exception();
        }catch(Exception e){throw new IllegalStateException("Não foi possível salvar a operação com segurança. Nada deve ser cobrado.");}
    }
}
