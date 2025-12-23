import { useEffect, useState } from 'react';
import {
  onAuthStateChanged,
  signInWithCustomToken,
  updateProfile,
} from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { ref as dbRef, set as dbSet } from 'firebase/database';
import { auth, functions, db, realtimeDb } from '../firebase/client';

const TELEGRAM_GLOBAL = () => window.Telegram?.WebApp;

export function useMiniAppAuth() {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(true);
  const [error, setError] = useState(null);
  const [telegramId, setTelegramId] = useState(null);

  useEffect(() => {
    let unsubscribe = () => {};
    let timeoutId = null;

    async function bootstrap() {
      try {
        if (!auth.currentUser) {
          const initData = TELEGRAM_GLOBAL()?.initData;
          if (initData) {
            try {
              const verify = httpsCallable(functions, 'verifyTelegramInitData');
              const { data } = await verify({ initData });
              if (data?.token) {
                await signInWithCustomToken(auth, data.token);
              } else {
                throw new Error('No token received from verification');
              }
            } catch (verifyErr) {
              // Extract detailed error message from Firebase HttpsError
              // Firebase HttpsError has: code, message, details properties
              let errorMessage = 'Telegram verification failed';
              if (verifyErr?.code) {
                errorMessage = `${verifyErr.code}: ${verifyErr.message || verifyErr.details || 'Unknown error'}`;
              } else if (verifyErr?.message) {
                errorMessage = verifyErr.message;
              }
              
              console.error('Telegram verification failed:', {
                code: verifyErr?.code,
                message: verifyErr?.message,
                details: verifyErr?.details,
                fullError: verifyErr
              });
              
              // If it's an internal error, it might be a function deployment issue
              if (verifyErr?.code === 'internal' || verifyErr?.code === 'unavailable') {
                errorMessage = `Function unavailable: ${verifyErr.message || 'The verifyTelegramInitData function may not be deployed or configured correctly.'}`;
              }
              
              // Fall through to anonymous sign-in
              throw new Error(errorMessage);
            }
          } else {
            // No Telegram initData - require Telegram environment
            const errorMessage = 'Telegram Mini App environment required. Please open this app from Telegram.';
            console.error(errorMessage);
            setError(errorMessage);
            throw new Error(errorMessage);
          }
        }
      } catch (err) {
        console.error('Auth bootstrap failed.', err);
        // Extract error message properly
        const errorMessage = err?.code 
          ? `${err.code}: ${err.message || err.details || 'Unknown error'}`
          : err?.message || 'Authentication failed. Telegram authentication is required.';
        setError(errorMessage);
        
        // Don't fall back to anonymous auth - require Telegram
        if (!auth.currentUser) {
          // Error already set above
        } else {
          // User is already authenticated, clear error
          setError(null);
        }
      }
    }

    bootstrap();

    // Timeout fallback to ensure initialization completes
    // Reduced from 10s to 5s for faster mobile experience
    timeoutId = setTimeout(() => {
      console.warn('Auth initialization timeout, forcing completion');
      setInitializing(false);
    }, 5000); // 5 second timeout

    unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      try {
        setUser(authUser);

        if (authUser) {
          try {
            const tokenResult = await authUser.getIdTokenResult(true);
            const tokenClaims = tokenResult.claims || {};

            const profile = TELEGRAM_GLOBAL()?.initDataUnsafe?.user;
            // Get Telegram ID from token claims (set by backend) or from Telegram profile
            const extractedTelegramId = tokenClaims.telegramId?.toString() || profile?.id?.toString();
            setTelegramId(extractedTelegramId);
            
            const fullName = profile
              ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim() || profile.username || 'User'
              : 'Guest';
            
            // Update Firebase auth display name if Telegram profile exists
            if (profile && authUser.displayName !== fullName) {
              try {
                await updateProfile(authUser, {
                  displayName: fullName,
                });
              } catch (updateErr) {
                console.warn('Failed to update display name', updateErr);
              }
            }

            // Use Telegram ID directly as the user identifier
            // UID should be the Telegram ID (numeric string)
            if (extractedTelegramId && authUser.uid !== extractedTelegramId) {
              console.warn(`UID mismatch: expected ${extractedTelegramId}, got ${authUser.uid}. This may cause issues.`);
            }

            // Save/update user document in Firestore using Telegram ID as the document ID
            const userId = extractedTelegramId || authUser.uid;
            const userDoc = doc(db, 'users', userId);
            const telegramId = extractedTelegramId;
            await setDoc(
              userDoc,
              {
                uid: userId, // Use Telegram ID as uid
                telegramId: telegramId || userId,
                username: profile?.username || (profile ? `user_${profile.id}` : `guest-${authUser.uid.slice(0, 6)}`),
                firstName: profile?.first_name || 'Guest',
                lastName: profile?.last_name || '',
                fullName: fullName,
                avatar: profile?.photo_url || '',
                lastSeen: serverTimestamp(),
                stats: { orders: 0, volume: 0 },
              },
              { merge: true },
            );

            // If telegram ID found, create a db entry keyed by telegramId in both Firestore and Realtime DB
            if (telegramId) {
              // Save to Firestore
              const telegramUserDoc = doc(db, 'usersByTelegramId', telegramId);
              await setDoc(
                telegramUserDoc,
                {
                  uid: userId, // Use Telegram ID as uid
                  telegramId: telegramId,
                  username: profile?.username || `user_${profile.id}`,
                  firstName: profile?.first_name || '',
                  lastName: profile?.last_name || '',
                  fullName: fullName,
                  avatar: profile?.photo_url || '',
                  lastSeen: serverTimestamp(),
                },
                { merge: true },
              );

              // Also save to Realtime Database
              const telegramUserRef = dbRef(realtimeDb, `usersByTelegramId/${telegramId}`);
              await dbSet(telegramUserRef, {
                uid: userId, // Use Telegram ID as uid
                telegramId: telegramId,
                username: profile?.username || `user_${profile.id}`,
                firstName: profile?.first_name || '',
                lastName: profile?.last_name || '',
                fullName: fullName,
                avatar: profile?.photo_url || '',
                lastSeen: Date.now(),
              });
            }
          } catch (tokenErr) {
            console.error('Failed to refresh token claims', tokenErr);
          }
        }
      } catch (err) {
        console.error('Error in auth state change handler', err);
      } finally {
        // Always set initializing to false, even if there were errors
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        setInitializing(false);
      }
    });

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      unsubscribe();
    };
  }, []);

  // Helper function to get Telegram user ID
  // Returns telegramId if available, otherwise falls back to Firebase UID
  const getTelegramUserId = () => {
    if (telegramId) {
      return telegramId.toString();
    }
    // Fallback to UID (should be telegramId in production with Telegram auth)
    return user?.uid;
  };

  return { user, initializing, error, telegramId, getTelegramUserId };
}

