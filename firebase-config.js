const firebaseConfig = {
  apiKey:            "AIzaSyCdYpOhwk2kTLI65ppr5a-SRIIDnOOXuXs",
  authDomain:        "revai-8f2e9.firebaseapp.com",
  projectId:         "revai-8f2e9",
  storageBucket:     "revai-8f2e9.firebasestorage.app",
  messagingSenderId: "963879082947",
  appId:             "1:963879082947:web:974b53aebea7b6afecfb76"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db   = firebase.firestore();
