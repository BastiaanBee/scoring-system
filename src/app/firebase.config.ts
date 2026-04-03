// firebase.config.ts — Firebase project configuration
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            'AIzaSyC6-voIJeangwCnSKCVfL3byearTsSi5TM',
  authDomain:        'scoring-app-aab75.firebaseapp.com',
  projectId:         'scoring-app-aab75',
  storageBucket:     'scoring-app-aab75.firebasestorage.app',
  messagingSenderId: '289296070600',
  appId:             '1:289296070600:web:5ad1d6034c87badfeb32fd'
};

// Initialise Firebase and export Firestore database instance.
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);