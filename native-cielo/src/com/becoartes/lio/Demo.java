package com.becoartes.lio;
import org.json.*;
import java.util.*;

/** In-memory sandbox: no network, no printer, no real payment. */
final class Demo {
    final Map<String,JSONObject> tables=new LinkedHashMap<>();
    final Map<String,JSONObject> intents=new HashMap<>();
    final Set<String> orders=new HashSet<>();
    final JSONArray products=new JSONArray();
    Demo() throws Exception {
        products.put(new JSONObject("{id:'p1',name:'Filé de frango',price:29.90,categoryName:'Pratos',image:'',modifierGroups:[]}"));
        products.put(new JSONObject("{id:'p2',name:'Água mineral',price:5,categoryName:'Bebidas',image:'',modifierGroups:[]}"));
        products.put(new JSONObject("{id:'p3',name:'Caipirinha',price:20.90,categoryName:'Drinks',image:'',modifierGroups:[{id:'g1',name:'Escolha seu sabor',minChoices:1,maxChoices:1,isRequired:true,modifiers:[{id:'m1',name:'Limão',price:0,status:'active'},{id:'m2',name:'Abacaxi',price:0,status:'active'}]}]}"));
        for(int n=1;n<=12;n++){JSONObject t=new JSONObject();t.put("id","t"+n).put("number",n).put("status","available").put("orders",new JSONArray()).put("paid",0);tables.put("t"+n,t);}
        JSONObject item=new JSONObject("{id:'initial',name:'Filé de frango',price:29.9,quantity:1,selectedModifiers:[]}");
        tables.get("t2").put("status","ordering").getJSONArray("orders").put(item);
    }
    JSONObject quote(String id)throws Exception{
        JSONObject t=tables.get(id);long sub=0;JSONArray lines=t.getJSONArray("orders");
        for(int j=0;j<lines.length();j++){JSONObject l=lines.getJSONObject(j);double p=l.getDouble("price");JSONArray mods=l.optJSONArray("selectedModifiers");if(mods!=null)for(int k=0;k<mods.length();k++)p+=mods.getJSONObject(k).optDouble("price");sub+=Math.round(p*100)*l.getInt("quantity");}
        long fee=Math.round(sub*0.13),paid=t.optLong("paid");
        return new JSONObject().put("table",t).put("subtotalCents",sub).put("serviceFeeCents",fee).put("paidCents",paid).put("balanceCents",Math.max(0,sub+fee-paid)).put("fingerprint",lines.toString()).put("receipt","DEMONSTRAÇÃO • SEM VALOR\nMesa "+t.getInt("number"));
    }
    synchronized JSONObject call(String path,JSONObject data)throws Exception {
        if(path.equals("login"))return new JSONObject().put("session","demo").put("terminal","DEMO").put("seller",new JSONObject().put("id","demo").put("name","Operador de teste"));
        if(path.equals("logout"))return new JSONObject();
        if(path.equals("payments/pending"))return new JSONObject().put("payments",new JSONArray());
        if(path.equals("catalog"))return new JSONObject().put("products",products);
        if(path.equals("tables")){JSONArray list=new JSONArray();for(String id:tables.keySet()){JSONObject t=new JSONObject(tables.get(id).toString());t.put("subtotalCents",quote(id).getLong("subtotalCents"));list.put(t);}return new JSONObject().put("tables",list);}
        if(path.startsWith("quote?"))return quote(java.net.URLDecoder.decode(path.substring(path.indexOf('=')+1),"UTF-8"));
        if(path.equals("orders")){
            if(orders.contains(data.getString("requestId")))return new JSONObject();JSONObject t=tables.get(data.getString("tableId"));
            JSONArray selected=data.getJSONArray("items");for(int n=0;n<selected.length();n++){JSONObject s=selected.getJSONObject(n);for(int j=0;j<products.length();j++){JSONObject p=products.getJSONObject(j);if(p.getString("id").equals(s.getString("productId"))){JSONObject item=new JSONObject(p.toString()).put("quantity",s.getInt("quantity"));JSONArray mods=new JSONArray();JSONArray groups=p.getJSONArray("modifierGroups");for(int g=0;g<groups.length();g++){JSONArray options=groups.getJSONObject(g).getJSONArray("modifiers");for(int m=0;m<options.length();m++){JSONObject option=options.getJSONObject(m);if(s.getJSONArray("modifierIds").toString().contains("\""+option.getString("id")+"\""))mods.put(option);}}item.put("selectedModifiers",mods);t.getJSONArray("orders").put(item);}}}
            t.put("status","ordering");orders.add(data.getString("requestId"));return new JSONObject();
        }
        if(path.equals("payments/prepare")){String id=data.getString("requestId");if(!intents.containsKey(id))intents.put(id,new JSONObject(data.toString()));return new JSONObject().put("id",id).put("status","pending");}
        if(path.equals("payments/settle")){JSONObject i=intents.get(data.getString("id"));if(!i.optBoolean("done")){JSONObject t=tables.get(i.getString("tableId"));t.put("paid",t.getLong("paid")+i.getLong("amount"));i.put("done",true);}return new JSONObject().put("changeCents",i.getLong("received")-i.getLong("amount")).put("status","done");}
        if(path.equals("finish")){JSONObject t=tables.get(data.getString("tableId"));t.put("status","available").put("orders",new JSONArray()).put("paid",0);return new JSONObject().put("closed",true);}
        throw new Exception("Operação não disponível na demonstração.");
    }
}
