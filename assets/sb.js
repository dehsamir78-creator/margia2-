(function(){
  var c = window.MARGIA_CONFIG || {};
  window.MARGIA_READY = !!(c.supabaseUrl && c.supabaseAnonKey && window.supabase);
  window.sb = window.MARGIA_READY ? window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  }) : null;
  window.track = function(name){
    if(!window.sb) return;
    window.sb.auth.getUser().then(function(r){
      if(r.data && r.data.user) window.sb.from("events").insert({user_id:r.data.user.id,name:name}).then(function(){});
    });
  };
  window.frError = function(e){
    var m = (e && (e.message||e.error_description)) || "";
    if(/Invalid login/i.test(m)) return "Email ou mot de passe incorrect.";
    if(/already registered/i.test(m)) return "Un compte existe déjà avec cet email. Connecte-toi.";
    if(/Password should be/i.test(m)) return "Mot de passe trop court : 8 caractères minimum.";
    if(/Email not confirmed/i.test(m)) return "Confirme d'abord ton email avec le lien reçu.";
    if(/rate limit|too many/i.test(m)) return "Trop de tentatives. Réessaie dans quelques minutes.";
    if(/LIMITE_GRATUITE/.test(m)) return "Le plan gratuit est limité à 3 produits.";
    return "Une erreur est survenue. Réessaie.";
  };
})();
