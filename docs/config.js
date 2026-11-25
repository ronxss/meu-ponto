// Configuração pública do Meu Ponto.
// NADA AQUI É SEGREDO: estes valores vão para o navegador de qualquer visitante.
// A proteção dos dados está em firestore.rules + App Check + restrições da chave no Google Cloud (veja SEGURANCA.md).
self.APP_CONFIG = {
  // Firebase Console › Configurações do projeto › Geral › Seus apps › Web
  firebase: {
    apiKey: "COLE_AQUI",
    authDomain: "SEU-PROJETO.firebaseapp.com",
    projectId: "SEU-PROJETO",
    storageBucket: "SEU-PROJETO.firebasestorage.app",
    messagingSenderId: "",
    appId: ""
  },
  // Firebase Console › App Check › Apps › reCAPTCHA v3: chave do SITE (a chave secreta fica só no console)
  appCheckSiteKey: "",
  // Google AdSense: ID do editor e IDs dos blocos de anúncio (Anúncios › Por bloco de anúncios › Display)
  adsense: {
    client: "",                 // ex.: "ca-pub-1234567890123456"
    slots: { hoje: "", hist: "" }
  }
};
