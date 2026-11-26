// Configuração pública do Meu Ponto — projeto Firebase meu-ponto-a8137.
// NADA AQUI É SEGREDO: estes valores vão para o navegador de qualquer visitante.
// A proteção dos dados está em firestore.rules + App Check + restrições da chave no Google Cloud (veja SEGURANCA.md).
self.APP_CONFIG = {
  // Firebase Console › Configurações do projeto › Geral › Seus apps › Web
  firebase: {
    apiKey: "AIzaSyADGd4CniVymzthR39uN9kSv52KTdoUwi4",
    authDomain: "meu-ponto-a8137.firebaseapp.com",
    projectId: "meu-ponto-a8137",
    storageBucket: "meu-ponto-a8137.firebasestorage.app",
    messagingSenderId: "89130787396",
    appId: "1:89130787396:web:158cc3a7d23d34359e9211"
  },
  // Firebase Console › Configurações do projeto › Cloud Messaging › Certificados push da Web › chave pública
  vapidKey: "",
  // Firebase Console › App Check › Apps › reCAPTCHA v3: chave do SITE (a chave secreta fica só no console)
  appCheckSiteKey: "6Ld5ezIuAAAAABIKjB5aCjRNsFzcjSq3cjsiSleV",
  // Google AdSense: ID do editor e IDs dos blocos de anúncio (Anúncios › Por bloco de anúncios › Display)
  adsense: {
    client: "",                 // ex.: "ca-pub-1234567890123456"
    slots: { hoje: "", hist: "" }
  }
};
