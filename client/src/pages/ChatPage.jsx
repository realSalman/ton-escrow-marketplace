import React, { useEffect, useState } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useMiniAppAuth } from "../hooks/useMiniAppAuth";
import { fetchUsers, setCurrentUser, addUser, selectUser } from "../features/usersSlice";
import { fetchUserChats } from "../features/chatsSlice";
import { ref, onValue, off } from "firebase/database";
import { realtimeDb } from "../firebase/client";
import Sidebar from "../components/chat/Sidebar";
import ChatsContainer from "../components/chat/ChatsContainer";

export function ChatPage({ onBack }) {
  const { user, getTelegramUserId } = useMiniAppAuth();
  const userId = user ? getTelegramUserId() : null;
  const dispatch = useDispatch();
  const { currentUser } = useSelector((state) => state.users);
  const { selectedUser } = useSelector((state) => state.users);
  const { chats, status: chatsStatus } = useSelector((state) => state.chats);
  
  // Mobile state: track if we should show sidebar or chat
  const [showSidebar, setShowSidebar] = useState(true);

  // Note: telegramProfile is accessed inside useEffect to ensure it's available

  // Set up current user when Telegram UID is available
  useEffect(() => {
    if (!userId) {
      console.log('ChatPage: Waiting for userId...', { user, userId });
      return;
    }
    
    // Get Telegram profile - try multiple ways
    const telegramProfile = window.Telegram?.WebApp?.initDataUnsafe?.user;
    
    if (!telegramProfile) {
      console.warn('ChatPage: Telegram profile not available, using fallback');
      // Fallback: create minimal user data
      const userData = {
        uid: userId,
        displayName: 'User',
        fullName: 'User',
        firstName: '',
        lastName: '',
        username: '',
        email: '',
        photoURL: '',
        avatar: '',
        online: true,
      };
      dispatch(setCurrentUser(userData));
      dispatch(addUser(userData));
      return;
    }

    const fullName = telegramProfile.first_name && telegramProfile.last_name
      ? `${telegramProfile.first_name} ${telegramProfile.last_name}`.trim()
      : telegramProfile.first_name || telegramProfile.username || 'User';

    const userData = {
      uid: userId,
      displayName: fullName,
      fullName: fullName,
      firstName: telegramProfile.first_name || '',
      lastName: telegramProfile.last_name || '',
      username: telegramProfile.username || '',
      email: '',
      photoURL: telegramProfile.photo_url || '',
      avatar: telegramProfile.photo_url || '',
      online: true,
    };

    // Set current user in Redux
    dispatch(setCurrentUser(userData));

    // Add/update user in Firestore
    dispatch(addUser({
      uid: userId,
      displayName: fullName,
      fullName: fullName,
      firstName: telegramProfile.first_name || '',
      lastName: telegramProfile.last_name || '',
      username: telegramProfile.username || '',
      avatar: telegramProfile.photo_url || '',
      photoURL: telegramProfile.photo_url || '',
    })).catch((error) => {
      console.error('Error adding user to Firestore:', error);
    });
  }, [userId, user, dispatch]);

  // Fetch all users and chats when current user is set
  // This ensures existing conversations are loaded when user navigates to chat page
  useEffect(() => {
    if (!currentUser?.uid) {
      console.log('ChatPage: Waiting for currentUser.uid...', { currentUser });
      return;
    }

    console.log('ChatPage: Checking database for existing chats and messages for user:', currentUser.uid);
    
    // Fetch chats first (this includes messages)
    dispatch(fetchUserChats(currentUser.uid))
      .then((result) => {
        console.log('ChatPage: fetchUserChats completed. Found', result.payload?.length || 0, 'chats with conversations');
        if (result.payload && result.payload.length > 0) {
          // Log summary of conversations found
          result.payload.forEach(chat => {
            console.log(`  - Chat ${chat.id}: ${chat.messages?.length || 0} messages, members:`, chat.membersArray || Object.keys(chat.members || {}));
          });
        }
      })
      .catch((error) => {
        console.error('ChatPage: Error fetching chats:', error);
      });
    
    // Also fetch all users (for search and new conversations)
    dispatch(fetchUsers());
  }, [currentUser?.uid, dispatch]);
  
  // Set up real-time listener for chats in ChatPage (not just ChatsContainer)
  // This ensures chats are always loaded, even when no user is selected
  useEffect(() => {
    if (!currentUser?.uid) return;
    
    console.log('ChatPage: Setting up real-time chats listener for user:', currentUser.uid);
    
    // Set up real-time listener for chats
    const chatsRef = ref(realtimeDb, "chats");
    
    const unsubscribe = onValue(
      chatsRef,
      (snapshot) => {
        if (snapshot.exists()) {
          // Refetch user chats when any chat changes
          console.log('ChatPage: Chat changed in database, refetching chats');
          dispatch(fetchUserChats(currentUser.uid))
            .then(() => {
              console.log('ChatPage: Chats refetched successfully after change');
            })
            .catch((err) => {
              console.error('ChatPage: Error refetching chats:', err);
            });
        }
      },
      (error) => {
        console.error('ChatPage: Error listening to chats:', error);
      }
    );

    return () => {
      console.log('ChatPage: Cleaning up chats listener');
      off(chatsRef);
    };
  }, [currentUser?.uid, dispatch]);

  // Handle mobile view: show sidebar when no user selected, hide when user selected
  useEffect(() => {
    if (selectedUser?.uid) {
      // On mobile, hide sidebar when user is selected
      setShowSidebar(false);
    } else {
      // On mobile, show sidebar when no user is selected
      setShowSidebar(true);
    }
  }, [selectedUser?.uid]);

  // Handle back button click on mobile
  const handleMobileBack = () => {
    dispatch(selectUser({}));
    setShowSidebar(true);
  };

  if (!userId || !user) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
        <p className="text-gray-500">Loading chat...</p>
      </div>
    );
  }

  if (!currentUser?.uid) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-12rem)]">
        <p className="text-gray-500">Setting up your profile...</p>
      </div>
    );
  }

  return (
    <div className="w-full h-[calc(100vh-12rem)] bg-white flex flex-col gap-2">
      {/* Main Content */}
      <div className="flex flex-1 gap-2 overflow-hidden min-h-0">
        {/* Sidebar - hidden on mobile when chat is selected */}
        <div className={`${showSidebar ? 'flex' : 'hidden'} md:flex w-full md:w-auto`}>
          <Sidebar />
        </div>

        {/* Main Chat Area - hidden on mobile when sidebar is shown and no user selected */}
        {!selectedUser.uid ? (
          <div className={`${!showSidebar ? 'flex' : 'hidden'} md:flex flex-1 flex-col justify-center items-center border rounded-lg bg-zinc-100`}>
            {chatsStatus === "Pending..." ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-gray-500">Loading conversations...</p>
                <p className="text-sm text-gray-400">Checking database for existing chats</p>
              </div>
            ) : chats.length > 0 ? (
              <div className="flex flex-col items-center gap-2">
                <p className="text-gray-700 font-medium">Select a conversation to start chatting</p>
                <p className="text-sm text-gray-500">Found {chats.length} conversation{chats.length !== 1 ? 's' : ''}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-2">
                <p className="text-gray-500">No conversations yet</p>
                <p className="text-sm text-gray-400">Select a user from the sidebar to start a new chat</p>
              </div>
            )}
          </div>
        ) : (
          <div className={`${!showSidebar ? 'flex' : 'hidden'} md:flex flex-1`}>
            <ChatsContainer 
              currentUser={currentUser} 
              selectedUser={selectedUser}
              onBack={handleMobileBack}
            />
          </div>
        )}
      </div>
    </div>
  );
}

